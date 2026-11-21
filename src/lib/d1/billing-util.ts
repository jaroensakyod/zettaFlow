// Shared bits of the billing port (billing-*.ts): errors with the exact Postgres text, Postgres-style time arithmetic,
// counts inside a company, and the "service role" tenant used by functions Postgres only granted to service_role
// (confirm_payment, confirm_topup, admin_grant_plan, admin_revoke_grant, add_platform_customer, expire_subscriptions).
import { AppError } from "../domain";
import type { Sql, SqlValue, Stmt } from "./driver";
import { Tenant } from "./tenant";

export type Row = Record<string, unknown>;
export const fail = (message: string, status = 400): never => {
  throw new AppError(message, status);
};
export const iso = () => new Date().toISOString();
const DAY = 86400000;
export const addDays = (at: string, days: number) => new Date(Date.parse(at) + days * DAY).toISOString();
/** timestamptz + interval 'n months' (UTC): the day is clamped to the last day of the target month, like Postgres. */
export function addMonths(at: string, months: number) {
  const d = new Date(at),
    y = d.getUTCFullYear(),
    m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).toISOString();
}
/** greatest(a, b) on timestamps. */
export const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? new Date(a).toISOString() : new Date(b).toISOString());
/** date_trunc('month', now()) in UTC (the Supabase session time zone). */
export const monthStart = (at: string) => at.slice(0, 7) + "-01T00:00:00.000Z";
/** Postgres trim(text): spaces only, not every whitespace. */
export const trimSp = (s: string | null) => (s === null ? null : s.replace(/^ +| +$/g, ""));
/** jsonb ->> key: strings as they are, other JSON values as text, missing/null as null. */
export const txt = (o: Row | null | undefined, k: string): string | null => {
  const v = o?.[k];
  return v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v);
};
/** text::uuid — accepts what Postgres accepts in practice (hyphenated or 32 hex digits), else its exact error. */
export function toUuid(s: string): string {
  const h = s.trim().replace(/^\{|\}$/g, "");
  const m = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/i.exec(h);
  if (!m) fail(`invalid input syntax for type uuid: "${s}"`);
  return m!.slice(1).join("-").toLowerCase();
}
/** SQLite constraint errors → the text Postgres raises for the same violation. */
export function pgConstraint(e: unknown): never {
  const msg = String((e as Error)?.message || "");
  let m = /CHECK constraint failed: (([a-z_]+?)_[a-z_]+_check)/.exec(msg);
  if (m) {
    const name = m[1],
      table = ["feed_ads", "plan_grants", "billing_payments", "coin_topups", "coin_wallets", "subscriptions", "company_shop_items"].find((t) => name.startsWith(t + "_")) || m[2];
    throw new AppError(`new row for relation "${table}" violates check constraint "${name}"`, 400);
  }
  m = /NOT NULL constraint failed: ([a-z_]+)\.([a-z_]+)/.exec(msg);
  if (m) throw new AppError(`null value in column "${m[2]}" of relation "${m[1]}" violates not-null constraint`, 400);
  throw e;
}

/**
 * The tenant for work Postgres did as service_role / SECURITY DEFINER on a company the caller names: auth.uid() is
 * null there, so nothing written here takes the viewer's id. The caller must already have checked who may do this
 * (platform admin: PLATFORM_ADMIN_EMAILS, cron secret, …).
 */
export const serviceTenant = (sql: Sql, companyId = "") => new Tenant(sql, { userId: "", email: "", companyId, role: "owner", departments: [] });

// Counts without loading rows. Tenant has no count that skips the per-person read rule (selectInternal loads whole
// rows), so this reads the driver Tenant was built with — see the report: Tenant.countInternal would replace it.
const sqlOf = (t: Tenant): Sql => (t as unknown as { sql: Sql }).sql;
export type Counted = "ingestions" | "ai_usage" | "line_groups" | "memberships" | "data_templates";
/** select count(*) from <table> where company_id = c [and <extra>] — `extra` is fixed text from this port, never input. */
export async function countIn(t: Tenant, table: Counted, c: string, extra = "", params: SqlValue[] = []): Promise<number> {
  const [r] = await sqlOf(t).all<{ n: number }>(`SELECT count(*) AS n FROM "${table}" WHERE company_id = ?${extra ? ` AND ${extra}` : ""}`, [c, ...params]);
  return Number(r?.n || 0);
}
/** A batch step that aborts (ConflictError) unless that count is still below `limit` — the quota's FOR UPDATE. */
export const countBelowStmt = (table: Counted, c: string, limit: number, extra = "", params: SqlValue[] = []): Stmt => ({
  sql: `SELECT CASE WHEN (SELECT count(*) FROM "${table}" WHERE company_id = ?${extra ? ` AND ${extra}` : ""}) < ? THEN 1 ELSE json('changed') END`,
  params: [c, ...params, limit],
});
