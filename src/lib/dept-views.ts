// Read-only department pages built from existing records: monthly tax summary and an expiry tracker.
import { allEntities } from "./data";
import { assert, canRead } from "./domain";
import { catalog } from "./catalog";
import { awaitingReview, expenseCalc, whtForm } from "./tax";
import type { Context } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ภ.พ.30 input VAT and ภ.ง.ด.3 / ภ.ง.ด.53 withholding per month, from reviewed expenses (newest month first). */
export async function taxReport(ctx: Context) {
  assert(canRead(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  const months: Record<string, { month: string; spend: number; vat: number; pnd3: number; pnd53: number; docs: number; pending: number; income?: number; outVat?: number }> = {};
  for (const e of await allEntities(ctx, "expenses", 5000)) {
    const d = e.data;
    if (d.status === "rejected") continue;
    const month = String(d.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const m = (months[month] ??= { month, spend: 0, vat: 0, pnd3: 0, pnd53: 0, docs: 0, pending: 0 });
    const c = expenseCalc(d);
    m.docs++;
    m.spend = r2(m.spend + c.gross);
    if (awaitingReview(d)) {
      m.pending++;
      continue;
    }
    m.vat = r2(m.vat + c.claimable);
    const form = whtForm(String(d.taxId || ""), Number(d.whtRate) || 0);
    if (form === "ภ.ง.ด.53") m.pnd53 = r2(m.pnd53 + c.wht);
    else if (form) m.pnd3 = r2(m.pnd3 + c.wht);
  }
  // Sales side of the same months: output VAT (ภาษีขาย) from invoices and money received.
  const inc = await incomeMonths(ctx);
  for (const r of inc.months) {
    const m = (months[r.month] ??= { month: r.month, spend: 0, vat: 0, pnd3: 0, pnd53: 0, docs: 0, pending: 0 });
    Object.assign(m, { income: r.income, outVat: r.outVat });
  }
  return Object.values(months)
    .map((m) => ({ income: 0, outVat: 0, ...m }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 24);
}

export type IncomeMonth = { month: string; income: number; invoiced: number; outVat: number; docs: number };
/** Revenue per month (payments received + confirmed sales, the Financial Center rule), invoices issued with their
 *  output VAT, and what customers still owe on invoices. */
async function incomeMonths(ctx: Context) {
  const months: Record<string, IncomeMonth> = {};
  const at = (date: unknown) => {
    const month = String(date || "").slice(0, 7);
    return /^\d{4}-\d{2}$/.test(month) ? (months[month] ??= { month, income: 0, invoiced: 0, outVat: 0, docs: 0 }) : null;
  };
  const [payments, invoices, sales] = await Promise.all([
    allEntities(ctx, "payments", 5000),
    allEntities(ctx, "invoices", 5000),
    canRead(ctx, "Sales") ? allEntities(ctx, "sales", 5000) : Promise.resolve([]),
  ]);
  const received = new Map<string, number>();
  for (const e of payments) {
    const d = e.data;
    if (d.direction !== "income") continue;
    const m = at(d.date);
    if (m) {
      m.income = r2(m.income + (Number(d.amount) || 0));
      m.docs++;
    }
    if (d.invoiceId) received.set(String(d.invoiceId), (received.get(String(d.invoiceId)) || 0) + (Number(d.amount) || 0));
  }
  for (const e of sales) {
    if (e.data.status !== "confirmed") continue;
    const m = at(e.data.date);
    if (m) {
      m.income = r2(m.income + (Number(e.data.amount) || 0));
      m.docs++;
    }
  }
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  let outstanding = 0,
    overdue = 0,
    overdueCount = 0;
  for (const e of invoices) {
    const d = e.data,
      sub = Number(d.subtotal) || 0,
      vat = r2((sub * (Number(d.vat) || 0)) / 100),
      total = r2(sub + vat),
      owed = r2(Math.max(0, total - (received.get(e.id) || 0)));
    const m = at(d.date);
    if (m) {
      m.invoiced = r2(m.invoiced + total);
      m.outVat = r2(m.outVat + vat);
    }
    outstanding = r2(outstanding + owed);
    if (owed > 0 && d.dueDate && String(d.dueDate) < today) {
      overdue = r2(overdue + owed);
      overdueCount++;
    }
  }
  return { months: Object.values(months).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 24), outstanding, overdue, overdueCount, invoices: invoices.length };
}

/** รายรับ page: monthly income with output VAT, and receivables. */
export async function incomeReport(ctx: Context) {
  assert(canRead(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  return incomeMonths(ctx);
}

// Which date on which page counts as "expires".
const sources: [kind: string, field: string, what: string][] = [
  ["contracts", "endDate", "สัญญาสิ้นสุด"],
  ["ip_assets", "expiryDate", "ทรัพย์สินทางปัญญาหมดอายุ"],
  ["policies", "expiryDate", "ทบทวนนโยบาย"],
  ["software", "expiryDate", "ต่ออายุไลเซนส์"],
  ["vehicles", "taxExpiry", "ภาษีรถหมดอายุ"],
  ["vehicles", "insuranceExpiry", "ประกันรถหมดอายุ"],
  ["cases", "nextHearing", "นัดคดี"],
];
/** Everything with an expiry or deadline the member may see, soonest first (expired within 90 days included). */
export async function expiries(ctx: Context) {
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const kinds = [...new Set(sources.map(([k]) => k))].filter((k) => canRead(ctx, catalog[k].department));
  const rows = (await Promise.all(kinds.map((k) => allEntities(ctx, k, 2000)))).flat();
  return rows
    .flatMap((e) =>
      sources
        .filter(([k, field]) => k === e.kind && /^\d{4}-\d{2}-\d{2}$/.test(String(e.data[field] || "")))
        .map(([k, field, what]) => {
          const date = String(e.data[field]);
          return { id: e.id, kind: k, page: catalog[k].label, name: String(e.data.name || ""), what, date, days: Math.round((Date.parse(date) - Date.parse(today)) / 86400000) };
        }),
    )
    .filter((x) => x.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 300);
}
