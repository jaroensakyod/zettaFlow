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

test("a value the page rejects is noted on the item instead of blocking approval", async () => {
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
    await db.query("select decide_ingestion($1,$2,'approved','{\"vehicle\":\"กระบะ\"}','')", [c, id]);
    await db.exec("reset role;");
    const i = await one<{ status: string; error: string }>(db, "select status,error from ingestions where id=$1", [id]);
    assert.equal(i.status, "approved");
    assert.match(i.error, /vehicles/);
    assert.equal((await db.query("select 1 from entities where company_id=$1 and kind='vehicles'", [c])).rows.length, 0);
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
