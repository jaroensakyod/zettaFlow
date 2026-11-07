// Financial Center (การเงินองค์กร): one call returns the year's budget plan, targets, closing checklist and the
// actual revenue / expenses (from records), per department and per year. Nothing here is estimated: a figure is
// either a saved plan or a sum of real records.
//   Revenue  = confirmed sales (same rule as the home dashboard) + payments received (direction "income").
//   Expenses = approved / paid expenses (same rule as the home dashboard) + payments made (direction "expense").
//   Department = Sales for sales; an expense / payment's costCenter when it names a department; else "Unassigned".
import { z } from "zod";
import { assert, canRead } from "./domain";
import { departmentNames } from "./catalog";
import { demoMutate, demoRead, demoAudit, type DemoState } from "./demo";
import { dbError } from "./data";
import { supabaseServer } from "./supabase/server";
import type { Context } from "./types";

export const RESERVE = "Reserve";
export const UNASSIGNED = "Unassigned";
export const CIT_RATE = 0.2;
export const financeDeptLabels: Record<string, string> = {
  Operations: "ปฏิบัติการ",
  "Business Development": "พัฒนาธุรกิจ",
  Design: "ออกแบบ",
  Purchasing: "จัดซื้อ",
  Warehouse: "คลังสินค้า",
  Sales: "ฝ่ายขาย",
  Finance: "บัญชีและการเงิน",
  Marketing: "การตลาด",
  HR: "บุคคล (HR)",
  IT: "เทคโนโลยี (IT)",
  "Customer Service": "บริการลูกค้า",
  Legal: "กฎหมาย",
  Data: "ข้อมูล (Data)",
  Event: "อีเวนต์",
  Admin: "บริหารทั่วไป (GA)",
  [RESERVE]: "เงินสำรององค์กร",
  [UNASSIGNED]: "ไม่ระบุแผนก",
};
/** Departments a budget can be set for, in display order; the reserve is last. */
export const budgetDepartments = [...departmentNames, RESERVE];
export const closingSteps = [
  { step: 1, label: "ตรวจสอบรายการ", month: "ธ.ค." },
  { step: 2, label: "ปรับปรุงบัญชี", month: "ธ.ค." },
  { step: 3, label: "คำนวณภาษี", month: "ม.ค." },
  { step: 4, label: "จัดทำงบการเงิน", month: "ม.ค." },
  { step: 5, label: "ปิดงบและรายงาน", month: "ม.ค." },
] as const;

export type FinanceRecord = {
  kind: string;
  date: string;
  amount: number;
  status?: string | null;
  direction?: string | null;
  costCenter?: string | null;
};
export type Targets = { revenue: number | null; profit: number | null; expenseCap: number | null };
export type YearTotals = { year: number; revenue: number; expense: number; profit: number; tax: number; net: number };
export type DeptRow = { id: string; label: string; budget: number; spent: number; revenue: number };
export type FinanceOverview = {
  year: number;
  today: string;
  canManage: boolean;
  demo: boolean;
  departments: { id: string; label: string }[];
  budgets: Record<string, number>;
  targets: Targets;
  closing: { step: number; doneAt: string }[];
  totals: YearTotals;
  /** Revenue / expense per day of the fiscal year (only days with records). */
  daily: { date: string; revenue: number; expense: number }[];
  byDept: DeptRow[];
  pendingExpenses: number;
  years: YearTotals[];
  counts: { sales: number; expenses: number; paymentsIn: number; paymentsOut: number };
};

const thaiToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const lookup = new Map<string, string>();
for (const d of departmentNames) {
  lookup.set(d.toLowerCase(), d);
  lookup.set(financeDeptLabels[d].toLowerCase(), d);
}
/** Which budget department a record belongs to. */
export function departmentOfRecord(r: FinanceRecord) {
  if (r.kind === "sales") return "Sales";
  return lookup.get(String(r.costCenter || "").trim().toLowerCase()) || UNASSIGNED;
}
/** Revenue (+) or expense (-) side of a record, or null when it does not count (draft sale, pending expense …). */
export function sideOf(r: FinanceRecord): "revenue" | "expense" | null {
  if (r.kind === "sales") return r.status === "confirmed" ? "revenue" : null;
  if (r.kind === "expenses") return ["approved", "paid"].includes(String(r.status)) ? "expense" : null;
  if (r.kind === "payments") return r.direction === "income" ? "revenue" : r.direction === "expense" ? "expense" : null;
  return null;
}
const round = (n: number) => Math.round(n * 100) / 100;
export function yearTotals(year: number, revenue: number, expense: number): YearTotals {
  const profit = round(revenue - expense),
    tax = profit > 0 ? round(profit * CIT_RATE) : 0;
  return { year, revenue: round(revenue), expense: round(expense), profit, tax, net: round(profit - tax) };
}

/** Pure aggregation of records + plan into the page's shape (unit-testable, used for demo and Supabase alike). */
export function summarize(
  records: FinanceRecord[],
  plan: { year: number; budgets: Record<string, number>; budgetYears: number[]; targets: Targets; closing: { step: number; doneAt: string }[] },
  extra: { today: string; canManage: boolean; demo: boolean },
): FinanceOverview {
  const { year } = plan,
    prefix = String(year),
    days = new Map<string, { date: string; revenue: number; expense: number }>(),
    dept = new Map<string, { spent: number; revenue: number }>(),
    perYear = new Map<number, { revenue: number; expense: number }>(),
    counts = { sales: 0, expenses: 0, paymentsIn: 0, paymentsOut: 0 };
  let pendingExpenses = 0;
  for (const r of records) {
    const date = String(r.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const y = Number(date.slice(0, 4)),
      side = sideOf(r),
      amount = Number(r.amount) || 0;
    if (r.kind === "expenses" && r.status === "pending" && date.startsWith(prefix)) pendingExpenses++;
    if (!side || !amount) continue;
    const t = perYear.get(y) || { revenue: 0, expense: 0 };
    t[side] += amount;
    perYear.set(y, t);
    if (y !== year) continue;
    counts[r.kind === "sales" ? "sales" : r.kind === "expenses" ? "expenses" : side === "revenue" ? "paymentsIn" : "paymentsOut"]++;
    const d = days.get(date) || { date, revenue: 0, expense: 0 };
    d[side] += amount;
    days.set(date, d);
    const id = departmentOfRecord(r),
      row = dept.get(id) || { spent: 0, revenue: 0 };
    row[side === "revenue" ? "revenue" : "spent"] += amount;
    dept.set(id, row);
  }
  const ids = [...budgetDepartments.filter((d) => d !== RESERVE && (plan.budgets[d] || dept.has(d))), ...(dept.has(UNASSIGNED) ? [UNASSIGNED] : [])];
  const byDept = ids.map((id) => ({
    id,
    label: financeDeptLabels[id] || id,
    budget: plan.budgets[id] || 0,
    spent: round(dept.get(id)?.spent || 0),
    revenue: round(dept.get(id)?.revenue || 0),
  }));
  const current = perYear.get(year) || { revenue: 0, expense: 0 };
  const yearList = new Set([...perYear.keys(), ...plan.budgetYears, year]);
  return {
    year,
    today: extra.today,
    canManage: extra.canManage,
    demo: extra.demo,
    departments: budgetDepartments.map((id) => ({ id, label: financeDeptLabels[id] || id })),
    budgets: plan.budgets,
    targets: plan.targets,
    closing: plan.closing.sort((a, b) => a.step - b.step),
    totals: yearTotals(year, current.revenue, current.expense),
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, revenue: round(d.revenue), expense: round(d.expense) })),
    byDept,
    pendingExpenses,
    years: [...yearList]
      .filter((y) => y <= year)
      .sort((a, b) => b - a)
      .slice(0, 6)
      .map((y) => yearTotals(y, perYear.get(y)?.revenue || 0, perYear.get(y)?.expense || 0)),
    counts,
  };
}

