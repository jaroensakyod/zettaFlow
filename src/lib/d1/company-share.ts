// Dashboard shares (create_share, revoke_share, share_failed, share_lockout, share_metrics), the dashboard layout
// (save_dashboard_layout), personal day notes (note_save, note_delete), the notification outbox (claim_notifications)
// and project stages (init_project_stages, trigger project_stage_init_trigger) for D1, after the Postgres functions.
import { randomUUID } from "node:crypto";
import { decode, type Tenant } from "./tenant";
import { tables } from "./tables.gen";
import type { Sql, Stmt } from "./driver";
import { fail, now, pgLeft, pgLen, pgText, pgTrim, serviceTenant } from "./company";

type Data = Record<string, unknown>;
const ms = (iso: string) => Date.parse(iso);
const audit = (t: Tenant, action: string, target: string) => t.insertStmt("audit_events", { actor: t.viewer.userId, action, target });

// ---------- dashboard shares ----------

export type DashboardShare = { id: string; company_id: string; token_hash: string; password_hash: string | null; label: string; widget_keys: string[]; expires_at: string; revoked_at: string | null; created_by: string | null; created_at: string };
/** create_share(): the owner shares chosen dashboard widgets behind a token (and optional password) until a date. */
export async function createShare(t: Tenant, tokenHash: string, passwordHash: string | null, label: string | null, keys: string[], expires: string | Date): Promise<DashboardShare> {
  if (t.viewer.role !== "owner") fail("เฉพาะเจ้าของบริษัท");
  const stamp = now(),
    exp = new Date(expires).getTime();
  if (exp <= ms(stamp) || exp > ms(stamp) + 365 * 86400000) fail("วันหมดอายุไม่ถูกต้อง");
  if (!keys?.length || keys.length > 50) fail("เลือก Widget อย่างน้อย 1 รายการ");
  const id = randomUUID();
  await t.atomic([
    t.insertStmt("dashboard_shares", { id, token_hash: tokenHash, password_hash: passwordHash, label: pgLeft(label ?? "", 200), widget_keys: keys, expires_at: new Date(exp).toISOString(), created_by: t.viewer.userId, created_at: stamp }),
    audit(t, "share_created", id),
  ]);
  return (await t.selectInternal<DashboardShare>("dashboard_shares", { where: { id } }))[0];
}
/** revoke_share(): the owner ends a share (logged even when no such share exists). */
export async function revokeShare(t: Tenant, id: string): Promise<void> {
  if (t.viewer.role !== "owner") fail("เฉพาะเจ้าของบริษัท");
  await t.atomic([t.updateStmt("dashboard_shares", { id }, { revoked_at: now() }), audit(t, "share_revoked", id)]);
}
/** share_failed(): a wrong share password; attempts older than a day are dropped. Service role (the share page). */
export async function shareFailed(sql: Sql, token: string, client: string): Promise<void> {
  const t = serviceTenant(sql),
    stamp = now();
  await t.atomic([
    t.deleteGlobalStmt("share_attempts", { created_at: { op: "<", value: new Date(ms(stamp) - 86400000).toISOString() } }),
    t.insertGlobalStmt("share_attempts", { token_hash: token, client_hash: client, created_at: stamp }),
  ]);
}
/** share_lockout(): seconds the share page stays locked for this token and client (900) or 0. Service role. */
export async function shareLockout(sql: Sql, token: string, client: string): Promise<number> {
  const t = serviceTenant(sql),
    stamp = ms(now());
  const after = (minutes: number) => ({ op: ">" as const, value: new Date(stamp - minutes * 60000).toISOString() });
  const both = (await t.selectGlobal("share_attempts", { where: { token_hash: token, client_hash: client, created_at: after(15) } })).length;
  const byToken = (await t.selectGlobal("share_attempts", { where: { token_hash: token, created_at: after(15) } })).length;
  const byClient = (await t.selectGlobal("share_attempts", { where: { client_hash: client, created_at: after(60) } })).length;
  return both >= 5 || byToken >= 20 || byClient >= 30 ? 900 : 0;
}

export type ShareMetric = { key: string; name: string; label: string | null; type: string; total: number; count: number; buckets: Record<string, number> };
/**
 * share_metrics(): totals of the number / choice fields of the company's forms over approved submissions, for the
 * widget keys "<template id>:<field key>" a share shows. Service role (the share page has no person).
 */
