// Double-entry rules for expenses, shared by the server (posting) and the accounting page (journal preview).
import { expenseCalc, whtForm } from "./tax";

export type Account = { code: string; name: string; type: string; category: string | null };
export type CostCenter = { code: string; name: string; kind: string };
export type JournalLine = { account: string; debit: number; credit: number; projectId?: string; costCenter?: string };
export type WhtCertificate = {
  entity_id: string;
  year: number;
  seq: number;
  form: string;
  payee: string;
  tax_id: string | null;
  base: number;
  rate: number;
  amount: number;
  paid_on: string;
};
export type AccountingState = {
  journals: { entity_id: string; date: string; lines: JournalLine[] }[];
  wht: WhtCertificate[];
  counters: Record<string, number>;
};

/** Mirrors seed_accounts() in 0021_accounting.sql (used by the demo and as a fallback label source). */
export const defaultAccounts: Account[] = [
  ["1111", "เงินสด", "asset", null],
  ["1112", "เงินฝากธนาคาร", "asset", null],
  ["1113", "เงินสดย่อย", "asset", null],
  ["1154", "ภาษีซื้อ", "asset", null],
  ["1160", "เงินมัดจำจ่าย", "asset", "ค่ามัดจำ"],
  ["2111", "เจ้าหนี้การค้า", "liability", null],
  ["2132", "ภาษีหัก ณ ที่จ่ายค้างจ่าย", "liability", null],
  ["5010", "ซื้อสินค้าและวัตถุดิบ", "expense", "จัดซื้อ"],
  ["5110", "ค่าแรงและค่าจ้าง", "expense", "บุคลากร"],
  ["5210", "ค่าเช่า", "expense", "ค่าเช่า"],
  ["5220", "ค่าไฟฟ้าและสาธารณูปโภค", "expense", "ค่าไฟฟ้า"],
  ["5230", "ค่าบริการ", "expense", "ค่าบริการ"],
  ["5240", "ค่าพรมและวัสดุตกแต่ง", "expense", "ค่าพรม"],
  ["5250", "ค่าขนส่ง", "expense", "ขนส่ง"],
  ["5310", "ค่าโฆษณาและการตลาด", "expense", "การตลาด"],
  ["5900", "ค่าใช้จ่ายอื่น", "expense", "อื่นๆ"],
].map(([code, name, type, category]) => ({ code: code!, name: name!, type: type!, category }));
const INPUT_VAT = "1154",
  WHT_PAYABLE = "2132",
  PAYABLES = "2111";
const paidFrom: Record<string, string> = { โอนแล้ว: "1112", เงินสดย่อย: "1113" };

/** The expense account for a record: the chosen chart code, else the one mapped to its category, else "other". */
export const expenseAccount = (d: Record<string, unknown>, accounts: Account[]) =>
  (d.accountCode && accounts.some((a) => a.code === d.accountCode) ? String(d.accountCode) : "") ||
  accounts.find((a) => a.category === d.category)?.code ||
  "5900";

/** Double entry for one expense document. Debits always equal credits (amounts are already rounded to satang). */
export function buildJournal(d: Record<string, unknown>, accounts: Account[] = defaultAccounts) {
  const c = expenseCalc(d),
    tag = { projectId: String(d.projectId || "") || undefined, costCenter: String(d.costCenter || "") || undefined };
  const lines: JournalLine[] = [
    { account: expenseAccount(d, accounts), debit: c.cost, credit: 0, ...tag },
    { account: INPUT_VAT, debit: c.claimable, credit: 0, ...tag },
    { account: paidFrom[String(d.payStatus)] || PAYABLES, debit: 0, credit: c.net, ...tag },
    { account: WHT_PAYABLE, debit: 0, credit: c.wht, ...tag },
  ].filter((l) => l.debit > 0 || l.credit > 0);
  const debit = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100),
    credit = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100);
  const rate = Number(d.whtRate) || 0;
  return {
    lines,
    balanced: debit === credit && debit > 0,
    wht: rate
      ? {
          form: whtForm(String(d.taxId || ""), rate),
          payee: String(d.payee || d.name || ""),
          taxId: String(d.taxId || ""),
          base: c.base,
          rate,
          amount: c.wht,
        }
      : null,
  };
}
