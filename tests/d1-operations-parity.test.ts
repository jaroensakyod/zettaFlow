// The D1 port of purchase_action / transfer_project_stock / update_project_stage must behave exactly like Postgres:
// the same steps run against the real schema (PGlite, every migration) and against D1 (node:sqlite +
// src/lib/d1/operations.ts), and every outcome — statuses, PO numbers, stock, project inventory, stage history,
// audit log, or the exact error message — has to match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { validateEntity } from "../src/lib/domain";
import { sqliteDriver } from "../src/lib/d1/driver";
import { Tenant } from "../src/lib/d1/tenant";
import { saveEntity } from "../src/lib/d1/entities";
import { purchaseAction, transferProjectStock, updateProjectStage } from "../src/lib/d1/operations";
import type { Viewer } from "../src/lib/d1/access";

const owner = "10000000-0000-4000-8000-000000000001",
  staff = "10000000-0000-4000-8000-000000000002";
type Data = Record<string, unknown>;
type Who = "owner" | "staff";
type Step =
  | { as: Who; op: "save"; label: string; kind: string; data: Data }
  | { as: Who; op: "purchase"; ref: string; action: string }
  | { as: Who; op: "transfer"; product: string; from?: string; to?: string; quantity: number; reference: string; reason: string }
  | { as: Who; op: "stage"; project: string; key: string; status: string; version?: number | "current" };
