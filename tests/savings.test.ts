import { test } from "node:test";
import assert from "node:assert/strict";
import { isSmallTalk } from "../src/lib/line-sort";
import { aiCost } from "../src/lib/llm";

test("obvious small talk is skipped without AI; anything that may be work is not", () => {
  for (const t of ["รับทราบ", "โอเคครับ", "ok", "ขอบคุณค่ะ", "555555", "👍", "ได้เลย ครับ", "สวัสดีครับ!"]) assert.equal(isSmallTalk(t), true, t);
  for (const t of ["ลาพรุ่งนี้", "จ่ายค่าไฟ 2,300", "ok ส่งของพรุ่งนี้", "รับทราบ ส่งงานภายใน 10 โมง", "อนุมัติ", "", "ขอเบิกงบ"]) assert.equal(isSmallTalk(t), false, t);
});

test("cached prompt tokens are billed at a tenth", () => {
  const full = aiCost({ model: "gemini-3.5-flash-lite", input: 10000, output: 0 })!;
  const cached = aiCost({ model: "gemini-3.5-flash-lite", input: 10000, output: 0, cached: 8000 })!;
  assert.equal(full, 0.003);
  assert.equal(cached, 0.00084);
  assert.equal(aiCost({ model: "unknown", input: 1, output: 1 }), null);
});
