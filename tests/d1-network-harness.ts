// Shared set-up for the network parity tests (feed, B2B chat, deal room): the same companies and people on the real
// Postgres schema (PGlite, every migration) and on D1 (node:sqlite + cloudflare/d1/0001_schema.sql), a step runner
// that calls the Postgres function and its TypeScript port with the same arguments, and a normaliser that makes
// both outcomes comparable (ids → labels, timestamps → "<ts>", document numbers without the deal id).
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { sqliteDriver } from "../src/lib/d1/driver";
import { Tenant } from "../src/lib/d1/tenant";
import type { Viewer } from "../src/lib/d1/access";
import type { Role } from "../src/lib/types";

export const users = {
  alice: "10000000-0000-4000-8000-000000000001", // owner of A
  bob: "10000000-0000-4000-8000-000000000002", // owner of B
  carol: "10000000-0000-4000-8000-000000000003", // owner of C
  amy: "10000000-0000-4000-8000-000000000004", // staff in A
  vic: "10000000-0000-4000-8000-000000000005", // viewer in A
};
export type Who = keyof typeof users;
type Data = Record<string, unknown>;
type Side = "pg" | "d1";
export type Refs = (name: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
/**
 * One call on both sides. Postgres gets the asking company first (p_company) unless self is false; admin runs the
 * Postgres function as the table owner (helpers not granted to signed-in users) while still signed in as `as`.
 */
export type Step = { as: Who; fn: string; args?: (r: Refs) => unknown[]; save?: string; note?: string; self?: false; admin?: true; pgSql?: string; raw?: { pg: string; d1: string } };
const JSON_ARG = Symbol("json");
/** A JSON argument (sent as jsonb to Postgres, as the value to D1) — needed for top-level arrays. */
export const json = (v: unknown) => ({ [JSON_ARG]: v });
const isJson = (x: unknown): x is { [JSON_ARG]: unknown } => !!x && typeof x === "object" && JSON_ARG in x;
export type D1Fns = Record<string, (t: Tenant, ...a: any[]) => Promise<unknown> | unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Company profiles set before the steps (A and B share an industry, A and C a province). */
const profiles: Record<string, Data> = {
  A: { industry: "อีเวนต์", province: "กรุงเทพฯ", logo: "a/logo.png", cover: "a/cover.png", bio: "จัดงานครบวงจร", nameEn: "Alice Events", taxId: "0105561111111", address: "1 สุขุมวิท", phone: "021111111", description: "รับจัดงานอีเวนต์", website: "https://alice.example", line: "@alice", email: "hi@alice.example", visibility: "nameEn,description,website,products,phone" },
  B: { industry: "อีเวนต์", province: "เชียงใหม่", taxId: "0105562222222", address: "99 บางนา กรุงเทพฯ", phone: "022222222" },
  C: { province: "กรุงเทพฯ", registration: "REG-333" },
};

export async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text)returns text[]language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
    insert into auth.users(id,email,email_confirmed_at)values ${Object.entries(users)
      .map(([n, id]) => `('${id}','${n}@test.local',now())`)
      .join(",")};`);
  for (const f of (await readdir("supabase/migrations")).sort()) await db.exec((await readFile("supabase/migrations/" + f, "utf8")).replace("create extension if not exists pgcrypto;", ""));
  const login = async (who: Who | null) => {
    await db.exec("reset role;");
    if (!who) return;
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [users[who], who + "@test.local"]);
    await db.exec("set role authenticated;");
  };
  const company: Record<string, string> = {};
  for (const [label, who, name] of [
    ["A", "alice", "Alice Events"],
    ["B", "bob", "Bob Booth Studio"],
    ["C", "carol", "Carol Print"],
  ] as const) {
    await login(who);
    company[label] = (await db.query<{ id: string }>("select create_company($1) as id", [name])).rows[0].id;
  }
  await login(null);
  for (const [label, p] of Object.entries(profiles)) await db.query("update companies set profile=profile||$2::jsonb where id=$1", [company[label], JSON.stringify(p)]);
  // A company whose name is blank never shows in the directory or suggestions.
  company.Z = (await db.query<{ id: string }>("insert into companies(name) values('   ') returning id")).rows[0].id;
  await db.query("update subscriptions set plan='business',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [company.A]);
  await db.query("insert into memberships(company_id,user_id,email,name,role,departments) values ($1,$2,'amy@test.local','เอมี่','staff','{Sales}'),($1,$3,'vic@test.local','','viewer','{}')", [company.A, users.amy, users.vic]);
  // A sales package on A's profile.
  await db.query(`insert into entities(id,company_id,kind,department,data) values ('30000000-0000-4000-8000-000000000001',$1,'sales_packages','Sales','{"name":"บูธมาตรฐาน","code":"PK-1","type":"แพ็กเกจ","price":15000,"description":"บูธ 3x3","status":"active"}'),
    ('30000000-0000-4000-8000-000000000002',$1,'sales_packages','Sales','{"name":"ป้ายไวนิล","type":"สินค้า","price":"ไม่ระบุ","status":"active"}'),
    ('30000000-0000-4000-8000-000000000003',$1,'sales_packages','Sales','{"name":"เลิกขาย","type":"สินค้า","price":1,"status":"inactive"}')`, [company.A]);

  // D1: the same companies, people and records.
  const lite = new DatabaseSync(":memory:");
  lite.exec(readFileSync("cloudflare/d1/0001_schema.sql", "utf8"));
  for (const s of (await db.query<{ kind: string; department: string; fields: unknown }>("select kind,department,fields from entity_schemas")).rows) lite.prepare("insert into entity_schemas(kind,department,fields) values (?,?,?)").run(s.kind, s.department, JSON.stringify(s.fields));
  for (const c of (await db.query<{ id: string; name: string; profile: unknown; created_at: Date }>("select id,name,profile,created_at from companies order by created_at")).rows)
    lite.prepare("insert into companies(id,name,profile,created_at) values (?,?,?,?)").run(c.id, c.name, JSON.stringify(c.profile), c.created_at.toISOString());
  const members = (await db.query<{ company_id: string; user_id: string; email: string; name: string; role: Role; departments: string[]; disabled: boolean }>("select company_id,user_id,email,name,role,departments,disabled from memberships")).rows;
  for (const m of members) lite.prepare("insert into memberships(company_id,user_id,email,name,role,departments,disabled) values (?,?,?,?,?,?,?)").run(m.company_id, m.user_id, m.email, m.name, m.role, JSON.stringify(m.departments), m.disabled ? 1 : 0);
  for (const e of (await db.query<{ id: string; company_id: string; kind: string; department: string; data: unknown }>("select id,company_id,kind,department,data from entities")).rows)
    lite.prepare("insert into entities(id,company_id,kind,department,data) values (?,?,?,?,?)").run(e.id, e.company_id, e.kind, e.department, JSON.stringify(e.data));
  const sql = sqliteDriver(lite);
  const home: Record<Who, string> = { alice: company.A, bob: company.B, carol: company.C, amy: company.A, vic: company.A };
  const viewer = (who: Who): Viewer => {
    const m = members.find((x) => x.user_id === users[who] && x.company_id === home[who])!;
    return { userId: users[who], email: who + "@test.local", companyId: home[who], role: m.role, departments: m.departments };
  };
  return { db, lite, sql, login, company, home, viewer, tenant: (who: Who) => new Tenant(sql, viewer(who)) };
}
export type Harness = Awaited<ReturnType<typeof setup>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
/** Labels for ids: fixed ones (companies, people, client-chosen ids) and, per side, the others in order of appearance. */
export function labeller(h: Harness, fixed: Record<string, string> = {}) {
  const base: Record<string, string> = { ...Object.fromEntries(Object.entries(h.company).map(([k, v]) => [v, "co:" + k])), ...Object.fromEntries(Object.entries(users).map(([k, v]) => [v, "user:" + k])), ...fixed };
  const seen = { pg: new Map<string, string>(), d1: new Map<string, string>() };
  const idOf = (side: Side, id: string, assign: boolean) => {
    if (base[id]) return base[id];
    let l = seen[side].get(id);
    if (!l && assign) seen[side].set(id, (l = "#" + (seen[side].size + 1)));
    return l ?? "<uuid>";
  };
  const str = (side: Side, s: string, assign: boolean): unknown => {
    if (UUID.test(s)) return idOf(side, s, assign);
    if (TS.test(s)) return "<ts>";
    return s
      .replace(/\b(QT|IV|RC)(\d{4})-[0-9A-F]{5}/g, "$1$2-?????")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => idOf(side, m, assign));
  };
  const norm = (side: Side, v: unknown, assign = true): unknown => {
    if (v === undefined || v === null || v === "") return v ?? null;
    if (v instanceof Date) return "<ts>";
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "string") return str(side, v, assign);
    if (Array.isArray(v)) return v.map((x) => norm(side, x, assign));
    if (typeof v === "object")
      return Object.fromEntries(
        Object.keys(v as Data)
          .sort()
          .map((k) => [k, norm(side, (v as Data)[k], assign)]),
      );
    return v;
  };
  return norm;
}

/** Runs each step on Postgres and on D1 and asserts the same outcome. */
export async function runSteps(h: Harness, steps: Step[], d1: D1Fns, norm: ReturnType<typeof labeller>) {
  const saved = { pg: {} as Data, d1: {} as Data };
  const refs = (side: Side): Refs => (name) => {
    if (!(name in saved[side])) throw new Error(`no saved result ${name}`);
    return saved[side][name];
  };
  for (const [i, s] of steps.entries()) {
    const args = { pg: s.args?.(refs("pg")) ?? [], d1: (s.args?.(refs("d1")) ?? []).map((x) => (isJson(x) ? x[JSON_ARG] : x)) };
    let a: unknown, b: unknown;
    if (s.raw) {
      // Set-up written straight into both databases (a state the functions cannot reach), compared afterwards.
      await h.login(null);
      await h.db.query(s.raw.pg, args.pg.map((x) => (isJson(x) ? JSON.stringify(x[JSON_ARG]) : x)));
      h.lite.prepare(s.raw.d1).run(...(args.d1 as (string | number | null)[]));
      continue;
    }
    await h.login(s.as);
    if (s.admin) await h.db.exec("reset role;");
    try {
      const params = (s.self === false ? args.pg : [h.home[s.as], ...args.pg]).map((x) => (isJson(x) ? JSON.stringify(x[JSON_ARG]) : x && typeof x === "object" && !Array.isArray(x) && !(x instanceof Date) ? JSON.stringify(x) : x));
      const rows = (await h.db.query<Data>(s.pgSql ?? `select * from ${s.fn}(${params.map((_, k) => `$${k + 1}`).join(",")})`, params)).rows;
      const row = rows[0];
      a = row && Object.keys(row).length === 1 && s.fn in row ? row[s.fn] : (row ?? null);
      if (a === "") a = null;
      if (s.save) saved.pg[s.save] = a;
    } catch (e) {
      a = { error: (e as Error).message };
    }
    try {
      b = (await d1[s.fn](h.tenant(s.as), ...args.d1)) ?? null;
      if (s.save) saved.d1[s.save] = b;
    } catch (e) {
      b = { error: (e as Error).message };
    }
    const na = norm("pg", a),
      nb = norm("d1", b);
    if (process.env.SHOW_PARITY) console.log(i + 1, s.as, s.fn, s.note ?? "", JSON.stringify(na).slice(0, 220));
    assert.deepEqual(nb, na, `step ${i + 1} (${s.as} ${s.fn}${s.note ? " — " + s.note : ""})`);
  }
  await h.login(null);
  return steps.length;
}

/** The rows of a table on both sides, normalised and sorted, for the side-effect comparison at the end. */
export async function sameRows(h: Harness, norm: ReturnType<typeof labeller>, table: string, columns: string[], where: { pg: string; d1: string } = { pg: "true", d1: "1" }) {
  await h.login(null);
  const pick = (side: Side, rows: Data[]) => rows.map((r) => JSON.stringify(norm(side, Object.fromEntries(columns.map((c) => [c, r[c]])), false))).sort();
  const lite = (h.lite.prepare(`select ${columns.map((c) => `"${c}"`).join(",")} from "${table}" where ${where.d1}`).all() as Data[]).map((r) => {
    const out: Data = { ...r };
    for (const c of columns) if (typeof out[c] === "string" && /^[[{]/.test(out[c] as string)) out[c] = JSON.parse(out[c] as string);
    return out;
  });
  const pg = (await h.db.query<Data>(`select ${columns.map((c) => `"${c}"`).join(",")} from "${table}" where ${where.pg}`)).rows;
  assert.deepEqual(pick("d1", lite), pick("pg", pg), `table ${table}`);
  assert.ok(pg.length > 0, `table ${table} has rows to compare`);
  return pg.length;
}
