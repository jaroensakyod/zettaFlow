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

/** Thai department names for LINE messages (same as dept_th in SQL). */
export const deptThai: Record<string, string> = {
  Finance: "ฝ่ายบัญชีและการเงิน",
  HR: "ฝ่ายบุคคล",
  Warehouse: "คลังสินค้า",
  Sales: "ฝ่ายขาย",
  Marketing: "การตลาด",
  IT: "ฝ่าย IT",
  Operations: "ฝ่ายปฏิบัติการ",
  Purchasing: "จัดซื้อ",
  Legal: "กฎหมาย",
  Event: "อีเวนต์",
  Admin: "บริหารองค์กร",
  Design: "ออกแบบ",
  "Customer Service": "บริการลูกค้า",
  Data: "ข้อมูล",
  "Business Development": "พัฒนาธุรกิจ",
};

/** Posted in the approving department's group when another group asks for something it has to decide. */
export function approverNotice(input: {
  kind?: string | null;
  values: Record<string, unknown>;
  requester?: string | null;
  /** Name of the group (or its department) that asked. */
  from: string;
}) {
  const page = (input.kind && catalog[input.kind]?.label) || "รายการ";
  const what = summary(input.values);
  const url = pageUrl(input.kind);
  return [
    `📥 คำขอใหม่จาก ${input.from}`,
    `📋 ${page}${what ? ": " + what : ""}`,
    ...(input.requester ? ["👤 ผู้ขอ: " + input.requester] : []),
    "ผู้มีสิทธิ์กด Reply ข้อความนี้ แล้วพิมพ์",
    "• “อนุมัติ”",
    "• “ไม่อนุมัติ เพราะ…”",
    "• “แก้ …” เช่น “แก้ ยอด 4,500”",
    ...(url ? ["หรือดูในเว็บ: " + url] : []),
  ]
    .join("\n")
    .slice(0, 4500);
}

/** What a manager typed when replying to an approver notice. */
export function parseDecision(text: string): { status: "approved" } | { status: "rejected"; reason: string } | { status: "edit"; note: string } | null {
  const t = text.trim();
  const no = t.match(/^(ไม่อนุมัติ|ยกเลิก|ปฏิเสธ|reject)\s*(?:เพราะ|เนื่องจาก|:)?\s*([\s\S]*)$/i);
  if (no) return { status: "rejected", reason: no[2].trim() };
  if (/^(อนุมัติ|approve|ok|โอเค)/i.test(t)) return { status: "approved" };
  const edit = t.match(/^(แก้ไข|แก้)\s*([\s\S]+)$/);
  if (edit) return { status: "edit", note: edit[2].trim() };
  return null;
}
