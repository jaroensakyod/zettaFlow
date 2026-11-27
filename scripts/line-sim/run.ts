// A LINE group conversation played against the local "line-sim" server (.claude/launch.json), to watch the bot's
// process without a phone: the real webhook route, database and AI queue run; LINE and the AI are stood in for by
// scripts/line-sim/mock.mjs. Writes the conversation as $LINE_SIM_DIR/transcript.html (LINE-style, cards drawn).
//
//   npx tsx scripts/line-sim/run.ts <receipt or slip file (pdf/jpg/png)>
//
// Scenario "slip first": a member sends the receipt without tagging the bot (kept, no reply), then tags the bot with
// what it is, gets the summary card, and presses บันทึกได้เลย. Uses its own database (.data/line-sim.sqlite).
import { createHmac, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = (process.env.SIM_URL || "http://127.0.0.1:3104").replace(/\/$/, "");
const dir = process.env.LINE_SIM_DIR || ".data/line-sim";
const dbFile = process.env.D1_FILE || ".data/line-sim.sqlite";
const secret = process.env.LINE_CHANNEL_SECRET || "line-sim-secret";
const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.log("Usage: npx tsx scripts/line-sim/run.ts <receipt or slip file>");
  process.exit(1);
}
const groupId = "Csim" + randomUUID().replace(/-/g, "").slice(0, 28);
const member = { id: "Usim" + randomUUID().replace(/-/g, "").slice(0, 28), name: "ศิริกัลยา" };
mkdirSync(join(dir, "content"), { recursive: true });
rmSync(join(dir, "out.jsonl"), { force: true });
writeFileSync(join(dir, "people.json"), JSON.stringify({ [member.id]: member.name }));

type Line = { who: "member" | "bot" | "note"; at: Date; text?: string; file?: string; messages?: unknown[]; tap?: string };
const chat: Line[] = [];
const note = (text: string) => (chat.push({ who: "note", at: new Date(), text }), console.log("· " + text));

async function send(event: Record<string, unknown>) {
  const body = JSON.stringify({ destination: "Usimbot", events: [{ mode: "active", timestamp: Date.now(), webhookEventId: "sim-" + randomUUID(), deliveryContext: { isRedelivery: false }, replyToken: "sim-" + randomUUID(), source: { type: "group", groupId, userId: member.id }, ...event }] });
  const r = await fetch(base + "/api/line/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": createHmac("sha256", secret).update(body).digest("base64") },
    body,
  });
  if (!r.ok) throw Error(`webhook ${r.status}: ${await r.text()}`);
}
let seen = 0;
/** The bot's messages since the last call, waiting up to `ms` for at least one (or until `until` matches one). */
async function botSays(ms: number, until?: (m: unknown) => boolean) {
  const end = Date.now() + ms;
  const got: { at: string; messages: unknown[] }[] = [];
  while (Date.now() < end) {
    const all = existsSync(join(dir, "out.jsonl")) ? readFileSync(join(dir, "out.jsonl"), "utf8").trim().split("\n").filter(Boolean) : [];
    for (const l of all.slice(seen)) got.push(JSON.parse(l));
    seen = all.length;
    if (got.length && (!until || got.some((g) => g.messages.some(until)))) break;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  for (const g of got) chat.push({ who: "bot", at: new Date(g.at), messages: g.messages });
  for (const g of got) console.log("🤖 " + g.messages.map((m) => (m as { altText?: string; text?: string }).altText || (m as { text?: string }).text || (m as { type: string }).type).join(" | "));
  return got.flatMap((g) => g.messages);
}
const buttons = (m: unknown): { label: string; data: string }[] => {
  const out: { label: string; data: string }[] = [];
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    const a = o.action as { type?: string; label?: string; data?: string } | undefined;
    if (o.type === "button" && a?.type === "postback" && a.data) out.push({ label: String(a.label || ""), data: a.data });
    Object.values(o).forEach(walk);
  };
  walk(m);
  return out;
};

