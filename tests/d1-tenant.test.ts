import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sqliteDriver } from "../src/lib/d1/driver";
import { Tenant, AccessError } from "../src/lib/d1/tenant";
import type { Viewer } from "../src/lib/d1/access";

const A = "a0000000-0000-4000-8000-000000000001",
  B = "b0000000-0000-4000-8000-000000000002",
  ownerA = "u-owner-a",
  staffA = "u-staff-a",
  ownerB = "u-owner-b";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("cloudflare/d1/0001_schema.sql", "utf8"));
  const sql = sqliteDriver(db);
  const run = (s: string, ...p: (string | number | null)[]) => db.prepare(s).run(...p);
  for (const [k, d] of [["customers", "Sales"], ["expenses", "Finance"], ["branches", "Admin"]]) run("insert into entity_schemas(kind,department,fields) values (?,?,'[]')", k, d);
  run("insert into companies(id,name) values (?,?),(?,?)", A, "บริษัท A", B, "บริษัท B");
  run("insert into memberships(company_id,user_id,email,role,departments) values (?,?,?,?,?)", A, ownerA, "owner@a.th", "owner", "[]");
  run("insert into memberships(company_id,user_id,email,role,departments) values (?,?,?,?,?)", A, staffA, "staff@a.th", "staff", '["Sales"]');
  run("insert into memberships(company_id,user_id,email,role,departments) values (?,?,?,?,?)", B, ownerB, "owner@b.th", "owner", "[]");
  for (const [c, kind, dept, name] of [
    [A, "customers", "Sales", "ลูกค้า A"],
    [A, "expenses", "Finance", "ค่าเช่า A"],
    [A, "branches", "Admin", "สาขา A"],
    [B, "customers", "Sales", "ลูกค้า B"],
    [B, "expenses", "Finance", "ค่าเช่า B"],
  ])
    run("insert into entities(company_id,kind,department,data) values (?,?,?,?)", c, kind, dept, JSON.stringify({ name }));
  run("insert into audit_events(company_id,action,target) values (?,?,?),(?,?,?)", A, "x", "a", B, "x", "b");
  run("insert into user_notes(company_id,user_id,day,body) values (?,?,?,?),(?,?,?,?)", A, ownerA, "2026-11-20", "ของเจ้าของ", A, staffA, "2026-11-20", "ของพนักงาน");
  run("insert into invitations(company_id,email,role,departments) values (?,?,?,?)", B, "staff@a.th", "staff", "[]");
  const ownerOfA: Viewer = { userId: ownerA, email: "owner@a.th", companyId: A, role: "owner", departments: [] };
  const staffOfA: Viewer = { userId: staffA, email: "staff@a.th", companyId: A, role: "staff", departments: ["Sales"] };
  const ownerOfB: Viewer = { userId: ownerB, email: "owner@b.th", companyId: B, role: "owner", departments: [] };
  return { db, sql, ownerOfA, staffOfA, ownerOfB };
}
const names = (rows: { data: { name: string } }[]) => rows.map((r) => r.data.name).sort();

test("reads never cross companies", async () => {
  const { sql, ownerOfA, ownerOfB } = setup();
  const a = new Tenant(sql, ownerOfA),
    b = new Tenant(sql, ownerOfB);
  assert.deepEqual(names(await a.select("entities")), ["ค่าเช่า A", "ลูกค้า A", "สาขา A"]);
  assert.deepEqual(names(await b.select("entities")), ["ค่าเช่า B", "ลูกค้า B"]);
  // Asking for the other company's id directly still returns nothing.
  assert.equal((await a.select("entities", { where: { company_id: B } })).length, 0);
  assert.equal(await a.count("audit_events"), 1);
  assert.deepEqual((await a.select<{ name: string }>("companies")).map((c) => c.name), ["บริษัท A"]);
  // Rows come back like Supabase: JSON parsed, booleans as booleans.
  const [m] = await a.select<{ departments: string[]; disabled: boolean }>("memberships", { where: { user_id: ownerOfA.userId } });
  assert.deepEqual(m.departments, []);
  assert.equal(m.disabled, false);
});

