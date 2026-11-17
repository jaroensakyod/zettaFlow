// LINE → AI import, the parts that need no AI call: what is skipped as chat, the review forms the AI fills,
// the no-AI fallback, and turning the filled values into a real record on each page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../src/lib/catalog";
import { isSmallTalk, pageTemplate, sortPages, withTagged } from "../src/lib/line-sort";
import { mapToTarget, templateForPage } from "../src/lib/line-target";
import { explicitExtract, validateEntity, validateValues } from "../src/lib/domain";

const ID = "3f1c2a54-7f0e-4c1b-9a63-2d9b0b7e4a11";
const AT = "2026-11-13T03:00:00.000Z"; // 10:00 Bangkok

test("small talk is skipped without calling AI; anything that may be work is not", () => {
  for (const t of ["โอเค", "ได้ค่ะ", "รับทราบครับ", "ขอบคุณมากค่ะ", "555555", "👍", "อรุณสวัสดิ์", "ok", "Thanks"])
    assert.equal(isSmallTalk(t), true, t);
  for (const t of ["ขอลาป่วยพรุ่งนี้", "จ่ายค่าไฟ 2500", "ได้ค่ะ โอนแล้ว 300", "โอเค พรุ่งนี้ 10 โมงประชุม", "ค่าข้าว 120", "", "รับทราบ ส่งของวันศุกร์นะ"])
    assert.equal(isSmallTalk(t), false, t);
});

test("every page the AI sorts into has a review form the AI can fill", () => {
  assert.ok(sortPages.length >= 10);
  for (const { kind } of sortPages) {
    assert.ok(catalog[kind], kind);
    const t = pageTemplate(kind);
    assert.ok(t.fields.length > 0, kind);
    const keys = t.fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, kind + " duplicate keys");
    // bookkeeping and calendar-only fields are never asked from a chat
    for (const k of ["status", "aiNotes", "aiUncertain", "reviewStatus", "color"]) assert.ok(!keys.includes(k), `${kind} asks for ${k}`);
    // the approval fills name / date / department, so the group is not nagged for them
    for (const f of t.fields) if (["name", "date", "department"].includes(f.key)) assert.equal(f.required, false, `${kind}.${f.key}`);
    for (const f of t.fields) if (f.type === "choice") assert.ok(f.options?.length, `${kind}.${f.key} options`);
  }
});

test("LINE group templates mirror a page without colour, status or photos", () => {
  for (const { kind } of sortPages) {
    const { template, map } = templateForPage(kind);
    assert.ok(template.fields.length > 0 && template.fields.length <= 20, kind);
    for (const f of template.fields) {
      const to = catalog[kind].fields.find((x) => x.key === map[f.key]);
      assert.ok(to, `${kind}.${f.key} maps to a page field`);
      assert.ok(!["status", "color"].includes(to.key) && !["lines", "image"].includes(to.type || ""), `${kind}.${to.key}`);
    }
  }
});

/** A value of the right shape for each page field (what a good AI answer looks like). */
function sampleValue(kind: string, key: string) {
  const f = catalog[kind].fields.find((x) => x.key === key)!;
  if (f.type === "relation") return "ชื่อที่พิมพ์ใน LINE";
  if (f.type === "number") return 1200;
  if (f.type === "date") return key === "endDate" ? "2026-11-15" : "2026-11-14";
  if (f.type === "select") return f.options![0];
  if (f.type === "email") return "staff@example.com";
  if (f.type === "url") return "https://example.com";
  if (f.type === "tel") return "0812345678";
  if (/Time$/.test(key)) return "09:30";
  return "ทดสอบจาก LINE";
}

test("values read from LINE become a valid record on every page (names of people/items resolve to records)", () => {
  for (const { kind } of sortPages) {
    const { template, map } = templateForPage(kind);
    const values = Object.fromEntries(template.fields.map((f) => [f.key, sampleValue(kind, map[f.key])]));
    const target = mapToTarget({ ...template, target_kind: kind, field_map: map }, values, AT, () => ID);
    assert.ok(target, kind);
    assert.equal(target!.kind, kind);
    assert.doesNotThrow(() => validateEntity(kind, target!.data), kind);
  }
});

test("only the required fields filled: name, dropdowns and date get defaults so the record still saves", () => {
  for (const { kind } of sortPages) {
    const { template, map } = templateForPage(kind);
    const values = Object.fromEntries(template.fields.filter((f) => f.required).map((f) => [f.key, sampleValue(kind, map[f.key])]));
    const target = mapToTarget({ ...template, target_kind: kind, field_map: map }, values, AT, () => ID)!;
    if (!template.fields.some((f) => f.required && map[f.key] === "name"))
      assert.ok(String(target.data.name).includes("13/11/2026 10:00"), `${kind} default name: ${target.data.name}`);
    assert.ok(String(target.data.name).trim(), `${kind} has a name`);
    for (const f of catalog[kind].fields)
      if (f.type === "select" && f.required) assert.ok(f.options!.includes(String(target.data[f.key])), `${kind}.${f.key} default`);
    // A purchase order needs its items (or one product with a quantity).
    if (kind === "purchases") target.data.lines = [{ name: "กระดาษ A4", qty: 10, price: 250 }];
    assert.doesNotThrow(() => validateEntity(kind, target.data), kind);
  }
});

