import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyId, mapLegacy } from "../src/lib/legacy";
test("legacy imports map known Firebase field names with deterministic tenant-specific IDs", () => {
  const c = "10000000-0000-4000-8000-000000000001";
  const a = legacyId(c, "customers", "old");
  assert.equal(a, legacyId(c, "customers", "old"));
  assert.notEqual(
    a,
    legacyId("10000000-0000-4000-8000-000000000002", "customers", "old"),
  );
  const row = mapLegacy(
    "customers",
    { cust_name: "Customer", cust_phone: "02-000-0000" },
    c,
  );
  assert.equal(row.data.name, "Customer");
  assert.equal(row.data.phone, "02-000-0000");
  const deal = mapLegacy(
    "dealAreas",
    { dealerName: "Promenade", areaSize: 33, rc_fixed: 55000, rc_gp: 22 },
    c,
  );
  assert.equal(deal.data.rent, 55000);
  assert.equal(deal.data.area, 33);
});
