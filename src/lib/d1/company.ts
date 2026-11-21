// The company, its members, support chat, presence and messages for D1, step for step after the Postgres functions
// (create_company, save_company, invite_member, accept_invitations, edit_member, member_role, support_viewer,
// support_send / support_reply / support_seen, end_support_access, presence_ping, company_card, company_cover,
// send_message) and the triggers their inserts fire: companies_trial (start_trial) and companies_seed_accounts on a
// new company, quota_users (enforce_quota('users')) and memberships_platform_customer on a new membership.
// Sample data lives in company-sample.ts; shares, notes, dashboard layout and the notification outbox in
// company-share.ts.
import { randomUUID } from "node:crypto";
import { AppError } from "../domain";
import type { Role } from "../types";
import { canWriteDept, type Viewer } from "./access";
import type { Sql, Stmt } from "./driver";
import { Tenant } from "./tenant";

type Data = Record<string, unknown>;
export const fail = (message: string, status = 400): never => {
  throw new AppError(message, status);
};
export const now = () => new Date().toISOString();
/** Postgres trim(text): spaces only, not tabs or newlines. */
export const pgTrim = (s: string) => s.replace(/^ +| +$/g, "");
/** Postgres length(text) / left(text, n): characters, not UTF-16 units. */
export const pgLen = (s: string) => [...s].length;
export const pgLeft = (s: string, n: number) => [...s].slice(0, n).join("");
/** jsonb ->> key: strings as they are, other values as their JSON text, missing / null as null. */
export const pgText = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v));
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const audit = (t: Tenant, action: string, target: string) => t.insertStmt("audit_events", { actor: t.viewer.userId, action, target });

/**
 * A Tenant for the service-role functions (support_reply, claim_notifications, share_*): no person, nothing checked.
 * Callers must only reach these from trusted server code (the admin console, the outbox worker, the share page).
 */
export const serviceTenant = (sql: Sql, companyId = "") => new Tenant(sql, { userId: "", email: "", companyId, role: "owner", departments: [] });

/**
 * The signed-in person before they belong to a company (create_company, accept_invitations): what Postgres read from
 * auth.users and the JWT. `name` is raw_user_meta_data->>'name'; `emailConfirmed` is email_confirmed_at is not null.
 */
export type SignedInUser = { userId: string; email: string; name?: string | null; emailConfirmed: boolean };

// ---------- roles ----------

/** support_viewer(c): a platform admin with an open, unexpired support session on this company. */
export async function supportViewer(sql: Sql, userId: string, companyId: string): Promise<boolean> {
  const stamp = now();
  const rows = await serviceTenant(sql).selectGlobal<{ expires_at: string }>("support_access", { where: { company_id: companyId, user_id: userId, ended_at: null } });
  return rows.some((r) => ms(r.expires_at) > ms(stamp));
}
/**
 * member_role(c): the person's role in the company (not when disabled), else 'viewer' for a support session, else
 * null. Inside the ported functions this is viewer.role; this helper is for building the Viewer of a request.
 */
export async function memberRole(sql: Sql, userId: string, companyId: string): Promise<Role | null> {
  const [m] = await serviceTenant(sql).selectGlobal<{ role: Role }>("memberships", { where: { company_id: companyId, user_id: userId, disabled: false } });
  if (m) return m.role;
  return (await supportViewer(sql, userId, companyId)) ? "viewer" : null;
}

// ---------- quota_users: BEFORE INSERT on memberships ----------

type Sub = { plan: string; status: string; trial_ends_at: string; current_period_end: string | null; extra_users: number };
/** effective_plan(c): a running trial or an active plan (3 days' grace after its period), else free. */
export function effectivePlan(s: Sub, stamp: string): string {
  if (s.status === "trial" && ms(s.trial_ends_at) > ms(stamp)) return s.plan;
  if (s.status === "active" && (s.current_period_end === null || ms(s.current_period_end) > ms(stamp) - 3 * 86400000)) return s.plan;
  return "free";
}
/**
 * enforce_quota('users') for a membership about to be inserted (not disabled). `known` gives the subscription and
 * member count of a company that does not exist yet (create_company: its rows are written in the same batch).
 */
