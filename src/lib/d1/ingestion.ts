// Document ingestion, attachments and design revisions for D1, step for step after the Postgres functions
// (schema.sql): submit / claim / complete / complete_sorted / decide / retry ingestion, take_code / peek_code,
// purge_voice_files, add_attachment / link_attachment / item_file_count, and create / review / comment design revisions.
//
// Triggers on ingestions become one helper, updateStatus(), that every "update ingestions set status=…" here goes
// through: BEFORE ingestions_decision_stamp → the row update → AFTER ingestions_decision_notify → ingestions_to_entity
// (Postgres fires AFTER triggers in name order). create_ingestion_workflow, the ingestion_to_entity trigger, the
// entities INSERT triggers (insertEntity) and the approval chain (approval_plan / approval_act / approval_apply) come
// from approvals.ts, and so does ingestion_decision_stamp (decisionStamp), used here for the status updates outside
// approval_apply. enforce_quota('documents') is billing-plan.ts's.
//
// auth.uid(): a Tenant's viewer.userId, or "" for the LINE webhook and the worker (service role) — systemTenant().
// Worker and webhook functions take the Sql and build the Tenant of the row's company themselves.
import { randomUUID } from "node:crypto";
import { formatCode, thaiYear } from "../domain";
import type { Sql, Stmt } from "./driver";
import { canReadDept, canWriteDept } from "./access";
import { codePrefix, type Plan } from "./entity-insert";
import type { Tenant } from "./tenant";
import { deptTh, fail, pgLeft, pgLen as chars, pgText, pgTrim, systemTenant } from "./common";
import { enforceQuota } from "./billing-plan";
import { approvalPlan, createIngestionWorkflow, decisionStamp as stampOf, ingestionToEntity, type Ingestion as ApprovalIngestion } from "./approvals";
import type { Entity } from "../types";

export { fail, systemTenant };
type Data = Record<string, unknown>;
const stamp = () => new Date().toISOString();
/** jsonb ->>, trim(), left() (common.ts), under the names line.ts imports from here. */
export { pgText as txt, pgTrim, pgLeft as left };
const txt = pgText,
  left = pgLeft;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** jsonb equality: key order does not matter. */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Data)[k])])) : v);
export const jsonEq = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
/** The Bangkok calendar day of a timestamp, YYYY-MM-DD. */
export const bangkokDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type Ingestion = ApprovalIngestion & {
  raw: string;
  source: string;
  source_event: string | null;
  engine: string | null;
  lease_until: string | null;
  lease_id: string | null;
  attempts: number;
  pages: number | null;
};
type Membership = { user_id: string; name: string | null; email: string; role: string; departments: string[]; disabled: boolean };
/** What approvals.ts carries through one batch: auth.uid(), now(), and the entities inserted so far. */
export type Ctx = Parameters<typeof ingestionToEntity>[2];
export const newCtx = (t: Tenant, now: string): Ctx => ({ authUid: uid(t), stamp: now, pending: [] });

/** auth.uid() */
export const uid = (t: Tenant) => t.viewer.userId || null;
/** log_action() */
export const logAction = (t: Tenant, action: string, target: string) => t.insertStmt("audit_events", { actor: uid(t), action, target });
const plan = (...stmts: Stmt[]): Plan => ({ stmts, after: [] });
export async function ingestionById(t: Tenant, id: string): Promise<Ingestion | null> {
  return (await t.selectInternal<Ingestion>("ingestions", { where: { id } }))[0] ?? null;
}

// ---------- codes ----------
/** take_code(): the next running document code of a kind (null for kinds without codes). */
export async function takeCode(t: Tenant, kind: string): Promise<string | null> {
  const p = codePrefix[kind];
  if (!p) return null;
  return formatCode(p, thaiYear(), await t.nextNumber(p, 0));
}
/** peek_code(): the code the next record of a kind will get, without taking it. */
export async function peekCode(t: Tenant, kind: string): Promise<string | null> {
  const p = codePrefix[kind];
  if (!p) return null;
  const [c] = await t.selectInternal<{ last: number }>("doc_counters", { where: { prefix: p, year: 0 } });
  return formatCode(p, thaiYear(), c ? Number(c.last) + 1 : 1);
}

