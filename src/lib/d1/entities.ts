// save_entity / archive_entity / recalculate_invoice for D1, step for step after the Postgres functions (schema.sql)
// and the triggers that fire on entities, in Postgres order: BEFORE entities_code → entities_dept_rules →
// entities_keep_source → entities_purchase_figures; AFTER create_project_stages → entities_stock_effect →
// entities_take_item_files. The insert triggers and post_stock_movement are shared (entity-insert.ts), the payload is
// checked by the one validate_payload (validate.ts) against entity_schemas, like Postgres.
// Postgres locked the rows it read (FOR UPDATE); here every save is one batch guarded on the versions it read, so a
// concurrent change aborts it with ConflictError instead of overwriting.
import { randomUUID } from "node:crypto";
import { entityDepartment, formatCode, thaiYear } from "../domain";
import { approvalStatuses, derive } from "../dept-rules";
import { canWriteDept } from "./access";
import { fail, now, pgText } from "./common";
import { afterEntityInsert, beforeEntityInsert, codePrefix, purchaseFigures, stockEffect, type Plan } from "./entity-insert";
import { entitySchema, validatePayload } from "./validate";
import type { Tenant } from "./tenant";
import type { Entity } from "../types";

export { codePrefix, stockMove, type Plan } from "./entity-insert";
type Data = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const SOURCE_KEYS = ["ingestionId", "sourceVia", "sourceGroup", "sourceDepartment", "sourceSender"];

/** validate_payload(kind, p, company) for a save by this tenant: relations must be live records of the company. */
export async function validateFor(t: Tenant, kind: string, p: unknown): Promise<Data> {
  const schema = await entitySchema(t, kind);
  return validatePayload(schema?.fields, p, async (id, k) => (await t.selectInternal("entities", { where: { id, kind: k, archived_at: null }, limit: 1 })).length > 0);
}

/** recalculate_invoice(): paid amount and status from the income payments still standing. */
async function recalcInvoice(t: Tenant, plan: Plan, invoiceId: string, change?: { id: string; amount: number | null; standing: boolean }) {
  const [inv] = await t.selectInternal<Entity>("entities", { where: { id: invoiceId, kind: "invoices" } });
  if (!inv) fail("ไม่พบใบแจ้งหนี้", 404);
  const payments = (await t.selectInternal<Entity>("entities", { where: { kind: "payments", archived_at: null } })).filter((p) => p.data.invoiceId === invoiceId && p.data.direction === "income" && p.id !== change?.id);
  let amount = payments.reduce((s, p) => s + Number(p.data.amount || 0), 0);
  if (change?.standing) amount += Number(change.amount || 0);
  const total = Number(inv.data.total || 0);
  if (amount > total) fail("รับชำระเกินยอดใบแจ้งหนี้");
  const status = amount >= total ? "paid" : amount > 0 ? "partial" : "issued";
  plan.stmts.push(t.guardStmt("entities", { id: inv.id, version: inv.version }), t.updateStmt("entities", { id: inv.id }, { data: { ...inv.data, paid: amount, status }, version: inv.version + 1, updated_at: now() }));
}

