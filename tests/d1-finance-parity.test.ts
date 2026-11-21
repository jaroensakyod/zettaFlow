// The D1 port of the finance functions (src/lib/d1/finance.ts) must behave exactly like Postgres: the same steps run
// against the real schema (PGlite, every migration) and against D1 (node:sqlite), and every outcome — return values,
// the exact error message — and every table they write (closing steps, budgets, targets, monthly goals, journal
// entries and lines, WHT certificates, issued documents, running numbers, chart of accounts, audit log) must match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { validateEntity } from "../src/lib/domain";
import { expenseCategories } from "../src/lib/catalog";
import { sqliteDriver } from "../src/lib/d1/driver";
import { Tenant } from "../src/lib/d1/tenant";
import { saveEntity } from "../src/lib/d1/entities";
import {
  companiesSeedAccounts,
  documentNumber,
  financeCloseStep,
  financeManager,
  financeSaveBudgets,
  financeSaveTargets,
  goalSet,
  issueDocument,
  issuedDocumentsList,
  postExpense,
} from "../src/lib/d1/finance";
import type { Viewer } from "../src/lib/d1/access";

const users = {
  owner: { id: "10000000-0000-4000-8000-000000000001", role: "owner", departments: [] as string[] },
  sales: { id: "10000000-0000-4000-8000-000000000002", role: "manager", departments: ["Sales"] },
  fman: { id: "10000000-0000-4000-8000-000000000003", role: "manager", departments: ["Finance"] },
  fstaff: { id: "10000000-0000-4000-8000-000000000004", role: "staff", departments: ["Finance"] },
  viewer: { id: "10000000-0000-4000-8000-000000000005", role: "viewer", departments: ["Finance"] },
} as const;
type Who = keyof typeof users;
type Data = Record<string, unknown>;
type Step =
  | { as: Who; op: "save"; label: string; kind: string; data: Data }
  | { as: Who; op: "manager" }
  | { as: Who; op: "close"; year: number; step: number; done: boolean }
  | { as: Who; op: "budgets"; year: number; budgets: unknown }
  | { as: Who; op: "targets"; year: number; revenue: number | null; profit: number | null; cap: number | null }
  | { as: Who; op: "goal"; month: string | null; target: number | null }
  | { as: Who; op: "post"; ref: string; lines: unknown; wht?: unknown }
  | { as: Who; op: "issue"; kind: string; ref: string }
  | { as: Who; op: "docnum"; kind: string; ref: string }
  | { as: Who; op: "list" };

const today = "2026-11-21";
const category = expenseCategories[0];
const expense = (label: string, name: string, date = today): Step => ({ as: "owner", op: "save", label, kind: "expenses", data: { name, category, date, amount: 100, status: "pending" } });
const ok2 = [
  { account: "5210", debit: 100 },
  { account: "1111", credit: 100 },
];
const wht = { form: "ภ.ง.ด.53", payee: "บริษัทผู้ให้เช่า", taxId: "0105555000000", base: 1000, rate: 3, amount: 30 };
const forty1 = Object.fromEntries(Array.from({ length: 41 }, (_, i) => ["D" + i, 1]));