// ---------- the ingestions triggers ----------
/** ingestion_decision_stamp (BEFORE update of status): when, who and how an item was approved or rejected. */
async function decisionStamp(t: Tenant, old: Ingestion, row: Ingestion, now: string): Promise<Ingestion> {
  if (!["approved", "rejected"].includes(row.status) || old.status === row.status) return row;
  return { ...row, ...(await stampOf(t, uid(t), now, row)) };
}
/** ingestion_decision_notify (AFTER update of status): tell the LINE group an item without an approval chain was decided. */
function decisionNotify(t: Tenant, p: Plan, old: Ingestion, row: Ingestion) {
  if (row.group_id === null || !(["approved", "rejected"].includes(row.status) && old.status !== row.status)) return;
  if (row.approval !== null) return;
  if (row.decided_via === "line" && row.decided_group === row.group_id) return;
  const who = (row.decided_name ?? "ผู้อนุมัติ") + (row.department !== null ? ` (${deptTh(row.department)})` : "");
  const what = txt(row.values?.name) || "รายการที่ส่งมา";
  const edited = row.status === "approved" && !jsonEq(old.values, row.values);
  const body =
    row.status === "approved" ? (edited ? "✏️ แก้ไขแล้วอนุมัติ: " : "✅ อนุมัติแล้ว: ") + what : "❌ ไม่อนุมัติ: " + what + "\nเหตุผล: " + (row.error || "ไม่ระบุ");
  p.stmts.push(t.insertStmt("notification_outbox", { target: row.group_id, body: left(body + "\n👤 โดย " + who, 4500), ingestion_id: row.id, role: "source" }));
}
/**
 * UPDATE ingestions SET <patch> WHERE id=… for a patch that sets status, with the triggers that fire on it. Returns the
 * row as it stands afterwards.
 */
export async function updateStatus(t: Tenant, p: Plan, ctx: Ctx, old: Ingestion, patch: Partial<Ingestion>): Promise<Ingestion> {
  const now = ctx.stamp;
  const row = await decisionStamp(t, old, { ...old, ...patch } as Ingestion, now);
  const decided = ["approved", "rejected"].includes(row.status) && old.status !== row.status;
  const set: Data = { ...patch, ...(decided ? { decided_at: row.decided_at, decided_by: row.decided_by, decided_via: row.decided_via, decided_name: row.decided_name } : {}) };
  p.stmts.push(t.updateStmt("ingestions", { id: old.id }, nullable(set)));
  decisionNotify(t, p, old, row);
  if (row.status === "approved" && old.status !== "approved") await ingestionToEntity(t, p, ctx, row);
  return row;
}
/** updateStmt skips undefined; a column set to SQL NULL must be passed as null. */
const nullable = (o: Data) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]));
/** A plain UPDATE ingestions (no status change in it). */
const setIngestion = (t: Tenant, id: string, patch: Data) => t.updateStmt("ingestions", { id }, nullable(patch));

/** The template's required fields must have a value (not missing, null or ""). */
export function requiredFilled(tpl: Data, values: Data) {
  for (const f of (Array.isArray(tpl?.fields) ? tpl.fields : []) as Data[]) {
    const v = values?.[txt(f.key) as string];
    if (f.required === true && (v === undefined || v === null || v === "")) fail(`ข้อมูลไม่ครบ: ${txt(f.label) ?? ""}`);
  }
}

