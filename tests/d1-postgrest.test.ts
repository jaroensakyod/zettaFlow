// The Supabase-shaped client on D1 (src/lib/d1/postgrest.ts): the queries the app makes, run on node:sqlite with the
// D1 migrations (schema, users, seed), checked against what supabase-js + Postgres RLS answered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlite, applyMigrations } from "../src/lib/d1/local";
import { sqliteDriver } from "../src/lib/d1/driver";
import { d1Client, parseLogic, type D1User } from "../src/lib/d1/postgrest";
import { fsBlobStore, verifyBlobUrl } from "../src/lib/d1/blobs";
import { rpcs } from "../src/lib/d1/rpc-map";
import { fail } from "../src/lib/d1/common";

const A = "a0000000-0000-4000-8000-000000000001",
  B = "b0000000-0000-4000-8000-000000000002",
  JE = "e0000000-0000-4000-8000-000000000001",
  owner: D1User = { id: "10000000-0000-4000-8000-000000000001", email: "owner@a.th", name: "เจ้าของ" },
  staff: D1User = { id: "20000000-0000-4000-8000-000000000002", email: "staff@a.th", name: "พนักงาน" },
  outsider: D1User = { id: "30000000-0000-4000-8000-000000000003", email: "x@c.th", name: "คนนอก" };
const SECRET = "test-secret";

function setup() {
  const db = openSqlite(":memory:");
  const applied = applyMigrations(db);
  const sql = sqliteDriver(db);
  const run = (s: string, ...p: (string | number | null)[]) => db.prepare(s).run(...p);
  for (const u of [owner, staff, outsider]) run("insert into users(id,email,name) values (?,?,?)", u.id, u.email, u.name);
  run("insert into companies(id,name) values (?,?),(?,?)", A, "บริษัท A", B, "บริษัท B");
  run("insert into memberships(company_id,user_id,email,role,departments) values (?,?,?,?,?)", A, owner.id, owner.email, "owner", "[]");
  run("insert into memberships(company_id,user_id,email,role,departments) values (?,?,?,?,?)", A, staff.id, staff.email, "staff", '["Sales"]');
  // The staff member is also the owner of company B.
  run("insert into memberships(company_id,user_id,email,role,departments) values (?,?,?,?,?)", B, staff.id, staff.email, "owner", "[]");
  const ent = (c: string, kind: string, dept: string, data: object, archived: string | null = null) =>
    run("insert into entities(company_id,kind,department,data,archived_at) values (?,?,?,?,?)", c, kind, dept, JSON.stringify(data), archived);
  ent(A, "customers", "Sales", { name: "ลูกค้า Alpha", status: "active", email: "Alpha@x.th" });
  ent(A, "customers", "Sales", { name: "ลูกค้า Beta", status: "pending" });
  ent(A, "expenses", "Finance", { name: "ค่าเช่า", status: "pending", amount: 1200 });
  ent(A, "branches", "Admin", { name: "สาขาหลัก" });
  ent(A, "customers", "Sales", { name: "เก่า" }, "2026-01-01T00:00:00.000Z");
  ent(B, "customers", "Sales", { name: "ลูกค้า B" });
  run("insert into journal_entries(id,company_id,date,memo) values (?,?,?,?)", JE, A, "2026-11-01", "ค่าเช่า");
  run("insert into journal_lines(entry_id,account_code,debit,credit) values (?,?,?,?),(?,?,?,?)", JE, "5100", 1200, 0, JE, "1000", 0, 1200);
  run("insert into audit_events(company_id,action,target) values (?,?,?),(?,?,?)", A, "x", "a", B, "y", "b");
  const dir = mkdtempSync(join(tmpdir(), "d1-blobs-"));
  const blobs = fsBlobStore(dir);
  const as = (user: D1User | null) => d1Client({ sql, user, service: false, blobs, origin: "http://app.test", blobSecret: SECRET });
  const admin = d1Client({ sql, user: null, service: true, blobs, origin: "http://app.test", blobSecret: SECRET });
  return { db, sql, applied, as, admin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the migrations create the schema, the users table and the seed rows", () => {
  const { db, applied, cleanup } = setup();
  assert.deepEqual(applied.slice(0, 4), ["0001_schema.sql", "0002_users.sql", "0003_seed.sql", "0004_auth.sql"]);
  const n = (t: string) => (db.prepare(`select count(*) n from ${t}`).all()[0] as { n: number }).n;
  assert.ok(n("entity_schemas") > 10);
  assert.ok(n("plans") >= 4);
  cleanup();
});

