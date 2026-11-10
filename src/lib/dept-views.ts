// Read-only department pages built from existing records: monthly tax summary and an expiry tracker.
import { allEntities } from "./data";
import { assert, canRead, canWrite } from "./domain";
import { demoRead } from "./demo";
import { files } from "./files";
import { issuedAll, docUrl } from "./documents";
import { supabaseServer } from "./supabase/server";
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
  let pipeline: { quotesSent: SalesStage; quotesAccepted: SalesStage; ordersToInvoice: SalesStage; ordersUnpaid: SalesStage } | null = null;
  if (canRead(ctx, "Sales")) {
    const [quotes, orders, invoices] = await Promise.all([allEntities(ctx, "quotations", 5000), allEntities(ctx, "sales_orders", 5000), allEntities(ctx, "invoices", 5000)]);
    const invoiced = (id: string) => invoices.some((i) => String(i.data.description || "").includes("#" + id.slice(0, 8)));
    const total = (kind: string, d: Record<string, unknown>) => catalog[kind].computed?.total?.calc(d) || 0,
      add = (st: SalesStage, v: number) => ((st.count += 1), (st.amount = r2(st.amount + v)));
    const converted = new Set(orders.map((o) => String(o.data.quotationId || "")));
    pipeline = { quotesSent: { count: 0, amount: 0 }, quotesAccepted: { count: 0, amount: 0 }, ordersToInvoice: { count: 0, amount: 0 }, ordersUnpaid: { count: 0, amount: 0 } };
    for (const q of quotes) {
      if (q.data.status === "ส่งแล้ว") add(pipeline.quotesSent, total("quotations", q.data));
      else if (q.data.status === "ตอบรับ" && !converted.has(q.id) && !invoiced(q.id)) add(pipeline.quotesAccepted, total("quotations", q.data));
    }
    for (const o of orders) {
      // Paid on the order itself (platform / transfer): no invoice needed.
      const paid = o.data.payStatus === "ชำระแล้ว" || !!o.data.paymentId;
      if (o.data.status !== "ยกเลิก" && !paid) add(pipeline.ordersUnpaid, total("sales_orders", o.data));
      if (!paid && ["รอดำเนินการ", "กำลังจัดส่ง", "ส่งแล้ว"].includes(String(o.data.status))) add(pipeline.ordersToInvoice, total("sales_orders", o.data));
    }
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

export type PayState = "ชำระแล้ว" | "รอชำระ" | "ยังไม่ชำระ";
export type LedgerExpense = {
  id: string; date: string; code: string; name: string; category: string; payee: string; docType: string; docNo: string;
  base: number; vat: number; claimable: number; gross: number; wht: number; whtForm: string; net: number;
  status: string; pending: boolean; projectId: string; receiptId: string; notes: string;
  /** The project's code — for a job won by quotation, the quotation's code. */
  project: string; projectName: string; payState: PayState; payStatus: string;
};
export type LedgerIncome = {
  id: string; kind: "payments" | "sales" | "invoices"; date: string; docNo: string; name: string; customer: string; method: string;
  reference: string; invoice: string; amount: number; vat: number; base: number; notes: string;
  project: string; projectName: string; payState: PayState;
  /** invoices only: what is still owed (the row is a reminder, not money received). */
  owed: number; dueDate: string;
};
// The end of the id: unique even for the demo company, whose ids share their first part.
const sysRef = (id: string) => "#" + id.slice(-8);
/** Every expense and every income in a date range, with the tax on each row — the รายรับ / ค่าใช้จ่าย summary pages.
 *  Both lists show: document no · date · item · project (approved quotation code) · net · payment status. */
export async function ledger(ctx: Context, from: string, to: string) {
  assert(canRead(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  assert(iso.test(from) && iso.test(to) && from <= to, "ช่วงวันที่ไม่ถูกต้อง");
  const inRange = (d: unknown) => {
    const s = String(d || "").slice(0, 10);
    return iso.test(s) && s >= from && s <= to;
  };
  const sales = canRead(ctx, "Sales");
  type Rows = Awaited<ReturnType<typeof allEntities>>;
  const none = Promise.resolve([] as Rows);
  const [expenses, payments, invoices, saleRows, customers, orders, quotes, projects] = await Promise.all([
    allEntities(ctx, "expenses", 5000),
    allEntities(ctx, "payments", 5000),
    allEntities(ctx, "invoices", 5000),
    sales ? allEntities(ctx, "sales", 5000) : none,
    sales ? allEntities(ctx, "customers", 5000) : none,
    sales ? allEntities(ctx, "sales_orders", 5000) : none,
    sales ? allEntities(ctx, "quotations", 5000) : none,
    allEntities(ctx, "projects", 5000).catch(() => [] as Rows),
  ]);
  const projectOf = (id: unknown) => {
    const p = projects.find((x) => x.id === id);
    return p ? { project: String(p.data.code || p.data.name || ""), projectName: String(p.data.name || "") } : null;
  };
  const customerName = new Map(customers.map((c) => [c.id, String(c.data.name || "")]));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  type Row = Rows[number];
  // invoice → the quotation it was made from (directly, or through a sales order) by the "#id" the conversion writes
  const quoteOfInvoice = (inv: Row) => {
    const text = String(inv.data.description || "");
    const so = orders.find((o) => text.includes("#" + o.id.slice(0, 8)));
    const q = quotes.find((x) => text.includes("#" + x.id.slice(0, 8))) || (so && quotes.find((x) => x.id === so.data.quotationId));
    return q ? String(q.data.code || q.data.name || "") : "";
  };
  const invoiceProject = (inv: Row) => projectOf(inv.data.projectId) || { project: quoteOfInvoice(inv), projectName: "" };
  const exp: LedgerExpense[] = expenses
    .filter((e) => e.data.status !== "rejected" && inRange(e.data.date))
    .map((e) => {
      const d = e.data,
        c = expenseCalc(d),
        p = projectOf(d.projectId);
      return {
        id: e.id, date: String(d.date).slice(0, 10), code: String(d.code || ""), name: String(d.name || ""),
        category: String(d.category || ""), payee: String(d.payee || ""), docType: String(d.docType || ""), docNo: String(d.docNo || ""),
        base: c.base, vat: c.vat, claimable: c.claimable, gross: c.gross, wht: c.wht,
        whtForm: whtForm(String(d.taxId || ""), Number(d.whtRate) || 0), net: c.net,
        status: String(d.status || ""), pending: awaitingReview(d), projectId: String(d.projectId || ""),
        receiptId: String(d.receiptId || ""), notes: String(d.notes || ""),
        project: p?.project || "", projectName: p?.projectName || "",
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
  const received = new Map<string, number>();
  for (const p of payments)
    if (p.data.direction === "income" && p.data.invoiceId)
      received.set(String(p.data.invoiceId), (received.get(String(p.data.invoiceId)) || 0) + (Number(p.data.amount) || 0));
  for (const p of payments) {
    const d = p.data;
    if (d.direction !== "income" || !inRange(d.date)) continue;
    const amount = Number(d.amount) || 0,
      inv = d.invoiceId ? invoiceById.get(String(d.invoiceId)) : undefined,
      rate = inv ? Number(inv.data.vat) || 0 : 0,
      vat = r2((amount * rate) / (100 + rate)),
      // Recorded from a sales order (บันทึกการชำระ): show the order's number, customer and project.
      order = orders.find((o) => o.data.paymentId === p.id),
      pr = inv ? invoiceProject(inv) : order ? projectOf(order.data.projectId) : null;
    inc.push({
      id: p.id, kind: "payments", date: String(d.date).slice(0, 10),
      docNo: inv ? String(inv.data.name || "") : order ? String(order.data.code || order.data.name || "") : String(d.reference || "") || sysRef(p.id), name: String(d.name || ""),
      customer: inv ? customerName.get(String(inv.data.customerId)) || "" : order ? customerName.get(String(order.data.customerId)) || "" : "", method: String(d.method || ""),
      reference: String(d.reference || ""), invoice: inv ? String(inv.data.name || "") : "",
      amount: r2(amount), vat, base: r2(amount - vat), notes: String(d.notes || ""),
      project: pr?.project || "", projectName: pr?.projectName || "", payState: "ชำระแล้ว", owed: 0, dueDate: "",
    });
  }
  for (const s of saleRows) {
    const d = s.data;
    if (d.status !== "confirmed" || !inRange(d.date)) continue;
    const amount = r2(Number(d.amount) || 0),
      p = projectOf(d.projectId);
    inc.push({
      id: s.id, kind: "sales", date: String(d.date).slice(0, 10), docNo: String(d.code || "") || sysRef(s.id), name: String(d.name || ""),
      customer: customerName.get(String(d.customerId)) || "", method: String(d.channel || ""), reference: "", invoice: "",
      amount, vat: 0, base: amount, notes: String(d.notes || ""),
      project: p?.project || "", projectName: p?.projectName || "", payState: "ชำระแล้ว", owed: 0, dueDate: "",
    });
  }
  // Invoices dated in the period that are not fully paid: listed so the page shows what is still to come in.
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  for (const i of invoices) {
    const d = i.data;
    if (!inRange(d.date)) continue;
    const sub = Number(d.subtotal) || 0,
      vat = r2((sub * (Number(d.vat) || 0)) / 100),
      total = r2(sub + vat),
      owed = r2(Math.max(0, total - (received.get(i.id) || 0)));
    if (owed <= 0) continue;
    const pr = invoiceProject(i);
    inc.push({
      id: i.id, kind: "invoices", date: String(d.date).slice(0, 10), docNo: String(d.name || "") || sysRef(i.id),
      name: String(d.description || d.name || "ใบแจ้งหนี้"), customer: customerName.get(String(d.customerId)) || "", method: "",
      reference: "", invoice: String(d.name || ""), amount: total, vat, base: sub, notes: "",
      project: pr.project, projectName: pr.projectName,
      // Past its due date → not paid (orange); otherwise still waiting for the customer (grey).
      payState: d.dueDate && String(d.dueDate) < today ? "ยังไม่ชำระ" : "รอชำระ",
      owed, dueDate: String(d.dueDate || ""),
    });
  }
  const byDate = (a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date);
  return { from, to, expenses: exp.sort(byDate), income: inc.sort(byDate), salesIncluded: sales };
}

/** receipt = ใบเสร็จ, wht = หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ), slip = สลิปโอนเงิน — told apart by the name prefix
 *  the detail window gives a file when it is attached ("ใบเสร็จ - …", "หัก ณ ที่จ่าย - …", "สลิป - …"). */
export type DetailFile = { id: string; name: string; mime: string; role: "slip" | "receipt" | "wht" | "other" };
export type LedgerDetail = {
  createdAt: string;
  updatedAt: string;
  /** Who recorded it: the member, and the LINE group / sender when it came from LINE. */
  recorder: string;
  line: { group: string; sender: string } | null;
  /** The company account money came into (income) — from the company profile. */
  account: { bank: string; number: string; name: string; type: string; promptPay: string } | null;
  files: DetailFile[];
  /** Income: the receipt we issue to the customer. Expenses: the receipt we got from the payee. */
  receipt: { issued: { number: string; date: string } | null; url: string; hasFile: boolean; canIssue: boolean };
};
/** The full picture behind one row of the รายรับ / ค่าใช้จ่าย list (opened from the list). */
export async function ledgerDetail(ctx: Context, kind: string, id: string): Promise<LedgerDetail> {
  assert(canRead(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  assert(["payments", "expenses", "invoices", "sales", "sales_orders"].includes(kind), "ประเภทไม่ถูกต้อง");
  const rows = await allEntities(ctx, kind, 5000);
  const e = rows.find((r) => r.id === id);
  assert(e, "ไม่พบรายการ", 404);
  const raw = e as unknown as { created_by?: string; created_at?: string; updated_at?: string };
  // Recorder's name from the company's members (falls back quietly when the list is not readable).
  let recorder = "";
  if (raw.created_by) {
    if (ctx.demo) recorder = (await demoRead()).members.find((m) => m.user_id === raw.created_by)?.name || "";
    else {
      const sb = await supabaseServer();
      const { data } = await sb.from("memberships").select("name,email").eq("company_id", ctx.company.id).eq("user_id", raw.created_by).maybeSingle();
      recorder = data ? String(data.name || data.email || "") : "";
    }
    if (!recorder && raw.created_by === ctx.user.id) recorder = ctx.member.name || ctx.user.email;
  }
  const d = e.data;
  const line = d.sourceVia === "LINE" ? { group: String(d.sourceGroup || ""), sender: String(d.sourceSender || "") } : null;
  const p = ctx.company.profile || {};
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
  const account =
    kind === "payments" || kind === "sales" || kind === "invoices"
      ? {
          bank: str(p.bank) || str(p.bankName),
          number: str(p.bankAccount),
          name: str(p.bankAccountName),
          type: str(p.bankAccountType),
          promptPay: str(p.promptPay),
        }
      : null;
  const list = (await files(ctx, id)) as { id: string; name: string; mime: string }[];
  const role = (f: { id: string; name: string }): DetailFile["role"] =>
    /^ใบเสร็จ/.test(f.name) || f.id === d.receiptId ? "receipt" : /^(หัก ณ ที่จ่าย|50 ทวิ)/.test(f.name) ? "wht" : /^สลิป/.test(f.name) ? "slip" : "other";
  let out: DetailFile[] = list.map((f) => ({ id: f.id, name: f.name, mime: f.mime, role: role(f) }));
  // A payment's first picture with no label is the transfer slip (what LINE and the old form attached).
  if ((kind === "payments" || kind === "sales_orders") && !out.some((f) => f.role === "slip")) {
    const first = out.find((f) => f.role === "other" && f.mime.startsWith("image/"));
    if (first) first.role = "slip";
  }
  // An expense's own document (the receipt AI read) is its receipt.
  if (kind === "expenses" && !out.some((f) => f.role === "receipt")) {
    const first = out.find((f) => f.role === "other");
    if (first) first.role = "receipt";
  }
  out = out.sort((a, b) => a.role.localeCompare(b.role));
  const docKind = kind === "invoices" ? "tax_invoice" : "receipt";
  const issued = kind === "payments" || kind === "invoices" ? (await issuedAll(ctx)).get(`${docKind}:${id}`) || null : null;
  return {
    createdAt: str(raw.created_at),
    updatedAt: str(raw.updated_at),
    recorder,
    line,
    account,
    files: out,
    receipt: {
      issued: issued ? { number: issued.number, date: issued.date } : null,
      url: kind === "payments" || kind === "invoices" ? docUrl(docKind, id) : "",
      hasFile: out.some((f) => f.role === "receipt"),
      canIssue: canWrite(ctx, "Finance") && (kind === "payments" || kind === "invoices"),
    },
  };
}
