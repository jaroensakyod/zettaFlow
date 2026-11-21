// save_entity / archive_entity / recalculate_invoice for D1, step for step after the Postgres functions (schema.sql)
// and the triggers that fire on entities, in Postgres order: BEFORE entities_code → entities_dept_rules →
// entities_keep_source → entities_purchase_figures; AFTER create_project_stages → entities_stock_effect →
// entities_take_item_files. Rules already written in TypeScript for demo mode are reused (derive, approvalStatuses).
// Postgres locked the rows it read (FOR UPDATE); here every save is one batch guarded on the versions it read, so a
// concurrent change aborts it with ConflictError instead of overwriting.
import { randomUUID } from "node:crypto";
import { AppError, entityDepartment, thaiYear } from "../domain";
import { catalog } from "../catalog";
import { approvalStatuses, derive } from "../dept-rules";
import type { Stmt } from "./driver";
import { canWriteDept } from "./access";
import type { Tenant } from "./tenant";
import type { Entity } from "../types";

type Data = Record<string, unknown>;
const fail = (message: string, status = 400): never => {
  throw new AppError(message, status);
};
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const now = () => new Date().toISOString();

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
const formatCode = (p: string, n: number) => `${p}-${String(thaiYear()).padStart(2, "0")}-${String(n).padStart(4, "0")}`;
const SOURCE_KEYS = ["ingestionId", "sourceVia", "sourceGroup", "sourceDepartment", "sourceSender"];
const UUID = /^[0-9a-f-]{36}$/;

/** validate_payload(): only the page's fields, required ones present, item lines normalised, links inside the company. */
async function validatePayload(t: Tenant, kind: string, p: Data): Promise<Data> {
  const spec = catalog[kind];
  if (!spec) fail("ไม่พบโมดูล", 404);
  const out: Data = {};
  for (const f of spec.fields) {
    let v = p[f.key];
    if (v === undefined || v === null || v === "") {
      if (f.required) fail(`ข้อมูลไม่ครบ: ${f.label}`);
      continue;
    }
    if (f.type === "lines") {
      const str = (x: unknown, max: number) => x === undefined || x === null || (typeof x === "string" && x.length <= max);
      const okLine = (x: Data) =>
        x !== null &&
        typeof x === "object" &&
        !Array.isArray(x) &&
        typeof x.name === "string" &&
        x.name.length >= 1 &&
        x.name.length <= 500 &&
        typeof x.qty === "number" &&
        x.qty >= 0 &&
        x.qty <= 1e9 &&
        typeof x.price === "number" &&
        Math.abs(x.price) <= 1e12 &&
        str(x.category, 100) &&
        str(x.unit, 30) &&
        str(x.currency, 3) &&
        (x.discount === undefined || x.discount === null || (typeof x.discount === "number" && x.discount >= 0 && x.discount <= 1e12)) &&
        (x.discountType === undefined || x.discountType === null || x.discountType === "percent" || x.discountType === "amount");
      if (!Array.isArray(v) || v.length > 100 || !(v as Data[]).every(okLine)) fail("รายการสินค้าไม่ถูกต้อง");
      v = (v as Data[]).map((x) => Object.fromEntries(["name", "qty", "price", "category", "unit", "currency", "discount", "discountType"].filter((k) => x[k] !== undefined && x[k] !== null).map((k) => [k, x[k]])));
    } else if (f.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) fail("รูปแบบตัวเลขไม่ถูกต้อง");
      if (Math.abs(v as number) > 1e12 || (f.min !== undefined && (v as number) < f.min)) fail("จำนวนไม่ถูกต้อง");
    } else if (f.type !== "people") {
      if (typeof v !== "string" || v.length > 10000) fail("รูปแบบข้อความไม่ถูกต้อง");
      if (f.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(v as string) || Number.isNaN(Date.parse(v as string)) || new Date(v as string).toISOString().slice(0, 10) !== v)) fail("วันที่ไม่ถูกต้อง");
      if (f.type === "select" && !f.options?.includes(v as string)) fail("ตัวเลือกไม่ถูกต้อง");
      if (f.type === "relation") {
        const ok = UUID.test(v as string) && (await t.selectInternal("entities", { where: { id: v as string, kind: f.resource || "", archived_at: null }, limit: 1 })).length;
        if (!ok) fail("ข้อมูลอ้างอิงไม่อยู่ในบริษัทนี้");
      }
    }
    out[f.key] = v;
  }
  if (out.startDate && out.endDate && String(out.startDate) > String(out.endDate)) fail("ช่วงวันที่ไม่ถูกต้อง");
  return out;
}

