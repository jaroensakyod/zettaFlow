// ห้องดีล phase 2 (migration 0065) on a real Postgres: after acceptance — progress, delivery and acceptance of the
// work, instalment invoices, payments with withholding tax, receipts, closing; cancelling only with both sides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "10000000-0000-4000-8000-000000000001",
  bob = "10000000-0000-4000-8000-000000000002";
type Card = { id: string; deal_id: string; kind: string; status: string; data: Record<string, any> };
type Deal = { id: string; stage: string; cards: Card[] };

test("deal room phase 2: work, instalments, withholding tax, receipts, closing and cancelling", async () => {
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
    insert into auth.users(id,email,email_confirmed_at)values('${alice}','alice@test.local',now()),('${bob}','bob@test.local',now());`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const login = async (id: string) => {
      await db.exec("reset role;");
      await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id, id.slice(-1) + "@test.local"]);
      await db.exec("set role authenticated;");
    };
    const val = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0] as T;
    const ents = async (dealId: string) => {
      await db.exec("reset role;");
      return (await db.query<{ kind: string; company_id: string; data: Record<string, any> }>("select kind,company_id,data from entities where data->>'b2bDealId'=$1 order by created_at", [dealId])).rows;
    };

    await login(alice);
    const a = await val<string>("select create_company('Alice Events')"); // buyer
    await login(bob);
    const b = await val<string>("select create_company('Bob Booth Studio')"); // seller
    const t = await val<string>("select b2b_open($1,$2)", [b, a]);

    // instalments on the quotation: they must add up to 100
    await assert.rejects(db.query("select b2b_deal_quote($1,$2,null,'x',$3)", [b, t, { items: [{ name: "a", price: 1 }], installments: [{ label: "มัดจำ", percent: 30 }] }]), /100/);
    const q = await val<Card>("select b2b_deal_quote($1,$2,null,'บูธงาน Expo',$3)", [
      b,
      t,
      { items: [{ name: "บูธ", qty: 1, price: 100000 }], vatMode: "excluded", validUntil: "2099-01-01", installments: [{ label: "มัดจำ", percent: 30 }, { label: "ส่วนที่เหลือ", percent: 70 }] },
    ]);
    assert.equal(q.data.total, 107000);
    assert.equal(q.data.installments.length, 2);
    const deal = q.deal_id;

    // nothing of phase 2 before the deal is agreed
    await assert.rejects(db.query("select b2b_deal_progress($1,$2,10,'เริ่มงาน')", [b, deal]), /ระหว่างทำงาน/);
    await login(alice);
    await val("select b2b_deal_decide($1,$2,'accept')", [a, q.id]);

    // progress (seller only)
    await assert.rejects(db.query("select b2b_deal_progress($1,$2,10,'x')", [a, deal]), /ผู้รับจ้าง/);
    await login(bob);
    await assert.rejects(db.query("select b2b_deal_progress($1,$2,120,'x')", [b, deal]), /0–100/);
    await val("select b2b_deal_progress($1,$2,40,'ขึ้นโครงบูธแล้ว')", [b, deal]);

    // deposit invoice right away; the final one only after the work is accepted
    const iv1 = await val<Card>("select b2b_deal_invoice($1,$2,0,'2099-02-01')", [b, deal]);
    assert.equal(iv1.data.amount, 32100); // 30% of 100,000 + VAT 2,100
    assert.equal(iv1.data.net, 30000);
    await assert.rejects(db.query("select b2b_deal_invoice($1,$2,0)", [b, deal]), /ออกใบแจ้งหนี้ไปแล้ว/);
    await assert.rejects(db.query("select b2b_deal_invoice($1,$2,1)", [b, deal]), /ตรวจรับ/);
    await assert.rejects(db.query("select b2b_deal_invoice($1,$2,5)", [b, deal]), /งวด/);

    // buyer pays the deposit with 3% withholding tax on the pre-VAT part
    await login(alice);
    await assert.rejects(db.query("select b2b_deal_pay($1,$2,$3)", [a, iv1.id, { whtRate: 4 }]), /หัก ณ ที่จ่าย/);
    const p1 = await val<Card>("select b2b_deal_pay($1,$2,$3)", [a, iv1.id, { whtRate: 3, method: "โอนธนาคาร", reference: "KBank 123", date: "2026-11-10" }]);
    assert.equal(p1.data.wht, 900);
    assert.equal(p1.data.transfer, 31200);
    await assert.rejects(db.query("select b2b_deal_pay($1,$2,$3)", [a, iv1.id, {}]), /รอผู้รับจ้างยืนยัน/);
    await assert.rejects(db.query("select b2b_deal_receive($1,$2,true)", [a, p1.id]), /ผู้รับจ้าง/);

    // seller first says the money is not there, then the buyer reports again and the seller confirms
    await login(bob);
    await val("select b2b_deal_receive($1,$2,false,'ยอดยังไม่เข้าบัญชี')", [b, p1.id]);
    await login(alice);
    const p1b = await val<Card>("select b2b_deal_pay($1,$2,$3)", [a, iv1.id, { whtRate: 3, reference: "KBank 124" }]);
    await login(bob);
    const r1 = await val<Card>("select b2b_deal_receive($1,$2,true)", [b, p1b.id]);
    assert.match(r1.data.receiptNo, /^RC\d{4}-[0-9A-F]{5}-1$/);

    // delivery → buyer asks for a fix → delivered again → accepted
    await val("select b2b_deal_deliver($1,$2,'ติดตั้งเสร็จแล้ว')", [b, deal]);
    await assert.rejects(db.query("select b2b_deal_progress($1,$2,90,'x')", [b, deal]), /ระหว่างทำงาน/);
    await login(alice);
    let deals = await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]);
    const del1 = deals[0].cards.find((c) => c.kind === "delivery")!;
    await assert.rejects(db.query("select b2b_deal_check($1,$2,false,'')", [a, del1.id]), /แก้/);
    await val("select b2b_deal_check($1,$2,false,'ป้ายด้านข้างสีเพี้ยน')", [a, del1.id]);
    assert.equal((await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]))[0].stage, "work");
    await login(bob);
    await val("select b2b_deal_deliver($1,$2,'เปลี่ยนป้ายให้แล้ว')", [b, deal]);
    await login(alice);
    deals = await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]);
    const del2 = deals[0].cards.filter((c) => c.kind === "delivery").pop()!;
    await val("select b2b_deal_check($1,$2,true)", [a, del2.id]);
    assert.equal((await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]))[0].stage, "checked");

    // final invoice, paid with no withholding tax → the deal closes
    await login(bob);
    const iv2 = await val<Card>("select b2b_deal_invoice($1,$2,1)", [b, deal]);
    assert.equal(iv2.data.amount, 74900); // 70,000 + VAT 4,900 — the two add up to 107,000
    await login(alice);
    const p2 = await val<Card>("select b2b_deal_pay($1,$2,$3)", [a, iv2.id, { whtRate: 0 }]);
    await login(bob);
    await val("select b2b_deal_receive($1,$2,true)", [b, p2.id]);
    await login(alice);
    assert.equal((await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]))[0].stage, "closed");
    await assert.rejects(db.query("select b2b_deal_cancel($1,$2,'เปลี่ยนใจ')", [a, deal]), /ยังไม่ปิด/);

    // the books on each side
    const made = await ents(deal);
    const of = (kind: string, co: string) => made.filter((e) => e.kind === kind && e.company_id === co);
    assert.equal(of("projects", b)[0].data.status, "completed");
    assert.equal(of("tasks", a)[0].data.status, "done");
    const invs = of("invoices", b);
    assert.equal(invs.length, 2);
    assert.ok(invs.every((i) => i.data.status === "paid"));
    assert.equal(invs[0].data.subtotal, 30000);
    assert.equal(invs[0].data.vat, 7);
    const pays = of("payments", b);
    assert.equal(pays.length, 2);
    assert.equal(pays.reduce((s, p) => s + Number(p.data.amount), 0), 107000);
    const exps = of("expenses", a);
    assert.equal(exps.length, 2);
    assert.equal(exps[0].data.whtRate, "3");
    assert.equal(exps[0].data.status, "approved");
    assert.equal(exps[0].data.category, "บริการทั่วไป/ฟรีแลนซ์");
    assert.ok(exps[0].data.supplierId, "expense points at the supplier");
    assert.equal(of("invoices", a).length + of("expenses", b).length, 0, "nothing in the wrong company");

    // cancelling: another deal, accepted, seller asks, buyer agrees
    await login(bob);
    const q2 = await val<Card>("select b2b_deal_quote($1,$2,null,'งานป้าย',$3)", [b, t, { items: [{ name: "ป้าย", price: 5000 }], vatMode: "none", validUntil: "2099-01-01" }]);
    await login(alice);
    await val("select b2b_deal_decide($1,$2,'accept')", [a, q2.id]);
    await login(bob);
    await assert.rejects(db.query("select b2b_deal_cancel($1,$2,'')", [b, q2.deal_id]), /เหตุผล/);
    const cx = await val<Card>("select b2b_deal_cancel($1,$2,'วัสดุขาดตลาด')", [b, q2.deal_id]);
    await assert.rejects(db.query("select b2b_deal_cancel($1,$2,'อีกครั้ง')", [b, q2.deal_id]), /รออีกฝ่าย/);
    await assert.rejects(db.query("select b2b_deal_cancel_answer($1,$2,true)", [b, cx.id]), /อีกฝ่าย/);
    await login(alice);
    await val("select b2b_deal_cancel_answer($1,$2,false,'ขอให้ทำต่อ')", [a, cx.id]);
    await login(bob);
    const cx2 = await val<Card>("select b2b_deal_cancel($1,$2,'วัสดุขาดตลาดจริง ๆ')", [b, q2.deal_id]);
    await login(alice);
    await val("select b2b_deal_cancel_answer($1,$2,true)", [a, cx2.id]);
    deals = await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]);
    assert.equal(deals[1].stage, "cancelled");
    const made2 = await ents(q2.deal_id);
    assert.equal(made2.find((e) => e.kind === "projects")!.data.status, "cancelled");
    assert.equal(made2.find((e) => e.kind === "tasks")!.data.status, "done");
    await login(bob);
    await assert.rejects(db.query("select b2b_deal_progress($1,$2,10,'x')", [b, q2.deal_id]));
  } finally {
    await db.close();
  }
});
