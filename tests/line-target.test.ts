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


test("an approved LINE/web item lands on the template's target page, mapped and validated", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('A')as id")).id;
    const fields = [
      { key: "vendor", label: "ผู้ขาย", type: "text", required: true },
      { key: "total", label: "ยอด", type: "number", required: true },
      { key: "bill_date", label: "วันที่", type: "date", required: true },
    ];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'บิลจากกลุ่ม','Finance',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    await db.query("select set_template_target($1,$2,'expenses',$3)", [c, t, { vendor: "payee", total: "amount", bill_date: "date" }]);
    const submit = async (values: object) => {
      const id = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'บิล')).id", [c, t])).id;
      await db.exec("reset role;");
      await db.query("update ingestions set status='review',values=$2 where id=$1", [id, values]);
      await login(owner, "owner@test.local");
      return id;
    };
    const ok = await submit({ vendor: "ร้านเครื่องเขียน", total: 535, bill_date: "2026-10-20" });
    await db.query("select decide_ingestion($1,$2,'approved',$3,'')", [c, ok, { vendor: "ร้านเครื่องเขียน", total: 535, bill_date: "2026-10-20" }]);
    await db.exec("reset role;");
    const rows = (await db.query<{ data: Record<string, unknown>; department: string }>("select data,department from entities where company_id=$1 and kind='expenses'", [c])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].department, "Finance");
    assert.equal(rows[0].data.payee, "ร้านเครื่องเขียน");
    assert.equal(rows[0].data.amount, 535);
    assert.equal(rows[0].data.date, "2026-10-20");
    assert.equal(rows[0].data.ingestionId, ok);
    assert.ok(String(rows[0].data.name).startsWith("บิลจากกลุ่ม"), "name falls back to the template name");
    assert.ok(rows[0].data.category === undefined || typeof rows[0].data.category === "string");
    // only owners can point a template somewhere, and only at real pages
    await rejects(db.query("select set_template_target($1,$2,'nope','{}')", [c, t]), /ไม่พบหน้าปลายทาง/);
    await login(other, "other@test.local");
    await rejects(db.query("select set_template_target($1,$2,'sales',null)", [c, t]), /เฉพาะเจ้าของ/);
  } finally {
    await db.close();
  }
});

test("approving an item whose record cannot be created fails with the reason and keeps it for review", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('B')as id")).id;
    const fields = [{ key: "vehicle", label: "รถ", type: "text", required: true }];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'รถ','Operations',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    await db.query("select set_template_target($1,$2,'vehicles','{}')", [c, t]);
    const id = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'x')).id", [c, t])).id;
    await db.exec("reset role;");
    await db.query("update ingestions set status='review',values='{\"vehicle\":\"กระบะ\"}' where id=$1", [id]);
    await login(owner, "owner@test.local");
    await assert.rejects(db.query("select decide_ingestion($1,$2,'approved','{\"vehicle\":\"กระบะ\"}','')", [c, id]), /บันทึกไม่สำเร็จ|ไม่พบ/);
    await db.exec("reset role;");
    const i = await one<{ status: string; decided_at: string | null }>(db, "select status,decided_at from ingestions where id=$1", [id]);
    assert.equal(i.status, "review");
    assert.equal(i.decided_at, null);
    assert.equal((await db.query("select 1 from entities where company_id=$1 and kind='vehicles'", [c])).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("a decision is stamped with who and how, and announced back in the LINE group that asked", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('D')as id")).id;
    const fields = [{ key: "name", label: "ชื่อ", type: "text", required: true }];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'เบิกงบ','Finance',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    const id = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'ขอเบิกงบซื้ออะไหล่')).id", [c, t])).id;
    await db.exec("reset role;");
    await db.query("update ingestions set status='review',group_id='G-repair',values='{\"name\":\"ซื้ออะไหล่\"}' where id=$1", [id]);
    await login(owner, "owner@test.local");
    await db.query("select decide_ingestion($1,$2,'rejected','{}','งบเดือนนี้หมด')", [c, id]);
    await db.exec("reset role;");
    const i = await one<{ status: string; decided_via: string; decided_by: string }>(db, "select status,decided_via,decided_by from ingestions where id=$1", [id]);
    assert.equal(i.status, "rejected");
    assert.equal(i.decided_via, "web");
    assert.equal(i.decided_by, owner);
    const n = await one<{ target: string; body: string; role: string }>(db, "select target,body,role from notification_outbox where ingestion_id=$1", [id]);
    assert.equal(n.target, "G-repair");
    assert.match(n.body, /ไม่อนุมัติ: ซื้ออะไหล่/);
    assert.match(n.body, /งบเดือนนี้หมด/);
  } finally {
    await db.close();
  }
});

