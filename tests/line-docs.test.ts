// Document numbers from LINE (migration 0068): a purchase request gets its PO number on the bot's first summary,
// keeps it through corrections, uses it as the approval reference and as the record's code; items keep their own
// quantities; "@บอท ขอเอกสาร PO-…" returns it to people allowed to see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { docCard, docChoices, docRequest, draftCard, draftRows, itemLines } from "../src/lib/line-mention";
import { validateValues } from "../src/lib/domain";
import { pageTemplate } from "../src/lib/line-sort";

process.env.NEXT_PUBLIC_APP_URL = "https://eliteflow-ai.com";

test("purchase items keep their own quantity — never added together", () => {
  const t = pageTemplate("purchases");
  assert.ok(t.fields.some((f) => f.key === "lines" && f.type === "lines"));
  const { values } = validateValues(t, {
    name: "ขอซื้ออุปกรณ์สำนักงาน",
    lines: [
      { name: "กระดาษ A4", qty: 10, unit: "รีม", price: null },
      { name: "หมึกปริ้นเตอร์", qty: 2, unit: "กล่อง", price: 450 },
    ],
  });
  assert.deepEqual(values.lines, [
    { name: "กระดาษ A4", qty: 10, price: 0, unit: "รีม" },
    { name: "หมึกปริ้นเตอร์", qty: 2, price: 450, unit: "กล่อง" },
  ]);
  const rows = draftRows({ fields: t.fields, values: { ...values, quantity: 12, productId: "กระดาษ A4, หมึก" } });
  assert.deepEqual(rows.filter((r) => /^\d\./.test(r.label)), [
    { label: "1. กระดาษ A4", value: "10 รีม" },
    { label: "2. หมึกปริ้นเตอร์", value: "2 กล่อง @ ฿450" },
  ]);
  // the summed quantity / joined product are not shown when there are item lines
  assert.ok(!rows.some((r) => r.label === "จำนวน" || r.label.startsWith("สินค้า")));
  assert.equal(itemLines("x").length, 0);
  const card = JSON.stringify(draftCard({ id: "3f0c2a4e-1111-4222-8333-944455556666", kind: "purchases", fields: t.fields, values: values as Record<string, unknown>, missing: [], docCode: "PO-69-0001" }));
  assert.match(card, /จัดซื้อ · PO-69-0001/);
  // a request to buy is an expense approval request
  assert.match(JSON.stringify(draftCard({ id: "3f0c2a4e-1111-4222-8333-944455556666", kind: "expenses", fields: pageTemplate("expenses").fields, values: { name: "ขอซื้อ", amount: 3500 }, missing: [], docCode: "EXP-69-0001" })), /ใบขออนุมัติค่าใช้จ่าย · EXP-69-0001/);
});

test("“ขอเอกสาร” is understood with or without a number", () => {
  assert.deepEqual(docRequest("ขอเอกสาร PO-69-0001"), { code: "PO-69-0001" });
  assert.deepEqual(docRequest("ขอเอกสาร po-69-0012 หน่อยค่ะ"), { code: "PO-69-0012" });
  assert.deepEqual(docRequest("ขอ PO-69-0003"), { code: "PO-69-0003" });
  assert.deepEqual(docRequest("ขอเอกสารหน่อย"), { code: null });
  assert.deepEqual(docRequest("ขอใบสั่งซื้อล่าสุด"), { code: null });
  assert.equal(docRequest("ขอซื้อกระดาษ A4 10 รีม"), null);
  const d = { id: "3f0c2a4e-1111-4222-8333-944455556666", kind: "purchases", code: "PO-69-0001", name: "อุปกรณ์สำนักงาน", total: 3500, status: "approved", at: "2026-11-14T03:00:00Z", lines: [{ name: "กระดาษ A4", qty: 10, unit: "รีม", price: 250 }] };
  const one = JSON.stringify(docCard(d));
  assert.match(one, /PO-69-0001/);
  assert.match(one, /1\. กระดาษ A4/);
  assert.match(one, /฿3,500/);
  assert.match(one, /workspace\/purchases\?id=3f0c2a4e/);
  assert.match(JSON.stringify(docChoices([d])), /"data":"doc=3f0c2a4e-1111-4222-8333-944455556666"/);
});

