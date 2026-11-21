// Platform-side billing for D1, after admin_grant_plan / admin_revoke_grant (0079) and platform_company /
// add_platform_customer / platform_customer_on_signup (0078). All of these were service_role only in Postgres: they
// never looked at auth.jwt() — the platform-admin check (PLATFORM_ADMIN_EMAILS, src/lib/admin-console.ts) happens in
// the caller, which passes the admin's email as `by`. They take the driver and work on whichever company they name.
import { randomUUID } from "node:crypto";
import { formatCode, thaiYear } from "../domain";
import { derive } from "../dept-rules";
import type { Sql, Stmt } from "./driver";
import { codePrefix } from "./entity-insert";
import { addDays, fail, iso, pgConstraint, serviceTenant, txt, type Row } from "./billing-util";
import { subscriptionOf, type Subscription } from "./billing-plan";

export type PlanGrant = { id: string; company_id: string; plan: string; kind: string; days: number; extra_users: number; reason: string; starts_at: string; ends_at: string; prev: Row; granted_by: string; revoked_at: string | null; revoked_by: string | null; created_at: string };

/** admin_grant_plan(): give a company a plan for `days` (extended from the current end when the same plan is running). */
export async function adminGrantPlan(sql: Sql, companyId: string, plan: string, kind: string, days: number, extraUsers: number | null, reason: string, by: string): Promise<PlanGrant> {
  const t = serviceTenant(sql, companyId),
    now = iso();
  if (!(await t.selectGlobal("companies", { where: { id: companyId }, limit: 1 })).length) fail("ไม่พบบริษัท", 404);
  if (plan === "free" || !(await t.selectGlobal("plans", { where: { id: plan }, limit: 1 })).length) fail("แพ็กเกจไม่ถูกต้อง");
  const stmts: Stmt[] = [];
  let s = await subscriptionOf(t, companyId);
  if (s) stmts.push(t.guardStmt("subscriptions", { updated_at: s.updated_at }));
  else {
    // insert into subscriptions(company_id) … on conflict do nothing: the column defaults, written out.
    s = { company_id: companyId, plan: "free", cycle: "monthly", status: "active", trial_ends_at: addDays(now, 14), current_period_end: null, addons: [], extra_users: 0, updated_at: now };
    stmts.push(t.upsertStmt("subscriptions", { ...s, company_id: undefined }, ["company_id"], []));
  }
  const running = s.plan === plan && s.status === "active" && s.current_period_end !== null && Date.parse(s.current_period_end) > Date.parse(now);
  const ends = addDays(running ? s.current_period_end! : now, days);
  const id = randomUUID();
  stmts.push(
    t.insertStmt("plan_grants", { id, plan, kind, days, extra_users: extraUsers ?? 0, reason, starts_at: now, ends_at: ends, prev: s, granted_by: by, created_at: now }),
    t.updateStmt("subscriptions", { company_id: companyId }, { plan, status: "active", current_period_end: ends, extra_users: Math.max(Number(s.extra_users), extraUsers ?? 0), updated_at: now }),
    t.insertStmt("audit_events", { action: "admin_grant_plan", target: `${plan} ${days}d by ${by}`, created_at: now }),
  );
  try {
    await t.atomic(stmts);
  } catch (e) {
    pgConstraint(e);
  }
  return (await t.selectInternal<PlanGrant>("plan_grants", { where: { id } }))[0];
}

