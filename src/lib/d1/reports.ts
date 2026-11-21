// Read-only reports for D1, after the Postgres functions (schema.sql): analytics_series, dashboard_summary,
// usage_summary, template_breakdowns, template_metrics, calendar_entries, and the small helpers hhmm and dept_th.
// usage_summary needs the plan helpers (effective_plan, plan_limit, trial_valid, trial_limit, subscription_active,
// trial_usage); they are ported here too, with enforce_quota (the BEFORE INSERT quota trigger on ingestions and
// line_groups), because ingestion and LINE writes need it.
// member_role(c) is null only for someone outside the company; a D1 Tenant is always built for a member (or a support
// viewer), so those "ไม่มีสิทธิ์" branches cannot be reached here and are left out.
import { AppError } from "../domain";
import { canReadDept } from "./access";
import type { Tenant } from "./tenant";
import type { Entity } from "../types";

type Data = Record<string, unknown>;
const fail = (message: string, status = 400): never => {
  throw new AppError(message, status);
};
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

const DEPT_TH: Record<string, string> = {
  Finance: "ฝ่ายบัญชีและการเงิน",
  HR: "ฝ่ายบุคคล",
  Warehouse: "คลังสินค้า",
  Sales: "ฝ่ายขาย",
  Marketing: "การตลาด",
  IT: "ฝ่าย IT",
  Operations: "ฝ่ายปฏิบัติการ",
  Purchasing: "จัดซื้อ",
  Legal: "กฎหมาย",
  Event: "อีเวนต์",
  Admin: "บริหารองค์กร",
  Design: "ออกแบบ",
  "Customer Service": "บริการลูกค้า",
  Data: "ข้อมูล",
  "Business Development": "พัฒนาธุรกิจ",
};
/** dept_th(): a department's Thai name. */
export const deptTh = (d: string | null | undefined) => (d ? (DEPT_TH[d] ?? d) : "");

// ---------- plan helpers ----------
type Subscription = { company_id: string; plan: string; cycle: string; status: string; trial_ends_at: string; current_period_end: string | null; addons: string[]; extra_users: number; updated_at: string };
type PlanRow = { id: string; workflows: number | null; documents: number | null; line_groups: number | null; users: number | null } & Data;
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
const DAY = 86400000;
/** date_trunc('month', now()) in UTC (the database time zone). */
export const monthStart = (now: string) => `${now.slice(0, 7)}-01T00:00:00.000Z`;

async function subscription(t: Tenant): Promise<Subscription | null> {
  return (await t.selectInternal<Subscription>("subscriptions", { where: {} }))[0] ?? null;
}
/** effective_plan(): the paid plan while it runs (3 days' grace), the trial plan during the trial, else free. */
export async function effectivePlan(t: Tenant, now = new Date().toISOString()): Promise<string | null> {
  const s = await subscription(t);
  if (!s) return null;
  const n = Date.parse(now);
  if (s.status === "trial" && ms(s.trial_ends_at) > n) return s.plan;
  if (s.status === "active" && (s.current_period_end === null || ms(s.current_period_end) > n - 3 * DAY)) return s.plan;
  return "free";
}
/** trial_valid() */
export async function trialValid(t: Tenant, now = new Date().toISOString()): Promise<boolean> {
  const s = await subscription(t);
  return !!s && s.status === "trial" && ms(s.trial_ends_at) > Date.parse(now);
}
/** trial_limit() */
export async function trialLimit(t: Tenant, r: string): Promise<number | null> {
  const [row] = await t.selectGlobal<{ amount: number | null }>("trial_limits", { where: { resource: r } });
  return row ? row.amount : null;
}
/** plan_limit(): the limit of a resource on the plan in force (trial limits during the trial). */
export async function planLimit(t: Tenant, r: string, now = new Date().toISOString()): Promise<number | null> {
  const s = await subscription(t);
  if (!s) return null;
  const [p] = await t.selectGlobal<PlanRow>("plans", { where: { id: (await effectivePlan(t, now)) as string } });
  if (!p) return null;
  if (await trialValid(t, now)) {
    const tl = await trialLimit(t, r);
    if (tl !== null) return tl;
  }
  if (r === "workflows") return p.workflows;
  if (r === "documents") return p.documents;
  if (r === "line_groups") return p.line_groups;
  if (r === "users") return p.users === null ? null : p.users + (p.id === "free" ? 0 : Number(s.extra_users));
  return null;
}
/** subscription_active() */
export const subscriptionActive = async (t: Tenant) => !!(await subscription(t));

