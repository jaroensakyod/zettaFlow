// LINE mention mode: the bot reads only what @mentions it, summarises it as a card with
// "บันทึกได้เลย / แก้ไข / ยกเลิก", and nothing reaches the website before "บันทึกได้เลย".
// Pure helpers here, and migration 0066 on a real Postgres (PGlite) below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { draftAction, draftCard, draftRows, draftText, editText, listenPlan, mentionOf } from "../src/lib/line-mention";

process.env.NEXT_PUBLIC_APP_URL = "https://eliteflow-ai.com";
const id = "3f0c2a4e-1111-4222-8333-944455556666";

test("a mention is found from LINE's isSelf flag and cut out of the text", () => {
  const text = "@EliteFlow ค่าน้ำมัน 500 บาท";
  const m = mentionOf({ type: "text", text, mention: { mentionees: [{ index: 0, length: 10, type: "user", isSelf: true }] } });
  assert.deepEqual(m, { mentioned: true, text: "ค่าน้ำมัน 500 บาท" });
  // in the middle of a sentence
  const mid = mentionOf({ type: "text", text: "ช่วยบันทึก @EliteFlow ค่าส่ง 80", mention: { mentionees: [{ index: 11, length: 10, isSelf: true }] } });
  assert.deepEqual(mid, { mentioned: true, text: "ช่วยบันทึก ค่าส่ง 80" });
});

test("mentioning someone else, or no mention at all, is not for the bot", () => {
  assert.equal(mentionOf({ type: "text", text: "@สมชาย ไปกินข้าวกัน", mention: { mentionees: [{ index: 0, length: 6, isSelf: false }] } }).mentioned, false);
  assert.equal(mentionOf({ type: "text", text: "ค่าน้ำมัน 500" }).mentioned, false);
  // "@all" is not a mention of the bot either
  assert.equal(mentionOf({ type: "text", text: "@All ประชุม 10 โมง", mention: { mentionees: [{ index: 0, length: 4, type: "all" }] } }).mentioned, false);
});

test("the bot's name typed by hand counts as a mention", () => {
  assert.deepEqual(mentionOf({ type: "text", text: "@น้องโฟลว์ ซื้อกระดาษ 450" }, "น้องโฟลว์"), { mentioned: true, text: "ซื้อกระดาษ 450" });
  assert.deepEqual(mentionOf({ type: "text", text: "@น้องโฟลว์" }, "น้องโฟลว์"), { mentioned: true, text: "" });
});

test("แก้ … with a mention is a correction of my latest draft", () => {
  assert.equal(editText("แก้ ยอด 450 บาท"), "ยอด 450 บาท");
  assert.equal(editText("แก้ไข: ผู้ขาย ร้านเอ"), "ผู้ขาย ร้านเอ");
  assert.equal(editText("ค่าแก้ไขรถ 3,000"), null);
});

test("without a mention, only a member the bot is listening to is read — and only what fits the moment", () => {
  const now = Date.parse("2026-11-14T10:00:00Z"),
    live = "2026-11-14T10:01:00Z",
    gone = "2026-11-14T09:59:00Z";
  assert.deepEqual(listenPlan(null, "text", now), { act: "ignore" });
  assert.deepEqual(listenPlan({ mode: "any", ingestion_id: null, until: gone }, "text", now), { act: "ignore" });
  // after an empty mention: the next message or file starts a draft
  assert.deepEqual(listenPlan({ mode: "any", ingestion_id: null, until: live }, "text", now), { act: "new" });
  assert.deepEqual(listenPlan({ mode: "any", ingestion_id: null, until: live }, "image", now), { act: "new" });
  // after a mention with text: a photo joins the draft, chat is ignored
  assert.deepEqual(listenPlan({ mode: "files", ingestion_id: id, until: live }, "image", now), { act: "attach", id });
  assert.deepEqual(listenPlan({ mode: "files", ingestion_id: id, until: live }, "text", now), { act: "ignore" });
  // after แก้ไข: the next message corrects the draft
  assert.deepEqual(listenPlan({ mode: "edit", ingestion_id: id, until: live }, "text", now), { act: "edit", id });
  assert.deepEqual(listenPlan({ mode: "edit", ingestion_id: id, until: live }, "file", now), { act: "edit", id });
  // stickers are never read
  assert.deepEqual(listenPlan({ mode: "any", ingestion_id: null, until: live }, "sticker", now), { act: "ignore" });
});

