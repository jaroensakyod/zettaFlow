import { test } from "node:test";
import assert from "node:assert/strict";
import { statusCounts } from "../src/lib/projects";
import { isSampleId, sampleCovers, sampleDetail, sampleOverview, sampleProjects, SAMPLE_TODAY } from "../src/lib/mock/projects";

test("mockup tiles match the design and the real counting rule", () => {
  assert.deepEqual(sampleOverview.counts, { all: 12, active: 7, completed: 3, paused: 1, cancelled: 1 });
  assert.deepEqual(statusCounts(sampleProjects.map((p) => p.status)), sampleOverview.counts);
  assert.equal(sampleProjects.length, 12);
  assert.equal(sampleOverview.nextCode, "PRJ-013");
});

test("the 8 design cards come first (newest) with the design's figures", () => {
  const recent = [...sampleProjects].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  assert.deepEqual(
    recent.slice(0, 8).map((p) => p.code),
    ["PRJ-001", "PRJ-002", "PRJ-003", "PRJ-004", "PRJ-005", "PRJ-006", "PRJ-007", "PRJ-008"],
  );
  const expected: [string, number][] = [
    ["active", 45], ["active", 70], ["planning", 20], ["completed", 100], ["active", 60], ["paused", 0], ["active", 55], ["cancelled", 0],
  ];
  recent.slice(0, 8).forEach((p, i) => {
    assert.equal(p.status, expected[i][0], p.code);
    assert.equal(p.progress, expected[i][1], p.code);
  });
  const blue = recent[0];
  assert.equal(blue.name, "โครงการคอนโด Blue Sky Residence");
  assert.equal(blue.owner?.name, "ณัฐชา");
  assert.equal(blue.team.length - 3, 3); // avatar stack: 3 faces + "+3"
  assert.equal(blue.stageLabel, "การตลาด & ขาย");
  assert.deepEqual([blue.budget, blue.salesTarget, blue.sales], [25_000_000, 18_500_000, 8_250_000]);
  assert.equal(blue.startDate, "2026-01-01");
  assert.equal(blue.endDate, "2026-12-31");
});

test("every progress is consistent with its status", () => {
  for (const p of sampleProjects) {
    assert.ok(p.progress >= 0 && p.progress <= 100, p.code);
    if (p.status === "completed") assert.equal(p.progress, 100, p.code);
    if (p.status !== "completed") assert.ok(p.progress < 100, p.code);
  }
});

test("samples are fictional, self-contained and never look like real ids", () => {
  const codes = new Set(sampleProjects.map((p) => p.code));
  assert.equal(codes.size, 12);
  for (const p of sampleProjects) {
    assert.ok(isSampleId(p.id), p.id);
    assert.equal(p.cover, null);
    assert.ok(p.sample?.startsWith("data:image/svg+xml"), p.code);
    // No external images: the only URL inside the SVG is the SVG namespace.
    const svg = decodeURIComponent(p.sample!.split(",").slice(1).join(","));
    assert.equal(svg.replace("http://www.w3.org/2000/svg", "").match(/https?:|href=/g), null, p.code);
  }
  assert.equal(new Set(Object.values(sampleCovers)).size, 12, "each cover is a distinct illustration");
  assert.ok(decodeURIComponent(sampleCovers.expo).includes("BANGKOK"));
  assert.ok(!isSampleId("7f8a3c2e-0000-4000-8000-000000000000"));
  for (const c of sampleOverview.calendar) assert.ok(isSampleId(c.projectId));
});

