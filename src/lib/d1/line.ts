// The LINE functions for D1, step for step after the Postgres functions (schema.sql). Everything the webhook calls
// (line_*, pair_line_group, pair_line_user) ran as the service role in Postgres: no signed-in person, the company is
// the one the LINE group is linked to. Those take the Sql and work in that company through systemTenant(). The owner's
// settings (unlink_line_group, update_line_group, set_line_group_listen, remove_line_approver) take the person's Tenant.
// Rows Postgres locked (FOR UPDATE) are guarded on what was read.
import type { Sql } from "./driver";
import type { Tenant } from "./tenant";
import type { Entity } from "../types";
import { approvalAct, approvalAmount, approvalApply, approvalPlan, createIngestionWorkflow, type Approval } from "./approvals";
import {
  arr,
  bangkokDay,
  fail,
  newCtx,
  ingestionById,
  itemFileCount,
  logAction,
  pgTrim,
  requiredFilled,
  systemTenant,
  txt,
  updateStatus,
  type Ingestion,
} from "./ingestion";
import { deptTh, enforceQuota } from "./reports";

type Data = Record<string, unknown>;
const stamp = () => new Date().toISOString();
export type LineGroup = { group_id: string; company_id: string; template_id: string | null; approve_keywords: string[]; name: string; created_at: string; department: string | null; listen: string };
type Membership = { user_id: string; name: string | null; email: string; role: string; departments: string[]; disabled: boolean };

async function group(sql: Sql, id: string): Promise<LineGroup | null> {
  return (await systemTenant(sql).selectGlobal<LineGroup>("line_groups", { where: { group_id: id } }))[0] ?? null;
}
/** The company member a LINE account is linked to (not disabled), if any. */
async function lineMember(t: Tenant, lineUser: string | null): Promise<Membership | null> {
  if (lineUser === null) return null;
  const [lu] = await t.selectInternal<{ user_id: string }>("line_users", { where: { line_user_id: lineUser } });
  if (!lu) return null;
  return (await t.selectInternal<Membership>("memberships", { where: { user_id: lu.user_id, disabled: false } }))[0] ?? null;
}
/** Only the requester, or an owner / manager linked in LINE. */
async function requesterOrManager(t: Tenant, i: Ingestion, lineUser: string, message: string) {
  if ((i.source_user ?? "") !== (lineUser ?? "")) {
    const m = await lineMember(t, lineUser);
    if (!m || !["owner", "manager"].includes(m.role)) fail(message, 403);
  }
}
const audit = (t: Tenant, actor: string | null, action: string, target: string) => t.insertStmt("audit_events", { actor, action, target });

// ---------- pairing ----------
type Pairing = { token_hash: string; company_id: string; template_id: string | null; user_id: string | null; expires_at: string; used_at: string | null; department: string | null };
async function pairing(sql: Sql, hash: string, withUser: boolean): Promise<Pairing | null> {
  const now = stamp();
  const [p] = await systemTenant(sql).selectGlobal<Pairing>("line_pairings", { where: { token_hash: hash, used_at: null, expires_at: { op: ">", value: now } } });
  return p && (p.user_id !== null) === withUser ? p : null;
}
/** pair_line_group(): the bot was added to a group and someone typed a pairing code: link the group to the company. */
export async function pairLineGroup(sql: Sql, hash: string, groupId: string): Promise<void> {
  const p = await pairing(sql, hash, false);
  if (!p) return fail("รหัสหมดอายุหรือไม่ถูกต้อง");
  const g = await group(sql, groupId);
  if (g && g.company_id !== p.company_id) fail("กลุ่มนี้เชื่อมบริษัทอื่น", 409);
  const t = systemTenant(sql, p.company_id);
  await enforceQuota(t, "line_groups", groupId);
  await t.atomic([
    t.guardGlobalStmt("line_pairings", { token_hash: hash, used_at: null }),
    g
      ? t.updateStmt("line_groups", { group_id: groupId }, { template_id: p.template_id, department: p.department ?? g.department })
      : t.insertStmt("line_groups", { group_id: groupId, template_id: p.template_id, department: p.department }),
    t.updateGlobalStmt("line_pairings", { token_hash: hash }, { used_at: stamp() }),
  ]);
}
/** pair_line_user(): a person links their LINE account to their EliteFlow login with a personal code. */
export async function pairLineUser(sql: Sql, hash: string, groupId: string, lineUser: string): Promise<void> {
  const p = await pairing(sql, hash, true);
  const g = await group(sql, groupId);
  if (!p || !g || g.company_id !== p.company_id) return fail("รหัสหรือกลุ่มไม่ถูกต้อง");
  const t = systemTenant(sql, p.company_id);
  const [had] = await t.selectInternal<{ user_id: string }>("line_users", { where: { line_user_id: lineUser } });
  if (had && had.user_id !== p.user_id) fail("LINE นี้เชื่อมบัญชีอื่น", 409);
  await t.atomic([
    t.guardGlobalStmt("line_pairings", { token_hash: hash, used_at: null }),
    t.upsertStmt("line_users", { line_user_id: lineUser, user_id: p.user_id }, ["company_id", "line_user_id"], []),
    t.updateGlobalStmt("line_pairings", { token_hash: hash }, { used_at: stamp() }),
  ]);
}

