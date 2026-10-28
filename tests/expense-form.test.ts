import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { lineAmount, catalog } from "../src/lib/catalog";
import { validateEntity } from "../src/lib/domain";
import { linesTotal, computeExpense } from "../src/lib/tax";
import { departmentOf, activeEntry, departmentMenu, sidebarOf, baseView } from "../src/lib/departments";

test("expense rows: per-row discount, bill discount and VAT add up like the form", () => {
  const lines = [
    { name: "ค่าน้ำมันรถ", qty: 20, price: 35, discount: 0, discountType: "percent" as const },
    { name: "ค่าอาหารเลี้ยงลูกค้า", qty: 5, price: 500, discount: 100, discountType: "amount" as const },
    { name: "ค่าที่พัก", qty: 2, price: 1500, discount: 10, discountType: "percent" as const },
  ];
  assert.deepEqual(lines.map(lineAmount), [700, 2400, 2700]);
  assert.equal(lineAmount({ name: "x", qty: 1, price: 50, discount: 80, discountType: "amount" }), 0);
  assert.equal(linesTotal(lines), 5800);
  const calc = computeExpense(5800 - 100, "excluded", 3);
  assert.deepEqual([calc.vat, calc.gross, calc.wht, calc.net], [399, 6099, 171, 5928]);
});

test("expense rows keep their category, unit, currency and discount through validation", () => {
  const data = validateEntity("expenses", {
    name: "ทริปเชียงใหม่",
    category: "ขนส่ง",
    date: "2026-10-28",
    amount: 6000,
    status: "pending",
    code: "EXP-20261028-001",
    payeeType: "บริษัท / Supplier",
    discount: 100,
    discountType: "amount",
    lines: [{ name: "ค่าน้ำมันรถ", qty: 20, price: 35, category: "ค่าเดินทาง", unit: "ลิตร", currency: "THB", discount: 5, discountType: "percent" }],
  });
  assert.deepEqual(data.lines, [{ name: "ค่าน้ำมันรถ", qty: 20, price: 35, category: "ค่าเดินทาง", unit: "ลิตร", currency: "THB", discount: 5, discountType: "percent" }]);
  assert.throws(() => validateEntity("expenses", { name: "x", category: "ขนส่ง", date: "2026-10-28", amount: 1, status: "pending", lines: [{ name: "a", qty: 1, price: 1, discountType: "free" }] }));
});

test("the database migration accepts the same expense fields as the app", async () => {
  const sql = await readFile("supabase/migrations/0024_expense_form.sql", "utf8");
  for (const f of catalog.expenses.fields) assert.ok(sql.includes(`"key":"${f.key}"`), f.key + " missing from 0024");
  for (const k of ["category", "unit", "currency", "discount", "discountType"]) assert.ok(sql.includes(`'${k}',x->'${k}'`), k + " dropped by validate_payload");
});

test("every department page shows its own sidebar; app-wide pages show none", async () => {
  const page = await readFile("src/app/workspace/[view]/page.tsx", "utf8");
  for (const d of departmentMenu)
    for (const i of sidebarOf(d).flatMap((x) => [x, ...(x.children || [])]))
      assert.ok(catalog[baseView(i.view)] || page.includes(`"${baseView(i.view)}"`), "sidebar link has no page: " + i.view);
  assert.equal(departmentOf("expense-new")?.id, "accounting");
  assert.equal(departmentOf("employees")?.id, "hr");
  assert.equal(departmentOf("quotations")?.id, "sales");
  assert.equal(departmentOf("reports?kind=expenses")?.id, "accounting");
  assert.equal(departmentOf("dashboard"), undefined);
  assert.equal(departmentOf("company"), undefined);
  assert.equal(departmentOf("company", "accounting")?.id, "accounting");
  // A page in two departments follows the one the user came from.
  assert.equal(departmentOf("purchases", "admin")?.id, "admin");
  const acc = departmentMenu.find((d) => d.id === "accounting")!;
  assert.equal(activeEntry(acc, "expenses")?.label, "รายการค่าใช้จ่าย");
  assert.equal(activeEntry(acc, "expenses?filter=pending")?.label, "รออนุมัติ");
  assert.equal(activeEntry(acc, "expense-new?id=abc")?.label, "บันทึกค่าใช้จ่าย");
});

test("every หมวดหมู่หลัก has an emoji and books to an account the chart has", async () => {
  const { expenseCategoryGroups, currentExpenseCategories, categoryLabel } = await import("../src/lib/expense-categories");
  const { defaultAccounts, expenseAccount } = await import("../src/lib/ledger");
  assert.equal(currentExpenseCategories.length, new Set(currentExpenseCategories).size, "no duplicate names");
  for (const g of expenseCategoryGroups)
    for (const c of g.items) {
      assert.ok(c.emoji && c.emoji !== c.name, c.name + " has no emoji");
      assert.ok(defaultAccounts.some((a) => a.code === c.account), `${c.name} → ${c.account} is not in the chart`);
      assert.equal(expenseAccount({ category: c.name }, defaultAccounts), c.account);
    }
  assert.equal(categoryLabel("ค่าน้ำมัน/แก๊ส/รถยนต์"), "⛽ ค่าน้ำมัน/แก๊ส/รถยนต์");
  // Older categories still book where they did, and stay valid on records.
  assert.equal(expenseAccount({ category: "ค่าไฟฟ้า" }, defaultAccounts), "5220");
  assert.equal(expenseAccount({ category: "ส่วนตัว", accountCode: "5900" }, defaultAccounts), "5900");
  for (const old of ["ค่ามัดจำ", "บุคลากร", "อื่นๆ"]) assert.ok(catalog.expenses.fields.find((f) => f.key === "category")!.options!.includes(old));
  const sql = await readFile("supabase/migrations/0027_expense_categories.sql", "utf8");
  for (const name of currentExpenseCategories) assert.ok(sql.includes(name), name + " missing from 0027");
  for (const a of defaultAccounts) assert.ok(sql.includes(`'${a.code}'`), a.code + " missing from 0027");
});
