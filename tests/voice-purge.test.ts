import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "10000000-0000-4000-8000-000000000001",
  bob = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";
test("voice files: audio older than the limit is removed, the transcript stays", async () => {
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
    await db.exec("reset role;");
    const tpl = JSON.stringify({ id: null, name: "AI", department: "Operations", fields: [], steps: [], mode: "sort" });
    const add = async (id: string, mime: string, days: number) => {
      await db.query(
        "insert into attachments(id,company_id,department,name,mime,size,path,created_at)values($1,$2,'Operations',$3,$4,10,$5,now()-make_interval(days=>$6))",
        [id, a, id + ".m4a", mime, a + "/Operations/" + id, days],
      );
      await db.query(
        "insert into ingestions(company_id,template,department,raw,source,attachment_id,created_at)values($1,$2::jsonb,'Operations',$3,'LINE',$4,now())",
        [a, tpl, "[ข้อความเสียง] ซื้อน้ำมัน 500 บาท", id],
      );
    };
    const oldVoice = "30000000-0000-4000-8000-000000000001",
      newVoice = "30000000-0000-4000-8000-000000000002",
      oldPdf = "30000000-0000-4000-8000-000000000003";
    await add(oldVoice, "audio/mp4", 120);
    await add(newVoice, "audio/mp4", 10);
    await add(oldPdf, "application/pdf", 400);
    const paths = (await db.query<{ purge_voice_files: string }>("select * from purge_voice_files(90)")).rows.map((r) => Object.values(r)[0]);
    assert.deepEqual(paths, [a + "/Operations/" + oldVoice]);
    const left = (await db.query<{ id: string }>("select id from attachments order by id")).rows.map((r) => r.id);
    assert.deepEqual(left, [newVoice, oldPdf]);
    // The item keeps its transcript; only the link to the removed file is cleared.
    const items = (await db.query<{ raw: string; attachment_id: string | null }>("select raw, attachment_id from ingestions order by raw, attachment_id nulls first")).rows;
    assert.equal(items.filter((r) => r.attachment_id === null).length, 1);
    assert.ok(items.every((r) => r.raw.startsWith("[ข้อความเสียง]")));
    await assert.rejects(db.query("select * from purge_voice_files(1)"), /7 วัน/);
    // Signed-in users cannot run it.
    await login(alice);
    await assert.rejects(db.query("select * from purge_voice_files(90)"));
  } finally {
    await db.close();
  }
});