test("getContext: getUser → memberships → companies (data.ts context())", async () => {
  const { as, cleanup } = setup();
  const sb = as(owner);
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  assert.equal(error, null);
  assert.equal(user!.id, owner.id);
  assert.equal(user!.user_metadata.name, "เจ้าของ");
  // context() accepts pending invitations through the RPC map first.
  const { error: inviteError } = await sb.rpc("accept_invitations");
  assert.equal(inviteError, null);
  const { data: members, error: e1 } = await sb.from("memberships").select("*").eq("user_id", user!.id).eq("disabled", false);
  assert.equal(e1, null);
  assert.equal(members!.length, 1);
  assert.equal(members![0].role, "owner");
  assert.deepEqual(members![0].departments, []);
  assert.equal(members![0].disabled, false);
  const { data: company, error: e2 } = await sb.from("companies").select("*").eq("id", members![0].company_id as string).single();
  assert.equal(e2, null);
  assert.equal(company!.name, "บริษัท A");
  assert.equal(typeof company!.profile, "object");
  // The owner of A sees every member of A (memberships policy), the staff member only their own rows.
  assert.equal((await sb.from("memberships").select("id")).data!.length, 2);
  // Nobody signed in.
  const anon = as(null);
  const r = await anon.auth.getUser();
  assert.equal(r.data.user, null);
  assert.ok(r.error);
  const denied = await anon.from("entities").select("*");
  assert.equal(denied.error!.code, "42501");
  cleanup();
});

test("a person in several companies reads each by its own membership", async () => {
  const { as, cleanup } = setup();
  const sb = as(staff);
  // route.ts GET /companies: memberships with the embedded company.
  const { data, error } = await sb.from("memberships").select("company_id,role,companies(id,name)").eq("user_id", staff.id).eq("disabled", false);
  assert.equal(error, null);
  const byCo = Object.fromEntries(data!.map((m) => [m.company_id, m]));
  assert.deepEqual(byCo[A], { company_id: A, role: "staff", companies: { id: A, name: "บริษัท A" } });
  assert.deepEqual(byCo[B], { company_id: B, role: "owner", companies: { id: B, name: "บริษัท B" } });
  // In A (staff, Sales) the person sees Sales records and branches; in B (owner) everything.
  const inA = await sb.from("entities").select("data->>name").eq("company_id", A).is("archived_at", null);
  assert.deepEqual(inA.data!.map((r) => r.name).sort(), ["ลูกค้า Alpha", "ลูกค้า Beta", "สาขาหลัก"]);
  const inB = await sb.from("entities").select("id").eq("company_id", B);
  assert.equal(inB.data!.length, 1);
  // Without a company filter: rows of every company they belong to, each by that company's rule.
  const all = await sb.from("entities").select("company_id").is("archived_at", null);
  assert.equal(all.data!.length, 4);
  // audit_events is owner-only: B's rows (owner) but not A's (staff).
  assert.deepEqual((await sb.from("audit_events").select("company_id,action")).data, [{ company_id: B, action: "y" }]);
  // A company they do not belong to: nothing.
  assert.deepEqual((await as(outsider).from("entities").select("id").eq("company_id", A)).data, []);
  assert.deepEqual((await as(outsider).from("companies").select("id")).data, []);
  cleanup();
});

