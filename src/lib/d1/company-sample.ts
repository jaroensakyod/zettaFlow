// load_sample_data / clear_sample_data for D1, step for step after the Postgres functions. Every sample row goes
// through validate_payload() (validate.ts) and then the entities INSERT triggers (entity-insert.ts), in Postgres
// order. Here all of it is planned in memory (a later row may point at, or move the stock of, a row planned earlier in
// the same call) and written as one batch; running codes are counted in memory and the counters written with it.
import { afterEntityInsert, beforeEntityInsert, EntityRows } from "./entity-insert";
import { validatePayload, type SchemaField } from "./validate";
import { fail, now, pgNum, pgRound, pgText, pgUuid } from "./common";
import { formatCode, thaiYear } from "../domain";
import type { Stmt } from "./driver";
import type { Tenant } from "./tenant";

type Data = Record<string, unknown>;
export type SampleRow = { id: string; kind: string; data: Data; stock?: number; paid?: number; status?: string };

/** take_code() for the batch: the next running numbers of each prefix, counted here and written with the batch. */
class Counters {
  private counters = new Map<string, { start: number; used: number }>();
  constructor(private t: Tenant) {}
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
  stmts(): Stmt[] {
    return [...this.counters].flatMap(([prefix, c]) =>
      c.start
        ? [this.t.guardStmt("doc_counters", { prefix, year: 0, last: c.start }), this.t.updateStmt("doc_counters", { prefix, year: 0 }, { last: c.start + c.used })]
        : [this.t.insertStmt("doc_counters", { prefix, year: 0, last: c.used })],
    );
  }
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
    (await t.selectGlobal<{ kind: string; department: string; fields: SchemaField[] }>("entity_schemas")).map((s) => [s.kind, { department: s.department, fields: Array.isArray(s.fields) ? s.fields : [] }]),
  );
  const entities = new EntityRows(t),
    counters = new Counters(t),
    plan = { stmts: [] as Stmt[] },
    stamp = now(),
    ids: (string | null)[] = [];
  const live = async (id: string, kind: string) => {
    const r = await entities.get(id);
    return !!r && r.kind === kind && !r.archived_at;
  };
  for (const r of rows as Data[]) {
    const kind = pgText(r?.kind);
    let clean = await validatePayload(kind === null ? null : schemas.get(kind)?.fields, r?.data, live);
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
    if (await entities.get(id!)) fail('duplicate key value violates unique constraint "entities_pkey"');

    clean = (
      await beforeEntityInsert(kind!, clean, {
        takeCode: (prefix) => counters.code(prefix),
        docCode: async (ing) => (await t.selectInternal<{ doc_code: string | null }>("ingestions", { where: { id: ing } }))[0]?.doc_code ?? null,
        approverRole: () => v.role,
      })
    ).data;
    entities.plan({ id: id!, kind: kind!, department: d, data: clean, archived_at: null, version: 1 });
    plan.stmts.push(t.insertStmt("entities", { id, kind, department: d, data: clean, created_by: v.userId }));
    await afterEntityInsert(t, plan, id!, kind!, clean, entities, stamp);
    ids.push(pgText(r.id));
  }
  await t.atomic([
    ...counters.stmts(),
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
