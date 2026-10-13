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
    await db.exec(
      (await readFile("supabase/migrations/" + file, "utf8")).replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  const login = async (id: string | null, email = "") => {
    await db.exec("reset role;");
    if (!id) return db.exec("set role service_role;");
    await db.query(
      `select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`,
      [id, email],
    );
    await db.exec("set role authenticated;");
  };
  return { db, login };
}
const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];
test("subscriptions, quotas, choice widgets, share links, slips and LINE keyword approval", async () => {
  const { db, login } = await setup();
  try {
    await login(owner, "owner@test.local");
    const c = (await one<{ id: string }>(db, "select create_company('A')as id"))
      .id;
    const usage = (
      await one<{ u: { subscription: { status: string; plan: string } } }>(
        db,
        "select usage_summary($1)as u",
        [c],
      )
    ).u;
    assert.equal(usage.subscription.status, "trial");
    assert.equal(usage.subscription.plan, "growth");
    // choice fields need options
    await assert.rejects(
      db.query("select save_template($1,'X','Sales',$2,'[]')", [
        c,
        JSON.stringify([
          { key: "car", label: "รถ", type: "choice", required: true },
        ]),
      ]),
    );
    const t = (
      await one<{ id: string }>(
        db,
        "select (save_template($1,'Delivery','Warehouse',$2,'[]')).id",
        [
          c,
          JSON.stringify([
            {
              key: "car",
              label: "ประเภทรถ",
              type: "choice",
              required: true,
              options: ["6 ล้อ", "กระบะ"],
            },
            { key: "qty", label: "จำนวน", type: "number", required: true },
          ]),
        ],
      )
    ).id;
    // quota: starter allows 5 workflows
    await login(null);
    await db.query("update subscriptions set plan='starter' where company_id=$1", [c]);
    await login(owner, "owner@test.local");
    for (let i = 0; i < 4; i++)
      await db.query("select save_template($1,$2,'Sales',$3,'[]')", [
        c,
        "T" + i,
        JSON.stringify([{ key: "a", label: "A", type: "text", required: false }]),
      ]);
    await assert.rejects(
      db.query("select save_template($1,'T9','Sales',$2,'[]')", [
        c,
        JSON.stringify([{ key: "a", label: "A", type: "text", required: false }]),
      ]),
      /โควตา/,
    );
    // expired trial blocks new documents
    await login(null);
    await db.query(
      "update subscriptions set trial_ends_at=now()-interval '1 day' where company_id=$1",
      [c],
    );
    await login(owner, "owner@test.local");
    await assert.rejects(
      db.query("select submit_ingestion($1,$2,'ประเภทรถ: กระบะ')", [c, t]),
      /หมดอายุ/,
    );
    await login(null);
    await db.query(
      "update subscriptions set trial_ends_at=now()+interval '1 day',plan='growth' where company_id=$1",
      [c],
    );
    // approved ingestions feed choice breakdown
    await login(owner, "owner@test.local");
    const job = (
      await one<{ id: string }>(
        db,
        "select (submit_ingestion($1,$2,'x')).id",
        [c, t],
      )
    ).id;
    await login(null);
    await db.query(
      "update ingestions set group_id='G1',status='review',values='{\"car\":\"กระบะ\",\"qty\":3}' where id=$1",
      [job],
    );
    await db.query(
      "insert into line_groups(group_id,company_id,template_id)values('G1',$1,$2)",
      [c, t],
    );
    await db.query(
      "insert into line_users(company_id,line_user_id,user_id)values($1,'U1',$2)",
      [c, owner],
    );
    assert.equal(
      (await one<{ r: string | null }>(db, "select line_keyword_approve('G1','U1','สวัสดี')as r")).r,
      null,
    );
    assert.equal(
      (await one<{ r: string }>(db, "select line_keyword_approve('G1','U1','อนุมัติปล่อยของ')as r")).r,
      job,
    );
    assert.equal(
      (await one<{ status: string }>(db, "select status from ingestions where id=$1", [job])).status,
      "approved",
    );
    const stats = (await one<{ s: { review: number } }>(db, "select line_quick_stats('G1')as s")).s;
    assert.equal(stats.review, 0);
    await login(owner, "owner@test.local");
    const pie = (
      await one<{ b: { key: string; buckets: Record<string, number> }[] }>(
        db,
        "select template_breakdowns($1)as b",
        [c],
      )
    ).b;
    assert.deepEqual(pie[0].buckets, { กระบะ: 1 });
    // share links: owner only, metrics limited to chosen keys
    const share = await one<{ id: string }>(
      db,
      "select (create_share($1,'h1',null,'Partner',array[$2],now()+interval '7 days')).id",
      [c, t + ":qty"],
    );
    assert.ok(share.id);
    await login(other, "other@test.local");
    await assert.rejects(
      db.query(
        "select create_share($1,'h2',null,'x',array['a'],now()+interval '1 day')",
        [c],
      ),
    );
    await assert.rejects(db.query("select share_metrics($1,array['x'])", [c]));
    await login(null);
    const metrics = (
      await one<{ m: { key: string; total: number }[] }>(
        db,
        "select share_metrics($1,array[$2])as m",
        [c, t + ":qty"],
      )
    ).m;
    assert.equal(metrics.length, 1);
    assert.equal(Number(metrics[0].total), 3);
    // payments: slip ref single-use; confirmation activates the plan
    await login(owner, "owner@test.local");
    const pay = await one<{ id: string; amount: string }>(
      db,
      "select * from request_payment($1,'starter','monthly',null,'{}','REF1')",
      [c],
    );
    assert.equal(Number(pay.amount), 1273.3);
    await assert.rejects(
      db.query("select request_payment($1,'starter','monthly',null,'{}','REF1')", [c]),
      /ถูกใช้แล้ว/,
    );
    await assert.rejects(db.query("select confirm_payment($1,'verified')", [pay.id]));
    await login(null);
    await db.query("select confirm_payment($1,'verified')", [pay.id]);
    const sub = await one<{ status: string; plan: string }>(
      db,
      "select * from subscriptions where company_id=$1",
      [c],
    );
    assert.equal(sub.status, "active");
    assert.equal(sub.plan, "starter");
    // add-ons: trial includes everything; paid plan only what was bought; payment with add-ons activates them
    assert.equal((await one<{ h: boolean }>(db, "select has_addon($1,'exec_dashboard')as h", [c])).h, false);
    await login(owner, "owner@test.local");
    const pay2 = await one<{ id: string; amount: string }>(
      db,
      "select * from request_payment($1,'growth','monthly',null,'{}','REF2',array['exec_dashboard'],2)",
      [c],
    );
    assert.equal(Number(pay2.amount), Math.round((3490 + 990 + 300) * 107) / 100);
    await assert.rejects(db.query("select request_payment($1,'growth','monthly',null,'{}','REF3',array['hack'])", [c]));
    await login(null);
    await db.query("select confirm_payment($1,'verified')", [pay2.id]);
    assert.equal((await one<{ h: boolean }>(db, "select has_addon($1,'exec_dashboard')as h", [c])).h, true);
    assert.equal((await one<{ h: boolean }>(db, "select has_addon($1,'custom_form')as h", [c])).h, false);
    await db.exec("reset role;");
    assert.equal((await one<{ l: number }>(db, "select plan_limit($1,'users')as l", [c])).l, 12);
    assert.equal((await one<{ d: number }>(db, "select documents d from plans where id='enterprise'")).d, 20000);
    // support chat: owner sends, other tenants cannot read, operator replies via service role
    await login(owner, "owner@test.local");
    await db.query("select support_send($1,'ช่วยตั้งค่า LINE หน่อย')", [c]);
    await assert.rejects(db.query("select support_reply($1,'x','hi')", [c]));
    await login(other, "other@test.local");
    assert.equal((await db.query("select * from support_messages")).rows.length, 0);
    await assert.rejects(db.query("select support_send($1,'hack')", [c]));
    await login(null);
    await db.query("select support_reply($1,'ทีมงาน','ได้เลยครับ')", [c]);
    const th = await one<{ unread_admin: number; unread_customer: number }>(db, "select * from support_threads where company_id=$1", [c]);
    assert.equal(th.unread_admin, 0);
    assert.equal(th.unread_customer, 1);
    await login(owner, "owner@test.local");
    assert.equal((await db.query("select * from support_messages")).rows.length, 2);
    await db.query("select support_seen($1)", [c]);
    assert.equal((await one<{ unread_customer: number }>(db, "select unread_customer from support_threads where company_id=$1", [c])).unread_customer, 0);
    // promos: only active, in-window rows are public; anon cannot write
    await login(null);
    await db.query("insert into promos(title,active)values('A',true),('B',false)");
    await db.query("insert into promos(title,ends_at)values('C',now()-interval '1 day')");
    await db.exec("reset role;set role anon;");
    assert.deepEqual((await db.query<{ title: string }>("select title from promos")).rows.map((r) => r.title), ["A"]);
    await assert.rejects(db.query("insert into promos(title)values('X')"));
  } finally {
    await db.close();
  }
});
