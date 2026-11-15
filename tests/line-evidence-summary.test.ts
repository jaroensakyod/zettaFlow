// ใบรับรองแทนใบเสร็จรับเงิน, more evidence per item (up to 5) and the monthly expense summary asked in LINE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { readShare, signShare } from "../src/lib/share-link";
import { renderSubstitute, substituteModel } from "../src/lib/substitute-receipt";
import { expenseCsv, summaryCard, summaryRequest } from "../src/lib/expense-summary";
import { approvedCard, draftCard, listenPlan } from "../src/lib/line-mention";

process.env.NEXT_PUBLIC_APP_URL = "https://eliteflow-ai.com";
const id = "3f0c2a4e-1111-4222-8333-944455556666";

test("signed document links: open while valid, refused when changed, made elsewhere or expired", () => {
  const key = "test-secret",
    now = Date.parse("2026-11-15T00:00:00Z");
  const tok = signShare({ k: "sub", id }, 7, now, key);
  assert.deepEqual(readShare(tok, now + 86_400_000, key), { k: "sub", id });
  assert.equal(readShare(tok, now + 8 * 86_400_000, key), null); // expired
  assert.equal(readShare(tok, now, "other-secret"), null); // another server's key
  const [body, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ k: "sub", id: "00000000-0000-4000-8000-000000000000", exp: now + 1e9 })).toString("base64url");
  assert.equal(readShare(forged + "." + sig, now, key), null); // another record with the old signature
  assert.equal(readShare(body + ".x", now, key), null);
  const sum = signShare({ k: "sum", c: id, from: "2026-11-01", to: "2026-11-30" }, 7, now, key);
  assert.deepEqual(readShare(sum, now, key), { k: "sum", c: id, from: "2026-11-01", to: "2026-11-30" });
});

test("ใบรับรองแทนใบเสร็จ: items, total in words, the certification and both signatures", () => {
  const m = substituteModel({
    company: { name: "Doc Co", profile: { name: "บริษัท ด็อก จำกัด", address: "1 ถนนสุขุมวิท", province: "กรุงเทพฯ", taxId: "0105555000000" } },
    data: {
      code: "EXP-69-0007",
      date: "2026-11-14",
      name: "ซื้อผักตลาด",
      amount: 140,
      payee: "แม่ค้าตลาดสด",
      sourceSender: "SIRI",
      lines: [
        { name: "บรอกโคลี", qty: 2, unit: "กก.", price: 45 },
        { name: "ผักชี", qty: 1, unit: "กำ", price: 50 },
      ],
    },
    approvals: [{ action: "approve", name: "คุณเอ", at: "2026-11-14T03:00:00Z" }],
    files: 2,
  });
  assert.equal(m.total, 140);
  assert.equal(m.lines.length, 2);
  const html = renderSubstitute(m);
  assert.match(html, /ใบรับรองแทนใบเสร็จรับเงิน/);
  assert.match(html, /EXP-69-0007/);
  assert.match(html, /บริษัท ด็อก จำกัด/);
  assert.match(html, /บรอกโคลี 2 กก\. × 45\.00/);
  assert.match(html, /140\.00/);
  assert.match(html, /หนึ่งร้อยสี่สิบบาทถ้วน/);
  assert.match(html, /ข้าพเจ้า SIRI ขอรับรองว่า รายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้/);
  assert.match(html, /\( คุณเอ \)[\s\S]*ผู้อนุมัติ/);
  assert.match(html, /มีหลักฐานแนบ 2 ไฟล์/);
  // unpriced items: one line with the amount, items named
  const one = substituteModel({ company: { name: "X" }, data: { name: "ค่าแท็กซี่", amount: 230, date: "2026-11-14", lines: [{ name: "แท็กซี่", qty: 1, price: 0 }] } });
  assert.equal(one.lines.length, 1);
  assert.equal(one.total, 230);
  // nothing from the record becomes markup
  assert.doesNotMatch(renderSubstitute(substituteModel({ company: { name: "<b>x</b>" }, data: { name: "<script>alert(1)</script>", amount: 1 } })), /<script>alert/);
});

