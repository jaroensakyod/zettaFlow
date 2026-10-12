import { test } from "node:test";
import assert from "node:assert/strict";
import { modules } from "../src/lib/catalog";
import {
  validateEntity,
  stockDelta,
  canRead,
  canWrite,
  safeCsv,
  explicitExtract,
  validateValues,
  templateSchema,
} from "../src/lib/domain";
import { seedDemo, demoApprove } from "../src/lib/demo";
import type { Context } from "../src/lib/types";
test("every business module has a valid server-validated create payload", () => {
  for (const m of modules) {
    const input = Object.fromEntries(
      m.fields
        .filter((f) => f.required)
        .map((f) => [
          f.key,
          f.type === "number"
            ? f.min || 0
            : f.type === "date"
              ? "2026-10-12"
              : f.type === "select"
                ? f.options![0]
                : f.type === "relation"
                  ? "10000000-0000-4000-8000-000000000001"
                  : "Test record",
        ]),
    );
    const result = validateEntity(m.key, input);
    assert.equal(result.name, "Test record", m.key);
    assert.equal(
      validateEntity(m.key, { ...input, company_id: "attacker" }).company_id,
      undefined,
    );
  }
});
test("money, quantities and date ranges are validated before persistence", () => {
  assert.throws(() =>
    validateEntity("purchases", {
      name: "PO",
      supplierId: "10000000-0000-4000-8000-000000000001",
      productId: "10000000-0000-4000-8000-000000000002",
      quantity: 1.5,
      unitCost: 100,
      orderDate: "2026-10-12",
    }),
  );
  assert.throws(() =>
    validateEntity("projects", {
      name: "Bad date",
      priority: "normal",
      status: "active",
      startDate: "2026-02-30",
    }),
  );
  assert.throws(() =>
    validateEntity("projects", {
      name: "Bad range",
      priority: "normal",
      status: "active",
      startDate: "2026-10-20",
      endDate: "2026-10-12",
    }),
  );
  assert.throws(() =>
    validateEntity("expenses", {
      name: "Negative",
      category: "อื่นๆ",
      date: "2026-10-12",
      amount: -1,
      status: "pending",
    }),
  );
  const payroll = validateEntity("payroll", {
    name: "October",
    employeeId: "10000000-0000-4000-8000-000000000001",
    date: "2026-10-12",
    base: 25000,
    allowance: 2000,
    deduction: 500,
    status: "draft",
  });
  assert.equal(payroll.net, 26500);
});
test("staff and viewers are constrained by department and role", () => {
  const state = seedDemo();
  const ctx = {
    company: state.company,
    member: { ...state.members[0], role: "viewer", departments: ["Sales"] },
    demo: false,
    user: { id: "u", email: "u@test.local", name: "u" },
  } as Context;
  assert.equal(canRead(ctx, "Sales"), true);
  assert.equal(canWrite(ctx, "Sales"), false);
  assert.equal(canRead(ctx, "Finance"), false);
});
test("stock movements reject negative inventory and fractional counts", () => {
  assert.equal(stockDelta(10, "out", 10), 0);
  assert.throws(() => stockDelta(10, "out", 11));
  assert.throws(() => stockDelta(10, "in", 0.5));
});
test("template extraction does not invent values and approvals require completeness", () => {
  const t = seedDemo().templates[0];
  const result = explicitExtract(
    t,
    "โครงการ: Promenade\nสถานที่: Bangkok\nค่าเช่า: 55,000\nวันเริ่ม: 2026-10-16",
  );
  assert.equal(result.values.rent, 55000);
  assert.equal(result.values.end, null);
  assert.throws(() => validateValues(t, result.values, true));
  assert.equal(
    templateSchema.safeParse({
      name: "x",
      department: "Ops",
      fields: [
        { key: "same", label: "1", type: "text", required: true },
        { key: "same", label: "2", type: "text", required: true },
      ],
      steps: [],
    }).success,
    false,
  );
});
test("CSV export neutralizes spreadsheet formula injection including whitespace", () => {
  const csv = safeCsv([[' =HYPERLINK("bad")', "normal"]]);
  assert.ok(csv.includes("' =HYPERLINK"));
  assert.ok(csv.includes('"normal"'));
});
test("approved space data creates one linked project, deal and departmental workflow", () => {
  const s = seedDemo(),
    t = s.templates[0],
    id = "10000000-0000-4000-8000-000000000099";
  s.ingestions.push({
    id,
    company_id: s.company.id,
    template: t,
    raw: "",
    values: {},
    missing: [],
    status: "review",
    source: "Web",
    created_at: new Date().toISOString(),
  });
  demoApprove(
    s,
    id,
    {
      project: "Central Rama 2",
      location: "Bangkok",
      rent: 45000,
      start: "2026-11-01",
      end: "2026-11-14",
    },
    "approved",
    "",
  );
  const project = s.entities.find(
    (e) => e.kind === "projects" && e.data.name === "Central Rama 2",
  )!;
  assert.ok(project);
  assert.equal(
    s.entities.filter(
      (e) => e.kind === "tasks" && e.data.projectId === project.id,
    ).length,
    5,
  );
  assert.equal(
    s.entities.find(
      (e) => e.kind === "deals" && e.data.projectId === project.id,
    )?.data.status,
    "approved",
  );
  assert.throws(() => demoApprove(s, id, {}, "approved", ""));
});
