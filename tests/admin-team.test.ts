import { test } from "node:test";
import assert from "node:assert/strict";
import { adminRoleOf, setAdminTeam } from "../src/lib/admin-team";
import { applyCatalog, defaultPlans, planById, planPrice } from "../src/lib/billing";

test("platform team: owners from the env, team members by role, everyone else nothing", () => {
  const before = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_ADMIN_EMAILS = "Boss@EliteFlow.co, ops@eliteflow.co";
  setAdminTeam([
    { email: "help@eliteflow.co", role: "admin" },
    { email: "look@eliteflow.co", role: "viewer" },
  ]);
  try {
    assert.equal(adminRoleOf("boss@eliteflow.co"), "owner");
    assert.equal(adminRoleOf("OPS@eliteflow.co"), "owner");
    assert.equal(adminRoleOf("help@eliteflow.co"), "admin");
    assert.equal(adminRoleOf("look@eliteflow.co"), "viewer");
    assert.equal(adminRoleOf("someone@else.co"), null);
    // A team member cannot outrank the env: the env list wins.
    setAdminTeam([{ email: "boss@eliteflow.co", role: "viewer" }]);
    assert.equal(adminRoleOf("boss@eliteflow.co"), "owner");
  } finally {
    setAdminTeam([]);
    process.env.PLATFORM_ADMIN_EMAILS = before;
  }
});

test("admin-set package prices and limits drive planPrice and planById", () => {
  const starter = defaultPlans.find((p) => p.id === "starter")!;
  try {
    applyCatalog({ plans: [{ id: "starter", monthly: 1000, users: null }], addons: [{ id: "extra_user", price: 200 }] });
    assert.equal(planById("starter").monthly, 1000);
    assert.equal(planById("starter").users, null);
    // 1000 + 2 extra users × 200, plus VAT 7%
    assert.deepEqual(planPrice("starter", "monthly", { extraUsers: 2 }), { base: 1400, vat: 98, total: 1498 });
  } finally {
    applyCatalog({ plans: [{ id: "starter", monthly: starter.monthly, users: starter.users }], addons: [{ id: "extra_user", price: 150 }] });
  }
  assert.equal(planById("starter").monthly, starter.monthly);
});
