import { test } from "node:test";
import assert from "node:assert/strict";
import { lineSample, lineSeeds, sampleTiers } from "../src/lib/mock/line";
import { employeesSample, isSampleId, portrait } from "../src/lib/mock/employees";
import { lineStats } from "../src/lib/line-page";
import { headcount, listOf, monthAttendance, percentOf, performance, teamScore, todaySummary, forEmployee, ratingLabel } from "../src/lib/employees-stats";

const NOW = Date.parse("2026-11-07T05:00:00Z"); // 12:00 Bangkok

test("LINE mockup: 7 groups, tiles consistent with rows (7 / 7 / 0 / 0 / 12)", () => {
  const d = lineSample(NOW);
  assert.equal(d.groups.length, 7);
  assert.deepEqual(d.stats, lineStats(d.groups, 0));
  assert.deepEqual(d.stats, { groups: 7, connected: 7, pending: 0, problems: 0, waiting: 12 });
  assert.equal(d.groups.reduce((s, g) => s + g.waiting, 0), 12);
  assert.ok(d.groups.every((g) => g.group_id.startsWith("sample-") && g.status === "connected" && !g.test));
  assert.equal(new Set(d.groups.map((g) => g.group_id)).size, 7);
});

test("LINE mockup: rows match the design", () => {
  const d = lineSample(NOW);
  const first = d.groups[0];
  assert.equal(first.title, "บัญชี-การเงิน");
  assert.equal(first.members, 24);
  assert.equal(first.departmentLabel, "บัญชี");
  assert.deepEqual(first.kinds, ["เอกสารการเงิน", "บิล", "ค่าใช้จ่าย"]);
  assert.equal(first.senderCount - first.senders.length, 8); // "+8"
  assert.equal(first.approvers[0].name, "คุณเอ (ผู้จัดการบัญชี)");
  assert.deepEqual(
    d.groups.map((g) => [g.title, g.members]),
    [
      ["บัญชี-การเงิน", 24],
      ["ฝ่ายขาย", 36],
      ["การตลาด (Marketing)", 28],
      ["จัดซื้อ (Purchasing)", 18],
      ["คลังสินค้า", 20],
      ["โครงการ (Project)", 32],
      ["บริหารทั่วไป (Admin)", 15],
    ],
  );
  assert.deepEqual(
    d.groups.map((g) => g.senderCount - g.senders.length),
    [8, 12, 9, 5, 7, 10, 4],
  );
  for (const g of d.groups) {
    assert.equal(g.senders.length, 3);
    // Pictures are inline illustrations, never external images.
    for (const pic of [g.picture, ...g.senders.map((s) => s.picture)]) assert.match(String(pic), /^data:image\/svg\+xml,/);
    assert.ok(g.search.includes(g.title.toLowerCase()));
  }
  assert.equal(lineSeeds.length, 7);
});

test("LINE mockup: Business package 7 / 10, the five real packages, four recent activities", () => {
  const d = lineSample(NOW);
  assert.equal(d.package.used, d.groups.length);
  assert.equal(d.package.limit, 10);
  assert.deepEqual(
    sampleTiers.map((t) => t.name),
    ["Free", "Starter", "Growth", "Business", "Enterprise"],
  );
  assert.deepEqual(
    d.package.tiers.filter((t) => t.current).map((t) => t.name),
    ["Business"],
  );
  assert.ok(d.activity.length > 4); // so "ดูทั้งหมด" shows
  assert.deepEqual(
    d.activity.slice(0, 4).map((a) => a.text),
    ['เชื่อมต่อกลุ่ม "คลังสินค้า" สำเร็จ', 'มีรายการรออนุมัติ 3 รายการ จากกลุ่ม "จัดซื้อ"', 'ดึงข้อมูลใหม่จากกลุ่ม "โครงการ" (5 รายการ)', 'อัปเดตสิทธิ์ผู้อนุมัติ กลุ่ม "การตลาด"'],
  );
  const sorted = [...d.activity].sort((a, b) => b.at.localeCompare(a.at));
  assert.deepEqual(d.activity, sorted);
  const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
  assert.deepEqual(d.activity.slice(0, 4).map((a) => hm(a.at)), ["14:32", "13:10", "11:46", "17:20"]);
  const groupIds = new Set(d.groups.map((g) => g.group_id));
  assert.ok(d.activity.every((a) => a.group && groupIds.has(a.group)));
});

