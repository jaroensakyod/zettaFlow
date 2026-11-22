// Approvals for D1, step for step after the Postgres functions: approval_plan / approval_amount / approval_requester
// (read helpers), approval_apply / approval_act / web_approval_act (the approval chain of a LINE or web item),
// approve_deal, save_entity_as, save_template, set_template_target, queue_nudges. (create_approver_code is left out:
// migration 0072_line_approvers_no_code dropped it, so there is nothing to port.)
//
// Postgres did more inside those functions through triggers, and they are written out here as helpers the write paths
// call at the same moment:
// - ingestions, BEFORE update of status: ingestion_decision_stamp (decisionStamp, also used by ingestion.ts)
// - ingestions, AFTER update of status to approved: ingestion_to_entity (ingestionToEntity);
//   ingestion_decision_notify never writes from here, because approval_apply always sets `approval` first.
// - entities, on insert: entities_code, entities_dept_rules, entities_purchase_figures, create_project_stages,
//   entities_stock_effect, entities_take_item_files (insertEntity, on the shared planner in entity-insert.ts)
// - data_templates, BEFORE insert: enforce_quota('workflows') (billing-plan.ts enforceQuota)
// validate_payload is the shared one (validate.ts).
// create_ingestion_workflow (called by approval_apply) is ported here too (createIngestionWorkflow).
// Rows Postgres locked (FOR UPDATE) are guarded on what was read, so a concurrent change aborts the batch with
// ConflictError. Every call is one batch.
import { randomUUID } from "node:crypto";
import { AppError, formatCode, thaiYear } from "../domain";
import { derive } from "../dept-rules";
import type { Sql, Stmt } from "./driver";
import { canWriteDept, type Viewer } from "./access";
import { saveEntity } from "./entities";
import { afterEntityInsert, beforeEntityInsert, type Plan } from "./entity-insert";
import { deptTh, fail, jsonType as jtype, pgLeft as left, pgLen as chars, pgText as txt, pgTrim } from "./common";
import { validatePayload } from "./validate";
import { enforceQuota } from "./billing-plan";
import { Tenant } from "./tenant";
import type { Entity } from "../types";

export { deptTh };
type Data = Record<string, unknown>;
const isManager = (role: string | null | undefined) => role === "owner" || role === "manager";

