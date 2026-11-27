// LINE groups in "mention" mode: the bot reads only what a member @mentions it with. A mention becomes a draft
// that the bot summarises as a card with "บันทึกได้เลย / แก้ไข / ยกเลิก"; nothing reaches the website before
// "บันทึกได้เลย". Pure helpers here (tested in tests/line-mention.test.ts); the webhook and worker use them.
import { catalog } from "./catalog";
import { formatMoney, isForeign } from "./fx";
import { deptThai, pageUrl } from "./line-message";
import type { Approval } from "./types";

/** What the document is called on the cards (an expense asked for in LINE is a request for approval). */
export function docLabel(kind: string | null | undefined, form?: string | null) {
  if (kind === "expenses") return "ใบขออนุมัติค่าใช้จ่าย";
  return (kind && catalog[kind]?.label) || form || "รายการ";
}
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

export type ListenRow = { mode: "any" | "files" | "edit" | "reject" | "fix" | "slip" | "evidence" | "billing"; ingestion_id: string | null; until: string; meta?: unknown };

/**
 * Photos and files sent before the mention ("send the slip, then say what it is"): kept for HOLD_MS on a row
 * { mode "files", ingestion_id null, meta { held: [attachment ids] } } and joined to the request the next mention
 * makes. Nothing is read or summarised until then; files never claimed are deleted (cron/route.ts).
 */
export const HOLD_MS = 30 * 60_000;
export const HOLD_MAX = 5;
/** The held files on a live row (any mode: an empty mention keeps them on its "any" row). */
export function heldFiles(row: Pick<ListenRow, "until" | "meta"> | null | undefined, now = Date.now()): string[] {
  if (!row || Date.parse(row.until) <= now) return [];
  const held = (row.meta as { held?: unknown } | null | undefined)?.held;
  return Array.isArray(held) ? held.filter((x): x is string => typeof x === "string") : [];
}
const isHeldRow = (row: ListenRow) => row.mode === "files" && !row.ingestion_id && Array.isArray((row.meta as { held?: unknown } | null | undefined)?.held);
/** A photo or file with no mention: keep it for the next mention when nothing else is waiting for this member. */
export function canHold(row: ListenRow | null | undefined, messageType: string, now = Date.now()) {
  if (!["image", "file"].includes(messageType)) return false;
  return !row || Date.parse(row.until) <= now || isHeldRow(row);
}
export type ListenPlan =
  | { act: "ignore" }
  | { act: "new" }
  | { act: "attach"; id: string }
  | { act: "edit"; id: string }
  | { act: "decide"; id: string; action: "reject" | "fix"; note?: never }
  | { act: "slip"; id: string }
  | { act: "evidence"; id: string }
  | { act: "billing" };
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
  // After "ยืนยันจ่ายแล้ว · ส่งสลิป": the photo / file is the slip.
  if (row.mode === "slip" && row.ingestion_id) return file ? { act: "slip", id: row.ingestion_id } : { act: "ignore" };
  // After "📎 เพิ่มรูป/หลักฐาน": each photo / file is more evidence for that item.
  if (row.mode === "evidence" && row.ingestion_id) return file ? { act: "evidence", id: row.ingestion_id } : { act: "ignore" };
  // After picking a package on the bot's card: the photo is the payment slip.
  if (row.mode === "billing") return file ? { act: "billing" } : { act: "ignore" };
  if (row.mode === "any") return { act: "new" };
  // Files waiting for a mention: more files are held too (canHold), not a new draft.
  if (isHeldRow(row)) return { act: "ignore" };
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
  if (key === "lineUserId") return "✓ ผูกกับ LINE ของคนที่แท็กแล้ว";
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
  /** Document number reserved for it (PO-69-0001 …). */
  docCode?: string | null;
  /** Evidence files attached so far (photos, PDFs). */
  files?: number;
};
/** Rows the card shows: labelled values in the page's field order, at most 12. */
export function draftRows(input: Pick<DraftInput, "fields" | "values">) {
  const rows: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  const items = itemLines(input.values.lines);
  for (const f of input.fields) {
    if (skip.has(f.key) || seen.has(f.key)) continue;
    seen.add(f.key);
    if ((f as { type?: string }).type === "lines" || f.key === "lines") {
      items.forEach((x, i) => rows.push({ label: `${i + 1}. ${x.name}`, value: [x.qty.toLocaleString("en-US") + (x.unit ? " " + x.unit : ""), x.price ? "@ ฿" + x.price.toLocaleString("en-US") : ""].filter(Boolean).join(" ") }));
      continue;
    }
    // With item lines, the single product / quantity / unit cost fields say nothing more.
    if (items.length && ["productId", "quantity", "unitCost"].includes(f.key)) continue;
    const v = shownValue(f.key, input.values[f.key], input.values.currency);
    if (v) rows.push({ label: f.label || f.key, value: v });
  }
  return rows.slice(0, 14);
}
/** Item lines of a request ("กระดาษ A4 10 รีม", "หมึก 2 กล่อง"), each with its own quantity. */
export function itemLines(v: unknown): { name: string; qty: number; unit?: string; price: number }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({ name: String(x?.name || "").trim(), qty: Number(x?.qty) || 0, unit: x?.unit ? String(x.unit) : undefined, price: Number(x?.price) || 0 }))
    .filter((x) => x.name);
}
/** Plain-text version of the summary (alt text, and the fallback when a card cannot be sent). */
export function draftText(input: DraftInput) {
  const page = docLabel(input.kind, input.form);
  const rows = draftRows(input);
  return [
    `📝 สรุปก่อนบันทึก · ${page}${input.docCode ? " " + input.docCode : ""}`,
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
  const page = docLabel(input.kind, input.form);
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
          { type: "text", text: page + (input.docCode ? " · " + input.docCode : ""), weight: "bold", size: "md", color: "#2c2550", wrap: true },
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
          ...(input.files ? [{ type: "text", text: `📎 แนบหลักฐานแล้ว ${input.files} ไฟล์`, size: "xs", color: "#4f46e5", wrap: true, margin: "md" }] : []),
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
          btn("📎 เพิ่มรูป/หลักฐาน", `add=${input.id}`, "link", "#4f46e5"),
          small("ส่งขออนุมัติแล้วยังไม่ถือว่าอนุมัติ จนกว่าผู้อนุมัติคนสุดท้ายจะยืนยัน"),
        ],
      },
    },
  };
}

