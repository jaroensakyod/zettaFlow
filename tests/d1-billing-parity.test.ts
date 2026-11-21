// The D1 port of billing (src/lib/d1/billing*.ts) must behave exactly like Postgres: the same steps run against the
// real schema (PGlite, every migration) and against D1 (node:sqlite + the port), and every outcome — the plan in force,
// limits and meters, Free-plan quotas (finance only: 1 LINE group, 3 users, 3 forms, N items a month), trial
// ceilings, payments and top-ups, coins, shop, feed ads, admin grants, platform customers, the expiry cron, or the
// exact error message — has to match, and so do the rows left behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { sqliteDriver, type Stmt } from "../src/lib/d1/driver";
import { Tenant } from "../src/lib/d1/tenant";
import { tables } from "../src/lib/d1/tables.gen";
import type { Viewer } from "../src/lib/d1/access";
import type { Role } from "../src/lib/types";
import * as B from "../src/lib/d1/billing";

type Data = Record<string, unknown>;
const U = {
  oA: "20000000-0000-4000-8000-000000000001",
  mA: "20000000-0000-4000-8000-000000000002",
  sA: "20000000-0000-4000-8000-000000000003",
  u4: "20000000-0000-4000-8000-000000000004",
  u5: "20000000-0000-4000-8000-000000000005",
  u6: "20000000-0000-4000-8000-000000000006",
  oB: "20000000-0000-4000-8000-000000000007",
  oP: "20000000-0000-4000-8000-000000000008",
  oD: "20000000-0000-4000-8000-000000000009",
};
type Who = "oA" | "mA" | "sA" | "oB" | "oD";
const email = (u: keyof typeof U) => u + "@test.local";
const PC = B.platformCompany();
const POST_A = "30000000-0000-4000-8000-00000000000a",
  POST_B = "30000000-0000-4000-8000-00000000000b";
const H = 3600000,
  at = (hours: number) => new Date(Date.now() + hours * H).toISOString();

type Step =
  | { op: "company"; as: "oA" | "oB" | "oD"; co: string }
  | { op: "platformCompany" }
  | { op: "member"; co: string; user: keyof typeof U; role: Role; disabled?: boolean }
  | { op: "template" | "ingest"; co: string }
  | { op: "line"; co: string; group: string }
  | { op: "seedDocs"; co: string; n: number | "free-1"; hours: number }
  | { op: "seedAi"; co: string; feature: string; file: boolean; hours: number }
  | { op: "sub"; co: string; patch: Data }
  | { op: "sql"; sql: string; params: string[] }
  | { op: "plan"; co: string }
  | { op: "pay"; as: Who; label?: string; plan: string; cycle: string; addons?: string[]; extra?: number; ref: string | null }
  | { op: "confirmPay"; label: string; status: string }
  | { op: "topup"; as: Who; label?: string; coins: number; ref: string | null }
  | { op: "confirmTopup"; label: string; status: string }
  | { op: "module"; as: Who; id: string }
  | { op: "shopBuy"; as: Who; id: string }
  | { op: "shopActivate"; as: Who; kind: string; id: string }
  | { op: "ad"; as: Who; label?: string; pkg: string; ad: Data }
  | { op: "adStatus"; as: Who; label: string; status: string }
  | { op: "track"; as: Who; label: string; kind: string }
  | { op: "live" | "myAds"; as: Who }
  | { op: "grant"; label?: string; co: string; plan: string; kind: string; days: number; extra: number | null; reason: string }
  | { op: "revoke"; label: string }
  | { op: "platform"; co: string }
  | { op: "cron" };

