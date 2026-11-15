// Approvers named in the LINE group by tagging (migration 0071): no EliteFlow account needed. The first time with a
// one-time code made by the owner on the website; later by an approver of the group or a linked owner/manager.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { approverCommand, approversText, taggedPeople } from "../src/lib/line-mention";

const A = "U" + "a".repeat(32),
  B = "U" + "b".repeat(32),
  ASKER = "U" + "c".repeat(32),
  STRANGER = "U" + "d".repeat(32);

test("tagged people are read from LINE's mention data (not the bot, not @All)", () => {
  const text = "@EliteFlow เพิ่มผู้อนุมัติ @คุณเอ @ศิริ";
  const people = taggedPeople({
    type: "text",
    text,
    mention: {
      mentionees: [
        { index: 0, length: 10, isSelf: true, type: "user" },
        { index: text.indexOf("@คุณเอ"), length: "@คุณเอ".length, type: "user", userId: A },
        { index: text.indexOf("@ศิริ"), length: "@ศิริ".length, type: "user", userId: B },
        { index: text.indexOf("@ศิริ"), length: "@ศิริ".length, type: "user", userId: B },
        { index: 0, length: 4, type: "all" },
      ],
    },
  });
  assert.deepEqual(people, [
    { id: A, name: "คุณเอ" },
    { id: B, name: "ศิริ" },
  ]);
});

test("approver commands", () => {
  assert.deepEqual(approverCommand("#ผู้อนุมัติ 0123456789abcdef0123456789abcdef @คุณเอ"), { act: "add", code: "0123456789abcdef0123456789abcdef" });
  assert.deepEqual(approverCommand("เพิ่มผู้อนุมัติ @คุณเอ"), { act: "add", code: null });
  assert.deepEqual(approverCommand("ตั้งผู้อนุมัติ @คุณเอ @ตัวเอง"), { act: "add", code: null });
  assert.deepEqual(approverCommand("ลบผู้อนุมัติ @คุณบี"), { act: "remove", code: null });
  assert.deepEqual(approverCommand("ผู้อนุมัติ"), { act: "list", code: null });
  assert.deepEqual(approverCommand("ใครเป็นผู้อนุมัติ"), { act: "list", code: null });
  assert.equal(approverCommand("ส่งให้ผู้อนุมัติดูหน่อย"), null);
  assert.match(approversText([{ name: "คุณเอ" }, { name: "ศิริ" }]), /ผู้อนุมัติของกลุ่มนี้ \(2 คน\): คุณเอ, ศิริ/);
  assert.match(approversText([]), /ยังไม่มีผู้อนุมัติ/);
});