// ---------- the owner's group settings ----------
const ownerOnly = (t: Tenant) => {
  if (t.viewer.role !== "owner" || t.viewer.support) fail("เฉพาะเจ้าของบริษัท", 403);
};
/** unlink_line_group() */
export async function unlinkLineGroup(t: Tenant, groupId: string): Promise<void> {
  ownerOnly(t);
  await t.atomic([t.deleteStmt("line_groups", { group_id: groupId }), logAction(t, "line_group_unlinked", groupId)]);
}
/** update_line_group(): form, name, approve keywords and department of a group. */
export async function updateLineGroup(t: Tenant, groupId: string, templateId: string | null, name: string | null, keywords: string[] | null, department: string | null): Promise<void> {
  ownerOnly(t);
  if (templateId !== null && !(await t.selectInternal("data_templates", { where: { id: templateId } })).length) fail("ไม่พบ Template", 404);
  const k = keywords ?? [];
  if (k.length < 1 || k.length > 10 || k.some((x) => x !== null && (Array.from(pgTrim(x)).length < 2 || Array.from(pgTrim(x)).length > 50))) fail("คีย์เวิร์ดไม่ถูกต้อง");
  if (department !== null && Array.from(department).length > 60) fail("แผนกไม่ถูกต้อง");
  if (!(await t.selectInternal("line_groups", { where: { group_id: groupId } })).length) fail("ไม่พบกลุ่ม", 404);
  await t.atomic([
    t.guardStmt("line_groups", { group_id: groupId }),
    t.updateStmt("line_groups", { group_id: groupId }, { template_id: templateId, name: Array.from(name ?? "").slice(0, 100).join(""), approve_keywords: keywords, department: department || null }),
    logAction(t, "line_group_updated", groupId),
  ]);
}
/** set_line_group_listen(): the bot reads only @mentions, or every message. */
export async function setLineGroupListen(t: Tenant, groupId: string, listen: string): Promise<void> {
  ownerOnly(t);
  if (!["mention", "all"].includes(listen)) fail("โหมดไม่ถูกต้อง");
  if (!(await t.selectInternal("line_groups", { where: { group_id: groupId } })).length) fail("ไม่พบกลุ่ม", 404);
  await t.atomic([t.guardStmt("line_groups", { group_id: groupId }), t.updateStmt("line_groups", { group_id: groupId }, { listen }), logAction(t, "line_group_listen", groupId + ":" + listen)]);
}
/** remove_line_approver() */
export async function removeLineApprover(t: Tenant, groupId: string, lineUser: string): Promise<void> {
  ownerOnly(t);
  const mine = (await t.selectInternal("line_groups", { where: { group_id: groupId } })).length > 0;
  await t.atomic([...(mine ? [t.deleteGlobalStmt("line_group_approvers", { group_id: groupId, line_user: lineUser })] : []), logAction(t, "line_approver_removed", groupId)]);
}

