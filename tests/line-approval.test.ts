// Approval chain for items from LINE (migration 0067), on a real Postgres (PGlite), plus the cards.
// "ส่งขออนุมัติ" is not an approval; each approver in turn decides with a button; only the last one makes the record;
// nobody but the owner approves their own request; every step keeps who, when and the note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { approvalAction, approvalCard, approvedCard, chainText, listenPlan, sentText, stepText, thaiTime, type ActResult } from "../src/lib/line-mention";
import type { Approval } from "../src/lib/types";

process.env.NEXT_PUBLIC_APP_URL = "https://eliteflow-ai.com";
const id = "3f0c2a4e-1111-4222-8333-944455556666";
const chain: Approval = {
  steps: [{ dept: "Marketing" }, { dept: "Finance" }],
  at: 1,
  round: 1,
  ref: "EF-3F0C2A4E",
  history: [{ step: 1, of: 2, dept: "Marketing", action: "approve", by: "u1", name: "คุณบอส", at: "2026-11-07T03:15:00Z", note: null, via: "line", round: 1 }],
};
const item = { id, kind: "marketing_budget", fields: [{ key: "name", label: "รายการงบ" }, { key: "budget", label: "งบที่ตั้ง" }], values: { name: "งบโฆษณา Blue Sky", budget: 25000, period: "2026-Q4", status: "วางแผน" }, requester: "คุณต้น", approval: chain };

test("approver buttons carry a checked action, id and the step the card was for", () => {
  assert.deepEqual(approvalAction(`ap=approve&id=${id}&s=1`), { act: "approve", id, step: 1 });
  assert.deepEqual(approvalAction(`ap=reject&id=${id}`), { act: "reject", id, step: null });
  assert.equal(approvalAction(`ap=ok&id=${id}`), null);
  assert.equal(approvalAction(`ap=approve&id=x`), null);
  // after ไม่อนุมัติ / ขอแก้ไข the approver's next message is the reason
  const live = new Date(Date.now() + 60_000).toISOString();
  assert.deepEqual(listenPlan({ mode: "reject", ingestion_id: id, until: live }, "text"), { act: "decide", id, action: "reject" });
  assert.deepEqual(listenPlan({ mode: "fix", ingestion_id: id, until: live }, "image"), { act: "ignore" });
});

test("cards: the approver sees the step, earlier approvals and three buttons; the requester sees who, when and the reference", () => {
  assert.equal(chainText(chain), "ผู้จัดการการตลาด → ผู้จัดการฝ่ายบัญชีและการเงิน");
  assert.equal(thaiTime("2026-11-07T03:15:00Z"), "7 พ.ย. 2569 10:15 น.");
  const card = JSON.stringify(approvalCard(item));
  assert.match(card, /ขั้นที่ 2\/2/);
  assert.match(card, /สำหรับผู้จัดการฝ่ายบัญชีและการเงิน/);
  assert.match(card, /✅ ขั้นที่ 1\/2 ผู้จัดการการตลาด · คุณบอส · 7 พ.ย. 2569 10:15 น./);
  for (const a of ["approve", "fix", "reject"]) assert.match(card, new RegExp(`ap=${a}&id=${id}&s=1`));
  assert.match(card, /฿25,000/);
  assert.match(sentText(chain), /ยังไม่ถือว่าอนุมัติ/);
  const step: ActResult = { status: "review", action: "approve", step: 1, of: 2, dept: "Marketing", name: "คุณบอส", note: null, approval: chain };
  assert.match(stepText(step, "งบโฆษณา", new Date("2026-11-07T03:15:00Z")), /อนุมัติแล้ว \(ขั้นที่ 1\/2\)[\s\S]*ส่งต่อให้ผู้จัดการฝ่ายบัญชีและการเงิน \(ยังไม่ถือว่าอนุมัติสมบูรณ์\)/);
  const done = { ...chain, at: 2, history: [...chain.history, { ...chain.history[0], step: 2, dept: "Finance", name: "คุณเมย์", at: "2026-11-07T03:20:00Z" }] };
  const final = JSON.stringify(approvedCard({ ...item, approval: done }));
  assert.match(final, /อนุมัติเรียบร้อย \(2\/2\)/);
  assert.match(final, /คุณเมย์ \(ผู้จัดการฝ่ายบัญชีและการเงิน\)/);
  assert.match(final, /EF-3F0C2A4E/);
  assert.match(final, /eliteflow-ai\.com\/workspace\/marketing_budget/);
  assert.match(stepText({ ...step, action: "reject", note: "เกินงบไตรมาส" }, "งบโฆษณา"), /ไม่อนุมัติ[\s\S]*เหตุผล: เกินงบไตรมาส/);
});

