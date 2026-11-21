// The D1 port of save_entity / archive_entity must behave exactly like Postgres: the same steps run against the real
// schema (PGlite, every migration) and against D1 (node:sqlite + src/lib/d1/entities.ts), and every outcome — the
// saved record, its code, totals, stock, invoice status, or the exact error message — has to match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { validateEntity } from "../src/lib/domain";
import { sqliteDriver } from "../src/lib/d1/driver";
import { Tenant } from "../src/lib/d1/tenant";
import { archiveEntity, saveEntity } from "../src/lib/d1/entities";
import type { Viewer } from "../src/lib/d1/access";

const owner = "10000000-0000-4000-8000-000000000001",
  staff = "10000000-0000-4000-8000-000000000002";
type Data = Record<string, unknown>;
// raw: the payload goes to save_entity as it is (not through the app's validateEntity first), to compare
// validate_payload itself on cases the app's form would never send.
type Step = { label?: string; as: "owner" | "staff"; op: "save" | "archive"; kind?: string; data?: Data; ref?: string; version?: number | "current"; archive?: boolean; raw?: boolean };
const today = "2026-11-20";
const steps: Step[] = [
  { label: "C1", as: "owner", op: "save", kind: "customers", data: { name: "สยามฟู้ดส์", status: "active" } },
  { label: "C2", as: "owner", op: "save", kind: "customers", data: { name: "ไทยเทรด", status: "active", segment: "vip", creditDays: 30 } },
  { label: "C3", as: "staff", op: "save", kind: "customers", data: { name: "ร้านของพนักงาน", status: "active" } },
  { as: "staff", op: "save", kind: "expenses", data: { name: "ค่าเช่า", category: "ค่าเดินทางและที่พัก", date: today, amount: 500, status: "pending" } },
  { label: "E1", as: "owner", op: "save", kind: "expenses", data: { name: "ค่าน้ำมัน", category: "ค่าน้ำมัน/แก๊ส/รถยนต์", date: today, amount: 1200, status: "approved" } },
  { label: "P1", as: "owner", op: "save", kind: "products", data: { name: "กาแฟ", sku: "CF-1", unit: "ถุง", cost: 80, price: 120, reorderLevel: 5, status: "active" } },
  { label: "SC", as: "owner", op: "save", kind: "stock_counts", data: { name: "นับต้นเดือน", productId: "@P1", date: today, systemQty: 0, countedQty: 10, status: "ปรับยอดแล้ว" } },
  { label: "SI", as: "owner", op: "save", kind: "stock_issues", data: { name: "เบิกไปงาน", productId: "@P1", quantity: 3, requester: "สมชาย", date: today, status: "จ่ายของแล้ว" } },
  { as: "owner", op: "save", kind: "stock_issues", data: { name: "เบิกเยอะเกิน", productId: "@P1", quantity: 50, requester: "สมชาย", date: today, status: "จ่ายของแล้ว" } },
  { as: "owner", op: "save", kind: "stock_issues", ref: "SI", version: "current", data: { name: "เบิกไปงาน", productId: "@P1", quantity: 4, requester: "สมชาย", date: today, status: "จ่ายของแล้ว" } },
  { label: "I1", as: "owner", op: "save", kind: "invoices", data: { name: "ใบแจ้งหนี้ 1", customerId: "@C1", date: today, dueDate: today, subtotal: 1000, vat: 7 } },
  { label: "PAY1", as: "owner", op: "save", kind: "payments", data: { name: "รับครึ่งแรก", invoiceId: "@I1", direction: "income", date: today, amount: 500, method: "โอนธนาคาร" } },
  { as: "owner", op: "save", kind: "payments", data: { name: "รับเกิน", invoiceId: "@I1", direction: "income", date: today, amount: 600, method: "โอนธนาคาร" } },
  { as: "owner", op: "archive", ref: "PAY1", archive: true },
  { label: "PR1", as: "owner", op: "save", kind: "projects", data: { name: "งานบูธ", priority: "normal", status: "active" } },
  { label: "Q1", as: "owner", op: "save", kind: "quotations", data: { name: "เสนอราคา", customerId: "@C1", date: today, lines: [{ name: "ชุดกาแฟ", qty: 2, price: 100 }], vatMode: "excluded", status: "ร่าง" } },
  { as: "staff", op: "save", kind: "quotations", ref: "Q1", version: "current", data: { name: "เสนอราคา", customerId: "@C1", date: today, lines: [{ name: "ชุดกาแฟ", qty: 2, price: 100 }], vatMode: "excluded", status: "ตอบรับ" } },
  { as: "owner", op: "save", kind: "customers", ref: "C1", version: 99, data: { name: "ผิดรุ่น", status: "active" } },
  { as: "owner", op: "save", kind: "customers", ref: "C1", version: "current", data: { name: "สยามฟู้ดส์ (ใหม่)", status: "inactive" } },
  { as: "staff", op: "archive", ref: "C3", archive: true },
  { as: "owner", op: "archive", ref: "P1", archive: true },
  { as: "owner", op: "save", kind: "customers", data: { name: "ไม่ครบ" } },
  // validate_payload's own rules (the same copy approvals and sample data use), on payloads sent as they are:
  // an item line without name / qty passes (Postgres's checks on a missing key are unknown, not false) …
  { label: "Q2", as: "owner", op: "save", raw: true, kind: "quotations", data: { name: "ไม่มีชื่อสินค้า", customerId: "@C2", date: today, lines: [{ qty: 3, price: 10 }, { price: 5, unit: "ชิ้น" }], vatMode: "excluded", status: "ร่าง" } },
  // … but a key that is there must be right: a JSON null category / discountType is refused,
  { as: "owner", op: "save", raw: true, kind: "quotations", data: { name: "หมวดว่าง", customerId: "@C2", date: today, lines: [{ name: "ก", qty: 1, price: 1, category: null }], status: "ร่าง" } },
  { as: "owner", op: "save", raw: true, kind: "quotations", data: { name: "ส่วนลดว่าง", customerId: "@C2", date: today, lines: [{ name: "ก", qty: 1, price: 1, discountType: null }], status: "ร่าง" } },
  // a day that does not exist fails the ::date cast, a relation that is not a uuid fails the ::uuid cast,
  { as: "owner", op: "save", raw: true, kind: "expenses", data: { name: "วันผิด", category: "ค่าน้ำมัน/แก๊ส/รถยนต์", date: "2026-02-30", amount: 10, status: "pending" } },
  { as: "owner", op: "save", raw: true, kind: "invoices", data: { name: "ลูกค้าผิด", customerId: "not-a-uuid", date: today, dueDate: today, subtotal: 10, vat: 7 } },
  // a text field must be a string, and fields that are not in entity_schemas (participants) are dropped.
  { as: "owner", op: "save", raw: true, kind: "customers", data: { name: ["ไม่ใช่ข้อความ"], status: "active" } },
  { label: "EV", as: "owner", op: "save", raw: true, kind: "events", data: { name: "ประชุมทีม", startDate: today, endDate: today, status: "planning", participants: [{ kind: "customers", id: "@C2", name: "ไทยเทรด" }] } },
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
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@test.local',now()),('${staff}','staff@test.local',now());`);
  for (const f of (await readdir("supabase/migrations")).sort()) await db.exec((await readFile("supabase/migrations/" + f, "utf8")).replace("create extension if not exists pgcrypto;", ""));
  const login = async (id: string | null, email = "") => {
    await db.exec("reset role;");
    if (!id) return db.exec("set role service_role;");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id, email]);
    await db.exec("set role authenticated;");
  };
  await login(owner, "owner@test.local");
  const company = (await db.query<{ id: string }>("select create_company('บริษัททดสอบ') as id")).rows[0].id;
  await login(null);
  await db.query("insert into memberships(company_id,user_id,email,name,role,departments) values ($1,$2,'staff@test.local','พนักงาน','staff','{Sales}')", [company, staff]);
  // A paid plan, so the Free-plan limits do not decide the outcome on either side.
  await db.query("update subscriptions set plan='business',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [company]);
  const schemas = (await db.query<{ kind: string; department: string; fields: unknown }>("select kind,department,fields from entity_schemas")).rows;
  return { db, login, company, schemas };
}

