import { test } from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import type { Entity } from "../src/lib/types";
import {
  attendanceKind,
  forEmployee,
  headcount,
  kpiLine,
  leaveBalance,
  listOf,
  monthAttendance,
  overlapDays,
  pageList,
  performance,
  qrMatrix,
  ratingLabel,
  teamScore,
  todaySummary,
} from "../src/lib/employees-stats";

let n = 0;
const row = (kind: string, data: Record<string, unknown>): Entity =>
  ({ id: "id" + ++n, kind, data, version: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }) as unknown as Entity;

const today = "2026-11-07";
const a = row("employees", { name: "ศิริกัลยา วงศ์ทอง", status: "active", score: 90, leaveQuota: 10 });
const b = row("employees", { name: "ธนพล ศรีสุข", status: "probation", score: 80 });
const c = row("employees", { name: "อนุชา พรมแดง", status: "on_leave" });
const d = row("employees", { name: "ลาออก", status: "inactive" });

test("headcount splits working / not working", () => {
  assert.deepEqual(headcount([a, b, c, d]), { total: 4, active: 2, inactive: 2, activePct: 50, inactivePct: 50 });
  assert.deepEqual(headcount([]), { total: 0, active: 0, inactive: 0, activePct: 0, inactivePct: 0 });
});

test("attendance rows count as present, late, absent or leave", () => {
  assert.equal(attendanceKind({ status: "ปกติ", checkIn: "08:40" }), "present");
  assert.equal(attendanceKind({ status: "สาย", checkIn: "09:20" }), "late");
  assert.equal(attendanceKind({ checkIn: "09:20", shiftStart: "09:00" }), "late");
  assert.equal(attendanceKind({ status: "ทำงานนอกสถานที่", checkIn: "10:00" }), "present");
  assert.equal(attendanceKind({ status: "ขาด" }), "absent");
  assert.equal(attendanceKind({ status: "ลา", checkIn: "-" }), "leave");
  assert.equal(attendanceKind({}), "unknown");
});

test("records match by employeeId or, without a link, by name", () => {
  const linked = row("attendance", { name: "x", employeeId: a.id }),
    byName = row("attendance", { name: "ศิริกัลยา วงศ์ทอง" }),
    other = row("attendance", { name: "ศิริกัลยา วงศ์ทอง", employeeId: b.id });
  assert.deepEqual(forEmployee([linked, byName, other], a), [linked, byName]);
});

test("overlapDays counts inclusive days inside a range", () => {
  assert.equal(overlapDays("2026-10-30", "2026-11-02", "2026-11-01", "2026-11-30"), 2);
  assert.equal(overlapDays("2026-11-05", "", "2026-11-01", "2026-11-30"), 1);
  assert.equal(overlapDays("2026-12-01", "2026-12-02", "2026-11-01", "2026-11-30"), 0);
  assert.equal(overlapDays("", "", "2026-11-01", "2026-11-30"), 0);
});

test("month attendance: present, late, absent, leave and rate", () => {
  const att = [
    row("attendance", { date: "2026-11-02", status: "ปกติ", checkIn: "08:50" }),
    row("attendance", { date: "2026-11-03", status: "สาย", checkIn: "09:15" }),
    row("attendance", { date: "2026-11-04", status: "ขาด" }),
    row("attendance", { date: "2026-11-05", status: "ปกติ", checkIn: "08:30" }),
    row("attendance", { date: "2026-10-31", status: "ปกติ", checkIn: "08:30" }), // last month
  ];
  const leaves = [
    row("leaves", { startDate: "2026-11-06", endDate: "2026-11-06", status: "approved", type: "ลาป่วย" }),
    row("leaves", { startDate: "2026-11-20", endDate: "2026-11-21", status: "approved", type: "ลาพักร้อน" }), // future
    row("leaves", { startDate: "2026-11-01", status: "rejected", type: "ลากิจ" }),
  ];
  assert.deepEqual(monthAttendance(att, leaves, today), { present: 3, late: 1, absent: 1, leave: 1, recorded: 5, rate: 60 });
  assert.equal(monthAttendance([], [], today).rate, null);
});

