import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stageProgress,
  statusProgress,
  projectProgress,
  currentStage,
  stageBreakdown,
  teamIds,
  statusCounts,
  periodSeries,
  matchPerson,
  nextProjectCode,
  countsAsSale,
  countsAsExpense,
} from "../src/lib/projects";

const st = (statuses: ("pending" | "progress" | "review" | "done")[]) =>
  statuses.map((status, ordinal) => ({ key: "k" + ordinal, label: "ขั้น " + ordinal, status, ordinal }));

test("stage progress is null until a stage starts, then weighs done / review / progress", () => {
  assert.equal(stageProgress([]), null);
  assert.equal(stageProgress(st(["pending", "pending"])), null);
  assert.equal(stageProgress(st(["done", "done", "progress", "pending"])), 63); // (1+1+0.5)/4
  assert.equal(stageProgress(st(["done", "review"])), 90);
  assert.equal(stageProgress(st(["done", "done"])), 100);
});

test("status progress: finished is 100, planning / cancelled 0, active follows the dates and never shows done", () => {
  assert.equal(statusProgress("completed", "", "", "2026-01-01"), 100);
  assert.equal(statusProgress("planning", "2026-01-01", "2026-12-31", "2026-06-01"), 0);
  assert.equal(statusProgress("cancelled", "2026-01-01", "2026-12-31", "2026-06-01"), 0);
  assert.equal(statusProgress("review", "", "", "2026-06-01"), 90);
  assert.equal(statusProgress("active", "2026-01-01", "2026-01-11", "2026-01-06"), 50);
  assert.equal(statusProgress("active", "2026-01-01", "2026-01-11", "2027-01-01"), 95);
  assert.equal(statusProgress("active", "2026-01-01", "2026-01-11", "2025-01-01"), 0);
  assert.equal(statusProgress("active", "", "", "2026-01-06"), 0);
});

test("project progress prefers stages, but a completed project is always 100", () => {
  assert.deepEqual(projectProgress("active", st(["done", "pending"]), "", "", "2026-01-01"), { percent: 50, source: "stages" });
  assert.deepEqual(projectProgress("active", st(["pending"]), "2026-01-01", "2026-01-11", "2026-01-06"), { percent: 50, source: "status" });
  assert.deepEqual(projectProgress("completed", st(["done", "pending"]), "", "", "2026-01-01"), { percent: 100, source: "status" });
});

test("current stage is the one being worked on", () => {
  assert.equal(currentStage(st(["pending", "pending"])), null);
  assert.equal(currentStage(st(["done", "progress", "pending"]))?.ordinal, 1);
  assert.equal(currentStage(st(["done", "done", "pending"]))?.ordinal, 2);
  assert.equal(currentStage(st(["done", "done"]))?.ordinal, 1);
  const b = stageBreakdown(st(["done", "done", "progress", "pending"]));
  assert.deepEqual(b.map((x) => [x.status, x.count, x.percent]), [["done", 2, 50], ["review", 0, 0], ["progress", 1, 25], ["pending", 1, 25]]);
});

test("team ids are parsed from comma separated text, deduplicated, and junk is dropped", () => {
  const a = "11111111-1111-4111-8111-111111111111",
    b = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(teamIds(`${a}, ${b},${a} nope`), [a, b]);
  assert.deepEqual(teamIds(undefined), []);
});

test("tile counts group planning / active / review as กำลังดำเนินการ", () => {
  assert.deepEqual(statusCounts(["active", "planning", "review", "completed", "paused", "cancelled", "active"]), {
    all: 7, active: 4, completed: 1, paused: 1, cancelled: 1,
  });
});

test("period series buckets sales and expenses by month / quarter / year, oldest first, with Thai labels", () => {
  const sales = [
    { date: "2026-11-02", amount: 100 },
    { date: "2026-11-20", amount: 50.5 },
    { date: "2026-06-30", amount: 10 },
    { date: "2026-05-31", amount: 999 }, // outside the last 6 months
  ];
  const cost = [{ date: "2026-10-01", amount: 40 }];
  const m = periodSeries(sales, cost, "month", "2026-11-07");
  assert.equal(m.length, 6);
  assert.deepEqual(m.map((p) => p.key), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.equal(m[0].label, "มิ.ย. 69");
  assert.equal(m[5].sales, 150.5);
  assert.equal(m[0].sales, 10);
  assert.equal(m[4].expenses, 40);
  const q = periodSeries(sales, cost, "quarter", "2026-11-07");
  assert.deepEqual(q.map((p) => p.label), ["Q1/69", "Q2/69", "Q3/69", "Q4/69"]);
  assert.equal(q[1].sales, 1009);
  assert.equal(q[3].sales, 150.5);
  const y = periodSeries(sales, cost, "year", "2026-11-07");
  assert.deepEqual(y.map((p) => p.label), ["2567", "2568", "2569"]);
  assert.equal(y[2].sales, 1159.5);
  // January crosses back into the previous year.
  assert.equal(periodSeries([], [], "month", "2026-01-15")[0].key, "2025-08");
  assert.equal(periodSeries([], [], "quarter", "2026-01-15")[0].label, "Q2/68");
});

test("owner names match employees by full name or nickname", () => {
  const people = [{ name: "ธนพล ศรีสุข", nickname: "ต้น" }, { name: "นภา ใจดี", nickname: "นภา" }];
  assert.equal(matchPerson("ธนพล ศรีสุข", people)?.nickname, "ต้น");
  assert.equal(matchPerson("ต้น", people)?.name, "ธนพล ศรีสุข");
  assert.equal(matchPerson("คุณนภา ใจดี", people)?.name, "นภา ใจดี");
  assert.equal(matchPerson("", people), undefined);
  assert.equal(matchPerson("สมศรี", people), undefined);
});

test("next project code follows the highest PRJ number", () => {
  assert.equal(nextProjectCode(["PRJ-001", "PRJ-007", "X-9", "", null]), "PRJ-008");
  assert.equal(nextProjectCode([]), "PRJ-001");
});

test("drafts / cancelled sales and rejected expenses do not count", () => {
  assert.equal(countsAsSale({ status: "confirmed" }), true);
  assert.equal(countsAsSale({}), true);
  assert.equal(countsAsSale({ status: "draft" }), false);
  assert.equal(countsAsSale({ status: "cancelled" }), false);
  assert.equal(countsAsExpense({ status: "rejected" }), false);
  assert.equal(countsAsExpense({ status: "paid" }), true);
});
