// The RPC table on D1 (src/lib/d1/rpc-map.ts): every function the app calls with sb.rpc(...) has a handler, and a
// representative call of each group — company, records, approvals / ingestion, finance, billing, reports, feed, B2B
// chat and deals, LINE — gives through the map exactly what supabase-js got from Postgres: the same named arguments
// on real Postgres (PGlite, every migration, called with named notation like PostgREST and shaped like PostgREST's
// JSON answer) and on D1 (node:sqlite, the handler with an RpcCaller), compared after ids → labels and timestamps →
// "<ts>", or the same error message (including "permission denied for function …" for service-only functions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AppError, validateEntity } from "../src/lib/domain";
import { Tenant } from "../src/lib/d1/tenant";
import { tables } from "../src/lib/d1/tables.gen";
import { serviceTenant } from "../src/lib/d1/common";
import { memberRole } from "../src/lib/d1/company";
import { rpcs } from "../src/lib/d1/rpc-map";
import type { RpcCaller } from "../src/lib/d1/rpc-types";
import type { Role } from "../src/lib/types";
import { labeller, sameRows, setup, users, type Harness, type Who } from "./d1-network-harness";

type Data = Record<string, unknown>;

// ---------- 1. every rpc name the app uses has a handler ----------

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return p.replace(/\\/g, "/").startsWith("src/lib/d1") ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
/** Every Postgres function defined by the schema (any later migration included). */
const pgFunctions = new Set(
  [readFileSync("supabase/schema.sql", "utf8"), ...readdirSync("supabase/migrations").map((f) => readFileSync("supabase/migrations/" + f, "utf8"))]
    .join("\n")
    .match(/function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)!
    .map((m) => m.replace(/^function\s+(?:public\.)?/i, "").replace(/\s*\($/, "").toLowerCase()),
);
/**
 * The names the app calls: .rpc("x", …) literals, plus — in files that call .rpc() with a computed name (the deal
 * steps table, the design revision switch) — every quoted string that names a Postgres function.
 */
function appRpcNames(): Set<string> {
  const names = new Set<string>();
  for (const f of files("src")) {
    const text = readFileSync(f, "utf8");
    if (!text.includes(".rpc(")) continue;
    for (const m of text.matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/g)) names.add(m[1]);
    if (/\.rpc\(\s*[^"'`\s]/.test(text)) for (const m of text.matchAll(/["'`]([a-z][a-z0-9_]*)["'`]/g)) if (pgFunctions.has(m[1]) && m[1].includes("_")) names.add(m[1]);
  }
  return names;
}

test("every rpc the app calls has a handler on D1", () => {
  const names = appRpcNames();
  assert.ok(names.size >= 129, `found ${names.size} rpc names`);
  const missing = [...names].filter((n) => !rpcs[n]).sort();
  assert.deepEqual(missing, [], "rpc names without a handler");
  for (const n of Object.keys(rpcs)) assert.ok(pgFunctions.has(n), `${n} is a Postgres function`);
});

// ---------- 2. the same calls through the map and on Postgres ----------

type As = Who | "service";
type Refs = (name: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Step = { as: As; fn: string; args?: (r: Refs) => Data; save?: string; note?: string } | { raw: { pg: string; d1: string }; params: (r: Refs) => unknown[] };

const POST = "40000000-0000-4000-8000-000000000001";
const NOPE = "20000000-0000-4000-8000-000000000099";

type Proc = { names: string[]; types: string[]; set: boolean; ret: string; kind: string };
async function proc(h: Harness, name: string): Promise<Proc> {
  const { rows } = await h.db.query<{ names: string[] | null; types: string[]; set: boolean; ret: string; kind: string; n: number }>(
    `select p.proargnames names,array(select format_type(t,null) from unnest(p.proargtypes::oid[]) t) types,p.proretset set,format_type(p.prorettype,null) ret,ty.typtype kind,p.pronargs n
     from pg_proc p join pg_type ty on ty.oid=p.prorettype where p.pronamespace='public'::regnamespace and p.proname=$1 order by p.pronargs desc`,
    [name],
  );
  assert.ok(rows.length, `no Postgres function ${name}`);
  const r = rows[0];
  return { names: (r.names ?? []).slice(0, r.n), types: r.types, set: r.set, ret: r.ret, kind: r.kind };
}
const pgArray = (v: unknown[]) => "{" + v.map((x) => (x === null ? "NULL" : '"' + String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')).join(",") + "}";
/** The call as PostgREST makes it (named notation), with the answer shaped like PostgREST's JSON. */
async function callPg(h: Harness, name: string, args: Data): Promise<unknown> {
  const p = await proc(h, name);
  const params: unknown[] = [];
  const named = Object.entries(args).map(([k, v]) => {
    const i = p.names.indexOf(k);
    assert.ok(i >= 0, `${name} has no argument ${k}`);
    const type = p.types[i];
    params.push(v === null || v === undefined ? null : type === "jsonb" || type === "json" ? JSON.stringify(v) : type.endsWith("[]") ? pgArray(v as unknown[]) : v);
    return `${k} => $${params.length}::${type}`;
  });
  const call = `public.${name}(${named.join(",")})`;
  const q = async (text: string) => (await h.db.query<{ v: unknown }>(text, params)).rows;
  if (p.ret === "void") return await q(`select ${call}`), null;
  if (p.set) return (await q(p.kind === "b" ? `select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) v from ${call} as x(v)` : `select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) v from ${call} x`))[0].v;
  if (p.kind === "c") return (await q(`select to_jsonb(x) v from ${call} x`))[0]?.v ?? null;
  return (await q(`select to_jsonb(${call}) v`))[0].v;
}

/** The RpcCaller the D1 client builds: the signed-in person, or the service role. */
function caller(h: Harness, as: As): RpcCaller {
  const userId = as === "service" ? null : users[as];
  return {
    sql: h.sql,
    userId,
    email: userId ? as + "@test.local" : "",
    name: "",
    service: as === "service",
    async tenantFor(companyId) {
      const role = userId ? await memberRole(h.sql, userId, companyId) : null;
      if (!role) throw new AppError("ไม่มีสิทธิ์", 403);
      const [m] = h.lite.prepare("select departments from memberships where company_id=? and user_id=? and disabled=0").all(companyId, userId) as { departments: string }[];
      return new Tenant(h.sql, { userId: userId!, email: as + "@test.local", companyId, role: role as Role, departments: m ? JSON.parse(m.departments) : [], ...(m ? {} : { support: true }) });
    },
    serviceTenant: (companyId) => serviceTenant(h.sql, companyId),
  };
}

/** The tables the network harness does not copy to D1 (plans, subscriptions, accounts, …), copied as Postgres has them. */
async function copyRest(h: Harness) {
  await h.login(null);
  h.lite.exec("PRAGMA foreign_keys = OFF");
  for (const [table, m] of Object.entries(tables)) {
    if ((h.lite.prepare(`select count(*) n from "${table}"`).get() as { n: number }).n > 0) continue;
    const exists = (await h.db.query("select 1 from information_schema.tables where table_schema='public' and table_name=$1", [table])).rows.length;
    if (!exists) continue;
    for (const { r } of (await h.db.query<{ r: Data }>(`select to_jsonb(t) r from "${table}" t`)).rows) {
      const keys = Object.keys(r).filter((k) => m.columns.includes(k));
      const val = (k: string) => {
        const v = r[k];
        if (v === null || v === undefined) return null;
        if (m.json.includes(k) || (typeof v === "object" && v !== null)) return JSON.stringify(v);
        if (typeof v === "boolean") return v ? 1 : 0;
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(v)) return new Date(v).toISOString();
        return v as string | number;
      };
      h.lite.prepare(`insert into "${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map(() => "?").join(",")})`).run(...keys.map(val));
    }
  }
  h.lite.exec("PRAGMA foreign_keys = ON");
}

