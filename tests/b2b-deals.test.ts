// ห้องดีล phase 1 (migration 0064) on a real Postgres: RFQ → quotation → change → Rev.2 → accept, and the records
// each company gets; plus everything that must be refused (wrong side, old revision, expired, closed deal, outsiders).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "10000000-0000-4000-8000-000000000001",
  bob = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";

type Card = { id: string; deal_id: string; kind: string; rev: number; status: string; reason: string | null; mine: boolean; data: Record<string, any> };
type Deal = { id: string; title: string; stage: string; role: string; project_id: string | null; quote_id: string | null; task_id: string | null; cards: Card[] };

test("deal room: request, quotation revisions, decisions and the records on acceptance", async () => {
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
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const login = async (id: string) => {
      await db.exec("reset role;");
      await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id, id.slice(-1) + "@test.local"]);
      await db.exec("set role authenticated;");
    };
    const val = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0] as T;
    const admin = async <T>(sql: string, params: unknown[] = []) => {
      await db.exec("reset role;");
      return (await db.query<T>(sql, params)).rows;
    };

    await login(alice);
    const a = await val<string>("select create_company('Alice Events')");
    await login(bob);
    const b = await val<string>("select create_company('Bob Booth Studio')");
    await db.query(`update companies set profile=profile||'{"taxId":"0105561234567","address":"99 บางนา กรุงเทพฯ","phone":"021234567"}' where id=$1`, [b]).catch(() => {});
    const t = await val<string>("select b2b_open($1,$2)", [b, a]);

    // 1. Alice (buyer) asks for a quotation
    await login(alice);
    const items = [{ name: "บูธ 3x6 ม.", qty: 1, unit: "งาน" }, { name: "ป้ายไวนิล", qty: 10, unit: "แผ่น" }, { name: "  " }];
    const rfq = await val<Card>("select b2b_deal_request($1,$2,'บูธงาน Bangkok Expo',$3)", [a, t, { items, needBy: "2026-12-20", budget: 150000, notes: "ส่งแบบ 3D ด้วย" }]);
    assert.equal(rfq.kind, "request");
    assert.equal(rfq.data.items.length, 2, "blank row dropped");
    assert.equal(rfq.data.buyer.name, "Alice Events");
    await assert.rejects(db.query("select b2b_deal_request($1,$2,'  ','{}')", [a, t]), /หัวข้อ/);
    await assert.rejects(db.query("select b2b_deal_request($1,$2,'x',$3)", [a, t, { items: [] }]), /อย่างน้อย 1/);
    // the buyer cannot quote its own request
    await assert.rejects(db.query("select b2b_deal_quote($1,$2,$3,'x',$4)", [a, t, rfq.deal_id, { items: [{ name: "a", price: 1 }] }]), /ผู้ขาย/);

    // 2. Bob (seller) sees the request and quotes it
    await login(bob);
    let deals = await val<Deal[]>("select b2b_deals_of($1,$2)", [b, t]);
    assert.equal(deals.length, 1);
    assert.equal(deals[0].role, "seller");
    assert.equal(deals[0].stage, "request");
    assert.equal(deals[0].cards[0].mine, false);
    const quoteItems = [{ name: "บูธ 3x6 ม.", qty: 1, unit: "งาน", price: 120000 }, { name: "ป้ายไวนิล", qty: 10, unit: "แผ่น", price: 1500 }];
    const q1 = await val<Card>("select b2b_deal_quote($1,$2,$3,'บูธงาน Bangkok Expo',$4)", [b, t, rfq.deal_id, { items: quoteItems, discount: 5000, vatMode: "excluded", validUntil: "2099-01-31", deliverBy: "2026-12-18", payTerms: "มัดจำ 50%" }]);
    assert.equal(q1.rev, 1);
    assert.equal(q1.data.subtotal, 135000);
    assert.equal(q1.data.vat, 9100); // (135000 - 5000) × 7%
    assert.equal(q1.data.total, 139100);
    assert.match(q1.data.docNo, /^QT\d{4}-[0-9A-F]{5}$/);
    await assert.rejects(db.query("select b2b_deal_quote($1,$2,$3,'x',$4)", [b, t, rfq.deal_id, { items: quoteItems, validUntil: "2020-01-01" }]), /วันยืนราคา/);
    await assert.rejects(db.query("select b2b_deal_quote($1,$2,$3,'x',$4)", [b, t, rfq.deal_id, { items: quoteItems, discount: 999999 }]), /ส่วนลด/);
    await assert.rejects(db.query("select b2b_deal_quote($1,$2,$3,'x',$4)", [b, t, rfq.deal_id, { items: [{ name: "a", qty: -1, price: 1 }] }]), /จำนวน/);
    // the seller cannot decide on its own quotation
    await assert.rejects(db.query("select b2b_deal_decide($1,$2,'accept')", [b, q1.id]), /ผู้ซื้อ/);

    // 3. Alice asks for a change (a reason is required)
    await login(alice);
    await assert.rejects(db.query("select b2b_deal_decide($1,$2,'change','')", [a, q1.id]), /แก้ไข/);
    const changed = await val<Card>("select b2b_deal_decide($1,$2,'change','ขอลดราคาบูธเหลือ 110,000')", [a, q1.id]);
    assert.equal(changed.status, "change");
    assert.equal((await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]))[0].stage, "quote");

    // 4. Bob sends Rev.2; Rev.1 is replaced and can no longer be accepted
    await login(bob);
    const q2 = await val<Card>("select b2b_deal_quote($1,$2,$3,'บูธงาน Bangkok Expo',$4)", [b, t, rfq.deal_id, { items: [{ ...quoteItems[0], price: 110000 }, quoteItems[1]], vatMode: "none", validUntil: "2099-01-31", deliverBy: "2026-12-18" }]);
    assert.equal(q2.rev, 2);
    assert.match(q2.data.docNo, /-R2$/);
    assert.equal(q2.data.total, 125000);
    await login(alice);
    deals = await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]);
    assert.deepEqual(deals[0].cards.map((c) => [c.kind, c.rev, c.status]), [["request", 1, "open"], ["quote", 1, "superseded"], ["quote", 2, "open"]]);
    await assert.rejects(db.query("select b2b_deal_decide($1,$2,'accept')", [a, q1.id]), /ฉบับล่าสุด/);
    // outsiders see nothing and can do nothing
    await login(stranger);
    const s = await val<string>("select create_company('Stranger Co')");
    await assert.rejects(db.query("select b2b_deals_of($1,$2)", [s, t]));
    await assert.rejects(db.query("select b2b_deal_decide($1,$2,'accept')", [s, q2.id]));

    // 5. Alice accepts Rev.2 → each company gets its records
    await login(alice);
    const acc = await val<Card>("select b2b_deal_decide($1,$2,'accept')", [a, q2.id]);
    assert.equal(acc.status, "accepted");
    deals = await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]);
    assert.equal(deals[0].stage, "accepted");
    assert.ok(deals[0].task_id, "buyer sees its follow-up task");
    assert.equal(deals[0].project_id, null, "buyer does not see the seller's project");
    const sellerView = await (async () => {
      await login(bob);
      return (await val<Deal[]>("select b2b_deals_of($1,$2)", [b, t]))[0];
    })();
    assert.ok(sellerView.project_id && sellerView.quote_id);
    assert.equal(sellerView.task_id, null, "seller does not see the buyer's task");

    type Ent = { kind: string; company_id: string; data: Record<string, any> };
    const made = await admin<Ent>("select kind,company_id,data from entities where data->>'b2bDealId'=$1 or data->>'networkCompanyId' in($2,$3) order by kind", [rfq.deal_id, a, b]);
    const of = (kind: string, company: string) => made.filter((e) => e.kind === kind && e.company_id === company);
    const cust = of("customers", b)[0],
      proj = of("projects", b)[0],
      quote = of("quotations", b)[0],
      sup = of("suppliers", a)[0],
      task = of("tasks", a)[0];
    assert.equal(cust.data.name, "Alice Events");
    assert.equal(quote.data.status, "ตอบรับ");
    assert.equal(quote.data.lines.length, 2);
    assert.equal(quote.data.lines[0].price, 110000);
    assert.equal(proj.data.budget, 125000);
    assert.equal(proj.data.endDate, "2026-12-18");
    assert.equal(sup.data.name, "Bob Booth Studio");
    assert.equal(sup.data.category, "บริการ");
    assert.equal(task.data.dueDate, "2026-12-18");
    assert.match(task.data.notes, /125,000\.00/);
    assert.equal(of("projects", a).length + of("quotations", a).length + of("tasks", b).length, 0, "nothing lands in the wrong company");

    // 6. The deal is closed: no new quotation, no withdrawal, no second decision
    await login(bob);
    await assert.rejects(db.query("select b2b_deal_quote($1,$2,$3,'x',$4)", [b, t, rfq.deal_id, { items: quoteItems }]), /ปิด/);
    await assert.rejects(db.query("select b2b_deal_withdraw($1,$2)", [b, q2.id]), /ตกลง|ปิด/);
    await login(alice);
    await assert.rejects(db.query("select b2b_deal_decide($1,$2,'reject','x')", [a, q2.id]));

    // 7. A second deal, quoted without a request, and withdrawn by the seller; a request cancelled by the buyer
    await login(bob);
    const direct = await val<Card>("select b2b_deal_quote($1,$2,null,'งานป้ายหน้าร้าน',$3)", [b, t, { items: [{ name: "ป้ายอะคริลิก", qty: 2, price: 3500 }] }]);
    assert.equal(direct.rev, 1);
    await login(alice);
    await assert.rejects(db.query("select b2b_deal_withdraw($1,$2)", [a, direct.id]), /บริษัทคุณส่ง/);
    await login(bob);
    await val("select b2b_deal_withdraw($1,$2,'ราคาวัสดุขึ้น')", [b, direct.id]);
    await login(alice);
    deals = await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]);
    assert.equal(deals[1].stage, "cancelled");
    const rfq2 = await val<Card>("select b2b_deal_request($1,$2,'ถ่ายวิดีโองาน',$3)", [a, t, { items: [{ name: "วิดีโอ 3 นาที" }] }]);
    await val("select b2b_deal_withdraw($1,$2)", [a, rfq2.id]);
    assert.equal((await val<Deal[]>("select b2b_deals_of($1,$2)", [a, t]))[2].stage, "cancelled");

    // 8. The chat shows each step as a line pointing at its card; the inbox shows the latest one
    const msgs = await val<{ body: string; card_id: string | null }[]>("select b2b_read($1,$2)", [a, t]);
    assert.ok(msgs.length >= 8);
    assert.ok(msgs.every((m) => m.card_id), "every deal step is a card line");
    assert.ok(msgs.some((m) => m.body.startsWith("✅ ตอบรับใบเสนอราคา")));
    const inbox = await val<{ last: { body: string } }[]>("select b2b_inbox($1)", [a]);
    assert.match(inbox[0].last.body, /ยกเลิกคำขอ/);
  } finally {
    await db.close();
  }
});
