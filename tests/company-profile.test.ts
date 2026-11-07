import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "10000000-0000-4000-8000-000000000001",
  bob = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";
test("company profiles: public card, counts, who follows whom, one company's updates", async () => {
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
    await db.query(
      `select save_company($1,'{"name":"Alice Co","description":"ผลิตเฟอร์นิเจอร์","website":"https://alice.example","taxId":"0105555555555","bankAccount":"123-4","cover":"data:image/webp;base64,AAAA"}'::jsonb)`,
      [a],
    );
    await db.query("select feed_post($1,$2,'post','สวัสดี','{}','{}')", [a, "20000000-0000-4000-8000-0000000000d1"]);
    await login(bob);
    const b = await val<string>("select create_company('Bob Co')");
    await db.query("select feed_post($1,$2,'post','Bob news','{}','{}')", [b, "20000000-0000-4000-8000-0000000000d2"]);
    await db.query("select feed_follow($1,$2)", [b, a]);

    // Bob looks at Alice's profile: public card + counts + follow state; no tax id or bank account.
    const p = await val<Record<string, unknown>>("select feed_company_profile($1,$2)", [b, a]);
    assert.equal(p.name, "Alice Co");
    assert.equal(p.about, "ผลิตเฟอร์นิเจอร์");
    assert.equal(p.website, "https://alice.example");
    assert.deepEqual([p.posts, p.followers, p.following_count, p.following, p.follows_us, p.mine, p.has_cover], [1, 1, 0, true, false, false, true]);
    assert.ok(!JSON.stringify(p).includes("0105555555555") && !JSON.stringify(p).includes("123-4"));
    // Own profile.
    const own = await val<Record<string, unknown>>("select feed_company_profile($1,$1)", [b]);
    assert.deepEqual([own.mine, own.following_count, own.followers], [true, 1, 0]);

    // Follower lists both ways.
    const followers = await val<{ name: string; following: boolean }[]>("select feed_follow_list($1,$2,'followers')", [b, a]);
    assert.deepEqual(followers.map((x) => x.name), ["Bob Co"]);
    const following = await val<{ name: string; following: boolean }[]>("select feed_follow_list($1,$2,'following')", [b, b]);
    assert.deepEqual(following.map((x) => [x.name, x.following]), [["Alice Co", true]]);
    await assert.rejects(db.query("select feed_follow_list($1,$2,'x')", [b, a]));

    // One company's updates only.
    const only = await val<{ company_id: string }[]>("select feed_list($1,$2)", [b, "company:" + a]);
    assert.deepEqual(only.map((x) => x.company_id), [a]);
    assert.equal(((await val<unknown[]>("select feed_list($1)", [b])) as unknown[]).length, 2);

    // Cover for any signed-in user; outsiders without a company cannot read profiles.
    assert.equal(await val("select company_cover($1)", [a]), "data:image/webp;base64,AAAA");
    await login(stranger);
    await assert.rejects(db.query("select feed_company_profile($1,$2)", [b, a]));
  } finally {
    await db.close();
  }
});