test("embeds: many-to-one via company_id and one-to-many journal_lines", async () => {
  const { as, admin, cleanup } = setup();
  const { data, error } = await as(owner).from("journal_entries").select("id,journal_lines(account_code,debit,credit)").eq("company_id", A);
  assert.equal(error, null);
  assert.equal(data!.length, 1);
  assert.deepEqual(
    (data![0].journal_lines as { account_code: string }[]).map((l) => l.account_code).sort(),
    ["1000", "5100"],
  );
  // Finance is not the staff member's department: no entries, no lines.
  assert.deepEqual((await as(staff).from("journal_entries").select("id,journal_lines(account_code)").eq("company_id", A)).data, []);
  // Service client: an embed that does not select the FK column (admin-settings.ts).
  const ev = await admin.from("audit_events").select("action,companies(name)").order("action");
  assert.deepEqual(ev.data, [
    { action: "x", companies: { name: "บริษัท A" } },
    { action: "y", companies: { name: "บริษัท B" } },
  ]);
  // Aliases and JSON paths (admin-console.ts, data.ts).
  const ent = await admin.from("entities").select("id,name:data->>name,amount:data->>amount,raw:data->amount").eq("kind", "expenses").single();
  assert.equal(ent.data!.name, "ค่าเช่า");
  assert.equal(ent.data!.amount, "1200");
  assert.equal(ent.data!.raw, 1200);
  cleanup();
});

test("count / head, range, order, filters", async () => {
  const { as, admin, cleanup } = setup();
  const sb = as(owner);
  const head = await sb.from("entities").select("id", { count: "exact", head: true }).eq("company_id", A);
  assert.equal(head.data, null);
  assert.equal(head.count, 5);
  // listEntities: count of the whole list with one page of rows.
  const page = await sb
    .from("entities")
    .select("*", { count: "exact" })
    .eq("company_id", A)
    .order("updated_at", { ascending: false })
    .range(0, 1)
    .is("archived_at", null)
    .ilike("data->>name", "%ลูกค้า%");
  assert.equal(page.count, 2);
  assert.equal(page.data!.length, 2);
  assert.equal(typeof page.data![0].data, "object");
  const archived = await sb.from("entities").select("id").eq("company_id", A).not("archived_at", "is", null);
  assert.equal(archived.data!.length, 1);
  // Staff: the count follows the read rule.
  assert.equal((await as(staff).from("entities").select("id", { count: "exact", head: true }).eq("company_id", A)).count, 4);
  // ilike on a JSON path is case-insensitive, like is not.
  assert.equal((await admin.from("entities").select("id").ilike("data->>email", "alpha@x.th")).data!.length, 1);
  assert.equal((await admin.from("entities").select("id").like("data->>email", "alpha@x.th")).data!.length, 0);
  assert.equal((await admin.from("entities").select("id").like("data->>email", "Alpha%")).data!.length, 1);
  // in / neq on a JSON path / gte on a date column / contains on an array column / match.
  assert.equal((await admin.from("entities").select("id").in("kind", ["branches", "expenses"])).data!.length, 2);
  assert.equal((await admin.from("entities").select("id").eq("company_id", A).neq("data->>status", "pending")).data!.length, 1);
  assert.equal((await admin.from("journal_entries").select("id").gte("date", "2026-11-01").lte("date", "2026-11-30")).data!.length, 1);
  assert.equal((await admin.from("memberships").select("user_id").contains("departments", ["Sales"])).data!.length, 1);
  assert.equal((await admin.from("memberships").select("user_id").match({ company_id: B, role: "owner" })).data!.length, 1);
  // Nulls sort like Postgres: last when ascending, first when descending.
  const ord = await admin.from("entities").select("archived_at").eq("company_id", A).order("archived_at", { ascending: false }).limit(1);
  assert.equal(ord.data![0].archived_at, null);
  cleanup();
});