test("a linked record sent as a name (customer) is resolved inside the same company", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('C')as id")).id;
    const cust = (await one<{ id: string }>(db, "select id from save_entity($1,'customers',$2)", [c, { name: "บริษัท สยามฟู้ดส์", status: "active" }]).catch(async () =>
      one<{ id: string }>(db, "select id from save_entity($1,'customers',$2)", [c, { name: "บริษัท สยามฟู้ดส์", status: "active", type: "นิติบุคคล" }]),
    )).id;
    const fields = [
      { key: "quote_no", label: "เลขที่", type: "text", required: true },
      { key: "customer", label: "ลูกค้า", type: "text", required: true },
      { key: "amount", label: "มูลค่า", type: "number", required: true },
    ];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'ใบเสนอราคา','Sales',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    await db.query("select set_template_target($1,$2,'quotations',$3)", [c, t, { quote_no: "name", customer: "customerId", amount: "subtotal" }]);
    const id = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'x')).id", [c, t])).id;
    const v = { quote_no: "QT-001", customer: "บริษัท สยามฟู้ดส์", amount: 12000 };
    await db.exec("reset role;");
    await db.query("update ingestions set status='review',values=$2 where id=$1", [id, v]);
    await login(owner, "owner@test.local");
    await db.query("select decide_ingestion($1,$2,'approved',$3,'')", [c, id, v]);
    const q = await one<{ data: Record<string, unknown> }>(db, "select data from entities where company_id=$1 and kind='quotations'", [c]);
    assert.equal(q.data.customerId, cust);
    assert.equal(q.data.name, "QT-001");
    assert.equal(q.data.status, "ร่าง");
  } finally {
    await db.close();
  }
});

test("AI extraction knows when a LINE message was written (Bangkok day)", async () => {
  const { dateContext } = await import("../src/lib/ai");
  // 23:30 UTC on the 5th is already the 6th in Bangkok.
  const c = dateContext("2026-11-05T23:30:00Z");
  assert.match(c, /written on 2026-11-06 \(Friday, Asia\/Bangkok\)/);
  assert.match(c, /พรุ่งนี้ = \+1/);
  assert.match(c, /minus 543/);
});

