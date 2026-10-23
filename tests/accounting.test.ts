import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { buildJournal } from "../src/lib/ledger";
import { thaiYear } from "../src/lib/domain";
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
const save = (db: PGlite, c: string, kind: string, data: object, id?: string, version?: number) =>
  one<{ id: string; data: Record<string, unknown>; version: number }>(db, "select * from save_entity($1,$2,$3,$4,$5)", [c, kind, JSON.stringify(data), id || null, version || null]);
const expense = (extra: object) => ({ name: "ค่าเช่าบูธ", category: "ค่าเช่า", date: "2026-10-05", amount: 10700, vatMode: "included", status: "pending", ...extra });

test("customer / supplier codes run per company and Thai year, and survive edits", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('A')as id")).id;
    const y = String(thaiYear()).padStart(2, "0");
    const a = await save(db, c, "customers", { name: "สยามฟู้ดส์", status: "active" });
    assert.equal(a.data.code, `CUS-${y}-0001`);
    assert.equal((await save(db, c, "customers", { name: "ข", status: "active" })).data.code, `CUS-${y}-0002`);
    assert.equal((await save(db, c, "customers", { name: "ค", code: "VIP-1", status: "active" })).data.code, "VIP-1");
    assert.equal((await one<{ code: string }>(db, "select peek_code($1,'customers')as code", [c])).code, `CUS-${y}-0003`);
    // blanking the code on edit keeps the issued one
    assert.equal((await save(db, c, "customers", { name: "สยามฟู้ดส์ จำกัด", code: "", status: "active" }, a.id, a.version)).data.code, `CUS-${y}-0001`);
    assert.equal((await save(db, c, "suppliers", { name: "ไทยแพ็ค", status: "active" })).data.code, `SUP-${y}-0001`);
    await login(other, "other@test.local");
    const d = (await one<{ id: string }>(db, "select create_company('B')as id")).id;
    assert.equal((await save(db, d, "customers", { name: "x", status: "active" })).data.code, `CUS-${y}-0001`);
    await rejects(db.query("select peek_code($1,'customers')", [c]), /ไม่มีสิทธิ์/);
  } finally {
    await db.close();
  }
});

test("post_expense books a balanced entry, numbers 50 ทวิ once, and stays inside the company", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('A')as id")).id;
    assert.equal((await one<{ n: number }>(db, "select count(*)::int n from accounts where company_id=$1", [c])).n, 16);
    const p = await save(db, c, "projects", { name: "The Promenade", priority: "normal", status: "active", budget: 50000 });
    await rejects(save(db, c, "expenses", expense({ lines: [{ name: "", qty: 1, price: 1 }] })), /รายการสินค้า/);
    const data = expense({
      projectId: p.id,
      docType: "ใบกำกับภาษีเต็มรูป",
      whtRate: "3",
      taxId: "0105556012345",
      payee: "บริษัท ไทยแพ็ค",
      payStatus: "โอนแล้ว",
      lines: [{ name: "ค่าเช่าบูธ", qty: 1, price: 10700 }],
    });
    const e = await save(db, c, "expenses", data);
    assert.deepEqual(e.data.lines, [{ name: "ค่าเช่าบูธ", qty: 1, price: 10700 }]);
    const j = buildJournal(e.data);
    assert.ok(j.balanced);
    assert.deepEqual(
      j.lines.map((l) => [l.account, l.debit, l.credit]),
      [["5210", 10000, 0], ["1154", 700, 0], ["1112", 0, 10400], ["2132", 0, 300]],
    );
    await rejects(db.query("select post_expense($1,$2,$3)", [c, e.id, JSON.stringify([{ account: "5210", debit: 10 }, { account: "1112", credit: 9 }])]), /ไม่เท่ากัน/);
    await rejects(db.query("select post_expense($1,$2,$3)", [c, e.id, JSON.stringify([{ account: "9999", debit: 10 }, { account: "1112", credit: 10 }])]), /รหัสบัญชี/);
    await db.query("select post_expense($1,$2,$3,$4)", [c, e.id, JSON.stringify(j.lines), JSON.stringify(j.wht)]);
    await db.query("select post_expense($1,$2,$3,$4)", [c, e.id, JSON.stringify(j.lines), JSON.stringify(j.wht)]);
    const lines = (await db.query<{ debit: string; credit: string; project_id: string }>("select l.* from journal_lines l join journal_entries j on j.id=l.entry_id where j.entity_id=$1", [e.id])).rows;
    assert.equal(lines.length, 4);
    assert.ok(lines.every((l) => l.project_id === p.id));
    const cert = await one<{ seq: number; year: number; form: string; amount: string }>(db, "select * from wht_certificates where entity_id=$1", [e.id]);
    assert.deepEqual([cert.seq, cert.year, cert.form, Number(cert.amount)], [1, 2569, "ภ.ง.ด.53", 300]);
    assert.equal((await one<{ data: { reviewStatus: string } }>(db, "select data from entities where id=$1", [e.id])).data.reviewStatus, "บันทึกแล้ว");
    const e2 = await save(db, c, "expenses", expense({ whtRate: "1", payee: "นายสมชาย" }));
    const j2 = buildJournal(e2.data);
    assert.deepEqual(j2.lines.map((l) => [l.account, l.debit, l.credit]), [["5210", 10700, 0], ["2111", 0, 10600], ["2132", 0, 100]]);
    await db.query("select post_expense($1,$2,$3,$4)", [c, e2.id, JSON.stringify(j2.lines), JSON.stringify(j2.wht)]);
    assert.equal((await one<{ seq: number; form: string }>(db, "select seq,form from wht_certificates where entity_id=$1", [e2.id])).seq, 2);
    await login(other, "other@test.local");
    assert.equal((await db.query("select * from journal_entries")).rows.length, 0);
    await rejects(db.query("select post_expense($1,$2,$3)", [c, e.id, JSON.stringify(j.lines)]), /ไม่มีสิทธิ์/);
  } finally {
    await db.close();
  }
});
