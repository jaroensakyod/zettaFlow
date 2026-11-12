import { test } from "node:test";
import assert from "node:assert/strict";
import { routeIntent, parseDue, pageFor } from "../src/lib/flow-intent";

const today = "2026-10-19"; // Monday

test("flow intent: due dates from Thai phrases", () => {
  assert.equal(parseDue("พรุ่งนี้", today), "2026-10-20");
  assert.equal(parseDue("มะรืนนี้", today), "2026-10-21");
  assert.equal(parseDue("วันศุกร์นี้", today), "2026-10-23");
  assert.equal(parseDue("จันทร์หน้า", today), "2026-10-26");
  assert.equal(parseDue("ส่ง 25/10/2569", today), "2026-10-25");
  assert.equal(parseDue("31/02", today), "");
  assert.equal(parseDue("เร็วๆ", today), "");
});

test("flow intent: create task, queries, open page, chat", () => {
  assert.deepEqual(routeIntent("สร้างงานให้ฝ่ายบัญชีตามเก็บเงินลูกค้า ครบกำหนดวันศุกร์นี้", today), {
    kind: "create_task",
    draft: { name: "ตามเก็บเงินลูกค้า", department: "Finance", dueDate: "2026-10-23", priority: "normal" },
  });
  const urgent = routeIntent("เพิ่มงาน เตรียมบูธ ด่วน", today);
  assert.equal(urgent.kind === "create_task" && urgent.draft.priority, "urgent");
  assert.deepEqual(routeIntent("ใบแจ้งหนี้ไหนค้างจ่ายบ้าง", today), { kind: "query", topic: "overdue_invoices" });
  assert.deepEqual(routeIntent("มีงานอะไรใกล้ครบกำหนด", today), { kind: "query", topic: "due_tasks" });
  assert.deepEqual(routeIntent("สินค้าไหนใกล้หมด", today), { kind: "query", topic: "low_stock" });
  assert.deepEqual(routeIntent("สรุปยอดขายเดือนนี้", today), { kind: "query", topic: "sales", period: "month" });
  assert.deepEqual(routeIntent("เปิดหน้าสต็อก", today), { kind: "open", view: "products" });
  assert.deepEqual(routeIntent("ไปที่หน้าหางาน", today), { kind: "open", view: "jobs" });
  assert.equal(pageFor("ใบแจ้งหนี้"), "invoices");
  assert.deepEqual(routeIntent("ช่วยแนะนำวิธีเพิ่มยอด", today), { kind: "chat" });
  // Comparisons and breakdowns go to the AI, which sees the whole company snapshot.
  assert.deepEqual(routeIntent("สรุปยอดขายเดือนนี้เทียบเดือนก่อน แยกช่องทาง", today), { kind: "chat" });
  assert.deepEqual(routeIntent("ทีมไหนต้องเร่งยอดขาย", today), { kind: "chat" });
});

test("แจ้งปัญหา / ข้อเสนอแนะ are told apart from questions about the company's data", async () => {
  const { feedbackKind, feedbackIsEmpty } = await import("../src/lib/flow-intent");
  assert.equal(feedbackKind("กดบันทึกค่าใช้จ่ายแล้วขึ้น error"), "bug");
  assert.equal(feedbackKind("หน้าโปรเจกต์ใช้งานไม่ได้เลย"), "bug");
  assert.equal(feedbackKind("แจ้งปัญหา"), "bug");
  assert.equal(feedbackKind("อยากให้มีระบบเงินเดือนในตัว"), "idea");
  assert.equal(feedbackKind("ขอฟีเจอร์ส่งใบแจ้งหนี้ทางอีเมล"), "idea");
  assert.equal(feedbackKind("แจ้งปัญหา / เสนอแนะ"), "bug");
  // normal questions stay questions
  for (const q of ["ใบแจ้งหนี้ไหนค้างจ่ายบ้าง", "งานค้างมีอะไรบ้าง", "สรุปยอดขายสัปดาห์นี้", "สินค้าไหนใกล้หมด", "สร้างงานประชุมพรุ่งนี้"])
    assert.equal(feedbackKind(q), null, q);
  // only the words, nothing about what happened → ask for details first
  assert.equal(feedbackIsEmpty("แจ้งปัญหา / เสนอแนะ"), true);
  assert.equal(feedbackIsEmpty("อยากเสนอแนะค่ะ"), true);
  assert.equal(feedbackIsEmpty("แจ้งปัญหา กดบันทึกลูกค้าแล้วหน้าค้าง"), false);
});
