// End-to-end test of the LINE bot against a live deployment, without a phone.
// It sends webhook events signed exactly like LINE signs them, so the real route,
// database and AI queue run. Replies go nowhere (the reply tokens are fake).
//
//   npx tsx scripts/line-e2e.ts                 # checks the webhook rejects unsigned/forged calls
//   npx tsx scripts/line-e2e.ts <pairing-code>  # also pairs a test group and sends work messages
//   npx tsx scripts/line-e2e.ts --chat <groupId> # a realistic day of group chat into an already paired group
//
// Needs LINE_CHANNEL_SECRET (same value as in Vercel) in the environment or .env.local.
// Target: E2E_URL, default https://zettaflow-iota.vercel.app
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

function env(name: string) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env.local")) return undefined;
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(name + "="));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

const base = (process.env.E2E_URL || "https://zettaflow-iota.vercel.app").replace(/\/$/, "");
const url = base + "/api/line/webhook";
const secret = env("LINE_CHANNEL_SECRET");
const chatMode = process.argv[2] === "--chat";
const code = chatMode ? undefined : process.argv[2];
const groupId = chatMode ? process.argv[3] : "Ce2e" + randomUUID().replace(/-/g, "").slice(0, 28);
const userId = "Ue2e" + randomUUID().replace(/-/g, "").slice(0, 28);
let failed = 0;

function event(text: string, id = randomUUID(), from = userId) {
  return {
    type: "message",
    mode: "active",
    timestamp: Date.now(),
    webhookEventId: "e2e-" + id,
    deliveryContext: { isRedelivery: false },
    replyToken: "e2e-" + randomUUID(),
    source: { type: "group", groupId, userId: from },
    message: { type: "text", id: String(Date.now()) + Math.floor(Math.random() * 1000), text },
  };
}

async function send(events: unknown[], signature?: string | null) {
  const body = JSON.stringify({ destination: "e2e", events });
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = signature === undefined ? createHmac("sha256", secret!).update(body).digest("base64") : signature;
  if (sig) headers["x-line-signature"] = sig;
  const r = await fetch(url, { method: "POST", headers, body });
  return { status: r.status, body: await r.text() };
}

