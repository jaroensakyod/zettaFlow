import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "10000000-0000-4000-8000-000000000001",
  bob = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";
test("home: private diary notes and monthly sales goals", async () => {
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
    insert into auth.users(id,email,email_confirmed_at)values('${alice}','1@test.local',now()),('${bob}','2@test.local',now()),('${stranger}','3@test.local',now());`);
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
    const rows = async (sql: string, params: unknown[] = []) =>
      (await db.query<Record<string, unknown>>(sql, params)).rows;

    // Alice owns the company; Bob joins it as a viewer.
    await login(alice);
    const company = (await rows("select create_company('Alice Co') c"))[0].c as string;
    await db.query("select invite_member($1,'2@test.local','viewer',array['Sales'])", [company]);
    await login(bob);
    await db.query("select accept_invitations()");

    // Alice writes today's note with a checklist; blank items are dropped and `done` is normalised.
    await login(alice);
    const saved = (
      await rows(
        `select note_save($1,'2026-11-07','ประชุมทีม',$2::jsonb) n`,
        [company, JSON.stringify([{ text: "ประชุมแผนการตลาด", done: true }, { text: "  " }, { text: "ตรวจ PO" }])],
      )
    )[0].n as { items: { text: string; done: boolean }[] };
    assert.deepEqual(saved.items, [
      { text: "ประชุมแผนการตลาด", done: true },
      { text: "ตรวจ PO", done: false },
    ]);
    assert.equal((await rows("select * from user_notes")).length, 1);
    await assert.rejects(db.query("select note_save($1,'2026-11-07','x','{}'::jsonb)", [company]), /รายการ/);
    await assert.rejects(
      db.query("insert into user_notes(company_id,user_id,day)values($1,$2,'2026-11-08')", [company, alice]),
    );

    // Bob (same company) cannot see Alice's note, and his own stays private from Alice too.
    await login(bob);
    assert.equal((await rows("select * from user_notes")).length, 0);
    await db.query("select note_save($1,'2026-11-07','ของบ็อบ','[]'::jsonb)", [company]);
    assert.equal((await rows("select body from user_notes"))[0].body, "ของบ็อบ");
    await login(alice);
    const mine = await rows("select body from user_notes");
    assert.deepEqual(mine.map((r) => r.body), ["ประชุมทีม"]);
    // Clearing the body and items removes the note.
    await db.query("select note_save($1,'2026-11-07','','[]'::jsonb)", [company]);
    assert.equal((await rows("select * from user_notes")).length, 0);

    // Goals: the owner sets one, the viewer reads it but cannot set it, outsiders see nothing.
    await db.query("select goal_set($1,'2026-11-15',1200000)", [company]);
    const goal = await rows("select month::text m,sales_target::float8 t from monthly_goals");
    assert.deepEqual(goal, [{ m: "2026-11-01", t: 1200000 }]);
    await assert.rejects(db.query("select goal_set($1,'2026-11-01',-1)", [company]), /เป้าหมาย/);
    await login(bob);
    assert.equal((await rows("select * from monthly_goals")).length, 1);
    await assert.rejects(db.query("select goal_set($1,'2026-11-01',5)", [company]), /เจ้าของหรือผู้จัดการ/);
    await assert.rejects(
      db.query("insert into monthly_goals(company_id,month,sales_target)values($1,'2026-12-01',5)", [company]),
    );
    await login(stranger);
    assert.equal((await rows("select * from monthly_goals")).length, 0);
    await assert.rejects(db.query("select note_save($1,'2026-11-07','x','[]'::jsonb)", [company]), /สิทธิ์/);
  } finally {
    await db.close();
  }
});
