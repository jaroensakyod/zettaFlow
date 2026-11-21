// The plan a company is on and what it may use, for D1 — after effective_plan, trial_valid, on_trial, trial_limit,
// plan_limit, has_addon, subscription_active, trial_usage, enforce_quota, start_trial and expire_subscriptions
// (latest definitions: 0060_free_plan.sql). Free never expires: a finished trial or a paid plan more than 3 days past
// its period falls back to Free (1 LINE group, 3 users, 3 forms, 300 items a month; other departments are locked app
// side). Read helpers take the company (default: the viewer's) and one `now` per call, like Postgres now().
import type { Sql, Stmt } from "./driver";
import type { Tenant } from "./tenant";
import { addDays, countBelowStmt, countIn, fail, iso, monthStart, serviceTenant } from "./billing-util";

export type Subscription = {
  company_id: string;
  plan: string;
  cycle: string;
  status: string;
  trial_ends_at: string;
  current_period_end: string | null;
  addons: string[];
  extra_users: number;
  updated_at: string;
};
export type PlanRow = { id: string; name: string; monthly: number; yearly: number; workflows: number | null; documents: number | null; line_groups: number | null; users: number | null };
export type Resource = "workflows" | "documents" | "line_groups" | "users";
const DAY = 86400000;

export async function subscriptionOf(t: Tenant, c = t.viewer.companyId): Promise<Subscription | null> {
  return (await t.selectGlobal<Subscription>("subscriptions", { where: { company_id: c } }))[0] ?? null;
}
const trialValidOf = (s: Subscription | null, now: string) => !!s && s.status === "trial" && Date.parse(s.trial_ends_at) > Date.parse(now);
const effectiveOf = (s: Subscription | null, now: string): string | null =>
  !s
    ? null
    : trialValidOf(s, now)
      ? s.plan
      : s.status === "active" && (s.current_period_end === null || Date.parse(s.current_period_end) > Date.parse(now) - 3 * DAY)
        ? s.plan
        : "free";

/** effective_plan(c): a running trial or a paid plan within its period (+3 days), otherwise 'free'; null without a subscription. */
export async function effectivePlan(t: Tenant, c = t.viewer.companyId, now = iso()) {
  return effectiveOf(await subscriptionOf(t, c), now);
}
/** trial_valid(c) — also on_trial(c), which is the same function. */
export async function trialValid(t: Tenant, c = t.viewer.companyId, now = iso()) {
  return trialValidOf(await subscriptionOf(t, c), now);
}
export const onTrial = trialValid;
/** subscription_active(c): every company with a subscription may work (Free never expires). */
export async function subscriptionActive(t: Tenant, c = t.viewer.companyId) {
  return !!(await subscriptionOf(t, c));
}
/** trial_limit(r): the trial ceiling for a resource, or null. */
export async function trialLimit(t: Tenant, r: string): Promise<number | null> {
  const [x] = await t.selectGlobal<{ amount: number }>("trial_limits", { where: { resource: r } });
  return x ? Number(x.amount) : null;
}
async function limitOf(t: Tenant, s: Subscription | null, r: string, now: string): Promise<number | null> {
  if (!s) return null;
  const ep = effectiveOf(s, now);
  const [p] = await t.selectGlobal<PlanRow>("plans", { where: { id: ep } });
  if (!p) return null;
  if (trialValidOf(s, now)) {
    const tl = await trialLimit(t, r);
    if (tl !== null) return tl;
  }
  if (r === "workflows") return p.workflows;
  if (r === "documents") return p.documents;
  if (r === "line_groups") return p.line_groups;
  if (r === "users") return p.users === null ? null : p.users + (p.id === "free" ? 0 : Number(s.extra_users));
  return null;
}
/** plan_limit(c, r): the ceiling in force for workflows / documents / line_groups / users (null = unlimited). */
export async function planLimit(t: Tenant, r: string, c = t.viewer.companyId, now = iso()) {
  return limitOf(t, await subscriptionOf(t, c), r, now);
}
/** has_addon(c, a): a trial has everything; Enterprise includes OCR Plus and the executive dashboard; paid add-ons. */
export async function hasAddon(t: Tenant, a: string, c = t.viewer.companyId, now = iso()) {
  const s = await subscriptionOf(t, c);
  if (!s) return false;
  const ep = effectiveOf(s, now);
  return trialValidOf(s, now) || (ep === "enterprise" && ["ocr_plus", "exec_dashboard"].includes(a)) || (ep !== "free" && (s.addons || []).includes(a));
}

