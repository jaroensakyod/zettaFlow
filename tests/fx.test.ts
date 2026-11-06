import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFx, formatMoney, isForeign } from "../src/lib/fx";

test("a USD expense keeps its figure and is saved in baht at the given rate", async () => {
  const d = (await applyFx("expenses", { currency: "USD", amountForeign: 11.17, fxRate: 32.5, amount: 11.17, date: "2026-11-05" })) as Record<string, number>;
  assert.equal(d.amountForeign, 11.17);
  assert.equal(d.fxRate, 32.5);
  assert.equal(d.amount, 363.03);
});

test("only one figure read from a foreign document is taken as that document's amount", async () => {
  const d = (await applyFx("expenses", { currency: "EUR", amount: 10, fxRate: 38 })) as Record<string, number>;
  assert.equal(d.amountForeign, 10);
  assert.equal(d.amount, 380);
});

test("a baht expense drops the foreign fields; other pages are untouched", async () => {
  const d = (await applyFx("expenses", { currency: "THB", amount: 50, amountForeign: 1, fxRate: 2 })) as Record<string, unknown>;
  assert.deepEqual(d, { amount: 50 });
  const other = { currency: "USD", amount: 1 };
  assert.equal(await applyFx("sales", other), other);
});

test("money is shown with the document's own symbol", () => {
  assert.equal(formatMoney(11.17, "USD"), "$11.17");
  assert.equal(formatMoney(1234.5, "THB"), "฿1,234.50");
  assert.equal(formatMoney(12.5, "SGD"), "SGD 12.50");
  assert.equal(isForeign("THB"), false);
  assert.equal(isForeign(""), false);
  assert.equal(isForeign("USD"), true);
});
