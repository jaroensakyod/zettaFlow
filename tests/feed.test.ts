import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "10000000-0000-4000-8000-000000000001",
  bob = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";
test("company feed: cross-company visibility, posting rights, likes, comments, follows", async () => {
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

    // Bob cannot post as Alice's company; images must sit under the company/post folder.
    const pid = "20000000-0000-4000-8000-000000000001";
    await assert.rejects(
      db.query("select feed_post($1,$2,'post','hi','{}','{}')", [a, pid]),
    );
    await login(alice);
    await assert.rejects(
      db.query("select feed_post($1,$2,'post','hi','{}',$3)", [
        a,
        pid,
        [`${b}/${pid}/0.webp`],
      ]),
    );
    await assert.rejects(
      db.query("select feed_post($1,$2,'job','hiring','{}','{}')", [a, pid]),
      /หัวข้อ/,
    );
    await db.query("select feed_post($1,$2,'post','โชว์รูมใหม่','{}',$3)", [
      a,
      pid,
      [`${a}/${pid}/0.webp`],
    ]);

    // Bob (another tenant) sees, likes, comments and follows.
    await login(bob);
    const feed = await val<{ id: string; mine: boolean; company: { name: string } }[]>(
      "select feed_list($1)",
      [b],
    );
    assert.equal(feed.length, 1);
    assert.equal(feed[0].company.name, "Alice Co");
    assert.equal(feed[0].mine, false);
    assert.deepEqual(await val("select feed_like($1)", [pid]), { liked: true, likes: 1 });
    assert.deepEqual(await val("select feed_like($1)", [pid]), { liked: false, likes: 0 });
    await db.query("select feed_comment($1,$2,'สนใจครับ')", [b, pid]);
    await assert.rejects(db.query("select feed_comment($1,$2,'x')", [a, pid]));
    assert.equal(
      ((await val<unknown[]>("select feed_list($1,'following')", [b])) as unknown[]).length,
      0,
    );
    assert.equal(await val("select feed_follow($1,$2)", [b, a]), true);
    const following = await val<{ following: boolean; comment_count: number }[]>(
      "select feed_list($1,'following')",
      [b],
    );
    assert.equal(following.length, 1);
    assert.equal(following[0].following, true);
    assert.equal(following[0].comment_count, 1);
    assert.equal(((await val<unknown[]>("select feed_suggest($1)", [b])) as unknown[]).length, 0);
    await assert.rejects(db.query("select feed_follow($1,$1)", [b]));

    // Card exposes only public fields; Bob cannot delete Alice's post; direct writes are blocked.
    const card = await val<Record<string, unknown>>("select company_card($1)", [a]);
    assert.deepEqual(Object.keys(card).sort(), ["about", "id", "industry", "logo", "name", "province"]);
    await assert.rejects(db.query("select feed_delete($1)", [pid]));
    await assert.rejects(
      db.query("insert into company_posts(company_id,author_id,author_name,body)values($1,$2,'x','x')", [a, bob]),
    );

    // Users with no company see nothing and cannot like.
    await login(stranger);
    await assert.rejects(db.query("select feed_list($1)", [a]));
    await assert.rejects(db.query("select feed_like($1)", [pid]));

    await login(alice);
    await db.query("select feed_delete($1)", [pid]);
    assert.equal(((await val<unknown[]>("select feed_list($1)", [a])) as unknown[]).length, 0);
  } finally {
    await db.close();
  }
});