test("migration 0071: approvers by tagging decide the group's step; no self-approval; code once", async () => {
  const owner = "10000000-0000-4000-8000-000000000001";
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
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','o@test.local',now());`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const one = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0] as T;
    const asOwner = async () => {
      await db.exec("reset role;");
      await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [owner]);
      await db.exec("set role authenticated;");
    };
    await asOwner();
    const c = await one<string>("select create_company('Tag Co')");
    await db.exec("reset role;");
    await db.query("update subscriptions set plan='enterprise',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [c]);
    await db.query("insert into line_groups(group_id,company_id,department)values('G-fin',$1,'Finance'),('G-it',$1,'IT')", [c]);

    // nobody is an approver yet: setting them needs the owner's code
    await db.exec("set role service_role;");
    await assert.rejects(db.query("select line_set_approvers('G-fin',$1,null,$2,null)", [A, JSON.stringify([{ id: A, name: "คุณเอ" }])]), /เฉพาะผู้อนุมัติของกลุ่มนี้/);
    const code = "0123456789abcdef0123456789abcdef";
    const hash = createHash("sha256").update(code).digest("hex");
    await asOwner();
    await db.query("select create_approver_code($1,$2)", [c, hash]);
    await db.exec("set role service_role;");
    const set = await one<{ id: string; name: string }[]>("select line_set_approvers('G-fin',$1,$2,$3,null)", [A, hash, JSON.stringify([{ id: A, name: "คุณเอ" }, { id: ASKER, name: "ศิริ" }, { id: "not-a-line-id", name: "x" }])]);
    assert.deepEqual(set.map((x) => x.name), ["คุณเอ", "ศิริ"]);
    // the code works once
    await assert.rejects(db.query("select line_set_approvers('G-fin',$1,$2,'[]',null)", [STRANGER, hash]), /หมดอายุ/);
    // an approver adds another; a stranger cannot
    await db.query("select line_set_approvers('G-fin',$1,null,$2,null)", [A, JSON.stringify([{ id: B, name: "คุณบี" }])]);
    await assert.rejects(db.query("select line_set_approvers('G-fin',$1,null,'[]',null)", [STRANGER]), /เฉพาะผู้อนุมัติ/);

    // an expense asked in the IT group by ASKER: step 1 IT (no approver there), step 2 Finance (≥ 5,000)
    await db.exec("reset role;");
    const fields = await one<unknown>("select fields from entity_schemas where kind='expenses'");
    const tpl = JSON.stringify({ id: null, name: "ค่าใช้จ่าย", department: "Finance", target_kind: "expenses", fields, steps: [], mode: "sort" });
    const job = await one<string>(
      "insert into ingestions(company_id,template,department,raw,source,group_id,source_user,confirm,target_kind,attachment_id)values($1,$2,'Finance','x','LINE','G-fin',$3,true,'expenses',null)returning id",
      [c, tpl, ASKER],
    );
    await db.exec("set role service_role;");
    const lease = await one<string>("select lease_id from claim_ingestion($1)", [job]);
    await db.query("select complete_ingestion($1,$2,$3,'[]','ai')", [job, lease, JSON.stringify({ name: "ค่า server", amount: 3000, category: "โปรแกรม/ซอฟท์แวร์/แอพลิเคชั่น", date: "2026-11-15", status: "pending" })]);
    await db.query("select line_draft_decide('G-fin',$1,$2,true)", [ASKER, job]);
    await db.exec("reset role;");
    assert.deepEqual((await one<{ steps: unknown }>("select approval from ingestions where id=$1", [job])).steps, [{ dept: "Finance" }]);
    await db.exec("set role service_role;");
    // the asker is an approver of the group, but never of their own request
    await assert.rejects(db.query("select line_approval_act('G-fin',$1,$2,'approve',null,null)", [ASKER, job]), /ของตัวเองไม่ได้/);
    // someone who is not an approver
    await assert.rejects(db.query("select line_approval_act('G-fin',$1,$2,'approve',null,null)", [STRANGER, job]), /ยังไม่ได้เป็นผู้อนุมัติ/);
    // a group approver (no account) approves: it waits for the slip, with their LINE name in the history
    const r = await one<{ status: string; name: string }>("select line_approval_act('G-fin',$1,$2,'approve',null,0)", [A, job]);
    assert.equal(r.status, "awaiting_slip");
    assert.equal(r.name, "คุณเอ");
    await db.exec("reset role;");
    const row = (await db.query<{ decided_name: string; approval: { history: { line: string; name: string }[] } }>("select decided_name,approval from ingestions where id=$1", [job])).rows[0];
    assert.equal(row.decided_name, "คุณเอ");
    assert.equal(row.approval.history[0].line, A);

    // an approver of another department's group cannot decide this step
    await db.exec("set role service_role;");
    await asOwner();
    const code2 = "fedcba9876543210fedcba9876543210";
    const hash2 = createHash("sha256").update(code2).digest("hex");
    await db.query("select create_approver_code($1,$2)", [c, hash2]);
    await db.exec("set role service_role;");
    await db.query("select line_set_approvers('G-it',$1,$2,$3,null)", [STRANGER, hash2, JSON.stringify([{ id: STRANGER, name: "ไอที" }])]);
    await db.exec("reset role;");
    const job2 = await one<string>(
      "insert into ingestions(company_id,template,department,raw,source,group_id,source_user,confirm,target_kind)values($1,$2,'Finance','x','LINE','G-fin',$3,true,'expenses')returning id",
      [c, tpl, ASKER],
    );
    await db.exec("set role service_role;");
    const lease2 = await one<string>("select lease_id from claim_ingestion($1)", [job2]);
    await db.query("select complete_ingestion($1,$2,$3,'[]','ai')", [job2, lease2, JSON.stringify({ name: "ค่าไฟ", amount: 900, category: "ค่าไฟ", date: "2026-11-15", status: "pending" })]);
    await db.query("select line_draft_decide('G-fin',$1,$2,true)", [ASKER, job2]);
    await assert.rejects(db.query("select line_approval_act('G-it',$1,$2,'approve',null,null)", [STRANGER, job2]), /ยังไม่ได้เป็นผู้อนุมัติ/);

    // the owner removes an approver on the website; the web page can read the list
    await asOwner();
    await db.query("select remove_line_approver($1,'G-fin',$2)", [c, B]);
    assert.deepEqual((await db.query<{ name: string }>("select name from line_group_approvers where group_id='G-fin' order by created_at")).rows.map((x) => x.name), ["คุณเอ", "ศิริ"]);
    await db.exec("set role service_role;");
    await db.query("select line_set_approvers('G-fin',$1,null,'[]',$2)", [A, [ASKER]]);
    await db.exec("reset role;");
    assert.equal(await one<number>("select count(*)::int from line_group_approvers where group_id='G-fin'"), 1);
  } finally {
    await db.close();
  }
});
