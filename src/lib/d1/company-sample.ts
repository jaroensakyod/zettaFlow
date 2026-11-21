// load_sample_data / clear_sample_data for D1, step for step after the Postgres functions. Every sample row went
// through validate_payload() and then the entities triggers of an INSERT, in Postgres order: BEFORE entities_code →
// entities_dept_rules → entities_purchase_figures; AFTER create_project_stages → entities_stock_effect (which calls
// post_stock_movement and so UPDATEs a product) → entities_take_item_files. Here all of it is planned in memory (a
// later row may point at, or move the stock of, a row planned earlier in the same call) and written as one batch.
import { codePrefix } from "./entities";
import { projectStageStmts } from "./company-share";
import { fail, now, pgLen, pgText } from "./company";
import { canWriteDept } from "./access";
import { approvalStatuses, derive } from "../dept-rules";
import { formatCode, thaiYear } from "../domain";
import type { Stmt } from "./driver";
import type { Tenant } from "./tenant";

type Data = Record<string, unknown>;
type Field = { key: string; label?: string; type?: string; required?: unknown; options?: unknown; resource?: string; min?: unknown };
type Row = { id: string; kind: string; department: string; data: Data; archived_at: string | null; version: number; planned: boolean; guarded?: boolean };
export type SampleRow = { id: string; kind: string; data: Data; stock?: number; paid?: number; status?: string };