test("“สรุปค่าใช้จ่าย…” is understood for this month, last month, a named month, today, this week and this year", () => {
  const now = new Date("2026-11-15T03:00:00Z");
  assert.deepEqual(summaryRequest("สรุปค่าใช้จ่ายเดือนนี้", now), { from: "2026-11-01", to: "2026-11-30", label: "พฤศจิกายน 2569" });
  assert.deepEqual(summaryRequest("ขอสรุปรายจ่ายเดือนที่แล้ว", now), { from: "2026-10-01", to: "2026-10-31", label: "ตุลาคม 2569" });
  assert.deepEqual(summaryRequest("สรุปค่าใช้จ่าย ก.ย.", now), { from: "2026-09-01", to: "2026-09-30", label: "กันยายน 2569" });
  assert.deepEqual(summaryRequest("สรุปค่าใช้จ่าย ธันวาคม", now), { from: "2025-12-01", to: "2025-12-31", label: "ธันวาคม 2568" });
  assert.deepEqual(summaryRequest("สรุปค่าใช้จ่ายวันนี้", now), { from: "2026-11-15", to: "2026-11-15", label: "วันนี้" });
  assert.deepEqual(summaryRequest("สรุปค่าใช้จ่ายสัปดาห์นี้", now), { from: "2026-11-09", to: "2026-11-15", label: "สัปดาห์นี้" });
  assert.deepEqual(summaryRequest("สรุปค่าใช้จ่ายปีนี้", now), { from: "2026-01-01", to: "2026-12-31", label: "ปี 2569" });
  assert.deepEqual(summaryRequest("ขอสรุปค่าใช้จ่ายเป็น google sheet", now)?.from, "2026-11-01");
  assert.equal(summaryRequest("สรุปงานประชุมวันนี้", now), null);
  assert.equal(summaryRequest("ค่าใช้จ่ายรถ 500", now), null);
});

