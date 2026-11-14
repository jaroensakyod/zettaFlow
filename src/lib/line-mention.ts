// LINE groups in "mention" mode: the bot reads only what a member @mentions it with. A mention becomes a draft
// that the bot summarises as a card with "บันทึกได้เลย / แก้ไข / ยกเลิก"; nothing reaches the website before
// "บันทึกได้เลย". Pure helpers here (tested in tests/line-mention.test.ts); the webhook and worker use them.
import { catalog } from "./catalog";
import { formatMoney, isForeign } from "./fx";
import { deptThai, pageUrl } from "./line-message";
import type { Approval } from "./types";

/** How long the bot keeps listening to one member after a mention / after "แก้ไข". */
export const LISTEN_MS = 2 * 60_000;
export const EDIT_MS = 10 * 60_000;

type Mentionee = { index?: number; length?: number; type?: string; userId?: string; isSelf?: boolean };
export type LineTextMessage = { type: string; text?: string; mention?: { mentionees?: Mentionee[] } };

/**
 * Whether the bot is mentioned, and the message without the mention ("@EliteFlow ค่าน้ำมัน 500" → "ค่าน้ำมัน 500").
 * LINE marks the bot's own mention with isSelf; "@<bot name>" typed by hand counts too.
 */
export function mentionOf(message: LineTextMessage, botName?: string | null): { mentioned: boolean; text: string } {
  let text = String(message.text || "");
  const self = (message.mention?.mentionees || []).filter((m) => m.isSelf && typeof m.index === "number" && typeof m.length === "number");
  let mentioned = self.length > 0;
  // Cut from the end so earlier indexes stay right.
  for (const m of [...self].sort((a, b) => b.index! - a.index!)) text = text.slice(0, m.index) + " " + text.slice(m.index! + m.length!);
  const name = (botName || "").trim();
  if (name) {
    const typed = "@" + name;
    if (text.includes(typed)) {
      mentioned = true;
      text = text.split(typed).join(" ");
    }
  }
  return { mentioned, text: text.replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "") };
}

/** "แก้ ยอด 450" / "แก้ไข: …" typed with a mention = correct my latest draft. */
export function editText(text: string): string | null {
  const m = text.trim().match(/^(?:แก้ไข|แก้)\s*[:：]?\s*([\s\S]+)$/);
  return m ? m[1].trim() : null;
}

export type ListenRow = { mode: "any" | "files" | "edit" | "reject" | "fix"; ingestion_id: string | null; until: string };
export type ListenPlan =
  | { act: "ignore" }
  | { act: "new" }
  | { act: "attach"; id: string }
  | { act: "edit"; id: string }
  | { act: "decide"; id: string; action: "reject" | "fix"; note?: never };
/**
 * A message that does not mention the bot, from a member the bot is listening to:
 * • "any" (after an empty mention): any message or file starts a draft;
 * • "files" (after a mention with text): a photo/file joins that draft, plain chat is ignored;
 * • "edit" (after the แก้ไข button): the message (or file) corrects the draft.
 * Without a live row the message is ignored and not stored.
 */
export function listenPlan(row: ListenRow | null | undefined, messageType: string, now = Date.now()): ListenPlan {
  if (!row || Date.parse(row.until) <= now) return { act: "ignore" };
  const file = ["image", "file", "audio"].includes(messageType),
    text = messageType === "text";
  if (!file && !text) return { act: "ignore" };
  // An approver who pressed ไม่อนุมัติ / ขอแก้ไข: their next typed message is the reason.
  if ((row.mode === "reject" || row.mode === "fix") && row.ingestion_id) return text ? { act: "decide", id: row.ingestion_id, action: row.mode } : { act: "ignore" };
  if (row.mode === "any") return { act: "new" };
  if (row.mode === "edit" && row.ingestion_id) return { act: "edit", id: row.ingestion_id };
  if (row.mode === "files" && file) return row.ingestion_id ? { act: "attach", id: row.ingestion_id } : { act: "new" };
  return { act: "ignore" };
}