const UUID_IN = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;
/** text::uuid, with Postgres's error for anything that is not one. */
function pgUuid(v: string | null): string | null {
  if (v === null) return null;
  if (!UUID_IN.test(v)) fail(`invalid input syntax for type uuid: "${v}"`);
  const h = v.replace(/[{}-]/g, "").toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** text::numeric (null stays null). */
function pgNum(v: unknown): number | null {
  const s = pgText(v);
  if (s === null) return null;
  const n = Number(s.trim());
  if (s.trim() === "" || Number.isNaN(n)) fail(`invalid input syntax for type numeric: "${s}"`);
  return n;
}
/** round(numeric, d): half away from zero. */
const pgRound = (n: number, d = 0) => {
  const f = 10 ** d,
    x = Math.round(Math.abs(n) * f + 1e-9) / f;
  return n < 0 ? -x : x;
};

/** The company's entities as this call sees them: rows planned earlier in the call, then the database. */
class Plan {
  rows = new Map<string, Row | null>();
  stmts: Stmt[] = [];
  counters = new Map<string, { start: number; used: number }>();
  constructor(private t: Tenant) {}
  async get(id: string): Promise<Row | null> {
    if (!this.rows.has(id)) {
      const [e] = await this.t.selectInternal<Row>("entities", { where: { id } });
      this.rows.set(id, e ? { ...e, planned: false } : null);
    }
    return this.rows.get(id)!;
  }
  /** take_code(): the next running number of a prefix, counted here and written with the batch. */
  async code(prefix: string): Promise<string> {
    let c = this.counters.get(prefix);
    if (!c) {
      const [r] = await this.t.selectInternal<{ last: number }>("doc_counters", { where: { prefix, year: 0 } });
      c = { start: r ? Number(r.last) : 0, used: 0 };
      this.counters.set(prefix, c);
    }
    c.used++;
    return formatCode(prefix, thaiYear(), c.start + c.used);
  }
  counterStmts(): Stmt[] {
    return [...this.counters].flatMap(([prefix, c]) =>
      c.start
        ? [this.t.guardStmt("doc_counters", { prefix, year: 0, last: c.start }), this.t.updateStmt("doc_counters", { prefix, year: 0 }, { last: c.start + c.used })]
        : [this.t.insertStmt("doc_counters", { prefix, year: 0, last: c.used })],
    );
  }
}

/** validate_payload(k, p, c): only the module's fields, each checked by type, relations inside the company. */
async function validatePayload(t: Tenant, plan: Plan, schemas: Map<string, { department: string; fields: Field[] }>, kind: string | null, p: unknown): Promise<Data> {
  const spec = kind === null ? undefined : schemas.get(kind);
  if (!spec) return fail("ไม่พบโมดูล");
  const input = p && typeof p === "object" && !Array.isArray(p) ? (p as Data) : {};
  const out: Data = {};
  for (const f of spec.fields) {
    let v = input[f.key];
    if (v === undefined || v === null || v === "") {
      if (f.required === true || f.required === "true") fail(`ข้อมูลไม่ครบ: ${pgText(f.label) ?? ""}`);
      continue;
    }
    if (f.type === "lines") {
      const isStr = (x: Data, k: string, max: number) => !(k in x) || (typeof x[k] === "string" && pgLen(x[k] as string) <= max);
      const ok = (x: unknown) => {
        if (!x || typeof x !== "object" || Array.isArray(x)) return false;
        const o = x as Data;
        return (
          typeof o.name === "string" &&
          pgLen(o.name) >= 1 &&
          pgLen(o.name) <= 500 &&
          typeof o.qty === "number" &&
          typeof o.price === "number" &&
          o.qty >= 0 &&
          o.qty <= 1e9 &&
          Math.abs(o.price) <= 1e12 &&
          isStr(o, "category", 100) &&
          isStr(o, "unit", 30) &&
          isStr(o, "currency", 3) &&
          (!("discount" in o) || (typeof o.discount === "number" && o.discount >= 0 && o.discount <= 1e12)) &&
          (!("discountType" in o) || o.discountType === "percent" || o.discountType === "amount")
        );
      };
      if (!Array.isArray(v) || v.length > 100 || !v.every(ok)) fail("รายการสินค้าไม่ถูกต้อง");
      v = (v as Data[]).map((x) => Object.fromEntries(["name", "qty", "price", "category", "unit", "currency", "discount", "discountType"].filter((k) => x[k] !== undefined && x[k] !== null).map((k) => [k, x[k]])));
    } else if (f.type === "number") {
      if (typeof v !== "number") fail("รูปแบบตัวเลขไม่ถูกต้อง");
      const min = f.min === undefined || f.min === null ? null : Number(f.min);
      if (Math.abs(v as number) > 1e12 || (min !== null && (v as number) < min)) fail("จำนวนไม่ถูกต้อง");
    } else {
      if (typeof v !== "string" || pgLen(v) > 10000) fail("รูปแบบข้อความไม่ถูกต้อง");
      const s = v as string;
      if (f.type === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail("วันที่ไม่ถูกต้อง");
        const d = new Date(s + "T00:00:00Z");
        if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) fail(`date/time field value out of range: "${s}"`);
      }
      if (f.type === "select" && Array.isArray(f.options) && !f.options.includes(s)) fail("ตัวเลือกไม่ถูกต้อง");
      if (f.type === "relation") {
        const r = await plan.get(pgUuid(s)!);
        if (!r || r.kind !== f.resource || r.archived_at) fail("ข้อมูลอ้างอิงไม่อยู่ในบริษัทนี้");
      }
    }
    out[f.key] = v;
  }
  const sd = pgText(out.startDate),
    ed = pgText(out.endDate);
  if (sd !== null && ed !== null && sd > ed) fail("ช่วงวันที่ไม่ถูกต้อง");
  return out;
}

/** post_stock_movement() against the planned rows. */
async function stockMove(t: Tenant, plan: Plan, productId: string | null, type: "in" | "out", q: number, reference: string, notes: string, stamp: string) {
  if (!canWriteDept(t.viewer, "Warehouse")) fail("ไม่มีสิทธิ์คลังสินค้า");
  const p = productId === null ? null : await plan.get(productId);
  if (!p || p.kind !== "products" || p.archived_at) return fail("ไม่พบสินค้า");
  if (q <= 0 || q >= 1e9 || pgLen(reference.replace(/^ +| +$/g, "")) < 1 || pgLen(reference.replace(/^ +| +$/g, "")) > 200) fail("รายการรับ–จ่ายไม่ถูกต้อง");
  const next = (pgNum(p.data.stock) as number) + (type === "in" ? q : -q);
  if (next < 0) fail("สินค้าไม่พอ");
  if (!p.planned && !p.guarded) plan.stmts.push(t.guardStmt("entities", { id: p.id, version: p.version })), (p.guarded = true);
  p.data = { ...p.data, stock: next };
  p.version++;
  plan.stmts.push(
    t.insertStmt("stock_movements", { product_id: p.id, type, quantity: q, reference, notes, created_by: t.viewer.userId }),
    t.updateStmt("entities", { id: p.id }, { data: p.data, version: p.version, updated_at: stamp }),
    t.insertStmt("audit_events", { actor: t.viewer.userId, action: "stock_" + type, target: p.id }),
  );
}

