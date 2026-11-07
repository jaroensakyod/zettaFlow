// Sample ("ตัวอย่าง") data for the Financial Center: reproduces the Canva design page 7 so a company with no budgets,
// targets or records yet can see what the page looks like once it is in use. Every figure is fictional and is only
// ever shown under a "ตัวอย่าง" banner — never mixed with real numbers, never written anywhere.
// Pure data (type-only imports) so the client bundle does not pull in the server module.
import type { FinanceOverview, YearTotals } from "../finance-center";

/** Extra figures the design shows that the page normally derives from records it does not have in sample mode. */
export type FinanceSampleExtras = {
  /** "งบแผนกที่ตั้งแล้ว" — the design counts budget line items, not departments. */
  budgetItems: number;
  /** "ใช้งบเกินแผน" (departments). */
  overBudget: number;
  /** Progress shown on the targets card, in % (the design rounds the profit target down to 92%). */
  targetPct: { revenue: number; profit: number; expenseCap: number };
};
export type FinanceSample = FinanceOverview & { sample: FinanceSampleExtras };

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Same rule as yearTotals() in lib/finance-center (CIT 20% of a positive profit). */
function totals(year: number, revenue: number, expense: number): YearTotals {
  const profit = r2(revenue - expense),
    tax = profit > 0 ? r2(profit * 0.2) : 0;
  return { year, revenue, expense, profit, tax, net: r2(profit - tax) };
}

/** Budget per department (design: 20/25/15/20/10 % + 10 % reserve of ฿1,000,000). Display order = design order. */
export const sampleBudgets: Record<string, number> = {
  Marketing: 200000,
  IT: 250000,
  HR: 150000,
  Operations: 200000,
  Admin: 100000,
  Reserve: 100000,
};
export const sampleDeptLabels: Record<string, string> = {
  Marketing: "การตลาด",
  IT: "เทคโนโลยี (IT)",
  HR: "บุคคล (HR)",
  Operations: "ปฏิบัติการ",
  Admin: "บริหารทั่วไป (GA)",
  Reserve: "เงินสำรององค์กร",
};
/** Monthly revenue / expense ม.ค.–ธ.ค. (rising like the design's chart); they add up to the YTD totals. */
export const sampleMonthlyRevenue = [28000, 36000, 44000, 52000, 60000, 64000, 68000, 72000, 80000, 88000, 96000, 112000];
export const sampleMonthlyExpense = [20000, 24000, 28000, 28000, 32000, 32000, 36000, 36000, 40000, 44000, 52000, 58000];
/** Design table "ผลการดำเนินงานรายแผนก (สะสมถึงปัจจุบัน)". */
const sampleSpent: Record<string, { spent: number; revenue: number }> = {
  Marketing: { spent: 120000, revenue: 300000 },
  IT: { spent: 180000, revenue: 0 },
  HR: { spent: 100000, revenue: 0 },
  Operations: { spent: 130000, revenue: 500000 },
  Admin: { spent: 70000, revenue: 0 },
};

/**
 * The Financial Center as designed, for fiscal year `year` (design: 2026, with 2025 / 2024 as earlier years).
 * `today` only drives the header date chip and the day / week views.
 */
export function financeSample(year = 2026, today = `${year}-11-07`): FinanceSample {
  const revenue = sampleMonthlyRevenue.reduce((s, v) => s + v, 0),
    expense = sampleMonthlyExpense.reduce((s, v) => s + v, 0);
  // Four entries a month (3rd / 10th / 17th / 24th) so the weekly view is not one spike per month.
  const daily = sampleMonthlyRevenue.flatMap((rev, m) =>
    [3, 10, 17, 24].map((day) => ({
      date: `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      revenue: rev / 4,
      expense: sampleMonthlyExpense[m] / 4,
    })),
  );
  const ids = Object.keys(sampleBudgets);
  return {
    year,
    today,
    canManage: false, // read-only: every save button is hidden or disabled
    demo: false,
    departments: ids.map((id) => ({ id, label: sampleDeptLabels[id] })),
    budgets: { ...sampleBudgets },
    targets: { revenue: 1000000, profit: 400000, expenseCap: 600000 },
    closing: [
      { step: 1, doneAt: `${year}-12-15T10:00:00+07:00` },
      { step: 2, doneAt: `${year}-12-28T16:00:00+07:00` },
    ],
    totals: totals(year, revenue, expense),
    daily,
    byDept: ids
      .filter((id) => id !== "Reserve")
      .map((id) => ({ id, label: sampleDeptLabels[id], budget: sampleBudgets[id], ...sampleSpent[id] })),
    pendingExpenses: 3,
    years: [totals(year, revenue, expense), totals(year - 1, 600000, 410000), totals(year - 2, 480000, 350000)],
    counts: { sales: 48, expenses: 96, paymentsIn: 12, paymentsOut: 20 },
    sample: { budgetItems: 12, overBudget: 1, targetPct: { revenue: 80, profit: 92, expenseCap: 72 } },
  };
}

/** True when a year has nothing of its own yet: no budget, no target and no revenue / expense. */
export function financeIsEmpty(d: FinanceOverview) {
  const t = d.targets;
  return (
    !Object.values(d.budgets).some((v) => v > 0) &&
    t.revenue === null &&
    t.profit === null &&
    t.expenseCap === null &&
    !d.totals.revenue &&
    !d.totals.expense
  );
}
