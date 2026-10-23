// Thai expense tax math: VAT (included / excluded / none) and withholding tax on the pre-VAT amount.
import { VAT } from "./billing";
import type { Line } from "./catalog";

export const vatModes = { excluded: "ยังไม่รวม VAT", included: "รวม VAT แล้ว", none: "ไม่มี VAT" } as const;
export type VatMode = keyof typeof vatModes;
export const whtRates = [0, 1, 2, 3, 5] as const;
/** Only a full tax invoice lets the buyer claim input VAT; on anything else the VAT is part of the cost. */
export const FULL_TAX_INVOICE = "ใบกำกับภาษีเต็มรูป";

const round = (n: number) => Math.round(n * 100) / 100;

/** amount = the figure printed on the document; returns base, VAT, WHT, what is paid out, claimable VAT and the booked cost. */
export function computeExpense(amount: number, vatMode: VatMode = "none", whtRate = 0, docType = FULL_TAX_INVOICE) {
  const a = Math.max(0, Number(amount) || 0);
  const base = vatMode === "included" ? round(a / (1 + VAT)) : a;
  const vat = vatMode === "none" ? 0 : vatMode === "included" ? round(a - base) : round(a * VAT);
  const gross = round(base + vat);
  const wht = round((base * (Number(whtRate) || 0)) / 100);
  const claimable = docType === FULL_TAX_INVOICE ? vat : 0;
  return { base, vat, gross, wht, net: round(gross - wht), claimable, cost: round(gross - claimable) };
}

/** Sum of an item list as printed (same VAT basis as the document amount). */
export const linesTotal = (lines: Line[] | undefined) =>
  round((lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));

/** True when the item list does not add up to the document amount (shown as a red warning). */
export const linesMismatch = (lines: Line[] | undefined, amount: number) =>
  !!lines?.length && Math.abs(linesTotal(lines) - (Number(amount) || 0)) > 0.01;

/** Juristic payees are filed on ภ.ง.ด.53, individuals on ภ.ง.ด.3. */
export const whtForm = (taxId: string | undefined, rate: number) =>
  !rate ? "" : /^0\d{12}$/.test(String(taxId || "").replace(/\D/g, "")) ? "ภ.ง.ด.53" : "ภ.ง.ด.3";

type Row = { data: Record<string, unknown> };
/** Rows without a review status predate the accounting page: a pending one still waits for review. */
export const awaitingReview = (d: Record<string, unknown>) =>
  d.reviewStatus ? d.reviewStatus === "รอตรวจ" : d.status === "pending";

export const expenseCalc = (d: Record<string, unknown>) =>
  computeExpense(Number(d.amount), (d.vatMode as VatMode) || "none", Number(d.whtRate) || 0, String(d.docType || ""));

/**
 * Summary cards for the accounting page: this month's spend, input VAT claimable on ภ.พ.30 and WHT to remit
 * (reviewed documents only), documents waiting review, and all-time spend per project for the budget bars.
 */
export function expenseSummary(rows: Row[], month = new Date().toISOString().slice(0, 7)) {
  let total = 0, vat = 0, wht = 0, pending = 0;
  const byProject: Record<string, number> = {};
  for (const { data: d } of rows) {
    const c = expenseCalc(d);
    if (awaitingReview(d)) pending++;
    if (d.status === "rejected") continue;
    const p = String(d.projectId || "");
    if (p) byProject[p] = round((byProject[p] || 0) + c.gross);
    if (!String(d.date || "").startsWith(month)) continue;
    total += c.gross;
    if (awaitingReview(d)) continue;
    vat += c.claimable;
    wht += c.wht;
  }
  return { total: round(total), vat: round(vat), wht: round(wht), pending, byProject };
}