const steps: Step[] = [
  { as: "owner", op: "save", label: "PR1", kind: "projects", data: { name: "งานบูธ", priority: "normal", status: "active" } },
  { as: "owner", op: "save", label: "C1", kind: "customers", data: { name: "ลูกค้า ก", status: "active" } },
  expense("E1", "ค่าเช่าเดือนพฤศจิกายน"),
  expense("E2", "ค่าไฟ", "2025-12-31"),
  { as: "owner", op: "save", label: "INV1", kind: "invoices", data: { name: "INV-1", customerId: "@C1", date: today, dueDate: today, subtotal: 100, vat: 7 } },
  { as: "owner", op: "save", label: "INV2", kind: "invoices", data: { name: "INV-2", customerId: "@C1", date: today, dueDate: today, subtotal: 100, vat: 0 } },
  { as: "owner", op: "save", label: "PAY1", kind: "payments", data: { name: "รับชำระ INV-2", invoiceId: "@INV2", direction: "income", date: today, amount: 100, method: "เงินสด" } },
  { as: "owner", op: "save", label: "PAY2", kind: "payments", data: { name: "จ่ายค่าของ", direction: "expense", date: today, amount: 50, method: "เงินสด" } },

  // finance_manager
  ...(["owner", "sales", "fman", "fstaff", "viewer"] as Who[]).map((as): Step => ({ as, op: "manager" })),

  // finance_close_step
  { as: "fstaff", op: "close", year: 2026, step: 1, done: true },
  { as: "sales", op: "close", year: 2026, step: 1, done: true },
  { as: "owner", op: "close", year: 1999, step: 1, done: true },
  { as: "owner", op: "close", year: 2026, step: 6, done: true },
  { as: "owner", op: "close", year: 2026, step: 0, done: false },
  { as: "owner", op: "close", year: 2026, step: 2, done: true },
  { as: "owner", op: "close", year: 2026, step: 1, done: true },
  { as: "fman", op: "close", year: 2026, step: 1, done: true },
  { as: "fman", op: "close", year: 2026, step: 2, done: true },
  { as: "owner", op: "close", year: 2026, step: 3, done: true },
  { as: "owner", op: "close", year: 2026, step: 2, done: false },
  { as: "owner", op: "close", year: 2026, step: 3, done: false },
  { as: "owner", op: "close", year: 2026, step: 5, done: false },
  { as: "owner", op: "close", year: 2025, step: 1, done: true },

  // finance_save_budgets
  { as: "fstaff", op: "budgets", year: 2026, budgets: { Sales: 1 } },
  { as: "owner", op: "budgets", year: 1999, budgets: { Sales: 1 } },
  { as: "owner", op: "budgets", year: 2026, budgets: [1, 2] },
  { as: "owner", op: "budgets", year: 2026, budgets: "Sales" },
  { as: "owner", op: "budgets", year: 2026, budgets: forty1 },
  { as: "owner", op: "budgets", year: 2026, budgets: { "": 1 } },
  { as: "owner", op: "budgets", year: 2026, budgets: { ["ฝ".repeat(61)]: 1 } },
  { as: "owner", op: "budgets", year: 2026, budgets: { Sales: "100" } },
  { as: "owner", op: "budgets", year: 2026, budgets: { Sales: -1 } },
  { as: "owner", op: "budgets", year: 2026, budgets: { Sales: 2e12 } },
  { as: "owner", op: "budgets", year: 2026, budgets: { Sales: 1000, Marketing: 250.5, ["ฝ".repeat(60)]: 0 } },
  { as: "fman", op: "budgets", year: 2026, budgets: { Sales: 2000, Finance: 10 } },
  { as: "owner", op: "budgets", year: 2025, budgets: { Sales: 5 } },
  { as: "owner", op: "budgets", year: 2025, budgets: {} },
  { as: "owner", op: "budgets", year: 2026, budgets: null },

  // finance_save_targets
  { as: "sales", op: "targets", year: 2026, revenue: 1, profit: 1, cap: 1 },
  { as: "owner", op: "targets", year: 2201, revenue: 1, profit: 1, cap: 1 },
  { as: "owner", op: "targets", year: 2026, revenue: -1, profit: 1, cap: 1 },
  { as: "owner", op: "targets", year: 2026, revenue: 1, profit: -2e12, cap: 1 },
  { as: "owner", op: "targets", year: 2026, revenue: -1, profit: 2e12, cap: -1 },
  { as: "owner", op: "targets", year: 2026, revenue: 5000000, profit: -100000, cap: 3000000.25 },
  { as: "fman", op: "targets", year: 2026, revenue: 6000000, profit: null, cap: null },
  { as: "owner", op: "targets", year: 2027, revenue: null, profit: null, cap: null },

  // goal_set
  { as: "fstaff", op: "goal", month: "2026-11-01", target: 1000 },
  { as: "viewer", op: "goal", month: "2026-11-01", target: 1000 },
  { as: "owner", op: "goal", month: null, target: 1000 },
  { as: "owner", op: "goal", month: "2026-11-01", target: null },
  { as: "owner", op: "goal", month: "2026-11-01", target: -1 },
  { as: "owner", op: "goal", month: "2026-11-01", target: 2e12 },
  { as: "owner", op: "goal", month: "2026-11-15", target: 1000 },
  { as: "sales", op: "goal", month: "2026-11-30", target: 2500.5 },
  { as: "sales", op: "goal", month: "2026-12-02", target: 99 },
  { as: "owner", op: "goal", month: "2026-12-31", target: 0 },
  { as: "owner", op: "goal", month: "2027-01-01", target: 0 },

  // post_expense: every refusal, then postings, re-postings and the WHT certificate
  { as: "sales", op: "post", ref: "E1", lines: ok2 },
  { as: "viewer", op: "post", ref: "E1", lines: ok2 },
  { as: "fstaff", op: "post", ref: "PR1", lines: ok2 },
  { as: "fstaff", op: "post", ref: "E1", lines: { a: 1 } },
  { as: "fstaff", op: "post", ref: "E1", lines: [ok2[0]] },
  { as: "fstaff", op: "post", ref: "E1", lines: null },
  { as: "fstaff", op: "post", ref: "E1", lines: [...ok2, { account: "9999", debit: 1 }] },
  { as: "fstaff", op: "post", ref: "E1", lines: [...ok2, "5210"] },
  { as: "fstaff", op: "post", ref: "E1", lines: [{ account: "5210", debit: 100, projectId: "not-a-uuid" }, ok2[1]] },
  { as: "fstaff", op: "post", ref: "E1", lines: [{ account: "5210", debit: 100, projectId: "20000000-0000-4000-8000-000000000009" }, ok2[1]] },
  { as: "fstaff", op: "post", ref: "E1", lines: [{ account: "5210", debit: 100, projectId: "@E2" }, ok2[1]] },
  { as: "fstaff", op: "post", ref: "E1", lines: [{ account: "5210", debit: "abc" }, ok2[1]] },
  { as: "fstaff", op: "post", ref: "E1", lines: [{ account: "5210", debit: 100 }, { account: "1111", credit: 99.99 }] },
  { as: "fstaff", op: "post", ref: "E1", lines: [{ account: "5210" }, { account: "1111" }] },
  { as: "fstaff", op: "post", ref: "E1", lines: [{ account: "5210", debit: 100, credit: 5 }, { account: "1111", credit: 95 }] },
  { as: "fstaff", op: "post", ref: "E1", lines: [{ account: "5210", debit: 10 }, { account: "5220", debit: -5 }, { account: "1111", credit: 5 }] },
  { as: "fstaff", op: "post", ref: "E1", lines: [{ account: "5210", debit: 10 }, { account: "1111", credit: 15 }, { account: "1112", credit: -5 }] },
  { as: "fstaff", op: "post", ref: "E1", lines: ok2, wht: { ...wht, form: "ภ.ง.ด.1" } },
  { as: "fstaff", op: "post", ref: "E1", lines: ok2, wht: { ...wht, form: null } },
  { as: "fstaff", op: "post", ref: "E1", lines: ok2, wht: { ...wht, base: "x" } },
  { as: "fstaff", op: "post", ref: "E1", lines: ok2, wht: { ...wht, rate: null } },
  {
    as: "fstaff",
    op: "post",
    ref: "E1",
    lines: [
      { account: "5210", debit: 0.1, projectId: "@PR1", costCenter: "HQ" },
      { account: "5220", debit: "0.2", projectId: "", costCenter: "" },
      { account: "1111", credit: 0.3 },
    ],
    wht,
  },
  { as: "owner", op: "post", ref: "E1", lines: ok2, wht: { ...wht, payee: "", taxId: null, base: "2000.50", amount: 60.02 } },
  { as: "owner", op: "post", ref: "E1", lines: ok2, wht: { ...wht, form: "ภ.ง.ด.3" } },
  { as: "owner", op: "post", ref: "E1", lines: ok2, wht: { ...wht, form: "bad" } },
  { as: "owner", op: "post", ref: "E1", lines: ok2 },
  { as: "owner", op: "post", ref: "E1", lines: ok2, wht },
  { as: "owner", op: "post", ref: "E2", lines: [{ account: 5210, debit: "1e2" }, { account: "1111", credit: 100 }], wht },
  { as: "owner", op: "post", ref: "E2", lines: [{ account: "5210", debit: 50 }, { account: "5900", debit: 50 }, { account: "2111", credit: 100 }] },

  // issue_document / document_number / issued_documents_list
  { as: "sales", op: "issue", kind: "tax_invoice", ref: "INV1" },
  { as: "viewer", op: "issue", kind: "tax_invoice", ref: "INV1" },
  { as: "fstaff", op: "issue", kind: "tax_invoice", ref: "C1" },
  { as: "fstaff", op: "issue", kind: "tax_invoice", ref: "PAY1" },
  { as: "fstaff", op: "issue", kind: "receipt", ref: "INV1" },
  { as: "fstaff", op: "issue", kind: "receipt", ref: "PAY2" },
  { as: "fstaff", op: "issue", kind: "credit_note", ref: "INV1" },
  { as: "fstaff", op: "issue", kind: "tax_invoice", ref: "E9" },
  { as: "fstaff", op: "docnum", kind: "tax_invoice", ref: "INV1" },
  { as: "fstaff", op: "issue", kind: "tax_invoice", ref: "INV1" },
  { as: "owner", op: "issue", kind: "tax_invoice", ref: "INV1" },
  { as: "owner", op: "issue", kind: "tax_invoice", ref: "INV2" },
  { as: "owner", op: "issue", kind: "receipt", ref: "INV2" },
  { as: "fstaff", op: "issue", kind: "receipt", ref: "PAY1" },
  { as: "fstaff", op: "docnum", kind: "tax_invoice", ref: "INV1" },
  { as: "viewer", op: "docnum", kind: "receipt", ref: "PAY1" },
  { as: "sales", op: "docnum", kind: "receipt", ref: "PAY1" },
  { as: "owner", op: "docnum", kind: "receipt", ref: "INV1" },
  { as: "owner", op: "list" },
  { as: "viewer", op: "list" },
  { as: "sales", op: "list" },
];

