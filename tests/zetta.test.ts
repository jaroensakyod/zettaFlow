import test from "node:test";
import assert from "node:assert/strict";
import type { Entity } from "../src/lib/types";
import { projectNumbers, periodDays, spaceStatistics } from "../src/lib/zetta";
const entity = (id: string, kind: string, data: Record<string, unknown>) =>
  ({ id, kind, data }) as Entity;
test("Zetta project totals exclude other projects and unconfirmed financial data", () => {
  const p = entity("p1", "projects", {}),
    related = [
      entity("s1", "sales", {
        projectId: "p1",
        status: "confirmed",
        amount: 1200,
      }),
      entity("s2", "sales", {
        projectId: "p2",
        status: "confirmed",
        amount: 99000,
      }),
      entity("s3", "sales", { projectId: "p1", status: "draft", amount: 5000 }),
      entity("e1", "expenses", {
        projectId: "p1",
        status: "approved",
        amount: 200,
      }),
      entity("e2", "expenses", {
        projectId: "p1",
        status: "draft",
        amount: 900,
      }),
      entity("t1", "tasks", { projectId: "p1", status: "done" }),
      entity("t2", "tasks", { projectId: "p1", status: "pending" }),
      entity("d", "deals", { projectId: "p1", targetSales: 2000 }),
    ];
  const n = projectNumbers(p, related);
  assert.equal(n.sales, 1200);
  assert.equal(n.expenses, 200);
  assert.equal(n.progress, 50);
  assert.equal(n.target, 2000);
  assert.equal(projectNumbers(p, []).progress, 0);
});
test("Space dates use inclusive periods and avoid invalid-date totals", () => {
  assert.equal(periodDays("2026-08-12", "2026-08-23"), 12);
  assert.equal(periodDays("2026-08-23", "2026-08-12"), "—");
  assert.equal(periodDays(undefined, "bad"), "—");
  const s = spaceStatistics([
    entity("a", "deals", { status: "approved" }),
    entity("b", "deals", { status: "pending" }),
    entity("c", "deals", { status: "negotiating" }),
  ]);
  assert.deepEqual(s, {
    total: 3,
    approved: 1,
    pending: 1,
    negotiating: 1,
    cancelled: 0,
  });
});