export const SLIP_MS = 30 * 60_000;
export const EVIDENCE_MS = 10 * 60_000;
export const evidencePrompt = (left: number) => `📎 ส่งรูปหรือ PDF หลักฐานได้เลยค่ะ (ภายใน 10 นาที) เพิ่มได้อีก ${left} ไฟล์ เช่น สลิป ใบเสร็จ รูปสินค้า`;
export const slipPrompt = "🧾 ส่งรูปสลิปโอนเงิน หรือใบเสร็จได้เลยค่ะ (ภายใน 30 นาที) ได้รับแล้วน้องจะลงเป็นค่าใช้จ่ายให้";
/** "ส่งสลิป EXP-69-0001" (with a mention) → that request's slip comes next. */
export function slipRequest(text: string): { code: string | null } | null {
  const t = text.trim();
  if (!/^(ส่ง|แนบ)\s*(สลิป|ใบเสร็จ)|^(ยืนยัน)?จ่ายแล้ว/.test(t)) return null;
  const m = t.match(/\b([A-Z]{2,3}-\d{2}-\d{3,})\b/i);
  return { code: m ? m[1].toUpperCase() : null };
}
/** What the bot says to an empty mention, and how to use it. */
export const mentionPrompt =
  "สวัสดีค่ะ 👋 พิมพ์สิ่งที่ต้องการบันทึก หรือส่งรูป/ไฟล์ตามมาได้เลย (ภายใน 2 นาที)\nเช่น “ค่าน้ำมัน 500 บาท” แล้วน้องจะสรุปให้ตรวจก่อนบันทึกค่ะ";
