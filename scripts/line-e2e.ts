// End-to-end test of the LINE bot against a live deployment, without a phone.
// It sends webhook events signed exactly like LINE signs them, so the real route,
// database and AI queue run. Replies go nowhere (the reply tokens are fake).
//
//   npx tsx scripts/line-e2e.ts                 # checks the webhook rejects unsigned/forged calls
//   npx tsx scripts/line-e2e.ts <pairing-code>  # also pairs a test group and sends work messages
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
const code = process.argv[2];
const groupId = "Ce2e" + randomUUID().replace(/-/g, "").slice(0, 28);
const userId = "Ue2e" + randomUUID().replace(/-/g, "").slice(0, 28);
let failed = 0;

function event(text: string, id = randomUUID()) {
  return {
    type: "message",
    mode: "active",
    timestamp: Date.now(),
    webhookEventId: "e2e-" + id,
    deliveryContext: { isRedelivery: false },
    replyToken: "e2e-" + randomUUID(),
    source: { type: "group", groupId, userId },
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

if (!secret) {
  console.log("\nLINE_CHANNEL_SECRET not set: stopping after the security checks.");
} else {
  const verify = await send([]);
  check("accepts LINE's verify call", verify.status === 200, `HTTP ${verify.status} ${verify.body}`);

  if (!code) {
    console.log("\nNo pairing code given: stopping before pairing. Create one in Settings › Integrations › สร้างรหัสเชื่อมกลุ่ม.");
  } else {
    const pair = await send([event("#connect " + code)]);
    check("pairs the test group", pair.status === 200, `HTTP ${pair.status}`);

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
      `\nNow open ${base}/eliteflow → the template's department → review queue:` +
        `\n  3 items marked (ทดสอบ E2E) should appear within a minute, once each.` +
        `\nTest group id: ${groupId} (remove it in Settings › Integrations when done).`,
    );
  }
}
process.exit(failed ? 1 : 0);