async function checkUsersQuota(t: Tenant, companyId: string, stamp: string, known?: { sub: Sub; members: number }) {
  const sub = known ? known.sub : (await t.selectGlobal<Sub>("subscriptions", { where: { company_id: companyId } }))[0];
  if (!sub) return; // plan_limit: no subscription row, no limit
  const trial = sub.status === "trial" && ms(sub.trial_ends_at) > ms(stamp);
  const [plan] = await t.selectGlobal<{ id: string; users: number | null }>("plans", { where: { id: effectivePlan(sub, stamp) } });
  if (!plan) return;
  const [tl] = await t.selectGlobal<{ amount: number; label: string }>("trial_limits", { where: { resource: "users" } });
  const limit = trial && tl ? Number(tl.amount) : plan.users === null ? null : Number(plan.users) + (plan.id === "free" ? 0 : Number(sub.extra_users));
  if (limit === null) return;
  const n = known ? known.members : (await t.selectGlobal("memberships", { where: { company_id: companyId, disabled: false } })).length;
  if (n >= limit)
    fail(trial ? `ช่วงทดลองใช้ได้สูงสุด ${limit} ${tl?.label ?? "users"} กรุณาเลือกแพ็กเกจเพื่อเพิ่ม` : effectivePlan(sub, stamp) === "free" ? `แพ็กเกจฟรีใช้ได้ ${limit} ผู้ใช้ อัปเกรดแพ็กเกจเพื่อเพิ่ม` : `เกินโควตาแพ็กเกจ (users: ${limit}) กรุณาอัปเกรด`);
}

// ---------- the company ----------

export type CreateCompanyOptions = {
  /**
   * companies_seed_accounts (seed_accounts(c)): the chart of accounts and the HQ cost centre, as statements for the
   * new company's Tenant. Pass finance.ts's seeding here; it is a callback so this file does not depend on it.
   */
  seedAccounts: (t: Tenant) => Stmt[];
  /**
   * memberships_platform_customer (add_platform_customer): records the new owner's company as a customer of the
   * platform company. Postgres ran it in the same transaction but swallowed every error, so here it runs after the
   * batch and its errors are swallowed too.
   */
  afterOwnerJoined?: (companyId: string) => Promise<unknown>;
};
/**
 * create_company(): runs before the person has a company, so it takes the signed-in user instead of a Viewer and
 * builds the Tenant of the new company itself (the person as its owner). Returns the new company id.
 */
export async function createCompany(sql: Sql, user: SignedInUser, name: string, opts: CreateCompanyOptions): Promise<string> {
  if (!user.userId || !user.emailConfirmed) fail("ยืนยันอีเมลก่อนสร้างบริษัท");
  const clean = pgTrim(name ?? "");
  if (pgLen(clean) < 1 || pgLen(clean) > 200) fail("ชื่อบริษัทไม่ถูกต้อง");
  const id = randomUUID(),
    stamp = now();
  const t = new Tenant(sql, { userId: user.userId, email: user.email, companyId: id, role: "owner", departments: [] });
  // start_trial(): every new company starts on Free.
  const sub: Sub = { plan: "free", status: "active", trial_ends_at: new Date(ms(stamp) + 14 * 86400000).toISOString(), current_period_end: null, extra_users: 0 };
  await checkUsersQuota(t, id, stamp, { sub, members: 0 });
  await t.atomic([
    t.insertGlobalStmt("companies", { id, name: clean, profile: { name: clean } }),
    ...opts.seedAccounts(t),
    t.upsertStmt("subscriptions", { plan: sub.plan, status: sub.status }, ["company_id"], []),
    t.insertStmt("memberships", { user_id: user.userId, name: user.name ?? user.email, email: user.email.toLowerCase(), role: "owner" }),
    audit(t, "company_created", id),
  ]);
  if (opts.afterOwnerJoined) await opts.afterOwnerJoined(id).catch(() => null);
  return id;
}

