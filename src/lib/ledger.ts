// Double-entry rules for expenses, shared by the server (posting) and the accounting page (journal preview).
import { expenseCalc, whtForm } from "./tax";
import { categoryAccount } from "./expense-categories";

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

/** Mirrors seed_accounts() (migration 0027; used by the demo and as a fallback label source). */
export const defaultAccounts: Account[] = [
  ["1111", "เงินสด", "asset", null],
  ["1112", "เงินฝากธนาคาร", "asset", null],
  ["1113", "เงินสดย่อย", "asset", null],
  ["1154", "ภาษีซื้อ", "asset", null],
  ["1160", "เงินมัดจำจ่าย", "asset", "ค่ามัดจำ"],
  ["1240", "อุปกรณ์สำนักงานและคอมพิวเตอร์", "asset", null],
  ["1250", "เฟอร์นิเจอร์และเครื่องตกแต่ง", "asset", null],
  ["1260", "ยานพาหนะ", "asset", null],
  ["1270", "โปรแกรมคอมพิวเตอร์", "asset", null],
  ["2111", "เจ้าหนี้การค้า", "liability", null],
  ["2132", "ภาษีหัก ณ ที่จ่ายค้างจ่าย", "liability", null],
  ["3120", "เงินถอนส่วนตัว", "equity", null],
  ["5010", "ซื้อสินค้าและวัตถุดิบ", "expense", "จัดซื้อ"],
  ["5020", "สินค้าตัวอย่างและของแจก", "expense", null],
  ["5110", "ค่าแรงและค่าจ้าง", "expense", "บุคลากร"],
  ["5120", "เบี้ยเลี้ยงและสวัสดิการพนักงาน", "expense", null],
  ["5130", "เงินสมทบประกันสังคม", "expense", null],
  ["5140", "ค่านายหน้าและค่าคอมมิชชั่น", "expense", null],
  ["5210", "ค่าเช่า", "expense", "ค่าเช่า"],
  ["5220", "ค่าไฟฟ้าและสาธารณูปโภค", "expense", "ค่าไฟฟ้า"],
  ["5221", "ค่าโทรศัพท์และอินเทอร์เน็ต", "expense", null],
  ["5230", "ค่าบริการ", "expense", "ค่าบริการ"],
  ["5240", "ค่าพรมและวัสดุตกแต่ง", "expense", "ค่าพรม"],
  ["5250", "ค่าขนส่ง", "expense", "ขนส่ง"],
  ["5270", "ค่าเดินทางและที่พัก", "expense", null],
  ["5271", "ค่าน้ำมันและค่าใช้จ่ายยานพาหนะ", "expense", null],
  ["5280", "ค่าซอฟต์แวร์และโปรแกรม", "expense", null],
  ["5290", "วัสดุสำนักงานและเครื่องเขียน", "expense", null],
  ["5310", "ค่าโฆษณาและการตลาด", "expense", "การตลาด"],
  ["5320", "ค่ารับรอง", "expense", null],
  ["5410", "เบี้ยประกันภัย", "expense", null],
  ["5420", "ค่าธรรมเนียมธนาคาร", "expense", null],
  ["5430", "ภาษีและค่าธรรมเนียมราชการ", "expense", null],
  ["5440", "ค่าซ่อมแซมและบำรุงรักษา", "expense", null],
  ["5450", "ดอกเบี้ยจ่าย", "expense", null],
  ["5900", "ค่าใช้จ่ายอื่น", "expense", "อื่นๆ"],
].map(([code, name, type, category]) => ({ code: code!, name: name!, type: type!, category }));
const INPUT_VAT = "1154",
  WHT_PAYABLE = "2132",
  PAYABLES = "2111";
const paidFrom: Record<string, string> = { โอนแล้ว: "1112", เงินสดย่อย: "1113" };

/**
 * The expense account for a record: the chosen chart code, else the account an older category was tagged with,
 * else the default for its หมวดหมู่หลัก (when the company has that account), else "other".
 */
export const expenseAccount = (d: Record<string, unknown>, accounts: Account[]) => {
  const has = (code: string | undefined) => !!code && accounts.some((a) => a.code === code);
  if (has(String(d.accountCode || ""))) return String(d.accountCode);
  const tagged = accounts.find((a) => a.category === d.category)?.code;
  if (tagged) return tagged;
  const mapped = categoryAccount(String(d.category || ""));
  return has(mapped) ? mapped! : "5900";
};

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
