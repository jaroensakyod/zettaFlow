import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
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
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@test.local',now()),('${other}','other@test.local',now());`);
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
const rejects = (p: Promise<unknown>, msg: RegExp) => assert.rejects(p, (e: Error) => msg.test(e.message));

test("coin top-up → operator confirm → buy module once, with no overspend or slip reuse", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('A')as id")).id;
    await rejects(db.query("select buy_module($1,'hr')", [c]), /เหรียญไม่พอ/);
    await rejects(db.query("select request_topup($1,77,null,'{}','REF1')", [c]), /แพ็กเหรียญ/);
    const t = await one<{ id: string; amount: string }>(db, "select * from request_topup($1,100,null,'{}','REF1')", [c]);
    assert.equal(Number(t.amount), 900);
    await rejects(db.query("select request_topup($1,50,null,'{}','REF1')", [c]), /ถูกใช้แล้ว/);
    // owners cannot confirm their own top-up
    await rejects(db.query("select confirm_topup($1,'verified')", [t.id]), /permission denied/);
    await login(null);
    await db.query("select confirm_topup($1,'verified')", [t.id]);
    await rejects(db.query("select confirm_topup($1,'verified')", [t.id]), /รายการไม่ถูกต้อง/);
    await login(owner, "owner@test.local");
    assert.equal((await one<{ balance: number }>(db, "select balance from coin_wallets where company_id=$1", [c])).balance, 100);
    await db.query("select buy_module($1,'hr')", [c]);
    await rejects(db.query("select buy_module($1,'hr')", [c]), /ซื้อระบบนี้แล้ว/);
    await rejects(db.query("select buy_module($1,'legal')", [c]), /เหรียญไม่พอ/);
    assert.equal((await one<{ balance: number }>(db, "select balance from coin_wallets where company_id=$1", [c])).balance, 0);
    assert.deepEqual(
      (await db.query<{ delta: number; reason: string }>("select delta,reason from coin_ledger where company_id=$1 order by created_at,delta desc", [c])).rows,
      [{ delta: 100, reason: "topup" }, { delta: -100, reason: "purchase" }],
    );
    // another tenant sees nothing and cannot buy for this company
    await login(other, "other@test.local");
    assert.equal((await db.query("select * from company_modules where company_id=$1", [c])).rows.length, 0);
    await rejects(db.query("select buy_module($1,'it')", [c]), /เฉพาะเจ้าของ/);
  } finally {
    await db.close();
  }
});

test("expenses accept the new tax-document fields", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('B')as id")).id;
    const r = await one<{ data: Record<string, unknown> }>(db, "select data from save_entity($1,'expenses',$2)", [
      c,
      { name: "ค่าบริการ", category: "ค่าบริการ", date: "2026-10-01", amount: 10700, vatMode: "included", whtRate: "3", docType: "ใบกำกับภาษี", docNo: "INV-1", status: "pending" },
    ]);
    assert.equal(r.data.whtRate, "3");
    assert.equal(r.data.docNo, "INV-1");
    await rejects(db.query("select save_entity($1,'expenses',$2)", [c, { name: "x", category: "อื่นๆ", date: "2026-10-01", amount: 1, vatMode: "maybe", status: "pending" }]), /ตัวเลือกไม่ถูกต้อง/);
  } finally {
    await db.close();
  }
});