/** save_company(): the owner edits the company profile (and settings when given). */
export async function saveCompany(t: Tenant, profile: Data, settings?: Data | null): Promise<void> {
  if (t.viewer.role !== "owner") fail("เฉพาะเจ้าของบริษัท");
  const name = pgText(profile?.name);
  if (name !== null && (pgLen(pgTrim(name)) < 1 || pgLen(pgTrim(name)) > 200)) fail("ชื่อบริษัทไม่ถูกต้อง");
  if (name === null) fail('null value in column "name" of relation "companies" violates not-null constraint');
  const id = t.viewer.companyId;
  await t.atomic([t.updateGlobalStmt("companies", { id }, { name, profile, settings: settings ?? undefined }), audit(t, "company_updated", id)]);
}

/** company_card(id): the public card of any company, for signed-in people. */
export async function companyCard(t: Tenant, id: string): Promise<Data | null> {
  if (!t.viewer.userId) return null;
  const [c] = await t.selectGlobal<{ id: string; name: string; profile: Data }>("companies", { where: { id } });
  if (!c) return null;
  const p = c.profile || {};
  return { id: c.id, name: c.name, industry: pgText(p.industry) ?? "", province: pgText(p.province) ?? "", about: pgLeft(pgText(p.description) ?? "", 300), logo: pgText(p.logo) ?? "" };
}
/** company_cover(id): the cover image of any company, for signed-in people. */
export async function companyCover(t: Tenant, id: string): Promise<string | null> {
  if (!t.viewer.userId) return null;
  const [c] = await t.selectGlobal<{ profile: Data }>("companies", { where: { id } });
  const cover = pgText(c?.profile?.cover);
  return cover === "" ? null : cover;
}

// ---------- members ----------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** invite_member(): the owner invites (or re-invites) an email for 7 days. */
export async function inviteMember(t: Tenant, email: string, role: string, departments: string[]): Promise<void> {
  if (t.viewer.role !== "owner") fail("เฉพาะเจ้าของบริษัท");
  if (!["manager", "staff", "viewer"].includes(role) || !departments?.length || !EMAIL.test(email)) fail("คำเชิญไม่ถูกต้อง");
  const stamp = now();
  await t.atomic([
    t.upsertStmt("invitations", { email: pgTrim(email).toLowerCase(), role, departments, expires_at: new Date(ms(stamp) + 7 * 86400000).toISOString(), accepted_at: null }, ["company_id", "email"], ["role", "departments", "expires_at", "accepted_at"]),
    audit(t, "member_invited", email),
  ]);
}

type Invitation = { id: string; company_id: string; email: string; role: string; departments: string[]; expires_at: string; accepted_at: string | null };
/**
 * accept_invitations(): on sign-in, every open invitation to the person's email becomes a membership. Takes the
 * signed-in user (no Viewer: the person may not belong to any company yet); the email is the JWT's.
 */
export async function acceptInvitations(sql: Sql, user: SignedInUser): Promise<void> {
  if (!user.userId || !user.emailConfirmed) return;
  const stamp = now();
  const t = new Tenant(sql, { userId: user.userId, email: user.email, companyId: "", role: "viewer", departments: [] });
  const open = (await t.selectGlobal<Invitation>("invitations", { where: { email: user.email.toLowerCase(), accepted_at: null } })).filter((i) => ms(i.expires_at) > ms(stamp));
  const stmts: Stmt[] = [];
  for (const i of open) {
    await checkUsersQuota(t, i.company_id, stamp); // quota_users fires before ON CONFLICT is looked at
    stmts.push(
      t.guardGlobalStmt("invitations", { id: i.id, accepted_at: null }),
      t.upsertGlobalStmt("memberships", { company_id: i.company_id, user_id: user.userId, name: user.name ?? user.email, email: user.email.toLowerCase(), role: i.role, departments: i.departments }, ["company_id", "user_id"], []),
      t.updateGlobalStmt("invitations", { id: i.id }, { accepted_at: stamp }),
    );
  }
  if (stmts.length) await t.atomic(stmts);
}