/** Postback data on the card buttons: "draft=save&id=…". */
export function draftAction(data: string): { act: "save" | "edit" | "cancel"; id: string } | null {
  const p = new URLSearchParams(data || "");
  const act = p.get("draft"),
    id = p.get("id") || "";
  if (!act || !["save", "edit", "cancel"].includes(act)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { act: act as "save" | "edit" | "cancel", id };
}

const skip = new Set(["status", "aiNotes", "aiUncertain", "reviewStatus", "approvals", "history", "checklist", "cover", "photo", "color", "slipRef", "slip_ref", "attachmentId"]);
/** One readable value for the card ("฿1,250", "ใช่", "a, b"), empty when there is nothing to show. */
export function shownValue(key: string, value: unknown, currency?: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (typeof value === "number") {
    if (/amount|total|price|cost|budget|salary|wage|value|sales|vat|wht/i.test(key))
      return isForeign(currency) ? formatMoney(value, currency) : "฿" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (Array.isArray(value))
    return value
      .map((v) => (v && typeof v === "object" ? String((v as { name?: string; label?: string }).name || (v as { label?: string }).label || "") : String(v)))
      .filter(Boolean)
      .join(", ")
      .slice(0, 200);
  if (typeof value === "object") return "";
  return String(value).slice(0, 200);
}

export type DraftInput = {
  id: string;
  kind: string | null;
  form?: string | null;
  fields: { key: string; label: string }[];
  values: Record<string, unknown>;
  missing: string[];
  requester?: string | null;
  /** How many times it was read (1 = first summary, 2+ = after corrections). */
  round?: number;
  /** Shown on top, e.g. what an approver asked to change. */
  notice?: string | null;
};
/** Rows the card shows: labelled values in the page's field order, at most 12. */
export function draftRows(input: Pick<DraftInput, "fields" | "values">) {
  const rows: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const f of input.fields) {
    if (skip.has(f.key) || seen.has(f.key)) continue;
    seen.add(f.key);
    const v = shownValue(f.key, input.values[f.key], input.values.currency);
    if (v) rows.push({ label: f.label || f.key, value: v });
  }
  return rows.slice(0, 12);
}
/** Plain-text version of the summary (alt text, and the fallback when a card cannot be sent). */
export function draftText(input: DraftInput) {
  const page = (input.kind && catalog[input.kind]?.label) || input.form || "รายการ";
  const rows = draftRows(input);
  return [
    `📝 สรุปก่อนบันทึก · ${page}`,
    ...rows.map((r) => `• ${r.label}: ${r.value}`),
    ...(input.missing.length ? [`⚠️ ยังขาด: ${input.missing.join(", ")}`] : []),
    "กด “ส่งขออนุมัติ” หรือ “แก้ไข” แล้วพิมพ์สิ่งที่ต้องแก้",
  ]
    .join("\n")
    .slice(0, 1900);
}

const btn = (label: string, data: string, style: "primary" | "secondary" | "link", color?: string) => ({
  type: "button",
  style,
  height: "sm",
  ...(color ? { color } : {}),
  action: { type: "postback", label, data, displayText: label },
});
/** The summary card: page, what was read, what is missing, and the three buttons. */
export function draftCard(input: DraftInput) {
  const page = (input.kind && catalog[input.kind]?.label) || input.form || "รายการ";
  const rows = draftRows(input);
  const url = pageUrl(input.kind);
  const small = (text: string, color = "#8a86a3") => ({ type: "text", text, size: "xs", color, wrap: true });
  return {
    type: "flex",
    altText: draftText(input).slice(0, 380),
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#f3efff",
        paddingAll: "12px",
        contents: [
          small((input.round || 1) > 1 ? `📝 สรุปใหม่หลังแก้ไข (ครั้งที่ ${input.round})` : "📝 สรุปก่อนบันทึก", "#6d28d9"),
          { type: "text", text: page, weight: "bold", size: "md", color: "#2c2550", wrap: true },
          ...(input.requester ? [small("ผู้ส่ง: " + input.requester)] : []),
          ...(input.notice ? [{ type: "text", text: input.notice, size: "xs", color: "#b45309", wrap: true, margin: "sm" }] : []),
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          ...(rows.length
            ? rows.map((r) => ({
                type: "box",
                layout: "baseline",
                spacing: "sm",
                contents: [
                  { type: "text", text: r.label, size: "sm", color: "#8a86a3", flex: 4, wrap: true },
                  { type: "text", text: r.value, size: "sm", color: "#2c2550", flex: 6, wrap: true, weight: "bold" },
                ],
              }))
            : [small("ยังอ่านรายละเอียดไม่ได้ กด “แก้ไข” แล้วพิมพ์เพิ่มได้เลย")]),
          ...(input.missing.length
            ? [{ type: "text", text: "⚠️ ยังขาด: " + input.missing.join(", "), size: "xs", color: "#b45309", wrap: true, margin: "md" }]
            : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          btn(input.notice ? "📨 ส่งขออนุมัติอีกครั้ง" : "📨 ส่งขออนุมัติ", `draft=save&id=${input.id}`, "primary", "#16a34a"),
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [btn("✏️ แก้ไข", `draft=edit&id=${input.id}`, "secondary"), btn("ยกเลิก", `draft=cancel&id=${input.id}`, "link", "#be123c")],
          },
          small("ส่งขออนุมัติแล้วยังไม่ถือว่าอนุมัติ จนกว่าผู้อนุมัติคนสุดท้ายจะยืนยัน"),
        ],
      },
    },
  };
}