test("a person or item named in LINE that is not on file is left blank, never saved as raw text", () => {
  const { template, map } = templateForPage("leaves");
  const target = mapToTarget({ ...template, target_kind: "leaves", field_map: map }, { employee_id: "คนที่ไม่มีในระบบ", type: "ลาป่วย" }, AT, () => undefined)!;
  assert.equal(target.data.employeeId, undefined);
  const known = mapToTarget({ ...template, target_kind: "leaves", field_map: map }, { employee_id: "สมชาย" }, AT, (r, n) => (r === "employees" && n === "สมชาย" ? ID : undefined))!;
  assert.equal(known.data.employeeId, ID);
});

test("no AI configured: 'หัวข้อ: ค่า' lines still fill the form", () => {
  const t = pageTemplate("expenses");
  const r = explicitExtract(t, "รายการค่าใช้จ่าย: ค่าไฟสำนักงาน\nยอดตามเอกสาร: 3,450\nวันที่: 2026-11-12\nการชำระ: โอนแล้ว");
  assert.equal(r.values.name, "ค่าไฟสำนักงาน");
  assert.equal(r.values.amount, 3450);
  assert.equal(r.values.date, "2026-11-12");
  assert.equal(r.values.payStatus, "โอนแล้ว");
  assert.deepEqual(r.missing, []);
  // nothing in the expected form: amount is reported missing instead of guessed
  const none = explicitExtract(t, "จ่ายค่าไฟไปแล้วนะ");
  assert.equal(none.values.amount, null);
  assert.ok(none.missing.length > 0);
});

test("an AI answer of the wrong shape is refused, not saved", () => {
  const t = pageTemplate("expenses");
  assert.throws(() => validateValues(t, { amount: "สามพัน" }));
  assert.throws(() => validateValues(t, { amount: 100, date: "13/11/2569" }));
  assert.throws(() => validateValues(t, { amount: 100, payStatus: "จ่ายแล้วจ้า" }));
  assert.doesNotThrow(() => validateValues(t, { amount: 100, date: "2026-11-13", payStatus: "โอนแล้ว" }));
});

test("a department typed in Thai or English is stored as its key", async () => {
  const { normalizeDepartment } = await import("../src/lib/line-target");
  const cases: [string, string][] = [
    ["การตลาด", "Marketing"], ["ฝ่ายการตลาด", "Marketing"], ["marketing", "Marketing"], ["ฝ่ายบัญชีและการเงิน", "Finance"],
    ["บัญชี", "Finance"], ["ฝ่ายบุคคล", "HR"], ["HR", "HR"], ["คลังสินค้า", "Warehouse"], ["ฝ่ายขาย", "Sales"], ["ไอที", "IT"],
    ["จัดซื้อ", "Purchasing"], ["บริการลูกค้า", "Customer Service"], ["พัฒนาธุรกิจ", "Business Development"], ["ทีมอีเวนต์", "Event"],
  ];
  for (const [typed, key] of cases) assert.equal(normalizeDepartment(typed, "Operations"), key, typed);
  assert.equal(normalizeDepartment("", "Operations"), "Operations");
  assert.equal(normalizeDepartment("แผนกที่ไม่มี", "Operations"), "Operations");
  // and on the way into a record
  const { template, map } = templateForPage("tasks");
  const dept = Object.keys(map).find((k) => map[k] === "department")!;
  const t = mapToTarget({ ...template, target_kind: "tasks", field_map: map }, { name: "ประชุม", [dept]: "การตลาด" }, AT)!;
  assert.equal(t.data.department, "Marketing");
  assert.doesNotThrow(() => validateEntity("tasks", t.data));
});

test("a new employee tagged in LINE keeps that person's LINE; other pages and untagged messages are unchanged", () => {
  const U = "U" + "1".repeat(32);
  const t = pageTemplate("employees");
  assert.ok(!t.fields.some((f) => f.key === "lineUserId"), "the AI is never asked for a LINE id");
  const r = withTagged("employees", t, { position: "เซลล์" }, [{ id: U, name: "สมชาย" }]);
  assert.equal(r.values.lineUserId, U);
  assert.equal(r.values.name, "สมชาย");
  assert.ok(r.template!.fields.some((f) => f.key === "lineUserId"));
  assert.deepEqual((r.template as { tagged?: unknown }).tagged, [{ id: U, name: "สมชาย" }]);
  // the name typed in the message wins over the LINE display name
  assert.equal(withTagged("employees", t, { name: "สมชาย ใจดี" }, [{ id: U, name: "chai" }]).values.name, "สมชาย ใจดี");
  // a re-read keeps one lineUserId field
  assert.equal(withTagged("employees", r.template, {}, [{ id: U, name: "" }]).template!.fields.filter((f) => f.key === "lineUserId").length, 1);
  assert.deepEqual(withTagged("leaves", pageTemplate("leaves"), { a: 1 }, [{ id: U, name: "x" }]).values, { a: 1 });
  assert.deepEqual(withTagged("employees", t, { a: 1 }, []).values, { a: 1 });
});

test("free package: only บัญชีและการเงิน is recorded from LINE; anything else gets the upgrade message with the package link", async () => {
  const { freeKind } = await import("../src/lib/departments");
  const { upgradeText } = await import("../src/lib/line-mention");
  for (const k of ["expenses", "payments", "invoices", "bills"]) assert.equal(freeKind(k), true, k);
  for (const k of ["employees", "leaves", "tasks", "sales", "stock_issues", "customers", "projects"]) assert.equal(freeKind(k), false, k);
  const t = upgradeText("employees", "https://eliteflow-ai.com/workspace/pricing");
  assert.match(t, /พนักงาน/);
  assert.match(t, /อัปเกรด/);
  assert.match(t, /https:\/\/eliteflow-ai\.com\/workspace\/pricing/);
  assert.doesNotMatch(upgradeText("leaves", ""), /👉/);
});
