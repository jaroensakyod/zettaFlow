// One catalog for คลังสินค้า and ฝ่ายขาย (src/lib/product-catalog.ts): types, promotions and stock state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { discountPercent, itemType, promoActive, sellPrice, stockState } from "../src/lib/product-catalog";

test("type defaults to สินค้า; services and packages never run out", () => {
  assert.equal(itemType({}), "product");
  assert.equal(itemType({ type: "service" }), "service");
  assert.equal(itemType({ type: "weird" }), "product");
  assert.equal(stockState({ stock: 0 }), "out");
  assert.equal(stockState({ stock: 3, reorderLevel: 5 }), "low");
  assert.equal(stockState({ stock: 9, reorderLevel: 5 }), "ok");
  assert.equal(stockState({ type: "service", stock: 0 }), "ok");
  assert.equal(stockState({ type: "package" }), "ok");
});

test("a promotion counts only below the normal price and until its end date", () => {
  const d = { price: 1000, promoPrice: 790, promoEnds: "2026-12-31" };
  assert.equal(promoActive(d, "2026-11-17"), true);
  assert.equal(sellPrice(d, "2026-11-17"), 790);
  assert.equal(discountPercent(d), 21);
  assert.equal(promoActive(d, "2027-01-01"), false);
  assert.equal(sellPrice(d, "2027-01-01"), 1000);
  assert.equal(promoActive({ price: 1000, promoPrice: 1200 }), false);
  assert.equal(promoActive({ price: 1000, promoPrice: 0 }), false);
  assert.equal(promoActive({ price: 1000, promoPrice: 900 }), true);
});