/** load_sample_data(): the owner fills an empty company with the demo rows (in order: a row only points at earlier ones). */
export async function loadSampleData(t: Tenant, rows: unknown): Promise<number> {
  const v = t.viewer;
  if (v.role !== "owner") fail("เฉพาะเจ้าของบริษัท");
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 2000) fail("ข้อมูลตัวอย่างไม่ถูกต้อง");
  const [company] = await t.selectGlobal<{ settings: Data }>("companies", { where: { id: v.companyId } });
  const settings = company?.settings || {};
  if (Array.isArray(settings.sample_ids) && settings.sample_ids.length > 0) fail("ใส่ข้อมูลตัวอย่างไว้แล้ว ลบของเดิมก่อน");
  const schemas = new Map(
    (await t.selectGlobal<{ kind: string; department: string; fields: Field[] }>("entity_schemas")).map((s) => [s.kind, { department: s.department, fields: Array.isArray(s.fields) ? s.fields : [] }]),
  );
  const plan = new Plan(t),
    stamp = now(),
    ids: (string | null)[] = [];
  for (const r of rows as Data[]) {
    const kind = pgText(r?.kind);
    let clean = await validatePayload(t, plan, schemas, kind, r?.data);
    let d = schemas.get(kind!)!.department;
    if (kind === "tasks" || kind === "documents") d = pgText(clean.department) ?? "Operations";
    if (kind === "tickets" && pgText(clean.type) === "IT") d = "IT";
    if (kind === "products") clean = { ...clean, stock: Math.max(0, pgNum(r.stock) ?? 0) };
    if (kind === "invoices") {
      const sub = pgNum(clean.subtotal);
      clean = { ...clean, total: sub === null ? null : pgRound(sub * (1 + (pgNum(clean.vat) ?? 0) / 100), 2), paid: Math.max(0, pgNum(r.paid) ?? 0), status: pgText(r.status) ?? "issued" };
    }
    if (kind === "payroll") {
      const base = pgNum(clean.base);
      clean = { ...clean, net: base === null ? null : base + (pgNum(clean.allowance) ?? 0) - (pgNum(clean.deduction) ?? 0) };
    }
    if (kind === "purchases") {
      const q = pgNum(clean.quantity),
        u = pgNum(clean.unitCost);
      clean = { ...clean, total: q === null || u === null ? null : q * u, status: pgText(r.status) ?? "draft" };
    }
    const id = pgUuid(pgText(r.id));
    if (id === null) fail('null value in column "id" of relation "entities" violates not-null constraint');
    if (plan.rows.get(id!) || (await plan.get(id!))) fail('duplicate key value violates unique constraint "entities_pkey"');

    // BEFORE INSERT: entities_code.
    const prefix = codePrefix[kind!];
    if (prefix) {
      if ((pgText(clean.code) ?? "") === "") {
        let c: string | null = null;
        const ing = pgText(clean.ingestionId) ?? "";
        if (/^[0-9a-f-]{36}$/.test(ing)) c = (await t.selectInternal<{ doc_code: string | null }>("ingestions", { where: { id: pgUuid(ing) } }))[0]?.doc_code ?? null;
        clean = { ...clean, code: c ?? (await plan.code(prefix)) };
      }
      if (kind === "purchases" && (pgText(clean.poNumber) ?? "") === "") clean = { ...clean, poNumber: pgText(clean.code) };
    }
    // entities_dept_rules.
    const st = pgText(clean.status);
    if (st !== null && approvalStatuses[kind!]?.includes(st) && !["owner", "manager"].includes(v.role)) fail("ต้องให้ Owner หรือ Manager เป็นผู้อนุมัติสถานะนี้");
    clean = { ...clean, ...derive(kind!, clean) };
    // entities_purchase_figures.
    if (kind === "purchases") {
      const lines = Array.isArray(clean.lines) ? (clean.lines as Data[]) : [];
      if (lines.length) clean = { ...clean, total: lines.reduce((s, x) => s + (pgNum(x.qty) as number) * (pgNum(x.price) ?? 0), 0) };
      else if ((pgText(clean.productId) ?? "") === "" || typeof clean.quantity !== "number") fail("ใส่รายการสินค้า หรือ สินค้า จำนวน และราคาต่อหน่วย");
    }

    const row: Row = { id: id!, kind: kind!, department: d, data: clean, archived_at: null, version: 1, planned: true };
    plan.rows.set(row.id, row);
    plan.stmts.push(t.insertStmt("entities", { id: row.id, kind, department: d, data: clean, created_by: v.userId }));
    // AFTER INSERT: create_project_stages, entities_stock_effect, entities_take_item_files.
    if (kind === "projects") plan.stmts.push(...projectStageStmts(t, row.id));
    if (kind === "stock_issues" && st === "จ่ายของแล้ว") {
      const q = pgRound(pgNum(clean.quantity) ?? 0);
      if (q > 0) await stockMove(t, plan, pgUuid(pgText(clean.productId)), "out", q, "stock_issues:" + row.id, pgText(clean.name) ?? "", stamp);
    } else if (kind === "stock_counts" && st === "ปรับยอดแล้ว") {
      const pid = pgUuid(pgText(clean.productId));
      const p = pid === null ? null : await plan.get(pid);
      const cur = p && p.kind === "products" ? (pgNum(p.data.stock) ?? 0) : 0;
      const q = pgRound((pgNum(clean.countedQty) ?? 0) - cur);
      if (q !== 0) await stockMove(t, plan, pid, q > 0 ? "in" : "out", Math.abs(q), "stock_counts:" + row.id, "ปรับยอดจากการตรวจนับ", stamp);
    }
    const ing = pgText(clean.ingestionId) ?? "";
    if (/^[0-9a-f-]{36}$/.test(ing)) plan.stmts.push(t.updateStmt("attachments", { ingestion_id: pgUuid(ing), entity_id: null }, { entity_id: row.id }));
    ids.push(pgText(r.id));
  }
  await t.atomic([
    ...plan.counterStmts(),
    ...plan.stmts,
    t.updateGlobalStmt("companies", { id: v.companyId }, { settings: { ...settings, sample_ids: ids } }),
    t.insertStmt("audit_events", { actor: v.userId, action: "sample_data_loaded", target: String(ids.length) }),
  ]);
  return ids.length;
}

/** clear_sample_data(): the owner archives the sample rows still standing; returns how many. */
export async function clearSampleData(t: Tenant): Promise<number> {
  const v = t.viewer;
  if (v.role !== "owner") fail("เฉพาะเจ้าของบริษัท");
  const [company] = await t.selectGlobal<{ settings: Data }>("companies", { where: { id: v.companyId } });
  const settings = { ...(company?.settings || {}) };
  const sample = Array.isArray(settings.sample_ids) ? settings.sample_ids.map((x) => pgUuid(pgText(x))).filter((x): x is string => x !== null) : [];
  const standing = sample.length ? await t.selectInternal<{ id: string }>("entities", { where: { id: sample, archived_at: null } }) : [];
  const stamp = now();
  delete settings.sample_ids;
  await t.atomic([
    ...(standing.length ? [t.updateStmt("entities", { id: standing.map((e) => e.id), archived_at: null }, { archived_at: stamp, updated_at: stamp })] : []),
    ...(company ? [t.updateGlobalStmt("companies", { id: v.companyId }, { settings })] : []),
    t.insertStmt("audit_events", { actor: v.userId, action: "sample_data_cleared", target: String(standing.length) }),
  ]);
  return standing.length;
}