// ---------- ingestion lifecycle ----------
/** submit_ingestion(): a person sends text and/or a document through a form; the worker reads it later. */
export async function submitIngestion(t: Tenant, templateId: string, raw: string, attachmentId: string | null = null): Promise<Ingestion> {
  const [tp] = await t.selectInternal<Data & { department: string }>("data_templates", { where: { id: templateId } });
  if (!tp || !canWriteDept(t.viewer, tp.department)) fail("ไม่มีสิทธิ์ส่งข้อมูล", 403);
  if (chars(raw) > 15000 || (chars(pgTrim(raw)) === 0 && attachmentId === null)) fail("กรอกข้อความหรือแนบเอกสาร");
  if (attachmentId !== null && !(await t.selectInternal("attachments", { where: { id: attachmentId, department: tp.department } })).length) fail("เอกสารไม่ถูกต้อง");
  const quota = await enforceQuota(t, "documents");
  const id = randomUUID();
  await t.atomic([...quota, t.insertStmt("ingestions", { id, template: tp, department: tp.department, raw, attachment_id: attachmentId, created_by: uid(t) }), logAction(t, "ingestion_submitted", id)]);
  return (await ingestionById(t, id))!;
}

/** claim_ingestion(): the worker leases up to 3 queued items (or one by id); items that kept timing out fail. */
export async function claimIngestion(sql: Sql, id: string | null = null): Promise<Ingestion[]> {
  const g = systemTenant(sql),
    now = stamp();
  await g.updateGlobal("ingestions", { status: "processing", lease_until: { op: "<", value: now }, attempts: { op: ">=", value: 5 } }, { status: "failed", error: "ประมวลผลหมดเวลาหลายครั้ง กรุณาลองใหม่" });
  const ready = (await g.selectGlobal<Ingestion>("ingestions", { where: { attempts: { op: "<", value: 5 }, ...(id ? { id } : {}) }, order: [["created_at", "asc"]] }))
    .filter((i) => i.status === "queued" || (i.status === "processing" && i.lease_until !== null && i.lease_until < now))
    .slice(0, 3);
  if (!ready.length) return [];
  const lease = new Date(Date.parse(now) + 5 * 60000).toISOString();
  const stmts: Stmt[] = [];
  for (const i of ready)
    stmts.push(
      g.guardGlobalStmt("ingestions", { id: i.id, status: i.status, attempts: i.attempts }),
      g.updateGlobalStmt("ingestions", { id: i.id }, { status: "processing", lease_until: lease, lease_id: randomUUID(), attempts: i.attempts + 1 }),
    );
  await g.atomic(stmts);
  const rows = await g.selectGlobal<Ingestion>("ingestions", { where: { id: ready.map((i) => i.id) } });
  return ready.map((i) => rows.find((r) => r.id === i.id)!);
}

const dropMissing = (missing: unknown[], ...prefixes: string[]) =>
  missing.filter((m) => {
    if (m === null) return false;
    const s = txt(m) as string;
    return !prefixes.some((pre) => s.startsWith(pre));
  });
