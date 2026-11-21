// Read-only reports for D1, after the Postgres functions (schema.sql): analytics_series, dashboard_summary,
// usage_summary, template_breakdowns, template_metrics, calendar_entries, and the small helper hhmm. usage_summary
// reads the plan helpers of billing-plan.ts (effective_plan, plan_limit, trial_valid, subscription_active,
// trial_usage); dept_th lives in common.ts and is re-exported here.
// member_role(c) is null only for someone outside the company; a D1 Tenant is always built for a member (or a support
// viewer), so those "ไม่มีสิทธิ์" branches cannot be reached here and are left out.
import { canReadDept } from "./access";
import { deptTh, fail } from "./common";
import { monthStart } from "./billing-util";
import { effectivePlan, planLimit, subscriptionActive, subscriptionOf, trialUsage, trialValid } from "./billing-plan";
import type { Tenant } from "./tenant";
import type { Entity } from "../types";

export { deptTh, monthStart };
type Data = Record<string, unknown>;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** (data->>'x')::numeric, null when missing. */
const numOrNull = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
const txt = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v));

/** hhmm(): "HH:MM" → minutes since midnight, null for anything else. */
export function hhmm(t: string | null | undefined): number | null {
  if (typeof t !== "string" || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

// ---------- reports ----------
/** analytics_series(): confirmed sales and approved expenses per day, the latest 14 days that have any, oldest first. */
export async function analyticsSeries(t: Tenant): Promise<{ date: string | null; sales: number; expenses: number }[]> {
  const rows = (await t.selectInternal<Entity>("entities", { where: { archived_at: null, kind: ["sales", "expenses"] } })).filter(
    (e) => canReadDept(t.viewer, e.department) && ((e.kind === "sales" && e.data.status === "confirmed") || (e.kind === "expenses" && ["approved", "paid"].includes(String(e.data.status)))),
  );
  const days = new Map<string | null, { date: string | null; sales: number; expenses: number }>();
  for (const e of rows) {
    const date = txt(e.data.date);
    const d = days.get(date) ?? { date, sales: 0, expenses: 0 };
    const a = numOrNull(e.data.amount);
    if (a !== null) d[e.kind === "sales" ? "sales" : "expenses"] += a;
    days.set(date, d);
  }
  // order by date desc (nulls first) limit 14, then oldest first (nulls last)
  const cmp = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
  return [...days.values()]
    .sort((a, b) => -cmp(a.date, b.date))
    .slice(0, 14)
    .sort((a, b) => cmp(a.date, b.date));
}

/** dashboard_summary(): the home page figures over the records the person can read. */
export async function dashboardSummary(t: Tenant): Promise<Data> {
  const rows = (await t.selectInternal<Entity>("entities", { where: { archived_at: null } })).filter((e) => canReadDept(t.viewer, e.department));
  const st = (e: Entity) => txt(e.data.status);
  const sum = (xs: Entity[]) => xs.reduce((s, e) => s + (numOrNull(e.data.amount) ?? 0), 0);
  const low = rows.filter((e) => {
    if (e.kind !== "products") return false;
    const s = numOrNull(e.data.stock),
      r = numOrNull(e.data.reorderLevel);
    return s !== null && r !== null && s <= r;
  });
  return {
    sales: sum(rows.filter((e) => e.kind === "sales" && st(e) === "confirmed")),
    expenses: sum(rows.filter((e) => e.kind === "expenses" && ["approved", "paid"].includes(st(e) ?? ""))),
    projects: rows.filter((e) => e.kind === "projects" && ["planning", "active", "review"].includes(st(e) ?? "")).length,
    tasks: rows.filter((e) => e.kind === "tasks" && st(e) !== null && st(e) !== "done").length,
    pendingDeals: rows.filter((e) => e.kind === "deals" && st(e) === "pending").length,
    lowStock: low,
  };
}

/** usage_summary(): plan, trial and this month's usage against the limits. */
export async function usageSummary(t: Tenant, now = new Date().toISOString()): Promise<Data> {
  const c = t.viewer.companyId,
    s = await subscriptionOf(t),
    ep = await effectivePlan(t, c, now),
    month = { op: ">=" as const, value: monthStart(now) };
  const [plan] = ep === null ? [] : await t.selectGlobal("plans", { where: { id: ep } });
  const monthIngestions = await t.selectInternal<{ attachment_id: string | null; pages: number | null }>("ingestions", { where: { created_at: month }, columns: ["attachment_id", "pages"] });
  const attached = monthIngestions.map((i) => i.attachment_id).filter((x): x is string => !!x);
  const files = attached.length ? await t.selectInternal<{ id: string; mime: string }>("attachments", { where: { id: attached }, columns: ["id", "mime"] }) : [];
  const mime = new Map(files.map((a) => [a.id, a.mime]));
  return {
    subscription: s ? { ...s, ...(ep === "free" && s.plan !== "free" && !(await trialValid(t, c, now)) ? { plan: "free", status: "active", current_period_end: null, lapsed_plan: s.plan } : {}) } : null,
    plan: plan ?? null,
    active: await subscriptionActive(t),
    trial: await trialUsage(t, c, now),
    usage: {
      workflows: await t.countInternal("data_templates"),
      documents: monthIngestions.length,
      ocr: monthIngestions.filter((i) => i.attachment_id && mime.get(i.attachment_id)?.startsWith("image/")).length,
      ai_runs: monthIngestions.filter((i) => i.attachment_id && mime.get(i.attachment_id) === "application/pdf").length,
      pages: monthIngestions.reduce((n, i) => n + Number(i.pages ?? 0), 0),
      line_groups: await t.countInternal("line_groups"),
      users: await t.countInternal("memberships", { disabled: false }),
    },
    limits: { workflows: await planLimit(t, "workflows", c, now), documents: await planLimit(t, "documents", c, now), line_groups: await planLimit(t, "line_groups", c, now), users: await planLimit(t, "users", c, now) },
  };
}

type Template = { id: string; name: string; department: string; fields: Data[] };
type Approved = { template: Data; values: Data; department: string };
async function approvedByTemplate(t: Tenant) {
  const items = await t.selectInternal<Approved>("ingestions", { where: { status: "approved" } });
  return (id: string) => items.filter((i) => txt(i.template?.id) === id);
}
/** template_breakdowns(): for every choice field of a template, how many approved items picked each answer. */
export async function templateBreakdowns(t: Tenant): Promise<Data[]> {
  const of = await approvedByTemplate(t);
  const out: Data[] = [];
  for (const tp of (await t.selectInternal<Template>("data_templates")).filter((x) => canReadDept(t.viewer, x.department)))
    for (const f of tp.fields || []) {
      if (f.type !== "choice") continue;
      const key = txt(f.key) ?? "";
      const buckets: Record<string, number> = {};
      for (const i of of(tp.id)) if (typeof i.values?.[key] === "string") buckets[i.values[key] as string] = (buckets[i.values[key] as string] ?? 0) + 1;
      out.push({ key: `${tp.id}:${key}`, name: tp.name, label: txt(f.label), department: tp.department, buckets });
    }
  return out;
}
/** template_metrics(): for every number field of a template, the total and count over approved items. */
export async function templateMetrics(t: Tenant): Promise<Data[]> {
  const of = await approvedByTemplate(t);
  const out: Data[] = [];
  for (const tp of (await t.selectInternal<Template>("data_templates")).filter((x) => canReadDept(t.viewer, x.department)))
    for (const f of tp.fields || []) {
      if (f.type !== "number") continue;
      const key = txt(f.key) ?? "";
      const vals = of(tp.id)
        .filter((i) => canReadDept(t.viewer, i.department))
        .map((i) => i.values?.[key])
        .filter(isNum);
      out.push({ key: `${tp.id}:${key}`, name: tp.name, label: txt(f.label), department: tp.department, total: vals.reduce((s, v) => s + v, 0), count: vals.length });
    }
  return out;
}

/** calendar_entries(): tasks, events, deals and projects that start, are due or happen in a month (YYYY-MM). */
export async function calendarEntries(t: Tenant, month: string): Promise<Entity[]> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail("ไม่มีสิทธิ์หรือเดือนไม่ถูกต้อง");
  const m7 = (v: unknown) => (txt(v) ?? "").slice(0, 7) === month && txt(v) !== null;
  return (await t.selectInternal<Entity>("entities", { where: { archived_at: null, kind: ["tasks", "events", "deals", "projects"] }, order: [["updated_at", "desc"]] })).filter(
    (e) => canReadDept(t.viewer, e.department) && (m7(e.data.startDate) || m7(e.data.dueDate) || m7(e.data.date)),
  );
}
