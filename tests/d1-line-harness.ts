// Shared set-up for the LINE / ingestion / reports parity tests (not a test file itself): one company on real Postgres
// (PGlite with every migration) and the same company on D1 (node:sqlite with the D1 schema), the same people, plus
// helpers to seed identical rows on both, run a step on both and compare what they left behind.
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { sqliteDriver, type Sql, type SqlValue } from "../src/lib/d1/driver";
import { Tenant, decode } from "../src/lib/d1/tenant";
import { tables } from "../src/lib/d1/tables.gen";
import type { Viewer } from "../src/lib/d1/access";
import type { Role } from "../src/lib/types";

type Data = Record<string, unknown>;
export type Who = "owner" | "manager" | "staff" | "viewer" | "mk";
const ids: Record<Who, string> = {
  owner: "10000000-0000-4000-8000-000000000001",
  manager: "10000000-0000-4000-8000-000000000002",
  staff: "10000000-0000-4000-8000-000000000003",
  viewer: "10000000-0000-4000-8000-000000000004",
  mk: "10000000-0000-4000-8000-000000000005",
};
const people: Record<Who, { role: Role; departments: string[]; name: string }> = {
  owner: { role: "owner", departments: [], name: "" },
  manager: { role: "manager", departments: ["Finance", "Design"], name: "คุณเมย์" },
  staff: { role: "staff", departments: ["Finance", "Design", "Purchasing", "Operations"], name: "พนักงานต้น" },
  viewer: { role: "viewer", departments: ["Finance"], name: "ผู้ดู" },
  mk: { role: "manager", departments: ["Marketing"], name: "คุณบอส" },
};
const COPY = ["entity_schemas", "plans", "trial_limits", "free_limits", "companies", "memberships", "subscriptions"];