/** The body of complete_ingestion() for a row already read (complete_sorted_ingestion passes its updated row). */
async function completeRow(sql: Sql, i: Ingestion, values0: Data, missing0: unknown[], engine: string, pre: (t: Tenant) => Stmt[]): Promise<void> {
  const t = systemTenant(sql, i.company_id),
    now = stamp();
  let values: Data = { ...(values0 ?? {}) },
    missing = [...(missing0 ?? [])],
    code: string | null = null;
  const patch: Data = {};
  if (i.group_id !== null && i.target_kind !== null) {
    code = i.doc_code ?? (await takeCode(t, i.target_kind));
    if (code !== null && i.target_kind === "purchases") {
      const name = txt(values.name) ?? "";
      if (name !== "" && name !== code) values = { ...values, notes: (name + " · " + (txt(values.notes) ?? "")).replace(/^[ ·]+|[ ·]+$/g, "") };
      values = { ...values, name: code, poNumber: code };
      if ((txt(values.orderDate) ?? "") === "") {
        values = { ...values, orderDate: bangkokDay(now) };
        missing = dropMissing(missing, "วันที่สั่งซื้อ");
      }
      missing = dropMissing(missing, "เลขที่ใบสั่งซื้อ");
      if (Array.isArray(values.lines) && values.lines.length > 0) missing = dropMissing(missing, "สินค้า", "จำนวน", "ราคาต่อหน่วย");
    }
    if (i.target_kind === "expenses" && typeof values.amount !== "number" && Array.isArray(values.lines)) {
      const amount = (values.lines as Data[]).filter((x) => x && isNum(x.qty) && isNum(x.price)).reduce((s, x) => s + (x.qty as number) * (x.price as number), 0);
      values = { ...values, amount };
      if (amount > 0) missing = dropMissing(missing, "ยอด");
      else {
        const { amount: _a, ...rest } = values;
        values = rest;
      }
    }
    patch.doc_code = code;
  }
  Object.assign(patch, { values, missing, engine, status: i.confirm ? "draft" : "review", lease_until: null });
  const p = plan(t.guardGlobalStmt("ingestions", { id: i.id, lease_id: i.lease_id as string, status: "processing" }), ...pre(t));
  const row = { ...i, ...patch } as Ingestion;
  if (i.group_id !== null && !i.confirm) patch.approval = await approvalPlan(t, row);
  p.stmts.push(setIngestion(t, i.id, patch));
  if (i.group_id !== null) {
    const ref = code ?? i.id.slice(0, 8);
    const body = i.confirm
      ? `📝 สรุปก่อนบันทึก (${ref})`
      : missing.length > 0
        ? `⚠️ ZettaFlow: ข้อมูลยังไม่ครบ (${ref})\nกรุณาส่งเพิ่ม: ${missing.map((m) => txt(m)).join(", ")}`
        : `📨 ส่งขออนุมัติรายการ ${ref} แล้ว (ยังไม่ถือว่าอนุมัติ)`;
    p.stmts.push(t.upsertStmt("notification_outbox", { id: i.id, target: i.group_id, body: left(body, 4500) }, ["id"], []));
  }
  await t.atomic(p.stmts);
}
/** complete_ingestion(): the worker hands back what it read; the item goes to review (or a draft to confirm in LINE). */
export async function completeIngestion(sql: Sql, id: string, lease: string, values: Data, missing: unknown[], engine: string): Promise<void> {
  const [i] = await systemTenant(sql).selectGlobal<Ingestion>("ingestions", { where: { id, lease_id: lease, status: "processing" } });
  if (!i) return;
  await completeRow(sql, i, values, missing, engine, () => []);
}
/** complete_sorted_ingestion(): the worker also decided which page (kind) the item belongs to, or that it is none. */
export async function completeSortedIngestion(sql: Sql, id: string, lease: string, kind: string | null, template: Data | null, values: Data | null, missing: unknown[], engine: string): Promise<void> {
  const g = systemTenant(sql);
  const [i] = await g.selectGlobal<Ingestion>("ingestions", { where: { id, lease_id: lease, status: "processing" } });
  if (!i) return;
  const t = systemTenant(sql, i.company_id);
  if (kind === null) {
    await t.atomic([g.guardGlobalStmt("ingestions", { id, lease_id: lease, status: "processing" }), setIngestion(t, id, { status: "skipped", values: values ?? {}, missing: [], engine, lease_until: null })]);
    return;
  }
  const [spec] = await g.selectGlobal<{ department: string }>("entity_schemas", { where: { kind } });
  if (!spec) fail("ไม่พบหน้าปลายทาง", 404);
  if (template && template.fields !== undefined && template.fields !== null && !Array.isArray(template.fields)) fail("ฟอร์มไม่ถูกต้อง");
  const sorted = { ...i, target_kind: kind, department: spec.department, template: template as Data };
  await completeRow(sql, sorted, values as Data, missing, engine, (tt) => [setIngestion(tt, id, { target_kind: kind, department: spec.department, template })]);
}