export async function shareMetrics(sql: Sql, companyId: string, keys: string[]): Promise<ShareMetric[]> {
  const t = serviceTenant(sql, companyId);
  const templates = await t.selectInternal<{ id: string; name: string; fields: unknown }>("data_templates");
  const approved = await t.selectInternal<{ template: Data | null; values: Data | null }>("ingestions", { where: { status: "approved" } });
  const out: ShareMetric[] = [];
  for (const tp of templates) {
    if (!Array.isArray(tp.fields)) continue; // jsonb_array_elements on a non-array raised in Postgres
    for (const f of tp.fields as Data[]) {
      const type = pgText(f?.type),
        fk = pgText(f?.key);
      if (type !== "number" && type !== "choice") continue;
      const key = tp.id + ":" + (fk ?? "");
      if (fk === null || !keys.includes(key)) continue;
      const vals = approved.filter((i) => pgText(i.template?.id) === tp.id).map((i) => (i.values && typeof i.values === "object" && !Array.isArray(i.values) ? i.values[fk] : undefined));
      const buckets: Record<string, number> = {};
      if (type === "choice") for (const v of vals) if (typeof v === "string") buckets[v] = (buckets[v] || 0) + 1;
      out.push({
        key,
        name: tp.name,
        label: pgText(f.label),
        type,
        total: vals.filter((v): v is number => typeof v === "number").reduce((s, v) => s + v, 0),
        count: vals.filter((v) => typeof v === "number" || typeof v === "string").length,
        buckets,
      });
    }
  }
  return out;
}

// ---------- dashboard layout ----------

/** jsonb::text: how Postgres prints a jsonb value (", " and ": " separators), for its length checks. */
export function pgJsonbText(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(pgJsonbText).join(", ") + "]";
  if (typeof v === "object")
    return "{" + Object.entries(v as Data).map(([k, x]) => JSON.stringify(k) + ": " + pgJsonbText(x)).join(", ") + "}";
  return JSON.stringify(v);
}
/** save_dashboard_layout(): the owner saves the dashboard layout into the company settings. */
export async function saveDashboardLayout(t: Tenant, layout: unknown): Promise<void> {
  if (t.viewer.role !== "owner") fail("เฉพาะเจ้าของบริษัท");
  if (!layout || typeof layout !== "object" || Array.isArray(layout) || pgLen(pgJsonbText(layout)) > 20000) fail("Layout ไม่ถูกต้อง");
  const id = t.viewer.companyId;
  const [c] = await t.selectGlobal<{ settings: Data }>("companies", { where: { id } });
  // Postgres changed only settings.dashboard in place; a settings change between this read and the write is lost.
  if (c) await t.atomic([t.updateGlobalStmt("companies", { id }, { settings: { ...(c.settings || {}), dashboard: layout } }), audit(t, "dashboard_layout", id)]);
  else await t.atomic([audit(t, "dashboard_layout", id)]);
}

// ---------- day notes ----------

export type UserNote = { id: string; company_id: string; user_id: string; day: string; body: string; items: { text: string | null; done: boolean }[]; updated_at: string };
/** A Postgres date argument: YYYY-MM-DD only here; Postgres's own errors for anything else. */
function pgDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(`invalid input syntax for type date: "${day}"`);
  const d = new Date(day + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) fail(`date/time field value out of range: "${day}"`);
  return day;
}
/**
 * note_save(): the person's own note and checklist for a day; an empty note is deleted (returns null). A support
 * session cannot save notes here (Postgres let it save under the admin's own user id).
 */