test("departments, roles and own rows follow the Postgres policies", async () => {
  const { sql, staffOfA } = setup();
  const s = new Tenant(sql, staffOfA);
  // Sales staff: Sales records and branches (shown to every member), not Finance.
  assert.deepEqual(names(await s.select("entities")), ["ลูกค้า A", "สาขา A"]);
  assert.equal(await s.count("audit_events"), 0, "audit log is owner only");
  assert.deepEqual((await s.select<{ email: string }>("memberships")).map((m) => m.email), ["staff@a.th"], "only their own membership");
  assert.deepEqual((await s.select<{ body: string }>("user_notes")).map((n) => n.body), ["ของพนักงาน"], "only their own notes");
  // An invitation to another company addressed to them is visible (to accept it).
  assert.equal((await s.select("invitations")).length, 1);
  // Shared catalogues are readable; system tables are not.
  assert.ok(Array.isArray(await s.select("plans")));
  await assert.rejects(s.select("line_users"), AccessError);
  await assert.rejects(s.select("no_such_table"), AccessError);
});

test("writes are pinned to the request's company", async () => {
  const { sql, ownerOfA, ownerOfB } = setup();
  const a = new Tenant(sql, ownerOfA),
    b = new Tenant(sql, ownerOfB);
  // company_id given by the caller is ignored.
  const row = await a.insert<{ id: string; company_id: string; data: { name: string } }>("entities", { company_id: B, kind: "customers", department: "Sales", data: { name: "แอบใส่" } });
  assert.equal(row.company_id, A);
  assert.equal(row.data.name, "แอบใส่");
  // Updating or deleting another company's rows changes nothing.
  const [bRow] = await b.select<{ id: string }>("entities", { where: { kind: "customers" } });
  assert.deepEqual(await a.update("entities", { id: bRow.id }, { data: { name: "แก้ข้ามบริษัท" } }), []);
  assert.deepEqual(await a.remove("entities", { id: bRow.id }), []);
  assert.deepEqual(names(await b.select("entities", { where: { id: bRow.id } })), ["ลูกค้า B"]);
  // A patch cannot move a row to another company.
  const [own] = await a.update<{ company_id: string }>("entities", { id: row.id }, { company_id: B, version: 2 });
  assert.equal(own?.company_id, A);
  // Writes without a where, to shared tables, or to unknown columns are refused.
  assert.throws(() => a.updateStmt("entities", {}, { version: 3 }), AccessError);
  assert.throws(() => a.insertStmt("plans", { id: "x" }), AccessError);
  assert.throws(() => a.insertStmt("entities", { "kind) values ('x'); --": 1 }), AccessError);
});

test("atomic writes roll back together", async () => {
  const { sql, ownerOfA } = setup();
  const a = new Tenant(sql, ownerOfA);
  const before = await a.count("entities");
  await assert.rejects(a.atomic([a.insertStmt("entities", { kind: "customers", department: "Sales", data: { name: "ok" } }), a.insertStmt("entities", { kind: "no_such_kind", department: "Sales", data: {} })]));
  assert.equal(await a.count("entities"), before);
});

test("a support view reads every department and writes nothing", async () => {
  const { sql } = setup();
  const v = new Tenant(sql, { userId: "admin", email: "admin@eliteflow.co", companyId: A, role: "viewer", departments: [], support: true });
  assert.deepEqual(names(await v.select("entities")), ["ค่าเช่า A", "ลูกค้า A", "สาขา A"]);
  assert.equal(await v.count("audit_events"), 0, "viewer role is still not the owner");
  assert.throws(() => v.insertStmt("entities", { kind: "customers", department: "Sales", data: {} }), AccessError);
  await assert.rejects(v.atomic([]), AccessError);
});

// The raw driver bypasses every rule above. Only the data layer itself (and functions reviewed for it, listed here
// with the reason) may import it.
const rawAllowed = new Set<string>([]);
test("nothing outside src/lib/d1 uses the raw database driver", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(d + "/" + f).isDirectory() ? walk(d + "/" + f) : [d + "/" + f]));
  const offenders = walk("src")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("src/lib/d1/") && !rawAllowed.has(f))
    .filter((f) => /from ["'][^"']*d1\/driver["']|d1Driver\(|sqliteDriver\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});

test("a guarded batch aborts when what was read changed meanwhile (stand-in for row locks)", async () => {
  const { sql, ownerOfA } = setup();
  const { ConflictError } = await import("../src/lib/d1/tenant");
  const a = new Tenant(sql, ownerOfA);
  const [row] = await a.select<{ id: string; version: number }>("entities", { where: { kind: "customers" } });
  // Someone else saves first.
  await a.update("entities", { id: row.id }, { version: row.version + 1 });
  const before = await a.count("audit_events");
  await assert.rejects(a.atomic([a.guardStmt("entities", { id: row.id, version: row.version }), a.insertStmt("audit_events", { action: "x", target: row.id })]), ConflictError);
  assert.equal(await a.count("audit_events"), before, "nothing from the aborted batch was kept");
  // With the current version it goes through.
  await a.atomic([a.guardStmt("entities", { id: row.id, version: row.version + 1 }), a.insertStmt("audit_events", { action: "x", target: row.id })]);
  assert.equal(await a.count("audit_events"), before + 1);
});