test("or() in PostgREST syntax (home-extra.ts)", async () => {
  const { as, cleanup } = setup();
  assert.deepEqual(parseLogic('a.eq.1,and(b.in.(x,"y,z"),c.not.is.null)'), [
    { col: "a", op: "eq", value: "1", not: false },
    { group: "and", not: false, items: [{ col: "b", op: "in", value: ["x", "y,z"], not: false }, { col: "c", op: "is", value: null, not: true }] },
  ]);
  const { data, error } = await as(owner)
    .from("entities")
    .select("data->>name")
    .eq("company_id", A)
    .or("and(kind.in.(leaves,expenses),data->>status.eq.pending),and(kind.eq.purchases,data->>status.eq.draft),kind.eq.branches");
  assert.equal(error, null);
  assert.deepEqual(data!.map((r) => r.name).sort(), ["ค่าเช่า", "สาขาหลัก"]);
  const q = await as(owner).from("entities").select("id").or(`data->>status.eq.active,and(kind.eq.expenses,created_at.gte."2000-01-01T00:00:00+07:00")`);
  assert.equal(q.data!.length, 2);
  cleanup();
});

test("homeMe (home-extra.ts) and /team query shapes: ilike on a JSON path, created_by, line_users, ingestions, invitations", async () => {
  const { as, admin, db, cleanup } = setup();
  const run = (q: string, ...p: (string | number | null)[]) => db.prepare(q).run(...p);
  run("insert into entities(company_id,kind,department,data) values (?,?,?,?)", A, "employees", "HR", JSON.stringify({ name: "สมชาย", nickname: "ชาย", position: "Sales", code: "EMP-1", department: "Sales", level: "L2", email: "Staff@A.th" }));
  run("insert into entities(company_id,kind,department,data) values (?,?,?,?)", A, "employees", "HR", JSON.stringify({ name: "อื่น", email: "staffXa.th" }));
  run("insert into entities(company_id,kind,department,data,created_by,created_at) values (?,?,?,?,?,?)", A, "leaves", "HR", JSON.stringify({ name: "ลา", status: "pending" }), staff.id, "2026-11-02T00:00:00.000Z");
  run("insert into entities(company_id,kind,department,data,created_by,created_at) values (?,?,?,?,?,?)", A, "purchases", "Purchasing", JSON.stringify({ name: "ซื้อ", status: "approved" }), staff.id, "2026-11-03T00:00:00.000Z");
  run("insert into entities(company_id,kind,department,data,created_by) values (?,?,?,?,?)", A, "tasks", "Sales", JSON.stringify({ name: "งาน 1", status: "done" }), staff.id);
  run("insert into entities(company_id,kind,department,data,created_by) values (?,?,?,?,?)", A, "tasks", "Sales", JSON.stringify({ name: "งาน 2", status: "pending" }), staff.id);
  run("insert into entities(company_id,kind,department,data,created_by) values (?,?,?,?,?)", A, "tasks", "Sales", JSON.stringify({ name: "งาน 3" }), staff.id);
  run("insert into line_users(company_id,line_user_id,user_id) values (?,?,?)", A, "U-line-1", staff.id);
  run("insert into ingestions(company_id,template,department,status,source,source_user,created_at) values (?,?,?,?,?,?,?)", A, '{"name":"ใบลา"}', "HR", "review", "LINE", "U-line-1", "2026-11-04T00:00:00.000Z");
  run("insert into ingestions(company_id,template,department,status,created_by,created_at) values (?,?,?,?,?,?)", A, '{"name":"ขาย"}', "Sales", "approved", staff.id, "2026-11-05T00:00:00.000Z");
  run("insert into invitations(company_id,email,role,departments) values (?,?,?,?)", A, "new@a.th", "staff", '["Sales"]');
  const me = staff.id,
    email = "staff@a.th";
  // homeMe runs on the service client when there is one (else the person's): every query is pinned to the company and the person.
  for (const sb of [admin, as(owner)]) {
    const links = await sb.from("line_users").select("line_user_id").eq("company_id", A).eq("user_id", me);
    assert.equal(links.error, null);
    // line_users has no RLS policy: only the service role sees the link (a person reads no rows, no error).
    assert.deepEqual(links.data, sb === admin ? [{ line_user_id: "U-line-1" }] : []);
    const emp = await sb
      .from("entities")
      .select("id,name:data->>name,nickname:data->>nickname,position:data->>position,code:data->>code,department:data->>department,level:data->>level")
      .eq("company_id", A)
      .eq("kind", "employees")
      .is("archived_at", null)
      .ilike("data->>email", email.replace(/[%_\\]/g, "\\$&"))
      .limit(1);
    assert.equal(emp.error, null);
    assert.equal(emp.data!.length, 1);
    const { id, ...rest } = emp.data![0] as Record<string, unknown>;
    assert.ok(id);
    assert.deepEqual(rest, { name: "สมชาย", nickname: "ชาย", position: "Sales", code: "EMP-1", department: "Sales", level: "L2" });
    // An escaped _ matches only itself (staff\_a.th does not match staffXa.th).
    const none = await sb.from("entities").select("id").eq("company_id", A).ilike("data->>email", "staff\\_a.th");
    assert.deepEqual(none.data, []);
    const ents = await sb.from("entities").select("id,kind,data,created_at").eq("company_id", A).eq("created_by", me).is("archived_at", null).order("created_at", { ascending: false }).limit(40);
    assert.equal(ents.error, null);
    assert.equal(ents.data!.length, 5);
    assert.ok((ents.data![0].data as { name: string }).name.startsWith("งาน"));
    const waiting = await sb
      .from("entities")
      .select("id,kind,data,created_at")
      .eq("company_id", A)
      .eq("created_by", me)
      .is("archived_at", null)
      .or("and(kind.in.(leaves,expenses),data->>status.eq.pending),and(kind.eq.purchases,data->>status.eq.draft)")
      .limit(500);
    assert.deepEqual(
      waiting.data!.map((r) => r.kind),
      ["leaves"],
    );
    const ingSelect = "id,status,target_kind,template,values,created_at";
    const ingMine = await sb.from("ingestions").select(ingSelect).eq("company_id", A).eq("created_by", me).order("created_at", { ascending: false }).limit(40);
    assert.equal(ingMine.error, null);
    assert.deepEqual(
      ingMine.data!.map((r) => r.template),
      [{ name: "ขาย" }],
    );
    const ingLine = await sb.from("ingestions").select(ingSelect).eq("company_id", A).in("source_user", ["U-line-1"]).order("created_at", { ascending: false }).limit(40);
    assert.deepEqual(
      ingLine.data!.map((r) => r.status),
      ["review"],
    );
    // neq on a JSON path leaves out rows without the field, like Postgres (null <> 'done' is not true).
    const tasks = await sb.from("entities").select("created_by,data").eq("company_id", A).eq("kind", "tasks").is("archived_at", null).neq("data->>status", "done").limit(1000);
    assert.deepEqual(
      tasks.data!.map((r) => (r.data as { name: string }).name),
      ["งาน 2"],
    );
    // /team: the company's members and invitations, one invitation by email, one member by id.
    const [members, invites] = await Promise.all([sb.from("memberships").select("*").eq("company_id", A), sb.from("invitations").select("*").eq("company_id", A)]);
    assert.equal(members.error, null);
    assert.equal(members.data!.length, 2);
    assert.deepEqual(members.data!.find((m) => m.user_id === me)!.read_departments, []);
    assert.deepEqual(
      invites.data!.map((i) => [i.email, i.departments]),
      [["new@a.th", ["Sales"]]],
    );
    const inv = await sb.from("invitations").select("role,departments,accepted_at").eq("company_id", A).eq("email", "new@a.th").maybeSingle();
    assert.deepEqual(inv.data, { role: "staff", departments: ["Sales"], accepted_at: null });
    const mid = members.data!.find((m) => m.user_id === me)!.id as string;
    const m1 = await sb.from("memberships").select("email,name").eq("company_id", A).eq("id", mid).maybeSingle();
    assert.deepEqual(m1.data, { email: "staff@a.th", name: "" });
    const m2 = await sb.from("memberships").select("email,role").eq("company_id", A).eq("id", mid).maybeSingle();
    assert.deepEqual(m2.data, { email: "staff@a.th", role: "staff" });
  }
  // A staff member sees only their own membership and none of the invitations (owner only).
  const st = as(staff);
  assert.equal((await st.from("memberships").select("*").eq("company_id", A)).data!.length, 1);
  assert.deepEqual((await st.from("invitations").select("*").eq("company_id", A)).data, []);
  cleanup();
});

