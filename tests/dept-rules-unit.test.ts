import { test } from "node:test";
import assert from "node:assert/strict";
import { convertData, fitToPage, derive, needsApprover, stockEffect, stockLocked, conversions } from "../src/lib/dept-rules";
import { catalog } from "../src/lib/catalog";
import { validateEntity } from "../src/lib/domain";

const cust = "11111111-1111-4111-8111-111111111111";
test("every conversion produces a record its target page accepts, and is recognised once created", () => {
  const sources = {
    quotations: { name: "บูธ", customerId: cust, date: "2026-10-01", lines: [{ name: "บูธ", qty: 1, price: 1000 }], vatMode: "excluded", status: "ตอบรับ", code: "QT-69-0001" },
    sales_orders: { name: "บูธ", customerId: cust, date: "2026-10-01", subtotal: 1070, vatMode: "included", status: "ส่งแล้ว", code: "SO-69-0001" },
    bills: { name: "ขนส่ง", supplierId: cust, date: "2026-10-01", dueDate: "2026-10-31", amount: 10700, whtRate: "3", status: "จ่ายแล้ว" },
    recruitment: { name: "สมหญิง", position: "บัญชี", expectedSalary: 25000, status: "รับเข้าทำงาน" },
  } as Record<string, Record<string, unknown>>;
  for (const c of conversions) {
    const src = { id: "abcdef12-0000-4000-8000-000000000000", kind: c.from, data: sources[c.from] };
    const { data, exists } = convertData(src);
    const fitted = fitToPage(c.to, data);
    validateEntity(c.to, fitted);
    assert.ok(exists({ id: "x", kind: c.to, data: fitted }), c.from + " → " + c.to + " should be detected as done");
    assert.ok(!exists({ id: "x", kind: c.to, data: {} }));
  }
  const inv = fitToPage("invoices", convertData({ id: "abcdef12-0000-4000-8000-000000000000", kind: "sales_orders", data: sources.sales_orders }).data);
  assert.deepEqual([inv.subtotal, inv.vat], [1000, 7]);
  assert.equal(fitToPage("payments", convertData({ id: "abcdef12-0000-4000-8000-000000000000", kind: "bills", data: sources.bills }).data).amount, 10400);
});

test("stored figures match the table columns", () => {
  for (const kind of Object.keys(catalog))
    for (const [key, col] of Object.entries(catalog[kind].computed || {})) {
      const sample = { target: 200, actual: 150, reach: 1000, engagement: 50, budget: 500, spent: 120, systemQty: 10, countedQty: 8, amount: 10700, whtRate: "3", checkIn: "09:10", checkOut: "17:40", subtotal: 1000, vatMode: "excluded", discount: 100 };
      assert.equal(derive(kind, sample)[key], col.calc(sample), kind + "." + key);
    }
});

test("approver statuses, stock effects and locks", () => {
  assert.ok(needsApprover("stock_issues", "จ่ายของแล้ว", "รออนุมัติ"));
  assert.ok(!needsApprover("stock_issues", "จ่ายของแล้ว", "จ่ายของแล้ว"));
  assert.ok(!needsApprover("stock_issues", "รออนุมัติ"));
  assert.deepEqual(stockEffect("stock_issues", { status: "จ่ายของแล้ว", quantity: 3 }, "อนุมัติแล้ว", 10), { type: "out", quantity: 3 });
  assert.equal(stockEffect("stock_issues", { status: "จ่ายของแล้ว", quantity: 3 }, "จ่ายของแล้ว", 10), null);
  assert.deepEqual(stockEffect("stock_counts", { status: "ปรับยอดแล้ว", countedQty: 12 }, "นับแล้ว", 10), { type: "in", quantity: 2 });
  assert.equal(stockEffect("stock_counts", { status: "ปรับยอดแล้ว", countedQty: 10 }, "นับแล้ว", 10), null);
  assert.ok(stockLocked("stock_counts", "ปรับยอดแล้ว"));
});