test("summary card and file", () => {
  const s = {
    company: "Doc Co",
    count: 3,
    total: 5000,
    byCategory: [{ name: "จัดซื้อ", amount: 3500, count: 1 }, { name: "ขนส่ง", amount: 1500, count: 2 }],
    byPerson: [{ name: "SIRI", amount: 5000, count: 3 }],
    top: [{ name: "อุปกรณ์สำนักงาน", amount: 3500, code: "EXP-69-0001", day: "2026-11-14" }],
    waitingSlip: { count: 1, amount: 18000 },
    inReview: 2,
  };
  const card = JSON.stringify(summaryCard(s, { from: "2026-11-01", to: "2026-11-30", label: "พฤศจิกายน 2569" }, { file: "https://x/share/t", web: "https://x/w" }));
  assert.match(card, /฿5,000/);
  assert.match(card, /จัดซื้อ \(70%\)/);
  assert.match(card, /SIRI · 3 รายการ/);
  assert.match(card, /EXP-69-0001 อุปกรณ์สำนักงาน/);
  assert.match(card, /รออนุมัติ 2 รายการ/);
  assert.match(card, /อนุมัติแล้วรอสลิป 1 รายการ/);
  assert.match(card, /ดาวน์โหลดไฟล์ Excel/);
  const csv = expenseCsv(
    [
      { code: "EXP-69-0001", date: "2026-11-14", name: 'กระดาษ "A4", หมึก', amount: 3500, who: "SIRI" },
      { code: "EXP-69-0002", date: "2026-11-15", name: "=HYPERLINK(\"x\")", amount: 1500 },
    ],
    { from: "2026-11-01", to: "2026-11-30", label: "พฤศจิกายน 2569" },
    "Doc Co",
  );
  assert.ok(csv.startsWith("﻿"));
  assert.match(csv, /"กระดาษ ""A4"", หมึก"/);
  assert.match(csv, /'=HYPERLINK/); // never a formula
  assert.match(csv, /รวม,5000\.00/);
});

test("cards offer more evidence; the recorded expense offers its substitute receipt", () => {
  const live = new Date(Date.now() + 60_000).toISOString();
  assert.deepEqual(listenPlan({ mode: "evidence", ingestion_id: id, until: live }, "image"), { act: "evidence", id });
  assert.deepEqual(listenPlan({ mode: "evidence", ingestion_id: id, until: live }, "text"), { act: "ignore" });
  assert.match(JSON.stringify(draftCard({ id, kind: "expenses", fields: [], values: {}, missing: [] })), new RegExp(`"data":"add=${id}"`));
  const item = {
    id,
    kind: "expenses",
    fields: [],
    values: { name: "ผัก" },
    recordId: "rec-1",
    substituteUrl: "https://eliteflow-ai.com/doc/abc",
    approval: { steps: [{ dept: "IT" }], at: 1, round: 1, ref: "EXP-69-0001", history: [] },
  };
  const paid = JSON.stringify(approvedCard(item, "paid"));
  assert.match(paid, /ใบแทนใบเสร็จ/);
  assert.match(paid, /doc\/abc/);
  assert.match(paid, /แนบหลักฐานเพิ่ม/);
});

test("migration 0070: up to 5 files per item, moved onto its record; summary for managers only", async () => {
  const owner = "10000000-0000-4000-8000-000000000001",
    staff = "10000000-0000-4000-8000-000000000002";
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
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','o@test.local',now()),('${staff}','s@test.local',now());`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const one = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0] as T;
    await db.exec("reset role;");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [owner]);
    await db.exec("set role authenticated;");
    const c = await one<string>("select create_company('Evidence Co')");
    await db.exec("reset role;");
    await db.query("update subscriptions set plan='enterprise',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [c]);
    await db.query("insert into memberships(company_id,user_id,name,email,role,departments)values($1,$2,'พนักงาน','s@x','staff','{IT}')", [c, staff]);
    await db.query("insert into line_users(company_id,line_user_id,user_id)values($1,'L-owner',$2),($1,'L-staff',$3)", [c, owner, staff]);
    await db.query("insert into line_groups(group_id,company_id,department)values('G',$1,'IT')", [c]);
    const job = await one<string>(
      "insert into ingestions(company_id,template,department,raw,source,group_id,source_user,status,target_kind)values($1,'{}','Finance','x','LINE','G','L-asker','draft','expenses')returning id",
      [c],
    );
    const file = () => one<string>("insert into attachments(company_id,department,name,mime,size,path)values($1,'Finance','e.jpg','image/jpeg',10,gen_random_uuid()::text)returning id", [c]);
    await db.exec("set role service_role;");
    // the asker can add; a staff member who is not the asker cannot
    assert.equal(((await one<{ left: number }>("select line_evidence_check('G','L-asker',$1)", [job])) as { left: number }).left, 5);
    await assert.rejects(db.query("select line_evidence_check('G','L-staff',$1)", [job]), /เฉพาะคนที่ขอ/);
    await db.exec("reset role;");
    const files = [await file(), await file(), await file(), await file(), await file(), await file()];
    await db.exec("set role service_role;");
    for (let k = 0; k < 5; k++) {
      const r = (await one<{ count: number; left: number }>("select line_add_evidence('G','L-asker',$1,$2)", [job, files[k]])) as { count: number; left: number };
      assert.deepEqual([r.count, r.left], [k + 1, 4 - k]);
    }
    await assert.rejects(db.query("select line_add_evidence('G','L-asker',$1,$2)", [job, files[5]]), /สูงสุด 5 ไฟล์/);
    // the record made later takes all five
    await db.exec("reset role;");
    const rec = await one<string>(
      "insert into entities(company_id,kind,department,data)values($1,'expenses','Finance',jsonb_build_object('name','ผัก','amount',140,'category','จัดซื้อ','date','2026-11-14','status','approved','ingestionId',$2::text))returning id",
      [c, job],
    );
    assert.equal(await one<number>("select count(*)::int from attachments where entity_id=$1", [rec]), 5);
    // cancelled items take no evidence
    await db.query("update ingestions set status='skipped' where id=$1", [job]);
    await db.exec("set role service_role;");
    await assert.rejects(db.query("select line_evidence_check('G','L-asker',$1)", [job]), /ยกเลิก/);

    // summary: owner / manager only; totals by category and person, rejected ones left out
    await db.exec("reset role;");
    await db.query(
      `insert into entities(company_id,kind,department,data)values
       ($1,'expenses','Finance','{"name":"ค่าส่ง","amount":1500,"category":"ขนส่ง","date":"2026-11-03","status":"approved","sourceSender":"SIRI"}'),
       ($1,'expenses','Finance','{"name":"ตุลา","amount":999,"category":"ขนส่ง","date":"2026-10-30","status":"approved"}'),
       ($1,'expenses','Finance','{"name":"ไม่ผ่าน","amount":5000,"category":"อื่นๆ","date":"2026-11-05","status":"rejected"}')`,
      [c],
    );
    await db.exec("set role service_role;");
    await assert.rejects(db.query("select line_expense_summary('G','L-staff','2026-11-01','2026-11-30')"), /เฉพาะเจ้าของหรือผู้จัดการ/);
    await assert.rejects(db.query("select line_expense_summary('G','L-nobody','2026-11-01','2026-11-30')"), /เฉพาะเจ้าของหรือผู้จัดการ/);
    const s = (await one<Record<string, any>>("select line_expense_summary('G','L-owner','2026-11-01','2026-11-30')")) as Record<string, any>;
    assert.equal(s.count, 2);
    assert.equal(Number(s.total), 1640);
    assert.deepEqual(s.byCategory.map((x: { name: string; amount: number }) => [x.name, Number(x.amount)]), [["ขนส่ง", 1500], ["จัดซื้อ", 140]]);
    assert.equal(s.byPerson[0].name, "SIRI");
  } finally {
    await db.close();
  }
});
