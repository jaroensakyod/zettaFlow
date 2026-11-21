// purchase_action / transfer_project_stock / update_project_stage for D1, step for step after the Postgres functions
// (schema.sql), including the entities triggers their updates fire (purchase total, derived fields). Rows Postgres
// locked (FOR UPDATE) are guarded on what was read, so a concurrent change aborts the batch with ConflictError.
import { randomUUID } from "node:crypto";
import { derive } from "../dept-rules";
import { canReadDept, canWriteDept } from "./access";
import { stockMove, type Plan } from "./entity-insert";
import { fail, now } from "./common";
import type { Tenant } from "./tenant";
import type { Entity } from "../types";

type Data = Record<string, unknown>;
const isManager = (t: Tenant) => ["owner", "manager"].includes(t.viewer.role);
const audit = (t: Tenant, action: string, target: string) => t.insertStmt("audit_events", { actor: t.viewer.userId, action, target });

/** The BEFORE update triggers on entities that matter once a record exists: derived fields, purchase total. */
function retrigger(kind: string, data: Data): Data {
  let d = { ...data, ...derive(kind, data) };
  if (kind === "purchases") {
    const lines = Array.isArray(d.lines) ? (d.lines as Data[]) : [];
    if (lines.length) d = { ...d, total: lines.reduce((s, x) => s + Number(x.qty) * Number(x.price || 0), 0) };
    else if (!d.productId || typeof d.quantity !== "number") fail("ใส่รายการสินค้า หรือ สินค้า จำนวน และราคาต่อหน่วย");
  }
  return d;
}

export type PurchaseAction = "approve" | "receive" | "request_vendor" | "vendor_confirm" | "dispatch" | "deliver" | "cancel";

/** purchase_action(): a purchase order moves along draft → approved → (vendor steps) → received, or is cancelled. */
export async function purchaseAction(t: Tenant, id: string, action: string): Promise<void> {
  if (!canWriteDept(t.viewer, "Purchasing")) fail("ไม่มีสิทธิ์จัดซื้อ", 403);
  const [r] = await t.selectInternal<Entity>("entities", { where: { id, kind: "purchases", archived_at: null } });
  if (!r) fail("ไม่พบใบขอซื้อ", 404);
  const plan: Plan = { stmts: [t.guardStmt("entities", { id: r.id, version: r.version })], after: [] };
  let data: Data = { ...r.data };
  const status = String(data.status ?? "");
  let next: string;
  if (action === "approve") {
    if (!isManager(t) || status !== "draft") fail("ไม่มีสิทธิ์ หรือรายการนี้อนุมัติแล้ว", 403);
    next = "approved";
    data = { ...data, poNumber: (data.poNumber as string) || (data.code as string) || "PO-" + r.id.replace(/-/g, "").slice(0, 12).toUpperCase() };
  } else if (action === "receive") {
    if (!canWriteDept(t.viewer, "Warehouse") || !["approved", "pending_vendor", "in_progress", "pending_delivery", "delivered"].includes(status)) fail("ต้องอนุมัติก่อนรับ หรือรับสินค้าไปแล้ว");
    if (typeof data.productId === "string" && data.productId !== "" && typeof data.quantity === "number")
      await stockMove(t, plan, data.productId, "in", Math.round(data.quantity), "PO:" + id, "รับตามใบสั่งซื้อ");
    next = "received";
  } else if (action === "request_vendor" && status === "approved") next = "pending_vendor";
  else if (action === "vendor_confirm" && status === "pending_vendor") next = "in_progress";
  else if (action === "dispatch" && status === "in_progress") next = "pending_delivery";
  else if (action === "deliver" && status === "pending_delivery") next = "delivered";
  else if (action === "cancel" && !["received", "cancelled"].includes(status)) {
    if (status !== "draft" && !isManager(t)) fail("ให้หัวหน้างานยกเลิกใบสั่งซื้อที่อนุมัติแล้ว", 403);
    next = "cancelled";
  } else return fail("ขั้นตอนนี้ไม่สอดคล้องกับสถานะปัจจุบัน");
  data = retrigger("purchases", { ...data, status: next! });
  plan.stmts.push(t.updateStmt("entities", { id: r.id }, { data, version: r.version + 1, updated_at: now() }), audit(t, "purchase_" + action, id));
  await t.atomic(plan.stmts);
}