// ---------- approvers in a group ----------
/** line_set_approvers(): add / remove the group's approvers (from the LIFF picker). Returns the list. */
export async function lineSetApprovers(sql: Sql, groupId: string, lineUser: string, _hash: string, add: unknown, remove: string[] | null): Promise<{ id: string; name: string }[]> {
  const g = await group(sql, groupId);
  if (!g) return fail("กลุ่มนี้ยังไม่ได้เชื่อมกับ EliteFlow", 404);
  const t = systemTenant(sql, g.company_id);
  type Approver = { group_id: string; line_user: string; name: string; created_at: string };
  const current = await t.selectGlobal<Approver>("line_group_approvers", { where: { group_id: groupId } });
  const boss = await lineMember(t, lineUser);
  const ok = !current.length || current.some((a) => a.line_user === lineUser) || (!!boss && ["owner", "manager"].includes(boss.role));
  if (!ok) fail("กลุ่มนี้มีผู้อนุมัติแล้ว ให้ผู้อนุมัติคนใดคนหนึ่งในกลุ่มกด “บันทึก” แทน (หรือเจ้าของเอาผู้อนุมัติออกได้ที่หน้า LINE ในเว็บ)", 403);
  const names = new Map(current.map((a) => [a.line_user, a.name]));
  const added = new Map<string, string>();
  if (Array.isArray(add)) {
    if (add.length > 20) fail("ตั้งได้ครั้งละไม่เกิน 20 คน");
    for (const x of add as Data[]) {
      const id = txt(x?.id) ?? "";
      if (!/^U[0-9a-f]{32}$/.test(id)) continue;
      const name = Array.from(txt(x.name) ?? "").slice(0, 100).join("");
      if (names.has(id) || added.has(id)) names.set(id, name !== "" ? name : (names.get(id) ?? added.get(id) ?? ""));
      else added.set(id, name);
    }
  }
  const gone = new Set(remove ?? []);
  const after = new Set([...current.map((a) => a.line_user), ...added.keys()].filter((u) => !gone.has(u)));
  if (after.size > 20) fail("ผู้อนุมัติต่อกลุ่มไม่เกิน 20 คน");
  const stmts = [];
  for (const a of current) if (names.get(a.line_user) !== a.name) stmts.push(t.updateGlobalStmt("line_group_approvers", { group_id: groupId, line_user: a.line_user }, { name: names.get(a.line_user) }));
  for (const [id, name] of added) stmts.push(t.insertGlobalStmt("line_group_approvers", { group_id: groupId, line_user: id, name: names.get(id) ?? name, added_by: lineUser }));
  if (gone.size) stmts.push(t.deleteGlobalStmt("line_group_approvers", { group_id: groupId, line_user: [...gone] }));
  stmts.push(audit(t, null, "line_approvers_set", groupId));
  await t.atomic(stmts);
  return (await t.selectGlobal<Approver>("line_group_approvers", { where: { group_id: groupId }, order: [["created_at", "asc"]] })).map((a) => ({ id: a.line_user, name: a.name }));
}
/** line_group_approver_for(): the name a LINE user approves under for the step an item is at (null: not an approver). */
export async function lineGroupApproverFor(t: Tenant, lineUser: string, i: Ingestion): Promise<string | null> {
  const a = i.approval ?? (await approvalPlan(t, i));
  const at = a.at === undefined || a.at === null ? 0 : Math.trunc(Number(a.at));
  const dept = txt(((a.steps as Data[]) ?? [])[at]?.dept);
  const groups = await t.selectInternal<LineGroup>("line_groups");
  const deptHasGroup = dept !== null && groups.some((d) => d.department === dept);
  const mine = groups.filter((g) => (dept !== null && g.department === dept) || (g.group_id === i.group_id && !deptHasGroup)).map((g) => g.group_id);
  if (!mine.length) return null;
  const [x] = await t.selectGlobal<{ name: string }>("line_group_approvers", { where: { line_user: lineUser, group_id: mine } });
  return x ? x.name : null;
}