export type Harness = Awaited<ReturnType<typeof setup>>;
export async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text)returns text[]language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
  for (const w of Object.keys(ids) as Who[]) await db.query("insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now())", [ids[w], w + "@test.local"]);
  for (const f of (await readdir("supabase/migrations")).sort()) await db.exec((await readFile("supabase/migrations/" + f, "utf8")).replace("create extension if not exists pgcrypto;", ""));
  const login = async (who: Who | null) => {
    await db.exec("reset role;");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [who ? ids[who] : "", who ? who + "@test.local" : ""]);
    if (who) await db.exec("set role authenticated;");
  };
  await login("owner");
  const company = (await db.query<{ id: string }>("select create_company('บริษัททดสอบ') as id")).rows[0].id;
  await login(null);
  await db.query("update subscriptions set plan='business',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [company]);
  for (const w of ["manager", "staff", "viewer", "mk"] as Who[])
    await db.query("insert into memberships(company_id,user_id,email,name,role,departments) values ($1,$2,$3,$4,$5,$6)", [company, ids[w], w + "@test.local", people[w].name, people[w].role, people[w].departments]);
  await db.exec("delete from audit_events; delete from notification_outbox;");
  const types = new Map((await db.query<{ k: string; t: string }>("select table_name||'.'||column_name k, data_type t from information_schema.columns where table_schema='public'")).rows.map((r) => [r.k, r.t]));

  const lite = new DatabaseSync(":memory:");
  lite.exec(readFileSync("cloudflare/d1/0001_schema.sql", "utf8"));
  const sql: Sql = sqliteDriver(lite);
  const toLite = (table: string, row: Data) => {
    const m = tables[table];
    const keys = Object.keys(row).filter((k) => m.columns.includes(k) && row[k] !== undefined);
    const val = (k: string): SqlValue => {
      const v = row[k];
      if (v === null) return null;
      if (m.json.includes(k)) return JSON.stringify(v);
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(v)) return new Date(v).toISOString();
      return v as SqlValue;
    };
    lite.prepare(`insert into "${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map(() => "?").join(",")})`).run(...keys.map(val));
  };
  for (const table of COPY) for (const { r } of (await db.query<{ r: Data }>(`select to_jsonb(t) r from ${table} t`)).rows) toLite(table, r);

  /** The same row on both databases. */
  const seed = async (table: string, row: Data) => {
    await login(null);
    const keys = Object.keys(row);
    const pv = keys.map((k) => {
      const v = row[k],
        ty = types.get(table + "." + k);
      if (v === null || v === undefined) return null;
      if (ty === "ARRAY") return v;
      if (ty === "jsonb" || ty === "json") return JSON.stringify(v);
      return v;
    });
    await db.query(`insert into ${table}(${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, pv);
    toLite(table, row);
  };
  /** A row inserted on Postgres (its triggers run), then copied to D1 as Postgres left it; for entities also the project stages. */
  const seedPg = async (table: string, row: Data, key = "id") => {
    await login(null);
    const keys = Object.keys(row);
    const pv = keys.map((k) => {
      const v = row[k],
        ty = types.get(table + "." + k);
      if (v === null || v === undefined) return null;
      if (ty === "ARRAY") return v;
      if (ty === "jsonb" || ty === "json") return JSON.stringify(v);
      return v;
    });
    await db.query(`insert into ${table}(${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, pv);
    for (const { r } of (await db.query<{ r: Data }>(`select to_jsonb(t) r from ${table} t where ${key}=$1`, [row[key]])).rows) toLite(table, r);
    if (table === "entities") for (const { r } of (await db.query<{ r: Data }>(`select to_jsonb(t) r from project_stages t where project_id=$1`, [row.id])).rows) toLite("project_stages", r);
  };
  /** The same statement on both (Postgres text, SQLite text). */
  const exec = async (pgText: string, liteText: string, params: unknown[] = []) => {
    await login(null);
    await db.query(pgText, params);
    lite.prepare(liteText).run(...(params as SqlValue[]));
  };
  const viewer = (w: Who): Viewer => ({ userId: ids[w], email: w + "@test.local", companyId: company, role: people[w].role, departments: people[w].departments });
  const tenant = (w: Who) => new Tenant(sql, viewer(w));
  /** Run a function on Postgres as someone (null: the service role, as the LINE webhook and the worker). */
  const pgCall = async (who: Who | null, text: string, params: unknown[] = []) => {
    await login(who);
    try {
      return (await db.query<Data>(text, params)).rows;
    } finally {
      await login(null);
    }
  };
  /** Every row of a table on both sides, normalised and sorted. */
  const dump = async (table: string, fixed: string[] = []) => {
    await login(null);
    const pg = (await db.query<{ r: Data }>(`select to_jsonb(t) r from ${table} t`)).rows.map((x) => x.r);
    const d1 = (lite.prepare(`select * from "${table}"`).all() as Data[]).map((r) => decode(tables[table], r));
    const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Data)[k])])) : v);
    const key = (r: unknown) => JSON.stringify(canon(r));
    const sort = (rows: Data[]) => rows.map((r) => norm(r, fixed)).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    return { pg: sort(pg), d1: sort(d1) };
  };
  return { db, lite, sql, company, ids, login, seed, seedPg, exec, viewer, tenant, pgCall, dump, toLite };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/**
 * A value both databases can be compared on: ids made by either database become "<id>" (ids seeded by the test or
 * listed in `fixed` stay), timestamps become "<ts>", references built from an id ("EF-…") lose the id.
 */
export function norm(v: unknown, fixed: string[] = []): unknown {
  if (v instanceof Date) return "<ts>";
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return "<ts>";
    return v.replace(UUID, (m) => (m.startsWith("10000000-") || m.startsWith("20000000-") || fixed.includes(m) ? m : "<id>")).replace(/EF-[0-9A-F]{8}/g, "EF-<id>");
  }
  if (Array.isArray(v)) return v.map((x) => norm(x, fixed));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x, fixed)]));
  return v;
}
/** Both sides of a step: the value it returned, or the error text. */
export async function both<A, B>(pg: () => Promise<A>, d1: () => Promise<B>): Promise<{ pg: unknown; d1: unknown }> {
  const run = async (f: () => Promise<unknown>) => {
    try {
      const r = await f();
      // A void Postgres function comes back as "" (PGlite), a void TS function as undefined.
      return r === undefined || r === "" ? { ok: true } : { ok: r };
    } catch (e) {
      return { error: (e as Error).message };
    }
  };
  return { pg: norm(await run(pg)), d1: norm(await run(d1)) };
}
/** Fixed ids for seeded rows: 20000000-0000-4000-8000-<n>. */
export const fid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
