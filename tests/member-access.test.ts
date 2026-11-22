import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "10000000-0000-4000-8000-000000000001",
  staff = "10000000-0000-4000-8000-000000000002",
  viewer = "10000000-0000-4000-8000-000000000003";
const emails: Record<string, string> = { [owner]: "owner@test.local", [staff]: "staff@test.local", [viewer]: "viewer@test.local" };
test("member access: ดู (read_departments) reads without writing, ล็อก hides, set_member_access rules", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text)returns text[]language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@test.local',now()),('${staff}','staff@test.local',now()),('${viewer}','viewer@test.local',now());`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const login = async (id: string) => {
      await db.exec("reset role;");
      await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id, emails[id]]);
      await db.exec("set role authenticated;");
    };
    const val = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0] as T;
    const expense = JSON.stringify({ name: "ค่าเช่าเดือนนี้", category: "ค่าเช่า", date: "2026-11-01", amount: 1000, status: "pending" });

    await login(owner);
    const c = await val<string>("select create_company('Access Co')");
    await db.query("select (save_entity($1,'expenses',$2)).id", [c, expense]);
    await db.query("select invite_member($1,'staff@test.local','staff',array['Sales'])", [c]);
    await db.query("select invite_member($1,'viewer@test.local','viewer',array['Finance'])", [c]);
    await login(staff);
    await db.query("select accept_invitations()");
    await login(viewer);
    await db.query("select accept_invitations()");
    await db.exec("reset role;");
    const ids = Object.fromEntries(
      (await db.query<{ id: string; user_id: string }>("select id,user_id from memberships where company_id=$1", [c])).rows.map((r) => [r.user_id, r.id]),
    );

    // Owner: staff gets ดู on Finance (ใช้งาน on Sales kept), a department in both lists keeps the higher level.
    await login(owner);
    const m = await val<{ role: string; departments: string[]; read_departments: string[] }>(
      "select to_jsonb(set_member_access($1,$2,'staff',array['Sales'],array['Finance','Sales']))",
      [c, ids[staff]],
    );
    assert.deepEqual(m.departments, ["Sales"]);
    assert.deepEqual(m.read_departments, ["Finance"]);
    assert.equal(m.role, "staff");
    for (const d of ["Finance", "HR", "Sales"]) {
      assert.equal(await val("select can_read_dept($1,$2)", [c, d]), true, "owner reads " + d);
      assert.equal(await val("select can_write_dept($1,$2)", [c, d]), true, "owner writes " + d);
    }
    // Rules: the owner's own row, unknown departments, nothing at all, an owner role are refused.
    await assert.rejects(db.query("select set_member_access($1,$2,'manager',array['Sales'],'{}')", [c, ids[owner]]), /เจ้าของบริษัท/);
    await assert.rejects(db.query("select set_member_access($1,$2,'staff',array['Nope'],'{}')", [c, ids[staff]]), /ไม่รู้จักแผนก/);
    await assert.rejects(db.query("select set_member_access($1,$2,'staff','{}',array['Nope'])", [c, ids[staff]]), /ไม่รู้จักแผนก/);
    await assert.rejects(db.query("select set_member_access($1,$2,'staff','{}','{}')", [c, ids[staff]]), /อย่างน้อย 1/);
    await assert.rejects(db.query("select set_member_access($1,$2,'owner',array['Sales'],'{}')", [c, ids[staff]]), /บทบาท/);
    await db.exec("reset role;");
    assert.equal(await val("select count(*)::int from audit_events where company_id=$1 and action='member_access_updated'", [c]), 1);

    // Staff: Finance rows are readable, not writable; HR (ล็อก) is not readable; Sales is ใช้งาน.
    await login(staff);
    assert.equal(await val("select can_read_dept($1,'Finance')", [c]), true);
    assert.equal(await val("select can_write_dept($1,'Finance')", [c]), false);
    assert.equal(await val("select can_read_dept($1,'HR')", [c]), false);
    assert.equal(await val("select can_write_dept($1,'HR')", [c]), false);
    assert.equal(await val("select can_write_dept($1,'Sales')", [c]), true);
    assert.equal(await val("select count(*)::int from entities where kind='expenses'"), 1);
    await assert.rejects(db.query("select save_entity($1,'expenses',$2)", [c, expense]), /ไม่มีสิทธิ์/);
    // Only the owner sets access.
    await assert.rejects(db.query("select set_member_access($1,$2,'manager',array['Finance'],'{}')", [c, ids[staff]]), /เฉพาะเจ้าของบริษัท/);

    // Viewer: ใช้งาน on Finance still reads only (the role decides), ล็อก Sales hides it.
    await login(viewer);
    assert.equal(await val("select can_read_dept($1,'Finance')", [c]), true);
    assert.equal(await val("select can_write_dept($1,'Finance')", [c]), false);
    assert.equal(await val("select can_read_dept($1,'Sales')", [c]), false);
    assert.equal(await val("select count(*)::int from entities where kind='expenses'"), 1);
    await assert.rejects(db.query("select save_entity($1,'expenses',$2)", [c, expense]), /ไม่มีสิทธิ์/);

    // ล็อก Finance for the staff member: the rows disappear.
    await login(owner);
    await db.query("select set_member_access($1,$2,'staff',array['Sales'],'{}')", [c, ids[staff]]);
    await login(staff);
    assert.equal(await val("select can_read_dept($1,'Finance')", [c]), false);
    assert.equal(await val("select count(*)::int from entities where kind='expenses'"), 0);

    // edit_member (ตั้งค่า → ทีม) keeps ดู departments unless it is given new ones.
    await login(owner);
    await db.query("select set_member_access($1,$2,'staff',array['Sales'],array['Finance'])", [c, ids[staff]]);
    await db.query("select edit_member($1,$2,'manager',array['Sales'],false)", [c, ids[staff]]);
    await db.exec("reset role;");
    let row = (await db.query<{ role: string; read_departments: string[] }>("select role,read_departments from memberships where id=$1", [ids[staff]])).rows[0];
    assert.deepEqual([row.role, row.read_departments], ["manager", ["Finance"]]);
    await login(owner);
    await db.query("select edit_member($1,$2,'staff',array['Finance'],false,array['Finance','HR'])", [c, ids[staff]]);
    await db.exec("reset role;");
    row = (await db.query<{ role: string; read_departments: string[] }>("select role,read_departments from memberships where id=$1", [ids[staff]])).rows[0];
    assert.deepEqual(row.read_departments, ["HR"]);
    await login(staff);
    await assert.rejects(db.query("select edit_member($1,$2,'manager',array['Sales'],false)", [c, ids[staff]]), /เฉพาะเจ้าของบริษัท/);
  } finally {
    await db.close();
  }
});