export const editPrompt = "✏️ พิมพ์สิ่งที่ต้องแก้ได้เลยค่ะ (ภายใน 10 นาที) เช่น “ยอด 450 บาท” หรือส่งรูปใหม่ แล้วน้องจะสรุปให้ใหม่";
/**
 * A free company asked to record something outside บัญชีและการเงิน: nothing is saved; the group is told to upgrade, with
 * the link to the package page.
 */
export function upgradeText(kind: string | null | undefined, url: string) {
  const what = (kind && catalog[kind]?.label) || "รายการนี้";
  return (
    `🔒 “${what}” ต้องใช้แพ็กเกจแบบชำระเงินค่ะ ยังไม่ได้บันทึกนะคะ\n` +
    "แพ็กเกจฟรีใช้ได้เฉพาะระบบบัญชีและการเงิน (ค่าใช้จ่าย รับชำระ ใบแจ้งหนี้ ฯลฯ)\n\n" +
    "⭐ อัปเกรดแพ็กเกจเพื่อใช้ทุกระบบ — ชำระแล้วปลดล็อกทันที แล้วส่งข้อความนี้ใหม่ได้เลยค่ะ" +
    (url ? "\n👉 " + url : "")
  );
}
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
  /** The record made on approval (for the link to it). */
  recordId?: string | null;
  /** Who may press อนุมัติ on this step (managers of the step's department). */
  approvers?: string[];
  /** Signed link to the ใบรับรองแทนใบเสร็จรับเงิน of the recorded expense. */
  substituteUrl?: string | null;
};
const done = (a: Approval) => a.history.filter((h) => h.action === "approve" && h.round === (a.round || 1));
/** Card to the approver of the current step: what is asked, steps already approved, and อนุมัติ / ขอแก้ไข / ไม่อนุมัติ. */
export function approvalCard(item: ApprovalItem) {
  const a = item.approval,
    n = a.steps.length,
    at = Math.min(a.at, n - 1);
  const page = docLabel(item.kind, item.form);
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
          small(
            (item.approvers?.length ? "🔒 กดได้เฉพาะ " + item.approvers.join(", ") + " (หรือเจ้าของบริษัท)" : "🔒 กดได้เฉพาะ" + approverLabel(a.steps[at].dept) + " หรือเจ้าของบริษัท") +
              " · คนอื่นกดแล้วระบบไม่รับ",
          ),
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
  if (r.status === "awaiting_slip") return `✅ อนุมัติแล้ว (ขั้นที่ ${r.step}/${r.of}): ${what}\nโดย ${who}\nเลขอ้างอิง ${r.approval.ref}\n🧾 รอผู้ขอส่งสลิป แล้วจึงลงเป็นค่าใช้จ่าย`;
  if (r.status === "approved") return `✅ อนุมัติเรียบร้อย (ขั้นที่ ${r.step}/${r.of}): ${what}\nโดย ${who}\nเลขอ้างอิง ${r.approval.ref}`;
  const next = r.approval.steps[r.approval.at];
  return `✅ อนุมัติแล้ว (ขั้นที่ ${r.step}/${r.of}): ${what}\nโดย ${who}\n➡️ ส่งต่อให้${approverLabel(next?.dept || "")} (ยังไม่ถือว่าอนุมัติสมบูรณ์)`;
}
/** Final card in the requester's group: everyone who approved, when, the reference, and a link to the record. */
/**
 * stage "approved": the record is made. "awaiting_slip": an expense request approved but not an expense yet — the
 * button asks for the slip. "paid": the slip arrived and the expense is recorded.
 */