export type StockTransfer = { id: string; company_id: string; product_id: string; from_project: string | null; to_project: string | null; quantity: number; reason: string; reference: string; created_by: string | null; created_name: string; created_at: string };

/** transfer_project_stock(): move stock between the central warehouse (null) and projects, or project to project. */
export async function transferProjectStock(t: Tenant, productId: string, fromProject: string | null | undefined, toProject: string | null | undefined, quantity: number, reference: string, reason: string): Promise<StockTransfer> {
  const v = t.viewer,
    from = fromProject || null,
    to = toProject || null;
  if (!canWriteDept(v, "Warehouse")) fail("ไม่มีสิทธิ์โอนสินค้า", 403);
  const ref = (reference ?? "").trim(),
    why = (reason ?? "").trim();
  if (!Number.isInteger(quantity) || quantity <= 0 || from === to || ref.length < 1 || ref.length > 200 || why.length < 1 || why.length > 4000) fail("ข้อมูลการโอนไม่ถูกต้อง");
  const [p] = await t.selectInternal<Entity>("entities", { where: { id: productId, kind: "products", archived_at: null } });
  if (!p) fail("ไม่พบสินค้า", 404);
  const project = async (id: string, message: string) => {
    const [x] = await t.selectInternal<Entity>("entities", { where: { id, kind: "projects", archived_at: null } });
    if (!x || !canReadDept(v, x.department)) fail(message, 403);
  };
  if (from) await project(from, "ไม่มีสิทธิ์โครงการต้นทาง");
  if (to) await project(to, "ไม่มีสิทธิ์โครงการปลายทาง");
  if ((await t.selectInternal("stock_transfers", { where: { reference }, limit: 1 })).length) fail("รายการโอนนี้บันทึกแล้ว", 409);

  const plan: Plan = { stmts: [t.guardStmt("entities", { id: p.id, version: p.version })], after: [] };
  if (!from) {
    if (Number(p.data.stock || 0) < quantity) fail("สต็อกคลังกลางไม่เพียงพอ");
    await stockMove(t, plan, productId, "out", quantity, `TRANSFER:${reference}:out`, reason);
  } else {
    const [row] = await t.selectInternal<{ quantity: number }>("project_inventory", { where: { product_id: productId, project_id: from } });
    const have = Number(row?.quantity || 0);
    if (have < quantity) fail("สต็อกโครงการไม่เพียงพอ");
    plan.stmts.push(
      t.guardStmt("project_inventory", { product_id: productId, project_id: from, quantity: have }),
      t.updateStmt("project_inventory", { product_id: productId, project_id: from }, { quantity: have - quantity, updated_at: now() }),
    );
  }
  if (!to) await stockMove(t, plan, productId, "in", quantity, `TRANSFER:${reference}:in`, reason);
  else {
    const [row] = await t.selectInternal<{ quantity: number }>("project_inventory", { where: { product_id: productId, project_id: to } });
    if (row)
      plan.stmts.push(
        t.guardStmt("project_inventory", { product_id: productId, project_id: to, quantity: row.quantity }),
        t.updateStmt("project_inventory", { product_id: productId, project_id: to }, { quantity: Number(row.quantity) + quantity, updated_at: now() }),
      );
    else plan.stmts.push(t.insertStmt("project_inventory", { product_id: productId, project_id: to, quantity }));
  }
  const [member] = await t.selectInternal<{ name: string | null; disabled: boolean }>("memberships", { where: { user_id: v.userId } });
  const transferId = randomUUID();
  plan.stmts.push(
    t.insertStmt("stock_transfers", { id: transferId, product_id: productId, from_project: from, to_project: to, quantity, reference, reason, created_by: v.userId, created_name: member && !member.disabled ? member.name || "" : "" }),
    audit(t, "stock_transfer", transferId),
  );
  await t.atomic(plan.stmts);
  const [saved] = await t.selectInternal<StockTransfer>("stock_transfers", { where: { id: transferId } });
  return saved;
}