test("today: at work vs late / absent / on leave, and no data", () => {
  const att = [
    row("attendance", { employeeId: a.id, date: today, status: "ปกติ", checkIn: "08:40" }),
    row("attendance", { employeeId: b.id, date: today, status: "สาย", checkIn: "09:30" }),
    row("attendance", { employeeId: c.id, date: "2026-11-06", status: "ปกติ", checkIn: "08:40" }),
  ];
  const leaves = [row("leaves", { employeeId: c.id, startDate: "2026-11-06", endDate: "2026-11-08", status: "approved" })];
  assert.deepEqual(todaySummary([a, b, c, d], att, leaves, today), { present: 2, away: 2, recorded: true });
  assert.equal(todaySummary([a, b], [], [], today).recorded, false);
});

test("KPI lines and performance on a 5-point scale", () => {
  assert.equal(kpiLine(row("kpi", { objective: "ยอดขาย", target: 3.6, actual: 2.9 }))!.value, 4);
  assert.equal(kpiLine(row("kpi", { objective: "x", target: 10, actual: 20 }))!.value, 5);
  assert.equal(kpiLine(row("kpi", { objective: "x", score: 4.7 }))!.value, 4.7);
  assert.equal(kpiLine(row("kpi", { objective: "x" })), null);
  const kpis = [row("kpi", { employeeId: a.id, objective: "A", score: 5 }), row("kpi", { employeeId: a.id, objective: "B", score: 4.6 })];
  assert.deepEqual(
    [performance(a, kpis).score, performance(a, kpis).source, performance(a, kpis).lines.length],
    [4.8, "kpi", 2],
  );
  assert.deepEqual([performance(b, kpis).score, performance(b, kpis).source], [4, "score"]);
  assert.equal(performance(c, kpis).score, null);
  assert.equal(teamScore([a, b, c], kpis), 4.4);
  assert.equal(teamScore([c], []), null);
  assert.equal(ratingLabel(4.8), "ยอดเยี่ยม");
  assert.equal(ratingLabel(3.2), "ดี");
});

test("leave balance uses approved vacation this year", () => {
  const leaves = [
    row("leaves", { employeeId: a.id, type: "ลาพักร้อน", startDate: "2026-03-02", endDate: "2026-03-04", status: "approved" }),
    row("leaves", { employeeId: a.id, type: "ลาพักร้อน", startDate: "2025-12-30", endDate: "2026-01-01", status: "approved" }),
    row("leaves", { employeeId: a.id, type: "ลาป่วย", startDate: "2026-05-01", status: "approved" }),
    row("leaves", { employeeId: a.id, type: "ลากิจ", startDate: "2026-12-01", status: "pending" }),
  ];
  assert.deepEqual(leaveBalance(a, leaves, today), { used: 4, quota: 10, left: 6, pending: 1 });
  assert.deepEqual(leaveBalance(b, leaves, today), { used: 0, quota: null, left: null, pending: 0 });
});

test("lists and page numbers", () => {
  assert.deepEqual(listOf("กลยุทธ์, การวางแผน\nผู้นำ ,"), ["กลยุทธ์", "การวางแผน", "ผู้นำ"]);
  assert.deepEqual(pageList(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(pageList(5, 10), [1, 0, 4, 5, 6, 0, 10]);
  assert.deepEqual(pageList(1, 10), [1, 2, 0, 10]);
});

function decode(text: string) {
  const m = qrMatrix(text);
  assert.ok(m, "matrix for " + text.length + " chars");
  const scale = 4,
    quiet = 4,
    size = (m.length + quiet * 2) * scale,
    px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m.length; x++)
      if (m[y][x])
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
  const r = jsQR(px, size, size);
  assert.ok(r, "decodable: " + text.slice(0, 20));
  return { text: new TextDecoder().decode(new Uint8Array(r.binaryData)), size: m.length };
}

test("QR encoder output decodes back (short, Thai and long vCard)", () => {
  assert.deepEqual(decode("EMP-001"), { text: "EMP-001", size: 21 });
  const thai = "EMP-001 ศิริกัลยา วงศ์ทอง";
  assert.equal(decode(thai).text, thai);
  const card = "BEGIN:VCARD\nVERSION:3.0\nN:วงศ์ทอง;ศิริกัลยา\nFN:ศิริกัลยา วงศ์ทอง\nORG:บริษัท อีลิท โฟลว์ จำกัด\nTITLE:กรรมการผู้จัดการ\nTEL:082-456-7890\nEMAIL:sirikanya@eliteflow.co.th\nNOTE:EMP-001\nEND:VCARD";
  const r = decode(card);
  assert.equal(r.text, card);
  assert.ok(r.size >= 45, "uses a version ≥ 7 (version bits)");
  assert.equal(qrMatrix("x".repeat(2000)), null);
});
