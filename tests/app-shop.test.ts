import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "10000000-0000-4000-8000-000000000001",
  viewer = "10000000-0000-4000-8000-000000000002",
  manager = "10000000-0000-4000-8000-000000000003";
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
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@test.local',now()),('${viewer}','viewer@test.local',now()),('${manager}','manager@test.local',now());`);
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
const balance = async (db: PGlite, c: string) => (await one<{ balance: number }>(db, "select balance from coin_wallets where company_id=$1", [c])).balance;

test("app shop: coins, buy once, monthly renew, activate only owned, roles", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('Shop')as id")).id;
    // not enough coins (no wallet yet)
    await rejects(db.query("select shop_buy($1,'siri_style')", [c]), /เหรียญไม่พอ/);
    await login(null);
    await db.query("insert into coin_wallets(company_id,balance)values($1,2000)", [c]);
    await db.query("insert into memberships(company_id,user_id,email,role)values($1,$2,'viewer@test.local','viewer'),($1,$3,'manager@test.local','manager')", [c, viewer, manager]);
    // viewer can neither buy nor activate
    await login(viewer, "viewer@test.local");
    await rejects(db.query("select shop_buy($1,'siri_style')", [c]), /เฉพาะเจ้าของหรือผู้จัดการ/);
    await rejects(db.query("select shop_activate($1,'theme','modern_purple')", [c]), /เฉพาะเจ้าของหรือผู้จัดการ/);
    // owner buys a character; the second purchase is refused and nothing more is charged
    await login(owner, "owner@test.local");
    await db.query("select shop_buy($1,'siri_style')", [c]);
    await rejects(db.query("select shop_buy($1,'siri_style')", [c]), /ซื้อรายการนี้แล้ว/);
    await rejects(db.query("select shop_buy($1,'modern_purple')", [c]), /ฟรี/);
    await rejects(db.query("select shop_buy($1,'nope')", [c]), /ไม่พบสินค้า/);
    assert.equal(await balance(db, c), 1700);
    // a manager buys a monthly system and renews it: 30 more days on top of the current expiry
    await login(manager, "manager@test.local");
    const s1 = await one<{ expires_at: Date }>(db, "select * from shop_buy($1,'restaurant_cafe')", [c]);
    assert.ok(s1.expires_at);
    await rejects(db.query("select shop_buy($1,'medical_clinic')", [c]), /เหรียญไม่พอ/);
    await login(null);
    await db.query("update coin_wallets set balance=balance+900 where company_id=$1", [c]);
    await login(manager, "manager@test.local");
    const s2 = await one<{ expires_at: Date }>(db, "select * from shop_buy($1,'restaurant_cafe')", [c]);
    const days = (new Date(s2.expires_at).getTime() - new Date(s1.expires_at).getTime()) / 86400000;
    assert.ok(Math.abs(days - 30) < 0.01, "renewal adds 30 days, got " + days);
    assert.equal(await balance(db, c), 1700 - 900 + 900 - 900);
    // ledger rows are purchases with a shop: ref
    assert.deepEqual(
      (await db.query<{ delta: number; ref: string }>("select delta,ref from coin_ledger where company_id=$1 and reason='purchase' order by created_at,ref", [c])).rows.map((r) => r.ref).sort(),
      ["shop:restaurant_cafe", "shop:restaurant_cafe", "shop:siri_style"],
    );
    // activation: only owned or free items, of the right kind
    await rejects(db.query("select shop_activate($1,'theme','soft_pink')", [c]), /ยังไม่ได้ซื้อ/);
    await rejects(db.query("select shop_activate($1,'theme','siri_style')", [c]), /ไม่พบสินค้า/);
    await rejects(db.query("select shop_activate($1,'system','restaurant_cafe')", [c]), /ประเภทไม่ถูกต้อง/);
    await db.query("select shop_activate($1,'character','siri_style')", [c]);
    await db.query("select shop_activate($1,'theme','modern_purple')", [c]);
    const set = await one<{ theme: string; character: string }>(db, "select theme,character from company_shop_settings where company_id=$1", [c]);
    assert.deepEqual({ ...set }, { theme: "modern_purple", character: "siri_style" });
    // the viewer can read what is owned and active (for the theme/character), but not change it
    await login(viewer, "viewer@test.local");
    assert.equal((await db.query("select * from company_shop_items where company_id=$1", [c])).rows.length, 2);
    assert.equal((await one<{ character: string }>(db, "select character from company_shop_settings where company_id=$1", [c])).character, "siri_style");
    await rejects(db.query("insert into company_shop_items(company_id,item_id,kind,price_coins)values($1,'soft_pink','theme',0)", [c]), /permission denied/);
  } finally {
    await db.close();
  }
});
