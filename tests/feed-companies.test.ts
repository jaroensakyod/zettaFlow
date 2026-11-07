import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "10000000-0000-4000-8000-000000000001",
  bob = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";
test("feed shows every real company, including ones that have not posted", async () => {
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
    insert into auth.users(id,email,email_confirmed_at)values('${alice}','alice@test.local',now()),('${bob}','bob@test.local',now()),('${stranger}','x@test.local',now());`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec(
        (await readFile("supabase/migrations/" + file, "utf8")).replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    const login = async (id: string) => {
      await db.exec("reset role;");
      await db.query(
        `select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`,
        [id, id.slice(-1) + "@test.local"],
      );
      await db.exec("set role authenticated;");
    };
    const val = async <T>(sql: string, params: unknown[] = []) =>
      Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0];

    await login(alice);
    const a = await val<string>("select create_company('Alice Co')");
    await login(bob);
    const b = await val<string>("select create_company('Bob Co')");
    await login(stranger);
    const s = await val<string>("select create_company('Stranger Co')");
    // Nobody has posted yet: suggestions and the company list still show the other real companies.
    await login(alice);
    const sug = await val<{ name: string; reason: string }[]>("select feed_suggest($1)", [a]);
    assert.deepEqual(sug.map((x) => x.name).sort(), ["Bob Co", "Stranger Co"]);
    assert.ok(sug.every((x) => x.reason === "เพิ่งเข้าร่วมเครือข่าย"));
    const all = await val<{ name: string; posts: number; following: boolean; about: string }[]>("select feed_companies($1)", [a]);
    assert.deepEqual(all.map((x) => x.name).sort(), ["Bob Co", "Stranger Co"]);
    assert.ok(all.every((x) => x.posts === 0 && x.following === false));
    // Only the public card: no tax id, address, bank account.
    assert.ok(all.every((x) => !("profile" in x) && !("taxId" in x)));
    // Search, follow state, and a company that posts comes first.
    assert.deepEqual((await val<{ name: string }[]>("select feed_companies($1,'bob')", [a])).map((x) => x.name), ["Bob Co"]);
    await db.query("select feed_follow($1,$2)", [a, b]);
    await login(bob);
    await db.query("select feed_post($1,$2,'post','สวัสดีเครือข่าย','{}','{}')", [b, "20000000-0000-4000-8000-0000000000c1"]);
    await login(alice);
    const after = await val<{ name: string; posts: number; following: boolean }[]>("select feed_companies($1)", [a]);
    assert.deepEqual(after.map((x) => [x.name, x.posts, x.following]), [["Bob Co", 1, true], ["Stranger Co", 0, false]]);
    assert.deepEqual((await val<{ name: string }[]>("select feed_suggest($1)", [a])).map((x) => x.name), ["Stranger Co"]);
    // Outsiders (no membership in the asking company) get nothing.
    await login(stranger);
    await assert.rejects(db.query("select feed_companies($1)", [a]));
    void s;
  } finally {
    await db.close();
  }
});