test("migration 0068: PO numbers, item lines and document requests on the database", async () => {
  const owner = "10000000-0000-4000-8000-000000000001",
    mgr = "10000000-0000-4000-8000-000000000002";
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
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','o@test.local',now()),('${mgr}','m@test.local',now());`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const login = async (who: string) => {
      await db.exec("reset role;");
      await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email','x@test.local',false)`, [who]);
      await db.exec("set role authenticated;");
    };
    const one = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0] as T;
    await login(owner);
    const c = await one<string>("select create_company('Doc Co')");
    const sup = await one<string>("select (save_entity($1,'suppliers',null,'{\"name\":\"ร้านเครื่องเขียน\"}'::jsonb)).id", [c]).catch(() => null);
    await db.exec("reset role;");
    await db.query("update subscriptions set plan='enterprise',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [c]);
    if (!sup) await db.query("insert into entities(company_id,kind,department,data)values($1,'suppliers','Purchasing','{\"name\":\"ร้านเครื่องเขียน\"}')", [c]);
    await db.query("insert into memberships(company_id,user_id,name,email,role,departments)values($1,$2,'คุณเอ','a@x','manager','{Purchasing}')", [c, mgr]);
    await db.query("insert into line_users(company_id,line_user_id,user_id)values($1,'L-a',$2)", [c, mgr]);
    await db.query("insert into line_groups(group_id,company_id,department)values('G-pur',$1,'Purchasing'),('G-other',$1,'IT')", [c]);
    const tpl = JSON.stringify({ id: null, name: "จัดซื้อ", department: "Purchasing", target_kind: "purchases", fields: pageTemplate("purchases").fields, steps: [], mode: "sort" });
    const read = async (job: string, values: Record<string, unknown>, missing: string[]) => {
      await db.exec("set role service_role;");
      const lease = await one<string>("select lease_id from claim_ingestion($1)", [job]);
      await db.query("select complete_ingestion($1,$2,$3,$4,'ai')", [job, lease, JSON.stringify(values), JSON.stringify(missing)]);
      await db.exec("reset role;");
      return (await db.query<{ values: Record<string, any>; missing: string[]; doc_code: string; status: string }>("select values,missing,doc_code,status from ingestions where id=$1", [job])).rows[0];
    };
    const ask = async () => {
      await db.exec("reset role;");
      return one<string>(
        "insert into ingestions(company_id,template,department,raw,source,group_id,source_user,confirm,target_kind)values($1,$2,'Purchasing','x','LINE','G-pur','L-ton',true,'purchases')returning id",
        [c, tpl],
      );
    };
    const lines = [
      { name: "กระดาษ A4", qty: 10, unit: "รีม", price: 250 },
      { name: "หมึกปริ้นเตอร์", qty: 2, unit: "กล่อง", price: 500 },
    ];
    const job = await ask();
    let r = await read(job, { name: "ขอซื้ออุปกรณ์สำนักงาน", lines, supplierId: null }, ["ซัพพลายเออร์ (ชื่อ)", "สินค้า (ชื่อ)", "จำนวน", "ราคาต่อหน่วย", "เลขที่ใบสั่งซื้อ"]);
    assert.match(r.doc_code, /^PO-\d{2}-0001$/);
    const po = r.doc_code;
    // the PO number is the order's number; what was written moves to หมายเหตุ; item lines replace product/qty/cost
    assert.equal(r.values.name, po);
    assert.equal(r.values.poNumber, po);
    assert.equal(r.values.notes, "ขอซื้ออุปกรณ์สำนักงาน");
    assert.deepEqual(r.missing, ["ซัพพลายเออร์ (ชื่อ)"]);
    assert.equal(r.status, "draft");
    // a correction is read again: same number
    await db.query("update ingestions set status='queued' where id=$1", [job]);
    await db.query("delete from notification_outbox where id=$1", [job]);
    r = await read(job, { name: "ขอซื้ออุปกรณ์สำนักงาน", lines, supplierId: "ร้านเครื่องเขียน" }, []);
    assert.equal(r.doc_code, po);
    assert.deepEqual(r.missing, []);
    // the next request gets the next number
    const second = await ask();
    assert.match((await read(second, { name: "x", lines: [{ name: "ปากกา", qty: 5, price: 10 }] }, [])).doc_code, /^PO-\d{2}-0002$/);

    // send for approval: the reference is the PO number; one step (5,500 ≥ 5,000 but the page is Purchasing's own)
    await db.exec("set role service_role;");
    await db.query("select line_draft_decide('G-pur','L-ton',$1,true)", [job]);
    await db.exec("reset role;");
    assert.equal(await one<string>("select approval->>'ref' from ingestions where id=$1", [job]), po);
    await db.exec("set role service_role;");
    // only the manager of the step can approve; the requester cannot
    await assert.rejects(db.query("select line_approval_act('G-pur','L-ton',$1,'approve',null,null)", [job]), /ยังไม่ได้เชื่อม/);
    await db.query("select line_approval_act('G-pur','L-a',$1,'approve',null,null)", [job]);
    await db.exec("reset role;");
    const rec = (await db.query<{ id: string; data: Record<string, any> }>("select id,data from entities where company_id=$1 and kind='purchases'", [c])).rows[0];
    assert.equal(rec.data.code, po);
    assert.equal(rec.data.poNumber, po);
    assert.equal(rec.data.name, po);
    assert.deepEqual(rec.data.lines.map((x: { name: string; qty: number }) => [x.name, x.qty]), [["กระดาษ A4", 10], ["หมึกปริ้นเตอร์", 2]]);
    assert.equal(Number(rec.data.total), 3500);
    // receiving an order of item lines moves no stock and works
    await login(owner);
    await db.query("select purchase_action($1,$2,'approve')", [c, rec.id]).catch(() => {});
    await db.query("select purchase_action($1,$2,'receive')", [c, rec.id]);
    await db.exec("reset role;");
    assert.equal(await one<string>("select data->>'status' from entities where id=$1", [rec.id]), "received");
    // a purchase with neither lines nor product is refused
    await assert.rejects(db.query("insert into entities(company_id,kind,department,data)values($1,'purchases','Purchasing','{\"name\":\"x\",\"orderDate\":\"2026-11-14\"}')", [c]), /รายการสินค้า/);
    // codes on other pages too (EXP-, LV-, …) — and web records get one even without LINE
    await db.query("insert into entities(company_id,kind,department,data)values($1,'expenses','Finance','{\"name\":\"ค่าส่ง\",\"amount\":50,\"category\":\"ขนส่ง\",\"date\":\"2026-11-14\",\"status\":\"pending\"}')", [c]);
    assert.match(await one<string>("select data->>'code' from entities where company_id=$1 and kind='expenses'", [c]), /^EXP-\d{2}-0001$/);

    // A request to buy, as typed in LINE: an expense approval request (EXP-…), each item with its own quantity.
    await db.exec("reset role;");
    const exTpl = JSON.stringify({ id: null, name: "ค่าใช้จ่าย", department: "Finance", target_kind: "expenses", fields: pageTemplate("expenses").fields, steps: [], mode: "sort" });
    const req = await one<string>(
      "insert into ingestions(company_id,template,department,raw,source,group_id,source_user,confirm,target_kind)values($1,$2,'Finance','x','LINE','G-pur','L-ton',true,'expenses')returning id",
      [c, exTpl],
    );
    const ex = await read(req, { name: "ขอซื้ออุปกรณ์สำนักงาน", category: "จัดซื้อ", amount: 3500, date: "2026-11-14", lines: [{ name: "กระดาษ A4", qty: 10, unit: "รีม", price: 0 }, { name: "หมึกปริ้นเตอร์", qty: 2, unit: "กล่อง", price: 0 }] }, []);
    assert.match(ex.doc_code, /^EXP-\d{2}-\d{4}$/);
    assert.equal(ex.values.name, "ขอซื้ออุปกรณ์สำนักงาน");
    assert.deepEqual(ex.values.lines.map((x: { name: string; qty: number }) => [x.name, x.qty]), [["กระดาษ A4", 10], ["หมึกปริ้นเตอร์", 2]]);
    await db.exec("set role service_role;");
    await db.query("select line_draft_decide('G-pur','L-ton',$1,true)", [req]);
    // the slip cannot come before approval
    await assert.rejects(db.query("select line_slip_check('G-pur','L-ton',$1)", [req]), /ยังไม่ได้รับอนุมัติ/);
    await db.query("select line_approval_act('G-pur','L-a',$1,'approve',null,null)", [req]);
    await db.exec("reset role;");
    // approved is not an expense yet: no record until the slip
    assert.equal(await one<string>("select status from ingestions where id=$1", [req]), "awaiting_slip");
    assert.equal(await one<number>("select count(*)::int from entities where data->>'ingestionId'=$1", [req]), 0);
    await db.exec("set role service_role;");
    await assert.rejects(db.query("select line_slip_check('G-pur','L-stranger',$1)", [req]), /เฉพาะคนที่ขอ/);
    await assert.rejects(db.query("select line_expense_paid('G-pur','L-ton',$1,gen_random_uuid())", [req]), /ไม่พบไฟล์สลิป/);
    await db.exec("reset role;");
    const slip = await one<string>("insert into attachments(company_id,department,name,mime,size,path)values($1,'Finance','slip.jpg','image/jpeg',1000,'x/slip.jpg')returning id", [c]);
    await db.exec("set role service_role;");
    assert.equal(((await db.query<{ r: { status: string; code: string } }>("select line_expense_paid('G-pur','L-ton',$1,$2) r", [req, slip])).rows[0].r).status, "approved");
    await assert.rejects(db.query("select line_slip_check('G-pur','L-ton',$1)", [req]), /บันทึกเป็นค่าใช้จ่ายแล้ว/);
    await db.exec("reset role;");
    const exRec = (await db.query<{ data: Record<string, any> }>("select data from entities where data->>'ingestionId'=$1", [req])).rows[0];
    assert.equal(exRec.data.code, ex.doc_code);
    assert.equal(Number(exRec.data.amount), 3500);
    assert.equal(exRec.data.receiptId, slip); // the slip is on the expense
    assert.equal(exRec.data.payStatus, "โอนแล้ว");
    assert.deepEqual(exRec.data.lines.map((x: { name: string; qty: number }) => [x.name, x.qty]), [["กระดาษ A4", 10], ["หมึกปริ้นเตอร์", 2]]);
    // priced items with no amount written: the amount is their total
    await db.exec("reset role;");
    const priced = await one<string>(
      "insert into ingestions(company_id,template,department,raw,source,group_id,source_user,confirm,target_kind)values($1,$2,'Finance','x','LINE','G-pur','L-ton',true,'expenses')returning id",
      [c, exTpl],
    );
    const p2 = await read(priced, { name: "ซื้อของ", category: "จัดซื้อ", lines: [{ name: "ปากกา", qty: 5, price: 10 }, { name: "แฟ้ม", qty: 2, price: 45 }] }, ["ยอดตามเอกสาร"]);
    assert.equal(p2.values.amount, 140);
    assert.deepEqual(p2.missing, []);

    // "@บอท ขอเอกสาร"
    await db.exec("set role service_role;");
    const docs = async (user: string, code: string | null, group = "G-pur") => (await one<any[]>("select line_documents($1,$2,$3,null)", [group, user, code])) || [];
    assert.equal((await docs("L-a", po))[0].code, po); // a linked member
    assert.equal((await docs("L-ton", po))[0].code, po); // the person who asked for it
    assert.equal((await docs("L-stranger", po)).length, 0); // nobody else
    const latest = await docs("L-a", null);
    assert.ok(latest.some((d) => d.code === po));
    assert.equal((await docs("L-a", null, "G-other")).length, 0); // the list shows the group's own documents
    assert.equal(Number((await docs("L-a", po))[0].total), 3500);
  } finally {
    await db.close();
  }
});