for (const today of ["2026-11-07", "2026-11-28", "2026-02-03", "2026-01-31"])
  test(`Employees mockup tiles are what the page computes from its rows (${today})`, () => {
    const m = employeesSample(today);
    assert.equal(m.rows.length, 16);
    assert.ok([...m.rows, ...m.attendance, ...m.leaves, ...m.kpi].every((r) => isSampleId(r.id)));
    assert.equal(new Set([...m.rows, ...m.attendance, ...m.leaves, ...m.kpi].map((r) => r.id)).size, m.rows.length + m.attendance.length + m.leaves.length + m.kpi.length);
    const head = headcount(m.rows);
    assert.deepEqual(head, { total: 16, active: 14, inactive: 2, activePct: 87.5, inactivePct: 12.5 });
    const now = todaySummary(m.rows, m.attendance, m.leaves, today);
    assert.deepEqual(now, { present: 14, away: 2, recorded: true });
    assert.equal(percentOf(now.present, head.total), 87.5);
    assert.equal(percentOf(now.away, head.total), 12.5);
    assert.equal(teamScore(m.rows, m.kpi), 4.6);
    assert.ok(m.attendance.every((r) => String(r.data.date).startsWith(today.slice(0, 7))));
  });

test("Employees mockup: first person matches the design detail", () => {
  const today = "2026-11-07";
  const m = employeesSample(today);
  const e = m.rows[0];
  assert.equal(e.data.name, "ศิริกัลยา วงศ์ทอง");
  assert.equal(e.data.code, "EMP-001");
  assert.equal(e.data.position, "กรรมการผู้จัดการ");
  assert.equal(e.data.department, "บริหาร");
  assert.equal(e.data.level, "ผู้บริหาร");
  assert.equal(e.data.startDate, "2023-01-01");
  assert.equal(e.data.phone, "082-456-7890");
  assert.equal(e.data.email, "sirikanya@eliteflow.co.th");
  assert.deepEqual(
    m.rows.slice(0, 5).map((r) => [r.data.name, r.data.code]),
    [
      ["ศิริกัลยา วงศ์ทอง", "EMP-001"],
      ["ธนพล ศรีสุข", "EMP-002"],
      ["นภา ใจดี", "EMP-003"],
      ["ปิยะพงษ์ มั่นคง", "EMP-004"],
      ["กชกร นิลภา", "EMP-005"],
    ],
  );
  const perf = performance(e, m.kpi);
  assert.equal(perf.score, 4.8);
  assert.equal(ratingLabel(perf.score!), "ยอดเยี่ยม");
  assert.deepEqual(
    perf.lines.map((l) => [l.label, l.value]),
    [
      ["ผลสัมฤทธิ์งาน", 5],
      ["ความเป็นผู้นำ", 4.9],
      ["การสื่อสาร", 4.7],
      ["การบริหารทีม", 4.8],
      ["การแก้ปัญหา", 4.8],
    ],
  );
  for (const t of ["2026-11-07", "2026-11-28", "2026-02-03"]) {
    const mm = employeesSample(t);
    const month = monthAttendance(forEmployee(mm.attendance, mm.rows[0]), forEmployee(mm.leaves, mm.rows[0]), t);
    assert.deepEqual(month, { present: 20, late: 2, absent: 0, leave: 1, recorded: 21, rate: 95 }, t);
  }
  assert.deepEqual(listOf(e.data.skills), ["การบริหารองค์กร", "กลยุทธ์ธุรกิจ", "การวางแผน", "การเจรจาต่อรอง", "การบริหารทีม"]);
  assert.deepEqual(listOf(e.data.strengths), ["ผู้นำและตัดสินใจได้ดี", "มองภาพรวมและวางกลยุทธ์ระยะยาว", "สื่อสารชัดเจน สร้างแรงบันดาลใจทีม"]);
  for (const r of m.rows) assert.match(m.portraits[r.id], /^data:image\/svg\+xml,/);
  assert.equal(new Set(Object.values(m.portraits)).size > 8, true); // varied looks
  assert.match(decodeURIComponent(portrait({ hair: "bun", bg: "#fff", shirt: "#000" })), /<svg[\s\S]*<\/svg>$/);
});
