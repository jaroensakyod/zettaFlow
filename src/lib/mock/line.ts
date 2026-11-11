// Mockup data for the LINE Integration page (Canva p.15): 7 fictional connected groups on a Standard package,
// shaped exactly like /line-page returns (LinePageData) so the page renders them with its normal code. Shown only
// in sample mode (labelled ตัวอย่าง); group ids start with "sample-" and nothing here is ever sent to an API.
// Pictures are small illustrated SVG data URIs, never external images.
// Types only: line-page.ts imports server code (billing, Supabase), which must not reach the browser bundle.
import type { Activity, Approver, LinePageData, PackageTier, PageGroup, Person } from "../line-page";

/** Same rule as lineStats() in line-page.ts (copied so this client-side file stays free of server imports). */
function lineStats(groups: Pick<PageGroup, "status" | "waiting">[], pendingCodes: number): LinePageData["stats"] {
  const real = groups.filter((g) => g.status !== "test");
  return {
    groups: real.length,
    connected: real.filter((g) => g.status === "connected" || g.status === "warn").length,
    pending: pendingCodes,
    problems: real.filter((g) => g.status === "problem" || g.status === "warn").length,
    waiting: groups.reduce((s, g) => s + g.waiting, 0),
  };
}
import { portrait, SAMPLE_PREFIX, type Look } from "./employees";

