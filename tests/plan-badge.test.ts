import { test } from "node:test";
import assert from "node:assert/strict";
import { planBadge } from "../src/lib/plan-badge";

test("customer package badge: free, trial, paid, expired", () => {
  const now = Date.parse("2026-11-18T00:00:00Z");
  assert.equal(planBadge(null, now), null);
  assert.deepEqual(planBadge({ plan: "free", status: "active", end: null, trialEnd: null }, now)?.tone, "free");
  assert.equal(planBadge({ plan: "free", status: "active", end: null, trialEnd: null }, now)?.label, "ฟรี");
  const trial = planBadge({ plan: "growth", status: "trial", end: null, trialEnd: "2026-11-25T00:00:00Z" }, now)!;
  assert.equal(trial.label, "ทดลอง Growth");
  assert.equal(trial.tone, "trial");
  assert.equal(planBadge({ plan: "growth", status: "trial", end: null, trialEnd: "2026-11-01T00:00:00Z" }, now)?.tone, "expired");
  const paid = planBadge({ plan: "enterprise", status: "active", end: "2027-11-18T00:00:00Z", trialEnd: null }, now)!;
  assert.equal(paid.label, "Enterprise");
  assert.equal(paid.tone, "enterprise");
  assert.match(paid.hint, /ใช้ได้ถึง/);
  assert.equal(planBadge({ plan: "enterprise", status: "active", end: "2099-12-31T00:00:00Z", trialEnd: null }, now)?.hint, "ใช้งานอยู่");
  assert.equal(planBadge({ plan: "starter", status: "active", end: "2026-11-01T00:00:00Z", trialEnd: null }, now)?.label, "Starter · หมดอายุ");
  assert.equal(planBadge({ plan: "starter", status: "past_due", end: "2026-12-01T00:00:00Z", trialEnd: null }, now)?.tone, "expired");
});
