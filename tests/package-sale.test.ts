// A paid package is booked on both sides: the platform's customer / invoice / payment, the buyer's expense, and the
// buyer's invoice and receipt. Pure parts here; save_entity_as (migration 0077) against the real schema below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { saleAmounts, saleDetails, saleNumbers, salePeriod } from "../src/lib/package-sale";
import { renderPackageDoc, party } from "../src/lib/package-docs";
import { promptPayPayload, crc16 } from "../src/lib/promptpay";
import { billingPayee } from "../src/lib/payee";

test("numbers, period and amounts of a package sale", () => {
  const n = saleNumbers("3f2a9c11-0000-4000-8000-000000000000", "2026-11-18");
  assert.deepEqual(n, { invoiceNo: "INV-EF-6911-3F2A9C", receiptNo: "RC-EF-6911-3F2A9C" });
  assert.deepEqual(salePeriod("monthly", "2026-12-18T05:00:00Z", "2026-11-18"), { start: "2026-11-18", end: "2026-12-18" });
  assert.deepEqual(salePeriod("yearly", "2027-11-18T05:00:00Z", "2026-11-18"), { start: "2026-11-18", end: "2027-11-18" });
  const a = saleAmounts(2771.3);
  assert.equal(a.total, 2771.3);
  assert.equal(Math.round((a.base + a.vat) * 100) / 100, a.total);
  const d = saleDetails({ plan: "growth", cycle: "monthly" }, "บริษัท ลูกค้า จำกัด", { paidAt: "2026-11-18", start: "2026-11-18", end: "2026-12-18" }, "REF123");
  for (const x of ["Growth", "รายเดือน", "บริษัท ลูกค้า จำกัด", "ชำระเมื่อ", "เริ่มใช้", "สิ้นสุด", "REF123"]) assert.ok(d.includes(x), x);
});

test("the buyer's invoice and receipt show both parties, the period, the amounts and the numbers", () => {
  const records = { invoiceNo: "INV-EF-6911-ABCDEF", receiptNo: "RC-EF-6911-ABCDEF", paidAt: "2026-11-18", start: "2026-11-18", end: "2026-12-18" };
  const base = { issuer: party({ name: "ELITEFLOW", profile: { taxId: "0105555555555" } }), customer: party({ name: "ลูกค้า <b>", profile: {} }), plan: "starter", cycle: "monthly" as const, amount: 2771.3, ref: "REF1", records };
  const inv = renderPackageDoc({ ...base, kind: "inv" });
  assert.match(inv, /ใบแจ้งหนี้/);
  assert.match(inv, /INV-EF-6911-ABCDEF/);
  assert.match(inv, /2,771\.30/);
  assert.match(inv, /0105555555555/);
  assert.ok(!inv.includes("<b>\"") && inv.includes("ลูกค้า &#60;b&#62;"), "customer name is escaped");
  const rc = renderPackageDoc({ ...base, kind: "rc" });
  assert.match(rc, /ใบเสร็จรับเงิน/);
  assert.match(rc, /RC-EF-6911-ABCDEF/);
  assert.match(rc, /ชำระแล้ว/);
  assert.match(rc, /REF1/);
});

test("the payee's PromptPay QR is the one given, with the amount filled in", () => {
  const p = billingPayee();
  assert.equal(p.promptPay, "004666018608434");
  // the QR the owner sent (static, no amount) carries the same account
  assert.match("00020101021129390016A000000677010111031500466601860843453037645802TH63044574", /0315004666018608434/);
  const withAmount = promptPayPayload(p.promptPay, 2771.3);
  assert.match(withAmount, /0315004666018608434/);
  assert.match(withAmount, /010212/);
  assert.match(withAmount, /54072771\.30/);
  assert.equal(withAmount.slice(-4), crc16(withAmount.slice(0, -4)));
});

test("migration 0077: the server saves a record as a company's owner, with the normal rules; only for members", async () => {
  const owner = "10000000-0000-4000-8000-000000000001",
    other = "10000000-0000-4000-8000-000000000002";
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
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','o@test.local',now()),('${other}','x@test.local',now());`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const one = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0] as T;
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [owner]);
    await db.exec("set role authenticated;");
    const c = await one<string>("select create_company('Seller Co')");
    await db.exec("reset role;");
    await db.query(`select set_config('request.jwt.claim.sub','',false)`);

    await db.exec("set role service_role;");
    const cust = await one<{ id: string; data: Record<string, unknown>; created_by: string }>("select to_jsonb(save_entity_as($1,$2,'customers',$3))", [owner, c, JSON.stringify({ name: "ลูกค้า A", type: "นิติบุคคล", status: "active" })]);
    // the buyer's expense exactly as recordPackageSale writes it
    const exp = await one<{ data: Record<string, unknown> }>("select to_jsonb(save_entity_as($1,$2,'expenses',$3))", [
      owner,
      c,
      JSON.stringify({ name: "ค่าแพ็กเกจ EliteFlow Starter รายเดือน", category: "โปรแกรม/ซอฟท์แวร์/แอพลิเคชั่น", payee: "EliteFlow", docType: "ใบเสร็จ", docNo: "RC-EF-1", date: "2026-11-18", amount: 2771.3, vatMode: "included", payStatus: "โอนแล้ว", status: "paid", notes: "x" }),
    ]);
    assert.equal(exp.data.status, "paid");
    assert.equal(exp.data.payStatus, "โอนแล้ว");
    assert.equal(cust.created_by, owner);
    assert.match(String(cust.data.code), /^CUS-/);
    const inv = await one<{ id: string; data: Record<string, unknown> }>("select to_jsonb(save_entity_as($1,$2,'invoices',$3))", [owner, c, JSON.stringify({ name: "INV-EF-1", customerId: cust.id, date: "2026-11-18", dueDate: "2026-11-18", subtotal: 2590, vat: 7 })]);
    assert.equal(Number(inv.data.total), 2771.3);
    await one("select to_jsonb(save_entity_as($1,$2,'payments',$3))", [owner, c, JSON.stringify({ name: "รับชำระ", invoiceId: inv.id, direction: "income", date: "2026-11-18", amount: 2771.3, method: "โอนธนาคาร" })]);
    const status = await one<string>("select data->>'status' from entities where id=$1", [inv.id]);
    assert.equal(status, "paid", "the payment marks the invoice paid");
    // someone who is not in the company cannot be used
    await assert.rejects(db.query("select save_entity_as($1,$2,'customers',$3)", [other, c, JSON.stringify({ name: "x", status: "active" })]), /ไม่ได้อยู่ในบริษัทนี้/);
    // browsers cannot call it
    await db.exec("reset role;set role authenticated;");
    await assert.rejects(db.query("select save_entity_as($1,$2,'customers',$3)", [owner, c, JSON.stringify({ name: "y", status: "active" })]), /permission denied/);
  } finally {
    await db.close();
  }
});

test("the buyer's expense uses a category the database accepts", async () => {
  const src = await readFile("src/lib/package-sale.ts", "utf8");
  const category = /category: "([^"]+)"/.exec(src)![1];
  const schema = await readFile("supabase/schema.sql", "utf8");
  const last = schema.lastIndexOf("('expenses','Finance'");
  assert.ok(schema.slice(last, last + 20000).includes(`"${category}"`), category);
});
