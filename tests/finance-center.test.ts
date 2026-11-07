import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { summarize, yearTotals, type FinanceRecord } from "../src/lib/finance-center";
const owner = "10000000-0000-4000-8000-000000000001",
  manager = "10000000-0000-4000-8000-000000000002",
  staff = "10000000-0000-4000-8000-000000000003",
  sales = "10000000-0000-4000-8000-000000000004",
  stranger = "10000000-0000-4000-8000-000000000005";
test("financial center: budgets, targets and year-end closing are Finance-managed", async () => {
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
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','1@test.local',now()),('${manager}','2@test.local',now()),('${staff}','3@test.local',now()),('${sales}','4@test.local',now()),('${stranger}','5@test.local',now());`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const login = async (id: string) => {
      await db.exec("reset role;");
      await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id, id.slice(-1) + "@test.local"]);
      await db.exec("set role authenticated;");
    };
    const val = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0];
    const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;

    await login(owner);
    const c = await val<string>("select create_company('Finance Co')");
    await db.exec("reset role;");
    for (const [id, role, depts] of [
      [manager, "manager", "{Finance}"],
      [staff, "staff", "{Finance}"],
      [sales, "manager", "{Sales}"],
    ])
      await db.query("insert into memberships(company_id,user_id,name,email,role,departments)values($1,$2,'x',$3,$4,$5)", [c, id, id.slice(-1) + "@test.local", role, depts]);

    // The owner sets budgets; saving again replaces the year (Marketing dropped) and leaves other years alone.
    await login(owner);
    await db.query(`select finance_save_budgets($1,2026,'{"Sales":200000,"Marketing":150000,"Reserve":100000}')`, [c]);
    await db.query(`select finance_save_budgets($1,2025,'{"Sales":90000}')`, [c]);
    await db.query(`select finance_save_budgets($1,2026,'{"Sales":250000,"Reserve":100000}')`, [c]);
    assert.deepEqual(
      (await rows("select department,amount::float as amount from finance_budgets where fiscal_year=2026 order by department")).map((r) => [r.department, r.amount]),
      [["Reserve", 100000], ["Sales", 250000]],
    );
    assert.equal(Number(await val("select count(*) from finance_budgets where fiscal_year=2025")), 1);
    await assert.rejects(db.query(`select finance_save_budgets($1,2026,'{"Sales":-1}')`, [c]), /งบประมาณไม่ถูกต้อง/);
    await assert.rejects(db.query(`select finance_save_budgets($1,2026,'{"Sales":"abc"}')`, [c]), /งบประมาณไม่ถูกต้อง/);
    await assert.rejects(db.query(`select finance_save_budgets($1,1990,'{}')`, [c]), /ปีบัญชี/);

    // Targets: upsert, null clears.
    await db.query("select finance_save_targets($1,2026,1000000,400000,600000)", [c]);
    await db.query("select finance_save_targets($1,2026,1200000,null,600000)", [c]);
    const t = (await rows("select revenue::float as revenue,profit,expense_cap::float as cap from finance_targets where company_id=$1", [c]))[0];
    assert.deepEqual([t.revenue, t.profit, t.cap], [1200000, null, 600000]);

    // A Finance manager may plan and close; steps go in order and reopen from the end.
    await login(manager);
    await db.query(`select finance_save_budgets($1,2026,'{"Sales":250000,"HR":80000,"Reserve":100000}')`, [c]);
    await assert.rejects(db.query("select finance_close_step($1,2026,2,true)", [c]), /ก่อนหน้า/);
    await db.query("select finance_close_step($1,2026,1,true)", [c]);
    await db.query("select finance_close_step($1,2026,1,true)", [c]); // idempotent
    await db.query("select finance_close_step($1,2026,2,true)", [c]);
    await assert.rejects(db.query("select finance_close_step($1,2026,1,false)", [c]), /ถัดไป/);
    await db.query("select finance_close_step($1,2026,2,false)", [c]);
    assert.deepEqual((await rows("select step from finance_closing where company_id=$1 order by step", [c])).map((r) => r.step), [1]);
    await assert.rejects(db.query("select finance_close_step($1,2026,6,true)", [c]), /ขั้นตอน/);

    // Finance staff can read but not change.
    await login(staff);
    assert.equal(Number(await val("select count(*) from finance_budgets where company_id=$1", [c])), 4);
    assert.equal(Number(await val("select count(*) from finance_targets")), 1);
    await assert.rejects(db.query(`select finance_save_budgets($1,2026,'{}')`, [c]), /ไม่มีสิทธิ์/);
    await assert.rejects(db.query("select finance_save_targets($1,2026,1,1,1)", [c]), /ไม่มีสิทธิ์/);
    await assert.rejects(db.query("select finance_close_step($1,2026,2,true)", [c]), /ไม่มีสิทธิ์/);
    await assert.rejects(db.query("insert into finance_budgets(company_id,fiscal_year,department,amount)values($1,2026,'IT',1)", [c]));
    await assert.rejects(db.query("update finance_targets set revenue=1"));
    await assert.rejects(db.query("delete from finance_closing"));

    // A manager outside Finance sees nothing and cannot write; neither can another company.
    await login(sales);
    assert.equal(Number(await val("select count(*) from finance_budgets")), 0);
    assert.equal(Number(await val("select count(*) from finance_closing")), 0);
    await assert.rejects(db.query(`select finance_save_budgets($1,2026,'{}')`, [c]), /ไม่มีสิทธิ์/);
    await login(stranger);
    await val<string>("select create_company('Other Co')");
    assert.equal(Number(await val("select count(*) from finance_budgets")), 0);
    await assert.rejects(db.query("select finance_close_step($1,2026,2,true)", [c]), /ไม่มีสิทธิ์/);
    await db.exec("set role anon;");
    await assert.rejects(db.query("select * from finance_budgets"));
  } finally {
    await db.close();
  }
});

