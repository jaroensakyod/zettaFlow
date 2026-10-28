import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { departmentMenu, baseView, menuViews } from "../src/lib/departments";
import { catalog, docTotal, computeAttendance } from "../src/lib/catalog";
import { templateForPage, mapToTarget } from "../src/lib/line-target";
import { templateSchema, validateEntity } from "../src/lib/domain";

test("every แผนก menu item opens a real page", async () => {
  const page = await readFile("src/app/workspace/[view]/page.tsx", "utf8");
  const items = departmentMenu.flatMap((d) => [d.overview, ...d.items.map((i) => i.view)]);
  assert.equal(departmentMenu.length, 9);
  assert.ok(departmentMenu.every((d) => d.items.length === 6));
  for (const v of items) {
    const key = baseView(v);
    assert.ok(catalog[key] || page.includes(`"${key}"`), "no page for " + v);
  }
  for (const v of menuViews) assert.ok(page.includes(`"${v}"`), v + " missing from the allowlist");
});

test("department page maths", () => {
  assert.equal(docTotal({ lines: [{ name: "a", qty: 2, price: 500 }], discount: 100, vatMode: "excluded" }), 963);
  assert.equal(docTotal({ subtotal: 1000, vatMode: "included" }), 1000);
  assert.deepEqual(computeAttendance({ checkIn: "09:20", checkOut: "18:05", shiftStart: "09:00" }), { hours: 8.75, late: 20 });
  assert.deepEqual(computeAttendance({ checkIn: "08:50" }), { hours: 0, late: 0 });
  assert.equal(catalog.stock_counts.computed!.diff.calc({ systemQty: 50, countedQty: 47 }), -3);
  assert.equal(catalog.sales_targets.computed!.percent.calc({ target: 200000, actual: 150000 }), 75);
});

test("a LINE template can be generated for every page and its approved values save there", () => {
  for (const kind of Object.keys(catalog)) {
    const { template, map } = templateForPage(kind);
    if (!template.fields.length) continue;
    assert.ok(templateSchema.safeParse({ ...template, steps: [] }).success, "bad template for " + kind);
    for (const to of Object.values(map)) assert.ok(catalog[kind].fields.some((f) => f.key === to));
  }
  const { template, map } = templateForPage("leaves");
  const values = Object.fromEntries(
    template.fields.map((f) => [f.key, f.type === "number" ? 1 : f.type === "date" ? "2026-10-20" : f.type === "choice" ? f.options![0] : "ทดสอบ"]),
  );
  const emp = "11111111-1111-4111-8111-111111111111";
  const target = mapToTarget({ ...template, target_kind: "leaves", field_map: map }, values, "2026-10-20T03:00:00Z", (kind, name) => (kind === "employees" && name === "ทดสอบ" ? emp : undefined));
  assert.ok(target);
  assert.equal(target.kind, "leaves");
  validateEntity("leaves", target.data);
  assert.ok(Object.values(target.data).includes(emp), "employee name resolved to its record");
  assert.equal(mapToTarget({ name: "x", fields: [], target_kind: null }, {}, "2026-10-20T03:00:00Z"), null);
});
