import { test } from "node:test";
import assert from "node:assert/strict";
import { lineNotice } from "../src/lib/line-message";

process.env.NEXT_PUBLIC_APP_URL = "https://eliteflow-ai.com";

test("a complete item names its page, who asked, what was read and the approve keyword — no raw ids", () => {
  const t = lineNotice({ kind: "expenses", values: { name: "ค่า claude", amount: 4000 }, missing: [], keyword: "อนุมัติ", requester: "SIRI" });
  assert.match(t, /บันทึกเข้า「ค่าใช้จ่าย」แล้ว รอผู้จัดการอนุมัติ/);
  assert.match(t, /👤 ผู้ขอ: SIRI/);
  assert.match(t, /ค่า claude · ฿4,000/);
  assert.match(t, /พิมพ์ “อนุมัติ”/);
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