// ---------- set up: a company signed in as the dev user, and a LINE group paired with it ----------
const r = await fetch(base + "/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "บริษัท อีลิทโฟลว์ จำกัด (จำลอง)" }) });
if (!r.ok) throw Error(`onboarding ${r.status}: ${await r.text()}`);
const db = new DatabaseSync(dbFile);
const company = db.prepare("SELECT id, name FROM companies ORDER BY created_at DESC LIMIT 1").get() as { id: string; name: string };
db.prepare("INSERT INTO line_groups (group_id, company_id, name, listen, created_at) VALUES (?, ?, ?, 'mention', ?)").run(groupId, company.id, "กลุ่มบัญชี (จำลอง)", new Date().toISOString());
note(`ตั้งค่า: บริษัท “${company.name}” เชื่อมกับกลุ่ม LINE “กลุ่มบัญชี (จำลอง)” แล้ว · โหมดแท็กบอท`);

// ---------- 1. the slip first, no tag ----------
const msgId = String(Date.now());
const ext = extname(file).toLowerCase();
const mime = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : "image/jpeg";
copyFileSync(file, join(dir, "content", msgId));
writeFileSync(join(dir, "content", msgId + ".mime"), mime);
const fileName = ext === ".pdf" ? basename(file).replace(/^[0-9a-f]{8}-/, "") : "";
chat.push({ who: "member", at: new Date(), file: fileName || "รูปสลิป" });
console.log(`👤 ${member.name}: [ไฟล์ ${fileName || "รูป"}]`);
await send({ type: "message", message: ext === ".pdf" ? { type: "file", id: msgId, fileName, fileSize: statSync(file).size } : { type: "image", id: msgId, contentProvider: { type: "line" } } });
const quiet = await botSays(5000);
const held = db.prepare("SELECT mode, meta FROM line_listen WHERE group_id = ? AND line_user = ?").get(groupId, member.id) as { mode: string; meta: string } | undefined;
const heldCount = held ? (JSON.parse(held.meta || "{}").held || []).length : 0;
note(quiet.length ? "⚠️ บอทตอบทั้งที่ยังไม่ได้แท็ก" : `บอทไม่ตอบ (ถูกต้อง) · ระบบเก็บไฟล์ไว้ ${heldCount} ไฟล์ ยังไม่อ่าน รอคนแท็ก (เก็บไว้ 30 นาที)`);

// ---------- 2. the tag says what it is ----------
const text = "@EliteFlow ค่าจดบริษัท 6,300";
chat.push({ who: "member", at: new Date(), text });
console.log(`👤 ${member.name}: ${text}`);
await send({ type: "message", message: { type: "text", id: String(Date.now()), text, mention: { mentionees: [{ index: 0, length: 10, type: "user", userId: "Usimbot", isSelf: true }] } } });
note("ระบบรอ 6 วินาที (เผื่อส่งข้อความตามมา) แล้วให้ AI อ่านไฟล์ที่เก็บไว้คู่กับข้อความ");
const card = (await botSays(90000, (m) => buttons(m).some((b) => b.data.startsWith("draft=save")))).find((m) => buttons(m).some((b) => b.data.startsWith("draft=save")));
if (!card) {
  note("❌ ไม่ได้การ์ดสรุป");
  const i = db.prepare("SELECT status, error FROM ingestions WHERE group_id = ? ORDER BY created_at DESC LIMIT 1").get(groupId);
  note("รายการล่าสุด: " + JSON.stringify(i));
} else {
  // ---------- 3. บันทึกได้เลย ----------
  const save = buttons(card).find((b) => b.data.startsWith("draft=save"))!;
  chat.push({ who: "member", at: new Date(), tap: save.label });
  console.log(`👤 ${member.name}: [กด ${save.label}]`);
  await send({ type: "postback", postback: { data: save.data } });
  await botSays(30000);
}
const item = db.prepare("SELECT status, target_kind, doc_code, attachment_id FROM ingestions WHERE group_id = ? ORDER BY created_at DESC LIMIT 1").get(groupId) as Record<string, unknown> | undefined;
const files = item ? (db.prepare("SELECT count(*) AS n FROM attachments WHERE ingestion_id = (SELECT id FROM ingestions WHERE group_id = ? ORDER BY created_at DESC LIMIT 1)").get(groupId) as { n: number }).n : 0;
note(`ในระบบ: รายการ ${item?.doc_code || ""} สถานะ ${item?.status} · หน้า ${item?.target_kind || "-"} · ไฟล์แนบ ${files} ไฟล์`);
db.close();

// ---------- the transcript ----------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function flex(x: unknown): string {
  if (!x || typeof x !== "object") return "";
  const o = x as Record<string, unknown>;
  const style = [o.color && `color:${o.color}`, o.backgroundColor && `background:${o.backgroundColor}`, o.weight === "bold" && "font-weight:700", o.align && `text-align:${o.align}`, o.flex !== undefined && `flex:${o.flex}`].filter(Boolean).join(";");
  const size = String(o.size || "");
  switch (o.type) {
    case "carousel":
      return `<div class="carousel">${(o.contents as unknown[]).map(flex).join("")}</div>`;
    case "bubble":
      return `<div class="bubble">${["header", "hero", "body", "footer"].map((k) => (o[k] ? `<div class="${k}">${flex(o[k])}</div>` : "")).join("")}</div>`;
    case "box":
      return `<div class="box ${o.layout}" style="${style}">${((o.contents as unknown[]) || []).map(flex).join("")}</div>`;
    case "text":
      return `<div class="t s-${size}" style="${style}">${o.contents ? (o.contents as { text: string }[]).map((s) => esc(s.text)).join("") : esc(o.text)}</div>`;
    case "button":
      return `<div class="btn ${o.style || "link"}" style="${o.color ? (o.style === "primary" ? `background:${o.color}` : `color:${o.color}`) : ""}">${esc((o.action as { label?: string })?.label)}</div>`;
    case "separator":
      return `<hr>`;
    case "image":
      return `<div class="img">🖼️</div>`;
    case "icon":
      return "";
    default:
      return "";
  }
}
const message = (m: unknown) => {
  const o = m as { type: string; text?: string; contents?: unknown; altText?: string };
  if (o.type === "text") return `<div class="bub bot">${esc(o.text).replace(/\n/g, "<br>")}</div>`;
  if (o.type === "flex") return flex(o.contents);
  return `<div class="bub bot">[${esc(o.type)}]</div>`;
};
const time = (d: Date) => d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const rows = chat
  .map((l) =>
    l.who === "note"
      ? `<div class="note">${esc(l.text)}</div>`
      : l.who === "bot"
        ? `<div class="row bot"><div class="av">E</div><div><div class="nm">EliteFlow</div>${(l.messages || []).map(message).join("")}</div><small>${time(l.at)}</small></div>`
        : `<div class="row me"><small>${time(l.at)}</small>${l.tap ? `<div class="bub me tap">กดปุ่ม “${esc(l.tap)}”</div>` : l.file ? `<div class="bub me file">📄 ${esc(l.file)}</div>` : `<div class="bub me">${esc(l.text)}</div>`}</div>`,
  )
  .join("\n");