/** edit_member(): the owner changes a member's role, departments or disabled flag (never another owner). */
export async function editMember(t: Tenant, id: string, role: string, departments: string[], disabled: boolean): Promise<void> {
  if (t.viewer.role !== "owner") fail("เฉพาะเจ้าของบริษัท");
  if (!["manager", "staff", "viewer"].includes(role) || !departments?.length) fail("บทบาทหรือแผนกไม่ถูกต้อง");
  const [m] = await t.selectInternal<{ role: string }>("memberships", { where: { id } });
  if (!m || m.role === "owner") fail("ไม่พบสมาชิกที่แก้ไขได้");
  await t.atomic([t.guardStmt("memberships", { id, role: { op: "!=", value: "owner" } }), t.updateStmt("memberships", { id }, { role, departments, disabled }), audit(t, "member_updated", id)]);
}

/** presence_ping(): marks the person online (at most every 20 s) and says who is online in the given companies. */
export async function presencePing(t: Tenant, companies: string[] = []): Promise<{ companies: string[]; users: string[] }> {
  const v = t.viewer;
  if (!v.userId) fail("ต้องเข้าสู่ระบบ");
  const [me] = await t.selectInternal<{ last_seen_at: string | null }>("memberships", { where: { user_id: v.userId, disabled: false } });
  if (!me) fail("ไม่มีสิทธิ์");
  if ((companies?.length ?? 0) > 300) fail("รายการยาวเกินไป");
  const stamp = now();
  if (me!.last_seen_at === null || ms(me!.last_seen_at) < ms(stamp) - 20000) await t.update("memberships", { user_id: v.userId }, { last_seen_at: stamp });
  const since = new Date(ms(stamp) - 120000).toISOString();
  const online = await t.selectGlobal<{ company_id: string; user_id: string }>("memberships", { where: { company_id: [...(companies || []), v.companyId], disabled: false, last_seen_at: { op: ">", value: since } } });
  return {
    companies: [...new Set(online.map((m) => m.company_id))].sort(),
    users: online.filter((m) => m.company_id === v.companyId).map((m) => m.user_id),
  };
}

// ---------- messages and support ----------

export type Message = { id: string; company_id: string; department: string; channel: string; body: string; user_id: string; name: string; created_at: string };
/** send_message(): a message in a department channel. */
export async function sendMessage(t: Tenant, department: string, body: string): Promise<Message> {
  const v = t.viewer;
  if (!canWriteDept(v, department)) fail("ไม่มีสิทธิ์ส่งข้อความ");
  const [m] = await t.selectInternal<{ name: string }>("memberships", { where: { user_id: v.userId } });
  const text = body === null || body === undefined ? null : pgTrim(body);
  // The table's own checks, with Postgres's wording.
  if (text === null) fail('null value in column "body" of relation "messages" violates not-null constraint');
  if (!m) fail('null value in column "name" of relation "messages" violates not-null constraint');
  if (pgLen(text!) < 1 || pgLen(text!) > 4000) fail('new row for relation "messages" violates check constraint "messages_body_check"');
  const id = randomUUID();
  await t.atomic([t.insertStmt("messages", { id, department, channel: department, body: text, user_id: v.userId, name: m!.name })]);
  return (await t.selectInternal<Message>("messages", { where: { id } }))[0];
}

