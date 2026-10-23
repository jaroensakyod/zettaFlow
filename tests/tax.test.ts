import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExpense, whtForm, expenseSummary } from "../src/lib/tax";

test("VAT included / excluded / none with withholding on the pre-VAT base", () => {
  assert.deepEqual(computeExpense(10700, "included", 3), { base: 10000, vat: 700, gross: 10700, wht: 300, net: 10400 });
  assert.deepEqual(computeExpense(10000, "excluded", 3), { base: 10000, vat: 700, gross: 10700, wht: 300, net: 10400 });
  assert.deepEqual(computeExpense(5000, "none", 1), { base: 5000, vat: 0, gross: 5000, wht: 50, net: 4950 });
  assert.deepEqual(computeExpense(2000, "excluded", 5), { base: 2000, vat: 140, gross: 2140, wht: 100, net: 2040 });
  assert.equal(computeExpense(-5).gross, 0);
});

test("WHT form follows payee type", () => {
  assert.equal(whtForm("0105556012345", 3), "ภ.ง.ด.53");
  assert.equal(whtForm("1-1001-00000-00-1", 3), "ภ.ง.ด.3");
  assert.equal(whtForm("0105556012345", 0), "");
});

test("monthly summary counts only tax invoices for claimable VAT", () => {
  const s = expenseSummary(
    [
      { data: { amount: 10700, vatMode: "included", whtRate: "3", docType: "ใบกำกับภาษี", date: "2026-10-02", status: "approved", projectId: "p1" } },
      { data: { amount: 1070, vatMode: "included", docType: "ใบเสร็จ", date: "2026-10-03", status: "pending" } },
      { data: { amount: 999, date: "2026-09-30", status: "paid" } },
      { data: { amount: 500, date: "2026-10-04", status: "rejected" } },
    ],
    "2026-10",
  );
  assert.deepEqual(s, { total: 11770, vat: 700, wht: 300, pending: 1, byProject: { p1: 10700 } });
});
