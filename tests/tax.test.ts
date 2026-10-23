import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExpense, whtForm, expenseSummary, linesTotal, linesMismatch } from "../src/lib/tax";
import { buildJournal } from "../src/lib/ledger";

test("VAT included / excluded / none with withholding on the pre-VAT base", () => {
  assert.deepEqual(computeExpense(10700, "included", 3), { base: 10000, vat: 700, gross: 10700, wht: 300, net: 10400, claimable: 700, cost: 10000 });
  assert.deepEqual(computeExpense(10000, "excluded", 3), { base: 10000, vat: 700, gross: 10700, wht: 300, net: 10400, claimable: 700, cost: 10000 });
  assert.deepEqual(computeExpense(5000, "none", 1), { base: 5000, vat: 0, gross: 5000, wht: 50, net: 4950, claimable: 0, cost: 5000 });
  assert.deepEqual(computeExpense(2000, "excluded", 5), { base: 2000, vat: 140, gross: 2140, wht: 100, net: 2040, claimable: 140, cost: 2000 });
  assert.equal(computeExpense(-5).gross, 0);
});

test("an abbreviated tax invoice or plain receipt cannot claim VAT, so the VAT is booked as cost", () => {
  const c = computeExpense(107, "included", 0, "ใบกำกับภาษีอย่างย่อ");
  assert.deepEqual([c.vat, c.claimable, c.cost], [7, 0, 107]);
  assert.equal(computeExpense(107, "included", 0, "ใบเสร็จ").claimable, 0);
});

test("item list total and mismatch warning", () => {
  const lines = [{ name: "A4", qty: 2, price: 120 }, { name: "ปากกา", qty: 3, price: 10.5 }];
  assert.equal(linesTotal(lines), 271.5);
  assert.equal(linesMismatch(lines, 271.5), false);
  assert.equal(linesMismatch(lines, 300), true);
  assert.equal(linesMismatch([], 300), false);
});

test("WHT form follows payee type", () => {
  assert.equal(whtForm("0105556012345", 3), "ภ.ง.ด.53");
  assert.equal(whtForm("1-1001-00000-00-1", 3), "ภ.ง.ด.3");
  assert.equal(whtForm("0105556012345", 0), "");
});

test("monthly summary: VAT and WHT from reviewed full tax invoices, pending by review status, all-time project spend", () => {
  const s = expenseSummary(
    [
      { data: { amount: 10700, vatMode: "included", whtRate: "3", docType: "ใบกำกับภาษีเต็มรูป", date: "2026-10-02", status: "approved", reviewStatus: "บันทึกแล้ว", projectId: "p1" } },
      { data: { amount: 1070, vatMode: "included", docType: "ใบกำกับภาษีเต็มรูป", date: "2026-10-03", status: "pending", reviewStatus: "รอตรวจ" } },
      { data: { amount: 999, date: "2026-09-30", status: "paid", projectId: "p1" } },
      { data: { amount: 500, date: "2026-10-04", status: "rejected" } },
      { data: { amount: 200, date: "2026-10-04", status: "pending" } },
    ],
    "2026-10",
  );
  assert.deepEqual(s, { total: 11970, vat: 700, wht: 300, pending: 2, byProject: { p1: 11699 } });
});

test("journal: petty cash, payables, deposits and the chosen chart code", () => {
  const cash = buildJournal({ amount: 535, vatMode: "included", docType: "ใบกำกับภาษีอย่างย่อ", category: "ขนส่ง", payStatus: "เงินสดย่อย" });
  assert.deepEqual(cash.lines.map((l) => [l.account, l.debit, l.credit]), [["5250", 535, 0], ["1113", 0, 535]]);
  assert.equal(cash.wht, null);
  const deposit = buildJournal({ amount: 20000, category: "ค่ามัดจำ", accountCode: "9999" });
  assert.deepEqual(deposit.lines.map((l) => l.account), ["1160", "2111"]);
  assert.equal(buildJournal({ amount: 100, category: "อื่นๆ", accountCode: "5310" }).lines[0].account, "5310");
  assert.equal(buildJournal({ amount: 0 }).balanced, false);
});