export type ProjectStage = { company_id: string; project_id: string; key: string; ordinal: number; department: string; label: string; english: string; status: string; version: number; started_at: string | null; completed_at: string | null; updated_at: string; updated_by: string | null };
const STAGE_STATUSES = ["pending", "progress", "review", "done"];
const SIGN_OFF = ["contract", "payment", "layout", "close"];

/** update_project_stage(): a department moves its stage of a project; sign-off stages need an owner or manager. */
export async function updateProjectStage(t: Tenant, projectId: string, key: string, status: string, version: number | null): Promise<ProjectStage> {
  const v = t.viewer;
  const [p] = await t.selectInternal<Entity>("entities", { where: { id: projectId, kind: "projects", archived_at: null } });
  if (!p || !canReadDept(v, p.department)) fail("ไม่พบโครงการ", 404);
  const stages = await t.selectInternal<ProjectStage>("project_stages", { where: { project_id: projectId } });
  const r = stages.find((s) => s.key === key);
  if (!r || !canWriteDept(v, r.department)) fail("ไม่มีสิทธิ์แก้ไขขั้นตอนนี้", 403);
  if (version === null || version === undefined || r!.version !== version) fail("ขั้นตอนนี้เปลี่ยนแล้ว กรุณารีเฟรช", 409);
  if (!STAGE_STATUSES.includes(status)) fail("สถานะไม่ถูกต้อง");
  if (status === "done" && SIGN_OFF.includes(key) && !isManager(t)) fail("ต้องให้ผู้มีสิทธิ์อนุมัติ", 403);
  if (key === "close" && status === "done" && stages.some((s) => s.key !== "close" && s.status !== "done")) fail("ทำขั้นตอนก่อนหน้าให้เสร็จก่อนปิดโครงการ");
  if (key === "layout" && status === "done") {
    const layouts = await t.selectInternal<{ version: number; status: string }>("design_revisions", { where: { project_id: projectId, category: "layout" } });
    const latest = Math.max(...layouts.map((d) => d.version));
    if (layouts.some((d) => d.version === latest && d.status !== "approved")) fail("แบบเวอร์ชันล่าสุดยังไม่ได้อนุมัติ");
  }
  const stamp = now();
  const plan: Plan = {
    stmts: [
      t.guardStmt("entities", { id: p.id, version: p.version }),
      t.guardStmt("project_stages", { project_id: projectId, key, version: r!.version }),
      t.updateStmt(
        "project_stages",
        { project_id: projectId, key },
        {
          status,
          version: r!.version + 1,
          started_at: ["progress", "review", "done"].includes(status) ? r!.started_at || stamp : r!.started_at,
          completed_at: status === "done" ? stamp : null,
          updated_at: stamp,
          updated_by: v.userId,
        },
      ),
      t.insertStmt("project_stage_history", { project_id: projectId, key, department: r!.department, status, actor: v.userId }),
    ],
    after: [],
  };
  if (key === "close" && status === "done") plan.stmts.push(t.updateStmt("entities", { id: p.id }, { data: retrigger("projects", { ...p.data, status: "completed" }), version: p.version + 1, updated_at: stamp }));
  plan.stmts.push(audit(t, `project_stage_${key}_${status}`, projectId));
  await t.atomic(plan.stmts);
  const [saved] = await t.selectInternal<ProjectStage>("project_stages", { where: { project_id: projectId, key } });
  return saved;
}
