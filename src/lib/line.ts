// LINE bot helpers: replies and read-only answers to common executive questions in chat.
export type QuickStats = {
  company: string;
  review: number;
  missing: number;
  pendingDeals: number;
  openTasks: number;
  activeProjects: number;
  salesToday: number;
  salesMonth: number;
};
const baht = (n: number) => "฿" + Number(n || 0).toLocaleString("th-TH");
/** A message is a question for the bot when it mentions the bot or ends with a question marker. */
export function isQuestion(text: string) {
  const t = text.trim();
  return (
    /^(@?zetta|@?บอท|ถาม)(\s|$)/i.test(t) ||
    /(\?|？|ไหม|มั้ย|กี่|เท่าไร|เท่าไหร่|อะไรบ้าง)\s*$/.test(t)
  );
}
/** Deterministic Thai answers from database numbers. Never claims actions; read-only. */
export function answerQuestion(text: string, s: QuickStats) {
  const t = text.toLowerCase();
  const lines: string[] = [];
  if (/อนุมัติ|approve|review|ตรวจ/.test(t))
    lines.push(`มี ${s.review} งานรออนุมัติครับ` + (s.missing ? ` (ในนั้น ${s.missing} งานยังขาดข้อมูล)` : ""));
  if (/ขาย|ยอด|sales/.test(t))
    lines.push(`ยอดขายวันนี้ ${baht(s.salesToday)} · เดือนนี้ ${baht(s.salesMonth)}`);
  if (/ดีล|พื้นที่|space|deal/.test(t)) lines.push(`ดีล/พื้นที่รออนุมัติ ${s.pendingDeals} รายการ`);
  if (/งาน|task/.test(t) && !/อนุมัติ/.test(t)) lines.push(`งานที่ยังไม่เสร็จ ${s.openTasks} งาน`);
  if (/โครงการ|project/.test(t)) lines.push(`โครงการที่กำลังดำเนินการ ${s.activeProjects} โครงการ`);
  if (!lines.length)
    lines.push(
      `สรุป ${s.company}: รออนุมัติ ${s.review} · งานค้าง ${s.openTasks} · โครงการ ${s.activeProjects} · ยอดขายวันนี้ ${baht(s.salesToday)}`,
    );
  return lines.join("\n");
}
export async function lineReply(replyToken: string | undefined, text: string) {
  if (!replyToken || !process.env.LINE_CHANNEL_ACCESS_TOKEN) return false;
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  }).catch(() => null);
  return !!r?.ok;
}