// ---------- permissions & demo storage ----------
function readable(ctx: Context) {
  assert(canRead(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
}
/** Owner, or a manager with the Finance department (mirrors finance_manager() in 0042_finance_budgets.sql). */
export const canManageFinance = (ctx: Context) =>
  ctx.member.role === "owner" || (ctx.member.role === "manager" && ctx.member.departments.includes("Finance"));
function manager(ctx: Context) {
  assert(canManageFinance(ctx), "ไม่มีสิทธิ์วางแผนงบประมาณ (เฉพาะเจ้าของหรือผู้จัดการฝ่ายการเงิน)", 403);
}
type DemoFinance = {
  budgets: Record<string, Record<string, number>>;
  targets: Record<string, Targets>;
  closing: Record<string, { step: number; doneAt: string }[]>;
};
const demoFinance = (s: DemoState) => ((s as DemoState & { financeCenter?: DemoFinance }).financeCenter ||= { budgets: {}, targets: {}, closing: {} });
const yearSchema = z.coerce.number().int().min(2000).max(2200);
const noTargets: Targets = { revenue: null, profit: null, expenseCap: null };

async function loadRecords(ctx: Context): Promise<FinanceRecord[]> {
  if (ctx.demo)
    return (await demoRead()).entities
      .filter((e) => !e.archived_at && ["sales", "expenses", "payments"].includes(e.kind) && canRead(ctx, e.department))
      .map((e) => ({
        kind: e.kind,
        date: String(e.data.date || ""),
        amount: Number(e.data.amount) || 0,
        status: e.data.status as string,
        direction: e.data.direction as string,
        costCenter: e.data.costCenter as string,
      }));
  const sb = await supabaseServer(),
    out: FinanceRecord[] = [],
    page = 1000;
  // Paged so a busy company is not cut at the API row cap; 30k rows is far beyond a page's worth of years.
  for (let from = 0; from < 30000; from += page) {
    const { data, error } = await sb
      .from("entities")
      .select("id,kind,date:data->>date,amount:data->>amount,status:data->>status,direction:data->>direction,costCenter:data->>costCenter")
      .eq("company_id", ctx.company.id)
      .is("archived_at", null)
      .in("kind", ["sales", "expenses", "payments"])
      .order("id")
      .range(from, from + page - 1);
    dbError(error);
    const rows = (data || []) as unknown as (FinanceRecord & { amount: string })[];
    out.push(...rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 })));
    if (rows.length < page) break;
  }
  return out;
}

async function loadPlan(ctx: Context, year: number) {
  if (ctx.demo) {
    const f = demoFinance(await demoRead());
    return {
      year,
      budgets: f.budgets[year] || {},
      budgetYears: Object.keys(f.budgets).map(Number).filter((y) => Object.keys(f.budgets[y] || {}).length),
      targets: f.targets[year] || noTargets,
      closing: f.closing[year] || [],
    };
  }
  const sb = await supabaseServer(),
    c = ctx.company.id;
  const [b, t, k] = await Promise.all([
    sb.from("finance_budgets").select("fiscal_year,department,amount").eq("company_id", c).limit(2000),
    sb.from("finance_targets").select("revenue,profit,expense_cap").eq("company_id", c).eq("fiscal_year", year).maybeSingle(),
    sb.from("finance_closing").select("step,done_at").eq("company_id", c).eq("fiscal_year", year),
  ]);
  dbError(b.error);
  dbError(t.error);
  dbError(k.error);
  const budgets: Record<string, number> = {};
  for (const r of b.data || []) if (r.fiscal_year === year) budgets[r.department] = Number(r.amount);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    year,
    budgets,
    budgetYears: [...new Set((b.data || []).map((r) => Number(r.fiscal_year)))],
    targets: t.data ? { revenue: num(t.data.revenue), profit: num(t.data.profit), expenseCap: num(t.data.expense_cap) } : noTargets,
    closing: (k.data || []).map((r) => ({ step: Number(r.step), doneAt: String(r.done_at) })),
  };
}