test("read_departments (ดู) let a member read a department but never write it", async () => {
  const { as, db, cleanup } = setup();
  const names = async () => ((await as(staff).from("entities").select("data->>name").eq("company_id", A).is("archived_at", null)).data || []).map((r) => r.name).sort();
  assert.deepEqual(await names(), ["ลูกค้า Alpha", "ลูกค้า Beta", "สาขาหลัก"]);
  db.prepare("update memberships set read_departments=? where company_id=? and user_id=?").run('["Finance"]', A, staff.id);
  assert.deepEqual(await names(), ["ค่าเช่า", "ลูกค้า Alpha", "ลูกค้า Beta", "สาขาหลัก"]);
  // Journal entries (can_read_dept Finance) open up too; saving a Finance record still needs ใช้งาน.
  assert.equal((await as(staff).from("journal_entries").select("id").eq("company_id", A)).data!.length, 1);
  const { error } = await as(staff).rpc("save_entity", { p_company: A, p_kind: "expenses", p_data: { name: "x", category: "อื่นๆ", date: "2026-11-01", amount: 1, status: "pending" } });
  assert.match(String(error?.message), /ไม่มีสิทธิ์/);
  const ok = await as(staff).rpc("save_entity", { p_company: A, p_kind: "customers", p_data: { name: "ใหม่", status: "active" } });
  assert.equal(ok.error, null);
  cleanup();
});

