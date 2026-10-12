import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  initialState,
  localExtract,
  validateTemplate,
  validateValues,
  decide,
  visibleState,
  verifyLine,
} from "../server/domain.mjs";
test("extracts explicit Thai fields without inventing missing information", () => {
  const s = initialState();
  const r = localExtract(
    s.templates[0],
    "โครงการ: The Promenade\nสถานที่: กรุงเทพฯ\nค่าเช่า: 55,000\nวันเริ่ม: 2026-10-16",
  );
  assert.equal(r.values.rent, 55000);
  assert.equal(r.values.area, null);
  assert.deepEqual(r.missing, ["วันสิ้นสุด"]);
});
test("rejects invalid schemas, nonfinite values and calendar dates", () => {
  assert.throws(() =>
    validateTemplate({
      name: "t",
      department: "d",
      fields: [{ key: "__proto__", label: "x", type: "text" }],
    }),
  );
  assert.throws(() =>
    validateValues(
      { fields: [{ key: "a", label: "A", type: "date" }] },
      { a: "2026-02-30" },
    ),
  );
  assert.throws(() =>
    validateValues(
      { fields: [{ key: "a", label: "A", type: "number" }] },
      { a: Infinity },
    ),
  );
});
test("approval validates completeness and creates each task only once", () => {
  const s = initialState();
  s.records = [
    {
      id: "r",
      department: "Business Development",
      template: s.templates[0],
      status: "review",
    },
  ];
  const owner = { uid: "u", role: "owner" };
  assert.throws(() =>
    decide(s, owner, "r", { status: "approved", values: { project: "p" } }),
  );
  assert.equal(s.tasks.length, 0);
  decide(s, owner, "r", {
    status: "approved",
    values: {
      project: "p",
      location: "l",
      rent: 55000,
      start: "2026-10-16",
      end: "2026-10-28",
    },
  });
  assert.equal(s.tasks.length, 5);
  assert.equal(s.records[0].status, "approved");
  assert.throws(
    () => decide(s, owner, "r", { status: "approved" }),
    (e) => e.status === 409,
  );
  assert.equal(s.tasks.length, 5);
});
test("department manager and viewer cannot escalate access", () => {
  const s = initialState();
  s.records = [
    {
      id: "r",
      department: "Finance",
      template: s.templates[0],
      status: "review",
    },
  ];
  assert.throws(
    () =>
      decide(s, { uid: "u", role: "manager", departments: ["Sales"] }, "r", {}),
    (e) => e.status === 404,
  );
  assert.throws(
    () =>
      decide(
        s,
        { uid: "u", role: "viewer", departments: ["Finance"] },
        "r",
        {},
      ),
    (e) => e.status === 403,
  );
  assert.equal(
    visibleState(s, { role: "staff", departments: ["Sales"] }).records.length,
    0,
  );
});
test("LINE signature protects the exact raw bytes", () => {
  const body = Buffer.from('{"events":[]}'),
    signature = createHmac("sha256", "secret").update(body).digest("base64");
  assert.equal(verifyLine(body, signature, "secret"), true);
  assert.equal(
    verifyLine(Buffer.from('{ "events": [] }'), signature, "secret"),
    false,
  );
  assert.equal(verifyLine(body, "", "secret"), false);
});
