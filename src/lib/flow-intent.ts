// น้องโฟลว์: turns a Thai message into an intent without needing an AI model. Pure, so it is unit-tested.
import { modules } from "./catalog";

export type TaskDraft = {
  name: string;
  department: string;
  dueDate: string;
  priority: "normal" | "high" | "urgent";
};
export type Intent =
  | { kind: "open"; view: string }
  | { kind: "create_task"; draft: TaskDraft }
  | { kind: "query"; topic: "overdue_invoices" | "due_tasks" | "low_stock" | "sales"; period?: "today" | "week" | "month" }
  | { kind: "chat" };

// Page names people say, mapped to workspace views. Module labels are added below.
const pageWords: [RegExp, string][] = [
  [/เครือข่าย|ฟีด|หน้าแรก/, "feed"],
  [/หางาน|จับคู่|ข้อเสนอ/, "jobs"],
  [/ภาพรวม|แดชบอร์ด|dashboard/i, "dashboard"],
  [/ปฏิทิน/, "calendar"],
  [/แชท/, "chat"],
  [/โปรไฟล์บริษัท|ข้อมูลบริษัท|หน้าบริษัท/, "company"],
  [/สิทธิ์|สมาชิก|ทีม/, "team"],
  [/รายงาน|export/i, "reports"],
  [/data inbox|อินบ็อกซ์|ส่งเอกสาร/i, "ai-inbox"],
  [/สต็อก|คลังสินค้า/, "products"],
  [/งาน|ทาสก์|task/i, "tasks"],
];
const departments: [RegExp, string][] = [
  [/บัญชี|การเงิน/, "Finance"],
  [/การตลาด|marketing/i, "Marketing"],
  [/ขาย|เซลส์/, "Sales"],
  [/บุคคล|hr/i, "HR"],
  [/\bit\b|ไอที/i, "IT"],
  [/คลัง|สต็อก/, "Warehouse"],
  [/จัดซื้อ/, "Purchasing"],
  [/ออกแบบ|ดีไซน์/, "Design"],
  [/กฎหมาย/, "Legal"],
  [/บริการลูกค้า|customer service/i, "Customer Service"],
  [/ข้อมูล|data/i, "Data"],
  [/พัฒนาธุรกิจ/, "Business Development"],
];
const weekdays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Due date from Thai phrases: วันนี้, พรุ่งนี้, มะรืน, (วัน)ศุกร์นี้/หน้า, 25/10, 25/10/2569. */
export function parseDue(text: string, today: string) {
  if (/มะรืน/.test(text)) return addDays(today, 2);
  if (/พรุ่งนี้/.test(text)) return addDays(today, 1);
  if (/วันนี้/.test(text)) return today;
  const dow = new Date(today + "T00:00:00Z").getUTCDay();
  for (const [n, name] of weekdays.entries()) {
    const m = new RegExp(`(?:วัน)?${name}(?:บดี)?(นี้|หน้า)?`).exec(text);
    if (!m) continue;
    let diff = (n - dow + 7) % 7;
    if (m[1] === "หน้า") diff += diff === 0 ? 7 : 7;
    else if (diff === 0) diff = 7;
    return addDays(today, diff);
  }
  const d = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(text);
  if (d) {
    let year = d[3] ? Number(d[3]) : Number(today.slice(0, 4));
    if (year < 100) year += 2500;
    if (year > 2400) year -= 543;
    const iso = `${year}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso) return iso;
  }
  return "";
}

export function pageFor(text: string) {
  const t = text.toLowerCase();
  const exact = modules.find((m) => t.includes(m.label.toLowerCase()));
  if (exact) return exact.key;
  return pageWords.find(([re]) => re.test(t))?.[1] || "";
}

export function routeIntent(message: string, today: string): Intent {
  const text = message.trim();
  const create = /^(?:ช่วย)?(?:สร้าง|เพิ่ม|มอบหมาย)งาน(?:ใหม่)?\s*(.*)$/s.exec(text);
  if (create) {
    let rest = create[1];
    const department = departments.find(([re]) => re.test(rest))?.[1] || "Operations";
    const dueDate = parseDue(rest, today);
    const priority = /ด่วน/.test(rest) ? "urgent" : /สำคัญ/.test(rest) ? "high" : "normal";
    const days = "อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัส(?:บดี)?|ศุกร์|เสาร์";
    rest = rest
      .replace(/\s*(?:ด่วน|สำคัญ)\s*$/, "")
      .replace(
        new RegExp(
          String.raw`\s*(?:ครบกำหนด|ภายใน|ก่อน|ส่ง)?\s*(?:(?:วัน)?(?:${days})(?:นี้|หน้า)?|วันนี้|พรุ่งนี้|มะรืน(?:นี้)?|\d{1,2}/\d{1,2}(?:/\d{2,4})?)\s*$`,
        ),
        "",
      )
      .replace(/^ให้\s*/, "")
      .replace(/^(?:ฝ่าย|แผนก|ทีม)\s*(?:บัญชี|การเงิน|การตลาด|ขาย|บุคคล|HR|IT|ไอที|คลัง(?:สินค้า)?|สต็อก|จัดซื้อ|ออกแบบ|กฎหมาย|บริการลูกค้า|ข้อมูล|พัฒนาธุรกิจ)\s*/i, "")
      .trim();
    return {
      kind: "create_task",
      draft: { name: (rest || text).slice(0, 200), department, dueDate, priority },
    };
  }
  // Comparisons, breakdowns and "why/should" questions need reasoning, not a fixed lookup: leave them to the AI.
  if (/เทียบ|เปรียบ|แยก(?:ตาม|เป็น)?|วิเคราะห์|ทำไม|เพราะอะไร|แนวโน้ม|ควร|ช่องทาง|ทีมไหน|ใครบ้าง/.test(text))
    return { kind: "chat" };
  if (/ใบแจ้งหนี้|invoice/i.test(text) && /ค้าง|เลย|ยังไม่(?:ได้)?(?:จ่าย|ชำระ)|ครบกำหนด|ทวง/.test(text))
    return { kind: "query", topic: "overdue_invoices" };
  if (/งาน/.test(text) && /ใกล้|ครบกำหนด|ค้าง|เลยกำหนด|ต้องทำ|deadline/i.test(text))
    return { kind: "query", topic: "due_tasks" };
  if (/สต็อก|สินค้า/.test(text) && /ใกล้หมด|หมด|ต่ำ|ต้องสั่ง|จุดสั่งซื้อ/.test(text))
    return { kind: "query", topic: "low_stock" };
  if (/ยอดขาย|กำไร|รายได้/.test(text) && !/^(?:เปิด|ไป)/.test(text))
    return {
      kind: "query",
      topic: "sales",
      period: /วันนี้/.test(text) ? "today" : /เดือน/.test(text) ? "month" : "week",
    };
  const open = /^(?:ช่วย)?(?:เปิด|ไป|พาไป|ไปที่|ขอดู|ดู)(?:หน้า)?\s*(.+)$/s.exec(text);
  if (open) {
    const view = pageFor(open[1]);
    if (view) return { kind: "open", view };
  }
  return { kind: "chat" };
}
