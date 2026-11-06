// What the bot answers in a LINE group after reading a message: which page it went to, what was read,
// what is missing, how a manager approves it and how anyone fixes it (Reply to this notice, or the web page).
import { catalog } from "./catalog";
import { formatMoney, isForeign } from "./fx";

/** Web page where the item waits for review (each page shows its "รอตรวจจาก LINE" box). */
export function pageUrl(kind: string | null | undefined) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const view = kind && catalog[kind] ? kind : "ai-inbox";
  return base ? `${base}/workspace/${view}` : "";
}

function summary(values: Record<string, unknown>) {
  const name = String(values.name || values.title || "").trim().slice(0, 80);
  const raw = values.amountForeign ?? values.amount ?? values.total;
  const amount = typeof raw === "number" && raw > 0 ? (isForeign(values.currency) ? formatMoney(raw, values.currency) : "฿" + raw.toLocaleString("en-US", { maximumFractionDigits: 2 })) : "";
  return [name, amount].filter(Boolean).join(" · ");
}

export function lineNotice(input: {
  kind?: string | null;
  /** Template name for groups that use a fixed form instead of AI sorting. */
  form?: string | null;
  values: Record<string, unknown>;
  missing: string[];
  keyword?: string | null;
  /** LINE display name of the member who sent the message. */
  requester?: string | null;
}) {
  const page = (input.kind && catalog[input.kind]?.label) || input.form || "กล่องรอตรวจ";
  const what = summary(input.values);
  const url = pageUrl(input.kind);
  const who = input.requester ? ["👤 ผู้ขอ: " + input.requester] : [];
  const lines = input.missing.length
    ? [
        `⚠️ บันทึกเข้า「${page}」แล้ว แต่ยังขาด: ${input.missing.join(", ")}`,
        ...who,
        ...(what ? ["📝 " + what] : []),
        "👉 กด Reply ข้อความนี้ แล้วพิมพ์ข้อมูลที่ขาด เช่น “ยอด 4,000 บาท”",
        ...(url ? ["หรือกรอกในเว็บ: " + url] : []),
      ]
    : [
        `✅ บันทึกเข้า「${page}」แล้ว รอผู้จัดการอนุมัติ`,
        ...who,
        ...(what ? ["📝 " + what] : []),
        `ผู้จัดการพิมพ์ “${input.keyword || "อนุมัติ"}” เพื่ออนุมัติ`,
      ];
  return lines.join("\n").slice(0, 4500);
}
