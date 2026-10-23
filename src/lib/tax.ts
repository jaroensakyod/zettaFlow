// Thai expense tax math: VAT (included / excluded / none) and withholding tax on the pre-VAT amount.
import { VAT } from "./billing";

export const vatModes = { included: "รวม VAT แล้ว", excluded: "ยังไม่รวม VAT", none: "ไม่มี VAT" } as const;
export type VatMode = keyof typeof vatModes;
export const whtRates = [0, 1, 2, 3, 5] as const;

const round = (n: number) => Math.round(n * 100) / 100;

/** amount = the figure printed on the document; returns base, VAT, WHT and what is actually paid out. */
export function computeExpense(amount: number, vatMode: VatMode = "none", whtRate = 0) {
  const a = Math.max(0, Number(amount) || 0);
  const base = vatMode === "included" ? round(a / (1 + VAT)) : a;
  const vat = vatMode === "none" ? 0 : vatMode === "included" ? round(a - base) : round(a * VAT);
  const gross = round(base + vat);
  const wht = round((base * (Number(whtRate) || 0)) / 100);
  return { base, vat, gross, wht, net: round(gross - wht) };
}

/** Juristic payees are filed on ภ.ง.ด.53, individuals on ภ.ง.ด.3. */
export const whtForm = (taxId: string | undefined, rate: number) =>
  !rate ? "" : /^0\d{12}$/.test(String(taxId || "").replace(/\D/g, "")) ? "ภ.ง.ด.53" : "ภ.ง.ด.3";

type Row = { data: Record<string, unknown> };
/** Summary cards for the expense page (current month, claimable input VAT, WHT to remit, waiting review). */
export function expenseSummary(rows: Row[], month = new Date().toISOString().slice(0, 7)) {
  let total = 0, vat = 0, wht = 0, pending = 0;
  const byProject: Record<string, number> = {};
  for (const { data: d } of rows) {
    const c = computeExpense(Number(d.amount), (d.vatMode as VatMode) || "none", Number(d.whtRate) || 0);
    if (d.status === "pending") pending++;
    if (d.status === "rejected" || !String(d.date || "").startsWith(month)) continue;
    total += c.gross;
    if (d.docType === "ใบกำกับภาษี") vat += c.vat;
    wht += c.wht;
    const p = String(d.projectId || "");
    if (p) byProject[p] = round((byProject[p] || 0) + c.gross);
  }
  return { total: round(total), vat: round(vat), wht: round(wht), pending, byProject };
}
