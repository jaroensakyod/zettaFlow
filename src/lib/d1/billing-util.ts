// Shared bits of the billing port (billing-*.ts): Postgres-style time arithmetic, counts inside a company, and (from
// common.ts) the error with the exact Postgres text and the "service role" tenant used by functions Postgres only
// granted to service_role (confirm_payment, confirm_topup, admin_grant_plan, admin_revoke_grant,
// add_platform_customer, expire_subscriptions).
import { AppError } from "../domain";
import type { Stmt } from "./driver";
import type { Cond, Tenant } from "./tenant";
import { fail, now, serviceTenant } from "./common";

export { fail, serviceTenant };
export type Row = Record<string, unknown>;
export const iso = now;
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
 * Counts inside a company without loading rows (select count(*) from <table> where company_id = c and ...): the
 * viewer's own company without the per-person read rule, another company through the global count.
 */
export type Counted = "ingestions" | "ai_usage" | "line_groups" | "memberships" | "data_templates";
export const countIn = (t: Tenant, table: Counted, c: string, where: Record<string, Cond> = {}): Promise<number> =>
  c === t.viewer.companyId ? t.countInternal(table, where) : t.countGlobal(table, { ...where, company_id: c });
/** A batch step that aborts (ConflictError) unless that count is still below `limit` - the quota's FOR UPDATE. */
export const countBelowStmt = (t: Tenant, table: Counted, c: string, limit: number, where: Record<string, Cond> = {}): Stmt =>
  c === t.viewer.companyId ? t.countBelowStmt(table, where, limit) : t.countBelowGlobalStmt(table, { ...where, company_id: c }, limit);
