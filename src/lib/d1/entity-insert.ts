// The triggers that fire when a row is inserted into entities, in Postgres order, shared by every write path that
// inserts one (save_entity, the approval chain's records, load_sample_data, the deal room):
//   BEFORE  entities_code (assign_entity_code) → entities_dept_rules (entity_dept_rules + dept_derive) →
//           entities_purchase_figures (purchase_figures)
//   AFTER   create_project_stages (project_stage_init_trigger) → entities_stock_effect (entity_stock_effect, which calls
//           post_stock_movement) → entities_take_item_files (entity_takes_item_files)
// What differs between the callers is injected: where a running code comes from (the counter now, numbers planned in
// memory, or one taken inside the batch for another company), whose member_role the approval-status rule asks, and
// which rows a stock movement sees (rows planned earlier in the same call, or the database).
import { approvalStatuses, derive } from "../dept-rules";
import { canWriteDept } from "./access";
import { fail, now, pgLen, pgNum, pgRound, pgText, pgTrim, pgUuid, projectStageRows, type Data } from "./common";
import type { Stmt } from "./driver";
import type { Tenant } from "./tenant";

/** code_prefix(): running document codes. */
export const codePrefix: Record<string, string> = {
  customers: "CUS",
  suppliers: "SUP",
  quotations: "QT",
  sales_orders: "SO",
  bills: "AP",
  stock_issues: "WD",
  purchases: "PO",
  expenses: "EXP",
  leaves: "LV",
  marketing_budget: "MB",
  event_budget: "EB",
};
/** coalesce(x,'') ~ '^[0-9a-f-]{36}$' — what the triggers take for an ingestion id. */
export const UUIDISH = /^[0-9a-f-]{36}$/;

/** A batch being planned: the statements, in order. */
export type Plan = { stmts: Stmt[]; after: (() => Promise<void>)[] };
export type EntityRow = { id: string; kind: string; department: string; data: Data; archived_at: string | null; version: number };
type Cached = EntityRow & { planned: boolean; guarded?: boolean };

/**
 * The company's entities as one call sees them: rows planned earlier in the call (inserted or moved in this batch),
 * then the database. A stock movement on a database row guards its version once, so a concurrent change aborts.
 */
export class EntityRows {
  private rows = new Map<string, Cached | null>();
  constructor(private t: Tenant) {}
  async get(id: string): Promise<Cached | null> {
    if (!this.rows.has(id)) {
      const [e] = await this.t.selectInternal<EntityRow>("entities", { where: { id } });
      this.rows.set(id, e ? { ...e, planned: false } : null);
    }
    return this.rows.get(id)!;
  }
  /** A row this batch inserts. */
  plan(row: EntityRow) {
    this.rows.set(row.id, { ...row, planned: true });
  }
}