// ---------- approving in LINE ----------
/** line_approval_act(): a button on the approval card. Managers act as themselves; approvers named in the group too. */
export async function lineApprovalAct(sql: Sql, groupId: string, lineUser: string, id: string, action: string, note: string | null = null, step: number | null = null): Promise<Data> {
  const g = await group(sql, groupId);
  if (!g) return fail("กลุ่มไม่ถูกต้อง");
  const t = systemTenant(sql, g.company_id);
  const i = await ingestionById(t, id);
  if (!i) return fail("ไม่พบรายการ", 404);
  const u = await lineMember(t, lineUser);
  if (i.source_user !== null && i.source_user === lineUser && u?.role !== "owner") fail("อนุมัติคำขอของตัวเองไม่ได้ค่ะ ให้ผู้อนุมัติคนอื่นในกลุ่มกดแทนนะคะ", 403);
  if (u && ["owner", "manager"].includes(u.role)) return approvalAct(t, u.user_id, id, action, note, "line", groupId, step, { authUid: null });
  if (["approved", "rejected", "awaiting_slip"].includes(i.status)) fail("รายการนี้ตัดสินไปแล้ว");
  if (i.status !== "review") fail("รายการนี้ยังไม่ได้ส่งขออนุมัติ (หรือส่งกลับไปแก้ไขแล้ว)");
  const at = i.approval?.at === undefined || i.approval?.at === null ? 0 : Math.trunc(Number(i.approval.at));
  if (step !== null && step !== at) fail("ขั้นนี้มีผู้ดำเนินการไปแล้ว ดูการ์ดล่าสุดนะคะ", 409);
  const who = await lineGroupApproverFor(t, lineUser, i);
  if (who === null) fail("คุณยังไม่ได้เป็นผู้อนุมัติของขั้นนี้ ให้ผู้อนุมัติหรือเจ้าของพิมพ์ “@EliteFlow ให้ @ชื่อคุณ อนุมัติได้” ในกลุ่ม", 403);
  return approvalApply(t, { id, actor: null, lineUser, name: who || "ผู้อนุมัติใน LINE", action, note, via: "line", group: groupId, step }, { authUid: null });
}
/** line_decide(): a manager linked in LINE approves or rejects an item without an approval chain. */
export async function lineDecide(sql: Sql, groupId: string, lineUser: string, id: string, status: string, reason: string | null = ""): Promise<void> {
  const g = await group(sql, groupId);
  if (!g) return fail("กลุ่มไม่ถูกต้อง");
  const t = systemTenant(sql, g.company_id);
  const u = await lineMember(t, lineUser);
  if (!u || !["owner", "manager"].includes(u.role)) return fail("LINE นี้ยังไม่ได้เชื่อมกับผู้จัดการในระบบ (หน้า LINE → เชื่อมบัญชี LINE ของฉัน)", 403);
  const i = await ingestionById(t, id);
  if (!i) return fail("ไม่พบรายการ", 404);
  if (i.approval !== null) fail("รายการนี้อนุมัติด้วยปุ่มในการ์ดขออนุมัติเท่านั้น");
  if (i.group_id !== groupId && g.department !== i.department) fail("กลุ่มนี้ไม่ใช่แผนกที่ดูแลรายการนี้", 403);
  if (u.role !== "owner" && !u.departments.includes(i.department)) fail(`คุณไม่มีสิทธิ์อนุมัติของ${deptTh(i.department)}`, 403);
  if (["approved", "rejected"].includes(i.status)) fail("รายการนี้ตัดสินไปแล้ว");
  if (i.status !== "review") fail("รายการนี้ยังอ่านไม่เสร็จ");
  const ctx = newCtx(t, stamp());
  const p = { stmts: [t.guardStmt("ingestions", { id, status: "review" })], after: [] };
  if (status === "approved") {
    requiredFilled(i.template, i.values);
    await createIngestionWorkflow(t, p, ctx, u.user_id, i.template, i.values, i.id);
    await updateStatus(t, p, ctx, i, { status: "approved", missing: [], decided_by: u.user_id, decided_via: "line", decided_group: groupId });
  } else if (status === "rejected") await updateStatus(t, p, ctx, i, { status: "rejected", error: pgTrim(reason ?? "") || "ไม่ระบุเหตุผล", decided_by: u.user_id, decided_via: "line", decided_group: groupId });
  else fail("สถานะไม่ถูกต้อง");
  p.stmts.push(audit(t, u.user_id, "line_" + status, i.id));
  await t.atomic(p.stmts);
}
/** line_approve(): approve unless it already is. */
export async function lineApprove(sql: Sql, groupId: string, lineUser: string, id: string): Promise<void> {
  if ((await systemTenant(sql).selectGlobal("ingestions", { where: { id, status: "approved" } })).length) return;
  await lineDecide(sql, groupId, lineUser, id, "approved", "");
}
/** line_keyword_approve(): a manager types one of the group's approve keywords: approve the newest complete item. */
export async function lineKeywordApprove(sql: Sql, groupId: string, lineUser: string, text: string): Promise<string | null> {
  const g = await group(sql, groupId);
  if (!g) return null;
  if (!(g.approve_keywords ?? []).includes(pgTrim(text ?? ""))) return null;
  const t = systemTenant(sql, g.company_id);
  const [i] = (await t.selectInternal<Ingestion>("ingestions", { where: { group_id: groupId, status: "review" }, order: [["created_at", "desc"]] })).filter((x) => arr(x.missing).length === 0);
  if (!i) return fail("ไม่มีรายการที่พร้อมอนุมัติ", 404);
  await lineApprove(sql, groupId, lineUser, i.id);
  return i.id;
}
/** line_draft_decide(): the requester (or a manager) sends a draft for approval, or cancels it. */
export async function lineDraftDecide(sql: Sql, groupId: string, lineUser: string, id: string, save: boolean): Promise<string> {
  const g0 = systemTenant(sql);
  const [i] = await g0.selectGlobal<Ingestion>("ingestions", { where: { id, group_id: groupId } });
  if (!i) return fail("ไม่พบรายการนี้", 404);
  if (i.status !== "draft") {
    if (["review", "approved"].includes(i.status)) fail("รายการนี้ส่งขออนุมัติแล้ว");
    if (["queued", "processing"].includes(i.status)) fail("กำลังอ่านข้อมูลใหม่ รอสรุปล่าสุดก่อนนะคะ");
    fail("รายการนี้ยกเลิกไปแล้ว");
  }
  const t = systemTenant(sql, i.company_id);
  await requesterOrManager(t, i, lineUser, "เฉพาะคนที่ส่งรายการนี้ หรือผู้จัดการ");
  const ctx = newCtx(t, stamp());
  const p = { stmts: [t.guardStmt("ingestions", { id, status: "draft" })], after: [] };
  if (save) {
    if (arr(i.missing).length > 0) fail(`ยังขาด: ${arr(i.missing).map((m) => txt(m)).join(", ")} — กด “แก้ไข” แล้วพิมพ์ข้อมูลที่ขาดก่อนส่งนะคะ`);
    await updateStatus(t, p, ctx, i, { status: "review", approval: await approvalPlan(t, i) });
  } else await updateStatus(t, p, ctx, i, { status: "skipped", error: "ยกเลิกใน LINE" });
  p.stmts.push(g0.deleteGlobalStmt("line_listen", { ingestion_id: id }));
  await t.atomic(p.stmts);
  return save ? "review" : "skipped";
}