/** admin_revoke_grant(): undo the company's latest grant — its subscription goes back to what the grant replaced. */
export async function adminRevokeGrant(sql: Sql, id: string, by: string): Promise<PlanGrant> {
  const [g] = await serviceTenant(sql).selectGlobal<PlanGrant>("plan_grants", { where: { id } });
  if (!g || g.revoked_at) fail("สิทธิ์นี้ถูกยกเลิกไปแล้ว", 409);
  const t = serviceTenant(sql, g!.company_id),
    now = iso();
  if ((await t.selectInternal("plan_grants", { where: { created_at: { op: ">", value: g!.created_at }, revoked_at: null }, limit: 1 })).length) fail("มีการมอบแพ็กเกจที่ใหม่กว่านี้ ยกเลิกรายการล่าสุดก่อน", 409);
  const p = (g!.prev || {}) as Partial<Subscription>;
  const cpe = txt(p as Row, "current_period_end");
  const extra = txt(p as Row, "extra_users");
  await t.atomic([
    t.guardStmt("plan_grants", { id, revoked_at: null }),
    t.updateStmt("subscriptions", { company_id: g!.company_id }, { plan: txt(p as Row, "plan") ?? "free", status: txt(p as Row, "status") ?? "active", current_period_end: cpe ? new Date(cpe).toISOString() : null, extra_users: extra === null ? 0 : Number.parseInt(extra, 10), updated_at: now }),
    t.updateStmt("plan_grants", { id }, { revoked_at: now, revoked_by: by }),
    t.insertStmt("audit_events", { action: "admin_revoke_grant", target: `${g!.plan} by ${by}`, created_at: now }),
  ]);
  return (await t.selectInternal<PlanGrant>("plan_grants", { where: { id } }))[0];
}

/** platform_company(): EliteFlow's own workspace, where every signed-up company is a customer. */
export const platformCompany = () => "c6990704-26d6-4b1e-8c1c-6a5c5dff083d";

const initcap = (s: string) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
/** to_char(t at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') */
function bangkok(at: string) {
  const d = new Date(Date.parse(at) + 7 * 3600000),
    p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * add_platform_customer(): the company becomes a customer record in EliteFlow's workspace (once; the existing one is
 * returned after that). Null when there is no platform workspace, for the platform itself, or an unknown company.
 * The customer insert goes through what the entities BEFORE triggers did to it (CUS code, dept_derive).
 */
export async function addPlatformCustomer(sql: Sql, companyId: string | null, pc = platformCompany()): Promise<string | null> {
  const t = serviceTenant(sql, pc);
  if (!companyId || companyId === pc || !(await t.selectGlobal("companies", { where: { id: pc }, limit: 1 })).length) return null;
  const mine = serviceTenant(sql, companyId);
  const [link] = await mine.selectInternal<{ customer_id: string }>("platform_customers");
  if (link?.customer_id) return link.customer_id;
  const [c] = await t.selectGlobal<{ id: string; name: string; profile: Row; created_at: string }>("companies", { where: { id: companyId } });
  if (!c) return null;
  const [o] = await mine.selectInternal<{ name: string; email: string }>("memberships", { where: { role: "owner" }, order: [["disabled", "asc"]], limit: 1 });
  const [po] = await t.selectInternal<{ user_id: string }>("memberships", { where: { role: "owner", disabled: false }, limit: 1 });
  const plan = (await subscriptionOf(t, companyId))?.plan ?? null;
  const nz = (v: string | null | undefined) => (v === "" || v === undefined ? null : v);
  const raw: Row = {
    name: c.name,
    type: "นิติบุคคล",
    status: "active",
    contact: nz(o?.name),
    email: nz(o?.email),
    taxId: nz(txt(c.profile, "taxId")),
    phone: nz(txt(c.profile, "phone")),
    notes: "สมัครใช้งาน EliteFlow เมื่อ " + bangkok(c.created_at ?? iso()) + (plan === null ? "" : " · แพ็กเกจ " + (plan === "free" ? "ฟรี" : initcap(plan))),
  };
  let data: Row = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null));
  const prefix = codePrefix.customers;
  data = { ...data, code: formatCode(prefix, thaiYear(), await t.nextNumber(prefix, 0)) };
  data = { ...data, ...derive("customers", data) };
  const [schema] = await t.selectGlobal<{ department: string }>("entity_schemas", { where: { kind: "customers" } });
  const cid = randomUUID();
  await t.atomic([
    t.insertStmt("entities", { id: cid, kind: "customers", department: schema?.department ?? "Sales", data, created_by: po?.user_id ?? null }),
    mine.insertStmt("platform_customers", { customer_id: cid }),
  ]);
  return cid;
}

/**
 * platform_customer_on_signup — the AFTER INSERT trigger memberships_platform_customer on memberships (when the new
 * row's role is 'owner'). Call it after the batch that added the owner has committed; it never fails the sign-up.
 */
export async function platformCustomerOnSignup(sql: Sql, companyId: string): Promise<void> {
  try {
    await addPlatformCustomer(sql, companyId);
  } catch {
    /* never blocks the sign-up */
  }
}