async function postgres() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text)returns text[]language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
  for (const [who, u] of Object.entries(users)) await db.query("insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now())", [u.id, who + "@test.local"]);
  for (const f of (await readdir("supabase/migrations")).sort()) await db.exec((await readFile("supabase/migrations/" + f, "utf8")).replace("create extension if not exists pgcrypto;", ""));
  const login = async (id: string | null, email = "") => {
    await db.exec("reset role;");
    if (!id) return db.exec("set role service_role;");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id, email]);
    await db.exec("set role authenticated;");
  };
  await login(users.owner.id, "owner@test.local");
  const company = (await db.query<{ id: string }>("select create_company('บริษัททดสอบ') as id")).rows[0].id;
  await login(null);
  await db.query("update subscriptions set plan='business',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [company]);
  for (const [who, u] of Object.entries(users))
    if (who !== "owner") await db.query("insert into memberships(company_id,user_id,email,name,role,departments) values ($1,$2,$3,$4,$5,$6)", [company, u.id, who + "@test.local", who, u.role, u.departments]);
  const schemas = (await db.query<{ kind: string; department: string; fields: unknown }>("select kind,department,fields from entity_schemas")).rows;
  const ownerName = (await db.query<{ name: string }>("select name from memberships where company_id=$1 and user_id=$2", [company, users.owner.id])).rows[0].name;
  return { db, login, company, schemas, ownerName };
}