const ad = (title: unknown, extra: Data = {}) => ({ title, ...extra });
const steps: Step[] = [
  { op: "company", as: "oA", co: "A" },
  { op: "company", as: "oB", co: "B" },
  { op: "plan", co: "A" },
  // Free plan: 3 users (disabled ones do not count), 3 forms, 1 LINE group, a monthly item allowance.
  { op: "member", co: "A", user: "mA", role: "manager" },
  { op: "member", co: "A", user: "sA", role: "staff" },
  { op: "member", co: "A", user: "u4", role: "staff" },
  { op: "member", co: "A", user: "u4", role: "staff", disabled: true },
  { op: "template", co: "A" },
  { op: "template", co: "A" },
  { op: "template", co: "A" },
  { op: "template", co: "A" },
  { op: "line", co: "A", group: "gA1" },
  { op: "line", co: "A", group: "gA2" },
  { op: "seedDocs", co: "A", n: 4, hours: -24 * 40 },
  { op: "seedDocs", co: "A", n: "free-1", hours: -1 },
  { op: "ingest", co: "A" },
  { op: "ingest", co: "A" },
  { op: "seedAi", co: "A", feature: "chat", file: false, hours: -2 },
  { op: "seedAi", co: "A", feature: "chat", file: false, hours: -2 },
  { op: "seedAi", co: "A", feature: "ocr", file: true, hours: -2 },
  { op: "seedAi", co: "A", feature: "ocr", file: true, hours: -24 * 40 },
  { op: "plan", co: "A" },
  // A running trial: trial ceilings and their labels, the 14-day window.
  { op: "sub", co: "B", patch: { status: "trial", plan: "growth", trial_ends_at: at(24 * 10) } },
  { op: "plan", co: "B" },
  { op: "line", co: "B", group: "gB1" },
  { op: "line", co: "B", group: "gB2" },
  { op: "line", co: "B", group: "gB3" },
  { op: "line", co: "B", group: "gA1" },
  { op: "seedDocs", co: "B", n: 3, hours: -24 * 6 },
  { op: "seedDocs", co: "B", n: 499, hours: -1 },
  { op: "ingest", co: "B" },
  { op: "ingest", co: "B" },
  { op: "seedAi", co: "B", feature: "chat", file: true, hours: -1 },
  { op: "plan", co: "B" },
  // EliteFlow's own workspace: every company becomes a customer there.
  { op: "platformCompany" },
  { op: "platform", co: "B" },
  { op: "platform", co: "A" },
  { op: "platform", co: "A" },
  { op: "platform", co: "P" },
  { op: "platform", co: "nobody" },
  { op: "company", as: "oD", co: "D" },
  // Plan payments.
  { op: "pay", as: "sA", plan: "starter", cycle: "monthly", ref: "X" },
  { op: "pay", as: "oA", plan: "nope", cycle: "monthly", ref: "X" },
  { op: "pay", as: "oA", plan: "starter", cycle: "weekly", ref: "X" },
  { op: "pay", as: "oA", plan: "starter", cycle: "monthly", addons: ["extra_user"], ref: "X" },
  { op: "pay", as: "oA", plan: "starter", cycle: "monthly", extra: 2000, ref: "X" },
  { op: "pay", as: "oA", label: "P1", plan: "starter", cycle: "monthly", addons: ["ocr_plus"], extra: 2, ref: "SLIP1" },
  { op: "pay", as: "oA", plan: "starter", cycle: "monthly", ref: "SLIP1" },
  { op: "pay", as: "oA", label: "P2", plan: "growth", cycle: "yearly", addons: ["ocr_plus", "erp"], ref: null },
  { op: "confirmPay", label: "P1", status: "bogus" },
  { op: "confirmPay", label: "P1", status: "verified" },
  { op: "confirmPay", label: "P1", status: "verified" },
  { op: "confirmPay", label: "P2", status: "rejected" },
  { op: "plan", co: "A" },
  // A paid plan: its own ceilings (+ extra users), documents never blocked.
  { op: "member", co: "A", user: "u5", role: "staff" },
  { op: "member", co: "A", user: "u6", role: "staff" },
  { op: "template", co: "A" },
  { op: "template", co: "A" },
  { op: "template", co: "A" },
  { op: "ingest", co: "A" },
  // Coins: modules, top-ups.
  { op: "module", as: "sA", id: "marketing" },
  { op: "module", as: "oA", id: "nope" },
  { op: "module", as: "oA", id: "marketing" },
  { op: "topup", as: "sA", coins: 500, ref: "T1" },
  { op: "topup", as: "oA", coins: 77, ref: "T1" },
  { op: "topup", as: "oA", coins: 500, ref: null },
  { op: "topup", as: "oA", coins: 500, ref: "SLIP1" },
  { op: "topup", as: "oA", label: "T1", coins: 500, ref: "T1" },
  { op: "topup", as: "oA", coins: 500, ref: "T1" },
  { op: "confirmTopup", label: "T1", status: "verified" },
  { op: "confirmTopup", label: "T1", status: "verified" },
  { op: "topup", as: "oA", label: "T2", coins: 500, ref: "T2" },
  { op: "confirmTopup", label: "T2", status: "rejected" },
  ...["T3", "T4", "T5", "T6"].flatMap((r): Step[] => [
    { op: "topup", as: "oA", label: r, coins: 500, ref: r },
    { op: "confirmTopup", label: r, status: "verified" },
  ]),
  { op: "topup", as: "oB", label: "TB", coins: 200, ref: "TB" },
  { op: "confirmTopup", label: "TB", status: "verified" },
  { op: "module", as: "oA", id: "marketing" },
  { op: "module", as: "oA", id: "marketing" },
  // App shop.
  { op: "shopBuy", as: "sA", id: "flow_dog" },
  { op: "shopBuy", as: "mA", id: "nong_flow" },
  { op: "shopBuy", as: "mA", id: "nope" },
  { op: "shopBuy", as: "mA", id: "flow_dog" },
  { op: "shopBuy", as: "mA", id: "flow_dog" },
  { op: "shopBuy", as: "mA", id: "restaurant_cafe" },
  { op: "shopBuy", as: "mA", id: "restaurant_cafe" },
  { op: "shopBuy", as: "mA", id: "real_estate" },
  { op: "shopActivate", as: "sA", kind: "theme", id: "modern_purple" },
  { op: "shopActivate", as: "mA", kind: "system", id: "restaurant_cafe" },
  { op: "shopActivate", as: "mA", kind: "character", id: "siri_style" },
  { op: "shopActivate", as: "mA", kind: "theme", id: "flow_dog" },
  { op: "shopActivate", as: "mA", kind: "theme", id: "modern_purple" },
  { op: "shopActivate", as: "mA", kind: "character", id: "flow_dog" },
  // Feed ads.
  { op: "sql", sql: "update companies set profile=$1 where id=$2", params: ['{"name":"B","industry":"ร้านอาหาร","logo":"b.png"}', "@B"] },
  { op: "sql", sql: "insert into company_posts(id,company_id,author_id,author_name,body) values ($1,$2,$3,'A','โพสต์ A')", params: [POST_A, "@A", U.oA] },
  { op: "sql", sql: "insert into company_posts(id,company_id,author_id,author_name,body) values ($1,$2,$3,'B','โพสต์ B')", params: [POST_B, "@B", U.oB] },
  { op: "ad", as: "sA", pkg: "d7", ad: ad("x") },
  { op: "ad", as: "oA", pkg: "nope", ad: ad("x") },
  { op: "ad", as: "oA", pkg: "d7", ad: ad("x", { post_id: POST_B }) },
  { op: "ad", as: "oA", pkg: "d7", ad: ad("x", { post_id: "xyz" }) },
  { op: "ad", as: "oA", pkg: "d7", ad: ad("ย".repeat(130)) },
  { op: "ad", as: "oA", pkg: "d7", ad: { body: "ไม่มีหัวข้อ" } },
  { op: "ad", as: "oA", label: "AD1", pkg: "d7", ad: ad("  โปรร้านอาหาร  ", { post_id: POST_A, target_industry: "ร้านอาหาร", cta_url: "https://example.com", tone: "", cta_label: " ดู " }) },
  { op: "ad", as: "oA", label: "AD2", pkg: "d3", ad: ad("โฆษณาสอง", { body: " เนื้อหา ", tone: "green" }) },
  { op: "ad", as: "oB", label: "ADB", pkg: "d30", ad: ad("ร้านบี") },
  { op: "ad", as: "oB", pkg: "d3", ad: ad("ไม่พอ") },
  { op: "adStatus", as: "sA", label: "AD1", status: "paused" },
  { op: "adStatus", as: "mA", label: "AD1", status: "bogus" },
  { op: "adStatus", as: "mA", label: "AD1", status: "paused" },
  { op: "adStatus", as: "oB", label: "AD1", status: "active" },
  { op: "adStatus", as: "mA", label: "AD1", status: "active" },
  { op: "sql", sql: "update feed_ads set ends_at=$1 where id=$2", params: [at(-1), "@AD2"] },
  { op: "adStatus", as: "mA", label: "AD2", status: "active" },
  { op: "adStatus", as: "mA", label: "AD2", status: "paused" },
  { op: "track", as: "oB", label: "AD1", kind: "view" },
  { op: "track", as: "oB", label: "AD1", kind: "view" },
  { op: "track", as: "oB", label: "AD1", kind: "click" },
  { op: "track", as: "oD", label: "AD1", kind: "view" },
  { op: "track", as: "oA", label: "AD1", kind: "view" },
  { op: "track", as: "oB", label: "AD1", kind: "bogus" },
  { op: "track", as: "oB", label: "AD2", kind: "view" },
  { op: "live", as: "oB" },
  { op: "live", as: "oA" },
  { op: "live", as: "oD" },
  { op: "myAds", as: "mA" },
  { op: "myAds", as: "oB" },
  // Admin grants and revocations.
  { op: "grant", co: "nobody", plan: "growth", kind: "gift", days: 30, extra: 0, reason: "ทดสอบ" },
  { op: "grant", co: "A", plan: "free", kind: "gift", days: 30, extra: 0, reason: "ทดสอบ" },
  { op: "grant", co: "A", plan: "nope", kind: "gift", days: 30, extra: 0, reason: "ทดสอบ" },
  { op: "grant", co: "A", plan: "growth", kind: "bogus", days: 30, extra: 0, reason: "ทดสอบ" },
  { op: "grant", label: "G1", co: "A", plan: "growth", kind: "gift", days: 30, extra: 3, reason: "ของขวัญ" },
  { op: "plan", co: "A" },
  { op: "grant", label: "G2", co: "A", plan: "growth", kind: "partner", days: 10, extra: null, reason: "ต่อเวลา" },
  { op: "revoke", label: "G1" },
  { op: "revoke", label: "G2" },
  { op: "revoke", label: "G2" },
  { op: "revoke", label: "G1" },
  { op: "plan", co: "A" },
  { op: "grant", label: "G3", co: "D", plan: "enterprise", kind: "offline", days: 5, extra: 1, reason: "จ่ายนอกระบบ" },
  { op: "plan", co: "D" },
  // Lapsing: 3 days of grace, then Free (and Free quotas again), and the cron marks it past_due.
  { op: "sub", co: "A", patch: { current_period_end: at(-48) } },
  { op: "plan", co: "A" },
  { op: "sub", co: "A", patch: { current_period_end: at(-24 * 5) } },
  { op: "plan", co: "A" },
  { op: "template", co: "A" },
  { op: "member", co: "A", user: "u4", role: "viewer" },
  { op: "cron" },
  { op: "cron" },
  { op: "plan", co: "A" },
  { op: "sub", co: "B", patch: { status: "trial", trial_ends_at: at(-1) } },
  { op: "plan", co: "B" },
  { op: "line", co: "B", group: "gB4" },
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
    insert into auth.users(id,email,email_confirmed_at)values${Object.entries(U)
      .map(([k, id]) => `('${id}','${k}@test.local',now())`)
      .join(",")};`);
  for (const f of (await readdir("supabase/migrations")).sort()) await db.exec((await readFile("supabase/migrations/" + f, "utf8")).replace("create extension if not exists pgcrypto;", ""));
  /** null: service_role; "super": the table owner (setup and raw reads); otherwise a signed-in user. */
  const login = async (id: string | null | "super", mail = "") => {
    await db.exec("reset role;");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id === "super" || !id ? "" : id, mail]);
    if (id === "super") return;
    if (!id) return db.exec("set role service_role;");
    await db.exec("set role authenticated;");
  };
  return { db, login };
}

/** A Postgres/JS value → the D1 column value (for copying catalogue rows). */
function toLite(table: string, c: string, v: unknown) {
  const m = tables[table];
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (m.json.includes(c)) return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v as string | number;
}

test("billing on D1 matches Postgres step for step (Free-plan quotas, trials, payments, coins, ads, grants)", async () => {
  const pg = await postgres();
  const lite = new DatabaseSync(":memory:");
  lite.exec(readFileSync("cloudflare/d1/0001_schema.sql", "utf8"));
  await pg.login("super");
  for (const table of ["plans", "addons", "trial_limits", "free_limits", "coin_packs", "ad_packages", "modules", "shop_items", "entity_schemas"]) {
    for (const r of (await pg.db.query<Data>(`select * from ${table}`)).rows) {
      const cols = Object.keys(r);
      lite.prepare(`insert into ${table}(${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => toLite(table, c, r[c])));
    }
  }
  const freeDocs = Number((await pg.db.query<{ documents: number }>("select documents from plans where id='free'")).rows[0].documents);
  const sql = sqliteDriver(lite);

  type Side = "pg" | "d1";
  const co: Record<string, string> = { P: PC, nobody: "40000000-0000-4000-8000-000000000000" };
  const ids = { pg: {} as Record<string, string>, d1: {} as Record<string, string> };
  for (const [k, v] of Object.entries(U)) (ids.pg[k] = v), (ids.d1[k] = v);
  const all = (side: Side) => ({ ...ids[side], ...Object.fromEntries(Object.entries(co).map(([k, v]) => ["co:" + k, v])), postA: POST_A, postB: POST_B });
  const arg = (side: Side, v: string) => (v.startsWith("@") ? (co[v.slice(1)] ?? ids[side][v.slice(1)]) : v);
  const NUM = new Set(["amount", "monthly", "yearly", "price"]);
  const isTime = (v: unknown) => v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:\d{2})?))?$/.test(v));
  const label = (side: Side, v: unknown, key = ""): unknown => {
    if (isTime(v)) return `${Math.round(((v instanceof Date ? v.getTime() : Date.parse(v as string)) - Date.now()) / H)}h`;
    if (typeof v === "string") {
      if (NUM.has(key)) return Number(v);
      const hit = Object.entries(all(side)).find(([, id]) => id === v)?.[0];
      if (hit) return hit;
      if (key === "notes") return v.replace(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/, "<when>");
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? "<uuid>" : v;
    }
    if (typeof v === "number" && NUM.has(key)) return v;
    if (Array.isArray(v)) return v.map((x) => label(side, x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, label(side, x, k)]));
    return v;
  };
  const viewer = (w: Who): Viewer => {
    const c = co[w.slice(1)];
    const role: Role = w.startsWith("o") ? "owner" : w === "mA" ? "manager" : "staff";
    return { userId: U[w], email: email(w), companyId: c, role, departments: role === "staff" ? ["Finance"] : [] };
  };

  // D1 side of create_company (+ its triggers: start_trial, quota_users, memberships_platform_customer).
  async function createCompanyD1(id: string, name: string, user: keyof typeof U) {
    const t = B.serviceTenant(sql, id);
    const quota = await B.enforceQuota(t, "users", { company_id: id });
    await t.atomic([
      t.insertGlobalStmt("companies", { id, name, profile: { name } }),
      B.startTrial(t, id),
      ...quota,
      t.insertStmt("memberships", { user_id: U[user], name: email(user), email: email(user).toLowerCase(), role: "owner" }),
      t.insertStmt("audit_events", { actor: U[user], action: "company_created", target: id }),
    ]);
    await B.platformCustomerOnSignup(sql, id);
  }
  /** Postgres-side row inserts the triggers guard, as the table owner (what the app's own functions do). */
  const pgInsert = async (s: Step & { co: string }) => {
    const c = co[s.co];
    if (s.op === "member") await pg.db.query("insert into memberships(company_id,user_id,email,name,role,disabled) values ($1,$2,$3,$3,$4,$5) on conflict (company_id,user_id) do update set disabled=excluded.disabled", [c, U[s.user], email(s.user), s.role, !!s.disabled]);
    if (s.op === "template") await pg.db.query("insert into data_templates(company_id,name,department,fields) values ($1,'ฟอร์ม','Finance','[]')", [c]);
    if (s.op === "line") await pg.db.query("insert into line_groups(group_id,company_id) values ($1,$2) on conflict (group_id) do nothing", [s.group, c]);
    if (s.op === "ingest") await pg.db.query("insert into ingestions(company_id,template,department) values ($1,'{}','Finance')", [c]);
  };
  async function d1Insert(s: Step & { co: string }) {
    const c = co[s.co],
      t = B.serviceTenant(sql, c);
    let stmts: Stmt[] = [];
    if (s.op === "member") {
      const [old] = await t.selectInternal<{ id: string }>("memberships", { where: { user_id: U[s.user] } });
      // insert … on conflict do update: the BEFORE INSERT trigger runs before the conflict is found, so always check
      const quota = await B.enforceQuota(t, "users", { disabled: !!s.disabled });
      if (old) stmts = [...quota, t.updateStmt("memberships", { user_id: U[s.user] }, { disabled: !!s.disabled })];
      else stmts = [...quota, t.insertStmt("memberships", { user_id: U[s.user], email: email(s.user), name: email(s.user), role: s.role, disabled: !!s.disabled })];
    }
    if (s.op === "template") stmts = [...(await B.enforceQuota(t, "workflows")), t.insertStmt("data_templates", { name: "ฟอร์ม", department: "Finance", fields: [] })];
    if (s.op === "line") {
      const quota = await B.enforceQuota(t, "line_groups", { group_id: s.group });
      stmts = [...quota, t.upsertGlobalStmt("line_groups", { group_id: s.group, company_id: c }, ["group_id"], [])];
    }
    if (s.op === "ingest") stmts = [...(await B.enforceQuota(t, "documents")), t.insertStmt("ingestions", { template: {}, department: "Finance" })];
    await t.atomic(stmts);
  }
  const planPg = async (c: string) => {
    const q = async (text: string) => (await pg.db.query<Data>(text, [c])).rows[0].x;
    const r = (res: string) => q(`select plan_limit($1,'${res}') as x`);
    return {
      effective: await q("select effective_plan($1) as x"),
      trial: await q("select trial_valid($1) as x"),
      onTrial: await q("select on_trial($1) as x"),
      active: await q("select subscription_active($1) as x"),
      limits: { workflows: await r("workflows"), documents: await r("documents"), line_groups: await r("line_groups"), users: await r("users"), other: await r("other") },
      addons: { ocr_plus: await q("select has_addon($1,'ocr_plus') as x"), exec_dashboard: await q("select has_addon($1,'exec_dashboard') as x"), erp: await q("select has_addon($1,'erp') as x") },
      trialUsers: (await pg.db.query<Data>("select trial_limit('users') as x")).rows[0].x,
      usage: await q("select trial_usage($1) as x"),
    };
  };
  const planD1 = async (c: string) => {
    const t = B.serviceTenant(sql, c);
    const r = (res: string) => B.planLimit(t, res, c);
    return {
      effective: await B.effectivePlan(t, c),
      trial: await B.trialValid(t, c),
      onTrial: await B.onTrial(t, c),
      active: await B.subscriptionActive(t, c),
      limits: { workflows: await r("workflows"), documents: await r("documents"), line_groups: await r("line_groups"), users: await r("users"), other: await r("other") },
      addons: { ocr_plus: await B.hasAddon(t, "ocr_plus", c), exec_dashboard: await B.hasAddon(t, "exec_dashboard", c), erp: await B.hasAddon(t, "erp", c) },
      trialUsers: await B.trialLimit(t, "users"),
      usage: await B.trialUsage(t, c),
    };
  };
  const pgArr = (a: string[]) => "{" + a.map((x) => `"${x}"`).join(",") + "}";

  async function onPg(s: Step): Promise<unknown> {
    const q = async (text: string, p: unknown[] = []) => (await pg.db.query<Data>(text, p)).rows;
    const as = async (w: Who) => pg.login(U[w], email(w));
    try {
      if (s.op === "company") {
        await pg.login(U[s.as], email(s.as));
        co[s.co] = (await q("select create_company($1) as id", ["บริษัท " + s.co]))[0].id as string;
        return { ok: true };
      }
      if (s.op === "platformCompany") {
        await pg.login("super");
        await q("insert into companies(id,name,profile) values ($1,'EliteFlow','{}')", [PC]);
        await q("insert into memberships(company_id,user_id,email,name,role) values ($1,$2,$3,'แพลตฟอร์ม','owner')", [PC, U.oP, email("oP")]);
        return { ok: true };
      }
      if (["member", "template", "line", "ingest"].includes(s.op)) {
        await pg.login("super");
        await pgInsert(s as Step & { co: string });
        return { ok: true };
      }
      if (s.op === "seedDocs") {
        await pg.login("super");
        const n = s.n === "free-1" ? freeDocs - 1 : s.n;
        await q("insert into ingestions(company_id,template,department,created_at) select $1,'{}','Finance',$2::timestamptz from generate_series(1,$3::int)", [co[s.co], at(s.hours), n]);
        return { ok: true };
      }
      if (s.op === "seedAi") {
        await pg.login("super");
        await q("insert into ai_usage(company_id,feature,has_file,created_at) values ($1,$2,$3,$4)", [co[s.co], s.feature, s.file, at(s.hours)]);
        return { ok: true };
      }
      if (s.op === "sub") {
        await pg.login("super");
        const keys = Object.keys(s.patch);
        await q(`update subscriptions set ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")} where company_id=$1`, [co[s.co], ...keys.map((k) => s.patch[k])]);
        return { ok: true };
      }
      if (s.op === "sql") {
        await pg.login("super");
        await q(s.sql, s.params.map((p) => arg("pg", p)));
        return { ok: true };
      }
      if (s.op === "plan") {
        await pg.login("super");
        return await planPg(co[s.co]);
      }
      if (s.op === "pay") {
        await as(s.as);
        const [r] = await q("select * from request_payment($1,$2,$3,null,$4,$5,$6::text[],$7)", [viewer(s.as).companyId, s.plan, s.cycle, JSON.stringify({ bank: "kbank" }), s.ref, pgArr(s.addons ?? []), s.extra ?? 0]);
        if (s.label) ids.pg[s.label] = r.id as string;
        return r;
      }
      if (s.op === "confirmPay" || s.op === "confirmTopup") {
        await pg.login(null);
        await q(`select ${s.op === "confirmPay" ? "confirm_payment" : "confirm_topup"}($1,$2,'ok')`, [ids.pg[s.label], s.status]);
        return { ok: true };
      }
      if (s.op === "topup") {
        await as(s.as);
        const [r] = await q("select * from request_topup($1,$2,null,$3,$4)", [viewer(s.as).companyId, s.coins, JSON.stringify({ bank: "scb" }), s.ref]);
        if (s.label) ids.pg[s.label] = r.id as string;
        return r;
      }
      if (s.op === "module") return await as(s.as), (await q("select * from buy_module($1,$2)", [viewer(s.as).companyId, s.id]))[0];
      if (s.op === "shopBuy") return await as(s.as), (await q("select * from shop_buy($1,$2)", [viewer(s.as).companyId, s.id]))[0];
      if (s.op === "shopActivate") return await as(s.as), (await q("select * from shop_activate($1,$2,$3)", [viewer(s.as).companyId, s.kind, s.id]))[0];
      if (s.op === "ad") {
        await as(s.as);
        const [r] = await q("select * from buy_feed_ad($1,$2,$3)", [viewer(s.as).companyId, s.pkg, JSON.stringify(s.ad)]);
        if (s.label) ids.pg[s.label] = r.id as string;
        return r;
      }
      if (s.op === "adStatus") return await as(s.as), await q("select set_feed_ad_status($1,$2,$3)", [viewer(s.as).companyId, ids.pg[s.label], s.status]), { ok: true };
      if (s.op === "track") return await as(s.as), await q("select feed_ad_track($1,$2,$3)", [viewer(s.as).companyId, ids.pg[s.label], s.kind]), { ok: true };
      if (s.op === "live") return await as(s.as), (await q("select feed_ads_live($1) as x", [viewer(s.as).companyId]))[0].x;
      if (s.op === "myAds") return await as(s.as), (await q("select my_feed_ads($1) as x", [viewer(s.as).companyId]))[0].x;
      if (s.op === "grant") {
        await pg.login(null);
        const [r] = await q("select * from admin_grant_plan($1,$2,$3,$4,$5,$6,'admin@eliteflow')", [co[s.co], s.plan, s.kind, s.days, s.extra, s.reason]);
        if (s.label) ids.pg[s.label] = r.id as string;
        return r;
      }
      if (s.op === "revoke") return await pg.login(null), (await q("select * from admin_revoke_grant($1,'admin@eliteflow')", [ids.pg[s.label]]))[0];
      if (s.op === "platform") {
        await pg.login(null);
        const cid = (await q("select add_platform_customer($1) as x", [co[s.co]]))[0].x as string | null;
        if (cid) ids.pg["cust:" + s.co] = cid;
        return { cid };
      }
      await pg.login(null);
      return { expired: (await q("select expire_subscriptions() as x"))[0].x };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async function onD1(s: Step): Promise<unknown> {
    const t = (w: Who) => new Tenant(sql, viewer(w));
    try {
      if (s.op === "company") return await createCompanyD1(co[s.co], "บริษัท " + s.co, s.as), { ok: true };
      if (s.op === "platformCompany") {
        const t0 = B.serviceTenant(sql, PC);
        await t0.atomic([t0.insertGlobalStmt("companies", { id: PC, name: "EliteFlow", profile: {} }), B.startTrial(t0, PC)]);
        const quota = await B.enforceQuota(t0, "users");
        await t0.atomic([...quota, t0.insertStmt("memberships", { user_id: U.oP, email: email("oP"), name: "แพลตฟอร์ม", role: "owner" })]);
        await B.platformCustomerOnSignup(sql, PC);
        return { ok: true };
      }
      if (["member", "template", "line", "ingest"].includes(s.op)) return await d1Insert(s as Step & { co: string }), { ok: true };
      if (s.op === "seedDocs") {
        const n = s.n === "free-1" ? freeDocs - 1 : s.n;
        const stmt = lite.prepare("insert into ingestions(company_id,template,department,created_at) values (?,'{}','Finance',?)");
        for (let i = 0; i < n; i++) stmt.run(co[s.co], at(s.hours));
        return { ok: true };
      }
      if (s.op === "seedAi") return lite.prepare("insert into ai_usage(company_id,feature,has_file,created_at) values (?,?,?,?)").run(co[s.co], s.feature, s.file ? 1 : 0, at(s.hours)), { ok: true };
      if (s.op === "sub") {
        const keys = Object.keys(s.patch);
        lite.prepare(`update subscriptions set ${keys.map((k) => `${k}=?`).join(",")} where company_id=?`).run(...keys.map((k) => s.patch[k] as string), co[s.co]);
        return { ok: true };
      }
      if (s.op === "sql") return lite.prepare(s.sql.replace(/\$\d+/g, "?")).run(...s.params.map((p) => arg("d1", p))), { ok: true };
      if (s.op === "plan") return await planD1(co[s.co]);
      if (s.op === "pay") {
        const r = await B.requestPayment(t(s.as), s.plan, s.cycle, null, { bank: "kbank" }, s.ref, s.addons ?? [], s.extra ?? 0);
        if (s.label) ids.d1[s.label] = r.id;
        return r;
      }
      if (s.op === "confirmPay") return await B.confirmPayment(sql, ids.d1[s.label], s.status, "ok"), { ok: true };
      if (s.op === "confirmTopup") return await B.confirmTopup(sql, ids.d1[s.label], s.status, "ok"), { ok: true };
      if (s.op === "topup") {
        const r = await B.requestTopup(t(s.as), s.coins, null, { bank: "scb" }, s.ref);
        if (s.label) ids.d1[s.label] = r.id;
        return r;
      }
      if (s.op === "module") return await B.buyModule(t(s.as), s.id);
      if (s.op === "shopBuy") return await B.shopBuy(t(s.as), s.id);
      if (s.op === "shopActivate") return await B.shopActivate(t(s.as), s.kind, s.id);
      if (s.op === "ad") {
        const r = await B.buyFeedAd(t(s.as), s.pkg, s.ad);
        if (s.label) ids.d1[s.label] = r.id;
        return r;
      }
      if (s.op === "adStatus") return await B.setFeedAdStatus(t(s.as), ids.d1[s.label], s.status), { ok: true };
      if (s.op === "track") return await B.feedAdTrack(t(s.as), ids.d1[s.label], s.kind), { ok: true };
      if (s.op === "live") return await B.feedAdsLive(t(s.as));
      if (s.op === "myAds") return await B.myFeedAds(t(s.as));
      if (s.op === "grant") {
        const r = await B.adminGrantPlan(sql, co[s.co], s.plan, s.kind, s.days, s.extra, s.reason, "admin@eliteflow");
        if (s.label) ids.d1[s.label] = r.id;
        return r;
      }
      if (s.op === "revoke") return await B.adminRevokeGrant(sql, ids.d1[s.label], "admin@eliteflow");
      if (s.op === "platform") {
        const cid = await B.addPlatformCustomer(sql, co[s.co]);
        if (cid) ids.d1["cust:" + s.co] = cid;
        return { cid };
      }
      return { expired: await B.expireSubscriptions(sql) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  for (const [i, s] of steps.entries()) {
    const a = await onPg(s);
    // The company ids come from Postgres (create_company); D1 uses the same ones.
    const b = await onD1(s);
    const norm = (side: Side, o: unknown) => {
      const x = JSON.parse(JSON.stringify(label(side, o) ?? null));
      // feed_ads_live is in random order apart from the industry match: compare it as a set.
      return s.op === "live" && Array.isArray(x) ? x.sort((p: Data, q: Data) => String(p.id).localeCompare(String(q.id))) : x;
    };
    assert.deepEqual(norm("d1", b), norm("pg", a), `step ${i + 1} (${JSON.stringify(s).slice(0, 160)})`);
    if (process.env.SHOW_PARITY) console.log(i + 1, s.op, JSON.stringify(norm("pg", a)).slice(0, 220));
  }

  // D1's own ordering promise of feed_ads_live: ads aimed at the viewer's industry come first.
  const live = await B.feedAdsLive(new Tenant(sql, { ...viewer("oD"), companyId: co.B }));
  assert.ok(live.length >= 1 && live[0].id === ids.d1.AD1);

  // Rows left behind, table by table.
  await pg.login("super");
  const companies = Object.values(co);
  const rowsOf = async (table: string, order = "") => {
    const p = (await pg.db.query<Data>(`select * from ${table} ${order}`)).rows;
    const d = (lite.prepare(`select * from ${table} ${order}`).all() as Data[]).map((r) => {
      const m = tables[table.split(" ")[0]],
        out: Data = { ...r };
      for (const c of m.json) if (typeof out[c] === "string") out[c] = JSON.parse(out[c] as string);
      for (const c of m.bool) if (out[c] !== null && out[c] !== undefined) out[c] = !!out[c];
      return out;
    });
    const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Data)[k])])) : v);
    const n = (side: Side, rows: Data[]) => rows.map((r) => JSON.stringify(sorted(label(side, r)))).sort();
    return { pg: n("pg", p), d1: n("d1", d) };
  };
  for (const table of ["subscriptions", "coin_wallets", "coin_ledger", "company_modules", "company_shop_items", "company_shop_settings", "billing_payments", "coin_topups", "feed_ads", "feed_ad_events", "plan_grants", "platform_customers"]) {
    const r = await rowsOf(table);
    assert.deepEqual(r.d1, r.pg, table);
  }
  const strip = (rows: string[]) => rows.map((r) => JSON.parse(r)).map(({ id: _i, created_at: _c, updated_at: _u, ...rest }) => rest);
  const ents = await rowsOf("entities", "where kind='customers'");
  assert.deepEqual(strip(ents.d1), strip(ents.pg), "platform customer records");
  const audit = await rowsOf("audit_events");
  const act = (rows: string[]) => rows.map((r) => JSON.parse(r)).map((r) => [r.company_id, r.actor, r.action, r.target]).sort();
  assert.deepEqual(act(audit.d1), act(audit.pg), "audit_events");
  for (const [table, where] of [
    ["memberships", "true"],
    ["data_templates", "true"],
    ["line_groups", "true"],
    ["ingestions", "true"],
  ]) {
    const count = async (c: string) => [Number((await pg.db.query<{ n: number }>(`select count(*) n from ${table} where company_id=$1 and ${where}`, [c])).rows[0].n), Number((lite.prepare(`select count(*) n from ${table} where company_id=? and ${where === "true" ? "1" : where}`).get(c) as { n: number }).n)];
    for (const c of companies) {
      const [p, d] = await count(c);
      assert.equal(d, p, `${table} of ${c}`);
    }
  }
  await pg.db.close();
});
