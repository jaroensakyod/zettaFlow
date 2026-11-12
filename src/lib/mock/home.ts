// Sample ("ตัวอย่าง") data for the home dashboard: reproduces the Canva design page 16 so a new company sees what
// ภาพรวม looks like once it is in use. Every name and figure is fictional and is only shown under a "ตัวอย่าง" banner,
// never mixed with real rows and never written anywhere. Dates are placed relative to `today` so the calendar,
// agenda, KPI month-to-date and weekly chart line up whatever day it is.
// Pure data (type-only imports).
import type { Entity, HomeData } from "../types";
import type { HomeExtra, WorkItem, Activity } from "../home-extra";

export type KpiChange = { text: string; up: boolean; good: boolean };
export type HomeSample = {
  home: HomeData;
  extra: HomeExtra;
  /** Calendar entries of the current month (and tomorrow's meeting) — what GET /calendar would return. */
  calendar: Entity[];
  /** The `summary` prop the dashboard normally gets from the workspace (low stock, deals awaiting approval). */
  summary: { pendingDeals: number; lowStock: Entity[] };
  /** The design's month-over-month changes, shown as-is (its four percentages are not mutually derivable). */
  kpiChange: { cost: KpiChange; sales: KpiChange; profit: KpiChange; margin: KpiChange };
};

/** Design KPI figures (month to date). */
export const sampleKpi = { cost: 126340, sales: 530740, tasks: 42, open: 7, goal: 1200000 };
/** Sales / cost per weekday อา.–ส. of this week (the design's chart); each adds up to the KPI month-to-date. */
export const sampleWeekSales = [108500, 91200, 56300, 32400, 158640, 38900, 44800];
export const sampleWeekCost = [26800, 22400, 14100, 8900, 30540, 11200, 12400];
/** Running costs (ค่าใช้จ่าย: advertising, rent…) per weekday of this week. */
export const sampleWeekExpense = [8200, 3400, 2900, 1800, 12600, 2500, 2100];
/** Same period of last month, giving ยอดขาย ▲12.5% and ต้นทุน ▲3.2%. */
export const samplePrevMonth = { sales: 471770, cost: 122420 };
export const sampleProject = { id: "sample-prj-001", name: "PRJ-001 โครงการคอนโด Blue Sky" };

const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hm: string) => `${day}T${hm}:00+07:00`;
let seq = 0;
function ent(kind: string, department: string, data: Record<string, unknown>, when: string, id?: string): Entity {
  return {
    id: id || `sample-${kind}-${++seq}`,
    company_id: "sample",
    kind,
    department,
    data,
    created_at: when,
    updated_at: when,
    created_by: "sample",
    version: 1,
    archived_at: null,
  };
}

function financeRows(today: string): HomeData["finance"] {
  const month = today.slice(0, 7),
    sunday = addDays(today, -new Date(today + "T00:00:00Z").getUTCDay()),
    rows: HomeData["finance"] = [];
  sampleWeekSales.forEach((sales, i) => {
    const date = addDays(sunday, i);
    rows.push({ kind: "sales", date, amount: sales, projectId: i % 2 ? sampleProject.id : null });
    rows.push({ kind: "expenses", date, amount: sampleWeekCost[i], projectId: i % 2 ? sampleProject.id : null, category: "ซื้อสินค้าไว้ขาย" });
    rows.push({ kind: "expenses", date, amount: sampleWeekExpense[i], projectId: null, category: i % 2 ? "ส่งเสริมการขาย" : "ค่าเช่า" });
  });
  // Top the month-to-date up to the design totals when part of this week is in the future or in last month
  // (on a Saturday the week alone already adds up exactly).
  const inMtd = (d: string) => d.startsWith(month) && d <= today,
    sum = (kind: string) => rows.filter((r) => r.kind === kind && inMtd(r.date)).reduce((s, r) => s + r.amount, 0),
    restDay = [...Array(Number(today.slice(8)))].map((_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).find((d) => d < sunday) || today;
  const salesGap = sampleKpi.sales - sum("sales"),
    costGap = sampleKpi.cost - rows.filter((r) => r.category === "ซื้อสินค้าไว้ขาย" && inMtd(r.date)).reduce((n, r) => n + r.amount, 0);
  if (salesGap) rows.push({ kind: "sales", date: restDay, amount: salesGap, projectId: null });
  if (costGap) rows.push({ kind: "expenses", date: restDay, amount: costGap, projectId: null, category: "ซื้อสินค้าไว้ขาย" });
  const prev = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1)).toISOString().slice(0, 10);
  rows.push({ kind: "sales", date: prev, amount: samplePrevMonth.sales, projectId: null });
  rows.push({ kind: "expenses", date: prev, amount: samplePrevMonth.cost, projectId: null, category: "ซื้อสินค้าไว้ขาย" });
  rows.push({ kind: "expenses", date: prev, amount: 31800, projectId: null, category: "ค่าเช่า" });
  return rows;
}