test("after approval an expense request asks for the slip; the photo after the button is the slip", async () => {
  const { slipRequest, listenPlan, approvedCard } = await import("../src/lib/line-mention");
  assert.deepEqual(slipRequest("ส่งสลิป EXP-69-0001"), { code: "EXP-69-0001" });
  assert.deepEqual(slipRequest("จ่ายแล้วค่ะ"), { code: null });
  assert.equal(slipRequest("ส่งของให้ลูกค้าแล้ว"), null);
  const id = "3f0c2a4e-1111-4222-8333-944455556666";
  const live = new Date(Date.now() + 60_000).toISOString();
  assert.deepEqual(listenPlan({ mode: "slip", ingestion_id: id, until: live }, "image"), { act: "slip", id });
  assert.deepEqual(listenPlan({ mode: "slip", ingestion_id: id, until: live }, "text"), { act: "ignore" });
  const item = {
    id,
    kind: "expenses",
    fields: [{ key: "name", label: "รายการ" }],
    values: { name: "อุปกรณ์สำนักงาน" },
    approval: { steps: [{ dept: "Purchasing" }], at: 1, round: 1, ref: "EXP-69-0001", history: [{ step: 1, of: 1, dept: "Purchasing", action: "approve" as const, by: "u", name: "คุณเอ", at: "2026-11-14T03:00:00Z", note: null, via: "line", round: 1 }] },
  };
  const waiting = JSON.stringify(approvedCard(item, "awaiting_slip"));
  assert.match(waiting, /รอสลิป/);
  assert.match(waiting, /ยังไม่ลงเป็นค่าใช้จ่าย/);
  assert.match(waiting, new RegExp(`"data":"slip=${id}"`));
  const paid = JSON.stringify(approvedCard({ ...item, recordId: "rec-1" }, "paid"));
  assert.match(paid, /บันทึกค่าใช้จ่ายสมบูรณ์/);
  assert.match(paid, /workspace\/expenses\?id=rec-1/);
});