test("card buttons carry a checked action and id", () => {
  assert.deepEqual(draftAction(`draft=save&id=${id}`), { act: "save", id });
  assert.deepEqual(draftAction(`draft=edit&id=${id}`), { act: "edit", id });
  assert.equal(draftAction(`draft=drop&id=${id}`), null);
  assert.equal(draftAction(`draft=save&id=1;drop table`), null);
});

test("the summary card shows the page, labelled values, what is missing and the three buttons", () => {
  const input = {
    id,
    kind: "expenses",
    fields: [
      { key: "name", label: "รายการ" },
      { key: "amount", label: "ยอดเงิน" },
      { key: "vendor", label: "ผู้ขาย" },
      { key: "status", label: "สถานะ" },
      { key: "date", label: "วันที่" },
    ],
    values: { name: "ค่าน้ำมัน", amount: 1250.5, vendor: "", status: "draft", date: "2026-11-14" },
    missing: ["ผู้ขาย"],
    requester: "SIRI",
  };
  assert.deepEqual(draftRows(input), [
    { label: "รายการ", value: "ค่าน้ำมัน" },
    { label: "ยอดเงิน", value: "฿1,250.5" },
    { label: "วันที่", value: "2026-11-14" },
  ]);
  const card = draftCard(input);
  assert.equal(card.type, "flex");
  const json = JSON.stringify(card);
  assert.match(json, /ค่าใช้จ่าย/);
  assert.match(json, /ยังขาด: ผู้ขาย/);
  assert.match(json, /ผู้ส่ง: SIRI/);
  for (const a of ["save", "edit", "cancel"]) assert.match(json, new RegExp(`draft=${a}&id=${id}`));
  assert.match(json, /ส่งขออนุมัติ/);
  assert.ok(card.altText.length <= 400);
  // after a correction the card says so
  assert.match(JSON.stringify(draftCard({ ...input, round: 2 })), /สรุปใหม่หลังแก้ไข \(ครั้งที่ 2\)/);
  assert.match(draftText(input), /• ยอดเงิน: ฿1,250.5/);
});