// ---------- jsonb helpers (jsonb_typeof, ->>, trim, length, left: common.ts) ----------
/** (x->>'key')::int */
const int = (v: unknown): number | null => {
  const s = txt(v);
  return s === null ? null : Math.trunc(Number(s));
};
const obj = (v: unknown): Data => (v && typeof v === "object" && !Array.isArray(v) ? (v as Data) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Time in Bangkok as parts, for to_char(… at time zone 'Asia/Bangkok'). */
const bangkok = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 7 * 3600000),
    p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, stamp: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` };
};
/** jsonb::text — Postgres prints ", " and ": " between items; used only for its length. */
function pgJsonText(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(pgJsonText).join(", ") + "]";
  if (v && typeof v === "object")
    return "{" + Object.entries(v as Data).map(([k, x]) => JSON.stringify(k) + ": " + pgJsonText(x)).join(", ") + "}";
  return JSON.stringify(v);
}

// ---------- rows ----------
export type ApprovalStep = { dept: string | null };
export type Approval = { steps: ApprovalStep[]; at: number; round: number; ref: string; history: Data[] } & Data;
export type Ingestion = {
  id: string;
  company_id: string;
  template: Data;
  department: string;
  values: Data;
  missing: unknown;
  status: string;
  group_id: string | null;
  attachment_id: string | null;
  error: string | null;
  created_at: string;
  created_by: string | null;
  source_user: string | null;
  target_kind: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decided_name: string | null;
  decided_via: string | null;
  decided_group: string | null;
  sender_name: string | null;
  group_name: string | null;
  confirm: boolean;
  approval: Approval | null;
  doc_code: string | null;
  nudged_at: string | null;
} & Data;
export type DataTemplate = { id: string; company_id: string; name: string; department: string; fields: Data[]; steps: Data[]; version: number; created_at: string; target_kind: string | null; field_map: Data };
type Member = { user_id: string; name: string; email: string; role: string; departments: string[]; read_departments?: string[]; disabled: boolean };

/** A batch step that aborts unless the item still has the status, approval and values that were read. */
const guardIngestion = (t: Tenant, i: Ingestion): Stmt => t.guardStmt("ingestions", { id: i.id, status: i.status, approval: i.approval ?? null, values: i.values ?? null });

// ---------- read helpers ----------
/** approval_amount(): the amount a request is about, from the first numeric field that says it. */
export function approvalAmount(v: Data): number | null {
  for (const k of ["amount", "budget", "total", "subtotal"]) if (jtype(v?.[k]) === "number") return v[k] as number;
  if (jtype(v?.quantity) === "number" && jtype(v?.unitCost) === "number") return (v.quantity as number) * (v.unitCost as number);
  return null;
}

/** approval_requester(): the member who asked — the LINE sender's linked account, else who created it. */
export async function approvalRequester(t: Tenant, i: Ingestion): Promise<string | null> {
  if (i.source_user !== null) {
    const [u] = await t.selectInternal<{ user_id: string }>("line_users", { where: { line_user_id: i.source_user } });
    if (u) return u.user_id;
  }
  return i.created_by;
}

/** approval_plan(): who approves, in order — the requesting department, then Finance / HR / the item's department. */
export async function approvalPlan(t: Tenant, i: Ingestion): Promise<Approval> {
  const kind = i.target_kind ?? txt(obj(i.template).target_kind);
  let req: string | null = null;
  if (i.group_id !== null) req = (await t.selectGlobal<{ department: string | null }>("line_groups", { where: { group_id: i.group_id } }))[0]?.department ?? null;
  if (req === null && i.source_user !== null) {
    const [u] = await t.selectInternal<{ user_id: string }>("line_users", { where: { line_user_id: i.source_user } });
    if (u) req = (await t.selectInternal<Member>("memberships", { where: { user_id: u.user_id } }))[0]?.departments?.[0] ?? null;
  }
  req = req ?? i.department;
  let second: string | null = kind === "marketing_budget" || kind === "event_budget" ? "Finance" : kind === "leaves" ? "HR" : i.department;
  let amt = approvalAmount(obj(i.values));
  if (amt === null) {
    const lines = arr(obj(i.values).lines).filter((x) => jtype(obj(x).qty) === "number" && jtype(obj(x).price) === "number") as Data[];
    if (lines.length) amt = lines.reduce((s, x) => s + (x.qty as number) * (x.price as number), 0);
  }
  if (kind !== "leaves" && amt !== null && amt < 5000) second = null;
  const steps: ApprovalStep[] = [{ dept: req }];
  if (second !== null && second !== req) steps.push({ dept: second });
  const prev = i.approval;
  return {
    steps,
    at: 0,
    round: int(prev?.round) ?? 1,
    ref: i.doc_code ?? "EF-" + i.id.replace(/-/g, "").slice(0, 8).toUpperCase(),
    history: prev && prev.history !== undefined ? (prev.history as Data[]) : [],
  };
}

// ---------- entities inserted by checked functions (the entities triggers) ----------
type Ctx = {
  /** auth.uid() inside the Postgres call: the signed-in person on the web, null from the LINE webhook. */
  authUid: string | null;
  stamp: string;
  /** Entities inserted earlier in this batch, so later lookups see them as Postgres did. */
  pending: Entity[];
};

/** Entities of this company, plus the ones this batch inserted. */
async function entitiesOf(t: Tenant, ctx: Ctx, kind: string): Promise<Entity[]> {
  return [...(await t.selectInternal<Entity>("entities", { where: { kind, archived_at: null } })), ...ctx.pending.filter((e) => e.kind === kind)];
}

/** INSERT INTO entities with the BEFORE and AFTER insert triggers, in Postgres order. Returns the new id. */
export async function insertEntity(t: Tenant, plan: Plan, ctx: Ctx, kind: string, department: string, input: Data, createdBy: string | null): Promise<string> {
  const id = randomUUID();
  const { data: d } = await beforeEntityInsert(kind, input, {
    takeCode: async (prefix) => formatCode(prefix, thaiYear(), await t.nextNumber(prefix, 0)),
    docCode: async (ing) => (await t.selectInternal<{ doc_code: string | null }>("ingestions", { where: { id: ing } }))[0]?.doc_code ?? null,
    // entity_dept_rules asks only when auth.uid() is set (not from the LINE webhook).
    approverRole: () => (ctx.authUid !== null ? t.viewer.role : null),
  });
  plan.stmts.push(t.insertStmt("entities", { id, kind, department, data: d, created_by: createdBy }));
  ctx.pending.push({ id, company_id: t.viewer.companyId, kind, department, data: d, created_at: ctx.stamp, updated_at: ctx.stamp, created_by: createdBy as string, version: 1, archived_at: null });
  await afterEntityInsert(t, plan, id, kind, d);
  return id;
}

/** validate_payload() for a record this batch inserts: relations may also point at records inserted earlier in it. */
const validateIn = (t: Tenant, ctx: Ctx, spec: Data[] | null, p: Data) => validatePayload(spec, p, async (id, kind) => (await entitiesOf(t, ctx, kind)).some((e) => e.id === id));

/** create_ingestion_workflow(): an approved form opens its project (found or new), a deal for BD forms, and its tasks. */
export async function createIngestionWorkflow(t: Tenant, plan: Plan, ctx: Ctx, actor: string | null, tpl: Data, v: Data, ingestionId: string): Promise<void> {
  if (jtype(tpl.steps) === "array" && (tpl.steps as unknown[]).length === 0) return;
  const hasDate = (k: string) => arr(tpl.fields).some((f) => txt(obj(f).key) === k && txt(obj(f).type) === "date");
  const start = hasDate("start") ? txt(v.start) : null,
    end = hasDate("end") ? txt(v.end) : null;
  if (start !== null && end !== null && start > end) fail("ช่วงวันที่โครงการไม่ถูกต้อง");
  let p: string | null = null;
  const projects = await entitiesOf(t, ctx, "projects");
  if (jtype(v.project_id) === "string" && v.project_id !== "") {
    p = projects.find((e) => e.id === v.project_id)?.id ?? null;
    if (!p) fail("โครงการอ้างอิงไม่อยู่ในบริษัทนี้");
  } else if (jtype(v.project) === "string" && pgTrim(v.project as string).length > 0) {
    const n = pgTrim(v.project as string);
    if (chars(n) > 500) fail("ชื่อโครงการยาวเกินไป");
    const same = projects.filter((e) => (txt(e.data.name) ?? "\u0000").toLowerCase() === n.toLowerCase());
    if (same.length > 1) fail("พบชื่อโครงการซ้ำ กรุณาใช้ฟิลด์ project_id เพื่อระบุโครงการ");
    p = same[0]?.id ?? null;
    if (p === null) {
      const budget = jtype(v.rent) === "number" ? Math.max(0, v.rent as number) : 0;
      p = await insertEntity(t, plan, ctx, "projects", "Operations", { name: n, status: "active", priority: "normal", budget, startDate: start, endDate: end, ingestionId }, actor);
    }
  }
  if (txt(tpl.department) === "Business Development" && jtype(v.rent) === "number" && jtype(v.location) === "string") {
    if ((v.rent as number) < 0) fail("ค่าเช่าต้องไม่ติดลบ");
    await insertEntity(
      t,
      plan,
      ctx,
      "deals",
      "Business Development",
      { name: txt(v.project) ?? txt(tpl.name), location: v.location, rent: v.rent, projectId: p, status: "approved", startDate: start, endDate: end, ingestionId },
      actor,
    );
  }
  for (const s of arr(tpl.steps).map(obj))
    await insertEntity(
      t,
      plan,
      ctx,
      "tasks",
      txt(s.department) as string,
      { name: txt(s.name), department: txt(s.department), notes: txt(v.project) ?? txt(tpl.name), projectId: p, priority: "normal", status: "pending", ingestionId },
      actor,
    );
}

/** ingestion_to_entity() (AFTER update of status to approved): the approved item becomes a record of its target page. */
export async function ingestionToEntity(t: Tenant, plan: Plan, ctx: Ctx, row: Ingestion): Promise<void> {
  let kind: string, fields: Data[], fmap: Data, tname: string;
  if (row.target_kind !== null) {
    kind = row.target_kind;
    fields = arr(obj(row.template).fields).map(obj);
    fmap = {};
    tname = txt(obj(row.template).name) || kind;
  } else {
    const tid = txt(obj(row.template).id);
    const [tpl] = tid && UUID.test(tid) ? await t.selectInternal<DataTemplate>("data_templates", { where: { id: tid } }) : [];
    if (!tpl?.target_kind) return;
    kind = tpl.target_kind;
    fields = arr(tpl.fields).map(obj);
    fmap = obj(tpl.field_map);
    tname = tpl.name;
  }
  const [spec] = await t.selectGlobal<{ department: string; fields: Data[] }>("entity_schemas", { where: { kind } });
  const specFields = spec ? arr(spec.fields).map(obj) : [];
  const values = obj(row.values);
  let d: Data = {};
  for (const f of fields) {
    const k = txt(f.key);
    if (k === null) continue;
    const ek = txt(fmap[k]) || k;
    if (k in values && values[k] !== null && specFields.some((s) => txt(s.key) === ek)) d = { ...d, [ek]: values[k] };
  }
  let unresolved = "";
  for (const st of specFields.filter((s) => s.type === "relation")) {
    const key = txt(st.key) as string;
    if (!(key in d)) continue;
    const text = txt(d[key]);
    if (text !== null && UUID.test(text)) continue;
    const want = pgTrim(text ?? "").toLowerCase();
    let k: string | null = (await entitiesOf(t, ctx, txt(st.resource) ?? "")).find((e) => text !== null && (txt(e.data.name) ?? "\u0000").toLowerCase() === want)?.id ?? null;
    // Not found by name: a พนักงาน linked to the LINE member who sent it.
    if (k === null && st.resource === "employees" && row.source_user !== null) k = (await entitiesOf(t, ctx, "employees")).find((e) => e.data.lineUserId === row.source_user)?.id ?? null;
    if (k === null && text !== null) unresolved += `${txt(st.label)} “${pgTrim(text)}” `;
    if (k === null) {
      const { [key]: _gone, ...rest } = d;
      d = rest;
    } else d = { ...d, [key]: k };
  }
  if ((txt(d.name) ?? "") === "") d = { ...d, name: left(tname + " " + bangkok(row.created_at).stamp, 200) };
  for (const st of specFields.filter((s) => s.type === "select" && txt(s.required) === "true")) {
    const key = txt(st.key) as string,
      opts = arr(st.options);
    const cur = txt(d[key]);
    if (!(cur !== null && opts.includes(cur))) d = { ...d, [key]: opts.includes("อื่นๆ") ? "อื่นๆ" : (txt(opts[0]) ?? null) };
  }
  // Approved in LINE (or in the LINE box on the web) = approved: ค่าใช้จ่าย and ใบลา start as อนุมัติแล้ว.
  if ((kind === "expenses" || kind === "leaves") && !["approved", "paid"].includes(txt(d.status) ?? "")) d = { ...d, status: "approved" };
  if (specFields.some((s) => s.key === "date" && s.type === "date") && (txt(d.date) ?? "") === "") d = { ...d, date: bangkok(ctx.stamp).date };
  if (row.attachment_id !== null) {
    const img = specFields.find((s) => s.type === "image");
    if (img && (txt(d[txt(img.key) as string]) ?? "") === "") d = { ...d, [txt(img.key) as string]: row.attachment_id };
  }
  let clean: Data;
  try {
    clean = await validateIn(t, ctx, spec ? specFields : null, d);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    throw new AppError(unresolved !== "" ? `ไม่พบ ${unresolved}ในระบบ แก้ให้ตรงกับข้อมูลที่มีก่อนอนุมัติ (${e.message})` : `บันทึกไม่สำเร็จ: ${e.message}`, 400);
  }
  // Where it came from: LINE group, its department and who sent it.
  let src: Data = {};
  if (row.group_id !== null) {
    const [g] = await t.selectGlobal<{ name: string; department: string | null }>("line_groups", { where: { group_id: row.group_id } });
    src = { sourceVia: "LINE", sourceGroup: (g?.name || null) ?? row.group_name ?? "", sourceDepartment: g?.department ?? "", sourceSender: row.sender_name ?? "" };
  }
  const id = await insertEntity(t, plan, ctx, kind, spec!.department, { ...clean, ingestionId: row.id, ...src }, ctx.authUid ?? row.decided_by);
  if (row.attachment_id !== null) plan.stmts.push(t.updateStmt("attachments", { id: row.attachment_id, entity_id: null }, { entity_id: id, department: spec!.department }));
}

/**
 * ingestion_decision_stamp() (BEFORE update of ingestions when the status becomes approved / rejected): when, by
 * whom, through what. `authUid` is auth.uid() of the call (null from the LINE webhook). Returns the four columns.
 */
export async function decisionStamp(t: Tenant, authUid: string | null, at: string, row: { decided_by: string | null; decided_name: string | null; decided_via: string | null }) {
  const by = row.decided_by ?? authUid;
  let name = row.decided_name;
  if (name === null && by !== null) {
    const [m] = await t.selectInternal<Member>("memberships", { where: { user_id: by } });
    name = (m?.name || null) ?? m?.email ?? null;
  }
  return { decided_at: at, decided_by: by, decided_via: row.decided_via ?? (authUid === null ? "line" : "web"), decided_name: name };
}
const decidedStamp = (t: Tenant, ctx: Ctx, row: { decided_by: string | null; decided_name: string | null; decided_via: string | null }) => decisionStamp(t, ctx.authUid, ctx.stamp, row);

// ---------- the approval chain ----------
export type ApplyInput = {
  id: string;
  actor: string | null;
  lineUser: string | null;
  name: string | null;
  action: string;
  note: string | null;
  via: string | null;
  group: string | null;
  step: number | null;
};
export type ApprovalResult = { id: string; status: string; approval: Approval | null; action: string; step: number; of: number; dept: string | null; name: string | null; note: string | null };
type Opts = {
  /** auth.uid() of the Postgres call; defaults to the signed-in viewer. null = called from the LINE webhook. */
  authUid?: string | null;
};
type Internal = { stmts: Stmt[]; row?: Ingestion };

const DECIDED = ["approved", "rejected", "awaiting_slip"];
const checkOpen = (i: Ingestion | undefined): Ingestion => {
  if (!i) fail("ไม่พบรายการ", 404);
  if (DECIDED.includes(i!.status)) fail("รายการนี้ตัดสินไปแล้ว", 409);
  if (i!.status !== "review") fail("รายการนี้ยังไม่ได้ส่งขออนุมัติ (หรือส่งกลับไปแก้ไขแล้ว)", 409);
  return i!;
};

/**
 * approval_apply(): one step of the chain — approve (next step, or the last: the record, its workflow, or wait for
 * the slip of an expense), reject, or send back to fix. The caller (approval_act, the LINE approver) checked who.
 */
export async function approvalApply(t: Tenant, input: ApplyInput, opts: Opts = {}, internal: Internal = { stmts: [] }): Promise<ApprovalResult> {
  const { id, actor, lineUser, name, action, via, group, step } = input;
  const ctx: Ctx = { authUid: opts.authUid === undefined ? t.viewer.userId : opts.authUid, stamp: new Date().toISOString(), pending: [] };
  const note = (input.note ?? "").trim() || null;
  const i = checkOpen(internal.row ?? (await t.selectInternal<Ingestion>("ingestions", { where: { id } }))[0]);
  let a: Approval = i.approval ?? (await approvalPlan(t, i));
  const n = arr(a.steps).length,
    cur = int(a.at) ?? 0,
    rnd = int(a.round) ?? 1;
  if (step !== null && step !== cur) fail("ขั้นนี้มีผู้ดำเนินการไปแล้ว ดูการ์ดล่าสุดนะคะ", 409);
  const dept = txt(obj(arr(a.steps)[cur]).dept);
  if (
    action === "approve" &&
    arr(a.history).some((h) => {
      const x = obj(h);
      return txt(x.action) === "approve" && (int(x.round) ?? 1) === rnd && ((actor !== null && txt(x.by) === actor) || (lineUser !== null && txt(x.line) === lineUser));
    }) &&
    !(actor !== null && (await t.selectInternal<Member>("memberships", { where: { user_id: actor, role: "owner" } })).length)
  )
    fail("คุณอนุมัติขั้นก่อนหน้าแล้ว ขั้นนี้ต้องเป็นผู้อนุมัติอีกคน", 403);
  if ((action === "reject" || action === "fix") && chars(note ?? "") < 2) fail("กรุณาใส่เหตุผลหรือสิ่งที่ต้องแก้");
  a = { ...a, history: [...((a.history as Data[] | undefined) ?? []), { step: cur + 1, of: n, dept, action, by: actor, line: lineUser, name, at: ctx.stamp, note, via, round: rnd }] };

  // The web's edited values are written first; the guard then checks nobody else changed the item meanwhile.
  const plan: Plan = { stmts: [...internal.stmts, guardIngestion(t, i)], after: [] };
  const where = { id: i.id };
  let final: Data;
  if (action === "approve") {
    if (cur + 1 < n) final = { approval: { ...a, at: cur + 1 } };
    else {
      const missing = arr(i.missing);
      if (missing.length > 0) fail(`ข้อมูลยังไม่ครบ: ${missing.map((x) => txt(x)).join(", ")}`);
      for (const f of arr(obj(i.template).fields).map(obj)) {
        const v = obj(i.values)[txt(f.key) as string];
        if (txt(f.required) === "true" && (v === undefined || v === null || v === "")) fail(`ข้อมูลไม่ครบ: ${txt(f.label)}`);
      }
      const approval = { ...a, at: n };
      if (i.target_kind === "expenses" && i.attachment_id === null)
        final = { approval, status: "awaiting_slip", decided_at: ctx.stamp, decided_by: actor, decided_name: name, decided_via: via, decided_group: group };
      else {
        plan.stmts.push(t.updateStmt("ingestions", where, { approval }));
        await createIngestionWorkflow(t, plan, ctx, actor, obj(i.template), obj(i.values), i.id);
        const stamp = await decidedStamp(t, ctx, { decided_by: actor, decided_name: name, decided_via: via });
        final = { status: "approved", missing: [], ...stamp, decided_group: group };
        plan.stmts.push(t.updateStmt("ingestions", where, final));
        await ingestionToEntity(t, plan, ctx, { ...i, approval, ...(final as Partial<Ingestion>) } as Ingestion);
        final = {};
      }
    }
  } else if (action === "reject") {
    const stamp = await decidedStamp(t, ctx, { decided_by: actor, decided_name: name, decided_via: via });
    final = { approval: a, status: "rejected", error: note, ...stamp, decided_group: group };
  } else if (action === "fix") final = { approval: { ...a, at: 0, round: rnd + 1 }, status: "draft", confirm: true };
  else return fail("คำสั่งไม่ถูกต้อง");
  if (Object.keys(final).length) plan.stmts.push(t.updateStmt("ingestions", where, final));
  plan.stmts.push(t.insertStmt("audit_events", { actor, action: "approval_" + action, target: i.id }));
  await t.atomic(plan.stmts);
  const [saved] = await t.selectInternal<Ingestion>("ingestions", { where });
  return { id: saved.id, status: saved.status, approval: saved.approval, action, step: cur + 1, of: n, dept, name, note };
}

/** approval_act(): an owner, or a manager of the step's department who did not ask for it, acts on the item. */
export async function approvalAct(
  t: Tenant,
  actor: string | null,
  id: string,
  action: string,
  note: string | null,
  via: string | null,
  group: string | null,
  step: number | null = null,
  opts: Opts = {},
  internal: Internal = { stmts: [] },
): Promise<ApprovalResult> {
  const i = checkOpen(internal.row ?? (await t.selectInternal<Ingestion>("ingestions", { where: { id } }))[0]);
  const a = i.approval ?? (await approvalPlan(t, i));
  const at = int(a.at) ?? 0,
    dept = txt(obj(arr(a.steps)[at]).dept);
  if (step !== null && step !== at) fail("ขั้นนี้มีผู้ดำเนินการไปแล้ว ดูการ์ดล่าสุดนะคะ", 409);
  const [u] = actor === null ? [] : await t.selectInternal<Member>("memberships", { where: { user_id: actor, disabled: false } });
  if (!u || !isManager(u.role)) fail("เฉพาะผู้จัดการหรือเจ้าของบริษัทที่อนุมัติได้", 403);
  // not (dept = any(departments)): unknown (no raise) for a null step department, unless the list is empty.
  if (u!.role !== "owner" && (u!.departments.length === 0 || (dept !== null && !u!.departments.includes(dept)))) fail(`ขั้นนี้ต้องให้ผู้จัดการ${deptTh(dept)}เป็นผู้อนุมัติ`, 403);
  if (u!.role !== "owner" && (await approvalRequester(t, i)) === actor) fail("อนุมัติคำขอของตัวเองไม่ได้ค่ะ", 403);
  return approvalApply(t, { id, actor, lineUser: null, name: u!.name || u!.email, action, note, via, group, step }, opts, { ...internal, row: i });
}

/** web_approval_act(): the approval box on the web; approving may first save the edited values of the form's fields. */
export async function webApprovalAct(t: Tenant, id: string, action: string, values: Data | null, note: string | null = null): Promise<ApprovalResult> {
  const [found] = await t.selectInternal<Ingestion>("ingestions", { where: { id } });
  if (!found || !t.viewer.role) fail("ไม่พบรายการ", 404);
  let i = found!;
  const stmts: Stmt[] = [];
  if (action === "approve" && values !== null && values !== undefined && i.status === "review") {
    const agg: Data = {};
    let any = false;
    for (const fd of arr(obj(i.template).fields).map(obj)) {
      const k = txt(fd.key);
      if (k !== null && jtype(values) === "object" && Object.prototype.hasOwnProperty.call(values, k)) (agg[k] = values[k]), (any = true);
    }
    if (any) {
      stmts.push(t.updateStmt("ingestions", { id }, { values: agg }));
      i = { ...i, values: agg };
    }
  }
  return approvalAct(t, t.viewer.userId, id, action, note, "web", null, null, {}, { stmts, row: i });
}

// ---------- deals ----------
const DEAL_TASKS: [string, string][] = [
  ["Design", "เขียนแบบ / Perspective"],
  ["Purchasing", "ขอใบเสนอราคา"],
  ["Warehouse", "เตรียมสินค้า"],
  ["Marketing", "เตรียมสื่อ"],
  ["Sales", "วางแผนการขาย"],
];
/** approve_deal(): a pending deal is approved — its project (new unless linked) and the five departments' tasks. */
export async function approveDeal(t: Tenant, id: string): Promise<string> {
  const v = t.viewer;
  if (!isManager(v.role) || !canWriteDept(v, "Business Development")) fail("ไม่มีสิทธิ์อนุมัติ", 403);
  const [r] = await t.selectInternal<Entity>("entities", { where: { id, kind: "deals", archived_at: null } });
  const st = txt(r?.data.status);
  if (!r || (st !== null && st !== "pending")) fail("ดีลนี้ไม่ได้รออนุมัติ", 409);
  const ctx: Ctx = { authUid: v.userId, stamp: new Date().toISOString(), pending: [] };
  const plan: Plan = { stmts: [t.guardStmt("entities", { id: r!.id, version: r!.version })], after: [] };
  let project = txt(r!.data.projectId) || null;
  if (project === null)
    project = await insertEntity(
      t,
      plan,
      ctx,
      "projects",
      "Operations",
      { name: txt(r!.data.name), status: "active", priority: "normal", budget: txt(r!.data.rent) === null ? 0 : Number(txt(r!.data.rent)), startDate: txt(r!.data.startDate), endDate: txt(r!.data.endDate) },
      v.userId,
    );
  for (const [d, name] of DEAL_TASKS) await insertEntity(t, plan, ctx, "tasks", d, { name, department: d, projectId: project, priority: "normal", status: "pending", dealId: r!.id }, v.userId);
  // The UPDATE fires entities_code / dept_rules / keep_source / purchase_figures; for a deal only derive() applies.
  const data = { ...r!.data, status: "approved", projectId: project };
  plan.stmts.push(
    t.updateStmt("entities", { id: r!.id }, { data: { ...data, ...derive("deals", data) }, version: r!.version + 1, updated_at: ctx.stamp }),
    t.insertStmt("audit_events", { actor: v.userId, action: "deal_approved", target: id }),
  );
  await t.atomic(plan.stmts);
  return project!;
}

// ---------- save_entity on behalf of a member ----------
/**
 * save_entity_as(): save_entity as another member of the company (the LINE bot saving for the person who sent it).
 * Postgres switched auth.uid() to that user; here the save runs with that member as the viewer.
 */
export async function saveEntityAs(sql: Sql, companyId: string, userId: string, kind: string, data: Data): Promise<Entity> {
  const probe = new Tenant(sql, { userId, email: "", companyId, role: "viewer", departments: [] });
  const [m] = await probe.selectInternal<Member>("memberships", { where: { user_id: userId } });
  if (!m) fail("ผู้ใช้ไม่ได้อยู่ในบริษัทนี้", 403);
  // member_role() ignores a disabled membership: such a user has no role, so can write nothing.
  const viewer: Viewer = m!.disabled ? { userId, email: m!.email, companyId, role: "viewer", departments: [] } : { userId, email: m!.email, companyId, role: m!.role as Viewer["role"], departments: m!.departments, readDepartments: m!.read_departments ?? [] };
  return saveEntity(new Tenant(sql, viewer), kind, data);
}

// ---------- form templates ----------
/** save_template(): the owner creates or edits a LINE / web form (its fields and the workflow steps it opens). */
export async function saveTemplate(t: Tenant, name: string, department: string, fields: Data[], steps: Data[], id: string | null = null): Promise<DataTemplate> {
  if (t.viewer.role !== "owner") fail("เฉพาะเจ้าของบริษัท", 403);
  if (chars(name) < 1 || chars(name) > 200 || fields.length < 1 || fields.length > 30 || steps.length > 20) fail("Template ไม่ถูกต้อง");
  const or = (...xs: (boolean | null)[]) => (xs.includes(true) ? true : xs.includes(null) ? null : false);
  const and = (x: boolean | null, y: boolean | null) => (x === false || y === false ? false : x === null || y === null ? null : true);
  const bad = fields.some((raw) => {
    const f = obj(raw),
      key = txt(f.key),
      type = txt(f.type),
      opts = f.options;
    const optsBad = jtype(opts) === null ? null : jtype(opts) !== "array" || (opts as unknown[]).length < 2 || (opts as unknown[]).length > 20;
    return (
      or(key === null ? null : !/^[a-z][a-z0-9_]{0,39}$/.test(key), type === null ? null : !["text", "number", "date", "choice"].includes(type), and(type === null ? null : type === "choice", optsBad ?? true)) === true
    );
  });
  const keys = fields.map((f) => txt(obj(f).key)).filter((k) => k !== null);
  if (bad || fields.length !== new Set(keys).size) fail("ฟิลด์ไม่ถูกต้อง");
  const stamp = new Date().toISOString();
  const stmts: Stmt[] = [];
  let rowId: string;
  if (id === null) {
    // enforce_quota('workflows'), the BEFORE INSERT trigger on data_templates.
    stmts.push(...(await enforceQuota(t, "workflows", {}, stamp)));
    rowId = randomUUID();
    stmts.push(t.insertStmt("data_templates", { id: rowId, name, department, fields, steps }));
  } else {
    const [old] = await t.selectInternal<DataTemplate>("data_templates", { where: { id } });
    if (!old) fail("ไม่พบ Template", 404);
    rowId = id;
    stmts.push(t.guardStmt("data_templates", { id, version: old!.version }), t.updateStmt("data_templates", { id }, { name, department, fields, steps, version: old!.version + 1 }));
  }
  stmts.push(t.insertStmt("audit_events", { actor: t.viewer.userId, action: "template_saved", target: rowId }));
  await t.atomic(stmts);
  return (await t.selectInternal<DataTemplate>("data_templates", { where: { id: rowId } }))[0];
}

/** set_template_target(): the owner points a form at a page (records are created there on approval) with a field map. */
export async function setTemplateTarget(t: Tenant, id: string, kind: string | null, map: Data | null): Promise<void> {
  if (t.viewer.role !== "owner") fail("เฉพาะเจ้าของบริษัท", 403);
  if (kind !== null && !(await t.selectGlobal("entity_schemas", { where: { kind } })).length) fail("ไม่พบหน้าปลายทาง", 404);
  const m = map ?? {};
  if (jtype(m) !== "object" || chars(pgJsonText(m)) > 5000) fail("การจับคู่ฟิลด์ไม่ถูกต้อง");
  const [old] = await t.selectInternal<DataTemplate>("data_templates", { where: { id } });
  if (!old) fail("ไม่พบ Template", 404);
  await t.atomic([
    t.updateStmt("data_templates", { id }, { target_kind: kind, field_map: m }),
    t.insertStmt("audit_events", { actor: t.viewer.userId, action: "template_target", target: id }),
  ]);
}

// ---------- reminders ----------
/**
 * queue_nudges() (cron, every company): items waiting for approval for 12 hours that still miss data get one reminder
 * per LINE group in the outbox. The message is sent by the outbox worker, not here. Returns the number of messages.
 * Uses only the global layer: `t` can be any system viewer.
 */
export async function queueNudges(t: Tenant): Promise<number> {
  const now = new Date().toISOString(),
    cutoff = new Date(Date.now() - 12 * 3600000).toISOString();
  const due = (await t.selectGlobal<Ingestion>("ingestions", { where: { status: "review", nudged_at: null } }))
    .filter((i) => i.group_id !== null && arr(i.missing).length > 0 && i.created_at < cutoff)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  if (!due.length) return 0;
  const groups = new Map<string, { company: string; group: string; lines: string[] }>();
  const stmts: Stmt[] = [];
  for (const i of due) {
    stmts.push(t.updateGlobalStmt("ingestions", { id: i.id, nudged_at: null }, { nudged_at: now }));
    const k = i.company_id + "\u0000" + i.group_id;
    if (!groups.has(k)) groups.set(k, { company: i.company_id, group: i.group_id as string, lines: [] });
    groups.get(k)!.lines.push(`• ${txt(obj(i.values).name) || "รายการที่ส่งมา"} — ขาด ${arr(i.missing).map((x) => txt(x)).join(", ")}`);
  }
  for (const g of groups.values())
    stmts.push(
      t.insertGlobalStmt("notification_outbox", {
        company_id: g.company,
        target: g.group,
        body: left(`⏰ มี ${g.lines.length} รายการยังขาดข้อมูล\n${g.lines.join("\n")}\nกด Reply ที่ข้อความแจ้งบันทึกเดิมของแต่ละรายการ แล้วพิมพ์ข้อมูลที่ขาด`, 4500),
      }),
    );
  await t.atomic(stmts);
  return groups.size;
}
