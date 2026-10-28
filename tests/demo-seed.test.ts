import { test } from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "../src/lib/demo";
import { catalog } from "../src/lib/catalog";
import { validateEntity } from "../src/lib/domain";

test("the demo company fills every page with records the real forms would accept", () => {
  const s = seedDemo();
  const kinds = new Set(s.entities.map((e) => e.kind));
  for (const kind of Object.keys(catalog)) assert.ok(kinds.has(kind), "no demo rows for " + kind);
  for (const e of s.entities) {
    try {
      validateEntity(e.kind, e.data);
    } catch (err) {
      assert.fail(`${e.kind} "${e.data.name}": ${(err as Error).message}`);
    }
  }
  const ids = new Set(s.entities.map((e) => e.id));
  for (const e of s.entities)
    for (const f of catalog[e.kind].fields)
      if (f.type === "relation" && e.data[f.key]) assert.ok(ids.has(String(e.data[f.key])), `${e.kind}.${f.key} points nowhere`);
  // Enough history for trends, and the situations น้องโฟลว์ should notice.
  const sales = s.entities.filter((e) => e.kind === "sales" && e.data.status === "confirmed");
  assert.ok(sales.length > 200);
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  assert.ok(s.entities.some((e) => e.kind === "invoices" && e.data.status !== "paid" && String(e.data.dueDate) < today), "an overdue invoice");
  assert.ok(s.entities.some((e) => e.kind === "products" && Number(e.data.stock) <= Number(e.data.reorderLevel)), "a low-stock product");
  assert.ok(s.entities.some((e) => e.kind === "tasks" && e.data.status !== "done" && String(e.data.dueDate) < today), "an overdue task");
});

test("the demo seed is deterministic for the public showcase", () => {
  let a = 0,
    b = 0;
  const one = seedDemo(() => "20000000-0000-4000-8000-" + String(++a).padStart(12, "0"));
  const two = seedDemo(() => "20000000-0000-4000-8000-" + String(++b).padStart(12, "0"));
  assert.deepEqual(
    one.entities.map((e) => e.data),
    two.entities.map((e) => e.data),
  );
});