/** What the bot says to an empty mention, and how to use it. */
export const mentionPrompt =
  "สวัสดีค่ะ 👋 พิมพ์สิ่งที่ต้องการบันทึก หรือส่งรูป/ไฟล์ตามมาได้เลย (ภายใน 2 นาที)\nเช่น “ค่าน้ำมัน 500 บาท” แล้วน้องจะสรุปให้ตรวจก่อนบันทึกค่ะ";
export const editPrompt = "✏️ พิมพ์สิ่งที่ต้องแก้ได้เลยค่ะ (ภายใน 10 นาที) เช่น “ยอด 450 บาท” หรือส่งรูปใหม่ แล้วน้องจะสรุปให้ใหม่";
export const nothingToSave = "🤔 ยังไม่เจอข้อมูลที่จะบันทึกค่ะ ลองพิมพ์รายละเอียดอีกนิด เช่น “ซื้อกระดาษ A4 450 บาท” หรือส่งรูปใบเสร็จ";

/* ---------- approval chain (migration 0067) ---------- */

/** "ผู้จัดการการตลาด" for a step's department. */
export const approverLabel = (dept: string) => "ผู้จัดการ" + (deptThai[dept] || dept || "");
/** "ผู้จัดการการตลาด → ผู้จัดการฝ่ายบัญชีและการเงิน" */
export const chainText = (a: Pick<Approval, "steps">) => a.steps.map((s) => approverLabel(s.dept)).join(" → ");
/** Thai date and time in Bangkok: "14 พ.ย. 2569 10:15 น." */
export function thaiTime(iso: string | Date) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${day} ${time} น.`;
}

/** Postback data on approver cards: "ap=approve&id=…&s=0" (s = the step the card was for). */
export function approvalAction(data: string): { act: "approve" | "reject" | "fix"; id: string; step: number | null } | null {
  const p = new URLSearchParams(data || "");
  const act = p.get("ap"),
    id = p.get("id") || "",
    s = p.get("s");
  if (!act || !["approve", "reject", "fix"].includes(act)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const step = s !== null && /^\d{1,2}$/.test(s) ? Number(s) : null;
  return { act: act as "approve" | "reject" | "fix", id, step };
}
export const reasonPrompt = { reject: "❌ พิมพ์เหตุผลที่ไม่อนุมัติได้เลยค่ะ (ภายใน 10 นาที)", fix: "✏️ พิมพ์สิ่งที่ต้องการให้แก้ได้เลยค่ะ (ภายใน 10 นาที) น้องจะส่งกลับไปให้ผู้ขอแก้" };

export type ApprovalItem = {
  id: string;
  kind: string | null;
  form?: string | null;
  fields: { key: string; label: string }[];
  values: Record<string, unknown>;
  requester?: string | null;
  approval: Approval;
};
const done = (a: Approval) => a.history.filter((h) => h.action === "approve" && h.round === (a.round || 1));
/** Card to the approver of the current step: what is asked, steps already approved, and อนุมัติ / ขอแก้ไข / ไม่อนุมัติ. */
export function approvalCard(item: ApprovalItem) {
  const a = item.approval,
    n = a.steps.length,
    at = Math.min(a.at, n - 1);
  const page = (item.kind && catalog[item.kind]?.label) || item.form || "รายการ";
  const rows = draftRows(item);
  const small = (text: string, color = "#8a86a3") => ({ type: "text", text, size: "xs", color, wrap: true });
  const prev = done(a).map((h) => small(`✅ ขั้นที่ ${h.step}/${h.of} ${approverLabel(h.dept)} · ${h.name} · ${thaiTime(h.at)}`, "#15803d"));
  const data = (act: string) => `ap=${act}&id=${item.id}&s=${at}`;
  const text = [
    `🔔 ขออนุมัติ (ขั้นที่ ${at + 1}/${n}) · ${page}`,
    ...(item.requester ? ["ผู้ขอ: " + item.requester] : []),
    ...rows.map((r) => `• ${r.label}: ${r.value}`),
    "สำหรับ" + approverLabel(a.steps[at].dept),
  ].join("\n");
  return {
    type: "flex",
    altText: text.slice(0, 380),
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#fff7ed",
        paddingAll: "12px",
        contents: [
          small(`🔔 ขออนุมัติ · ขั้นที่ ${at + 1}/${n}`, "#c2410c"),
          { type: "text", text: page, weight: "bold", size: "md", color: "#2c2550", wrap: true },
          small("สำหรับ" + approverLabel(a.steps[at].dept) + (item.requester ? " · ผู้ขอ: " + item.requester : "")),
          small("เลขอ้างอิง " + a.ref),
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          ...rows.map((r) => ({
            type: "box",
            layout: "baseline",
            spacing: "sm",
            contents: [
              { type: "text", text: r.label, size: "sm", color: "#8a86a3", flex: 4, wrap: true },
              { type: "text", text: r.value, size: "sm", color: "#2c2550", flex: 6, wrap: true, weight: "bold" },
            ],
          })),
          ...(prev.length ? [{ type: "separator", margin: "md" }, ...prev] : []),
          small("ขั้นตอน: " + chainText(a)),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          btn("✅ อนุมัติ", data("approve"), "primary", "#16a34a"),
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [btn("✏️ ขอแก้ไข", data("fix"), "secondary"), btn("❌ ไม่อนุมัติ", data("reject"), "link", "#be123c")],
          },
          small("กดได้เฉพาะผู้มีสิทธิ์ที่เชื่อมบัญชี LINE แล้ว และอนุมัติคำขอของตัวเองไม่ได้"),
        ],
      },
    },
  };
}

/** What the requester's group is told after "ส่งขออนุมัติ". */
export function sentText(a: Pick<Approval, "steps" | "ref">) {
  return `📨 ส่งขออนุมัติแล้ว · เลขอ้างอิง ${a.ref}\nขั้นตอน: ${chainText(a)}\n⏳ ยังไม่ถือว่าอนุมัติ จนกว่าผู้อนุมัติคนสุดท้ายจะยืนยัน`;
}
export type ActResult = { status: string; action: "approve" | "reject" | "fix"; step: number; of: number; dept: string; name: string; note: string | null; approval: Approval };
/** One line for a step that was decided (to the approver, and to the requester while the chain goes on). */
export function stepText(r: ActResult, what: string, at = new Date()) {
  const who = `${r.name} (${approverLabel(r.dept)}) · ${thaiTime(at)}`;
  if (r.action === "reject") return `❌ ไม่อนุมัติ (ขั้นที่ ${r.step}/${r.of}): ${what}\nโดย ${who}\nเหตุผล: ${r.note || "-"}\nเลขอ้างอิง ${r.approval.ref}`;
  if (r.action === "fix") return `✏️ ขอแก้ไข (ขั้นที่ ${r.step}/${r.of}): ${what}\nโดย ${who}\nสิ่งที่ต้องแก้: ${r.note || "-"}`;
  if (r.status === "approved") return `✅ อนุมัติเรียบร้อย (ขั้นที่ ${r.step}/${r.of}): ${what}\nโดย ${who}\nเลขอ้างอิง ${r.approval.ref}`;
  const next = r.approval.steps[r.approval.at];
  return `✅ อนุมัติแล้ว (ขั้นที่ ${r.step}/${r.of}): ${what}\nโดย ${who}\n➡️ ส่งต่อให้${approverLabel(next?.dept || "")} (ยังไม่ถือว่าอนุมัติสมบูรณ์)`;
}
/** Final card in the requester's group: everyone who approved, when, the reference, and a link to the record. */
export function approvedCard(item: ApprovalItem) {
  const a = item.approval;
  const page = (item.kind && catalog[item.kind]?.label) || item.form || "รายการ";
  const url = pageUrl(item.kind);
  const steps = done(a);
  const small = (text: string, color = "#5d5a78") => ({ type: "text", text, size: "xs", color, wrap: true });
  const what = String(item.values.name || item.values.title || page);
  const alt = [`✅ อนุมัติเรียบร้อย: ${what}`, ...steps.map((h) => `ขั้นที่ ${h.step}/${h.of} โดย ${h.name} · ${thaiTime(h.at)}`), `เลขอ้างอิง ${a.ref}`].join("\n");
  return {
    type: "flex",
    altText: alt.slice(0, 380),
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#dcfce7",
        paddingAll: "12px",
        contents: [
          { type: "text", text: `✅ อนุมัติเรียบร้อย (${a.steps.length}/${a.steps.length})`, weight: "bold", size: "md", color: "#15803d", wrap: true },
          small(page + " · " + what),
          ...(item.requester ? [small("ผู้ขอ: " + item.requester)] : []),
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          ...steps.map((h) => small(`✅ ขั้นที่ ${h.step}/${h.of} · ${h.name} (${approverLabel(h.dept)})\n    ${thaiTime(h.at)}${h.note ? " · " + h.note : ""}`, "#2c2550")),
          { type: "separator", margin: "md" },
          { type: "text", text: "เลขอ้างอิง " + a.ref, size: "sm", weight: "bold", color: "#2c2550", margin: "md" },
          small("บันทึกเข้า EliteFlow แล้ว"),
        ],
      },
      ...(url
        ? { footer: { type: "box", layout: "vertical", paddingAll: "12px", contents: [{ type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "เปิดดูใน EliteFlow", uri: url } }] } }
        : {}),
    },
  };
}
