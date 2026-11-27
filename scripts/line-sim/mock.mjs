// Loaded with NODE_OPTIONS=--import by the "line-sim" dev server (.claude/launch.json). It stands in for LINE and for
// the AI on this machine only, so the real webhook, database and AI queue run without a phone or an API key:
//  • api.line.me reply / push → appended to $LINE_SIM_DIR/out.jsonl (what the bot would have said in the group);
//  • bot info / member profile / group summary → fixed answers ($LINE_SIM_DIR/people.json gives member names);
//  • api-data.line.me content → the file scripts/line-sim/run.ts put in $LINE_SIM_DIR/content/<message id>;
//  • Gemini → a fixed reading of the sample receipt (the AI itself is not tested here).
// Anything else goes to the real network. Never load this in production.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.LINE_SIM_DIR || ".data/line-sim";
mkdirSync(join(dir, "content"), { recursive: true });
const real = globalThis.fetch;
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
let sent = 0;

/** The fixed reading of the sample receipt (DBD fees for registering the company). */
const receipt = {
  name: "ค่าจดทะเบียนบริษัท",
  payee: "กรมพัฒนาธุรกิจการค้า",
  docNo: "69006222309816",
  date: "2026-11-27",
  amount: 6300,
  lines: [
    { name: "หนังสือบริคณห์สนธิ", qty: 1, unit: null, price: 500 },
    { name: "จัดตั้งบริษัทจำกัด", qty: 1, unit: null, price: 5000 },
    { name: "อากรแสตมป์", qty: 1, unit: null, price: 200 },
    { name: "หนังสือรับรองหุ้นส่วนบริษัท", qty: 1, unit: null, price: 200 },
    { name: "รับรองสำเนา 6 แผ่น", qty: 1, unit: null, price: 300 },
    { name: "ใบสำคัญ", qty: 1, unit: null, price: 100 },
  ],
};
const prefer = {
  category: [/ภาษีและทะเบียน/, /ทะเบียน/, /อื่น/],
  docType: [/ใบเสร็จ/],
  vatMode: [/none/],
  whtRate: [/^0$/],
  payStatus: [/โอนแล้ว/],
};
function aiAnswer(body) {
  const cfg = body.generationConfig || {};
  const schema = cfg.responseJsonSchema;
  if (!schema) return "รับทราบค่ะ";
  const props = schema.properties || {};
  if (props.page) return JSON.stringify({ page: (props.page.enum || []).includes("expenses") ? "expenses" : "none", title: receipt.name });
  const out = {};
  for (const [k, p] of Object.entries(props)) {
    if (p.enum) {
      const opts = p.enum.filter((x) => x !== null);
      out[k] = (prefer[k] || []).map((re) => opts.find((o) => re.test(String(o)))).find(Boolean) ?? null;
    } else out[k] = k in receipt ? receipt[k] : null;
  }
  return JSON.stringify(out);
}

globalThis.fetch = async function simFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.line.me/") || url.startsWith("https://api-data.line.me/")) {
    const path = new URL(url).pathname;
    if (/\/v2\/bot\/message\/(reply|push)$/.test(path)) {
      const body = JSON.parse(String(init?.body || "{}"));
      appendFileSync(join(dir, "out.jsonl"), JSON.stringify({ at: new Date().toISOString(), via: path.endsWith("reply") ? "reply" : "push", messages: body.messages || [] }) + "\n");
      return json({ sentMessages: (body.messages || []).map(() => ({ id: "sim" + Date.now() + ++sent, quoteToken: "sim" })) });
    }
    if (path === "/v2/bot/info") return json({ userId: "Usimbot", displayName: "EliteFlow" });
    const member = /\/v2\/bot\/group\/[^/]+\/member\/([^/]+)$/.exec(path);
    if (member) {
      const people = existsSync(join(dir, "people.json")) ? JSON.parse(readFileSync(join(dir, "people.json"), "utf8")) : {};
      return json({ userId: member[1], displayName: people[decodeURIComponent(member[1])] || "สมาชิก" });
    }
    if (/\/v2\/bot\/group\/[^/]+\/summary$/.test(path)) return json({ groupId: "sim", groupName: "กลุ่มทดสอบ (จำลอง)" });
    const content = /\/v2\/bot\/message\/([^/]+)\/content$/.exec(path);
    if (content) {
      const f = join(dir, "content", decodeURIComponent(content[1]));
      if (!existsSync(f)) return new Response("not found", { status: 404 });
      return new Response(readFileSync(f), { headers: { "content-type": readFileSync(f + ".mime", "utf8") } });
    }
    return json({});
  }
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    const body = JSON.parse(String(init?.body || "{}"));
    return json({ candidates: [{ content: { parts: [{ text: aiAnswer(body) }] } }], usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } });
  }
  return real(input, init);
};
