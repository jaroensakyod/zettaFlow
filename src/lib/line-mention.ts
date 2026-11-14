// LINE groups in "mention" mode: the bot reads only what a member @mentions it with. A mention becomes a draft
// that the bot summarises as a card with "บันทึกได้เลย / แก้ไข / ยกเลิก"; nothing reaches the website before
// "บันทึกได้เลย". Pure helpers here (tested in tests/line-mention.test.ts); the webhook and worker use them.
import { catalog } from "./catalog";
import { formatMoney, isForeign } from "./fx";
import { pageUrl } from "./line-message";

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

export type ListenRow = { mode: "any" | "files" | "edit"; ingestion_id: string | null; until: string };
export type ListenPlan =
  | { act: "ignore" }
  | { act: "new" }
  | { act: "attach"; id: string }
  | { act: "edit"; id: string };
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
    "กด “บันทึกได้เลย” เพื่อส่งเข้าเว็บ หรือ “แก้ไข” แล้วพิมพ์สิ่งที่ต้องแก้",
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
          btn("✅ บันทึกได้เลย", `draft=save&id=${input.id}`, "primary", "#7c3aed"),
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [btn("✏️ แก้ไข", `draft=edit&id=${input.id}`, "secondary"), btn("ยกเลิก", `draft=cancel&id=${input.id}`, "link", "#be123c")],
          },
          ...(url ? [small("หลังบันทึก รายการจะไปรออนุมัติในเว็บ")] : []),
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