/** save_entity(): create (no id) or update (id + the version the person loaded). */
export async function saveEntity(t: Tenant, kind: string, input: Data, id?: string, version?: number): Promise<Entity> {
  const v = t.viewer,
    role = v.role;
  let clean = await validateFor(t, kind, input);
  const d = entityDepartment(kind, clean);
  if (!canWriteDept(v, d)) fail("ไม่มีสิทธิ์แก้ไขแผนกนี้", 403);
  let old: Entity | undefined;
  if (id) {
    [old] = await t.selectInternal<Entity>("entities", { where: { id, kind } });
    if (!old || !canWriteDept(v, old.department)) fail("ไม่พบรายการ", 404);
    if (old!.version !== version) fail("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่", 409);
    if (old!.archived_at) fail("รายการนี้เก็บเข้าคลังแล้ว", 409);
  }
  const od = old?.data || {};
  const st = clean.status as string | undefined;
  if (["approved", "paid"].includes(String(st)) && ["deals", "expenses", "leaves", "payroll"].includes(kind) && (!id || od.status !== st) && !["owner", "manager"].includes(role))
    fail("ต้องให้ผู้มีสิทธิ์อนุมัติ", 403);
  if (kind === "deals" && st === "approved" && (!id || od.status !== "approved")) fail("ใช้คำสั่งอนุมัติดีลเพื่อสร้าง Workflow");
  if (kind === "products") clean = { ...clean, stock: Number(od.stock || 0) };
  if (kind === "purchases") {
    if (od.status === "received") fail("ใบสั่งซื้อที่รับแล้วแก้ไขไม่ได้", 409);
    const q = num(clean.quantity);
    if (q !== null && q !== Math.trunc(q)) fail("จำนวนต้องเป็นจำนวนเต็ม");
    const unit = num(clean.unitCost);
    clean = { ...clean, total: q === null || unit === null ? null : q * unit, status: "draft" };
  }
  if (kind === "invoices") {
    if (Number(clean.vat) > 100) fail("VAT ไม่ถูกต้อง");
    const total = r2(Number(clean.subtotal) * (1 + Number(clean.vat) / 100)),
      paid = Number(od.paid || 0);
    if (total < paid) fail("ยอดใบแจ้งหนี้ต่ำกว่ายอดรับชำระ");
    clean = { ...clean, total, paid, status: paid >= total ? "paid" : paid > 0 ? "partial" : "issued" };
  }
  if (kind === "payroll") {
    const net = Number(clean.base) + Number(clean.allowance || 0) - Number(clean.deduction || 0);
    if (net < 0) fail("ค่าจ้างสุทธิติดลบ");
    clean = { ...clean, net };
  }
  if (kind === "payments" && id) fail("รายการชำระเงินแก้ไขไม่ได้ ใช้เก็บเข้าคลังเพื่อยกเลิก");

  // BEFORE triggers.
  const plan: Plan = { stmts: [], after: [] };
  const rowId = id || randomUUID(),
    stamp = now();
  if (!old) {
    clean = (
      await beforeEntityInsert(kind, clean, {
        takeCode: async (p) => formatCode(p, thaiYear(), await t.nextNumber(p, 0)),
        docCode: async (ing) => (await t.selectInternal<{ doc_code: string | null }>("ingestions", { where: { id: ing } }))[0]?.doc_code ?? null,
        approverRole: () => role,
      })
    ).data;
    plan.stmts.push(t.insertStmt("entities", { id: rowId, kind, department: d, data: clean, created_by: v.userId }));
    await afterEntityInsert(t, plan, rowId, kind, clean);
  } else {
    // entities_code keeps the code; entities_dept_rules; entities_keep_source; entities_purchase_figures.
    const prefix = codePrefix[kind];
    if (prefix && (pgText(clean.code) ?? "") === "" && (pgText(od.code) ?? "") !== "") clean = { ...clean, code: od.code };
    if (prefix && kind === "purchases" && (pgText(clean.poNumber) ?? "") === "") clean = { ...clean, poNumber: pgText(clean.code) };
    if (approvalStatuses[kind]?.includes(String(st)) && od.status !== st && !["owner", "manager"].includes(role)) fail("ต้องให้ Owner หรือ Manager เป็นผู้อนุมัติสถานะนี้", 403);
    if (
      ((kind === "stock_issues" && od.status === "จ่ายของแล้ว") || (kind === "stock_counts" && od.status === "ปรับยอดแล้ว")) &&
      ["productId", "quantity", "countedQty"].some((k) => JSON.stringify(clean[k] ?? null) !== JSON.stringify(od[k] ?? null))
    )
      fail("ปรับสต็อกไปแล้ว แก้จำนวนไม่ได้");
    clean = { ...clean, ...derive(kind, clean) };
    for (const k of SOURCE_KEYS) if (k in od && !(k in clean)) clean = { [k]: od[k], ...clean };
    if (kind === "purchases") clean = purchaseFigures(clean);
    // The write itself, then the AFTER UPDATE trigger, audit and invoice, all in one batch.
    plan.stmts.push(t.guardStmt("entities", { id: old.id, version: old.version }), t.updateStmt("entities", { id: old.id }, { data: clean, department: d, version: old.version + 1, updated_at: stamp }));
    await stockEffect(t, plan, rowId, kind, clean, pgText(od.status));
  }
  plan.stmts.push(t.insertStmt("audit_events", { actor: v.userId, action: old ? "updated" : "created", target: rowId }));
  if (kind === "payments" && typeof clean.invoiceId === "string") await recalcInvoice(t, plan, clean.invoiceId, { id: rowId, amount: num(clean.amount), standing: clean.direction === "income" });
  await t.atomic(plan.stmts);
  const [saved] = await t.selectInternal<Entity>("entities", { where: { id: rowId } });
  return saved;
}

/** archive_entity(): owners and managers move a record to the archive (or back). */
export async function archiveEntity(t: Tenant, id: string, archive: boolean): Promise<void> {
  const [r] = await t.selectInternal<Entity>("entities", { where: { id } });
  if (!r || !canWriteDept(t.viewer, r.department) || !["owner", "manager"].includes(t.viewer.role)) fail("ไม่มีสิทธิ์เก็บเข้าคลัง", 403);
  if (r.kind === "purchases" && r.data.status === "received") fail("ใบสั่งซื้อรับแล้วเก็บเข้าคลังไม่ได้");
  if (r.kind === "products" && Number(r.data.stock || 0) !== 0) fail("ต้องทำยอดสต็อกเป็นศูนย์ก่อนเก็บสินค้า");
  const plan: Plan = { stmts: [t.guardStmt("entities", { id: r.id, version: r.version }), t.updateStmt("entities", { id: r.id }, { archived_at: archive ? now() : null, version: r.version + 1, updated_at: now() }), t.insertStmt("audit_events", { actor: t.viewer.userId, action: archive ? "archived" : "restored", target: r.id })], after: [] };
  if (r.kind === "payments" && typeof r.data.invoiceId === "string") await recalcInvoice(t, plan, r.data.invoiceId, { id: r.id, amount: num(r.data.amount), standing: !archive && r.data.direction === "income" });
  await t.atomic(plan.stmts);
}