export type Plan = { stmts: Stmt[]; after: (() => Promise<void>)[] };
/** post_stock_movement(): stock in / out on a product, refusing to go below zero. */
export async function stockMove(t: Tenant, plan: Plan, productId: string, type: "in" | "out", q: number, reference: string, notes: string) {
  if (!canWriteDept(t.viewer, "Warehouse")) fail("ไม่มีสิทธิ์คลังสินค้า", 403);
  const [product] = await t.selectInternal<Entity>("entities", { where: { id: productId, kind: "products", archived_at: null } });
  if (!product) fail("ไม่พบสินค้า", 404);
  if (q <= 0 || q >= 1e9 || !reference.trim() || reference.length > 200) fail("รายการรับ–จ่ายไม่ถูกต้อง");
  const next = Number(product.data.stock || 0) + (type === "in" ? q : -q);
  if (next < 0) fail("สินค้าไม่พอ");
  plan.stmts.push(
    t.guardStmt("entities", { id: product.id, version: product.version }),
    t.insertStmt("stock_movements", { product_id: product.id, type, quantity: q, reference, notes, created_by: t.viewer.userId }),
    t.updateStmt("entities", { id: product.id }, { data: { ...product.data, stock: next }, version: product.version + 1, updated_at: now() }),
    t.insertStmt("audit_events", { actor: t.viewer.userId, action: "stock_" + type, target: product.id }),
  );
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
  let clean = await validatePayload(t, kind, input);
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
  const prefix = codePrefix[kind];
  if (prefix && !clean.code) {
    if (old && od.code) clean = { ...clean, code: od.code };
    else {
      let code: string | null = null;
      if (!old && typeof clean.ingestionId === "string" && UUID.test(clean.ingestionId))
        code = ((await t.selectInternal<{ doc_code: string | null }>("ingestions", { where: { id: clean.ingestionId } }))[0]?.doc_code as string) || null;
      clean = { ...clean, code: code || formatCode(prefix, await t.nextNumber(prefix, 0)) };
    }
  }
  if (prefix && kind === "purchases" && !clean.poNumber) clean = { ...clean, poNumber: clean.code };
  if (approvalStatuses[kind]?.includes(String(st)) && (!old || od.status !== st) && !["owner", "manager"].includes(role)) fail("ต้องให้ Owner หรือ Manager เป็นผู้อนุมัติสถานะนี้", 403);
  if (
    old &&
    ((kind === "stock_issues" && od.status === "จ่ายของแล้ว") || (kind === "stock_counts" && od.status === "ปรับยอดแล้ว")) &&
    ["productId", "quantity", "countedQty"].some((k) => JSON.stringify(clean[k] ?? null) !== JSON.stringify(od[k] ?? null))
  )
    fail("ปรับสต็อกไปแล้ว แก้จำนวนไม่ได้");
  clean = { ...clean, ...derive(kind, clean) };
  if (old) for (const k of SOURCE_KEYS) if (k in od && !(k in clean)) clean = { [k]: od[k], ...clean };
  if (kind === "purchases") {
    const lines = Array.isArray(clean.lines) ? (clean.lines as Data[]) : [];
    if (lines.length) clean = { ...clean, total: lines.reduce((s, x) => s + Number(x.qty) * Number(x.price || 0), 0) };
    else if (!clean.productId || typeof clean.quantity !== "number") fail("ใส่รายการสินค้า หรือ สินค้า จำนวน และราคาต่อหน่วย");
  }

  // The write itself, then AFTER triggers, audit and invoice, all in one batch.
  const plan: Plan = { stmts: [], after: [] };
  const rowId = id || randomUUID(),
    stamp = now();
  if (old) plan.stmts.push(t.guardStmt("entities", { id: old.id, version: old.version }), t.updateStmt("entities", { id: old.id }, { data: clean, department: d, version: old.version + 1, updated_at: stamp }));
  else plan.stmts.push(t.insertStmt("entities", { id: rowId, kind, department: d, data: clean, created_by: v.userId }));
  if (!old && kind === "projects")
    for (const [key, ordinal, department, label, english] of projectStages)
      plan.stmts.push(t.insertStmt("project_stages", { project_id: rowId, key, ordinal, department, label, english }));
  const s = clean.status,
    os = od.status;
  if (kind === "stock_issues" && s === "จ่ายของแล้ว" && os !== s) {
    const q = Math.round(Number(clean.quantity || 0));
    if (q > 0) await stockMove(t, plan, String(clean.productId), "out", q, "stock_issues:" + rowId, String(clean.name || ""));
  } else if (kind === "stock_counts" && s === "ปรับยอดแล้ว" && os !== s) {
    const [p] = await t.selectInternal<Entity>("entities", { where: { id: String(clean.productId), kind: "products" } });
    const q = Math.round(Number(clean.countedQty || 0) - Number(p?.data.stock || 0));
    if (q !== 0) await stockMove(t, plan, String(clean.productId), q > 0 ? "in" : "out", Math.abs(q), "stock_counts:" + rowId, "ปรับยอดจากการตรวจนับ");
  }
  if (!old && typeof clean.ingestionId === "string" && UUID.test(clean.ingestionId)) plan.stmts.push(t.updateStmt("attachments", { ingestion_id: clean.ingestionId, entity_id: null }, { entity_id: rowId }));
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

/** init_project_stages(): the ten stages every new project starts with. */
const projectStages: [string, number, string, string, string][] = [
  ["location", 0, "Business Development", "หา Location", "Location"],
  ["contract", 1, "Legal", "ทำสัญญา", "Contract"],
  ["payment", 2, "Finance", "ชำระเงิน", "Payment"],
  ["layout", 3, "Design", "เขียนแบบ", "Layout"],
  ["procurement", 4, "Purchasing", "จัดซื้อ", "Procurement"],
  ["warehouse", 5, "Warehouse", "คลังสินค้า", "Warehouse"],
  ["setup", 6, "Operations", "เตรียมงาน", "Setup"],
  ["selling", 7, "Sales", "PC ขายของ", "Selling"],
  ["summary", 8, "Marketing", "สรุปผล", "Summary"],
  ["close", 9, "Operations", "ปิดงาน", "Close"],
];