export async function noteSave(t: Tenant, day: string | null, body: string | null, items: unknown): Promise<UserNote | null> {
  const v = t.viewer;
  if (!v.userId || !v.role) fail("ไม่มีสิทธิ์");
  const today = now().slice(0, 10),
    limit = new Date(Date.parse(today + "T00:00:00Z") + 366 * 86400000).toISOString().slice(0, 10);
  if (day === null || day === undefined || pgDate(day) < "2000-01-01" || day > limit) fail("วันที่ไม่ถูกต้อง");
  if (pgLen(body ?? "") > 4000) fail("บันทึกยาวเกิน 4,000 ตัวอักษร");
  if (items !== null && items !== undefined && !Array.isArray(items)) fail("รายการไม่ถูกต้อง");
  const list = (items ?? []) as unknown[];
  if (list.length > 30) fail("รายการสูงสุด 30 ข้อ");
  const clean: { text: string | null; done: boolean }[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object" || Array.isArray(it)) fail("รายการไม่ถูกต้อง");
    const o = it as Data;
    // jsonb_typeof(it->'text')<>'string' is null (not true) when there is no text key at all: such an item passes
    // every check and is kept as {"text": null}.
    if (!("text" in o)) {
      clean.push({ text: null, done: o.done === true });
      continue;
    }
    if (typeof o.text !== "string") fail("รายการไม่ถูกต้อง");
    const text = o.text as string;
    if (pgLen(pgTrim(text)) === 0) continue;
    if (pgLen(text) > 200) fail("แต่ละรายการไม่เกิน 200 ตัวอักษร");
    clean.push({ text: pgTrim(text), done: o.done === true });
  }
  if (pgLen(pgTrim(body ?? "")) === 0 && !clean.length) {
    await t.atomic([t.deleteStmt("user_notes", { user_id: v.userId, day: day! })]);
    return null;
  }
  await t.atomic([t.upsertStmt("user_notes", { user_id: v.userId, day, body: pgTrim(body ?? ""), items: clean, updated_at: now() }, ["company_id", "user_id", "day"], ["body", "items", "updated_at"])]);
  return (await t.selectInternal<UserNote>("user_notes", { where: { user_id: v.userId, day: day! } }))[0];
}
/** note_delete(): removes the person's note for a day. */
export async function noteDelete(t: Tenant, day: string): Promise<void> {
  if (!t.viewer.userId || !t.viewer.role) fail("ไม่มีสิทธิ์");
  await t.atomic([t.deleteStmt("user_notes", { user_id: t.viewer.userId, day: pgDate(day) })]);
}

// ---------- notification outbox ----------

export type Notification = { id: string; company_id: string; target: string; body: string; status: string; attempts: number; next_at: string; lease_until: string | null; created_at: string; ingestion_id: string | null; role: string | null; payload: Data | null };
/**
 * claim_notifications(): the outbox worker leases up to 5 due notifications (queued, or processing with an expired
 * lease; fewer than 5 attempts), oldest first. FOR UPDATE SKIP LOCKED becomes a conditional update per row: a row
 * another worker claimed meanwhile (attempts changed) is skipped. Service role.
 */
export async function claimNotifications(sql: Sql): Promise<Notification[]> {
  const t = serviceTenant(sql),
    stamp = now();
  const due = (await t.selectGlobal<Notification>("notification_outbox", { where: { attempts: { op: "<", value: 5 }, next_at: { op: "<=", value: stamp } }, order: [["created_at", "asc"]] }))
    .filter((n) => n.status === "queued" || (n.status === "processing" && n.lease_until !== null && ms(n.lease_until) < ms(stamp)))
    .slice(0, 5);
  const out: Notification[] = [];
  const lease = new Date(ms(stamp) + 120000).toISOString();
  for (const n of due) {
    const s = t.updateGlobalStmt("notification_outbox", { id: n.id, status: n.status, attempts: n.attempts, lease_until: n.lease_until }, { status: "processing", attempts: n.attempts + 1, lease_until: lease });
    const [row] = await sql.all<Data>(s.sql, s.params);
    if (row) out.push(decode<Notification>(tables.notification_outbox, row));
  }
  return out;
}

// ---------- project stages ----------

/** The ten stages every project starts with (the same list as entities.ts uses for save_entity). */
export const projectStages: [key: string, ordinal: number, department: string, label: string, english: string][] = [
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
/**
 * project_stage_init_trigger (AFTER INSERT on entities when kind = 'projects'): the stage rows for a project being
 * inserted in the same batch. Existing stages are kept (on conflict do nothing).
 */
export const projectStageStmts = (t: Tenant, projectId: string): Stmt[] =>
  projectStages.map(([key, ordinal, department, label, english]) => t.upsertStmt("project_stages", { project_id: projectId, key, ordinal, department, label, english }, ["project_id", "key"], []));
/** init_project_stages(): adds any missing stages to an existing project of this company; anything else is ignored. */
export async function initProjectStages(t: Tenant, projectId: string): Promise<void> {
  const [p] = await t.selectInternal("entities", { where: { id: projectId, kind: "projects" } });
  if (!p) return;
  await t.atomic(projectStageStmts(t, projectId));
}
