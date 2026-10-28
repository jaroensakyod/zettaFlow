import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { sampleRows } from "../src/lib/sample-data";
import { catalog } from "../src/lib/catalog";

const owner = "10000000-0000-4000-8000-000000000001",
  staff = "10000000-0000-4000-8000-000000000002";
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
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@test.local',now()),('${staff}','staff@test.local',now());`);
  for (const file of (await readdir("supabase/migrations")).sort())
    await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
  const login = async (id: string, email: string) => {
    await db.exec("reset role;");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id, email]);
    await db.exec("set role authenticated;");
  };
  return { db, login };
}
const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

test("an owner loads the sample company into a real database, and it archives again without touching real data", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('ศิริ สตูดิโอ จริง')as id")).id;
    await db.exec("reset role;");
    await db.query("insert into memberships(company_id,user_id,name,email,role,departments)values($1,$2,'สต๊าฟ','staff@test.local','staff',array['Sales'])", [c, staff]);
    await login(owner, "owner@test.local");
    const real = await one<{ id: string }>(db, "select id from save_entity($1,'customers',$2)", [c, { name: "ลูกค้าจริงของฉัน", status: "active" }]);

    const rows = sampleRows();
    // Only the owner may load it.
    await login(staff, "staff@test.local");
    await assert.rejects(db.query("select load_sample_data($1,$2)", [c, JSON.stringify(rows)]), /เฉพาะเจ้าของบริษัท/);
    await login(owner, "owner@test.local");
    const loaded = Number((await one<{ n: number }>(db, "select load_sample_data($1,$2) n", [c, JSON.stringify(rows)])).n);
    assert.equal(loaded, rows.length);

    // Every page has rows, in the department the app expects.
    const kinds = (await db.query<{ kind: string; department: string; n: number }>("select kind,department,count(*)::int n from entities where company_id=$1 and archived_at is null group by kind,department", [c])).rows;
    for (const k of Object.keys(catalog)) assert.ok(kinds.some((r) => r.kind === k), "no sample rows for " + k);
    assert.ok(kinds.some((r) => r.kind === "tickets" && r.department === "IT"));

    // Database-side rules ran: stock kept and moved, running numbers, stored totals.
    const stock = async (sku: string) => Number((await one<{ s: string }>(db, "select data->>'stock' s from entities where company_id=$1 and kind='products' and data->>'sku'=$2", [c, sku])).s);
    assert.equal(await stock("PT-LN-WD"), 9, "low-stock product kept its stock");
    // The paid-out issue (-30) is inserted before the count, which then sets stock to the counted 406.
    assert.equal(await stock("TS-OV-01"), 406);
    const qt = await one<{ code: string; total: string }>(db, "select data->>'code' code,data->>'total' total from entities where company_id=$1 and kind='quotations' order by data->>'name' limit 1", [c]);
    assert.match(qt.code, /^QT-\d{2}-\d{4}$/);
    assert.ok(Number(qt.total) > 0);
    const inv = await one<{ n: number }>(db, "select count(*)::int n from entities where company_id=$1 and kind='invoices' and data->>'status'='paid' and (data->>'paid')::numeric=(data->>'total')::numeric", [c]);
    assert.ok(inv.n >= 1, "paid invoices keep their paid amount");
    const pay = await one<{ net: string }>(db, "select data->>'net' net from entities where company_id=$1 and kind='payroll' limit 1", [c]);
    assert.ok(Number(pay.net) > 0);

    // Loading twice is refused; clearing archives only the sample rows.
    await assert.rejects(db.query("select load_sample_data($1,$2)", [c, JSON.stringify(rows)]), /ใส่ข้อมูลตัวอย่างไว้แล้ว/);
    const archived = Number((await one<{ n: number }>(db, "select clear_sample_data($1) n", [c])).n);
    assert.equal(archived, rows.length);
    const left = await db.query<{ id: string }>("select id from entities where company_id=$1 and archived_at is null", [c]);
    assert.deepEqual(left.rows.map((r) => r.id), [real.id]);
    // And it can be loaded again afterwards (fresh ids).
    assert.equal(Number((await one<{ n: number }>(db, "select load_sample_data($1,$2) n", [c, JSON.stringify(sampleRows())])).n), rows.length);
  } finally {
    await db.close();
  }
});
