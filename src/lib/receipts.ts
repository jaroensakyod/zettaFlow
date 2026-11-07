/**
 * ใบเสร็จรับเงิน page (src/components/receipts-page.tsx): the receipts and tax invoices a company can issue or has issued.
 * Receipts come from income payments (and fully paid invoices that have no payment recorded); tax invoices from invoices.
 * Issued numbers come from one call (issued_documents_list, migration 0047; demo: the accounting counters).
 */
import { assert, canRead, canWrite } from "./domain";
import { allEntities } from "./data";
import { issuedAll, docUrl } from "./documents";
import type { Context, Entity } from "./types";

export type ReceiptRow = {
  kind: "receipt" | "tax_invoice";
  /** Source record (payment or invoice) — the print route id. */
  id: string;
  source: "payment" | "invoice";
  /** Issued number, null = not issued yet (ยังไม่ออกเลข). */
  number: string | null;
  issuedOn: string | null;
  /** Document date: payment date (receipt) or invoice date (tax invoice). */
  date: string;
  customer: string;
  /** Invoice number / payment name it refers to. */
  ref: string;
  amount: number;
  url: string;
};
export type ReceiptsData = { rows: ReceiptRow[]; canIssue: boolean; today: string };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const n = (v: unknown) => Number(v) || 0;

export async function receiptsList(ctx: Context): Promise<ReceiptsData> {
  assert(canRead(ctx, "Finance"), "ไม่มีสิทธิ์ดูเอกสารการเงิน", 403);
  const [invoices, payments, customers, issued] = await Promise.all([
    allEntities(ctx, "invoices"),
    allEntities(ctx, "payments"),
    canRead(ctx, "Sales") ? allEntities(ctx, "customers") : Promise.resolve([] as Entity[]),
    issuedAll(ctx),
  ]);
  const byId = new Map(invoices.map((e) => [e.id, e]));
  const customerName = (id: unknown) => {
    const c = customers.find((x) => x.id === id);
    return c ? s(c.data.company) || s(c.data.name) : "";
  };
  const rows: ReceiptRow[] = [];
  const push = (kind: ReceiptRow["kind"], e: Entity, source: ReceiptRow["source"], r: Pick<ReceiptRow, "date" | "customer" | "ref" | "amount">) => {
    const got = issued.get(`${kind}:${e.id}`) || null;
    rows.push({ kind, id: e.id, source, number: got?.number || null, issuedOn: got?.date || null, url: docUrl(kind, e.id), ...r });
  };
  const paidByPayment = new Set<string>();
  for (const p of payments) {
    if (p.data.direction !== "income") continue;
    const inv = byId.get(s(p.data.invoiceId));
    if (inv) paidByPayment.add(inv.id);
    push("receipt", p, "payment", {
      date: s(p.data.date),
      customer: inv ? customerName(inv.data.customerId) : "",
      ref: inv ? s(inv.data.name) : s(p.data.name),
      amount: n(p.data.amount),
    });
  }
  for (const inv of invoices) {
    const d = inv.data,
      total = d.total !== undefined ? n(d.total) : n(d.subtotal) * (1 + n(d.vat) / 100);
    const common = { customer: customerName(d.customerId), ref: s(d.name), amount: Math.round(total * 100) / 100 };
    // A paid invoice gets its own receipt only when no payment stands for it (or one was already issued from it).
    if (d.status === "paid" && (!paidByPayment.has(inv.id) || issued.has(`receipt:${inv.id}`)))
      push("receipt", inv, "invoice", { ...common, date: s(d.date) });
    push("tax_invoice", inv, "invoice", { ...common, date: s(d.date) });
  }
  rows.sort((a, b) => (b.issuedOn || b.date).localeCompare(a.issuedOn || a.date));
  return { rows, canIssue: canWrite(ctx, "Finance"), today: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10) };
}