test("internal and global counts, quota guards, JSON paths and column lists", async () => {
  const { sql, ownerOfA } = setup();
  const a = new Tenant(sql, ownerOfA);
  // countInternal: this company only, no read rule; countGlobal: any company, filtered by where.
  assert.equal(await a.countInternal("entities"), 3);
  assert.equal(await a.countInternal("entities", { kind: "customers" }), 1);
  assert.equal(await a.countGlobal("entities", { kind: "customers" }), 2);
  assert.equal(await a.countGlobal("entities", { company_id: B }), 2);
  // countBelowStmt aborts the batch once the count reached the limit.
  await a.atomic([a.countBelowStmt("entities", {}, 4), a.insertStmt("audit_events", { action: "ok", target: "1" })]);
  const { ConflictError } = await import("../src/lib/d1/tenant");
  await assert.rejects(a.atomic([a.countBelowStmt("entities", {}, 3)]), ConflictError);
  await assert.rejects(a.atomic([a.countBelowGlobalStmt("entities", { company_id: B }, 2)]), ConflictError);
  // A key "col.path" filters inside a JSON column, with the path bound (never spliced into SQL).
  const [hit] = await a.selectInternal<{ kind: string }>("entities", { where: { "data.name": "ลูกค้า A" } });
  assert.equal(hit.kind, "customers");
  assert.equal((await a.selectInternal("entities", { where: { "data.name": ["ลูกค้า A", "สาขา A"] } })).length, 2);
  assert.equal((await a.selectInternal("entities", { where: { "data.missing": { op: "!=", value: null } } })).length, 0);
  assert.equal((await a.selectGlobal("entities", { where: { "data.name": { op: "like", value: "ลูกค้า%" } } })).length, 2);
  assert.throws(() => a.guardStmt("entities", { "data.x') OR 1=1 --": 1 }), AccessError);
  await assert.rejects(a.selectInternal("entities", { where: { "kind.x": 1 } }), AccessError);
  // Column lists are honoured by selectInternal / selectGlobal too.
  const [only] = await a.selectInternal<Record<string, unknown>>("entities", { where: { kind: "customers" }, columns: ["id", "kind"] });
  assert.deepEqual(Object.keys(only).sort(), ["id", "kind"]);
  // A guard may compare a whole JSON column with what was read.
  const [row] = await a.selectInternal<{ id: string; data: Record<string, unknown> }>("entities", { where: { kind: "customers" } });
  await a.atomic([a.guardStmt("entities", { id: row.id, data: row.data })]);
  await assert.rejects(a.atomic([a.guardStmt("entities", { id: row.id, data: { name: "อื่น" } })]), ConflictError);
  await assert.rejects(a.select("entities", { where: { data: { name: "x" } as never } }), AccessError);
});

test("next number written into another company's row inside the batch", async () => {
  const { sql, ownerOfA } = setup();
  const a = new Tenant(sql, ownerOfA);
  const ids = ["e1000000-0000-4000-8000-000000000001", "e1000000-0000-4000-8000-000000000002"];
  for (const id of ids)
    await a.atomic([
      a.insertGlobalStmt("entities", { id, company_id: B, kind: "customers", department: "Sales", data: { name: "จากดีล" } }),
      ...a.nextNumberIntoStmts(B, "CUS", 0, { table: "entities", id, key: "data.code", text: "CUS-69-" }),
    ]);
  const rows = await a.selectGlobal<{ data: { code: string } }>("entities", { where: { id: ids }, order: [["id", "asc"]] });
  assert.deepEqual(rows.map((r) => r.data.code), ["CUS-69-0001", "CUS-69-0002"]);
  // B's counter moved, A's did not.
  assert.equal((await new Tenant(sql, { ...ownerOfA, companyId: B }).selectInternal<{ last: number }>("doc_counters", { where: { prefix: "CUS" } }))[0].last, 2);
  assert.equal(await a.countInternal("doc_counters"), 0);
  // updateGlobal returns what it changed (a claim that lost returns nothing).
  assert.equal((await a.updateGlobal("entities", { id: ids[0], version: 1 }, { version: 2 })).length, 1);
  assert.equal((await a.updateGlobal("entities", { id: ids[0], version: 1 }, { version: 3 })).length, 0);
});
