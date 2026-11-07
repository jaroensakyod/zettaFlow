import { test } from "node:test";
import assert from "node:assert/strict";
import { approversFor, buildActivity, groupStatus, groupTitle, kindsOf, lineStats, packageTiers, sendersOf, deptTone } from "../src/lib/line-page";
import { plans } from "../src/lib/billing";

test("kindsOf: page labels by frequency, skipped ignored, form name fallback", () => {
  const rows = [
    { group_id: "g", status: "approved", created_at: "2026-11-01T01:00:00Z", target_kind: "expenses" },
    { group_id: "g", status: "review", created_at: "2026-11-01T02:00:00Z", target_kind: "customers" },
    { group_id: "g", status: "approved", created_at: "2026-11-01T03:00:00Z", target_kind: "customers" },
    { group_id: "g", status: "skipped", created_at: "2026-11-01T04:00:00Z", target_kind: "leads" },
    { group_id: "g", status: "approved", created_at: "2026-11-01T05:00:00Z", template: { name: "ใบส่งของ" } },
  ];
  const k = kindsOf(rows, null);
  assert.equal(k[0], "ลูกค้า");
  assert.equal(k.length, 3);
  assert.ok(k.includes("ใบส่งของ"));
  assert.ok(!k.some((l) => /โอกาส/.test(l)));
  assert.deepEqual(kindsOf([], "ฟอร์มเบิกเงิน"), ["ฟอร์มเบิกเงิน"]);
  assert.deepEqual(kindsOf([{ group_id: "g", status: "approved", created_at: "x", template: { name: "AI แยกอัตโนมัติ" } }], null), []);
});

test("sendersOf: distinct, most recent first", () => {
  const r = (u: string | null) => ({ group_id: "g", status: "review", created_at: "x", source_user: u });
  assert.deepEqual(sendersOf([r("U2"), r("U1"), r("U2"), r(null), r("U3")]), ["U2", "U1", "U3"]);
});

test("approversFor mirrors line_decide: owners always, managers of the group's department", () => {
  const linked = [
    { name: "Owner", role: "owner" as const, departments: [] },
    { name: "Fin", role: "manager" as const, departments: ["Finance"] },
    { name: "Sales", role: "manager" as const, departments: ["Sales"] },
  ];
  assert.deepEqual(approversFor("Finance", linked).map((a) => a.name), ["Fin", "Owner"]);
  assert.deepEqual(approversFor(null, linked).map((a) => a.name).sort(), ["Fin", "Owner", "Sales"]);
  assert.deepEqual(approversFor("HR", linked).map((a) => a.name), ["Owner"]);
});

test("groupStatus and lineStats", () => {
  assert.equal(groupStatus({ test: true, found: false, failedWeek: 0 }, true), "test");
  assert.equal(groupStatus({ test: false, found: false, failedWeek: 0 }, true), "problem");
  assert.equal(groupStatus({ test: false, found: false, failedWeek: 0 }, false), "connected");
  assert.equal(groupStatus({ test: false, found: true, failedWeek: 2 }, true), "warn");
  const s = lineStats(
    [
      { status: "connected", waiting: 3 },
      { status: "warn", waiting: 1 },
      { status: "problem", waiting: 0 },
      { status: "test", waiting: 2 },
    ],
    1,
  );
  assert.deepEqual(s, { groups: 3, connected: 2, pending: 1, problems: 2, waiting: 6 });
});

test("buildActivity: pairing, daily pulls, waiting, decisions, failures — newest first", () => {
  const groups = [{ group_id: "g1", title: "จัดซื้อ", createdAt: "2026-11-01T01:00:00Z" }];
  const rows = [
    { group_id: "g1", status: "review", created_at: "2026-11-05T03:00:00Z" },
    { group_id: "g1", status: "review", created_at: "2026-11-05T02:00:00Z" },
    { group_id: "g1", status: "approved", created_at: "2026-11-04T02:00:00Z", decided_at: "2026-11-04T05:00:00Z", decided_name: "คุณเอ" },
    { group_id: "g1", status: "skipped", created_at: "2026-11-04T01:00:00Z" },
    { group_id: "g1", status: "failed", created_at: "2026-11-04T01:30:00Z" },
    { group_id: "other", status: "review", created_at: "2026-11-06T01:00:00Z" },
  ];
  const a = buildActivity(groups, rows);
  assert.equal(a[0].at, "2026-11-05T03:00:00Z");
  assert.ok(a.some((x) => x.text === 'มีรายการรออนุมัติ 2 รายการ จากกลุ่ม "จัดซื้อ"'));
  assert.ok(a.some((x) => x.text === 'ดึงข้อมูลใหม่จากกลุ่ม "จัดซื้อ" (2 รายการ)'));
  assert.ok(a.some((x) => x.text === 'ดึงข้อมูลใหม่จากกลุ่ม "จัดซื้อ" (2 รายการ)' && x.at === "2026-11-05T03:00:00Z"));
  assert.ok(a.some((x) => x.text === 'อนุมัติ 1 รายการ ในกลุ่ม "จัดซื้อ" โดย คุณเอ'));
  assert.ok(a.some((x) => x.text === 'อ่านข้อความไม่สำเร็จ 1 รายการ จากกลุ่ม "จัดซื้อ"'));
  assert.equal(a[a.length - 1].text, 'เชื่อมต่อกลุ่ม "จัดซื้อ" สำเร็จ');
  assert.ok(!a.some((x) => x.group === "other"));
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].at >= a[i].at);
});

test("packageTiers: ranges from the billing plans' LINE group ceilings", () => {
  const t = packageTiers(plans, "growth");
  assert.deepEqual(
    t.map((x) => [x.id, x.range, x.current]),
    [
      ["starter", "1 – 2 กลุ่ม", false],
      ["growth", "3 – 10 กลุ่ม", true],
      ["enterprise", "ไม่จำกัดกลุ่ม", false],
    ],
  );
});

test("groupTitle and deptTone", () => {
  assert.equal(groupTitle({ name: "", lineName: "บัญชี" }, 0), "บัญชี");
  assert.equal(groupTitle({ name: "", lineName: "", test: true }, 1), "กลุ่มทดสอบ 2");
  assert.equal(deptTone("Finance"), "violet");
  assert.equal(deptTone(null), "none");
  assert.equal(deptTone("Unknown"), "violet");
});