test("AI-sorted LINE group: pairs without a template, skips small talk, files work on its own page", async () => {
  const { pageTemplate } = await import("../src/lib/line-sort");
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('Sort')as id")).id;
    await db.exec("reset role;set role service_role;");
    // A group code with no template pairs the group in sorting mode; user codes still cannot pair groups.
    await db.query("insert into line_pairings(token_hash,company_id,template_id,user_id,expires_at)values('g1',$1,null,null,now()+interval '10 minutes'),('u1',$1,null,$2,now()+interval '10 minutes')", [c, owner]);
    await db.query("select pair_line_group('g1','Cgroup1')");
    await rejects(db.query("select pair_line_group('u1','Cgroup2')"), /รหัสหมดอายุ/);
    assert.equal((await one<{ template_id: string | null }>(db, "select template_id from line_groups where group_id='Cgroup1'")).template_id, null);

    const sortSnapshot = { id: null, name: "AI แยกอัตโนมัติ", department: "Operations", fields: [], steps: [], mode: "sort" };
    const queue = async (raw: string) =>
      (await one<{ id: string; lease_id: string }>(db,
        "insert into ingestions(company_id,template,department,raw,status,source,group_id,lease_id)values($1,$2,'Operations',$3,'processing','LINE','Cgroup1',gen_random_uuid())returning id,lease_id",
        [c, sortSnapshot, raw]));

    // Small talk: skipped, nothing to review, nothing pushed to the group.
    const chat = await queue("รับทราบค่ะ");
    await db.query("select complete_sorted_ingestion($1,$2,null,null,$3,'[]','ai-sort')", [chat.id, chat.lease_id, { note: "ข้อความทั่วไป" }]);
    assert.equal((await one<{ status: string }>(db, "select status from ingestions where id=$1", [chat.id])).status, "skipped");
    assert.equal((await db.query("select 1 from notification_outbox where id=$1", [chat.id])).rows.length, 0);

    // Work: moves to the page's department, gets the page's form, and the group hears it was saved.
    const work = await queue("@พิม ส่งแบบบูธพรุ่งนี้ 10 โมง");
    const t = pageTemplate("tasks");
    const values = { name: "ส่งแบบบูธ", assignee: "พิม", dueDate: "2026-11-06", department: "Operations", projectId: "ไม่มีโครงการนี้" };
    await db.query("select complete_sorted_ingestion($1,$2,'tasks',$3,$4,'[]','ai-sort')", [work.id, work.lease_id, t, values]);
    const i = await one<{ status: string; target_kind: string; department: string }>(db, "select status,target_kind,department from ingestions where id=$1", [work.id]);
    assert.deepEqual([i.status, i.target_kind, i.department], ["review", "tasks", "Operations"]);
    assert.equal((await db.query("select 1 from notification_outbox where id=$1", [work.id])).rows.length, 1);
    const odd = await queue("x");
    await rejects(db.query("select complete_sorted_ingestion($1,$2,'nope',$3,'{}','[]','ai-sort')", [odd.id, odd.lease_id, t]), /ไม่พบหน้าปลายทาง/);

    // Approval creates the task on its page; an unknown project name is dropped, required dropdowns get defaults.
    await login(owner, "owner@test.local");
    await db.query("select decide_ingestion($1,$2,'approved',$3,'')", [c, work.id, values]);
    await db.exec("reset role;");
    const task = await one<{ data: Record<string, unknown>; department: string }>(db, "select data,department from entities where company_id=$1 and kind='tasks'", [c]);
    assert.equal(task.data.name, "ส่งแบบบูธ");
    assert.equal(task.data.assignee, "พิม");
    assert.equal(task.data.dueDate, "2026-11-06");
    assert.equal(task.data.projectId, undefined);
    assert.ok(task.data.status && task.data.priority);
    assert.equal(task.data.ingestionId, work.id);
    assert.equal((await one<{ error: string | null }>(db, "select error from ingestions where id=$1", [work.id])).error, null);
  } finally {
    await db.close();
  }
});

test("sorted page forms keep chat fields and only ask for what the group must send", async () => {
  const { pageTemplate, sortPages } = await import("../src/lib/line-sort");
  for (const { kind } of sortPages) {
    const t = pageTemplate(kind);
    assert.ok(t.fields.length > 0, kind);
    for (const f of t.fields) {
      assert.ok(["text", "number", "date", "choice"].includes(f.type), `${kind}.${f.key}`);
      if (f.type === "choice") assert.ok(f.options?.length, `${kind}.${f.key} options`);
      assert.ok(!(f.required && ["name", "date", "department"].includes(f.key)), `${kind}.${f.key} defaults on approval`);
    }
  }
  const leave = pageTemplate("leaves");
  assert.deepEqual(leave.fields.find((f) => f.key === "employeeId"), { key: "employeeId", label: "พนักงาน (ชื่อ)", type: "text", required: true });
  assert.ok(!pageTemplate("expenses").fields.some((f) => ["receiptId", "lines", "aiNotes"].includes(f.key)));
});