/** decide_ingestion(): an owner or manager approves (with corrected values) or rejects an item without a chain. */
export async function decideIngestion(t: Tenant, id: string, status: string, values0: Data | null, reason: string = ""): Promise<void> {
  const i = await ingestionById(t, id);
  if (!i || !canReadDept(t.viewer, i.department) || !["owner", "manager"].includes(t.viewer.role)) fail("ไม่มีสิทธิ์อนุมัติ", 403);
  if (i!.approval !== null) fail("รายการนี้มีขั้นตอนอนุมัติ ใช้ปุ่มอนุมัติตามขั้นตอน");
  if (i!.status !== "review" || !["approved", "rejected"].includes(status)) fail("รายการตัดสินแล้วหรือสถานะไม่ถูกต้อง");
  const p = plan(t.guardStmt("ingestions", { id, status: "review" }));
  let values: Data = values0 ?? {};
  const ctx = newCtx(t, stamp());
  if (status === "approved") {
    const fields = (Array.isArray(i!.template?.fields) ? i!.template.fields : []) as Data[];
    values = Object.fromEntries(fields.map((f) => [txt(f.key) as string, values0?.[txt(f.key) as string] ?? null]));
    for (const f of fields) {
      const v = values[txt(f.key) as string];
      if (f.required === true && (v === null || v === "")) fail(`ข้อมูลไม่ครบ: ${txt(f.label) ?? ""}`);
      if (v !== null) {
        if (f.type === "number") {
          if (typeof v !== "number" || Math.abs(v) > 1e12) fail("ตัวเลขไม่ถูกต้อง");
        } else if (typeof v !== "string") fail("ข้อความไม่ถูกต้อง");
        if (f.type === "date") {
          const s = txt(v) as string;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail("วันที่ไม่ถูกต้อง");
          if (Number.isNaN(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) fail(`date/time field value out of range: "${s}"`);
        }
      }
    }
    await createIngestionWorkflow(t, p, ctx, uid(t), i!.template, values, i!.id);
  } else if (reason !== null && chars(pgTrim(reason)) === 0) fail("ต้องมีเหตุผล");
  await updateStatus(t, p, ctx, i!, { status, values: status === "approved" ? values : i!.values, error: reason || null, missing: status === "approved" ? [] : i!.missing });
  p.stmts.push(logAction(t, "ingestion_" + status, id));
  await t.atomic(p.stmts);
}

/** retry_ingestion(): put a failed item back in the queue. */
export async function retryIngestion(t: Tenant, id: string): Promise<void> {
  const i = await ingestionById(t, id);
  if (!i || !canWriteDept(t.viewer, i.department)) fail("ไม่มีสิทธิ์รายการนี้", 403);
  if (i!.status !== "failed") fail("ลองใหม่ได้เฉพาะรายการที่ประมวลผลไม่สำเร็จ");
  const p = plan(t.guardStmt("ingestions", { id, status: "failed" }));
  await updateStatus(t, p, newCtx(t, stamp()), i!, { status: "queued", attempts: 0, error: null, lease_until: null, lease_id: null });
  p.stmts.push(logAction(t, "ingestion_retried", id));
  await t.atomic(p.stmts);
}

/**
 * purge_voice_files(): voice notes older than `days` are dropped from attachments (and unlinked from their items).
 * Returns the storage paths: the caller deletes those objects from R2 (Postgres left storage to the caller too).
 */
export async function purgeVoiceFiles(sql: Sql, days = 90): Promise<string[]> {
  if (days < 7) fail("เก็บไฟล์เสียงอย่างน้อย 7 วัน");
  const g = systemTenant(sql);
  const old = await g.selectGlobal<{ id: string; path: string }>("attachments", { where: { mime: { op: "like", value: "audio/%" }, created_at: { op: "<", value: new Date(Date.now() - days * 86400000).toISOString() } } });
  if (!old.length) return [];
  const ids = old.map((a) => a.id);
  const linked = await g.selectGlobal<{ id: string }>("ingestions", { where: { attachment_id: ids } });
  await g.atomic([...(linked.length ? [g.updateGlobalStmt("ingestions", { attachment_id: ids }, { attachment_id: null })] : []), g.deleteGlobalStmt("attachments", { id: ids })]);
  return old.map((a) => a.path);
}

// ---------- attachments ----------
/** add_attachment(): record a file already uploaded to <company>/<department>/<id>. */
export async function addAttachment(t: Tenant, id: string, entityId: string | null, department: string, name: string, mime: string, size: number, path: string): Promise<void> {
  const v = t.viewer;
  if (!canWriteDept(v, department) || path !== `${v.companyId}/${department}/${id}`) fail("ไม่มีสิทธิ์จัดเก็บเอกสาร", 403);
  if (entityId !== null) {
    const [e] = await t.selectInternal<Entity>("entities", { where: { id: entityId, archived_at: null } });
    if (!e || !(e.department === department || (e.kind === "projects" && department === "Design" && canReadDept(v, e.department)))) fail("ข้อมูลอ้างอิงผิด");
  }
  await t.atomic([t.insertStmt("attachments", { id, entity_id: entityId, department, name, mime, size, path })]);
}
/** link_attachment(): attach an unlinked file to a record. */
export async function linkAttachment(t: Tenant, attachmentId: string, entityId: string): Promise<void> {
  const [a] = await t.selectInternal<{ id: string; department: string; entity_id: string | null }>("attachments", { where: { id: attachmentId } });
  const [e] = await t.selectInternal<Entity>("entities", { where: { id: entityId } });
  if (!a || !e || !canWriteDept(t.viewer, a.department) || !canWriteDept(t.viewer, e.department)) fail("ไม่พบเอกสาร", 404);
  if (a!.entity_id !== null && a!.entity_id !== entityId) fail("เอกสารนี้ผูกกับรายการอื่นแล้ว", 409);
  await t.atomic([t.guardStmt("attachments", { id: attachmentId, entity_id: a!.entity_id }), t.updateStmt("attachments", { id: attachmentId }, { entity_id: entityId })]);
}
/** item_file_count(): files on an item (its own attachment counted once); null when there is no such item. */
export async function itemFileCount(t: Tenant, ingestionId: string): Promise<number | null> {
  const files = await t.selectGlobal<{ id: string }>("attachments", { where: { ingestion_id: ingestionId } });
  const [i] = await t.selectGlobal<Ingestion>("ingestions", { where: { id: ingestionId } });
  if (!i) return null;
  return files.length + (i.attachment_id !== null && !files.some((f) => f.id === i.attachment_id) ? 1 : 0);
}

// ---------- design revisions ----------
export type DesignRevision = { id: string; company_id: string; project_id: string; attachment_id: string; category: string; version: number; status: string; notes: string; created_by: string; created_name: string; created_at: string; reviewed_by: string | null; reviewed_name: string | null; reviewed_at: string | null; review_note: string | null };
export type DesignComment = { id: string; revision_id: string; company_id: string; user_id: string; name: string; body: string; created_at: string };
const memberName = async (t: Tenant) => (await t.selectInternal<Membership>("memberships", { where: { user_id: t.viewer.userId, disabled: false } }))[0]?.name ?? null;

/** create_design_revision(): Design sends a project's drawing (layout / perspective / site) as its next version. */
export async function createDesignRevision(t: Tenant, projectId: string, attachmentId: string, category: string, notes: string | null = ""): Promise<DesignRevision> {
  const v = t.viewer;
  if (!canWriteDept(v, "Design")) fail("ไม่มีสิทธิ์ส่งแบบ", 403);
  const [p] = await t.selectInternal<Entity>("entities", { where: { id: projectId, kind: "projects", archived_at: null } });
  if (!p || !canReadDept(v, p.department)) fail("ไม่พบโครงการ", 404);
  const [a] = await t.selectInternal<{ id: string; department: string; mime: string }>("attachments", { where: { id: attachmentId, entity_id: projectId } });
  if (!a || !canReadDept(v, a.department) || !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(a.mime)) fail("ไฟล์ต้องเป็นภาพหรือ PDF ของโครงการนี้");
  if (!["layout", "perspective", "site"].includes(category) || chars(notes ?? "") > 4000) fail("ข้อมูลเวอร์ชันไม่ถูกต้อง");
  const revs = await t.selectInternal<DesignRevision>("design_revisions", { where: { project_id: projectId, category } });
  if (revs.some((r) => r.attachment_id === attachmentId)) fail("ไฟล์นี้ถูกส่งเป็นเวอร์ชันแล้ว", 409);
  const version = Math.max(0, ...revs.map((r) => r.version)) + 1;
  const id = randomUUID();
  await t.atomic([
    t.guardStmt("entities", { id: p!.id, version: p!.version }),
    t.insertStmt("design_revisions", { id, project_id: projectId, attachment_id: attachmentId, category, version, notes: notes ?? "", created_by: v.userId, created_name: (await memberName(t)) ?? "" }),
    logAction(t, "design_version_uploaded", projectId),
  ]);
  return (await t.selectInternal<DesignRevision>("design_revisions", { where: { id } }))[0];
}
/** review_design_revision(): an owner or manager in Design approves the latest version or sends it back. */
export async function reviewDesignRevision(t: Tenant, id: string, status: string, note: string | null = ""): Promise<DesignRevision> {
  const v = t.viewer;
  if (!["owner", "manager"].includes(v.role) || !canWriteDept(v, "Design")) fail("ไม่มีสิทธิ์อนุมัติแบบ", 403);
  const [r] = await t.selectInternal<DesignRevision>("design_revisions", { where: { id } });
  const [p] = r ? await t.selectInternal<Entity>("entities", { where: { id: r.project_id, archived_at: null } }) : [];
  if (!r || !p || !canReadDept(v, p.department)) fail("ไม่พบเวอร์ชัน", 404);
  if (r!.status !== "submitted") fail("เวอร์ชันนี้ตรวจทานแล้ว", 409);
  if ((await t.selectInternal<DesignRevision>("design_revisions", { where: { project_id: r!.project_id, category: r!.category, version: { op: ">", value: r!.version } } })).length) fail("มีเวอร์ชันใหม่กว่า กรุณาตรวจเวอร์ชันล่าสุด", 409);
  if (!["approved", "revision"].includes(status) || chars(note ?? "") > 4000 || (status === "revision" && chars(pgTrim(note ?? "")) === 0)) fail("กรอกเหตุผลที่ให้แก้ไข");
  await t.atomic([
    t.guardStmt("design_revisions", { id, status: "submitted" }),
    t.guardStmt("entities", { id: p!.id, version: p!.version }),
    t.updateStmt("design_revisions", { id }, { status, review_note: note ?? "", reviewed_by: v.userId, reviewed_name: await memberName(t), reviewed_at: stamp() }),
    logAction(t, "design_" + status, r!.project_id),
  ]);
  return (await t.selectInternal<DesignRevision>("design_revisions", { where: { id } }))[0];
}
/** comment_design_revision(): Design comments on a version. */
export async function commentDesignRevision(t: Tenant, revisionId: string, body: string | null): Promise<DesignComment> {
  const v = t.viewer;
  if (!canWriteDept(v, "Design")) fail("ไม่มีสิทธิ์แสดงความคิดเห็น", 403);
  const [r] = await t.selectInternal<DesignRevision>("design_revisions", { where: { id: revisionId } });
  const [p] = r ? await t.selectInternal<Entity>("entities", { where: { id: r.project_id, archived_at: null } }) : [];
  if (!r || !p || !canReadDept(v, p.department)) fail("ไม่พบเวอร์ชัน", 404);
  const text = pgTrim(body ?? "");
  if (chars(text) < 1 || chars(text) > 4000) fail("กรอกความคิดเห็น 1–4000 ตัวอักษร");
  const id = randomUUID();
  await t.atomic([t.insertStmt("design_comments", { id, revision_id: revisionId, user_id: v.userId, name: (await memberName(t)) ?? "", body: text }), logAction(t, "design_comment", r!.project_id)]);
  return (await t.selectInternal<DesignComment>("design_comments", { where: { id } }))[0];
}