test("Blue Sky detail reproduces page 14", () => {
  const d = sampleDetail("sample-1")!;
  assert.ok(d);
  const p = d.project;
  assert.equal(p.progress, 45);
  assert.deepEqual([p.budget, p.salesTarget, p.sales], [25_000_000, 18_500_000, 8_250_000]);
  assert.equal(p.owner?.name, "ณัฐชา");
  assert.equal(p.owner?.position, "ผู้จัดการโครงการ");
  assert.equal(p.team.length - 4, 8); // stack of 4 + "+8"
  assert.deepEqual(d.totals.sales - d.totals.expenses, d.totals.profit);
  assert.deepEqual([d.totals.sales, d.totals.expenses, d.totals.profit], [8_250_000, 4_200_000, 4_050_000]);
  assert.equal(d.totals.invoiced - d.totals.received, d.totals.outstanding);
  // chart = totals
  for (const mode of ["month", "quarter", "year"] as const) {
    assert.equal(d.series[mode].reduce((s, x) => s + x.sales, 0), d.totals.sales, mode);
    assert.equal(d.series[mode].reduce((s, x) => s + x.expenses, 0), d.totals.expenses, mode);
  }
  assert.deepEqual(d.series.month.map((x) => x.label), ["ม.ค. 69", "ก.พ. 69", "มี.ค. 69", "เม.ย. 69", "พ.ค. 69", "มิ.ย. 69"]);
  // stage legend 10/15/45/20/10 sums to 100, current step is การตลาด & ขาย
  assert.deepEqual(d.extras.breakdown.map((x) => x.percent), [10, 15, 45, 20, 10]);
  assert.equal(d.extras.breakdown.reduce((s, x) => s + x.percent, 0), 100);
  assert.equal(d.extras.steps.find((s) => s.status === "progress")?.label, p.stageLabel);
  // goals: 45% / 60% / 30%
  const pct = (v: number, t: number) => Math.round((v / t) * 100);
  assert.equal(pct(d.goals.sales.value, d.goals.sales.target), 45);
  assert.equal(pct(d.goals.customers.value, d.goals.customers.target), 60);
  assert.equal(pct(d.extras.thirdGoal.value, d.extras.thirdGoal.target), 30);
  assert.equal(d.extras.thirdGoal.label, "พื้นที่จอง");
  assert.equal(d.goals.sales.value, p.sales);
  // documents, upcoming, activity
  assert.deepEqual(d.documents.map((x) => x.name), ["แผนการตลาด.pdf", "สัญญาโครงการ.docx", "รายงานยอดขาย.xlsx"]);
  assert.ok(d.documents.every((x) => x.href === null));
  assert.deepEqual(d.upcoming.map((x) => x.date), ["2026-10-15", "2026-10-20", "2026-10-28"]);
  assert.ok(d.upcoming.every((x) => x.date >= SAMPLE_TODAY));
  assert.ok(d.activity.length > 3);
  assert.deepEqual(d.activity.slice(0, 3).map((a) => a.title), ["อัปเดตสถานะโครงการ", "เพิ่มเอกสาร", "ยอดขายเพิ่มขึ้น"]);
  const sorted = [...d.activity].sort((a, b) => b.at.localeCompare(a.at));
  assert.deepEqual(sorted, d.activity);
  assert.equal(d.extras.tagline, "Dream Home Better Future");
});

test("every sample card opens a consistent detail; unknown ids do not", () => {
  for (const card of sampleProjects) {
    const d = sampleDetail(card.id);
    assert.ok(d, card.id);
    assert.equal(d!.project.id, card.id);
    if (card.id === "sample-1") continue;
    assert.equal(d!.project.sales, card.sales);
    assert.equal(d!.series.month.reduce((s, x) => s + x.sales, 0), card.sales, card.code);
    assert.equal(d!.series.month.reduce((s, x) => s + x.expenses, 0), card.expenses, card.code);
    assert.equal(d!.totals.profit, card.sales - card.expenses);
    assert.equal(d!.extras.breakdown.reduce((s, x) => s + x.percent, 0), 100);
    if (card.status === "completed") assert.ok(d!.extras.steps.every((s) => s.status === "done"), card.code);
  }
  assert.equal(sampleDetail("sample-99"), null);
  assert.equal(sampleDetail("anything"), null);
});