export type SupportMessage = { id: string; company_id: string; sender: "customer" | "admin"; user_id: string | null; name: string; body: string; created_at: string };
/**
 * support_send(): an owner or manager writes to the platform team. (Postgres let a non-member through here because
 * member_role() is null for them and `null not in (...)` is not true; a D1 Viewer always has a role.)
 */
export async function supportSend(t: Tenant, body: string): Promise<SupportMessage> {
  const v = t.viewer;
  if (!["owner", "manager"].includes(v.role)) fail("เฉพาะ Owner หรือ Manager");
  const text = pgTrim(body ?? "");
  if (pgLen(text) < 1 || pgLen(text) > 4000) fail("ข้อความไม่ถูกต้อง");
  const [m] = await t.selectInternal<{ name: string; email: string }>("memberships", { where: { user_id: v.userId } });
  if (!m) fail('null value in column "name" of relation "support_messages" violates not-null constraint');
  const id = randomUUID(),
    stamp = now();
  await t.atomic([
    t.insertStmt("support_messages", { id, sender: "customer", user_id: v.userId, name: m!.name || m!.email, body: text }),
    t.upsertStmt("support_threads", { unread_admin: 1, status: "open", updated_at: stamp }, ["company_id"], ["status", "updated_at"], ["unread_admin"]),
  ]);
  return (await t.selectInternal<SupportMessage>("support_messages", { where: { id } }))[0];
}
/** support_reply(): the platform team answers a company (service role: the admin console checks the admin). */
export async function supportReply(sql: Sql, companyId: string, name: string | null, body: string): Promise<SupportMessage> {
  const text = pgTrim(body ?? "");
  if (pgLen(text) < 1 || pgLen(text) > 4000) fail("ข้อความไม่ถูกต้อง");
  const t = serviceTenant(sql, companyId),
    id = randomUUID(),
    stamp = now();
  await t.atomic([
    t.insertStmt("support_messages", { id, sender: "admin", name: pgLeft(name || "ทีมงาน ZettaFlow", 100), body: text }),
    t.upsertStmt("support_threads", { unread_customer: 1, unread_admin: 0, updated_at: stamp }, ["company_id"], ["unread_admin", "updated_at"], ["unread_customer"]),
  ]);
  return (await t.selectInternal<SupportMessage>("support_messages", { where: { id } }))[0];
}
/** support_seen(): an owner or manager has read the team's answers. Anyone else: nothing happens. */
export async function supportSeen(t: Tenant): Promise<void> {
  if (!["owner", "manager"].includes(t.viewer.role) || t.viewer.support) return;
  await t.atomic([t.updateStmt("support_threads", { company_id: t.viewer.companyId }, { unread_customer: 0 })]);
}

export type SupportAccess = { id: string; company_id: string; user_id: string; admin_email: string; reason: string; started_at: string; expires_at: string; ended_at: string | null; ended_by: string | null };
/** end_support_access(): an owner or manager of that company ends a platform admin's support session. */
export async function endSupportAccess(t: Tenant, id: string): Promise<SupportAccess> {
  const v = t.viewer;
  const [a] = await t.selectGlobal<SupportAccess>("support_access", { where: { id } });
  const ok = a && (await t.selectGlobal("memberships", { where: { company_id: a.company_id, user_id: v.userId, disabled: false, role: ["owner", "manager"] } })).length;
  if (!ok) fail("เฉพาะเจ้าของหรือผู้จัดการ");
  const stamp = now();
  await t.atomic([
    t.guardGlobalStmt("support_access", { id, ended_at: a!.ended_at, ended_by: a!.ended_by }),
    t.updateGlobalStmt("support_access", { id }, { ended_at: a!.ended_at ?? stamp, ended_by: a!.ended_by ?? "ลูกค้า: " + (v.email ?? "") }),
    t.insertGlobalStmt("audit_events", { company_id: a!.company_id, actor: v.userId, action: "support_access_ended", target: a!.admin_email }),
  ]);
  return (await t.selectGlobal<SupportAccess>("support_access", { where: { id } }))[0];
}
