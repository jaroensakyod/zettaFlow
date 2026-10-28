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


test("an approved LINE/web item lands on the template's target page, mapped and validated", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('A')as id")).id;
    const fields = [
      { key: "vendor", label: "ผู้ขาย", type: "text", required: true },
      { key: "total", label: "ยอด", type: "number", required: true },
      { key: "bill_date", label: "วันที่", type: "date", required: true },
    ];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'บิลจากกลุ่ม','Finance',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    await db.query("select set_template_target($1,$2,'expenses',$3)", [c, t, { vendor: "payee", total: "amount", bill_date: "date" }]);
    const submit = async (values: object) => {
      const id = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'บิล')).id", [c, t])).id;
      await db.exec("reset role;");
      await db.query("update ingestions set status='review',values=$2 where id=$1", [id, values]);
      await login(owner, "owner@test.local");
      return id;
    };
    const ok = await submit({ vendor: "ร้านเครื่องเขียน", total: 535, bill_date: "2026-10-20" });
    await db.query("select decide_ingestion($1,$2,'approved',$3,'')", [c, ok, { vendor: "ร้านเครื่องเขียน", total: 535, bill_date: "2026-10-20" }]);
    await db.exec("reset role;");
    const rows = (await db.query<{ data: Record<string, unknown>; department: string }>("select data,department from entities where company_id=$1 and kind='expenses'", [c])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].department, "Finance");
    assert.equal(rows[0].data.payee, "ร้านเครื่องเขียน");
    assert.equal(rows[0].data.amount, 535);
    assert.equal(rows[0].data.date, "2026-10-20");
    assert.equal(rows[0].data.ingestionId, ok);
    assert.ok(String(rows[0].data.name).startsWith("บิลจากกลุ่ม"), "name falls back to the template name");
    assert.ok(rows[0].data.category === undefined || typeof rows[0].data.category === "string");
    // only owners can point a template somewhere, and only at real pages
    await rejects(db.query("select set_template_target($1,$2,'nope','{}')", [c, t]), /ไม่พบหน้าปลายทาง/);
    await login(other, "other@test.local");
    await rejects(db.query("select set_template_target($1,$2,'sales',null)", [c, t]), /เฉพาะเจ้าของ/);
  } finally {
    await db.close();
  }
});

test("a value the page rejects is noted on the item instead of blocking approval", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('B')as id")).id;
    const fields = [{ key: "vehicle", label: "รถ", type: "text", required: true }];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'รถ','Operations',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    await db.query("select set_template_target($1,$2,'vehicles','{}')", [c, t]);
    const id = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'x')).id", [c, t])).id;
    await db.exec("reset role;");
    await db.query("update ingestions set status='review',values='{\"vehicle\":\"กระบะ\"}' where id=$1", [id]);
    await login(owner, "owner@test.local");
    await db.query("select decide_ingestion($1,$2,'approved','{\"vehicle\":\"กระบะ\"}','')", [c, id]);
    await db.exec("reset role;");
    const i = await one<{ status: string; error: string }>(db, "select status,error from ingestions where id=$1", [id]);
    assert.equal(i.status, "approved");
    assert.match(i.error, /vehicles/);
    assert.equal((await db.query("select 1 from entities where company_id=$1 and kind='vehicles'", [c])).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("a linked record sent as a name (customer) is resolved inside the same company", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('C')as id")).id;
    const cust = (await one<{ id: string }>(db, "select id from save_entity($1,'customers',$2)", [c, { name: "บริษัท สยามฟู้ดส์", status: "active" }]).catch(async () =>
      one<{ id: string }>(db, "select id from save_entity($1,'customers',$2)", [c, { name: "บริษัท สยามฟู้ดส์", status: "active", type: "นิติบุคคล" }]),
    )).id;
    const fields = [
      { key: "quote_no", label: "เลขที่", type: "text", required: true },
      { key: "customer", label: "ลูกค้า", type: "text", required: true },
      { key: "amount", label: "มูลค่า", type: "number", required: true },
    ];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'ใบเสนอราคา','Sales',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    await db.query("select set_template_target($1,$2,'quotations',$3)", [c, t, { quote_no: "name", customer: "customerId", amount: "subtotal" }]);
    const id = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'x')).id", [c, t])).id;
    const v = { quote_no: "QT-001", customer: "บริษัท สยามฟู้ดส์", amount: 12000 };
    await db.exec("reset role;");
    await db.query("update ingestions set status='review',values=$2 where id=$1", [id, v]);
    await login(owner, "owner@test.local");
    await db.query("select decide_ingestion($1,$2,'approved',$3,'')", [c, id, v]);
    const q = await one<{ data: Record<string, unknown> }>(db, "select data from entities where company_id=$1 and kind='quotations'", [c]);
    assert.equal(q.data.customerId, cust);
    assert.equal(q.data.name, "QT-001");
    assert.equal(q.data.status, "ร่าง");
  } finally {
    await db.close();
  }
});