test("migration 0066: drafts stay out of the website until บันทึกได้เลย; only the sender or a manager decides", async () => {
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
    const login = async (u: string) => {
      await db.exec("reset role;");
      await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [u, "o@test.local"]);
      await db.exec("set role authenticated;");
    };
    const one = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0] as T;
    await login(owner);
    const c = await one<string>("select create_company('Mention Co')");
    await db.exec("reset role;");
    await db.query("insert into line_groups(group_id,company_id)values('G1',$1)", [c]);
    // every group (new or old) starts in mention mode
    assert.equal(await one<string>("select listen from line_groups where group_id='G1'"), "mention");
    await db.query("insert into memberships(company_id,user_id,email,role)values($1,$2,'s@test.local','staff')", [c, staff]);
    await db.query("insert into line_users(company_id,line_user_id,user_id)values($1,'U-owner',$2),($1,'U-staff',$3)", [c, owner, staff]);

    const tpl = JSON.stringify({ id: null, name: "AI แยกอัตโนมัติ", department: "Operations", fields: [], steps: [], mode: "sort" });
    const draft = async (confirm: boolean) => {
      const job = await one<string>(
        "insert into ingestions(company_id,template,department,raw,source,group_id,source_user,confirm)values($1,$2,'Operations','ค่าน้ำมัน 500','LINE','G1','U-sender',$3)returning id",
        [c, tpl, confirm],
      );
      await db.exec("set role service_role;");
      const lease = await one<string>("select lease_id from claim_ingestion($1)", [job]);
      await db.query("select complete_ingestion($1,$2,'{\"name\":\"ค่าน้ำมัน\",\"amount\":500}','[]','ai')", [job, lease]);
      await db.exec("reset role;");
      return job;
    };
    const status = (job: string) => one<string>("select status from ingestions where id=$1", [job]);

    // a mention item becomes a draft, not "review" (so it is not in the website's review box)
    const d1 = await draft(true);
    assert.equal(await status(d1), "draft");
    assert.match(await one<string>("select body from notification_outbox where id=$1", [d1]), /สรุปก่อนบันทึก/);
    // a group that reads every message works as before
    assert.equal(await status(await draft(false)), "review");

    await db.exec("set role service_role;");
    // another staff member cannot save someone else's draft
    await assert.rejects(db.query("select line_draft_decide('G1','U-staff',$1,true)", [d1]), /เฉพาะคนที่ส่ง/);
    // an unknown LINE user neither
    await assert.rejects(db.query("select line_draft_decide('G1','U-nobody',$1,true)", [d1]), /เฉพาะคนที่ส่ง/);
    // wrong group
    await assert.rejects(db.query("select line_draft_decide('G2','U-sender',$1,true)", [d1]), /ไม่พบรายการ/);
    // the sender saves it → review (on the website, waiting for approval)
    assert.equal(await one<string>("select line_draft_decide('G1','U-sender',$1,true)", [d1]), "review");
    assert.equal(await status(d1), "review");
    // pressing the button twice says it is already there
    await assert.rejects(db.query("select line_draft_decide('G1','U-sender',$1,true)", [d1]), /ส่งขออนุมัติแล้ว/);

    // a linked owner can cancel someone's draft; it is never on the website
    await db.exec("reset role;");
    const d2 = await draft(true);
    await db.exec("set role service_role;");
    assert.equal(await one<string>("select line_draft_decide('G1','U-owner',$1,false)", [d2]), "skipped");
    assert.equal(await status(d2), "skipped");
    await assert.rejects(db.query("select line_draft_decide('G1','U-sender',$1,true)", [d2]), /ยกเลิกไปแล้ว/);

    // a draft being read again cannot be saved until the new summary is out
    await db.exec("reset role;");
    const d3 = await draft(true);
    await db.query("update ingestions set status='queued' where id=$1", [d3]);
    await db.exec("set role service_role;");
    await assert.rejects(db.query("select line_draft_decide('G1','U-sender',$1,true)", [d3]), /กำลังอ่านข้อมูลใหม่/);

    // listening rows: service role only; app users cannot read them
    await db.exec("reset role;");
    await db.query("insert into line_listen(group_id,line_user,company_id,mode,ingestion_id,until)values('G1','U-sender',$1,'files',$2,now()+interval '2 minutes')", [c, d3]);
    await login(owner);
    await assert.rejects(db.query("select * from line_listen"));
    // only the owner switches the mode, and only to known values
    await assert.rejects(db.query("select set_line_group_listen($1,'G1','sometimes')", [c]), /โหมด/);
    await db.query("select set_line_group_listen($1,'G1','all')", [c]);
    await db.exec("reset role;");
    assert.equal(await one<string>("select listen from line_groups where group_id='G1'"), "all");
    await login(staff);
    await assert.rejects(db.query("select set_line_group_listen($1,'G1','mention')", [c]), /เฉพาะเจ้าของ/);
    // a deleted draft takes its listening row with it
    await db.exec("reset role;");
    await db.query("delete from notification_outbox where id=$1", [d3]);
    await db.query("delete from ingestions where id=$1", [d3]);
    assert.equal(await one<number>("select count(*)::int from line_listen"), 0);
  } finally {
    await db.close();
  }
});
