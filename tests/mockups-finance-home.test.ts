import { test } from "node:test";
import assert from "node:assert/strict";
import { financeSample, financeIsEmpty, sampleBudgets } from "../src/lib/mock/finance";
import { homeSample, homeIsEmpty, sampleKpi, sampleWeekSales, sampleWeekCost, samplePrevMonth } from "../src/lib/mock/home";
import { yearTotals, budgetDepartments } from "../src/lib/finance-center";
import type { HomeData } from "../src/lib/types";

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

test("finance sample: reproduces the design and is internally consistent", () => {
  const d = financeSample(2026, "2026-11-07");
  // Budget ฿1,000,000 = department allocations + 10% reserve; donut centre (departments only) ฿900,000.
  const budget = sum(Object.values(d.budgets));
  assert.equal(budget, 1000000);
  assert.equal(budget - d.budgets.Reserve, 900000);
  assert.deepEqual(
    Object.fromEntries(Object.entries(d.budgets).map(([k, v]) => [k, Math.round((v / budget) * 100)])),
    { Marketing: 20, IT: 25, HR: 15, Operations: 20, Admin: 10, Reserve: 10 },
  );
  for (const id of Object.keys(sampleBudgets)) assert.ok(budgetDepartments.includes(id), id + " is a real budget department");
  assert.equal(sum(d.byDept.map((r) => r.budget)), 900000);
  // KPIs: revenue 800k, expenses 430k, profit 370k (46.25%), CIT 74k, net 296k — same rule as the real page.
  assert.deepEqual(d.totals, yearTotals(2026, 800000, 430000));
  assert.equal(d.totals.profit, d.totals.revenue - d.totals.expense);
  assert.equal(d.totals.profit, 370000);
  assert.equal(d.totals.tax, 74000);
  assert.equal(d.totals.net, 296000);
  assert.equal((d.totals.profit / d.totals.revenue) * 100, 46.25);
  assert.equal((d.totals.revenue / d.targets.revenue!) * 100, 80);
  assert.equal(Math.round((d.totals.expense / d.targets.expenseCap!) * 100), d.sample.targetPct.expenseCap);
  // The monthly trend (ม.ค.–ธ.ค.) adds up to the YTD totals.
  assert.equal(new Set(d.daily.map((x) => x.date.slice(0, 7))).size, 12);
  assert.equal(sum(d.daily.map((x) => x.revenue)), d.totals.revenue);
  assert.equal(sum(d.daily.map((x) => x.expense)), d.totals.expense);
  assert.ok(d.daily.every((x) => x.date.startsWith("2026-")));
  // Department table rows from the design; total spent 600k, revenue 800k, usage 67%.
  const marketing = d.byDept.find((r) => r.id === "Marketing")!;
  assert.deepEqual([marketing.spent, marketing.revenue, marketing.revenue - marketing.spent], [120000, 300000, 180000]);
  assert.equal(sum(d.byDept.map((r) => r.spent)), 600000);
  assert.equal(sum(d.byDept.map((r) => r.revenue)), 800000);
  assert.equal(Math.round((600000 / 900000) * 100), 67);
  // Multi-year rows: each year is revenue − expense with 20% CIT; growth +33.33% and +25%.
  assert.deepEqual(d.years.map((y) => y.year), [2026, 2025, 2024]);
  for (const y of d.years) assert.deepEqual(y, yearTotals(y.year, y.revenue, y.expense));
  assert.equal(((d.years[0].revenue - d.years[1].revenue) / d.years[1].revenue * 100).toFixed(2), "33.33");
  assert.equal(((d.years[1].revenue - d.years[2].revenue) / d.years[2].revenue) * 100, 25);
  // Closing: steps 1–2 done, step 3 current. Status 12 / 3 / 1.
  assert.deepEqual(d.closing.map((c) => c.step), [1, 2]);
  assert.deepEqual([d.sample.budgetItems, d.pendingExpenses, d.sample.overBudget], [12, 3, 1]);
  // Read-only and never "empty" itself.
  assert.equal(d.canManage, false);
  assert.equal(financeIsEmpty(d), false);
  // Follows the selected year.
  assert.deepEqual(financeSample(2030).years.map((y) => y.year), [2030, 2029, 2028]);
});

test("finance sample: shown automatically only when the year has no data of its own", () => {
  const empty = { ...financeSample(2026), budgets: {}, targets: { revenue: null, profit: null, expenseCap: null }, totals: yearTotals(2026, 0, 0) };
  assert.equal(financeIsEmpty(empty), true);
  assert.equal(financeIsEmpty({ ...empty, budgets: { IT: 1 } }), false);
  assert.equal(financeIsEmpty({ ...empty, targets: { revenue: null, profit: 5, expenseCap: null } }), false);
  assert.equal(financeIsEmpty({ ...empty, totals: yearTotals(2026, 0, 10) }), false);
});