const today = "2026-11-21";
const po = (label: string, extra: Data = {}): Step => ({ as: "owner", op: "save", label, kind: "purchases", data: { name: "ใบสั่งซื้อ " + label, supplierId: "@S1", productId: "@P1", quantity: 5, unitCost: 10, orderDate: today, ...extra } });
const steps: Step[] = [
  { as: "owner", op: "save", label: "S1", kind: "suppliers", data: { name: "ผู้ขายไม้", status: "active" } },
  { as: "owner", op: "save", label: "P1", kind: "products", data: { name: "ไม้อัด", sku: "PLY-1", unit: "แผ่น", cost: 10, price: 20, reorderLevel: 1, status: "active" } },
  { as: "owner", op: "save", label: "SC", kind: "stock_counts", data: { name: "ตั้งต้น", productId: "@P1", date: today, systemQty: 0, countedQty: 20, status: "ปรับยอดแล้ว" } },
  { as: "owner", op: "save", label: "PR1", kind: "projects", data: { name: "งานบูธ", priority: "normal", status: "active" } },
  { as: "owner", op: "save", label: "PR2", kind: "projects", data: { name: "งานห้าง", priority: "normal", status: "active" } },
  po("PO1"),
  po("PO2", { lines: [{ name: "ตะปู", qty: 3, price: 7 }] }),
  po("PO3"),
  // Purchase orders: approval, vendor steps, receiving stock, cancelling.
  { as: "staff", op: "purchase", ref: "PO1", action: "approve" },
  { as: "owner", op: "purchase", ref: "PO1", action: "receive" },
  { as: "owner", op: "purchase", ref: "PO1", action: "approve" },
  { as: "owner", op: "purchase", ref: "PO1", action: "request_vendor" },
  { as: "owner", op: "purchase", ref: "PO1", action: "vendor_confirm" },
  { as: "owner", op: "purchase", ref: "PO1", action: "deliver" },
  { as: "owner", op: "purchase", ref: "PO1", action: "dispatch" },
  { as: "owner", op: "purchase", ref: "PO1", action: "deliver" },
  { as: "staff", op: "purchase", ref: "PO1", action: "receive" },
  { as: "owner", op: "purchase", ref: "PO1", action: "receive" },
  { as: "owner", op: "purchase", ref: "PO1", action: "receive" },
  { as: "owner", op: "purchase", ref: "PO1", action: "cancel" },
  { as: "owner", op: "purchase", ref: "PO2", action: "approve" },
  { as: "staff", op: "purchase", ref: "PO2", action: "cancel" },
  { as: "owner", op: "purchase", ref: "PO2", action: "receive" },
  { as: "staff", op: "purchase", ref: "PO3", action: "cancel" },
  { as: "owner", op: "purchase", ref: "PO3", action: "nonsense" },
  // Stock transfers: warehouse → project, project → project, project → warehouse, and every refusal.
  { as: "staff", op: "transfer", product: "P1", to: "PR1", quantity: 1, reference: "T0", reason: "ไม่มีสิทธิ์" },
  { as: "owner", op: "transfer", product: "P1", to: "PR1", quantity: 0, reference: "T1", reason: "ศูนย์" },
  { as: "owner", op: "transfer", product: "P1", quantity: 1, reference: "T1", reason: "ไม่มีปลายทาง" },
  { as: "owner", op: "transfer", product: "P1", to: "PR1", quantity: 1, reference: "  ", reason: "ไม่มีเลขอ้างอิง" },
  { as: "owner", op: "transfer", product: "P1", to: "PR1", quantity: 1000, reference: "T1", reason: "เกินสต็อก" },
  { as: "owner", op: "transfer", product: "P1", to: "PR1", quantity: 8, reference: "T1", reason: "ส่งไปงานบูธ" },
  { as: "owner", op: "transfer", product: "P1", to: "PR1", quantity: 1, reference: "T1", reason: "ซ้ำ" },
  { as: "owner", op: "transfer", product: "P1", to: "PR1", quantity: 2, reference: "T2", reason: "ส่งเพิ่ม" },
  { as: "owner", op: "transfer", product: "P1", from: "PR1", to: "PR2", quantity: 4, reference: "T3", reason: "ย้ายงาน" },
  { as: "owner", op: "transfer", product: "P1", from: "PR2", quantity: 9, reference: "T4", reason: "เกินที่มี" },
  { as: "owner", op: "transfer", product: "P1", from: "PR2", quantity: 3, reference: "T5", reason: "คืนคลัง" },
  { as: "owner", op: "transfer", product: "PR1", to: "PR2", quantity: 1, reference: "T6", reason: "ไม่ใช่สินค้า" },
  // Project stages: version checks, sign-off stages, closing only after every other stage is done.
  { as: "owner", op: "stage", project: "PR1", key: "location", status: "progress", version: 9 },
  { as: "owner", op: "stage", project: "PR1", key: "location", status: "progress", version: 1 },
  { as: "owner", op: "stage", project: "PR1", key: "location", status: "bogus", version: "current" },
  { as: "owner", op: "stage", project: "PR1", key: "location", status: "done", version: "current" },
  { as: "staff", op: "stage", project: "PR1", key: "procurement", status: "done", version: 1 },
  { as: "staff", op: "stage", project: "PR1", key: "close", status: "progress", version: 1 },
  { as: "staff", op: "stage", project: "PR1", key: "close", status: "done", version: "current" },
  { as: "staff", op: "stage", project: "PR1", key: "selling", status: "done", version: 1 },
  { as: "owner", op: "stage", project: "PR1", key: "close", status: "done", version: "current" },
  { as: "owner", op: "stage", project: "PR1", key: "nope", status: "done", version: 1 },
  ...["contract", "payment", "layout", "procurement", "warehouse", "setup", "selling", "summary"].map((key): Step => ({ as: "owner", op: "stage", project: "PR1", key, status: "done", version: "current" })),
  { as: "owner", op: "stage", project: "PR1", key: "close", status: "done", version: "current" },
  { as: "owner", op: "stage", project: "PR1", key: "close", status: "progress", version: "current" },
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
  await db.query("insert into memberships(company_id,user_id,email,name,role,departments) values ($1,$2,'staff@test.local','พนักงานจัดซื้อ','staff','{Purchasing,Operations}')", [company, staff]);
  await db.query("update subscriptions set plan='business',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [company]);
  const schemas = (await db.query<{ kind: string; department: string; fields: unknown }>("select kind,department,fields from entity_schemas")).rows;
  const ownerName = (await db.query<{ name: string }>("select name from memberships where company_id=$1 and user_id=$2", [company, owner])).rows[0].name;
  return { db, login, company, schemas, ownerName };
}

test("purchase_action / transfer_project_stock / update_project_stage on D1 match Postgres step for step", async () => {
  const pg = await postgres();
  const lite = new DatabaseSync(":memory:");
  lite.exec(readFileSync("cloudflare/d1/0001_schema.sql", "utf8"));
  for (const s of pg.schemas) lite.prepare("insert into entity_schemas(kind,department,fields) values (?,?,?)").run(s.kind, s.department, JSON.stringify(s.fields));
  lite.prepare("insert into companies(id,name) values (?,?)").run(pg.company, "บริษัททดสอบ");
  lite.prepare("insert into memberships(company_id,user_id,email,name,role,departments) values (?,?,?,?,?,?)").run(pg.company, owner, "owner@test.local", pg.ownerName, "owner", "[]");
  lite.prepare("insert into memberships(company_id,user_id,email,name,role,departments) values (?,?,?,?,?,?)").run(pg.company, staff, "staff@test.local", "พนักงานจัดซื้อ", "staff", '["Purchasing","Operations"]');
  const sql = sqliteDriver(lite);
  const viewers: Record<Who, Viewer> = {
    owner: { userId: owner, email: "owner@test.local", companyId: pg.company, role: "owner", departments: [] },
    staff: { userId: staff, email: "staff@test.local", companyId: pg.company, role: "staff", departments: ["Purchasing", "Operations"] },
  };
  type Side = "pg" | "d1";
  const ids = { pg: {} as Record<string, string>, d1: {} as Record<string, string> };
  const stageVersion = { pg: {} as Record<string, number>, d1: {} as Record<string, number> };
  const resolve = (side: Side, d: Data = {}): Data => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "string" && v.startsWith("@") ? ids[side][v.slice(1)] : v]));
  const label = (side: Side, v: unknown): unknown =>
    typeof v === "string" ? (Object.entries(ids[side]).find(([, id]) => id === v)?.[0] ?? v) : Array.isArray(v) ? v.map((x) => label(side, x)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, label(side, x)])) : v;
  // What each step left behind, in the shape both sides can be compared on.
  type Out = Data;
  const stageOut = (r: Data) => ({ key: r.key, status: r.status, version: Number(r.version), started: !!r.started_at, completed: !!r.completed_at, by: r.updated_by });
  const transferOut = (r: Data) => ({ product: r.product_id, from: r.from_project, to: r.to_project, quantity: Number(r.quantity), reference: r.reference, reason: r.reason, by: r.created_by, name: r.created_name });

  async function onPg(s: Step): Promise<Out> {
    await pg.login(s.as === "owner" ? owner : staff, s.as + "@test.local");
    const q = async <T = Data>(text: string, p: unknown[]) => (await pg.db.query<T>(text, p)).rows;
    try {
      if (s.op === "save") {
        const [r] = await q<{ id: string; data: Data; version: number }>("select * from save_entity($1,$2,$3,null,null)", [pg.company, s.kind, JSON.stringify(validateEntity(s.kind, resolve("pg", s.data)))]);
        ids.pg[s.label] = r.id;
        return { data: r.data, version: r.version };
      }
      if (s.op === "purchase") {
        await q("select purchase_action($1,$2,$3)", [pg.company, ids.pg[s.ref], s.action]);
        await pg.login(null);
        const [r] = await q<{ data: Data; version: number }>("select data,version from entities where id=$1", [ids.pg[s.ref]]);
        return { data: r.data, version: r.version };
      }
      if (s.op === "transfer") {
        const [r] = await q<Data>("select * from transfer_project_stock($1,$2,$3,$4,$5,$6,$7)", [pg.company, ids.pg[s.product], s.from ? ids.pg[s.from] : null, s.to ? ids.pg[s.to] : null, s.quantity, s.reference, s.reason]);
        return transferOut(r);
      }
      const k = s.project + ":" + s.key;
      const [r] = await q<Data>("select * from update_project_stage($1,$2,$3,$4,$5)", [pg.company, ids.pg[s.project], s.key, s.status, s.version === "current" ? (stageVersion.pg[k] ?? 1) : (s.version ?? null)]);
      stageVersion.pg[k] = Number(r.version);
      return stageOut(r);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  async function onD1(s: Step): Promise<Out> {
    const t = new Tenant(sql, viewers[s.as]);
    try {
      if (s.op === "save") {
        const r = await saveEntity(t, s.kind, validateEntity(s.kind, resolve("d1", s.data)));
        ids.d1[s.label] = r.id;
        return { data: r.data, version: r.version };
      }
      if (s.op === "purchase") {
        await purchaseAction(t, ids.d1[s.ref], s.action);
        const [r] = await t.selectInternal<{ data: Data; version: number }>("entities", { where: { id: ids.d1[s.ref] } });
        return { data: r.data, version: r.version };
      }
      if (s.op === "transfer") return transferOut(await transferProjectStock(t, ids.d1[s.product], s.from ? ids.d1[s.from] : null, s.to ? ids.d1[s.to] : null, s.quantity, s.reference, s.reason));
      const k = s.project + ":" + s.key;
      const r = await updateProjectStage(t, ids.d1[s.project], s.key, s.status, s.version === "current" ? (stageVersion.d1[k] ?? 1) : (s.version ?? null));
      stageVersion.d1[k] = r.version;
      return stageOut(r);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  for (const [i, s] of steps.entries()) {
    const a = await onPg(s),
      b = await onD1(s);
    // A PO number made from the record id differs between the two databases only by that id.
    const norm = (side: Side, o: Out) => {
      const data = o.data as Data | undefined;
      const poFromId = typeof data?.poNumber === "string" && /^PO-[0-9A-F]{12}$/.test(data.poNumber);
      return JSON.parse(JSON.stringify(label(side, poFromId ? { ...o, data: { ...data, poNumber: "PO-<id>" } } : o)));
    };
    assert.deepEqual(norm("d1", b), norm("pg", a), `step ${i + 1} (${s.as} ${s.op} ${JSON.stringify(s).slice(0, 140)})`);
    if (process.env.SHOW_PARITY) console.log(i + 1, s.as, s.op, JSON.stringify(norm("pg", a)).slice(0, 200));
  }

  // Side effects: stock, movements, project inventory, transfers, stage history, project status, audit log.
  await pg.login(null);
  const pgRows = async (q: string, p: unknown[] = []) => (await pg.db.query<Record<string, unknown>>(q, p)).rows;
  const liteRows = (q: string, ...p: (string | number | null)[]) => lite.prepare(q).all(...p) as Record<string, unknown>[];
  const stock = (side: Side, rows: Record<string, unknown>[]) => rows.map((r) => [label(side, r.id), Number(r.s)]).sort();
  assert.deepEqual(
    stock("d1", liteRows("select id, json_extract(data,'$.stock') as s from entities where kind='products'")),
    stock("pg", await pgRows("select id, data->>'stock' as s from entities where kind='products'")),
  );
  const moves = (rows: Record<string, unknown>[]) => rows.map((r) => [r.type, Number(r.quantity), String(r.reference).replace(/[0-9a-f-]{36}/, "<id>"), r.notes]).sort();
  assert.deepEqual(moves(liteRows("select type, quantity, reference, notes from stock_movements")), moves(await pgRows("select type, quantity, reference, notes from stock_movements")));
  const inventory = (side: Side, rows: Record<string, unknown>[]) => rows.map((r) => [label(side, r.product_id), label(side, r.project_id), Number(r.quantity)]).sort();
  assert.deepEqual(inventory("d1", liteRows("select * from project_inventory")), inventory("pg", await pgRows("select * from project_inventory")));
  assert.deepEqual(
    liteRows("select reference from stock_transfers").map((r) => r.reference).sort(),
    (await pgRows("select reference from stock_transfers")).map((r) => r.reference).sort(),
  );
  const history = (rows: Record<string, unknown>[]) => rows.map((r) => [r.key, r.department, r.status, r.actor]).sort();
  assert.deepEqual(history(liteRows("select * from project_stage_history")), history(await pgRows("select * from project_stage_history")));
  assert.equal(
    liteRows("select json_extract(data,'$.status') as s from entities where id=?", ids.d1.PR1)[0].s,
    (await pgRows("select data->>'status' as s from entities where id=$1", [ids.pg.PR1]))[0].s,
  );
  const actions = (rows: Record<string, unknown>[]) => rows.map((r) => r.action).sort();
  assert.deepEqual(actions(liteRows("select action from audit_events")), actions(await pgRows("select action from audit_events where company_id=$1 and action not in ('company_created')", [pg.company])));
  await pg.db.close();
});