writeFileSync(
  join(dir, "transcript.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LINE จำลอง</title>
<style>
body{margin:0;background:#8cabd9;font:14px/1.45 "Noto Sans Thai",system-ui,sans-serif;color:#111}
header{position:sticky;top:0;background:#1f2a44;color:#fff;padding:12px 16px;font-weight:700;z-index:1}header small{display:block;font-weight:400;opacity:.7}
main{max-width:560px;margin:0 auto;padding:14px 12px 40px}
.row{display:flex;gap:8px;margin:12px 0;align-items:flex-end}.row.me{justify-content:flex-end}.row small{font-size:11px;color:#2d3a55;white-space:nowrap}
.av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#db2777);color:#fff;display:grid;place-items:center;font-weight:700;flex:none;align-self:flex-start}
.nm{font-size:12px;color:#26324d;margin-bottom:3px}
.bub{padding:9px 12px;border-radius:18px;max-width:330px;word-break:break-word;margin-bottom:6px}.bub.me{background:#86e36c}.bub.bot{background:#fff}.bub.file{background:#fff;border:1px solid #d8dee9}.bub.tap{background:#fff7d6;font-style:italic}
.note{margin:12px auto;text-align:center;font-size:12px;color:#fff;background:rgba(20,30,60,.45);border-radius:12px;padding:6px 12px;max-width:440px}
.carousel{display:flex;gap:8px;overflow-x:auto}
.bubble{background:#fff;border-radius:16px;overflow:hidden;width:300px;flex:none;margin-bottom:6px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.header,.body,.footer{padding:12px 14px}.footer{display:grid;gap:6px;padding-top:0}
.box{display:flex;flex-direction:column;gap:4px}.box.horizontal,.box.baseline{flex-direction:row;gap:8px;justify-content:space-between}.box.horizontal>*,.box.baseline>*{flex:1 1 0}
.t{white-space:pre-wrap}.s-xxs{font-size:10px}.s-xs{font-size:11.5px}.s-sm{font-size:13px}.s-lg{font-size:16px}.s-xl{font-size:18px}.s-xxl{font-size:22px}
.btn{text-align:center;padding:9px;border-radius:10px;font-weight:600;color:#7c3aed}.btn.primary{background:#7c3aed;color:#fff}.btn.secondary{background:#eef0f5;color:#333}
hr{border:0;border-top:1px solid #eee;margin:8px 0}.img{font-size:28px;text-align:center}
</style>
<header>กลุ่มบัญชี (จำลอง) <small>LINE จำลองบนเครื่องนี้ · ระบบจริงทำงานทุกขั้น ยกเว้นการอ่านของ AI ที่ใช้ผลตั้งไว้</small></header>
<main>${rows}</main>`,
);
console.log("\nTranscript: " + resolve(join(dir, "transcript.html")));