test("single / maybeSingle answer PGRST116 like PostgREST", async () => {
  const { as, cleanup } = setup();
  const sb = as(owner);
  const many = await sb.from("entities").select("id").eq("company_id", A).single();
  assert.equal(many.data, null);
  assert.equal(many.error!.code, "PGRST116");
  assert.equal(many.error!.message, "JSON object requested, multiple (or no) rows returned");
  const none = await sb.from("entities").select("id").eq("kind", "nothing").single();
  assert.equal(none.error!.code, "PGRST116");
  const maybeNone = await sb.from("entities").select("id").eq("kind", "nothing").maybeSingle();
  assert.deepEqual([maybeNone.data, maybeNone.error], [null, null]);
  const maybeMany = await sb.from("entities").select("id").eq("company_id", A).maybeSingle();
  assert.equal(maybeMany.error!.code, "PGRST116");
  cleanup();
});

test("writes: the user client may not write tables directly; the service client may", async () => {
  const { as, admin, cleanup } = setup();
  const sb = as(owner);
  const ins = await sb.from("entities").insert({ company_id: A, kind: "customers", department: "Sales", data: { name: "x" } });
  assert.equal(ins.error!.code, "42501");
  assert.equal(ins.error!.message, "permission denied for table entities");
  const upd = await sb.from("entities").update({ department: "Finance" }).eq("company_id", A);
  assert.equal(upd.error!.code, "42501");
  // Tables left granted with RLS on and no write policy: inserts break RLS, updates silently change nothing.
  const rls = await sb.from("project_stages").insert({ company_id: A, project_id: JE, key: "x", ordinal: 0, department: "Sales", label: "x" });
  assert.equal(rls.error!.message, 'new row violates row-level security policy for table "project_stages"');
  assert.deepEqual(await sb.from("project_stages").update({ label: "y" }).eq("company_id", A).select(), { data: [], error: null, count: null, status: 200, statusText: "OK" });

  // Service: insert → select back, update, upsert, delete.
  const made = await admin.from("audit_events").insert({ company_id: A, action: "admin_test", target: "t" }).select("id,action").single();
  assert.equal(made.error, null);
  assert.equal(made.data!.action, "admin_test");
  const changed = await admin.from("audit_events").update({ target: "u" }).eq("id", made.data!.id as string).select("target");
  assert.deepEqual(changed.data, [{ target: "u" }]);
  const up1 = await admin.from("line_listen").upsert({ group_id: "g1", line_user: "u1", company_id: A, mode: "any", until: "2026-12-01T00:00:00.000Z", meta: { a: [1] } }).select("mode,meta");
  assert.equal(up1.error, null, JSON.stringify(up1.error));
  assert.deepEqual(up1.data, [{ mode: "any", meta: { a: [1] } }]);
  const up2 = await admin.from("line_listen").upsert({ group_id: "g1", line_user: "u1", company_id: A, mode: "files", until: "2026-12-01T00:00:00.000Z" }).select("mode");
  assert.deepEqual(up2.data, [{ mode: "files" }]);
  const ign = await admin.from("line_listen").upsert({ group_id: "g1", line_user: "u1", company_id: A, mode: "any", until: "2026-12-01T00:00:00.000Z" }, { ignoreDuplicates: true }).select("mode");
  assert.deepEqual(ign.data, []);
  // A duplicate key answers 23505 (dbError → "รหัสหรือเลขอ้างอิงนี้มีอยู่แล้ว").
  const dup = await admin.from("companies").insert({ id: A, name: "ซ้ำ" });
  assert.equal(dup.error!.code, "23505");
  // Several rows (one JSON parameter: D1 takes at most 100 bound parameters) and long in() lists.
  const bulk = await admin
    .from("notification_outbox")
    .insert(Array.from({ length: 60 }, (_, i) => ({ company_id: A, target: `g${i}`, body: `ข้อความ ${i}`, payload: { n: i } })))
    .select("target,payload");
  assert.equal(bulk.error, null, JSON.stringify(bulk.error));
  assert.equal(bulk.data!.length, 60);
  assert.deepEqual(bulk.data![59], { target: "g59", payload: { n: 59 } });
  const many = await admin.from("notification_outbox").select("id", { count: "exact", head: true }).in("target", Array.from({ length: 300 }, (_, i) => `g${i}`));
  assert.equal(many.count, 60);
  const del = await admin.from("audit_events").delete().eq("action", "admin_test");
  assert.deepEqual([del.error, del.data], [null, null]);
  assert.equal((await admin.from("audit_events").select("id", { count: "exact", head: true })).count, 2);
  cleanup();
});