test("migration 0067: approval chain on the database", async () => {
  const u = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
  const owner = u(1), ton = u(2), a = u(3), mk = u(4), boss = u(5), may = u(6);
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
    insert into auth.users(id,email,email_confirmed_at)select ('10000000-0000-4000-8000-00000000000'||n)::uuid,'u'||n||'@test.local',now() from generate_series(1,6)n;`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const login = async (who: string) => {
      await db.exec("reset role;");
      await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email','x@test.local',false)`, [who]);
      await db.exec("set role authenticated;");
    };
    const one = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0] as T;
    await login(owner);
    const c = await one<string>("select create_company('Approval Co')");
    await db.exec("reset role;");
    await db.query("update subscriptions set plan='enterprise',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [c]);
    await db.query(
      `insert into memberships(company_id,user_id,name,email,role,departments)values
       ($1,$2,'คุณต้น','ton@x','staff','{Purchasing}'),($1,$3,'คุณเอ','a@x','manager','{Purchasing}'),($1,$4,'คุณแพร','mk@x','staff','{Marketing}'),
       ($1,$5,'คุณบอส','boss@x','manager','{Marketing}'),($1,$6,'คุณเมย์','may@x','manager','{Finance}')`,
      [c, ton, a, mk, boss, may],
    );
    await db.query(
      "insert into line_users(company_id,line_user_id,user_id)values($1,'L-owner',$2),($1,'L-ton',$3),($1,'L-a',$4),($1,'L-mk',$5),($1,'L-boss',$6),($1,'L-may',$7)",
      [c, owner, ton, a, mk, boss, may],
    );
    await db.query("insert into line_groups(group_id,company_id,department)values('G-pur',$1,'Purchasing'),('G-mkt',$1,'Marketing'),('G-fin',$1,'Finance')", [c]);

    // An item read from LINE into a draft, then "ส่งขออนุมัติ" by its sender.
    const request = async (group: string, sender: string, kind: string, dept: string, values: Record<string, unknown>, missing: string[] = []) => {
      await db.exec("reset role;");
      // the page's own fields, as the AI sorter uses them
      const fields = await one<unknown>("select fields from entity_schemas where kind=$1", [kind]);
      const tpl = { id: null, name: kind, department: dept, target_kind: kind, fields, steps: [], mode: "sort" };
      const job = await one<string>(
        "insert into ingestions(company_id,template,department,raw,source,group_id,source_user,confirm,target_kind)values($1,$2,$3,'x','LINE',$4,$5,true,$6)returning id",
        [c, JSON.stringify(tpl), dept, group, sender, kind],
      );
      await db.exec("set role service_role;");
      const lease = await one<string>("select lease_id from claim_ingestion($1)", [job]);
      await db.query("select complete_ingestion($1,$2,$3,$4,'ai')", [job, lease, JSON.stringify(values), JSON.stringify(missing)]);
      return job;
    };
    const send = (group: string, sender: string, job: string) => one<string>("select line_draft_decide($1,$2,$3,true)", [group, sender, job]);
    const act = (group: string, user: string, job: string, action: string, note: string | null = null, step: number | null = null) =>
      db.query("select line_approval_act($1,$2,$3,$4,$5,$6)", [group, user, job, action, note, step]);
    const row = async (job: string) => {
      await db.exec("reset role;");
      const r = (await db.query<{ status: string; approval: Approval; decided_name: string | null }>("select status,approval,decided_name from ingestions where id=$1", [job])).rows[0];
      await db.exec("set role service_role;");
      return r;
    };

    // 1) ขอซื้ออุปกรณ์สำนักงาน 3,500: one step, the Purchasing manager.
    const buy = await request("G-pur", "L-ton", "expenses", "Finance", { name: "อุปกรณ์สำนักงาน", amount: 3500, category: "จัดซื้อ", date: "2026-11-07", status: "pending" });
    // missing data cannot be sent
    const half = await request("G-pur", "L-ton", "expenses", "Finance", { name: "x" }, ["ยอดเงิน"]);
    await assert.rejects(send("G-pur", "L-ton", half), /ยังขาด: ยอดเงิน/);
    assert.equal(await send("G-pur", "L-ton", buy), "review");
    let r = await row(buy);
    assert.equal(r.status, "review"); // sent is not approved
    assert.deepEqual(r.approval.steps, [{ dept: "Purchasing" }]);
    assert.match(r.approval.ref, /^EF-[0-9A-F]{8}$/);
    // the requester (staff) cannot approve; nor can an unlinked LINE account; nor another department's manager
    await assert.rejects(act("G-pur", "L-ton", buy, "approve"), /อนุมัติคำขอของตัวเองไม่ได้/);
    await assert.rejects(act("G-pur", "L-stranger", buy, "approve"), /ยังไม่ได้เชื่อม/);
    await assert.rejects(act("G-pur", "L-boss", buy, "approve"), /ขั้นนี้ต้องให้ผู้จัดการจัดซื้อ/);
    // the old typed paths refuse chained items
    await assert.rejects(db.query("select line_decide('G-pur','L-a',$1,'approved','')", [buy]), /ปุ่มในการ์ด/);
    await assert.rejects(db.query("select line_keyword_approve('G-pur','L-a','อนุมัติ')"), /ปุ่มในการ์ด/);
    const done1 = (await act("G-pur", "L-a", buy, "approve")).rows[0] as { line_approval_act: ActResult };
    assert.equal(done1.line_approval_act.status, "approved");
    r = await row(buy);
    assert.equal(r.status, "approved");
    assert.equal(r.decided_name, "คุณเอ");
    assert.equal(r.approval.history.length, 1);
    assert.equal(r.approval.history[0].name, "คุณเอ");
    assert.ok(r.approval.history[0].at);
    await assert.rejects(act("G-pur", "L-a", buy, "approve"), /ตัดสินไปแล้ว/);

    // 2) งบการตลาด 25,000: การตลาด → การเงิน, not approved until the last step.
    const ads = await request("G-mkt", "L-mk", "marketing_budget", "Marketing", { name: "งบโฆษณา Blue Sky", budget: 25000, period: "2026-Q4", status: "วางแผน" });
    await send("G-mkt", "L-mk", ads);
    r = await row(ads);
    assert.deepEqual(r.approval.steps, [{ dept: "Marketing" }, { dept: "Finance" }]);
    await assert.rejects(act("G-fin", "L-may", ads, "approve"), /ขั้นนี้ต้องให้ผู้จัดการการตลาด/);
    const s1 = ((await act("G-mkt", "L-boss", ads, "approve", null, 0)).rows[0] as { line_approval_act: ActResult }).line_approval_act;
    assert.equal(s1.status, "review");
    assert.equal(s1.approval.at, 1);
    // a stale card for step 1 cannot be pressed again
    await assert.rejects(act("G-mkt", "L-boss", ads, "approve", null, 0), /มีผู้ดำเนินการไปแล้ว/);
    await assert.rejects(act("G-fin", "L-boss", ads, "approve"), /ขั้นนี้ต้องให้ผู้จัดการฝ่ายบัญชีและการเงิน/);
    // reject and fix need a reason
    await assert.rejects(act("G-fin", "L-may", ads, "reject", " "), /เหตุผล/);
    // ขอแก้ไข: back to the requester as a draft; sending again starts the chain over, history kept
    await act("G-fin", "L-may", ads, "fix", "แยกค่าโฆษณาออนไลน์กับออฟไลน์");
    r = await row(ads);
    assert.equal(r.status, "draft");
    assert.equal(r.approval.round, 2);
    await assert.rejects(act("G-fin", "L-may", ads, "approve"), /ยังไม่ได้ส่งขออนุมัติ/);
    await send("G-mkt", "L-mk", ads);
    r = await row(ads);
    assert.equal(r.approval.at, 0);
    assert.equal(r.approval.history.length, 2);
    // the same manager may approve again in the new round
    await act("G-mkt", "L-boss", ads, "approve");
    await act("G-fin", "L-may", ads, "approve", "อนุมัติตามแผน");
    r = await row(ads);
    assert.equal(r.status, "approved");
    assert.deepEqual(r.approval.history.map((h) => [h.round, h.step, h.action, h.name]), [
      [1, 1, "approve", "คุณบอส"],
      [1, 2, "fix", "คุณเมย์"],
      [2, 1, "approve", "คุณบอส"],
      [2, 2, "approve", "คุณเมย์"],
    ]);
    assert.equal(r.approval.history[3].note, "อนุมัติตามแผน");

    // 3) a manager's own request goes to … himself: refused; the owner can approve it
    const own = await request("G-pur", "L-a", "expenses", "Finance", { name: "ค่าแท็กซี่", amount: 800, category: "ขนส่ง", date: "2026-11-07", status: "pending" });
    await send("G-pur", "L-a", own);
    await assert.rejects(act("G-pur", "L-a", own, "approve"), /ของตัวเองไม่ได้/);
    await act("G-pur", "L-owner", own, "approve");
    assert.equal((await row(own)).status, "approved");

    // 4) one manager cannot approve two steps of the same round
    await db.exec("reset role;");
    await db.query("update memberships set departments='{Marketing,Finance}' where user_id=$1", [boss]);
    const both = await request("G-mkt", "L-mk", "marketing_budget", "Marketing", { name: "งบอีเวนต์", budget: 40000 });
    await send("G-mkt", "L-mk", both);
    await act("G-mkt", "L-boss", both, "approve");
    await assert.rejects(act("G-fin", "L-boss", both, "approve"), /ต้องเป็นผู้อนุมัติอีกคน/);
    // reject ends it with the reason
    await act("G-fin", "L-may", both, "reject", "เกินงบไตรมาส");
    r = await row(both);
    assert.equal(r.status, "rejected");
    assert.equal(r.approval.history.at(-1)?.note, "เกินงบไตรมาส");

    // 5) leave: department manager → HR, whatever the amount
    const leave = await request("G-pur", "L-ton", "leaves", "HR", { name: "ลาพักร้อน 2 วัน" });
    await send("G-pur", "L-ton", leave);
    assert.deepEqual((await row(leave)).approval.steps, [{ dept: "Purchasing" }, { dept: "HR" }]);

    // 6) the website: the old decide refuses; the chain action works for the signed-in approver of the step
    await login(owner);
    await assert.rejects(db.query("select decide_ingestion($1,$2,'approved','{}','')", [c, leave]), /ขั้นตอนอนุมัติ/);
    await login(a);
    await db.query("select web_approval_act($1,$2,'approve',null,null)", [c, leave]);
    await login(ton);
    await assert.rejects(db.query("select web_approval_act($1,$2,'approve',null,null)", [c, leave]));
    await db.exec("reset role;");
    assert.equal((await db.query<{ at: number }>("select (approval->>'at')::int as at from ingestions where id=$1", [leave])).rows[0].at, 1);

    // 7) a group that reads every message plans the chain when the read finishes
    await db.exec("reset role;");
    const tpl = JSON.stringify({ id: null, name: "x", department: "Finance", fields: [], steps: [], mode: "sort" });
    const auto = await one<string>("insert into ingestions(company_id,template,department,raw,source,group_id,source_user,target_kind)values($1,$2,'Finance','x','LINE','G-pur','L-ton','expenses')returning id", [c, tpl]);
    await db.exec("set role service_role;");
    const lease = await one<string>("select lease_id from claim_ingestion($1)", [auto]);
    await db.query("select complete_ingestion($1,$2,'{\"name\":\"ค่าส่ง\",\"amount\":12000}','[]','ai')", [auto, lease]);
    r = await row(auto);
    assert.equal(r.status, "review");
    assert.deepEqual(r.approval.steps, [{ dept: "Purchasing" }, { dept: "Finance" }]);

    // every decision is in the audit log
    await db.exec("reset role;");
    assert.ok((await one<number>("select count(*)::int from audit_events where action like 'approval_%'")) >= 9);
  } finally {
    await db.close();
  }
});