test("finance functions on D1 match Postgres step for step", async () => {
  const pg = await postgres();
  const lite = new DatabaseSync(":memory:");
  lite.exec(readFileSync("cloudflare/d1/0001_schema.sql", "utf8"));
  for (const s of pg.schemas) lite.prepare("insert into entity_schemas(kind,department,fields) values (?,?,?)").run(s.kind, s.department, JSON.stringify(s.fields));
  const sql = sqliteDriver(lite);
  const viewers = Object.fromEntries(Object.entries(users).map(([who, u]) => [who, { userId: u.id, email: who + "@test.local", companyId: pg.company, role: u.role, departments: [...u.departments] }])) as Record<Who, Viewer>;
  // The company row and its AFTER INSERT trigger (companies_seed_accounts).
  lite.prepare("insert into companies(id,name) values (?,?)").run(pg.company, "บริษัททดสอบ");
  await new Tenant(sql, viewers.owner).atomic(companiesSeedAccounts(new Tenant(sql, viewers.owner), pg.company));
  for (const [who, u] of Object.entries(users))
    lite.prepare("insert into memberships(company_id,user_id,email,name,role,departments) values (?,?,?,?,?,?)").run(pg.company, u.id, who + "@test.local", who === "owner" ? pg.ownerName : who, u.role, JSON.stringify(u.departments));

  type Side = "pg" | "d1";
  const ids = { pg: {} as Record<string, string>, d1: {} as Record<string, string> };
  // An unknown label stands for a uuid that is in neither database.
  const ref = (side: Side, l: string) => ids[side][l] ?? "20000000-0000-4000-8000-0000000000ff";
  const resolve = (side: Side, v: unknown): unknown =>
    typeof v === "string" && v.startsWith("@") ? ids[side][v.slice(1)] : Array.isArray(v) ? v.map((x) => resolve(side, x)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(side, x)])) : v;
  const label = (side: Side, v: unknown): unknown =>
    typeof v === "string"
      ? (Object.entries(ids[side]).find(([, id]) => id === v)?.[0] ?? Object.entries(users).find(([, u]) => u.id === v)?.[0] ?? v)
      : Array.isArray(v)
        ? v.map((x) => label(side, x))
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, label(side, x)]))
          : v;
  const entryOut = (r: Data) => ({ entity: r.entity_id, date: r.date, memo: r.memo, by: r.posted_by, id: typeof r.id === "string" && r.id.length === 36 });
  const listOut = (rows: Data[]) => rows.map((r) => ({ kind: r.kind, entity: r.entity_id, number: r.number, date: r.date })).sort((a, b) => String(a.number).localeCompare(String(b.number)));
  const js = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

  async function onPg(s: Step): Promise<Data> {
    const u = users[s.as];
    await pg.login(u.id, s.as + "@test.local");
    const q = async <T = Data>(text: string, p: unknown[]) => (await pg.db.query<T>(text, p)).rows;
    const c = pg.company;
    try {
      switch (s.op) {
        case "save": {
          const [r] = await q<{ id: string }>("select * from save_entity($1,$2,$3,null,null)", [c, s.kind, JSON.stringify(validateEntity(s.kind, resolve("pg", s.data) as Data))]);
          ids.pg[s.label] = r.id;
          return { ok: true };
        }
        case "manager":
          return { r: (await q<{ r: boolean }>("select finance_manager($1) as r", [c]))[0].r };
        case "close":
          await q("select finance_close_step($1,$2,$3,$4)", [c, s.year, s.step, s.done]);
          return { ok: true };
        case "budgets":
          await q("select finance_save_budgets($1,$2,$3::jsonb)", [c, s.year, js(s.budgets)]);
          return { ok: true };
        case "targets":
          await q("select finance_save_targets($1,$2,$3,$4,$5)", [c, s.year, s.revenue, s.profit, s.cap]);
          return { ok: true };
        case "goal":
          await q("select goal_set($1,$2,$3)", [c, s.month, s.target]);
          return { ok: true };
        case "post": {
          const [r] = await q<Data>("select id::text,entity_id,date::text as date,memo,posted_by from post_expense($1,$2,$3::jsonb,$4::jsonb)", [c, ref("pg", s.ref), js(resolve("pg", s.lines)), js(resolve("pg", s.wht ?? null))]);
          return entryOut(r);
        }
        case "issue":
          return { r: (await q<{ r: string }>("select issue_document($1,$2,$3) as r", [c, s.kind, ref("pg", s.ref)]))[0].r };
        case "docnum":
          return { r: (await q<{ r: unknown }>("select document_number($1,$2,$3) as r", [c, s.kind, ref("pg", s.ref)]))[0].r ?? null };
        case "list":
          return { r: listOut(await q<Data>("select * from issued_documents_list($1)", [c])) };
      }
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  async function onD1(s: Step): Promise<Data> {
    const t = new Tenant(sql, viewers[s.as]);
    try {
      switch (s.op) {
        case "save": {
          const r = await saveEntity(t, s.kind, validateEntity(s.kind, resolve("d1", s.data) as Data));
          ids.d1[s.label] = r.id;
          return { ok: true };
        }
        case "manager":
          return { r: financeManager(t) };
        case "close":
          await financeCloseStep(t, s.year, s.step, s.done);
          return { ok: true };
        case "budgets":
          await financeSaveBudgets(t, s.year, s.budgets);
          return { ok: true };
        case "targets":
          await financeSaveTargets(t, s.year, s.revenue, s.profit, s.cap);
          return { ok: true };
        case "goal":
          await goalSet(t, s.month, s.target);
          return { ok: true };
        case "post":
          return entryOut(await postExpense(t, ref("d1", s.ref), resolve("d1", s.lines), resolve("d1", s.wht ?? null)));
        case "issue":
          return { r: await issueDocument(t, s.kind, ref("d1", s.ref)) };
        case "docnum":
          return { r: await documentNumber(t, s.kind, ref("d1", s.ref)) };
        case "list":
          return { r: listOut(await issuedDocumentsList(t)) };
      }
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  for (const [i, s] of steps.entries()) {
    const a = label("pg", await onPg(s)),
      b = label("d1", await onD1(s));
    assert.deepEqual(b, a, `step ${i + 1} (${s.as} ${s.op} ${JSON.stringify(s).slice(0, 160)})`);
    if (process.env.SHOW_PARITY) console.log(i + 1, s.as, s.op, JSON.stringify(a).slice(0, 200));
  }

  // Side effects, table by table.
  await pg.login(null);
  const pgRows = async (q: string) => (await pg.db.query<Data>(q, [])).rows;
  const liteRows = (q: string) => lite.prepare(q).all() as Data[];
  const same = async (name: string, d1q: string, pgq: string, shape: (r: Data) => unknown[]) => {
    const norm = (side: Side, rows: Data[]) => rows.map((r) => label(side, shape(r))).map((x) => JSON.stringify(x)).sort();
    assert.deepEqual(norm("d1", liteRows(d1q)), norm("pg", await pgRows(pgq)), name);
  };
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  await same("accounts", "select * from accounts", "select * from accounts", (r) => [r.code, r.name, r.type, r.category]);
  await same("cost_centers", "select * from cost_centers", "select * from cost_centers", (r) => [r.code, r.name, r.kind]);
  await same("finance_closing", "select * from finance_closing", "select * from finance_closing", (r) => [r.fiscal_year, r.step, r.done_by]);
  await same("finance_budgets", "select * from finance_budgets", "select * from finance_budgets", (r) => [r.fiscal_year, r.department, n(r.amount), r.updated_by]);
  await same("finance_targets", "select * from finance_targets", "select * from finance_targets", (r) => [r.fiscal_year, n(r.revenue), n(r.profit), n(r.expense_cap), r.updated_by]);
  await same("monthly_goals", "select * from monthly_goals", "select company_id,month::text as month,sales_target,updated_by from monthly_goals", (r) => [r.month, n(r.sales_target), r.updated_by]);
  await same("journal_entries", "select * from journal_entries", "select entity_id,date::text as date,memo,posted_by from journal_entries", (r) => [r.entity_id, r.date, r.memo, r.posted_by]);
  await same(
    "journal_lines",
    "select j.entity_id, l.* from journal_lines l join journal_entries j on j.id = l.entry_id",
    "select j.entity_id, l.* from journal_lines l join journal_entries j on j.id = l.entry_id",
    (r) => [r.entity_id, r.account_code, n(r.debit), n(r.credit), r.project_id, r.cost_center],
  );
  await same("journal_lines count", "select count(*) as c from journal_lines", "select count(*) as c from journal_lines", (r) => [n(r.c)]);
  await same("wht_certificates", "select * from wht_certificates", "select entity_id,year,seq,form,payee,tax_id,base,rate,amount,paid_on::text as paid_on from wht_certificates", (r) => [
    r.entity_id,
    n(r.year),
    n(r.seq),
    r.form,
    r.payee,
    r.tax_id,
    n(r.base),
    n(r.rate),
    n(r.amount),
    r.paid_on,
  ]);
  await same("issued_documents", "select * from issued_documents", "select * from issued_documents", (r) => [r.kind, r.entity_id, r.number, r.issued_by]);
  await same("doc_counters", "select * from doc_counters", "select * from doc_counters", (r) => [r.prefix, n(r.year), n(r.last)]);
  await same("expenses", "select id, version, json_extract(data,'$.reviewStatus') as rs, json_extract(data,'$.code') as code from entities where kind='expenses'", "select id, version, data->>'reviewStatus' as rs, data->>'code' as code from entities where kind='expenses'", (r) => [r.id, n(r.version), r.rs, r.code]);
  await same("audit_events", "select action, target, actor from audit_events", "select action, target, actor from audit_events where action <> 'company_created'", (r) => [r.action, r.target, r.actor]);
  await pg.db.close();
});