test("home sample: KPIs, chart, work counts and goal match the design for any day", () => {
  for (const today of ["2026-11-07", "2026-11-03", "2026-11-01", "2026-10-01", "2026-03-31", "2027-01-02"]) {
    const s = homeSample(today),
      month = today.slice(0, 7),
      mtd = (kind: string) => sum(s.home.finance.filter((r) => (kind === "cost" ? r.category === "ซื้อสินค้าไว้ขาย" : r.kind === kind) && r.date.startsWith(month) && r.date <= today).map((r) => r.amount));
    assert.equal(mtd("sales"), sampleKpi.sales, today);
    assert.equal(mtd("cost"), sampleKpi.cost, today);
    assert.ok(s.home.finance.every((r) => r.amount > 0), today);
    // ยอดขาย ▲12.5%, ต้นทุน ▲3.2% against the same period last month.
    assert.equal(((sampleKpi.sales - samplePrevMonth.sales) / samplePrevMonth.sales * 100).toFixed(1), "12.5");
    assert.equal(((sampleKpi.cost - samplePrevMonth.cost) / samplePrevMonth.cost * 100).toFixed(1), "3.2");
    // Profit 404,400 at 76.2%; goal 1,200,000 at 44%.
    assert.equal(sampleKpi.sales - sampleKpi.cost, 404400);
    assert.equal((((sampleKpi.sales - sampleKpi.cost) / sampleKpi.sales) * 100).toFixed(1), "76.2");
    assert.equal(s.extra.goal?.target, 1200000);
    assert.equal(Math.round((sampleKpi.sales / s.extra.goal!.target) * 100), 44);
    // Tasks 42, 7 open.
    assert.equal(s.home.tasks.length, 42);
    assert.equal(s.home.tasks.filter((t) => t.data.status !== "done").length, 7);
    // งานของฉัน 12 / 5 / 3 / 4, counts derived from the rows.
    assert.deepEqual(s.extra.counts, { all: 12, approve: 5, review: 3, follow: 4 });
    assert.equal(s.extra.work.length, s.extra.counts.all);
    assert.equal(s.extra.work[0].title, "ขออนุมัติใบสั่งซื้อ (PO-2026-1188)");
    // Diary: 4 items, 2 done. Agenda: 5 items today, first 09:00 ประชุมทีมการตลาด.
    const note = s.extra.notes[0];
    assert.equal(note.day, today);
    assert.deepEqual([note.items.length, note.items.filter((i) => i.done).length], [4, 2]);
    const agenda = s.calendar.filter((e) => (e.data.startDate || e.data.dueDate) === today);
    assert.equal(agenda.length, 5);
    assert.equal(agenda[0].data.startTime, "09:00");
    assert.equal(agenda[0].data.name, "ประชุมทีมการตลาด");
    assert.equal(new Set(s.calendar.map((e) => e.id)).size, s.calendar.length, "unique ids");
    assert.equal(homeIsEmpty(s.home, s.extra), false);
  }
  // On the design's day (Sat 7 Nov 2026) the week is entirely month-to-date: the chart bars are exactly the KPIs.
  assert.equal(sum(sampleWeekSales), sampleKpi.sales);
  assert.equal(sum(sampleWeekCost), sampleKpi.cost);
  const nov7 = homeSample("2026-11-07").home.finance.filter((r) => r.date.startsWith("2026-11"));
  // 7 days × sales, cost (ต้นทุน) and running costs (ค่าใช้จ่าย)
  assert.equal(nov7.length, 21);
});

test("home sample: shown automatically only when the company has nothing on the page", () => {
  const s = homeSample("2026-11-07"),
    home: HomeData = { finance: [], projects: [], tasks: [] },
    extra = { ...s.extra, notes: [], work: [], counts: { all: 0, approve: 0, review: 0, follow: 0 } };
  assert.equal(homeIsEmpty(home, extra), true);
  assert.equal(homeIsEmpty({ ...home, tasks: s.home.tasks.slice(0, 1) }, extra), false);
  assert.equal(homeIsEmpty({ ...home, finance: [{ kind: "sales", date: "2026-11-01", amount: 1, projectId: null }] }, extra), false);
  assert.equal(homeIsEmpty(home, { ...extra, notes: s.extra.notes }), false);
  assert.equal(homeIsEmpty(home, { ...extra, work: s.extra.work.slice(0, 1) }), false);
  // Expenses alone do not count as "has sales".
  assert.equal(homeIsEmpty({ ...home, finance: [{ kind: "expenses", date: "2026-11-01", amount: 1, projectId: null }] }, extra), true);
});