test("save_entity / archive_entity on D1 match Postgres step for step", async () => {
  const pg = await postgres();
  const lite = new DatabaseSync(":memory:");
  lite.exec(readFileSync("cloudflare/d1/0001_schema.sql", "utf8"));
  for (const s of pg.schemas) lite.prepare("insert into entity_schemas(kind,department,fields) values (?,?,?)").run(s.kind, s.department, JSON.stringify(s.fields));
  lite.prepare("insert into companies(id,name) values (?,?)").run(pg.company, "บริษัททดสอบ");
  const sql = sqliteDriver(lite);
  const viewers: Record<Step["as"], Viewer> = {
    owner: { userId: owner, email: "owner@test.local", companyId: pg.company, role: "owner", departments: [] },
    staff: { userId: staff, email: "staff@test.local", companyId: pg.company, role: "staff", departments: ["Sales"] },
  };
  const ids = { pg: {} as Record<string, string>, d1: {} as Record<string, string> };
  const versions = { pg: {} as Record<string, number>, d1: {} as Record<string, number> };
  const resolve = (side: "pg" | "d1", d: Data = {}): Data => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "string" && v.startsWith("@") ? ids[side][v.slice(1)] : v]));
  const label = (side: "pg" | "d1", v: unknown): unknown =>
    typeof v === "string" ? Object.entries(ids[side]).find(([, id]) => id === v)?.[0] ?? v : Array.isArray(v) ? v.map((x) => label(side, x)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, label(side, x)])) : v;
  type Out = { error?: string; kind?: string; department?: string; version?: number; data?: unknown };

  async function onPg(s: Step): Promise<Out> {
    await pg.login(s.as === "owner" ? owner : staff, s.as + "@test.local");
    try {
      if (s.op === "archive") {
        await pg.db.query("select archive_entity($1,$2,$3)", [pg.company, ids.pg[s.ref!], s.archive]);
        return {};
      }
      const data = s.raw ? resolve("pg", s.data) : validateEntity(s.kind!, resolve("pg", s.data));
      const v = s.version === "current" ? versions.pg[s.ref!] : s.version;
      const r = (await pg.db.query<{ id: string; kind: string; department: string; version: number; data: Data }>("select * from save_entity($1,$2,$3,$4,$5)", [pg.company, s.kind, JSON.stringify(data), s.ref ? ids.pg[s.ref] : null, v ?? null])).rows[0];
      if (s.label) ids.pg[s.label] = r.id;
      versions.pg[s.label || s.ref!] = r.version;
      return { kind: r.kind, department: r.department, version: r.version, data: r.data };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  async function onD1(s: Step): Promise<Out> {
    const t = new Tenant(sql, viewers[s.as]);
    try {
      if (s.op === "archive") {
        await archiveEntity(t, ids.d1[s.ref!], !!s.archive);
        return {};
      }
      const data = s.raw ? resolve("d1", s.data) : validateEntity(s.kind!, resolve("d1", s.data));
      const v = s.version === "current" ? versions.d1[s.ref!] : s.version;
      const r = await saveEntity(t, s.kind!, data, s.ref ? ids.d1[s.ref] : undefined, v);
      if (s.label) ids.d1[s.label] = r.id;
      versions.d1[s.label || s.ref!] = r.version;
      return { kind: r.kind, department: r.department, version: r.version, data: r.data };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  for (const [i, s] of steps.entries()) {
    const a = await onPg(s),
      b = await onD1(s);
    const norm = (side: "pg" | "d1", o: Out) => JSON.parse(JSON.stringify({ ...o, data: label(side, o.data) }));
    assert.deepEqual(norm("d1", b), norm("pg", a), `step ${i + 1} (${s.as} ${s.op} ${s.kind || ""} ${s.label || s.ref || ""})`);
    if (process.env.SHOW_PARITY) console.log(i + 1, s.as, s.op, s.kind || "", JSON.stringify(norm("pg", a)).slice(0, 230));
  }

  // Side effects: stock, stock movements, project stages, invoice, audit log.
  await pg.login(null);
  const pgRow = async (q: string, p: unknown[] = []) => (await pg.db.query<Record<string, unknown>>(q, p)).rows;
  const liteRow = (q: string, ...p: (string | number | null)[]) => lite.prepare(q).all(...p) as Record<string, unknown>[];
  assert.deepEqual(liteRow("select json_extract(data,'$.stock') as s from entities where id=?", ids.d1.P1)[0].s, Number((await pgRow("select data->>'stock' as s from entities where id=$1", [ids.pg.P1]))[0].s));
  assert.deepEqual(
    liteRow("select type, quantity from stock_movements order by created_at, quantity").map((r) => [r.type, Number(r.quantity)]),
    (await pgRow("select type, quantity from stock_movements order by created_at, quantity")).map((r) => [r.type, Number(r.quantity)]),
  );
  assert.equal(liteRow("select count(*) as n from project_stages")[0].n, Number((await pgRow("select count(*) as n from project_stages"))[0].n));
  const inv = (rows: Record<string, unknown>[]) => rows.map((r) => [Number(r.paid), r.status]);
  assert.deepEqual(inv(liteRow("select json_extract(data,'$.paid') as paid, json_extract(data,'$.status') as status from entities where id=?", ids.d1.I1)), inv(await pgRow("select data->>'paid' as paid, data->>'status' as status from entities where id=$1", [ids.pg.I1])));
  const actions = (rows: Record<string, unknown>[]) => rows.map((r) => r.action).sort();
  assert.deepEqual(actions(liteRow("select action from audit_events")), actions(await pgRow("select action from audit_events where company_id=$1 and action not in ('company_created')", [pg.company])));
  await pg.db.close();
});
