// Rules for the แผนก pages, shared by demo mode and mirrored in SQL (0023_department_rules.sql):
// stored totals, who may approve, stock effects, and turning one document into the next.
import { catalog, docTotal, computeAttendance } from "./catalog";

const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Figures saved with the record so reports, CSV and dashboards see them (same formulas as the table columns). */
export function derive(kind: string, d: Record<string, unknown>): Record<string, number> {
  switch (kind) {
    case "quotations":
    case "sales_orders":
      return { total: docTotal(d) };
    case "sales_targets":
      return { percent: num(d.target) ? r2((num(d.actual) / num(d.target)) * 100) : 0 };
    case "content":
      return { rate: num(d.reach) ? r2((num(d.engagement) / num(d.reach)) * 100) : 0 };
    case "marketing_budget":
    case "event_budget":
      return { remaining: r2(num(d.budget) - num(d.spent)) };
    case "stock_counts":
      return { diff: num(d.countedQty) - num(d.systemQty) };
    case "bills":
      return { net: r2(num(d.amount) - (num(d.amount) / 1.07) * (num(d.whtRate) / 100)) };
    case "attendance":
      return computeAttendance(d);
    case "kpi":
      return { progress: num(d.target) ? r2((num(d.actual) / num(d.target)) * 100) : 0 };
  }
  return {};
}

/** Statuses only an Owner or Manager may set on these pages. */
export const approvalStatuses: Record<string, string[]> = {
  stock_issues: ["อนุมัติแล้ว", "จ่ายของแล้ว", "ไม่อนุมัติ"],
  stock_counts: ["ปรับยอดแล้ว"],
  bills: ["รอจ่าย", "จ่ายแล้ว"],
  marketing_budget: ["อนุมัติ", "ปิดงบ"],
  event_budget: ["อนุมัติ", "จ่ายแล้ว"],
  recruitment: ["เสนองาน", "รับเข้าทำงาน"],
  kpi: ["ประเมินแล้ว"],
  promotions: ["กำลังจัด"],
  policies: ["ประกาศใช้"],
  quotations: ["ตอบรับ"],
};
export const needsApprover = (kind: string, status: unknown, oldStatus?: unknown) =>
  !!approvalStatuses[kind]?.includes(String(status)) && status !== oldStatus;

/** Stock moved when a page reaches a status: issue out on "จ่ายของแล้ว", count adjustment on "ปรับยอดแล้ว". */
export function stockEffect(kind: string, d: Record<string, unknown>, oldStatus: unknown, currentStock: number) {
  if (kind === "stock_issues" && d.status === "จ่ายของแล้ว" && oldStatus !== "จ่ายของแล้ว")
    return { type: "out" as const, quantity: num(d.quantity) };
  if (kind === "stock_counts" && d.status === "ปรับยอดแล้ว" && oldStatus !== "ปรับยอดแล้ว") {
    const delta = num(d.countedQty) - currentStock;
    return delta ? { type: delta > 0 ? ("in" as const) : ("out" as const), quantity: Math.abs(delta) } : null;
  }
  return null;
}
/** Once stock has moved, the quantities on that record are locked. */
export const stockLocked = (kind: string, oldStatus: unknown) =>
  (kind === "stock_issues" && oldStatus === "จ่ายของแล้ว") || (kind === "stock_counts" && oldStatus === "ปรับยอดแล้ว");

const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + 7 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const ref = (e: { id: string; data: Record<string, unknown> }) => String(e.data.code || e.data.name) + " #" + e.id.slice(0, 8);

type Row = { id: string; kind: string; data: Record<string, unknown> };
export type Conversion = { from: string; to: string; label: string; when: string[]; done?: string };
/** Next-step buttons: quotation → SO → invoice, paid AP bill → payment, hired applicant → employee. */
export const conversions: Conversion[] = [
  { from: "quotations", to: "sales_orders", label: "แปลงเป็นคำสั่งซื้อ (SO)", when: ["ตอบรับ"] },
  { from: "sales_orders", to: "invoices", label: "ออกใบแจ้งหนี้", when: ["รอดำเนินการ", "กำลังจัดส่ง", "ส่งแล้ว"], done: "ออกใบแจ้งหนี้แล้ว" },
  { from: "bills", to: "payments", label: "บันทึกการจ่ายเงิน", when: ["จ่ายแล้ว"] },
  { from: "recruitment", to: "employees", label: "สร้างข้อมูลพนักงาน", when: ["รับเข้าทำงาน"] },
];
/** The new record's data, and how to tell it was already created (so a document converts once). */
export function convertData(src: Row): { data: Record<string, unknown>; exists: (r: Row) => boolean } {
  const d = src.data;
  switch (src.kind) {
    case "quotations":
      return {
        data: { name: String(d.name), customerId: d.customerId, quotationId: src.id, date: today(), deliveryDate: plusDays(14), lines: d.lines, subtotal: d.subtotal, discount: d.discount, vatMode: d.vatMode, status: "รอดำเนินการ", notes: "จากใบเสนอราคา " + ref(src) },
        exists: (r) => r.kind === "sales_orders" && r.data.quotationId === src.id,
      };
    case "sales_orders": {
      const lines = Array.isArray(d.lines) ? (d.lines as { qty: number; price: number }[]) : [];
      const sub = Math.max(0, (lines.length ? lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0) : num(d.subtotal)) - num(d.discount));
      const base = d.vatMode === "included" ? r2(sub / 1.07) : sub;
      return {
        data: { name: "INV-" + String(d.code || d.name), customerId: d.customerId, projectId: d.projectId, date: today(), dueDate: plusDays(30), subtotal: r2(base), vat: d.vatMode === "none" ? 0 : 7, description: "ตามคำสั่งซื้อ " + ref(src) },
        exists: (r) => r.kind === "invoices" && String(r.data.description || "").includes("#" + src.id.slice(0, 8)),
      };
    }
    case "bills":
      return {
        data: { name: "จ่ายตามใบวางบิล " + ref(src), direction: "expense", date: today(), amount: derive("bills", d).net, method: "โอนธนาคาร" },
        exists: (r) => r.kind === "payments" && String(r.data.name || "").includes("#" + src.id.slice(0, 8)),
      };
    case "recruitment":
      return {
        data: { name: d.name, position: d.position, department: "ยังไม่ระบุ", phone: d.phone, email: d.email, salary: d.expectedSalary, startDate: today(), notes: "รับจากการสรรหา " + ref(src) },
        exists: (r) => r.kind === "employees" && String(r.data.notes || "").includes("#" + src.id.slice(0, 8)),
      };
  }
  throw Error("แปลงเอกสารนี้ไม่ได้");
}
/** Required dropdowns the source did not have get their first option, keys the page does not know are dropped. */
export function fitToPage(kind: string, d: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of catalog[kind].fields) {
    const v = d[f.key];
    if (v !== undefined && v !== null && v !== "") out[f.key] = v;
    if (f.type === "select" && f.required && !f.options?.includes(String(out[f.key]))) out[f.key] = f.options?.[0];
  }
  return out;
}