// ---------- evidence and slips ----------
/** line_evidence_check(): may this LINE user add files to the item, and how many more. */
export async function lineEvidenceCheck(sql: Sql, groupId: string, lineUser: string, id: string): Promise<{ company: string; count: number | null; left: number }> {
  const g = await group(sql, groupId);
  if (!g) return fail("กลุ่มไม่ถูกต้อง");
  const t = systemTenant(sql, g.company_id);
  const i = await ingestionById(t, id);
  if (!i) return fail("ไม่พบรายการ", 404);
  if (["skipped", "rejected", "failed"].includes(i.status)) fail("รายการนี้ยกเลิกหรือไม่อนุมัติแล้ว แนบหลักฐานไม่ได้");
  await requesterOrManager(t, i, lineUser, "เฉพาะคนที่ขอ หรือผู้จัดการ ที่แนบหลักฐานของรายการนี้ได้");
  const n = await itemFileCount(t, id);
  return { company: i.company_id, count: n, left: Math.max(0, 5 - (n as number)) };
}
/** line_add_evidence(): a file sent in LINE becomes evidence of the item (and of its record, once there is one). */
export async function lineAddEvidence(sql: Sql, groupId: string, lineUser: string, id: string, attachmentId: string): Promise<{ count: number | null; left: number }> {
  const c = await lineEvidenceCheck(sql, groupId, lineUser, id);
  if (c.left < 1) fail("แนบได้สูงสุด 5 ไฟล์ต่อรายการค่ะ");
  const t = systemTenant(sql, c.company);
  const e = (await t.selectInternal<Entity>("entities", { where: { archived_at: null } })).find((x) => txt(x.data.ingestionId) === id);
  const [a] = await t.selectInternal<{ id: string; entity_id: string | null }>("attachments", { where: { id: attachmentId } });
  if (!a) return fail("ไม่พบไฟล์", 404);
  await t.atomic([t.guardStmt("attachments", { id: attachmentId, entity_id: a.entity_id }), t.updateStmt("attachments", { id: attachmentId }, { ingestion_id: id, entity_id: a.entity_id ?? e?.id ?? null })]);
  const n = await itemFileCount(t, id);
  return { count: n, left: Math.max(0, 5 - (n as number)) };
}
/** line_slip_check(): may this LINE user send the transfer slip of an approved expense; returns the company. */
export async function lineSlipCheck(sql: Sql, groupId: string, lineUser: string, id: string): Promise<string> {
  const g = await group(sql, groupId);
  if (!g) return fail("กลุ่มไม่ถูกต้อง");
  const t = systemTenant(sql, g.company_id);
  const i = await ingestionById(t, id);
  if (!i) return fail("ไม่พบรายการ", 404);
  if (i.status === "approved") fail("รายการนี้บันทึกเป็นค่าใช้จ่ายแล้ว");
  if (i.status !== "awaiting_slip") fail("รายการนี้ยังไม่ได้รับอนุมัติ ส่งสลิปได้หลังอนุมัติแล้วค่ะ");
  await requesterOrManager(t, i, lineUser, "เฉพาะคนที่ขอ หรือผู้จัดการ ที่ส่งสลิปของรายการนี้ได้");
  return i.company_id;
}
/** line_expense_paid(): the slip arrived: the expense is paid and becomes a record. */
export async function lineExpensePaid(sql: Sql, groupId: string, lineUser: string, id: string, attachmentId: string): Promise<{ id: string; status: string; code: string | null }> {
  const c = await lineSlipCheck(sql, groupId, lineUser, id);
  const t = systemTenant(sql, c);
  const [i] = await systemTenant(sql).selectGlobal<Ingestion>("ingestions", { where: { id } });
  if (!(await t.selectInternal("attachments", { where: { id: attachmentId } })).length) fail("ไม่พบไฟล์สลิป", 404);
  const now = stamp(),
    ctx = newCtx(t, now);
  const approval: Approval | null = i.approval === null ? null : { ...i.approval, history: [...((i.approval.history as Record<string, unknown>[]) ?? []), { action: "slip", at: now, by: lineUser, via: "line" }] };
  const paid: Ingestion = { ...i, attachment_id: attachmentId, values: { ...i.values, payStatus: "โอนแล้ว" }, approval };
  const p = {
    stmts: [t.guardStmt("ingestions", { id, status: "awaiting_slip" }), t.updateStmt("ingestions", { id }, { attachment_id: attachmentId, values: paid.values, approval })],
    after: [],
  };
  await createIngestionWorkflow(t, p, ctx, i.decided_by, i.template, i.values, i.id);
  await updateStatus(t, p, ctx, paid, { status: "approved", missing: [] });
  p.stmts.push(audit(t, i.decided_by, "expense_slip", id));
  await t.atomic(p.stmts);
  const saved = (await ingestionById(t, id))!;
  return { id: saved.id, status: saved.status, code: saved.doc_code };
}

