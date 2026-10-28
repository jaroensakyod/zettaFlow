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


test("แผนก rules: running numbers, stored totals, approver-only statuses and real stock moves", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('A')as id")).id;
    // staff member of Warehouse + Sales
    await db.exec("reset role;");
    await db.query("insert into memberships(company_id,user_id,name,email,role,departments)values($1,$2,'สต๊าฟ','other@test.local','staff',array['Warehouse','Sales'])", [c, other]);
    await login(owner, "owner@test.local");
    const save = (kind: string, data: object, id: string | null = null, version: number | null = null) =>
      one<{ id: string; version: number; data: Record<string, unknown> }>(db, "select id,version,data from save_entity($1,$2,$3,$4,$5)", [c, kind, data, id, version]);

    const q = await save("quotations", { name: "บูธงาน Expo", customerId: (await save("customers", { name: "ลูกค้า A", status: "active" }).catch(() => save("customers", { name: "ลูกค้า A", status: "active", type: "นิติบุคคล" }))).id, date: "2026-10-01", lines: [{ name: "บูธ", qty: 2, price: 500 }], discount: 100, vatMode: "excluded", status: "ร่าง" });
    assert.match(String(q.data.code), /^QT-\d{2}-0001$/);
    assert.equal(q.data.total, 963);

    const product = await save("products", { name: "สายไฟ", sku: "W-1", unit: "ม้วน", cost: 100, price: 150, reorderLevel: 5, status: "active" });
    await db.query("select post_stock_movement($1,$2,'in',20,'open')", [c, product.id]);
    const stock = async () => Number((await one<{ s: string }>(db, "select data->>'stock' s from entities where id=$1", [product.id])).s);

    // staff can request but not approve / issue
    await login(other, "other@test.local");
    const issue = await save("stock_issues", { name: "เบิกไปไซต์งาน", productId: product.id, quantity: 3, requester: "สต๊าฟ", date: "2026-10-02", status: "รออนุมัติ" });
    assert.match(String(issue.data.code), /^WD-/);
    await rejects(save("stock_issues", { ...issue.data, status: "จ่ายของแล้ว" }, issue.id, issue.version), /Owner หรือ Manager/);
    await rejects(save("stock_issues", { name: "x", productId: product.id, quantity: 1, requester: "x", date: "2026-10-02", status: "อนุมัติแล้ว" }), /Owner หรือ Manager/);

    // owner issues: stock goes down once
    await login(owner, "owner@test.local");
    const issued = await save("stock_issues", { ...issue.data, status: "จ่ายของแล้ว" }, issue.id, issue.version);
    assert.equal(await stock(), 17);
    await rejects(save("stock_issues", { ...issued.data, quantity: 10 }, issued.id, issued.version), /แก้จำนวนไม่ได้/);
    await save("stock_issues", { ...issued.data, notes: "ส่งแล้ว" }, issued.id, issued.version);
    assert.equal(await stock(), 17, "re-saving does not move stock again");

    // count finds 15: adjusting moves the difference from the live stock
    const count = await save("stock_counts", { name: "นับสิ้นเดือน", productId: product.id, date: "2026-10-31", systemQty: 17, countedQty: 15, status: "นับแล้ว" });
    assert.equal(count.data.diff, -2);
    await save("stock_counts", { ...count.data, status: "ปรับยอดแล้ว" }, count.id, count.version);
    assert.equal(await stock(), 15);
    await rejects(save("stock_issues", { name: "เกิน", productId: product.id, quantity: 99, requester: "x", date: "2026-10-02", status: "จ่ายของแล้ว" }), /สินค้าไม่พอ/);

    const att = await save("attendance", { name: "นภา", date: "2026-10-02", checkIn: "09:20", checkOut: "18:05", status: "สาย" });
    assert.deepEqual([att.data.hours, att.data.late], [8.75, 20]);
    const bill = await save("bills", { name: "ค่าขนส่ง", supplierId: (await save("suppliers", { name: "ขนส่ง B", status: "active" }).catch(() => save("suppliers", { name: "ขนส่ง B", status: "active", type: "นิติบุคคล" }))).id, date: "2026-10-01", dueDate: "2026-10-31", amount: 10700, whtRate: "3", status: "รอตรวจ" });
    assert.match(String(bill.data.code), /^AP-/);
    assert.equal(bill.data.net, 10400);
  } finally {
    await db.close();
  }
});