/** Everything the Financial Center page needs for one fiscal year (calendar year, Jan–Dec). */
export async function financeOverview(ctx: Context, yearInput?: unknown): Promise<FinanceOverview> {
  readable(ctx);
  const today = thaiToday(),
    year = yearInput === undefined || yearInput === null || yearInput === "" ? Number(today.slice(0, 4)) : yearSchema.parse(yearInput);
  const [records, plan] = await Promise.all([loadRecords(ctx), loadPlan(ctx, year)]);
  return summarize(records, plan, { today, canManage: canManageFinance(ctx), demo: ctx.demo });
}

const money = z.number().min(0).max(1e12);
const budgetInput = z.object({
  year: yearSchema,
  budgets: z.record(z.enum(budgetDepartments as [string, ...string[]]), money),
});
/** Replaces the year's budget plan; a zero amount removes that department. */
export async function saveBudgets(ctx: Context, input: unknown) {
  readable(ctx);
  manager(ctx);
  const { year, budgets } = budgetInput.parse(input);
  const clean = Object.fromEntries(Object.entries(budgets).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  if (ctx.demo)
    return demoMutate((s) => {
      demoFinance(s).budgets[year] = clean;
      demoAudit(s, "finance_budgets_saved", String(year));
      return { ok: true };
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("finance_save_budgets", { p_company: ctx.company.id, p_year: year, p_budgets: clean });
  dbError(error);
  return { ok: true };
}

const optional = (s: z.ZodNumber) => s.nullable().optional().transform((v) => (v === undefined ? null : v));
const targetInput = z.object({
  year: yearSchema,
  revenue: optional(money),
  profit: optional(z.number().min(-1e12).max(1e12)),
  expenseCap: optional(money),
});
export async function saveTargets(ctx: Context, input: unknown) {
  readable(ctx);
  manager(ctx);
  const { year, ...t } = targetInput.parse(input);
  if (ctx.demo)
    return demoMutate((s) => {
      demoFinance(s).targets[year] = t;
      demoAudit(s, "finance_targets_saved", String(year));
      return { ok: true };
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("finance_save_targets", {
    p_company: ctx.company.id,
    p_year: year,
    p_revenue: t.revenue,
    p_profit: t.profit,
    p_expense_cap: t.expenseCap,
  });
  dbError(error);
  return { ok: true };
}

const stepInput = z.object({ year: yearSchema, step: z.number().int().min(1).max(5), done: z.boolean() });
/** Marks a closing step done (in order) or reopens it (from the last done step backwards). */
export async function setClosingStep(ctx: Context, input: unknown) {
  readable(ctx);
  manager(ctx);
  const { year, step, done } = stepInput.parse(input);
  if (ctx.demo)
    return demoMutate((s) => {
      const f = demoFinance(s),
        list = (f.closing[year] ||= []),
        has = (n: number) => list.some((x) => x.step === n);
      if (done) {
        assert(step === 1 || has(step - 1), "ต้องทำขั้นตอนก่อนหน้าให้เสร็จก่อน");
        if (!has(step)) list.push({ step, doneAt: new Date().toISOString() });
      } else {
        assert(!has(step + 1), "ต้องเปิดขั้นตอนถัดไปก่อน");
        f.closing[year] = list.filter((x) => x.step !== step);
      }
      demoAudit(s, done ? "finance_step_done" : "finance_step_reopened", `${year}/${step}`);
      return { ok: true };
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("finance_close_step", { p_company: ctx.company.id, p_year: year, p_step: step, p_done: done });
  dbError(error);
  return { ok: true };
}
