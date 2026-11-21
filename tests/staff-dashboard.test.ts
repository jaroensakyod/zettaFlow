// Home page (ภาพรวม) for staff / viewers: no company money from the API, only their own workspace (home-mode.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeMode, myTask } from "../src/lib/home-mode";
import type { Context, Member } from "../src/lib/types";

const member = (role: Member["role"], departments: string[] = [], read_departments: string[] = []) =>
  ({ member: { role, departments, read_departments } }) as unknown as Context;

test("home mode: owner and managers see the company, staff and viewers their own workspace", () => {
  assert.equal(homeMode(member("owner")), "company");
  assert.equal(homeMode(member("manager", ["Sales"])), "company");
  assert.equal(homeMode(member("staff", ["Sales"])), "personal");
  // Finance access does not bring the company totals back to the home page.
  assert.equal(homeMode(member("staff", ["Finance"], ["Sales"])), "personal");
  assert.equal(homeMode(member("viewer", [], ["Finance"])), "personal");
  // A platform admin's read-only support view sees what the owner sees.
  assert.equal(homeMode({ ...member("viewer"), support: { id: "x" } } as unknown as Context), "company");
  const ctx = { user: { id: "u1", email: "nok@x.co", name: "นก ใจดี" }, member: { name: "นก ใจดี" } } as unknown as Context;
  assert.ok(myTask(ctx, { data: { assignee: "นก" } }));
  assert.ok(myTask(ctx, { created_by: "u1", data: {} }));
  assert.ok(!myTask(ctx, { created_by: "u1", data: { assignee: "สมชาย" } }));
  assert.ok(!myTask(ctx, { created_by: "u2", data: {} }));
});

test("home API: staff get no company money, only their own records; the owner's page is unchanged", async () => {
  process.env.ELITEFLOW_DEMO_MODE = "true";
  delete process.env.VERCEL;
  process.env.DEMO_DATA_FILE = "staff-home-" + Date.now() + ".json";
  const cwd = process.cwd();
  process.chdir(await mkdtemp(join(tmpdir(), "ef-staff-home-")));
  try {
    const { demoContext, demoRead, demoMutate } = await import("../src/lib/demo");
    const { home, homePage, homeFinance } = await import("../src/lib/data");
    const { homeExtra, homeMe, setGoal } = await import("../src/lib/home-extra");
    const owner = await demoContext();
    const s = await demoRead();
    const m = s.members.find((x) => x.role === "staff")!;
    // A staff member who even has ใช้งาน on Finance and ดู on Sales.
    const staff: Context = {
      user: { id: m.user_id, email: m.email.toUpperCase(), name: m.name },
      member: { ...m, departments: [...m.departments, "Finance"], read_departments: ["Sales"] },
      company: s.company,
      demo: true,
    };
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10),
      month = today.slice(0, 7);
    await setGoal(owner, { month, target: 900000 });
    // Things the staff member did: an expense waiting for approval, an approved leave, a task given to them.
    await demoMutate((st) => {
      const base = { company_id: st.company.id, version: 1, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      st.entities.push(
        { ...base, id: "30000000-0000-4000-8000-000000000001", kind: "expenses", department: "Finance", created_by: m.user_id, data: { name: "ค่าแท็กซี่ไปหาลูกค้า", amount: 350, date: today, status: "pending" } },
        { ...base, id: "30000000-0000-4000-8000-000000000002", kind: "leaves", department: "HR", created_by: m.user_id, data: { name: "ลาพักร้อน", status: "approved" } },
        { ...base, id: "30000000-0000-4000-8000-000000000003", kind: "tasks", department: "Warehouse", created_by: owner.user.id, data: { name: "นับสต็อกสิ้นเดือน", department: "Warehouse", assignee: m.name, status: "pending", dueDate: "2000-01-01" } },
      );
    });

    // Owner: money and company tasks as before.
    const ownerHome = await homePage(owner);
    assert.ok(ownerHome.finance.length > 0, "owner sees finance rows");
    assert.ok(ownerHome.projects.length > 0);
    assert.deepEqual(ownerHome, await home(owner));
    assert.ok((await homeFinance(owner, month + "-01", today)).length > 0);
    const ownerExtra = await homeExtra(owner);
    assert.equal(ownerExtra.goal?.target, 900000);
    assert.ok(ownerExtra.activity.length > 0);

    // Staff: no finance rows (even with Finance access), only tasks that are theirs, no goal.
    const staffHome = await homePage(staff);
    assert.deepEqual(staffHome.finance, []);
    assert.deepEqual(staffHome.projects, []);
    assert.ok(staffHome.tasks.some((t) => t.data.name === "นับสต็อกสิ้นเดือน"));
    assert.ok(staffHome.tasks.every((t) => t.data.assignee === m.name || (t.created_by === m.user_id && !t.data.assignee)), "only my tasks");
    assert.ok((await home(staff)).finance.length > 0, "home() for other callers (Flow) keeps Finance access");
    assert.deepEqual(await homeFinance(staff, "2000-01-01", today), []);
    const staffExtra = await homeExtra(staff);
    assert.equal(staffExtra.goal, null);
    assert.equal(staffExtra.canSetGoal, false);
    const mineIds = new Set(["30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000002"]);
    assert.ok(staffExtra.activity.every((a) => mineIds.has(a.id)), "activity is only what I did");
    await assert.rejects(setGoal(staff, { month, target: 1 }), /เฉพาะเจ้าของหรือผู้จัดการ/);

    // My workspace: my employee record by login email (any case), my submissions and counts — nothing else.
    const me = await homeMe(staff);
    const emp = s.entities.find((e) => e.kind === "employees" && String(e.data.email).toLowerCase() === m.email.toLowerCase())!;
    assert.deepEqual(me.employee, {
      id: emp.id,
      name: String(emp.data.name),
      nickname: String(emp.data.nickname || ""),
      position: String(emp.data.position || ""),
      code: String(emp.data.code || ""),
      department: String(emp.data.department || ""),
      level: String(emp.data.level || ""),
    });
    assert.ok(!("salary" in (me.employee as object)), "no salary in my profile");
    assert.deepEqual(
      me.sent.map((x) => [x.kind, x.statusLabel]).sort(),
      [
        ["expenses", "รออนุมัติ"],
        ["leaves", "อนุมัติแล้ว"],
      ],
    );
    assert.equal(me.counts.waiting, 1);
    assert.ok(me.counts.openTasks >= 1 && me.counts.lateTasks >= 1);
    assert.ok(me.sent.every((x) => !("amount" in x) && !("data" in x)), "no amounts or raw records in my workspace payload");
  } finally {
    process.chdir(cwd);
  }
});

test("the API serves the home page through the gated functions", async () => {
  const route = await readFile("src/app/api/[...path]/route.ts", "utf8");
  assert.match(route, /response\(await homePage\(ctx\)\)/);
  assert.match(route, /path\[1\] === "me" && method === "GET"\) return response\(await homeMe\(ctx\)\)/);
  assert.doesNotMatch(route, /response\(await home\(ctx\)\)/);
});
