// Subjects of a message to the EliteFlow team (ติดต่อเจ้าหน้าที่). Shared by the chat (browser) and src/lib/engage.ts.

/** What a customer picks as the subject; it is kept at the start of the message as "[subject] ". */
export const supportTopics = ["สอบถามการใช้งาน", "แพ็กเกจ / ชำระเงิน", "เชื่อมต่อ LINE", "แจ้งปัญหา", "ข้อเสนอแนะ", "อื่น ๆ"] as const;

/** "[หัวข้อ] ข้อความ" → { topic, text }. A message without a subject gives topic "". */
export function supportTopic(body: string) {
  const m = /^\[([^\]\n]{1,40})\]\s*/.exec(body);
  return m ? { topic: m[1], text: body.slice(m[0].length) } : { topic: "", text: body };
}
