import assert from "node:assert/strict";
import test from "node:test";
import { validateEntity } from "../src/lib/domain";

const base = { name: "ประชุมทีม", startDate: "2026-11-14", endDate: "2026-11-14", status: "planning" };
const id = "3f1c2a54-7f0e-4c1b-9a63-2d9b0b7e4a11";

test("events keep type, times, project and participants from the เพิ่มกิจกรรม pop-up", () => {
  const d = validateEntity("events", {
    ...base,
    category: "นัดลูกค้า",
    startTime: "09:30",
    endTime: "10:15",
    projectId: id,
    participants: [
      { kind: "employees", id, name: "สมชาย" },
      { kind: "customers", id: "a1b2c3d4-0000-4000-8000-000000000001", name: "บริษัท ลูกค้า จำกัด" },
      { kind: "suppliers", id: "a1b2c3d4-0000-4000-8000-000000000002", name: "ร้านวัสดุ" },
    ],
  });
  assert.equal(d.category, "นัดลูกค้า");
  assert.equal(d.startTime, "09:30");
  assert.equal(d.projectId, id);
  assert.equal((d.participants as unknown[]).length, 3);
});

test("events reject a bad time, an unknown participant group and an unknown type", () => {
  assert.throws(() => validateEntity("events", { ...base, startTime: "25:00" }));
  assert.throws(() => validateEntity("events", { ...base, participants: [{ kind: "admins", id, name: "x" }] }));
  assert.throws(() => validateEntity("events", { ...base, participants: [{ kind: "employees", id: "nope", name: "x" }] }));
  assert.throws(() => validateEntity("events", { ...base, category: "ปาร์ตี้" }));
  // an old event with none of the new fields still saves
  assert.equal(validateEntity("events", base).name, "ประชุมทีม");
});