// ---------- reading in LINE ----------
/** line_documents(): documents to show in the group (by code, by id, or the group's latest). */
export async function lineDocuments(sql: Sql, groupId: string, lineUser: string, code: string | null = null, id: string | null = null): Promise<Data[]> {
  const g = await group(sql, groupId);
  if (!g) return fail("กลุ่มไม่ถูกต้อง");
  const t = systemTenant(sql, g.company_id);
  const linked = !!(await lineMember(t, lineUser));
  const rows = (await t.selectInternal<Entity>("entities", { where: { archived_at: null, ...(id ? { id } : {}) }, order: [["created_at", "desc"]] })).filter(
    (e) => (txt(e.data.code) ?? "") !== "" && (code === null || (txt(e.data.code) as string).toUpperCase() === code.toUpperCase()),
  );
  const ids = [...new Set(rows.map((e) => txt(e.data.ingestionId)).filter((x): x is string => !!x))];
  const items = ids.length ? await systemTenant(sql).selectGlobal<Ingestion>("ingestions", { where: { id: ids } }) : [];
  const of = (e: Entity) => items.find((i) => i.id === txt(e.data.ingestionId));
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return rows
    .filter((e) => (linked || (of(e)?.source_user ?? null) === lineUser) && (code !== null || id !== null || (txt(e.data.sourceGroup) !== null && of(e)?.group_id === groupId)))
    .slice(0, 6)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      code: txt(e.data.code),
      name: txt(e.data.notes) ?? txt(e.data.name) ?? "",
      total: num(e.data.total) ?? num(e.data.amount) ?? num(e.data.budget) ?? null,
      status: txt(e.data.status),
      at: e.created_at,
      lines: Array.isArray(e.data.lines) ? e.data.lines : [],
    }));
}
/** line_expense_summary(): expenses in a date range, by category and person, for an owner or manager. */
export async function lineExpenseSummary(sql: Sql, groupId: string, lineUser: string, from: string, to: string): Promise<Data> {
  const g = await group(sql, groupId);
  if (!g) return fail("กลุ่มไม่ถูกต้อง");
  const t = systemTenant(sql, g.company_id);
  const m = await lineMember(t, lineUser);
  if (!m || !["owner", "manager"].includes(m.role)) fail("สรุปค่าใช้จ่ายดูได้เฉพาะเจ้าของหรือผู้จัดการที่เชื่อมบัญชี LINE แล้วค่ะ", 403);
  const x = (await t.selectInternal<Entity>("entities", { where: { kind: "expenses", archived_at: null } }))
    .filter((e) => (txt(e.data.status) ?? "") !== "rejected")
    .map((e) => ({
      name: txt(e.data.name),
      category: txt(e.data.category) || "อื่นๆ",
      who: txt(e.data.sourceSender) || txt(e.data.requestor) || txt(e.data.payee) || "ไม่ระบุ",
      amount: typeof e.data.amount === "number" ? e.data.amount : 0,
      code: txt(e.data.code),
      day: txt(e.data.date),
      on: txt(e.data.date) || bangkokDay(e.created_at),
    }))
    .filter((e) => e.on >= from && e.on <= to);
  const by = (k: "category" | "who") => {
    const groups = new Map<string, { name: string; amount: number; count: number }>();
    for (const e of x) {
      const r = groups.get(e[k]) ?? { name: e[k], amount: 0, count: 0 };
      r.amount += e.amount;
      r.count += 1;
      groups.set(e[k], r);
    }
    return [...groups.values()].sort((a, b) => b.amount - a.amount);
  };
  const [company] = await t.selectGlobal<{ name: string }>("companies", { where: { id: g.company_id } });
  const items = await t.selectInternal<Ingestion>("ingestions", { where: { status: ["awaiting_slip", "review"] } });
  const waiting = items.filter((i) => i.status === "awaiting_slip");
  return {
    company: company?.name ?? null,
    from,
    to,
    count: x.length,
    total: x.reduce((s, e) => s + e.amount, 0),
    byCategory: by("category"),
    byPerson: by("who"),
    top: [...x]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((e) => ({ name: e.name, amount: e.amount, code: e.code, day: e.day })),
    waitingSlip: { count: waiting.length, amount: waiting.reduce((s, i) => s + (approvalAmount(i.values) ?? 0), 0) },
    inReview: items.filter((i) => i.status === "review" && i.target_kind === "expenses").length,
  };
}
/** line_quick_stats(): the numbers the bot answers "สรุป" with (null for an unknown group). */
export async function lineQuickStats(sql: Sql, groupId: string): Promise<Data | null> {
  const g = await group(sql, groupId);
  if (!g) return null;
  const t = systemTenant(sql, g.company_id);
  const [company] = await t.selectGlobal<{ name: string }>("companies", { where: { id: g.company_id } });
  const items = await t.selectInternal<Ingestion>("ingestions", { where: { status: "review" } });
  const live = await t.selectInternal<Entity>("entities", { where: { archived_at: null, kind: ["deals", "tasks", "projects", "sales"] } });
  const now = stamp(),
    today = bangkokDay(now);
  const st = (e: Entity) => txt(e.data.status);
  const sales = live.filter((e) => e.kind === "sales" && st(e) === "confirmed");
  const sum = (xs: Entity[]) => xs.reduce((s, e) => s + (e.data.amount === null || e.data.amount === undefined ? 0 : Number(e.data.amount)), 0);
  return {
    company: company?.name ?? null,
    review: items.length,
    missing: items.filter((i) => arr(i.missing).length > 0).length,
    pendingDeals: live.filter((e) => e.kind === "deals" && st(e) === "pending").length,
    openTasks: live.filter((e) => e.kind === "tasks" && (st(e) ?? "") !== "done").length,
    activeProjects: live.filter((e) => e.kind === "projects" && ["active", "planning"].includes(st(e) ?? "")).length,
    salesToday: sum(sales.filter((e) => txt(e.data.date) === today)),
    salesMonth: sum(sales.filter((e) => (txt(e.data.date) ?? "").slice(0, 7) === today.slice(0, 7) && txt(e.data.date) !== null)),
  };
}
