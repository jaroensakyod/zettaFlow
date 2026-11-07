import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "10000000-0000-4000-8000-000000000001",
  bob = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";
test("b2b chat: one conversation per company pair, unread, privacy", async () => {
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
    const post = "20000000-0000-4000-8000-0000000000b1";
    const body = "ต้องการซัพพลายเออร์ไม้อัด ".repeat(20);
    await db.query(`select feed_post($1,$2,'partner',$3,'{"title":"หาซัพพลายเออร์","location":"กรุงเทพฯ","budget":"ตามใบเสนอราคา"}',$4)`, [
      a,
      post,
      body,
      [`${a}/${post}/0.webp`, `${a}/${post}/1.webp`],
    ]);
    await login(bob);
    const b = await val<string>("select create_company('Bob Co')");

    // Bob opens a chat from Alice's post; opening again finds the same conversation.
    const t = await val<string>("select b2b_open($1,$2,$3)", [b, a, post]);
    assert.equal(await val("select b2b_open($1,$2)", [b, a]), t);
    await assert.rejects(db.query("select b2b_open($1,$1)", [b]));
    await db.query("select b2b_send($1,$2,'สนใจเป็นซัพพลายเออร์ครับ',$3)", [b, t, post]);
    await assert.rejects(db.query("select b2b_send($1,$2,'  ')", [b, t]));
    type Card = { id: string; title: string; kind: string; excerpt: string; meta: { location: string; budget: string }; image: string; company: { id: string; name: string; has_logo: boolean } };
    // The card for the post Bob is asking about (shown as soon as the chat opens).
    const card = await val<Card>("select b2b_post($1,$2)", [b, post]);
    assert.equal(card.title, "หาซัพพลายเออร์");
    assert.equal(card.kind, "partner");
    assert.equal(card.excerpt, body.trim().slice(0, 200));
    assert.equal(card.image, `${a}/${post}/0.webp`);
    assert.deepEqual(card.meta, { title: "หาซัพพลายเออร์", location: "กรุงเทพฯ", budget: "ตามใบเสนอราคา" });
    assert.deepEqual(card.company, { id: a, name: "Alice Co", has_logo: false });
    const bobInbox = await val<{ id: string; company: { name: string }; unread: number; post: Card }[]>("select b2b_inbox($1)", [b]);
    assert.equal(bobInbox.length, 1);
    assert.equal(bobInbox[0].company.name, "Alice Co");
    assert.equal(bobInbox[0].unread, 0);
    assert.equal(bobInbox[0].post.title, "หาซัพพลายเออร์");
    assert.deepEqual(bobInbox[0].post, card);

    // Alice sees it unread, in the feed notifications too, and reading clears it.
    await login(alice);
    assert.equal(Number(await val("select b2b_unread($1)", [a])), 1);
    const alerts = await val<{ kind: string; thread_id?: string }[]>("select feed_alerts($1)", [a]);
    assert.ok(alerts.some((x) => x.kind === "message" && x.thread_id === t));
    const msgs = await val<{ body: string; mine: boolean; company_name: string; post: Card | null }[]>("select b2b_read($1,$2)", [a, t]);
    assert.deepEqual(msgs.map((m) => [m.company_name, m.mine]), [["Bob Co", false]]);
    assert.deepEqual(msgs[0].post, card);
    assert.equal(Number(await val("select b2b_unread($1)", [a])), 0);
    await db.query("select b2b_send($1,$2,'ส่งใบเสนอราคามาได้เลยค่ะ')", [a, t]);
    await login(bob);
    assert.equal(Number(await val("select b2b_unread($1)", [b])), 1);
    const bobMsgs = await val<{ post: Card | null }[]>("select b2b_read($1,$2)", [b, t]);
    assert.deepEqual(bobMsgs.map((m) => m.post?.id ?? null), [post, null]);

    // A third company cannot read or write the conversation; the tables are closed to direct access.
    await login(stranger);
    const s = await val<string>("select create_company('Stranger Co')");
    await assert.rejects(db.query("select b2b_read($1,$2)", [s, t]), /ไม่พบ/);
    await assert.rejects(db.query("select b2b_send($1,$2,'hi')", [s, t]), /ไม่พบ/);
    await assert.rejects(db.query("select b2b_read($1,$2)", [a, t]));
    await assert.rejects(db.query("select b2b_post($1,$2)", [a, post]), /ไม่มีสิทธิ์/);
    await assert.rejects(db.query("select b2b_post_card($1)", [post]));
    assert.equal((await val<Card | null>("select b2b_post($1,$2)", [s, post]))?.id, post);
    await assert.rejects(db.query("select * from b2b_messages"));
  } finally {
    await db.close();
  }
});
