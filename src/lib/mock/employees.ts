// Mockup data for the พนักงาน page (Canva p.17): 16 fictional employees with this month's attendance, leave and
// KPI records, shaped exactly like real records so the page renders them with its normal code. Shown only in
// sample mode (labelled ตัวอย่าง); every id starts with "sample-" and nothing here is ever written anywhere.
// Also home of the small illustrated portraits (SVG data URIs) the LINE mockup reuses.
import type { Entity } from "../types";
import { bangkokToday } from "../employees-stats";

export const SAMPLE_PREFIX = "sample-";
export const isSampleId = (id: string) => id.startsWith(SAMPLE_PREFIX);
export const sampleCompany = "บริษัท อีลิทโฟลว์ จำกัด";

// ---------- portraits ----------
export type Look = { hair: "long" | "short" | "bun"; bg: string; shirt: string; hairColor?: string; skin?: string };
/** A small illustrated head-and-shoulders portrait as an SVG data URI (no external image). */
export function portrait(look: Look) {
  const skin = look.skin || "#f6d3b8",
    hair = look.hairColor || "#2b2233";
  const back = look.hair === "long" ? `<path d="M18 31c0-13 6-20 14-20s14 7 14 20v19H18z" fill="${hair}"/>` : "";
  const top =
    look.hair === "short"
      ? `<path d="M20.5 27c-.5-9 5-14 11.5-14s12 5 11.5 14c-2-4-6.5-6-11.5-6s-9.5 2-11.5 6z" fill="${hair}"/>`
      : `<path d="M20.5 28c1-10 6.5-14.5 11.5-14.5S42.5 18 43.5 28c-4-5-11-6.5-23 0z" fill="${hair}"/>` +
        (look.hair === "bun" ? `<circle cx="32" cy="11" r="5.5" fill="${hair}"/>` : "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${look.bg}"/>` +
    back +
    `<path d="M8 64c2-13 12-19 24-19s22 6 24 19z" fill="${look.shirt}"/>` +
    `<path d="M27 40h10v7l-5 4-5-4z" fill="${skin}"/>` +
    `<path d="M26 45l6 6 6-6" fill="none" stroke="#fff" stroke-width="2" opacity=".85"/>` +
    `<ellipse cx="32" cy="29" rx="11" ry="12.5" fill="${skin}"/>` +
    top +
    `<circle cx="27.8" cy="30" r="1.3" fill="#2b2233"/><circle cx="36.2" cy="30" r="1.3" fill="#2b2233"/>` +
    `<path d="M28.5 35.5q3.5 2.6 7 0" fill="none" stroke="#b5584f" stroke-width="1.4" stroke-linecap="round"/>` +
    `<circle cx="25.5" cy="34" r="1.8" fill="#f2a7a0" opacity=".45"/><circle cx="38.5" cy="34" r="1.8" fill="#f2a7a0" opacity=".45"/>` +
    `</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// ---------- employees ----------
type Seed = {
  name: string;
  position: string;
  department: string;
  level: string;
  start: string;
  score: number;
  look: Look;
  status?: "inactive" | "on_leave";
  nickname?: string;
  skills?: string;
};
const seeds: Seed[] = [
  { name: "ศิริกัลยา วงศ์ทอง", position: "กรรมการผู้จัดการ", department: "บริหาร", level: "ผู้บริหาร", start: "2023-01-01", score: 96, look: { hair: "long", bg: "#efe7ff", shirt: "#f4f1fb", hairColor: "#3a2a26" }, nickname: "ศิริ" },
  { name: "ธนพล ศรีสุข", position: "ผู้จัดการฝ่ายขาย", department: "ฝ่ายขาย", level: "ผู้จัดการ", start: "2021-06-14", score: 94, look: { hair: "short", bg: "#e3efff", shirt: "#2f3f63" } },
  { name: "นภา ใจดี", position: "Sales Executive", department: "ฝ่ายขาย", level: "พนักงาน", start: "2024-03-01", score: 90, look: { hair: "long", bg: "#ffe8f1", shirt: "#ffffff", hairColor: "#4a2f25" } },
  { name: "ปิยะพงษ์ มั่นคง", position: "บัญชีและการเงิน", department: "บัญชี", level: "หัวหน้างาน", start: "2022-08-01", score: 92, look: { hair: "short", bg: "#e1f6ec", shirt: "#ffffff" } },
  { name: "กชกร นิลภา", position: "การตลาด", department: "Marketing", level: "พนักงาน", start: "2023-09-18", score: 94, look: { hair: "long", bg: "#fff1d9", shirt: "#ffffff", hairColor: "#2b2233" } },
  { name: "วรเมธ ทองดี", position: "ผู้จัดการฝ่ายปฏิบัติการ", department: "ปฏิบัติการ", level: "ผู้จัดการ", start: "2020-11-02", score: 92, look: { hair: "short", bg: "#e9e8fd", shirt: "#3b3f8f" } },
  { name: "ชุติมา แก้วประเสริฐ", position: "เจ้าหน้าที่บุคคล", department: "HR", level: "พนักงาน", start: "2024-01-08", score: 88, look: { hair: "bun", bg: "#fde8f3", shirt: "#c2338a", hairColor: "#3a2a26" } },
  { name: "อนุชา พรหมมา", position: "เจ้าหน้าที่จัดซื้อ", department: "จัดซื้อ", level: "พนักงาน", start: "2023-04-03", score: 90, look: { hair: "short", bg: "#e5f0fd", shirt: "#2f6fcc", skin: "#e8b996" } },
  { name: "สุนิสา ชัยมงคล", position: "นักออกแบบกราฟิก", department: "ออกแบบ", level: "พนักงาน", start: "2024-07-01", score: 92, look: { hair: "long", bg: "#e3f4fb", shirt: "#1f86ad", hairColor: "#5a3a2a" } },
  { name: "ณัฐวุฒิ บุญเรือง", position: "หัวหน้าคลังสินค้า", department: "สต็อก", level: "หัวหน้างาน", start: "2021-02-15", score: 88, look: { hair: "short", bg: "#fdf2dc", shirt: "#b27a06", skin: "#e8b996" } },
  { name: "พิมพ์ชนก ศรีวงศ์", position: "เจ้าหน้าที่บัญชี", department: "บัญชี", level: "พนักงาน", start: "2025-01-06", score: 90, look: { hair: "bun", bg: "#efe9fd", shirt: "#6a45d1" } },
  { name: "กิตติพัฒน์ แสงทอง", position: "IT Support", department: "IT", level: "พนักงาน", start: "2023-10-02", score: 94, look: { hair: "short", bg: "#e1f6f1", shirt: "#1c8a72" } },
  { name: "รัชนี ปัญญาดี", position: "เจ้าหน้าที่บริการลูกค้า", department: "Customer Service", level: "พนักงาน", start: "2024-05-20", score: 90, look: { hair: "long", bg: "#fdeadf", shirt: "#c4581b", hairColor: "#2b2233" } },
  { name: "ภาณุวัฒน์ จันทร์เพ็ญ", position: "Sales Executive", department: "ฝ่ายขาย", level: "พนักงาน", start: "2025-03-03", score: 92, look: { hair: "short", bg: "#eceef4", shirt: "#4d556b" } },
  { name: "เบญจวรรณ สุขสวัสดิ์", position: "เจ้าหน้าที่การตลาด", department: "Marketing", level: "พนักงาน", start: "2022-12-01", score: 88, look: { hair: "long", bg: "#fdebee", shirt: "#c63f59" }, status: "inactive" },
  { name: "ธีรภัทร วงศ์ใหญ่", position: "พนักงานคลังสินค้า", department: "สต็อก", level: "พนักงาน", start: "2023-06-12", score: 90, look: { hair: "short", bg: "#e3f6e8", shirt: "#23894a", skin: "#e8b996" }, status: "inactive" },
];
const emails = ["sirikanya", "thanaphon", "napa", "piyapong", "kotchakorn", "woramet", "chutima", "anucha", "sunisa", "nattawut", "pimchanok", "kittipat", "ratchanee", "panuwat", "benjawan", "teerapat"];
const pad = (n: number) => String(n).padStart(3, "0");
const sampleId = (kind: string, n: number | string) => `${SAMPLE_PREFIX}${kind}-${n}`;

const SIRI_SKILLS = "การบริหารองค์กร, กลยุทธ์ธุรกิจ, การวางแผน, การเจรจาต่อรอง, การบริหารทีม";
const SIRI_STRENGTHS = "ผู้นำและตัดสินใจได้ดี\nมองภาพรวมและวางกลยุทธ์ระยะยาว\nสื่อสารชัดเจน สร้างแรงบันดาลใจทีม";
const otherSkills = ["การขาย, การเจรจาต่อรอง, CRM", "การนำเสนอ, การดูแลลูกค้า", "บัญชีต้นทุน, ภาษี, Excel", "Content Marketing, Social Media, Canva", "การวางแผนงาน, Lean"];

/** Same record shape the API returns. */
function entity(kind: string, id: string, department: string, data: Record<string, unknown>): Entity {
  return { id, company_id: "sample", kind, department, data, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", created_by: "sample", version: 1, archived_at: null };
}

export const KPI_LINES: [string, number][] = [
  ["ผลสัมฤทธิ์งาน", 5.0],
  ["ความเป็นผู้นำ", 4.9],
  ["การสื่อสาร", 4.7],
  ["การบริหารทีม", 4.8],
  ["การแก้ปัญหา", 4.8],
];

export type EmployeesSample = { rows: Entity[]; attendance: Entity[]; leaves: Entity[]; kpi: Entity[]; portraits: Record<string, string> };

/**
 * The whole mockup for a given Bangkok day: 16 employees (14 working, 2 inactive), a 21-day attendance window this
 * month that includes today (12 on time + 2 late today), one approved leave day and 5 KPI lines for the first
 * person (20 at work incl. 2 late, 1 leave → 95%).
 */
export function employeesSample(today = bangkokToday()): EmployeesSample {
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = Math.min(last, Math.max(d, 21)),
    start = end - 20;
  const day = (n: number) => `${today.slice(0, 7)}-${String(n).padStart(2, "0")}`;
  const window = Array.from({ length: 21 }, (_, i) => start + i); // day numbers, includes today
  const others = window.filter((n) => n !== d);

  const rows: Entity[] = [],
    attendance: Entity[] = [],
    leaves: Entity[] = [],
    kpi: Entity[] = [],
    portraits: Record<string, string> = {};
  const lateToday = new Set([2, 6]); // indexes of the two people late today
  seeds.forEach((s, i) => {
    const id = sampleId("emp", i + 1);
    const first = i === 0;
    rows.push(
      entity("employees", id, "HR", {
        name: s.name,
        code: "EMP-" + pad(i + 1),
        nickname: s.nickname || "",
        department: s.department,
        position: s.position,
        level: s.level,
        employmentType: "ประจำ",
        startDate: s.start,
        status: s.status || "active",
        phone: first ? "082-456-7890" : `08${(i % 9) + 1}-${String(300 + i * 37).slice(0, 3)}-${String(1000 + i * 731).slice(0, 4)}`,
        email: `${emails[i]}@eliteflow.co.th`,
        score: s.score,
        leaveQuota: 10,
        skills: first ? SIRI_SKILLS : s.skills || otherSkills[i % otherSkills.length],
        strengths: first ? SIRI_STRENGTHS : "รับผิดชอบงานดี\nทำงานเป็นทีมได้ดี",
      }),
    );
    portraits[id] = portrait(s.look);
    if (s.status) return; // inactive: no attendance
    // Attendance: 21 days; leave on one earlier day, late on two other days (not today), today per lateToday.
    const leaveDay = others[(i * 3 + 4) % others.length],
      lateDays = new Set(first ? [others[1], others[9]] : i % 4 === 0 ? [others[(i + 6) % others.length]] : []);
    if (first || i % 5 === 0)
      leaves.push(
        entity("leaves", sampleId("leave", i + 1), "HR", { name: s.name, employeeId: id, type: "ลาพักร้อน", startDate: day(leaveDay), endDate: day(leaveDay), status: "approved", notes: "ธุระส่วนตัว" }),
      );
    for (const n of window) {
      const isToday = n === d;
      const onLeave = (first || i % 5 === 0) && n === leaveDay;
      const late = isToday ? lateToday.has(i) : !onLeave && lateDays.has(n);
      attendance.push(
        entity("attendance", sampleId(`att-${i + 1}`, n), "HR", {
          name: s.name,
          employeeId: id,
          date: day(n),
          status: onLeave ? "ลา" : late ? "สาย" : "ปกติ",
          checkIn: onLeave ? "" : late ? "09:1" + (n % 10) : "08:" + String(30 + (n % 25)).padStart(2, "0"),
          checkOut: onLeave ? "" : "17:3" + (n % 10),
          hours: onLeave ? 0 : 8,
          late: late ? 10 + (n % 10) : 0,
          location: "สำนักงานใหญ่",
        }),
      );
    }
  });
  leaves.push(
    entity("leaves", sampleId("leave", "pending"), "HR", { name: seeds[2].name, employeeId: rows[2].id, type: "ลาป่วย", startDate: day(Math.min(last, d + 3)), endDate: day(Math.min(last, d + 3)), status: "pending", notes: "นัดแพทย์" }),
  );
  KPI_LINES.forEach(([label, score], i) =>
    kpi.push(entity("kpi", sampleId("kpi", i + 1), "HR", { name: seeds[0].name, employeeId: rows[0].id, objective: label, period: today.slice(0, 4), score, status: "ตามเป้า" })),
  );
  return { rows, attendance, leaves, kpi, portraits };
}