test("storage: bucket rules, upload → download, signed links", async () => {
  const { as, admin, cleanup } = setup();
  const path = `${A}/Finance/slip.pdf`;
  const pdf = new TextEncoder().encode("%PDF-1.4 test");
  // Staff (Sales only) may not put a file in Finance; the owner may.
  const no = await as(staff).storage.from("eliteflow-files").upload(path, pdf, { contentType: "application/pdf" });
  assert.equal(no.error!.message, "new row violates row-level security policy");
  const ok = await as(owner).storage.from("eliteflow-files").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  assert.equal(ok.error, null);
  const again = await as(owner).storage.from("eliteflow-files").upload(path, pdf, { contentType: "application/pdf" });
  assert.equal(again.error!.message, "The resource already exists");
  const badType = await as(owner).storage.from("eliteflow-files").upload(`${A}/Finance/x.exe`, pdf, { contentType: "application/x-msdownload" });
  assert.equal(badType.error!.statusCode, "415");
  // Reading follows the department too.
  assert.equal((await as(staff).storage.from("eliteflow-files").download(path)).error!.message, "Object not found");
  const got = await as(owner).storage.from("eliteflow-files").download(path);
  assert.equal(got.error, null);
  assert.deepEqual(new Uint8Array(await got.data!.arrayBuffer()), pdf);
  assert.equal(got.data!.type, "application/pdf");
  // list: the folder's files.
  const listed = await admin.storage.from("eliteflow-files").list(`${A}/Finance`);
  assert.deepEqual(
    listed.data!.map((f) => f.name),
    ["slip.pdf"],
  );
  // Signed download link: verifies for this path only, and carries the download name.
  const signed = await as(owner).storage.from("eliteflow-files").createSignedUrl(path, 60, { download: "สลิป.pdf" });
  const url = new URL(signed.data!.signedUrl);
  assert.equal(url.origin, "http://app.test");
  assert.equal(url.pathname, `/api/blob/eliteflow-files/${A}/Finance/slip.pdf`);
  assert.deepEqual(await verifyBlobUrl(SECRET, "get", "eliteflow-files", path, url.searchParams), { extra: "สลิป.pdf" });
  assert.equal(await verifyBlobUrl(SECRET, "get", "eliteflow-files", `${A}/Finance/other.pdf`, url.searchParams), null);
  assert.equal(await verifyBlobUrl("wrong", "get", "eliteflow-files", path, url.searchParams), null);
  assert.equal(await verifyBlobUrl(SECRET, "put", "eliteflow-files", path, url.searchParams), null);
  assert.ok((await as(staff).storage.from("eliteflow-files").createSignedUrl(path, 60)).error);
  // Signed upload link (files.ts direct upload): allowed by the insert rule at signing time.
  const up = await as(owner).storage.from("eliteflow-files").createSignedUploadUrl(`${A}/Finance/next.pdf`);
  const upUrl = new URL(up.data!.signedUrl);
  assert.ok(await verifyBlobUrl(SECRET, "put", "eliteflow-files", `${A}/Finance/next.pdf`, upUrl.searchParams));
  assert.ok((await as(staff).storage.from("eliteflow-files").createSignedUploadUrl(`${A}/Finance/next.pdf`)).error);
  // Avatars: only one's own file.
  const webp = new Uint8Array([1, 2, 3]);
  assert.equal((await as(staff).storage.from("eliteflow-avatars").upload(`${staff.id}.webp`, webp, { contentType: "image/webp", upsert: true })).error, null);
  assert.ok((await as(staff).storage.from("eliteflow-avatars").upload(`${owner.id}.webp`, webp, { contentType: "image/webp", upsert: true })).error);
  // remove: only what the person may delete (eliteflow-files: owners); nothing else, no error.
  assert.deepEqual((await as(staff).storage.from("eliteflow-files").remove([path])).data, []);
  assert.equal((await as(owner).storage.from("eliteflow-files").remove([path])).data!.length, 1);
  assert.equal((await admin.storage.from("eliteflow-files").download(path)).error!.message, "Object not found");
  // Public bucket link.
  assert.equal(admin.storage.from("eliteflow-promo").getPublicUrl("a/b.png").data.publicUrl, "http://app.test/api/blob/eliteflow-promo/a/b.png");
  cleanup();
});