test("the attachments table takes files up to the 15 MB upload limit", async () => {
  const { MAX_UPLOAD } = await import("../src/lib/files");
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('Files')as id")).id;
    await db.exec("reset role;set role service_role;");
    const id = (await one<{ id: string }>(db, "select gen_random_uuid()as id")).id;
    await db.query("insert into attachments(id,company_id,department,name,mime,size,path)values($1,$2,'Finance','big.pdf','application/pdf',$3,$4)", [id, c, MAX_UPLOAD, c + "/Finance/" + id]);
    await rejects(db.query("insert into attachments(id,company_id,department,name,mime,size,path)values(gen_random_uuid(),$1,'Finance','huge.pdf','application/pdf',$2,'p2')", [c, MAX_UPLOAD + 1]), /attachments_size_check/);
  } finally {
    await db.close();
  }
});

test("a receipt photo from LINE follows the approved expense", async () => {
  const { pageTemplate } = await import("../src/lib/line-sort");
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('Receipt')as id")).id;
    await db.exec("reset role;set role service_role;");
    const file = (await one<{ id: string }>(db, "select gen_random_uuid()as id")).id;
    await db.query("insert into attachments(id,company_id,department,name,mime,size,path)values($1,$2,'Operations','r.jpg','image/jpeg',1000,$3)", [file, c, c + "/Operations/" + file]);
    const job = await one<{ id: string; lease_id: string }>(db,
      "insert into ingestions(company_id,template,department,raw,status,source,group_id,lease_id,attachment_id)values($1,$2,'Operations','','processing','LINE','Cg',gen_random_uuid(),$3)returning id,lease_id",
      [c, { id: null, name: "AI แยกอัตโนมัติ", department: "Operations", fields: [], steps: [], mode: "sort" }, file]);
    const values = { name: "ชาเขียวนม", amount: 60, payee: "หจก.บุญรอดคอฟฟี่", date: "2023-11-27" };
    await db.query("select complete_sorted_ingestion($1,$2,'expenses',$3,$4,'[]','ai-sort')", [job.id, job.lease_id, pageTemplate("expenses"), values]);
    await login(owner, "owner@test.local");
    await db.query("select decide_ingestion($1,$2,'approved',$3,'')", [c, job.id, values]);
    await db.exec("reset role;");
    const e = await one<{ id: string; data: Record<string, unknown> }>(db, "select id,data from entities where company_id=$1 and kind='expenses'", [c]);
    assert.equal(e.data.receiptId, file);
    const a = await one<{ entity_id: string; department: string }>(db, "select entity_id,department from attachments where id=$1", [file]);
    assert.deepEqual([a.entity_id, a.department], [e.id, "Finance"]);
  } finally {
    await db.close();
  }
});

test("buying a feed ad takes coins, shows it to other companies only, and refuses when coins run short", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const a = (await one<{ id: string }>(db, "select create_company('Advertiser')as id")).id;
    const b = (await one<{ id: string }>(db, "select create_company('Viewer')as id")).id;
    await db.exec("reset role;");
    await db.query("insert into coin_wallets(company_id,balance)values($1,70)on conflict(company_id)do update set balance=70", [a]);
    await login(owner, "owner@test.local");
    const ad = { title: "รับออกแบบบูธ", body: "ครบจบในที่เดียว", cta_label: "ดูผลงาน", cta_url: "https://example.com", tone: "pink" };
    const bought = await one<{ id: string; coins: number }>(db, "select * from buy_feed_ad($1,'d7',$2)", [a, JSON.stringify(ad)]);
    assert.equal(bought.coins, 60);
    const seen = (await one<{ x: { title: string; company: string }[] }>(db, "select feed_ads_live($1)as x", [b])).x;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].title, "รับออกแบบบูธ");
    assert.equal(seen[0].company, "Advertiser");
    assert.equal((await one<{ x: unknown[] }>(db, "select feed_ads_live($1)as x", [a])).x.length, 0);
    await db.query("select feed_ad_track($1,$2,'view')", [b, bought.id]);
    await db.query("select feed_ad_track($1,$2,'view')", [b, bought.id]);
    const mine = (await one<{ x: { views: number }[] }>(db, "select my_feed_ads($1)as x", [a])).x;
    assert.equal(mine[0].views, 1);
    await assert.rejects(db.query("select buy_feed_ad($1,'d7',$2)", [a, JSON.stringify(ad)]), /เหรียญไม่พอ/);
    await db.exec("reset role;");
    assert.equal((await one<{ balance: number }>(db, "select balance from coin_wallets where company_id=$1", [a])).balance, 10);
  } finally {
    await db.close();
  }
});