function tasks(today: string): Entity[] {
  const done = [
      "จัดทำใบเสนอราคาลูกค้าใหม่", "อัปเดตราคาสินค้าในแคตตาล็อก", "ปิดยอดขายประจำสัปดาห์", "ส่งเอกสารภาษีให้ฝ่ายบัญชี",
      "ประชุมสรุปแคมเปญเดือนก่อน", "ตรวจนับสต็อกคลังสินค้า",
    ],
    open = [
      { name: "สรุปรายงานยอดขายไตรมาส 3", due: addDays(today, -1), priority: "high" },
      { name: "เตรียมสไลด์พรีเซนต์แคมเปญใหม่", due: addDays(today, 2), priority: "high" },
      { name: "ติดตามการส่งมอบวัสดุโครงการคอนโด", due: addDays(today, 6), priority: "normal" },
      { name: "อัปเดตข้อมูลลูกค้าใน CRM", due: addDays(today, 9), priority: "normal" },
      { name: "วางแผนงบการตลาดปีหน้า", due: addDays(today, 14), priority: "normal" },
      { name: "ตรวจสัญญาเช่าพื้นที่สาขาใหม่", due: addDays(today, 20), priority: "normal" },
      { name: "จัดอบรมพนักงานใหม่", due: "", priority: "normal" },
    ];
  const out: Entity[] = open.map((t) =>
    ent("tasks", "Operations", { name: t.name, status: "todo", dueDate: t.due || undefined, priority: t.priority }, at(today, "08:00")),
  );
  for (let i = 0; i < sampleKpi.tasks - open.length; i++)
    out.push(ent("tasks", "Operations", { name: done[i % done.length], status: "done", dueDate: addDays(today, -3 - i) }, at(addDays(today, -3 - i), "17:00")));
  return out;
}

function calendar(today: string): Entity[] {
  const month = today.slice(0, 7),
    last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate(),
    agenda: [string, string, string][] = [
      ["09:00", "events", "ประชุมทีมการตลาด"],
      ["11:00", "events", "ตรวจเอกสารจัดซื้อ"],
      ["13:30", "events", "ติดตามโปรเจกต์คอนโด"],
      ["15:00", "events", "พรีเซนต์แคมเปญใหม่"],
      ["17:00", "tasks", "สรุปยอดขายรายวัน"],
    ];
  const rows = agenda.map(([time, kind, name]) =>
    ent(kind, "Operations", kind === "tasks" ? { name, dueDate: today, time, status: "todo" } : { name, startDate: today, endDate: today, startTime: time }, at(today, "07:00")),
  );
  rows.push(ent("events", "Operations", { name: "นัดประชุม", startDate: addDays(today, 1), endDate: addDays(today, 1), startTime: "10:00" }, at(today, "07:00")));
  // Dots spread over the month like the design (activity on most working days).
  for (const d of [3, 5, 8, 9, 10, 12, 13, 15, 16, 17, 19, 20, 22, 23, 24, 26, 27, 28, 30]) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    if (d <= last && day !== today && day !== addDays(today, 1))
      rows.push(ent("events", "Operations", { name: "นัดหมายทีม", startDate: day, endDate: day, startTime: "10:00" }, at(today, "07:00")));
  }
  return rows;
}

function work(today: string): WorkItem[] {
  const y = addDays(today, -1),
    prj = "โปรเจกต์: " + sampleProject.name;
  const w = (o: Omit<WorkItem, "id" | "view"> & { view?: string }, i: number): WorkItem => ({ id: "sample-work-" + i, view: o.source === "tasks" ? "tasks" : o.source, ...o });
  return [
    { source: "purchases", group: "approve", title: "ขออนุมัติใบสั่งซื้อ (PO-2026-1188)", sub: prj, requester: "คุณต้น", department: "Purchasing", at: at(today, "10:24"), priority: "urgent", status: "approved", decidedBy: "คุณ Siri", decidedAt: at(today, "11:02") },
    { source: "expenses", group: "approve", title: "ขออนุมัติงบการตลาด Q4", sub: "แผนก: การตลาด", requester: "คุณเมย์", department: "การตลาด", at: at(today, "09:58"), priority: "high", status: "pending" },
    { source: "tasks", group: "review", title: "ส่งรายงานความคืบหน้าโปรเจกต์ (อัปเดต 45%)", sub: prj, requester: "คุณบอส", department: "โครงการ", at: at(today, "09:30"), priority: "normal", status: "review" },
    { source: "expenses", group: "approve", title: "ขออนุมัติค่าใช้จ่ายกิจกรรมเปิดตัว", sub: "แผนก: ฝ่ายขาย", requester: "คุณแพร", department: "Sales", at: at(y, "17:42"), priority: "normal", status: "rejected", decidedBy: "คุณ Siri", decidedAt: at(y, "18:05") },
    { source: "leaves", group: "approve", title: "ขออนุมัติการลา: ลาพักร้อน 2 วัน", sub: "แผนก: บุคคล (HR)", requester: "คุณนก", department: "HR", at: at(y, "16:10"), priority: "normal", status: "pending" },
    { source: "purchases", group: "approve", title: "ขออนุมัติใบสั่งซื้อ (PO-2026-1192)", sub: "ยอด ฿48,500", requester: "คุณต้น", department: "Purchasing", at: at(y, "14:25"), priority: "high", status: "pending" },
    { source: "tasks", group: "review", title: "ตรวจแบบโฆษณาแคมเปญปีใหม่", sub: "แผนก: การตลาด", requester: "คุณเมย์", department: "การตลาด", at: at(y, "13:05"), priority: "high", status: "review" },
    { source: "tasks", group: "review", title: "ตรวจใบเสนอราคา QT-2026-0457", sub: "แผนก: ฝ่ายขาย", requester: "คุณแพร", department: "Sales", at: at(y, "11:20"), priority: "normal", status: "review" },
    { source: "tasks", group: "follow", title: "ติดตามการส่งมอบวัสดุโครงการคอนโด", sub: prj + " · ครบกำหนด " + addDays(today, 6), requester: "คุณบอส", department: "โครงการ", at: at(y, "10:40"), priority: "normal", status: "follow" },
    { source: "tasks", group: "follow", title: "ติดตามชำระเงินใบแจ้งหนี้ INV-2026-0312", sub: "แผนก: บัญชี", requester: "คุณฝน", department: "Finance", at: at(y, "09:15"), priority: "high", status: "follow" },
    { source: "tasks", group: "follow", title: "ติดตามผลสัมภาษณ์พนักงานขาย", sub: "แผนก: บุคคล (HR)", requester: "คุณนก", department: "HR", at: at(addDays(today, -2), "15:30"), priority: "normal", status: "follow" },
    { source: "expenses", group: "follow", title: "ขออนุมัติเบิกค่าเดินทางพบลูกค้า", sub: "ยอด ฿3,200", requester: "คุณเมย์", department: "การตลาด", at: at(addDays(today, -2), "11:00"), priority: "normal", status: "follow" },
  ].map((o, i) => w(o as Omit<WorkItem, "id" | "view">, i));
}

