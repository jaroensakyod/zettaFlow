import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const owner = "10000000-0000-4000-8000-000000000001",
  admin = "10000000-0000-4000-8000-000000000009";
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text)returns text[]language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@test.local',now()),('${admin}','admin@eliteflow.test',now());`);
  for (const file of (await readdir("supabase/migrations")).sort())
    await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
  const login = async (id: string | null, email = "") => {
    await db.exec("reset role;");
    if (!id) return db.exec("set role service_role;");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id, email]);
    await db.exec("set role authenticated;");
  };
  return { db, login };
}
const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

test("support view: an admin reads a company read-only while the view is open, the customer sees and ends it", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('ลูกค้า A')as id")).id;
    await one(db, "select * from save_entity($1,'customers',$2,null,null)", [c, JSON.stringify({ name: "คุณสมชาย", phone: "0812345678", status: "active" })]);

    // Not a member and no view: nothing.
    await login(admin, "admin@eliteflow.test");
    assert.equal((await one<{ n: number }>(db, "select count(*)::int n from entities where company_id=$1", [c])).n, 0);
    assert.equal((await one<{ r: string | null }>(db, "select member_role($1) r", [c])).r, null);

    // The server opens a view (service role).
    await login(null);
    const v = await one<{ id: string }>(db, "insert into support_access(company_id,user_id,admin_email,reason,expires_at)values($1,$2,'admin@eliteflow.test','ลูกค้าขอให้ช่วยดูปัญหา',now()+interval '30 minutes')returning id", [c, admin]);

    await login(admin, "admin@eliteflow.test");
    assert.equal((await one<{ r: string }>(db, "select member_role($1) r", [c])).r, "viewer");
    assert.equal((await one<{ n: number }>(db, "select count(*)::int n from entities where company_id=$1", [c])).n, 1);
    assert.equal((await one<{ ok: boolean }>(db, "select can_read_dept($1,'HR') ok", [c])).ok, true);
    assert.equal((await one<{ ok: boolean }>(db, "select can_write_dept($1,'Sales') ok", [c])).ok, false);
    await assert.rejects(one(db, "select * from save_entity($1,'customers',$2,null,null)", [c, JSON.stringify({ name: "แอดมินแก้", status: "active" })]));
    // The admin cannot see (or end) the view list of the company.
    assert.equal((await one<{ n: number }>(db, "select count(*)::int n from support_access")).n, 0);
    await assert.rejects(one(db, "select * from end_support_access($1)", [v.id]), /เฉพาะเจ้าของหรือผู้จัดการ/);

    // The owner sees who looked and why, and ends it.
    await login(owner, "owner@test.local");
    const seen = await one<{ admin_email: string; reason: string }>(db, "select admin_email,reason from support_access where company_id=$1", [c]);
    assert.deepEqual(seen, { admin_email: "admin@eliteflow.test", reason: "ลูกค้าขอให้ช่วยดูปัญหา" });
    const ended = await one<{ ended_at: string | null; ended_by: string }>(db, "select ended_at,ended_by from end_support_access($1)", [v.id]);
    assert.ok(ended.ended_at);
    assert.match(ended.ended_by, /owner@test.local/);

    await login(admin, "admin@eliteflow.test");
    assert.equal((await one<{ n: number }>(db, "select count(*)::int n from entities where company_id=$1", [c])).n, 0);

    // An expired view gives nothing either.
    await login(null);
    await db.query("insert into support_access(company_id,user_id,admin_email,reason,expires_at)values($1,$2,'admin@eliteflow.test','ตรวจสอบย้อนหลัง',now()-interval '1 minute')", [c, admin]);
    await login(admin, "admin@eliteflow.test");
    assert.equal((await one<{ r: string | null }>(db, "select member_role($1) r", [c])).r, null);
  } finally {
    await db.close();
  }
});