test("a free trial stops at its ceilings; a paid plan does not", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('Trial Co')as id")).id;
    // New companies start on Free; this one is put on a Growth trial still running (as before 0060).
    await db.exec("reset role;");
    await db.query("update subscriptions set plan='growth',status='trial',trial_ends_at=now()+interval '14 days' where company_id=$1", [c]);
    await login(owner, "owner@test.local");
    const fields = [{ key: "name", label: "ชื่อ", type: "text", required: true }];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'งาน','Operations',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    await db.exec("reset role;");
    await db.query("update trial_limits set amount=2 where resource='documents'");
    await db.query("insert into line_groups(group_id,company_id)values('Gt1',$1),('Gt2',$1)", [c]);
    await assert.rejects(db.query("insert into line_groups(group_id,company_id)values('Gt3',$1)", [c]), /ช่วงทดลองใช้ได้สูงสุด 2 กลุ่ม LINE/);
    await login(owner, "owner@test.local");
    await db.query("select submit_ingestion($1,$2,'a')", [c, t]);
    await db.query("select submit_ingestion($1,$2,'b')", [c, t]);
    await assert.rejects(db.query("select submit_ingestion($1,$2,'c')", [c, t]), /ช่วงทดลองใช้ครบ 2 รายการ/);
    const usage = (await one<{ x: Record<string, { used: number; limit: number }> }>(db, "select trial_usage($1)as x", [c])).x;
    assert.equal(usage.documents.used, 2);
    assert.equal(usage.line_groups.limit, 2);
    await db.exec("reset role;");
    await db.query("update subscriptions set status='active',current_period_end=now()+interval '30 days' where company_id=$1", [c]);
    await db.query("insert into line_groups(group_id,company_id)values('Gt3',$1)", [c]);
    await login(owner, "owner@test.local");
    await db.query("select submit_ingestion($1,$2,'c')", [c, t]);
    assert.equal((await one<{ x: unknown }>(db, "select trial_usage($1)as x", [c])).x, null);
  } finally {
    await db.close();
  }
});