/** trial_usage(): what the trial (or the free plan this month) has used against its limits. */
export async function trialUsage(t: Tenant, now = new Date().toISOString()): Promise<Data | null> {
  const s = await subscription(t);
  if (!s) return null;
  let since: string, fl: boolean;
  if (await trialValid(t, now)) (since = new Date(ms(s.trial_ends_at) - 14 * DAY).toISOString()), (fl = false);
  else if ((await effectivePlan(t, now)) === "free") (since = monthStart(now)), (fl = true);
  else return null;
  const after = { op: ">=" as const, value: since };
  const ai = await t.selectInternal<{ has_file: boolean; feature: string }>("ai_usage", { where: { created_at: after } });
  const free = async (r: string) => (await t.selectGlobal<{ amount: number | null }>("free_limits", { where: { resource: r } }))[0]?.amount ?? null;
  return {
    kind: fl ? "free" : "trial",
    ends_at: fl ? null : s.trial_ends_at,
    documents: { used: (await t.selectInternal("ingestions", { where: { created_at: after } })).length, limit: fl ? await planLimit(t, "documents", now) : await trialLimit(t, "documents") },
    ai_files: { used: ai.filter((x) => x.has_file).length, limit: fl ? await free("ai_files") : await trialLimit(t, "ai_files") },
    ai_chat: { used: ai.filter((x) => x.feature === "chat").length, limit: fl ? await free("ai_chat") : await trialLimit(t, "ai_chat") },
    ai_calls: { used: ai.length, limit: fl ? await free("ai_calls") : await trialLimit(t, "ai_calls") },
    line_groups: { used: (await t.selectInternal("line_groups")).length, limit: await planLimit(t, "line_groups", now) },
    users: { used: (await t.selectInternal("memberships", { where: { disabled: false } })).length, limit: await planLimit(t, "users", now) },
  };
}

/**
 * enforce_quota('documents' | 'line_groups'): the BEFORE INSERT trigger on ingestions and line_groups. Call it before
 * adding the row (`group` = the group being inserted, for line_groups).
 */
export async function enforceQuota(t: Tenant, r: "documents" | "line_groups", group?: string, now = new Date().toISOString()): Promise<void> {
  const s = await subscription(t);
  const ep = await effectivePlan(t, now);
  if (r === "documents") {
    let l: number | null, n: number;
    if (await trialValid(t, now)) {
      l = await trialLimit(t, "documents");
      if (l === null) return;
      n = (await t.selectInternal("ingestions", { where: { created_at: { op: ">=", value: new Date(ms(s!.trial_ends_at) - 14 * DAY).toISOString() } } })).length;
      if (n >= l) fail(`ช่วงทดลองใช้ครบ ${l} รายการแล้ว กรุณาเลือกแพ็กเกจเพื่อใช้งานต่อ`);
    } else if (ep === "free") {
      l = await planLimit(t, "documents", now);
      if (l === null) return;
      n = (await t.selectInternal("ingestions", { where: { created_at: { op: ">=", value: monthStart(now) } } })).length;
      if (n >= l) fail(`แพ็กเกจฟรีใช้ได้ ${l} รายการต่อเดือน ครบแล้ว อัปเกรดแพ็กเกจเพื่อใช้งานต่อ`);
    }
    return;
  }
  const l = await planLimit(t, r, now);
  if (l === null) return;
  if ((await t.selectGlobal("line_groups", { where: { group_id: group ?? "" } })).length) return;
  const n = (await t.selectInternal("line_groups")).length;
  if (n >= l) {
    if (await trialValid(t, now)) {
      const [label] = await t.selectGlobal<{ label: string }>("trial_limits", { where: { resource: r } });
      fail(`ช่วงทดลองใช้ได้สูงสุด ${l} ${label?.label ?? r} กรุณาเลือกแพ็กเกจเพื่อเพิ่ม`);
    }
    if (ep === "free") fail(`แพ็กเกจฟรีใช้ได้ ${l} กลุ่ม LINE อัปเกรดแพ็กเกจเพื่อเพิ่ม`);
    fail(`เกินโควตาแพ็กเกจ (${r}: ${l}) กรุณาอัปเกรด`);
  }
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
    s = await subscription(t),
    ep = await effectivePlan(t, now),
    month = { op: ">=" as const, value: monthStart(now) };
  const [plan] = ep === null ? [] : await t.selectGlobal("plans", { where: { id: ep } });
  const monthIngestions = await t.selectInternal<{ attachment_id: string | null; pages: number | null }>("ingestions", { where: { created_at: month } });
  const attached = monthIngestions.map((i) => i.attachment_id).filter((x): x is string => !!x);
  const files = attached.length ? await t.selectInternal<{ id: string; mime: string }>("attachments", { where: { id: attached } }) : [];
  const mime = new Map(files.map((a) => [a.id, a.mime]));
  return {
    subscription: s ? { ...s, ...(ep === "free" && s.plan !== "free" && !(await trialValid(t, now)) ? { plan: "free", status: "active", current_period_end: null, lapsed_plan: s.plan } : {}) } : null,
    plan: plan ?? null,
    active: await subscriptionActive(t),
    trial: await trialUsage(t, now),
    usage: {
      workflows: (await t.selectInternal("data_templates")).length,
      documents: monthIngestions.length,
      ocr: monthIngestions.filter((i) => i.attachment_id && mime.get(i.attachment_id)?.startsWith("image/")).length,
      ai_runs: monthIngestions.filter((i) => i.attachment_id && mime.get(i.attachment_id) === "application/pdf").length,
      pages: monthIngestions.reduce((n, i) => n + Number(i.pages ?? 0), 0),
      line_groups: (await t.selectInternal("line_groups", { where: { company_id: c } })).length,
      users: (await t.selectInternal("memberships", { where: { disabled: false } })).length,
    },
    limits: { workflows: await planLimit(t, "workflows", now), documents: await planLimit(t, "documents", now), line_groups: await planLimit(t, "line_groups", now), users: await planLimit(t, "users", now) },
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