test("rpc handlers on D1 give what the Postgres functions gave supabase-js", async () => {
  const h = await setup();
  try {
    await copyRest(h);
    const { A, B, C } = h.company;
    const T = (r: Refs) => r("T");
    const ent = (kind: string, data: Data) => validateEntity(kind, data);
    const steps: Step[] = [
      // Company, members, support.
      { as: "alice", fn: "save_company", args: () => ({ p_company: A, p_profile: { name: "Alice Events", industry: "อีเวนต์", province: "กรุงเทพฯ", logo: "a/logo.png", cover: "a/cover.png", description: "รับจัดงานอีเวนต์" } }) },
      { as: "carol", fn: "save_company", note: "not a member", args: () => ({ p_company: A, p_profile: { name: "x" } }) },
      { as: "alice", fn: "invite_member", args: () => ({ p_company: A, p_email: "dan@test.local", p_role: "staff", p_departments: ["Sales"] }) },
      { as: "amy", fn: "invite_member", args: () => ({ p_company: A, p_email: "eve@test.local", p_role: "staff", p_departments: ["Sales"] }) },
      { as: "carol", fn: "create_company", save: "C2", args: () => ({ p_name: "  Carol Two  " }) },
      { as: "alice", fn: "send_message", args: () => ({ p_company: A, p_department: "Sales", p_body: " สวัสดีทีมขาย " }) },
      { as: "vic", fn: "send_message", args: () => ({ p_company: A, p_department: "Sales", p_body: "x" }) },
      { as: "alice", fn: "support_send", args: () => ({ p_company: A, p_body: "ขอความช่วยเหลือ" }) },
      { as: "alice", fn: "support_reply", note: "service only", args: () => ({ p_company: A, p_name: "ทีมงาน", p_body: "x" }) },
      { as: "service", fn: "support_reply", args: () => ({ p_company: A, p_name: "ทีมงาน ZettaFlow", p_body: "รับทราบครับ" }) },
      { as: "alice", fn: "support_seen", args: () => ({ p_company: A }) },
      { as: "alice", fn: "presence_ping", args: () => ({ p_company: A }) },
      { as: "carol", fn: "presence_ping", args: () => ({ p_company: A, p_companies: [B] }) },
      { as: "alice", fn: "note_save", args: () => ({ p_company: A, p_day: "2026-11-21", p_body: " ประชุม ", p_items: [{ text: " โทรหาลูกค้า " }, { text: "  " }, { text: "ส่งแบบ", done: true }] }) },
      { as: "alice", fn: "note_save", args: () => ({ p_company: A, p_day: "1999-01-01", p_body: "x", p_items: null }) },
      { as: "bob", fn: "company_card", args: () => ({ p_id: A }) },
      { as: "bob", fn: "company_cover", args: () => ({ p_id: A }) },
      { as: "bob", fn: "company_card", args: () => ({ p_id: NOPE }) },

      // Records, stock.
      { as: "alice", fn: "save_entity", save: "CUS", args: () => ({ p_company: A, p_kind: "customers", p_data: ent("customers", { name: "ลูกค้าเอ", type: "นิติบุคคล", status: "active" }) }) },
      { as: "alice", fn: "save_entity", save: "P", args: () => ({ p_company: A, p_kind: "products", p_data: ent("products", { name: "ไม้อัด", sku: "PLY-1", unit: "แผ่น", cost: 10, price: 20, reorderLevel: 1, status: "active" }) }) },
      { as: "alice", fn: "save_entity", args: (r) => ({ p_company: A, p_kind: "customers", p_data: ent("customers", { name: "ลูกค้าเอ (แก้)", type: "นิติบุคคล", status: "active" }), p_id: r("CUS").id, p_version: 9 }) },
      { as: "vic", fn: "save_entity", args: () => ({ p_company: A, p_kind: "customers", p_data: ent("customers", { name: "x", type: "นิติบุคคล", status: "active" }) }) },
      { as: "alice", fn: "post_stock_movement", args: (r) => ({ p_company: A, p_product: r("P").id, p_type: "in", p_quantity: 12, p_reference: "GR-1" }) },
      { as: "alice", fn: "post_stock_movement", args: (r) => ({ p_company: A, p_product: r("P").id, p_type: "out", p_quantity: 50, p_reference: "WD-1", p_notes: "เบิก" }) },
      { as: "alice", fn: "post_stock_movement", args: (r) => ({ p_company: A, p_product: r("P").id, p_type: "sideways", p_quantity: 1, p_reference: "X" }) },
      { as: "amy", fn: "post_stock_movement", args: (r) => ({ p_company: A, p_product: r("P").id, p_type: "in", p_quantity: 1, p_reference: "X" }) },
      { as: "alice", fn: "peek_code", args: () => ({ p_company: A, p_kind: "customers" }) },
      { as: "alice", fn: "peek_code", args: () => ({ p_company: A, p_kind: "products" }) },
      { as: "alice", fn: "archive_entity", args: (r) => ({ p_company: A, p_id: r("CUS").id, p_archive: true }) },
      { as: "alice", fn: "archive_entity", args: () => ({ p_company: A, p_id: NOPE, p_archive: true }) },

      // Forms, approvals, ingestion.
      { as: "alice", fn: "save_template", save: "TPL", args: () => ({ p_company: A, p_name: "เบิกเงิน", p_department: "Finance", p_fields: [{ key: "name", label: "รายการ", type: "text", required: true }, { key: "amount", label: "จำนวนเงิน", type: "number" }, { key: "kind", label: "ประเภท", type: "choice", options: ["เดินทาง", "อื่นๆ"] }], p_steps: [] }) },
      { as: "alice", fn: "save_template", args: () => ({ p_company: A, p_name: "x", p_department: "Finance", p_fields: [{ key: "Bad Key", type: "text" }], p_steps: [] }) },
      { as: "alice", fn: "set_template_target", args: (r) => ({ p_company: A, p_id: r("TPL").id, p_kind: "expenses", p_map: { name: "name", amount: "amount" } }) },
      { as: "alice", fn: "set_template_target", args: (r) => ({ p_company: A, p_id: r("TPL").id, p_kind: "nowhere", p_map: null }) },
      { as: "alice", fn: "submit_ingestion", save: "ING", args: (r) => ({ p_company: A, p_template: r("TPL").id, p_raw: "ค่าน้ำมัน 500 บาท" }) },
      { as: "vic", fn: "submit_ingestion", args: (r) => ({ p_company: A, p_template: r("TPL").id, p_raw: "x" }) },
      { as: "alice", fn: "claim_ingestion", note: "service only", args: () => ({}) },
      { as: "service", fn: "claim_ingestion", save: "JOBS", args: () => ({}) },
      { as: "service", fn: "item_file_count", args: (r) => ({ p_id: r("ING").id }) },
      { as: "service", fn: "item_file_count", args: () => ({ p_id: NOPE }) },
      { as: "service", fn: "complete_ingestion", args: (r) => ({ p_id: r("ING").id, p_lease: r("JOBS")[0].lease_id, p_values: { name: "ค่าน้ำมัน", amount: 500, kind: "เดินทาง" }, p_missing: [], p_engine: "test" }) },
      { as: "alice", fn: "web_approval_act", args: (r) => ({ p_company: A, p_id: r("ING").id, p_action: "approve", p_values: { amount: 450 } }) },
      { as: "alice", fn: "web_approval_act", args: () => ({ p_company: A, p_id: NOPE, p_action: "approve", p_values: null }) },
      { as: "alice", fn: "retry_ingestion", args: (r) => ({ p_company: A, p_id: r("ING").id }) },
      { as: "service", fn: "purge_voice_files", args: () => ({}) },
      { as: "service", fn: "purge_voice_files", args: () => ({ p_days: 3 }) },
      { as: "service", fn: "queue_nudges", args: () => ({}) },

      // Finance and documents.
      { as: "alice", fn: "goal_set", args: () => ({ p_company: A, p_month: "2026-11-01", p_target: 150000 }) },
      { as: "amy", fn: "goal_set", args: () => ({ p_company: A, p_month: "2026-11-01", p_target: 1 }) },
      { as: "alice", fn: "finance_save_targets", args: () => ({ p_company: A, p_year: 2026, p_revenue: 1200000, p_profit: 300000, p_expense_cap: 800000 }) },
      { as: "alice", fn: "finance_save_budgets", args: () => ({ p_company: A, p_year: 2026, p_budgets: { Sales: 100000, Marketing: 50000 } }) },
      { as: "alice", fn: "finance_close_step", args: () => ({ p_company: A, p_year: 2026, p_step: 1, p_done: true }) },
      { as: "amy", fn: "finance_close_step", args: () => ({ p_company: A, p_year: 2026, p_step: 1, p_done: true }) },
      { as: "alice", fn: "issued_documents_list", args: () => ({ p_company: A }) },
      { as: "alice", fn: "document_number", args: (r) => ({ p_company: A, p_kind: "invoice", p_entity: r("CUS").id }) },
      { as: "carol", fn: "issued_documents_list", note: "not a member", args: () => ({ p_company: A }) },

      // Billing, coins, shop, ads.
      { as: "alice", fn: "has_addon", args: () => ({ c: A, a: "ocr_plus" }) },
      { as: "service", fn: "has_addon", args: () => ({ c: B, a: "exec_dashboard" }) },
      { as: "service", fn: "trial_usage", args: () => ({ c: B }) },
      { as: "alice", fn: "trial_usage", args: () => ({ c: A }) },
      { as: "alice", fn: "usage_summary", args: () => ({ p_company: A }) },
      { as: "bob", fn: "usage_summary", args: () => ({ p_company: B }) },
      { as: "carol", fn: "usage_summary", note: "not a member", args: () => ({ p_company: A }) },
      { as: "alice", fn: "buy_module", args: () => ({ p_company: A, p_module: "no-such-module" }) },
      { as: "amy", fn: "buy_module", args: () => ({ p_company: A, p_module: "x" }) },
      { as: "alice", fn: "shop_buy", args: () => ({ p_company: A, p_item: "no-such-item" }) },
      { as: "alice", fn: "request_payment", args: () => ({ p_company: A, p_plan: "nope", p_cycle: "monthly", p_attachment: null, p_slip: null, p_ref: null }) },
      { as: "amy", fn: "confirm_payment", note: "service only", args: () => ({ p_id: NOPE, p_status: "verified" }) },
      { as: "service", fn: "confirm_payment", args: () => ({ p_id: NOPE, p_status: "verified" }) },
      { as: "service", fn: "expire_subscriptions", args: () => ({}) },
      { as: "alice", fn: "my_feed_ads", args: () => ({ p_company: A }) },
      { as: "alice", fn: "feed_ads_live", args: () => ({ p_company: A }) },
      { as: "alice", fn: "feed_ad_track", args: () => ({ p_company: A, p_ad: NOPE, p_kind: "view" }) },
      { as: "service", fn: "add_platform_customer", args: () => ({ p_company: A }) },

      // Reports.
      { as: "alice", fn: "dashboard_summary", args: () => ({ p_company: A }) },
      { as: "carol", fn: "dashboard_summary", note: "not a member", args: () => ({ p_company: A }) },
      { as: "alice", fn: "analytics_series", args: () => ({ p_company: A }) },
      { as: "alice", fn: "template_metrics", args: () => ({ p_company: A }) },
      { as: "alice", fn: "template_breakdowns", args: () => ({ p_company: A }) },
      { as: "alice", fn: "calendar_entries", args: () => ({ p_company: A, p_month: "2026-11" }) },

      // Feed.
      { as: "alice", fn: "feed_post", args: () => ({ p_company: A, p_id: POST, p_kind: "job", p_body: " รับสมัครช่างไม้ ", p_meta: { title: "ช่างไม้ 2 คน" }, p_images: [] }) },
      { as: "vic", fn: "feed_post", args: () => ({ p_company: A, p_id: NOPE, p_kind: "post", p_body: "x", p_meta: {}, p_images: [] }) },
      { as: "bob", fn: "feed_like", args: () => ({ p_post: POST }) },
      { as: "bob", fn: "feed_save", args: () => ({ p_post: POST }) },
      { as: "bob", fn: "feed_share", args: () => ({ p_post: POST }) },
      { as: "bob", fn: "feed_view", args: () => ({ p_posts: [POST, NOPE] }) },
      { as: "bob", fn: "feed_comment", args: () => ({ p_company: B, p_post: POST, p_body: " สนใจครับ " }) },
      { as: "bob", fn: "feed_follow", args: () => ({ p_company: B, p_target: A }) },
      { as: "bob", fn: "feed_propose", args: () => ({ p_company: B, p_post: POST, p_message: "ส่งช่างได้ 2 คน", p_contact: "081" }) },
      { as: "alice", fn: "feed_proposals", args: () => ({ p_company: A }) },
      { as: "bob", fn: "feed_list", args: () => ({ p_company: B }) },
      { as: "carol", fn: "feed_list", note: "not a member", args: () => ({ p_company: A }) },
      { as: "carol", fn: "feed_companies", args: () => ({ p_company: C, p_search: null, p_limit: 120 }) },
      { as: "carol", fn: "feed_suggest", args: () => ({ p_company: C }) },
      { as: "bob", fn: "feed_company_profile", args: () => ({ p_company: B, p_target: A }) },
      { as: "alice", fn: "feed_follow_list", args: () => ({ p_company: A, p_target: A, p_dir: "followers" }) },
      { as: "alice", fn: "feed_alerts", args: () => ({ p_company: A }) },
      { as: "amy", fn: "feed_delete", args: () => ({ p_post: POST }) },

      // B2B chat.
      { as: "bob", fn: "b2b_open", save: "T", args: () => ({ p_company: B, p_target: A, p_post: POST }) },
      { as: "bob", fn: "b2b_post", args: () => ({ p_company: B, p_post: POST }) },
      { as: "bob", fn: "b2b_send", args: (r) => ({ p_company: B, p_thread: T(r), p_body: " สวัสดีครับ ", p_post: POST }) },
      { as: "bob", fn: "b2b_send", args: (r) => ({ p_company: B, p_thread: T(r), p_body: "", p_files: [{ path: T(r) + "/" + NOPE + ".pdf", name: "แบบ.pdf", mime: "application/pdf", size: 1200 }] }) },
      { as: "bob", fn: "b2b_send", args: (r) => ({ p_company: B, p_thread: T(r), p_body: "x", p_files: [{ path: "elsewhere/a.pdf", name: "a", mime: "application/pdf", size: 1 }] }) },
      { as: "vic", fn: "b2b_send", args: (r) => ({ p_company: A, p_thread: T(r), p_body: "x" }) },
      { as: "alice", fn: "b2b_unread", args: () => ({ p_company: A }) },
      { as: "carol", fn: "b2b_unread", note: "not a member", args: () => ({ p_company: A }) },
      { as: "alice", fn: "b2b_inbox", args: () => ({ p_company: A }) },
      { as: "alice", fn: "b2b_read", args: (r) => ({ p_company: A, p_thread: T(r) }) },
      { as: "carol", fn: "b2b_read", args: (r) => ({ p_company: C, p_thread: T(r) }) },
      { as: "bob", fn: "my_avatar", args: () => ({}) },
      { as: "bob", fn: "set_my_avatar", args: () => ({ p_on: true }) },
      { as: "bob", fn: "set_my_avatar", args: () => ({ p_on: false }) },

      // B2B deals.
      { as: "alice", fn: "b2b_deal_request", save: "RFQ", args: (r) => ({ p_company: A, p_thread: T(r), p_title: " บูธงานแฟร์ ", p_data: { items: [{ name: "บูธ 3x3", qty: 1, unit: "งาน" }], needBy: "2026-12-20", budget: "50000" } }) },
      { as: "alice", fn: "b2b_deal_request", args: (r) => ({ p_company: A, p_thread: T(r), p_title: "  ", p_data: {} }) },
      { as: "bob", fn: "b2b_deals_of", args: (r) => ({ p_company: B, p_thread: T(r) }) },
      { as: "bob", fn: "b2b_deal_quote", save: "Q1", args: (r) => ({ p_company: B, p_thread: T(r), p_deal: r("RFQ").deal_id, p_title: "บูธงานแฟร์", p_data: { items: [{ name: "บูธ 3x3", qty: 1, unit: "งาน", price: 45000 }], vatMode: "excluded", validUntil: "2099-01-31" } }) },
      { as: "amy", fn: "b2b_deal_decide", args: (r) => ({ p_company: A, p_card: r("Q1").id, p_decision: "accept" }) },
      { as: "alice", fn: "b2b_deal_decide", save: "ACC", args: (r) => ({ p_company: A, p_card: r("Q1").id, p_decision: "accept" }) },
      { as: "bob", fn: "b2b_deal_progress", args: (r) => ({ p_company: B, p_deal: r("RFQ").deal_id, p_percent: 40, p_note: "เริ่มผลิต" }) },
      { as: "alice", fn: "b2b_deal_withdraw", args: (r) => ({ p_company: A, p_card: r("RFQ").id }) },

      // LINE.
      { raw: { pg: "insert into line_groups(group_id,company_id,name) values ('G1',$1,'บัญชี')", d1: "insert into line_groups(group_id,company_id,name) values ('G1',?,'บัญชี')" }, params: () => [A] },
      { as: "service", fn: "line_quick_stats", args: () => ({ p_group: "G1" }) },
      { as: "service", fn: "line_quick_stats", args: () => ({ p_group: "nope" }) },
      { as: "alice", fn: "set_line_group_listen", args: () => ({ p_company: A, p_group: "G1", p_listen: "all" }) },
      { as: "alice", fn: "update_line_group", args: (r) => ({ p_company: A, p_group: "G1", p_template: r("TPL").id, p_name: "บัญชี", p_keywords: ["อนุมัติ", "โอเค"], p_department: "Finance" }) },
      { as: "amy", fn: "unlink_line_group", args: () => ({ p_company: A, p_group: "G1" }) },
      { as: "alice", fn: "line_approve", note: "service only", args: () => ({ p_group: "G1", p_user: "U1", p_id: NOPE }) },
      { as: "service", fn: "line_approve", args: () => ({ p_group: "G1", p_user: "U1", p_id: NOPE }) },
      { as: "service", fn: "line_documents", args: () => ({ p_group: "G1", p_user: "U1" }) },
      { as: "service", fn: "line_set_approvers", args: () => ({ p_group: "G1", p_user: "U1", p_hash: null, p_add: [], p_remove: null }) },
      { as: "service", fn: "pair_line_group", args: () => ({ p_hash: "nope", p_group: "G2" }) },
      { as: "alice", fn: "remove_line_approver", args: () => ({ p_company: A, p_group: "G1", p_line_user: "U1" }) },
      { as: "service", fn: "line_expense_summary", args: () => ({ p_group: "G1", p_user: "U1", p_from: "2026-11-01", p_to: "2026-11-30" }) },
    ];

    const norm = labeller(h, { [POST]: "post", [NOPE]: "nope" });
    const saved = { pg: {} as Data, d1: {} as Data };
    const refs = (side: "pg" | "d1"): Refs => (name) => {
      if (!(name in saved[side])) throw new Error(`no saved result ${name}`);
      return saved[side][name];
    };
    const names = new Set<string>();
    for (const [i, s] of steps.entries()) {
      if ("raw" in s) {
        await h.login(null);
        await h.db.query(s.raw.pg, s.params(refs("pg")));
        h.lite.prepare(s.raw.d1).run(...(s.params(refs("d1")) as string[]));
        continue;
      }
      names.add(s.fn);
      let a: unknown, b: unknown;
      // Postgres, as PostgREST would call it.
      if (s.as === "service") {
        await h.db.exec("reset role;");
        await h.db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.email','',false)");
        await h.db.exec("set role service_role;");
      } else await h.login(s.as);
      try {
        a = await callPg(h, s.fn, s.args?.(refs("pg")) ?? {});
        if (s.save) saved.pg[s.save] = a;
      } catch (e) {
        a = { error: (e as Error).message };
      }
      await h.login(null);
      // D1, through the map.
      try {
        b = JSON.parse(JSON.stringify((await rpcs[s.fn](caller(h, s.as), s.args?.(refs("d1")) ?? {})) ?? null));
        if (s.save) saved.d1[s.save] = b;
      } catch (e) {
        b = { error: (e as Error).message };
      }
      const na = norm("pg", a),
        nb = norm("d1", b);
      if (process.env.SHOW_PARITY) console.log(i + 1, s.as, s.fn, s.note ?? "", JSON.stringify(na).slice(0, 220));
      assert.deepEqual(nb, na, `step ${i + 1} (${s.as} ${s.fn}${s.note ? " — " + s.note : ""})`);
    }
    // What the calls left behind.
    await sameRows(h, norm, "stock_movements", ["product_id", "type", "quantity", "reference", "notes", "created_by"]);
    await sameRows(h, norm, "b2b_messages", ["thread_id", "company_id", "author_id", "author_name", "body", "post_id", "files"]);
    await sameRows(h, norm, "audit_events", ["company_id", "actor", "action"], { pg: "action<>'company_created'", d1: "action<>'company_created'" });
    assert.ok(names.size >= 30, `${names.size} rpc names compared`);
    if (process.env.SHOW_PARITY) console.log(`${steps.length} steps, ${names.size} rpc names`);
  } finally {
    await h.db.close();
  }
});
