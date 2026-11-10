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
    openInvoices = 0,
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
    if (owed > 0) openInvoices++;
    if (owed > 0 && d.dueDate && String(d.dueDate) < today) {
      overdue = r2(overdue + owed);
      overdueCount++;
    }
  }
  return { months: Object.values(months).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 24), outstanding, openInvoices, overdue, overdueCount, invoices: invoices.length };
}

export type SalesStage = { count: number; amount: number };
/** รายรับ page: monthly income with output VAT, receivables, and where each sale stands in the flow
 *  ใบเสนอราคา → คำสั่งซื้อ (ลูกค้ายืนยัน) → ใบแจ้งหนี้ → รับชำระ. */
export async function incomeReport(ctx: Context) {
  assert(canRead(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  const base = await incomeMonths(ctx);
  let pipeline: { quotesSent: SalesStage; quotesAccepted: SalesStage; ordersToInvoice: SalesStage } | null = null;
  if (canRead(ctx, "Sales")) {
    const [quotes, orders] = await Promise.all([allEntities(ctx, "quotations", 5000), allEntities(ctx, "sales_orders", 5000)]);
    const total = (kind: string, d: Record<string, unknown>) => catalog[kind].computed?.total?.calc(d) || 0,
      add = (st: SalesStage, v: number) => ((st.count += 1), (st.amount = r2(st.amount + v)));
    const converted = new Set(orders.map((o) => String(o.data.quotationId || "")));
    pipeline = { quotesSent: { count: 0, amount: 0 }, quotesAccepted: { count: 0, amount: 0 }, ordersToInvoice: { count: 0, amount: 0 } };
    for (const q of quotes) {
      if (q.data.status === "ส่งแล้ว") add(pipeline.quotesSent, total("quotations", q.data));
      else if (q.data.status === "ตอบรับ" && !converted.has(q.id)) add(pipeline.quotesAccepted, total("quotations", q.data));
    }
    for (const o of orders)
      if (["รอดำเนินการ", "กำลังจัดส่ง", "ส่งแล้ว"].includes(String(o.data.status))) add(pipeline.ordersToInvoice, total("sales_orders", o.data));
  }
  return { ...base, pipeline };
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

export type LedgerExpense = {
  id: string; date: string; code: string; name: string; category: string; payee: string; docType: string; docNo: string;
  base: number; vat: number; claimable: number; gross: number; wht: number; whtForm: string; net: number;
  status: string; pending: boolean; projectId: string; receiptId: string; notes: string;
  projectName: string; payState: "ชำระแล้ว" | "รอชำระ" | "ยังไม่ชำระ"; payStatus: string;
};
export type LedgerIncome = {
  id: string; kind: "payments" | "sales"; date: string; name: string; customer: string; method: string; reference: string;
  invoice: string; amount: number; vat: number; base: number; notes: string;
};
/** Every expense and every income in a date range, with the tax on each row — the รายรับ / ค่าใช้จ่าย summary pages. */
export async function ledger(ctx: Context, from: string, to: string) {
  assert(canRead(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  assert(iso.test(from) && iso.test(to) && from <= to, "ช่วงวันที่ไม่ถูกต้อง");
  const inRange = (d: unknown) => {
    const s = String(d || "").slice(0, 10);
    return iso.test(s) && s >= from && s <= to;
  };
  const sales = canRead(ctx, "Sales");
  const [expenses, payments, invoices, saleRows, customers] = await Promise.all([
    allEntities(ctx, "expenses", 5000),
    allEntities(ctx, "payments", 5000),
    allEntities(ctx, "invoices", 5000),
    sales ? allEntities(ctx, "sales", 5000) : Promise.resolve([]),
    canRead(ctx, "Sales") ? allEntities(ctx, "customers", 5000) : Promise.resolve([]),
  ]);
  const projects = await allEntities(ctx, "projects", 5000).catch(() => []);
  const projectName = new Map(projects.map((p) => [p.id, String(p.data.name || "")]));
  const customerName = new Map(customers.map((c) => [c.id, String(c.data.name || "")]));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const exp: LedgerExpense[] = expenses
    .filter((e) => e.data.status !== "rejected" && inRange(e.data.date))
    .map((e) => {
      const d = e.data,
        c = expenseCalc(d);
      return {
        id: e.id, date: String(d.date).slice(0, 10), code: String(d.code || ""), name: String(d.name || ""),
        category: String(d.category || ""), payee: String(d.payee || ""), docType: String(d.docType || ""), docNo: String(d.docNo || ""),
        base: c.base, vat: c.vat, claimable: c.claimable, gross: c.gross, wht: c.wht,
        whtForm: whtForm(String(d.taxId || ""), Number(d.whtRate) || 0), net: c.net,
        status: String(d.status || ""), pending: awaitingReview(d), projectId: String(d.projectId || ""),
        receiptId: String(d.receiptId || ""), notes: String(d.notes || ""),
        projectName: projectName.get(String(d.projectId || "")) || "",
        payStatus: String(d.payStatus || ""),
        // Paid when marked paid or settled by transfer / petty cash; approved but unpaid waits for payment.
        payState:
          d.status === "paid" || d.payStatus === "โอนแล้ว" || d.payStatus === "เงินสดย่อย"
            ? "ชำระแล้ว"
            : d.status === "approved"
              ? "รอชำระ"
              : "ยังไม่ชำระ",
      };
    });
  const inc: LedgerIncome[] = [];
  for (const p of payments) {
    const d = p.data;
    if (d.direction !== "income" || !inRange(d.date)) continue;
    const amount = Number(d.amount) || 0,
      inv = d.invoiceId ? invoiceById.get(String(d.invoiceId)) : undefined,
      rate = inv ? Number(inv.data.vat) || 0 : 0,
      vat = r2((amount * rate) / (100 + rate));
    inc.push({
      id: p.id, kind: "payments", date: String(d.date).slice(0, 10), name: String(d.name || ""),
      customer: inv ? customerName.get(String(inv.data.customerId)) || "" : "", method: String(d.method || ""),
      reference: String(d.reference || ""), invoice: inv ? String(inv.data.name || "") : "",
      amount: r2(amount), vat, base: r2(amount - vat), notes: String(d.notes || ""),
    });
  }
  for (const s of saleRows) {
    const d = s.data;
    if (d.status !== "confirmed" || !inRange(d.date)) continue;
    const amount = r2(Number(d.amount) || 0);
    inc.push({
      id: s.id, kind: "sales", date: String(d.date).slice(0, 10), name: String(d.name || ""),
      customer: customerName.get(String(d.customerId)) || "", method: String(d.channel || ""), reference: "", invoice: "",
      amount, vat: 0, base: amount, notes: String(d.notes || ""),
    });
  }
  const byDate = (a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date);
  return { from, to, expenses: exp.sort(byDate), income: inc.sort(byDate), salesIncluded: sales };
}