export function approvedCard(item: ApprovalItem, stage: "approved" | "awaiting_slip" | "paid" = "approved") {
  const a = item.approval;
  const page = docLabel(item.kind, item.form);
  const url = recordUrl(item.kind, item.recordId);
  const steps = done(a);
  const small = (text: string, color = "#5d5a78") => ({ type: "text", text, size: "xs", color, wrap: true });
  const what = String(item.values.name || item.values.title || page);
  const head =
    stage === "awaiting_slip" ? `✅ อนุมัติแล้ว (${a.steps.length}/${a.steps.length}) · รอสลิป` : stage === "paid" ? "🧾 บันทึกค่าใช้จ่ายสมบูรณ์" : `✅ อนุมัติเรียบร้อย (${a.steps.length}/${a.steps.length})`;
  const after =
    stage === "awaiting_slip"
      ? "ยังไม่ลงเป็นค่าใช้จ่าย จ่ายเงินแล้วกด “ยืนยันจ่ายแล้ว · ส่งสลิป” แล้วส่งรูปสลิปหรือใบเสร็จ"
      : stage === "paid"
        ? `แนบสลิปแล้ว บันทึก${page === "ใบขออนุมัติค่าใช้จ่าย" ? "ค่าใช้จ่าย" : page} ${a.ref} เข้า EliteFlow แล้ว`
        : `บันทึก${page} ${a.ref} เข้า EliteFlow แล้ว ขอเอกสารได้ด้วย “@EliteFlow ขอเอกสาร ${a.ref}”`;
  const alt = [`${head}: ${what}`, ...steps.map((h) => `ขั้นที่ ${h.step}/${h.of} โดย ${h.name} · ${thaiTime(h.at)}`), `เลขอ้างอิง ${a.ref}`, after].join("\n");
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
          { type: "text", text: head, weight: "bold", size: "md", color: "#15803d", wrap: true },
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
          small(after, stage === "awaiting_slip" ? "#b45309" : "#5d5a78"),
        ],
      },
      ...(stage === "awaiting_slip"
        ? {
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              spacing: "sm",
              contents: [btn("🧾 ยืนยันจ่ายแล้ว · ส่งสลิป", `slip=${item.id}`, "primary", "#16a34a"), btn("📎 แนบหลักฐานเพิ่ม", `add=${item.id}`, "link", "#4f46e5")],
            },
          }
        : {
            footer: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              paddingAll: "12px",
              contents: [
                ...(item.substituteUrl ? [{ type: "button", style: "primary", color: "#4f46e5", height: "sm", action: { type: "uri", label: "📄 ใบแทนใบเสร็จ", uri: item.substituteUrl } }] : []),
                ...(url ? [{ type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "เปิดดูใน EliteFlow", uri: url } }] : []),
                btn("📎 แนบหลักฐานเพิ่ม", `add=${item.id}`, "link", "#4f46e5"),
              ],
            },
          }),
    },
  };
}

/** Link to one record on the website (its page with ?id=), or the page when the record is not known. */
export function recordUrl(kind: string | null | undefined, id?: string | null) {
  const base = pageUrl(kind);
  return base && id ? base + "?id=" + encodeURIComponent(id) : base;
}

/* ---------- "@EliteFlow ขอเอกสาร …" ---------- */