export type Meter = { used: number; limit: number | null };
export type TrialUsage = { kind: "free" | "trial"; ends_at: string | null; documents: Meter; ai_files: Meter; ai_chat: Meter; ai_calls: Meter; line_groups: Meter; users: Meter };
/** trial_usage(c): allowance meters for a running trial (its 14 days) or Free (this calendar month); null on a paid plan. */
export async function trialUsage(t: Tenant, c = t.viewer.companyId, now = iso()): Promise<TrialUsage | null> {
  const s = await subscriptionOf(t, c);
  if (!s) return null;
  let from: string, free: boolean;
  if (trialValidOf(s, now)) (from = addDays(s.trial_ends_at, -14)), (free = false);
  else if (effectiveOf(s, now) === "free") (from = monthStart(now)), (free = true);
  else return null;
  const freeLimit = async (r: string) => {
    const [x] = await t.selectGlobal<{ amount: number }>("free_limits", { where: { resource: r } });
    return x ? Number(x.amount) : null;
  };
  const allowance = (r: string) => (free ? freeLimit(r) : trialLimit(t, r));
  return {
    kind: free ? "free" : "trial",
    ends_at: free ? null : s.trial_ends_at,
    documents: { used: await countIn(t, "ingestions", c, "created_at >= ?", [from]), limit: free ? await limitOf(t, s, "documents", now) : await trialLimit(t, "documents") },
    ai_files: { used: await countIn(t, "ai_usage", c, "has_file = 1 AND created_at >= ?", [from]), limit: await allowance("ai_files") },
    ai_chat: { used: await countIn(t, "ai_usage", c, "feature = 'chat' AND created_at >= ?", [from]), limit: await allowance("ai_chat") },
    ai_calls: { used: await countIn(t, "ai_usage", c, "created_at >= ?", [from]), limit: await allowance("ai_calls") },
    line_groups: { used: await countIn(t, "line_groups", c), limit: await limitOf(t, s, "line_groups", now) },
    users: { used: await countIn(t, "memberships", c, "disabled = 0"), limit: await limitOf(t, s, "users", now) },
  };
}

const RESOURCE_TH: Record<string, string> = { line_groups: "กลุ่ม LINE", users: "ผู้ใช้", workflows: "ฟอร์ม" };
/**
 * enforce_quota — the BEFORE INSERT triggers quota_workflows (data_templates), quota_line_groups (line_groups),
 * quota_users (memberships) and quota_documents (ingestions). Every save path that inserts one of those rows calls this
 * first with the row it is about to insert: it throws the exact Postgres message when the company is at its ceiling,
 * and returns batch steps to put BEFORE the insert, which abort the batch (ConflictError) if a concurrent insert used
 * the last slot meanwhile. `row.company_id` defaults to the viewer's company.
 */
export async function enforceQuota(t: Tenant, r: Resource, row: { company_id?: string; group_id?: string; disabled?: boolean } = {}, now = iso()): Promise<Stmt[]> {
  const c = row.company_id || t.viewer.companyId;
  const s = await subscriptionOf(t, c),
    ep = effectiveOf(s, now);
  if (r === "documents") {
    if (trialValidOf(s, now)) {
      const l = await trialLimit(t, "documents");
      if (l === null) return [];
      const from = addDays(s!.trial_ends_at, -14);
      if ((await countIn(t, "ingestions", c, "created_at >= ?", [from])) >= l) fail(`ช่วงทดลองใช้ครบ ${l} รายการแล้ว กรุณาเลือกแพ็กเกจเพื่อใช้งานต่อ`);
      return [countBelowStmt("ingestions", c, l, "created_at >= ?", [from])];
    }
    if (ep === "free") {
      const l = await limitOf(t, s, "documents", now);
      if (l === null) return [];
      const from = monthStart(now);
      if ((await countIn(t, "ingestions", c, "created_at >= ?", [from])) >= l) fail(`แพ็กเกจฟรีใช้ได้ ${l} รายการต่อเดือน ครบแล้ว อัปเกรดแพ็กเกจเพื่อใช้งานต่อ`);
      return [countBelowStmt("ingestions", c, l, "created_at >= ?", [from])];
    }
    return [];
  }
  const l = await limitOf(t, s, r, now);
  if (l === null) return [];
  let guard: Stmt;
  let n: number;
  if (r === "workflows") (n = await countIn(t, "data_templates", c)), (guard = countBelowStmt("data_templates", c, l));
  else if (r === "line_groups") {
    if (row.group_id && (await t.selectGlobal("line_groups", { where: { group_id: row.group_id }, limit: 1 })).length) return [];
    (n = await countIn(t, "line_groups", c)), (guard = countBelowStmt("line_groups", c, l));
  } else {
    if (row.disabled) return [];
    (n = await countIn(t, "memberships", c, "disabled = 0")), (guard = countBelowStmt("memberships", c, l, "disabled = 0"));
  }
  if (n >= l) {
    if (trialValidOf(s, now)) {
      const [x] = await t.selectGlobal<{ label: string }>("trial_limits", { where: { resource: r } });
      fail(`ช่วงทดลองใช้ได้สูงสุด ${l} ${x?.label ?? r} กรุณาเลือกแพ็กเกจเพื่อเพิ่ม`);
    }
    if (ep === "free") fail(`แพ็กเกจฟรีใช้ได้ ${l} ${RESOURCE_TH[r] ?? r} อัปเกรดแพ็กเกจเพื่อเพิ่ม`);
    fail(`เกินโควตาแพ็กเกจ (${r}: ${l}) กรุณาอัปเกรด`);
  }
  return [guard];
}

/**
 * start_trial — the AFTER INSERT trigger companies_trial on companies: every new company starts on Free (active, no
 * end). The company-creating path puts this step in the same batch, right after inserting the company.
 */
export function startTrial(t: Tenant, companyId: string): Stmt {
  return t.upsertGlobalStmt("subscriptions", { company_id: companyId, plan: "free", status: "active" }, ["company_id"], []);
}

/**
 * expire_subscriptions() — the cron job (was service_role only): paid plans more than 3 days past their period become
 * past_due, across every company. Returns how many changed. The caller checks the cron secret.
 */
export async function expireSubscriptions(sql: Sql, now = iso()): Promise<number> {
  const t = serviceTenant(sql);
  const [r] = await t.atomic([t.updateGlobalStmt("subscriptions", { status: "active", current_period_end: { op: "<", value: addDays(now, -3) } }, { status: "past_due", updated_at: now })]);
  return r.changes;
}