test("Free plan: new companies start free forever; 1 LINE group, monthly items; an ended trial falls back to Free", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('Free Co')as id")).id;
    const sum = (await one<{ u: { subscription: { plan: string; status: string }; plan: { id: string }; limits: { line_groups: number } } }>(db, "select usage_summary($1)as u", [c])).u;
    assert.deepEqual([sum.subscription.plan, sum.subscription.status, sum.plan.id, sum.limits.line_groups], ["free", "active", "free", 1]);
    const fields = [{ key: "name", label: "ชื่อ", type: "text", required: true }];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'งาน','Operations',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    await db.exec("reset role;");
    await db.query("insert into line_groups(group_id,company_id)values('Gf1',$1)", [c]);
    await assert.rejects(db.query("insert into line_groups(group_id,company_id)values('Gf2',$1)", [c]), /แพ็กเกจฟรีใช้ได้ 1 กลุ่ม LINE/);
    await db.query("update plans set documents=2 where id='free'");
    await login(owner, "owner@test.local");
    await db.query("select submit_ingestion($1,$2,'a')", [c, t]);
    await db.query("select submit_ingestion($1,$2,'b')", [c, t]);
    await assert.rejects(db.query("select submit_ingestion($1,$2,'c')", [c, t]), /แพ็กเกจฟรีใช้ได้ 2 รายการต่อเดือน/);
    const meters = (await one<{ x: { kind: string; ai_calls: { limit: number } } }>(db, "select trial_usage($1)as x", [c])).x;
    assert.equal(meters.kind, "free");
    assert.equal(meters.ai_calls.limit, 300);
    assert.equal((await one<{ h: boolean }>(db, "select has_addon($1,'exec_dashboard')as h", [c])).h, false);
    // An ended Growth trial keeps working, on Free limits.
    const d = (await one<{ id: string }>(db, "select create_company('Ended Co')as id")).id;
    await db.exec("reset role;");
    await db.query("update subscriptions set plan='growth',status='trial',trial_ends_at=now()-interval '1 day' where company_id=$1", [d]);
    await login(owner, "owner@test.local");
    const ended = (await one<{ u: { subscription: { plan: string; status: string; lapsed_plan: string }; active: boolean; limits: { line_groups: number } } }>(db, "select usage_summary($1)as u", [d])).u;
    assert.deepEqual([ended.subscription.plan, ended.subscription.status, ended.subscription.lapsed_plan, ended.active, ended.limits.line_groups], ["free", "active", "growth", true, 1]);
    const t2 = (await one<{ id: string }>(db, "select (save_template($1,'งาน','Operations',$2,'[]')).id", [d, JSON.stringify(fields)])).id;
    await db.query("select submit_ingestion($1,$2,'still works')", [d, t2]);
  } finally {
    await db.close();
  }
});

test("a leave sent by a LINE member linked to an employee is matched by their LINE account", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('HR Co')as id")).id;
    const fields = [{ key: "name", label: "หัวข้อการลา", type: "text", required: true }, { key: "employeeId", label: "พนักงาน (ชื่อ)", type: "text", required: true }];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'ลา','HR',$2,'[]')).id", [c, JSON.stringify([fields[0]])])).id;
    const id = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'ลาพรุ่งนี้')).id", [c, t])).id;
    await db.exec("reset role;");
    const emp = (await one<{ id: string }>(db, "insert into entities(company_id,kind,department,data)values($1,'employees','HR',$2)returning id", [c, { name: "สมชาย ใจดี", department: "Operations", employmentType: "ประจำ", status: "active", lineUserId: "U-line-1" }])).id;
    const values = { name: "ลาพรุ่งนี้", employeeId: "M", type: "ลากิจ", startDate: "2026-11-07", endDate: "2026-11-07" };
    await db.query("update ingestions set status='review',target_kind='leaves',department='HR',source_user='U-line-1',template=jsonb_set(template,'{fields}',$2::jsonb),values=$3 where id=$1", [id, JSON.stringify([...fields, { key: "type", label: "ประเภท", type: "text" }, { key: "startDate", label: "วันเริ่ม", type: "date" }, { key: "endDate", label: "วันสิ้นสุด", type: "date" }]), values]);
    await login(owner, "owner@test.local");
    await db.query("select decide_ingestion($1,$2,'approved',$3,'')", [c, id, values]);
    await db.exec("reset role;");
    const leave = await one<{ emp: string; status: string }>(db, "select data->>'employeeId' emp,data->>'status' status from entities where company_id=$1 and kind='leaves' and data->>'ingestionId'=$2", [c, id]);
    assert.equal(leave.emp, emp);
    // Approved from LINE = an approved leave, not "รอดำเนินการ".
    assert.equal(leave.status, "approved");
  } finally {
    await db.close();
  }
});