/** "ขอเอกสาร PO-69-0001" → { code }, "ขอเอกสาร" → { code: null } (choose from the latest); null = not a request. */
export function docRequest(text: string): { code: string | null } | null {
  const t = text.trim();
  if (!/^(ขอ|ส่ง|เปิด|ดู)\s*(เอกสาร|ใบ(?!ลา)|ไฟล์)/.test(t) && !/^ขอ\s*[A-Z]{2,3}-\d{2}-\d{3,}/i.test(t)) return null;
  const m = t.match(/\b([A-Z]{2,3}-\d{2}-\d{3,})\b/i);
  return { code: m ? m[1].toUpperCase() : null };
}
export type DocRecord = { id: string; kind: string; code: string; name: string; total: number | null; status: string | null; at: string; lines: { name: string; qty: number; unit?: string; price: number }[]; substituteUrl?: string | null };
/** Pick-a-document card: the latest documents of this group as buttons. */
export function docChoices(docs: DocRecord[]) {
  return {
    type: "flex",
    altText: "เลือกเอกสาร: " + docs.map((d) => d.code).join(", "),
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          { type: "text", text: "📄 ขอเอกสารไหนคะ", weight: "bold", size: "md", color: "#2c2550" },
          { type: "text", text: "เอกสารล่าสุดในกลุ่มนี้", size: "xs", color: "#8a86a3" },
          ...docs.slice(0, 6).map((d) => ({
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "postback", label: (d.code + " " + d.name).slice(0, 40), data: "doc=" + d.id, displayText: "ขอเอกสาร " + d.code },
          })),
        ],
      },
    },
  };
}
/** One document: what it is, its items and total, and a button to open it on the website. */
export function docCard(d: DocRecord) {
  const page = docLabel(d.kind) || "เอกสาร";
  const url = recordUrl(d.kind, d.id);
  const row = (l: string, v: string) => ({
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: l, size: "sm", color: "#8a86a3", flex: 5, wrap: true },
      { type: "text", text: v, size: "sm", color: "#2c2550", flex: 5, wrap: true, weight: "bold", align: "end" },
    ],
  });
  return {
    type: "flex",
    altText: `📄 ${page} ${d.code}${d.total ? " ฿" + d.total.toLocaleString("en-US") : ""}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#eef2ff",
        paddingAll: "12px",
        contents: [
          { type: "text", text: "📄 " + page, size: "xs", color: "#4f46e5" },
          { type: "text", text: d.code, weight: "bold", size: "lg", color: "#2c2550" },
          { type: "text", text: d.name, size: "xs", color: "#5d5a78", wrap: true },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          ...d.lines.slice(0, 10).map((x, i) => row(`${i + 1}. ${x.name}`, x.qty.toLocaleString("en-US") + (x.unit ? " " + x.unit : ""))),
          ...(d.total ? [row("ยอดรวม", "฿" + d.total.toLocaleString("en-US", { maximumFractionDigits: 2 }))] : []),
          row("วันที่บันทึก", thaiTime(d.at)),
        ],
      },
      ...(url
        ? {
            footer: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              paddingAll: "12px",
              contents: [
                { type: "button", style: "primary", color: "#4f46e5", height: "sm", action: { type: "uri", label: "เปิดเอกสารในเว็บ", uri: url } },
                ...(d.substituteUrl ? [{ type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "📄 ใบแทนใบเสร็จ", uri: d.substituteUrl } }] : []),
              ],
            },
          }
        : {}),
    },
  };
}

/* ---------- approvers named in the group by tagging ---------- */

/** People tagged in a message (not the bot): LINE user id and the name as tagged ("@คุณเอ" → "คุณเอ"). */
export function taggedPeople(message: LineTextMessage): { id: string; name: string }[] {
  const text = String(message.text || "");
  const seen = new Set<string>();
  return (message.mention?.mentionees || [])
    .filter((m) => !m.isSelf && m.type !== "all" && typeof m.userId === "string" && /^U[0-9a-f]{32}$/.test(m.userId))
    .filter((m) => (seen.has(m.userId!) ? false : (seen.add(m.userId!), true)))
    .map((m) => ({ id: m.userId!, name: typeof m.index === "number" && typeof m.length === "number" ? text.slice(m.index, m.index + m.length).replace(/^@/, "").trim() : "" }));
}
/** The group's approvers, as the bot says them. */
export function approversText(list: { name: string }[]) {
  if (!list.length) return "กลุ่มนี้ยังไม่มีผู้อนุมัติที่ตั้งไว้ค่ะ ตั้งได้เลยด้วย “@EliteFlow ให้ @ชื่อ อนุมัติได้” ไม่ต้องใช้รหัส";
  return `✅ ผู้อนุมัติของกลุ่มนี้ (${list.length} คน): ${list.map((x) => x.name || "ไม่ทราบชื่อ").join(", ")}\nกดปุ่มอนุมัติในการ์ดขออนุมัติได้ทันที (อนุมัติคำขอของตัวเองไม่ได้)`;
}

/** People tagged whom LINE does not identify (they have not added the bot / allowed their profile): names only. */
export function untaggedNames(message: LineTextMessage): string[] {
  const text = String(message.text || "");
  return (message.mention?.mentionees || [])
    .filter((m) => !m.isSelf && m.type !== "all" && !(typeof m.userId === "string" && /^U[0-9a-f]{32}$/.test(m.userId)))
    .map((m) => (typeof m.index === "number" && typeof m.length === "number" ? text.slice(m.index, m.index + m.length).replace(/^@/, "").trim() : ""))
    .filter(Boolean);
}
/**
 * Plain words about who may approve, with the people tagged:
 *  "ให้พี่ศิริอนุมัติได้ @พี่ศิริ" / "กำหนดผู้อนุมัติ @A @B" / "เพิ่มสิทธิ์อนุมัติ @A" → add;
 *  "เอา @A ออกจากผู้อนุมัติ" / "ไม่ให้ @A อนุมัติแล้ว" → remove;  "ขอเป็นผู้อนุมัติ" → add the person typing;
 *  "กำหนดผู้อนุมัติ" / "ใครอนุมัติได้บ้าง" (nobody tagged) → show. null = not about approvers.
 */
export function approverIntent(text: string, tagged: number): "add" | "remove" | "self" | "show" | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!/อนุมัติ|สิทธิ/.test(t)) return null;
  // A request (ขออนุมัติซื้อ… / ขอเบิก…) is never about who approves.
  if (/ขอ\s*อนุมัติ|ขอ\s*เบิก|ขอ\s*ซื้อ|ขอ\s*ลา|ขออนุญาต/.test(t) && !/ขอ\s*(เป็น|มี)\s*(ผู้อนุมัติ|สิทธิ)/.test(t)) return null;
  // "ขอเป็นผู้อนุมัติ" / "ขอสิทธิ์อนุมัติ" / "แอดตัวเองให้กดอนุมัติได้" / "ตั้งฉันเป็นผู้อนุมัติ" (nobody tagged) = the person typing.
  if (
    !tagged &&
    (/ขอ\s*(เป็น|มี)?\s*(ผู้อนุมัติ|คนอนุมัติ|สิทธิ์?\s*(การ)?\s*อนุมัติ)/.test(t) ||
      (/ฉัน|ผม|หนู|ตัวเอง|ดิฉัน|เรา/.test(t) && /(ผู้|คน|กด|สิทธิ์?\s*(การ)?\s*)อนุมัติ|อนุมัติได้/.test(t)))
  )
    return "self";
  const about = /ผู้อนุมัติ|อนุมัติได้|สิทธิ์?\s*(การ)?\s*อนุมัติ|เป็นคนอนุมัติ|ให้.{0,40}อนุมัติ/.test(t);
  if (tagged && about) return /ลบ|เอา.*ออก|ถอด|ยกเลิกสิทธิ|ไม่ให้|ห้าม|เลิกให้|ไม่ต้องให้/.test(t) ? "remove" : "add";
  if (
    !tagged &&
    t.length <= 60 &&
    /^(กำหนด|ตั้ง|ดู|ใคร|รายชื่อ|จัดการ|แก้|เปลี่ยน)?\s*(คน|ผู้)?\s*(สิทธิ์?\s*(การ)?)?\s*อนุมัติ(ได้)?\s*(บ้าง|มีใคร(บ้าง)?|ใครบ้าง|ของ(แชท|กลุ่ม)นี้)?\s*[?？]?$|^(กำหนด|ตั้ง|ดู|จัดการ)\s*(ผู้|คน|สิทธิ์?)\s*อนุมัติ|^ใคร(เป็นคน|เป็นผู้)?\s*อนุมัติ(ได้)?/.test(t)
  )
    return "show";
  return null;
}
export type ApproverDraft = { current: { id: string; name: string }[]; add: { id: string; name: string }[]; remove: string[]; unknown?: string[] };
const enc = (ids: string[]) => ids.map((i) => i.slice(1)).join(".");
const dec = (s: string | null) => (s ? s.split(".").filter((x) => /^[0-9a-f]{32}$/.test(x)).map((x) => "U" + x) : []);
/** "apv=save|edit|cancel&a=<ids>&r=<ids>" (ids without the leading U, joined by dots) */
export function approverAction(data: string): { act: "save" | "edit" | "cancel"; add: string[]; remove: string[] } | null {
  const p = new URLSearchParams(data || "");
  const act = p.get("apv");
  if (!act || !["save", "edit", "cancel"].includes(act)) return null;
  return { act: act as "save" | "edit" | "cancel", add: dec(p.get("a")).slice(0, 8), remove: dec(p.get("r")).slice(0, 8) };
}
const apvData = (act: string, add: string[], remove: string[]) => `apv=${act}&a=${enc(add)}&r=${enc(remove)}`;
/**
 * The card after "@EliteFlow ให้พี่ศิริอนุมัติได้ @พี่ศิริ": who approves in this chat now, who will be added / removed,
 * a button per person to change it, and บันทึก (nothing changes before it is pressed).
 */
export function approverSetupCard(d: ApproverDraft) {
  const add = d.add.filter((x) => !d.current.some((c) => c.id === x.id)).slice(0, 8);
  const remove = d.remove.filter((id) => d.current.some((c) => c.id === id)).slice(0, 8);
  const addIds = add.map((x) => x.id);
  const changed = add.length + remove.length > 0;
  const small = (text: string, color = "#8a86a3") => ({ type: "text", text, size: "xs", color, wrap: true });
  const row = (label: string, color: string, btnLabel: string, data: string, decor?: string) => ({
    type: "box",
    layout: "horizontal",
    alignItems: "center",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color, flex: 7, wrap: true, ...(decor ? { decoration: decor } : {}) },
      { type: "button", style: "link", height: "sm", flex: 3, action: { type: "postback", label: btnLabel, data } },
    ],
  });
  const rows = [
    ...d.current.map((c) =>
      remove.includes(c.id)
        ? row(`➖ ${c.name || "ไม่ทราบชื่อ"} (จะเอาออก)`, "#be123c", "คืน", apvData("edit", addIds, remove.filter((r) => r !== c.id)), "line-through")
        : row(`✅ ${c.name || "ไม่ทราบชื่อ"}`, "#2c2550", "เอาออก", apvData("edit", addIds, [...remove, c.id])),
    ),
    ...add.map((x) => row(`➕ ${x.name || "ไม่ทราบชื่อ"} (เพิ่มใหม่)`, "#15803d", "ไม่เพิ่ม", apvData("edit", addIds.filter((i) => i !== x.id), remove))),
  ];
  const alt = `🔐 ผู้อนุมัติของแชทนี้: ${[...d.current.filter((c) => !remove.includes(c.id)), ...add].map((x) => x.name).join(", ") || "ยังไม่มี"}${changed ? " · กดบันทึกเพื่อยืนยัน" : ""}`;
  return {
    type: "flex",
    altText: alt.slice(0, 380),
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#f5f3ff",
        paddingAll: "12px",
        contents: [
          { type: "text", text: "🔐 ผู้อนุมัติของแชทนี้", weight: "bold", size: "md", color: "#3b0764" },
          small(changed ? "ตรวจรายชื่อ แล้วกด “บันทึก” เพื่อให้มีผลทันที" : "เพิ่มได้ด้วย “@EliteFlow ให้ @ชื่อ อนุมัติได้” · เอาออกได้ด้วยปุ่มด้านขวา"),
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        paddingAll: "12px",
        contents: [
          ...(rows.length ? rows : [small("ยังไม่มีผู้อนุมัติ แท็กคนที่จะให้อนุมัติได้เลย เช่น “@EliteFlow ให้ @พี่ศิริ อนุมัติได้”", "#5d5a78")]),
          ...((d.unknown || []).length
            ? [small(`⚠️ ยังระบุตัว ${d.unknown!.map((n) => "@" + n).join(", ")} ไม่ได้: ให้เพิ่มบอทเป็นเพื่อน (@532csucn) ก่อน แล้วแท็กใหม่`, "#b45309")]
            : []),
          small("ผู้อนุมัติกดปุ่มอนุมัติในการ์ดขออนุมัติของแชทนี้ได้ (อนุมัติคำขอของตัวเองไม่ได้)"),
        ],
      },
      ...(changed
        ? {
            footer: {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              paddingAll: "12px",
              contents: [btn("💾 บันทึก", apvData("save", addIds, remove), "primary", "#7c3aed"), btn("ยกเลิก", "apv=cancel&a=&r=", "secondary")],
            },
          }
        : {}),
    },
  };
}
