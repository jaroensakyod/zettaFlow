import { test } from "node:test";
import assert from "node:assert/strict";
import { lineNotice } from "../src/lib/line-message";

process.env.NEXT_PUBLIC_APP_URL = "https://eliteflow-ai.com";

test("a complete item names its page, who asked, what was read and the approve keyword — no raw ids", () => {
  const t = lineNotice({ kind: "expenses", values: { name: "ค่า claude", amount: 4000 }, missing: [], keyword: "อนุมัติ", requester: "SIRI" });
  assert.match(t, /บันทึกเข้า「ค่าใช้จ่าย」แล้ว ส่งขออนุมัติต่อ/);
  assert.match(t, /👤 ผู้ขอ: SIRI/);
  assert.match(t, /ค่า claude · ฿4,000/);
  assert.match(t, /ยังไม่ถือว่าอนุมัติ/);
  assert.doesNotMatch(t, /ข้อมูลผิด/);
  assert.doesNotMatch(t, /[0-9a-f]{8}-[0-9a-f]{4}/);
  assert.doesNotMatch(t, /#approve/);
});

test("a missing field says who asked, what is missing and how to send it", () => {
  const t = lineNotice({ kind: "expenses", values: { name: "ค่า AI" }, missing: ["ยอดตามเอกสาร"], requester: "M" });
  assert.match(t, /แต่ยังขาด: ยอดตามเอกสาร/);
  assert.match(t, /👤 ผู้ขอ: M/);
  assert.match(t, /กด Reply ข้อความนี้ แล้วพิมพ์ข้อมูลที่ขาด/);
});

test("a foreign amount keeps its currency", () => {
  const t = lineNotice({ kind: "expenses", values: { name: "Cloudflare", amount: 373.52, amountForeign: 11.17, currency: "USD" }, missing: [] });
  assert.match(t, /Cloudflare · \$11\.17/);
});

test("a request posted to the approving department names who asked, what and how to answer", async () => {
  const { approverNotice } = await import("../src/lib/line-message");
  const t = approverNotice({ kind: "expenses", values: { name: "ซื้ออะไหล่", amount: 5000 }, requester: "ช่างเอ", from: "ฝ่ายปฏิบัติการ · แผนกซ่อม" });
  assert.match(t, /คำขอใหม่จาก ฝ่ายปฏิบัติการ · แผนกซ่อม/);
  assert.match(t, /ค่าใช้จ่าย: ซื้ออะไหล่ · ฿5,000/);
  assert.match(t, /👤 ผู้ขอ: ช่างเอ/);
  assert.match(t, /“อนุมัติ”/);
});

test("a manager's reply is read as approve, reject with reason, or edit", async () => {
  const { parseDecision } = await import("../src/lib/line-message");
  assert.deepEqual(parseDecision("อนุมัติ"), { status: "approved" });
  assert.deepEqual(parseDecision("อนุมัติค่ะ"), { status: "approved" });
  assert.deepEqual(parseDecision("ไม่อนุมัติ เพราะงบเดือนนี้หมด"), { status: "rejected", reason: "งบเดือนนี้หมด" });
  assert.deepEqual(parseDecision("ยกเลิก"), { status: "rejected", reason: "" });
  assert.deepEqual(parseDecision("แก้ ยอด 4,500"), { status: "edit", note: "ยอด 4,500" });
  assert.equal(parseDecision("ได้ครับ"), null);
});

test("a rejection typed straight into the group is read only in its clear forms", async () => {
  const { groupRejection, parseDecision } = await import("../src/lib/line-message");
  assert.equal(groupRejection("ไม่อนุมัติ"), "");
  assert.equal(groupRejection("ไม่ให้"), "");
  assert.equal(groupRejection("ไม่อนุมัติ เพราะงบหมด"), "งบหมด");
  assert.equal(groupRejection("ไม่ให้ ยอดเกิน"), "ยอดเกิน");
  assert.equal(groupRejection("ยกเลิกนัดพรุ่งนี้"), null);
  assert.equal(groupRejection("ไม่ให้เข้า"), null);
  assert.equal(groupRejection("อนุมัติ"), null);
  assert.deepEqual(parseDecision("ไม่ให้"), { status: "rejected", reason: "" });
});

test("the answer after a decision says what, which page, who asked and who decided", async () => {
  const { decidedText } = await import("../src/lib/line-message");
  const ok = decidedText("approved", { name: "ขอลาออก", kind: "leaves", requester: "SIRI", decider: "deepseek" });
  assert.match(ok, /✅ อนุมัติแล้ว: ขอลาออก \(การลา\)/);
  assert.match(ok, /👤 ผู้ขอ: SIRI/);
  assert.match(ok, /อนุมัติโดย: deepseek/);
  const no = decidedText("rejected", { name: "ขอเบิก 20", kind: "expenses", requester: "SIRI", decider: "deepseek" }, "งบหมด");
  assert.match(no, /❌ ไม่อนุมัติ: ขอเบิก 20 \(ค่าใช้จ่าย\)/);
  assert.match(no, /เหตุผล: งบหมด/);
  assert.match(no, /ไม่อนุมัติโดย: deepseek/);
});