test("financial center: totals, department attribution and years come only from counted records", () => {
  const records: FinanceRecord[] = [
    { kind: "sales", date: "2026-01-10", amount: 500000, status: "confirmed" },
    { kind: "sales", date: "2026-02-10", amount: 99999, status: "draft" },
    { kind: "payments", date: "2026-03-01", amount: 300000, direction: "income" },
    { kind: "expenses", date: "2026-01-15", amount: 120000, status: "paid", costCenter: "Marketing" },
    { kind: "expenses", date: "2026-02-15", amount: 80000, status: "approved", costCenter: "การตลาด" },
    { kind: "expenses", date: "2026-02-20", amount: 50000, status: "approved", costCenter: "HQ" },
    { kind: "expenses", date: "2026-03-20", amount: 7000, status: "pending", costCenter: "IT" },
    { kind: "payments", date: "2026-04-01", amount: 30000, direction: "expense" },
    { kind: "sales", date: "2025-06-01", amount: 400000, status: "confirmed" },
    { kind: "expenses", date: "2025-06-01", amount: 100000, status: "paid" },
    { kind: "expenses", date: "bad", amount: 1, status: "paid" },
  ];
  const o = summarize(
    records,
    { year: 2026, budgets: { Marketing: 200000, Reserve: 100000 }, budgetYears: [2026], targets: { revenue: 1e6, profit: null, expenseCap: null }, closing: [] },
    { today: "2026-11-07", canManage: true, demo: false },
  );
  assert.deepEqual([o.totals.revenue, o.totals.expense, o.totals.profit, o.totals.tax, o.totals.net], [800000, 280000, 520000, 104000, 416000]);
  assert.equal(o.pendingExpenses, 1);
  assert.deepEqual(o.counts, { sales: 1, expenses: 3, paymentsIn: 1, paymentsOut: 1 });
  assert.deepEqual(
    o.byDept.map((d) => [d.id, d.budget, d.spent, d.revenue]),
    [["Sales", 0, 0, 500000], ["Marketing", 200000, 200000, 0], ["Unassigned", 0, 80000, 300000]],
  );
  assert.deepEqual(o.years.map((y) => [y.year, y.revenue, y.net]), [[2026, 800000, 416000], [2025, 400000, 240000]]);
  // A loss pays no CIT; an empty year is still a valid shape.
  assert.equal(yearTotals(2024, 100, 300).tax, 0);
  const empty = summarize([], { year: 2030, budgets: {}, budgetYears: [], targets: { revenue: null, profit: null, expenseCap: null }, closing: [] }, { today: "2026-11-07", canManage: false, demo: true });
  assert.deepEqual([empty.byDept.length, empty.daily.length, empty.years.length, empty.totals.revenue], [0, 0, 1, 0]);
});