test("items missing data are reminded once, as one message per group", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('Nudge Co')as id")).id;
    const t = (await one<{ id: string }>(db, "select (save_template($1,'งาน','Operations',$2,'[]')).id", [c, JSON.stringify([{ key: "name", label: "ชื่อ", type: "text", required: true }])])).id;
    const a = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'a')).id", [c, t])).id;
    const b = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'b')).id", [c, t])).id;
    await db.exec("reset role;");
    await db.query("update ingestions set status='review',group_id='G-n',missing='[\"ยอดเงิน\"]',values=jsonb_build_object('name',raw),created_at=now()-interval '13 hours' where id in($1,$2)", [a, b]);
    assert.equal((await one<{ n: number }>(db, "select queue_nudges()as n")).n, 1);
    const n = await one<{ target: string; body: string }>(db, "select target,body from notification_outbox where target='G-n'");
    assert.match(n.body, /มี 2 รายการยังขาดข้อมูล/);
    assert.match(n.body, /• a — ขาด ยอดเงิน/);
    assert.equal((await one<{ n: number }>(db, "select queue_nudges()as n")).n, 0);
  } finally {
    await db.close();
  }
});

test("a LINE group code made for a department pairs the group into that department", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('Pair Co')as id")).id;
    await db.exec("reset role;");
    await db.query("insert into line_pairings(token_hash,company_id,department,expires_at)values('h-it',$1,'IT',now()+interval '10 minutes')", [c]);
    await db.query("select pair_line_group('h-it','G-it')");
    assert.equal((await one<{ department: string }>(db, "select department from line_groups where group_id='G-it'")).department, "IT");
    await assert.rejects(db.query("select pair_line_group('h-it','G-it2')"), /รหัสหมดอายุ/);
  } finally {
    await db.close();
  }
});

test("a record made from LINE keeps where it came from (group, department, sender), even after a web edit", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('Source Co')as id")).id;
    const fields = [{ key: "name", label: "ชื่อ", type: "text", required: true }, { key: "department", label: "แผนก", type: "text", required: true }];
    const t = (await one<{ id: string }>(db, "select (save_template($1,'งาน','Operations',$2,'[]')).id", [c, JSON.stringify(fields)])).id;
    await db.query("select set_template_target($1,$2,'tasks','{}')", [c, t]);
    const id = (await one<{ id: string }>(db, "select (submit_ingestion($1,$2,'ซ่อมแอร์')).id", [c, t])).id;
    await db.exec("reset role;");
    await db.query("insert into line_groups(group_id,company_id,name,department)values('G-src',$1,'ITEliteFlow','IT')", [c]);
    await db.query("update ingestions set status='review',group_id='G-src',sender_name='สมชาย',values='{\"name\":\"ซ่อมแอร์\",\"department\":\"Operations\"}' where id=$1", [id]);
    await login(owner, "owner@test.local");
    await db.query("select decide_ingestion($1,$2,'approved','{\"name\":\"ซ่อมแอร์\",\"department\":\"Operations\"}','')", [c, id]);
    await db.exec("reset role;");
    const e = await one<{ id: string; version: number; data: Record<string, string> }>(db, "select id,version,data from entities where company_id=$1 and data->>'ingestionId'=$2", [c, id]);
    assert.equal(e.data.sourceVia, "LINE");
    assert.equal(e.data.sourceGroup, "ITEliteFlow");
    assert.equal(e.data.sourceDepartment, "IT");
    assert.equal(e.data.sourceSender, "สมชาย");
    await db.query("update entities set data=jsonb_build_object('name','ซ่อมแอร์ห้องประชุม','department','Operations','status','pending') where id=$1", [e.id]);
    const after = await one<{ data: Record<string, string> }>(db, "select data from entities where id=$1", [e.id]);
    assert.equal(after.data.name, "ซ่อมแอร์ห้องประชุม");
    assert.equal(after.data.sourceGroup, "ITEliteFlow");
    assert.equal(after.data.ingestionId, id);
  } finally {
    await db.close();
  }
});