function activity(today: string): Activity[] {
  const y = addDays(today, -1);
  return [
    { id: "sample-act-1", at: at(today, "14:32"), icon: "approved", kind: "purchases", text: "อนุมัติใบสั่งซื้อ PO-2026-1188", by: "Siri", department: "Purchasing" },
    { id: "sample-act-2", at: at(today, "13:10"), icon: "updated", kind: "projects", text: "อัปเดตสถานะโปรเจกต์ PRJ-001 เป็น 45%", by: "", department: "ทีมโครงการ" },
    { id: "sample-act-3", at: at(today, "11:46"), icon: "created", kind: "customers", text: "เพิ่มลูกค้าใหม่: บริษัท เอสเค ดีเวลลอปเม้นท์ จำกัด", by: "", department: "Sales" },
    { id: "sample-act-4", at: at(y, "18:05"), icon: "rejected", kind: "expenses", text: "ไม่อนุมัติ ค่าใช้จ่ายกิจกรรมเปิดตัว", by: "Siri", department: "Sales" },
    { id: "sample-act-5", at: at(y, "16:20"), icon: "created", kind: "sales", text: "เพิ่มยอดขายใหม่: SO-2026-0815", by: "", department: "Sales" },
  ];
}

/** The home dashboard as designed, for `today` (YYYY-MM-DD, Bangkok). */
export function homeSample(today: string): HomeSample {
  seq = 0;
  const items = work(today),
    count = (g: string) => items.filter((w) => w.group === g).length;
  return {
    home: { finance: financeRows(today), projects: [sampleProject], tasks: tasks(today) },
    extra: {
      today,
      notes: [
        {
          day: today,
          body: "",
          items: [
            { text: "ประชุมแผนการตลาดไตรมาส 4", done: true },
            { text: "อัปเดตความคืบหน้าโปรเจกต์คอนโด", done: true },
            { text: "ตรวจสอบและอนุมัติใบสั่งซื้อ (PO)", done: false },
            { text: "สรุปยอดขายและวางแผนสัปดาห์หน้า", done: false },
          ],
          updated_at: at(today, "08:30"),
        },
      ],
      goal: { month: today.slice(0, 7) + "-01", target: sampleKpi.goal },
      canSetGoal: false, // read-only
      work: items,
      counts: { all: items.length, approve: count("approve"), review: count("review"), follow: count("follow") },
      activity: activity(today),
      avatar: null,
    },
    calendar: calendar(today),
    summary: { pendingDeals: 1, lowStock: [ent("products", "Warehouse", { name: "เซรั่มบำรุงผิว", stock: 32 }, at(today, "07:00"))] },
    kpiChange: {
      cost: { text: "3.2%", up: true, good: false },
      sales: { text: "12.5%", up: true, good: true },
      profit: { text: "18.9%", up: true, good: true },
      margin: { text: "6.4 จุด", up: true, good: true },
    },
  };
}

/** True when the company has nothing of its own on the home page yet: no tasks, sales, notes or work items. */
export function homeIsEmpty(home: HomeData, extra: HomeExtra) {
  return !home.tasks.length && !home.finance.some((r) => r.kind === "sales") && !extra.notes.length && !extra.work.length;
}