/** A small illustrated "group photo": sky, hills and a pagoda-roofed building in the group's colours. */
export function groupScene(sky: string, roof: string, hill: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#fff7ec"/></linearGradient></defs>` +
    `<rect width="64" height="64" fill="url(#s)"/>` +
    `<circle cx="48" cy="16" r="6" fill="#ffd36b"/>` +
    `<path d="M0 46q16-12 32-4t32-2v24H0z" fill="${hill}"/>` +
    `<path d="M32 12l3 9h-6z" fill="${roof}"/>` +
    `<path d="M22 30l10-10 10 10z" fill="${roof}"/>` +
    `<path d="M19 38l13-10 13 10z" fill="${roof}"/>` +
    `<rect x="23" y="38" width="18" height="14" fill="#f4e3c3"/>` +
    `<rect x="29.5" y="43" width="5" height="9" fill="#8a5a2b"/>` +
    `<path d="M0 54q20-6 64 0v10H0z" fill="#5fae6a"/>` +
    `</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

const looks: Look[] = [
  { hair: "short", bg: "#e3efff", shirt: "#2f3f63" },
  { hair: "long", bg: "#ffe8f1", shirt: "#ffffff", hairColor: "#4a2f25" },
  { hair: "short", bg: "#e1f6ec", shirt: "#1c8a72", skin: "#e8b996" },
  { hair: "bun", bg: "#fff1d9", shirt: "#b27a06" },
  { hair: "short", bg: "#efe9fd", shirt: "#6a45d1" },
  { hair: "long", bg: "#e3f4fb", shirt: "#1f86ad", hairColor: "#2b2233" },
];
const face = (name: string, i: number): Person => ({ name, picture: portrait(looks[i % looks.length]) });

type Seed = {
  title: string;
  department: string;
  label: string;
  tone: string;
  members: number;
  kinds: string[];
  senders: number;
  approver: string;
  waiting: number;
  scene: [string, string, string];
};
export const lineSeeds: Seed[] = [
  { title: "บัญชี-การเงิน", department: "Finance", label: "บัญชี", tone: "violet", members: 24, kinds: ["เอกสารการเงิน", "บิล", "ค่าใช้จ่าย"], senders: 11, approver: "คุณเอ (ผู้จัดการบัญชี)", waiting: 4, scene: ["#cfe4ff", "#c0392b", "#9fd39a"] },
  { title: "ฝ่ายขาย", department: "Sales", label: "ฝ่ายขาย", tone: "pink", members: 36, kinds: ["ใบเสนอราคา", "ออเดอร์", "ลูกค้า"], senders: 15, approver: "คุณบี (Sales Manager)", waiting: 2, scene: ["#ffe1c7", "#d35400", "#a8d58f"] },
  { title: "การตลาด (Marketing)", department: "Marketing", label: "การตลาด", tone: "rose", members: 28, kinds: ["แผนแคมเปญ", "คอนเทนต์", "รายงาน"], senders: 12, approver: "คุณซี (Marketing Lead)", waiting: 1, scene: ["#f9d9e6", "#8e44ad", "#b2dba1"] },
  { title: "จัดซื้อ (Purchasing)", department: "Purchasing", label: "จัดซื้อ", tone: "blue", members: 18, kinds: ["ใบขอซื้อ", "PO", "ใบเสนอราคา"], senders: 8, approver: "คุณดี (Procurement Mgr)", waiting: 3, scene: ["#d6ecff", "#b9770e", "#9ccc8f"] },
  { title: "คลังสินค้า", department: "Warehouse", label: "คลังสินค้า", tone: "sky", members: 20, kinds: ["รับเข้า-จ่ายออก", "สต็อก", "เบิกของ"], senders: 10, approver: "คุณอี (Warehouse Mgr)", waiting: 0, scene: ["#dff3ff", "#a04000", "#8fc98a"] },
  { title: "โครงการ (Project)", department: "Operations", label: "โครงการ", tone: "pink", members: 32, kinds: ["ความคืบหน้างาน", "รูปหน้างาน", "รายงาน"], senders: 13, approver: "คุณเอฟ (Project Manager)", waiting: 2, scene: ["#ffe6cc", "#c0392b", "#a5d49a"] },
  { title: "บริหารทั่วไป (Admin)", department: "Admin", label: "ธุรการ / Admin", tone: "slate", members: 15, kinds: ["เอกสารภายใน", "คำขออนุมัติ", "แจ้งเวียน"], senders: 7, approver: "คุณจี (Office Manager)", waiting: 0, scene: ["#e4e0ff", "#7d3c98", "#a9d6a0"] },
];

export const sampleTiers: PackageTier[] = [
  { id: "free", name: "Free", range: "1 กลุ่ม", note: "ใช้ฟรีตลอด · บัญชีและการเงิน", limit: 1, current: false },
  { id: "starter", name: "Starter", range: "2 – 3 กลุ่ม", note: "สำหรับธุรกิจขนาดเล็ก", limit: 3, current: false },
  { id: "growth", name: "Growth", range: "4 – 5 กลุ่ม", note: "สำหรับทีมที่มีหลายแผนก", limit: 5, current: false },
  { id: "business", name: "Business", range: "6 – 10 กลุ่ม", note: "สำหรับบริษัทหลายแผนก หลายสาขา", limit: 10, current: true },
  { id: "enterprise", name: "Enterprise", range: "ไม่จำกัดกลุ่ม", note: "สำหรับองค์กรขนาดใหญ่ / เครือบริษัท", limit: null, current: false },
];

/** Bangkok wall-clock time `hh:mm`, `daysAgo` days before `now`, as an ISO instant. */
const bangkokAt = (now: number, daysAgo: number, hm: string) => {
  const day = new Date(now + 7 * 3600000 - daysAgo * 86400000).toISOString().slice(0, 10);
  return new Date(`${day}T${hm}:00+07:00`).toISOString();
};

/** The whole mockup, with activity times relative to `now`. */
export function lineSample(now = Date.now()): LinePageData {
  const approvers: Approver[] = lineSeeds.map((s) => ({ name: s.approver, role: "manager", departments: [s.department] }));
  const groups: PageGroup[] = lineSeeds.map((s, i) => {
    const id = `${SAMPLE_PREFIX}line-${i + 1}`;
    const senders = [0, 1, 2].map((k) => face(["สมชาย", "มาลี", "วิทยา", "อรุณี", "ประเสริฐ", "จันทร์เพ็ญ"][(i + k) % 6], i + k));
    return {
      group_id: id,
      name: s.title,
      lineName: s.title,
      title: s.title,
      picture: groupScene(...s.scene),
      members: s.members,
      department: s.department,
      departmentLabel: s.label,
      tone: s.tone,
      template_id: null,
      templateName: null,
      approve_keywords: ["อนุมัติ", "ok"],
      test: false,
      found: true,
      status: "connected",
      kinds: s.kinds,
      senders,
      senderCount: s.senders,
      approvers: [approvers[i]],
      deciders: [s.approver],
      total: 40 + i * 9,
      week: 6 + i * 2,
      waiting: s.waiting,
      incomplete: 0,
      failedWeek: 0,
      lastAt: bangkokAt(now, 0, "1" + (i % 6) + ":0" + i),
      createdAt: bangkokAt(now, 30 + i * 5, "10:00"),
      search: [s.title, s.label, s.department].join(" ").toLowerCase(),
    };
  });
  const activity: Activity[] = [
    { at: bangkokAt(now, 0, "14:32"), kind: "paired", group: groups[4].group_id, text: 'เชื่อมต่อกลุ่ม "คลังสินค้า" สำเร็จ' },
    { at: bangkokAt(now, 0, "13:10"), kind: "waiting", group: groups[3].group_id, text: 'มีรายการรออนุมัติ 3 รายการ จากกลุ่ม "จัดซื้อ"' },
    { at: bangkokAt(now, 0, "11:46"), kind: "pulled", group: groups[5].group_id, text: 'ดึงข้อมูลใหม่จากกลุ่ม "โครงการ" (5 รายการ)' },
    { at: bangkokAt(now, 1, "17:20"), kind: "decided", group: groups[2].group_id, text: 'อัปเดตสิทธิ์ผู้อนุมัติ กลุ่ม "การตลาด"' },
    { at: bangkokAt(now, 1, "15:05"), kind: "decided", group: groups[0].group_id, text: 'อนุมัติ 6 รายการ ในกลุ่ม "บัญชี-การเงิน" โดย คุณเอ' },
    { at: bangkokAt(now, 2, "09:40"), kind: "pulled", group: groups[1].group_id, text: 'ดึงข้อมูลใหม่จากกลุ่ม "ฝ่ายขาย" (8 รายการ)' },
  ];
  return {
    configured: true,
    adminReady: true,
    groups,
    stats: lineStats(groups, 0),
    linked: approvers,
    activity,
    package: { planId: "business", planName: "Business", trial: false, limit: 10, used: groups.length, tiers: sampleTiers },
  };
}

/** Illustrated portrait for a sample approver (approvers carry no picture in LinePageData). */
export const approverPortrait = (name: string) => portrait(looks[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % looks.length]);