function check(name: string, ok: boolean, detail: string) {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${name} — ${detail}`);
}

console.log(`Target ${url}\nTest group ${groupId}\n`);

const unsigned = await send([], null);
check("rejects unsigned calls", unsigned.status === 401, `HTTP ${unsigned.status}`);
const forged = await send([], "Zm9yZ2Vk");
check("rejects forged signatures", forged.status === 401, `HTTP ${forged.status}`);

// A day in a real company group: work mixed with acknowledgements, jokes and follow-ups.
const day: [string, string][] = [
  ["ศิริ", "อรุณสวัสดิ์ทุกคน วันนี้ลูกค้าเซ็นทรัลจะเข้ามาดูบูธบ่าย 2 นะ"],
  ["นภา", "รับทราบค่ะ"],
  ["ศิริ", "@พิม ช่วยส่งแบบ 3D บูธ Fashion Expo ให้ลูกค้าภายในพรุ่งนี้ 10 โมงนะ ด่วน"],
  ["พิม", "ได้ค่ะพี่ 🙏"],
  ["อนุชา", "ของเข้าแล้วครับ เสื้อเชิ้ตลินินขาว 120 ตัว จากสยามเท็กซ์ไทล์ PO-6910"],
  ["นภา", "วันนี้ขอลาครึ่งวันบ่ายนะคะ ไปหาหมอ"],
  ["กิต", "ค่าบูสต์โพสต์ TikTok 3,000 บาท จ่ายด้วยบัตรบริษัทแล้วครับ"],
  ["ภาณุ", "555 ขอบคุณครับ"],
  ["สมชาย", "เบิกกระเป๋าผ้า Tote 40 ใบ ไปงาน Expo นะครับ ขออนุมัติ"],
  ["ต้น", "ปิดดีลไทยเบฟ ยูนิฟอร์ม 300 ชุด มูลค่า 520,000 ตกลงแล้วครับ รอเซ็นสัญญาอาทิตย์หน้า"],
  ["อร", "INV-690103 สยามพิวรรธน์ ยังไม่โอนนะคะ เลยกำหนด 8 วันแล้ว ใครดูแลช่วยตามด้วย"],
  ["ณัฐ", "Router ออฟฟิศรีสตาร์ทแล้วนะครับ เน็ตกลับมาปกติ"],
  ["นภา", "ยอดขายหน้าร้านวันนี้ 58,420 บาท บัตร 41,000 เงินสด 17,420"],
  ["ศิริ", "ประชุมสรุปงาน Expo วันศุกร์ 4 โมงเย็น ทุกคนเข้าด้วยนะ"],
  ["ชนิดา", "พรุ่งนี้มีน้องใหม่ฝ่ายคลังเริ่มงานชื่อศิรินภา ดวงดี"],
];
if (chatMode) {
  if (!secret || !groupId) {
    console.log("Usage: npx tsx scripts/line-e2e.ts --chat <paired groupId> (needs LINE_CHANNEL_SECRET)");
    process.exit(1);
  }
  const people = new Map<string, string>();
  for (const [who, text] of day) {
    if (!people.has(who)) people.set(who, "Ue2e" + randomUUID().replace(/-/g, "").slice(0, 28));
    const r = await send([event(text, undefined, people.get(who))]);
    check("chat", r.status === 200, `HTTP ${r.status} · ${who}: ${text.slice(0, 50)}`);
  }
  console.log(`
Sent ${day.length} messages from ${people.size} people into ${groupId}.`);
  process.exit(failed ? 1 : 0);
}

if (!secret) {
  console.log("\nLINE_CHANNEL_SECRET not set: stopping after the security checks.");
} else {
  const verify = await send([]);
  check("accepts LINE's verify call", verify.status === 200, `HTTP ${verify.status} ${verify.body}`);

  if (!code) {
    console.log("\nNo pairing code given: stopping before pairing. Create one in Settings › Integrations › สร้างรหัสเชื่อมกลุ่ม.");
  } else {
    const pair = await send([event("#connect " + code)]);
    // LINE only sees 200 either way; the result goes back as a chat reply we cannot read here.
    check("pairing command delivered", pair.status === 200, `HTTP ${pair.status} — confirm the group shows in Settings › LINE & Integrations`);

    const messages = [
      "@พิม ช่วยส่งแบบ 3D บูธให้ลูกค้าภายในพรุ่งนี้ 10 โมงนะ ด่วน (ทดสอบ E2E)",
      "ค่าแท็กซี่ไปหาลูกค้า 320 บาท จ่ายเงินสดแล้วครับ (ทดสอบ E2E)",
      "ยอดขายหน้าร้านวันนี้ 58,420 บาท บัตร 41,000 เงินสด 17,420 (ทดสอบ E2E)",
    ];
    const sent = messages.map((m) => event(m));
    for (const e of sent) {
      const r = await send([e]);
      check("message accepted", r.status === 200, `HTTP ${r.status} · ${e.message.text.slice(0, 40)}…`);
    }
    // LINE redelivers on timeouts; the same event must not be stored twice.
    const again = await send([sent[0]]);
    check("redelivery is accepted (deduplicated server-side)", again.status === 200, `HTTP ${again.status}`);
    const q = await send([event("มีงานรออนุมัติกี่งาน?")]);
    check("question to the bot", q.status === 200, `HTTP ${q.status}`);

    console.log(
      `\nNow open ${base}/feed → the template's department → review queue:` +
        `\n  3 items marked (ทดสอบ E2E) should appear within a minute, once each.` +
        `\nTest group id: ${groupId} (remove it in Settings › Integrations when done).`,
    );
  }
}
process.exit(failed ? 1 : 0);