test("rpc: unknown names, membership checks, the exact error text", async () => {
  const { as, admin, cleanup } = setup();
  const unknown = await as(owner).rpc("no_such_function", { p_company: A });
  assert.equal(unknown.data, null);
  assert.equal(unknown.error!.code, "PGRST202");
  // A handler registered for this test only.
  rpcs.__test_whoami = async (caller, args) => {
    const t = await caller.tenantFor(String(args.p_company));
    if (args.p_fail) fail("ใส่ชื่อก่อน");
    return { user: caller.userId, role: t.viewer.role, departments: t.viewer.departments, service: caller.service };
  };
  try {
    assert.deepEqual((await as(staff).rpc("__test_whoami", { p_company: A })).data, { user: staff.id, role: "staff", departments: ["Sales"], service: false });
    assert.deepEqual((await as(staff).rpc("__test_whoami", { p_company: B })).data, { user: staff.id, role: "owner", departments: [], service: false });
    const denied = await as(outsider).rpc("__test_whoami", { p_company: A });
    assert.deepEqual([denied.data, denied.error!.message, denied.error!.code], [null, "ไม่มีสิทธิ์", "P0001"]);
    const raised = await as(owner).rpc("__test_whoami", { p_company: A, p_fail: true });
    assert.equal(raised.error!.message, "ใส่ชื่อก่อน");
    assert.deepEqual((await admin.rpc("__test_whoami", { p_company: A })).data, { user: null, role: "owner", departments: [], service: true });
    assert.equal((await as(null).rpc("__test_whoami", { p_company: A })).error!.code, "42501");
    // .single() on an rpc result.
    assert.equal((await as(owner).rpc("__test_whoami", { p_company: A }).single()).error, null);
  } finally {
    delete rpcs.__test_whoami;
  }
  cleanup();
});
