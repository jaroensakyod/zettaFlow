import { test } from "node:test";
import assert from "node:assert/strict";
import { supportTopic, supportTopics } from "../src/lib/support-topics";

test("the subject is read back from the start of a support message", () => {
  assert.deepEqual(supportTopic("[แพ็กเกจ / ชำระเงิน] โอนแล้วยังไม่ขึ้น"), { topic: "แพ็กเกจ / ชำระเงิน", text: "โอนแล้วยังไม่ขึ้น" });
  assert.deepEqual(supportTopic("[แจ้งปัญหา] ผ่านน้องโฟลว์\nกดไม่ได้"), { topic: "แจ้งปัญหา", text: "ผ่านน้องโฟลว์\nกดไม่ได้" });
  assert.deepEqual(supportTopic("สวัสดีครับ"), { topic: "", text: "สวัสดีครับ" });
  for (const t of supportTopics) assert.equal(supportTopic("[" + t + "] x").topic, t);
});