/** post_stock_movement(): stock in / out on a product, refusing to go below zero. */
export async function stockMove(t: Tenant, plan: { stmts: Stmt[] }, productId: string | null, type: "in" | "out", q: number, reference: string, notes: string, rows = new EntityRows(t), stamp = now()) {
  if (!canWriteDept(t.viewer, "Warehouse")) fail("ไม่มีสิทธิ์คลังสินค้า", 403);
  const p = productId === null ? null : await rows.get(productId);
  if (!p || p.kind !== "products" || p.archived_at) return fail("ไม่พบสินค้า", 404);
  if (q <= 0 || q >= 1e9 || pgLen(pgTrim(reference)) < 1 || pgLen(pgTrim(reference)) > 200) fail("รายการรับ–จ่ายไม่ถูกต้อง");
  const next = (pgNum(p.data.stock) ?? 0) + (type === "in" ? q : -q);
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

export type InsertHooks = {
  /** take_code(): the next code of a prefix; null = the caller numbers the row inside the batch (Tenant.nextNumberIntoStmts). */
  takeCode: (prefix: string) => Promise<string | null>;
  /** The doc_code of an ingestion of the row's company (the code the item was given when it was sent). */
  docCode: (ingestionId: string) => Promise<string | null>;
  /** member_role() for entity_dept_rules, or null when the rule does not apply (auth.uid() is null, or not a member). */
  approverRole: () => Promise<string | null> | string | null;
};

/**
 * The BEFORE INSERT triggers on a new record's data. Returns the data to insert and, when the code is to be taken in
 * the batch, its prefix.
 */
export async function beforeEntityInsert(kind: string, input: Data, h: InsertHooks): Promise<{ data: Data; deferredCode: string | null }> {
  let d: Data = { ...input },
    deferredCode: string | null = null;
  // entities_code
  const prefix = codePrefix[kind];
  if (prefix) {
    if ((pgText(d.code) ?? "") === "") {
      let c: string | null = null;
      const ing = pgText(d.ingestionId) ?? "";
      if (UUIDISH.test(ing)) c = await h.docCode(pgUuid(ing)!);
      if (c === null) c = await h.takeCode(prefix);
      if (c === null) deferredCode = prefix;
      else d = { ...d, code: c };
    }
    if (kind === "purchases" && (pgText(d.poNumber) ?? "") === "") {
      if (deferredCode) throw new Error("a purchase needs its code before the insert");
      d = { ...d, poNumber: pgText(d.code) };
    }
  }
  // entities_dept_rules
  const s = pgText(d.status);
  if (s !== null && approvalStatuses[kind]?.includes(s)) {
    const role = await h.approverRole();
    if (role !== null && !["owner", "manager"].includes(role)) fail("ต้องให้ Owner หรือ Manager เป็นผู้อนุมัติสถานะนี้", 403);
  }
  d = { ...d, ...derive(kind, d) };
  // entities_purchase_figures
  if (kind === "purchases") d = purchaseFigures(d);
  return { data: d, deferredCode };
}

/** purchase_figures(): a purchase with item lines totals them (lines without qty count nothing); else it needs product and quantity. */
export function purchaseFigures(d: Data): Data {
  const lines = Array.isArray(d.lines) ? (d.lines as Data[]) : [];
  if (lines.length)
    return {
      ...d,
      total: lines.reduce((sum, x) => {
        const q = pgNum(x.qty);
        return q === null ? sum : sum + q * (pgNum(x.price) ?? 0);
      }, 0),
    };
  if ((pgText(d.productId) ?? "") === "" || typeof d.quantity !== "number") fail("ใส่รายการสินค้า หรือ สินค้า จำนวน และราคาต่อหน่วย");
  return d;
}

/** project_stage_init_trigger → init_project_stages(): the stage rows of a project inserted in this batch (on conflict do nothing). */
export const projectStageStmts = (t: Tenant, projectId: string): Stmt[] => projectStageRows(projectId).map((r) => t.upsertStmt("project_stages", r, ["project_id", "key"], []));

/**
 * entities_stock_effect (AFTER INSERT, and AFTER UPDATE when the status changed): an issued stock_issue takes the
 * quantity out, an adjusted stock_count moves the difference. `oldStatus` is null for an insert.
 */
export async function stockEffect(t: Tenant, plan: { stmts: Stmt[] }, id: string, kind: string, d: Data, oldStatus: string | null, rows = new EntityRows(t), stamp = now()) {
  const s = pgText(d.status);
  if (kind === "stock_issues" && s === "จ่ายของแล้ว" && oldStatus !== s) {
    const q = pgRound(pgNum(d.quantity) ?? 0);
    if (q > 0) await stockMove(t, plan, pgUuid(pgText(d.productId)), "out", q, "stock_issues:" + id, pgText(d.name) ?? "", rows, stamp);
  } else if (kind === "stock_counts" && s === "ปรับยอดแล้ว" && oldStatus !== s) {
    const pid = pgUuid(pgText(d.productId));
    const p = pid === null ? null : await rows.get(pid);
    const cur = p && p.kind === "products" ? (pgNum(p.data.stock) ?? 0) : 0;
    const q = pgRound((pgNum(d.countedQty) ?? 0) - cur);
    if (q !== 0) await stockMove(t, plan, pid, q > 0 ? "in" : "out", Math.abs(q), "stock_counts:" + id, "ปรับยอดจากการตรวจนับ", rows, stamp);
  }
}

/** entities_take_item_files: the files sent with the item move onto the new record. */
export function takeItemFiles(t: Tenant, id: string, d: Data): Stmt[] {
  const ing = pgText(d.ingestionId) ?? "";
  return UUIDISH.test(ing) ? [t.updateStmt("attachments", { ingestion_id: pgUuid(ing), entity_id: null }, { entity_id: id })] : [];
}

/** The AFTER INSERT triggers of a record of this company (inserted earlier in `plan`), in Postgres order. */
export async function afterEntityInsert(t: Tenant, plan: { stmts: Stmt[] }, id: string, kind: string, d: Data, rows?: EntityRows, stamp?: string) {
  if (kind === "projects") plan.stmts.push(...projectStageStmts(t, id));
  await stockEffect(t, plan, id, kind, d, null, rows, stamp);
  plan.stmts.push(...takeItemFiles(t, id, d));
}
