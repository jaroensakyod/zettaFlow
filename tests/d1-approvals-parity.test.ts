// The D1 port of the approval functions (src/lib/d1/approvals.ts) must behave exactly like Postgres: the same steps run
// against the real schema (PGlite, every migration) and against D1 (node:sqlite), and every outcome — the approval
// chain and its history, decided stamps, records created on approval (with their codes, sources and files), workflow
// projects / deals / tasks, templates, nudges, audit log, or the exact error message — has to match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { validateEntity } from "../src/lib/domain";
import { approvalStatuses } from "../src/lib/dept-rules";
import { sqliteDriver } from "../src/lib/d1/driver";
import { Tenant } from "../src/lib/d1/tenant";
import { saveEntity } from "../src/lib/d1/entities";
import { approvalAct, approvalApply, approveDeal, queueNudges, saveEntityAs, saveTemplate, setTemplateTarget, webApprovalAct } from "../src/lib/d1/approvals";
import type { Viewer } from "../src/lib/d1/access";

const U = {
  owner: "10000000-0000-4000-8000-000000000001",
  manager: "10000000-0000-4000-8000-000000000002",
  hr: "10000000-0000-4000-8000-000000000003",
  staff: "10000000-0000-4000-8000-000000000004",
};
type Who = keyof typeof U;
const stranger = "10000000-0000-4000-8000-0000000000ff";
const members: { who: Who; name: string; role: string; departments: string[] }[] = [
  { who: "manager", name: "ผู้จัดการ", role: "manager", departments: ["Finance", "Operations", "Business Development"] },
  { who: "hr", name: "", role: "manager", departments: ["HR"] },
  { who: "staff", name: "พนักงาน", role: "staff", departments: ["Finance"] },
];
const ing = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const att = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const missingId = "20000000-0000-4000-8000-999999999999";
type Data = Record<string, unknown>;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString();

type Step =
  | { op: "seed"; table: string; row: Data }
  | { op: "sql"; sql: string }
  | { as: Who; op: "save"; label: string; kind: string; data: Data }
  | { as: Who; op: "web"; ing: number | string; action: string; values?: Data; note?: string }
  | { op: "act"; actor: Who | null; ing: number; action: string; note?: string; step?: number }
  | { op: "apply"; line: string; name: string; ing: number; action: string; note?: string; step?: number }
  | { as: Who; op: "deal"; ref: string }
  | { op: "saveAs"; user: Who | "stranger"; kind: string; data: Data }
  | { as: Who; op: "tpl"; label?: string; name: string; department: string; fields: Data[]; steps: Data[]; id?: string }
  | { as: Who; op: "target"; ref: string; kind: string | null; map: unknown }
  | { op: "nudge" };

const tplFields = [
  { key: "title", label: "เรื่อง", type: "text" },
  { key: "start", label: "เริ่ม", type: "date" },
  { key: "end", label: "สิ้นสุด", type: "date" },
  { key: "project", label: "โครงการ", type: "text" },
  { key: "rent", label: "ค่าเช่า", type: "number" },
  { key: "location", label: "สถานที่", type: "text" },
  { key: "cost", label: "ค่าใช้จ่าย", type: "number" },
];
const tplSteps = [
  { department: "Design", name: "ออกแบบบูธ" },
  { department: "Marketing", name: "โปรโมท" },
];
const expenseTpl = {
  name: "ค่าใช้จ่ายจาก LINE",
  fields: [
    { key: "name", label: "รายการ", type: "text", required: true },
    { key: "amount", label: "จำนวนเงิน", type: "number", required: true },
    { key: "category", label: "หมวด", type: "text" },
    { key: "date", label: "วันที่", type: "date" },
  ],
  steps: [],
};
/** An ingestion row; the attachment is linked by a later seed step (the two tables point at each other). */
const item = (n: number, row: Data): Step => ({
  op: "seed",
  table: "ingestions",
  row: { id: ing(n), template: { name: "เบิก", fields: [] }, department: "Operations", values: {}, missing: [], status: "review", created_by: U.staff, created_at: hoursAgo(1), ...row },
});
const file = (n: number, ingestion: number): Step[] => [
  { op: "seed", table: "attachments", row: { id: att(n), department: "Finance", name: `slip${n}.jpg`, mime: "image/jpeg", size: 100, path: `x/slip${n}.jpg`, ingestion_id: ing(ingestion) } },
  { op: "sql", sql: `update ingestions set attachment_id='${att(n)}' where id='${ing(ingestion)}'` },
];
const today = "2026-11-20";

const steps: Step[] = [
  // People and LINE links.
  { op: "seed", table: "line_groups", row: { group_id: "G1", name: "กลุ่มปฏิบัติการ", department: "Operations" } },
  { op: "seed", table: "line_users", row: { line_user_id: "U-staff", user_id: U.staff } },
  { op: "seed", table: "line_users", row: { line_user_id: "U-man", user_id: U.manager } },
  { as: "owner", op: "save", label: "SUP", kind: "suppliers", data: { name: "ผู้ขายจริง", status: "active" } },
  { as: "owner", op: "save", label: "PRJ", kind: "projects", data: { name: "งานเดิม", priority: "normal", status: "active" } },

  // Templates: who may save, every validation, the quota on a free plan, and the target page with its field map.
  { as: "manager", op: "tpl", name: "x", department: "Finance", fields: [{ key: "a", type: "text" }], steps: [] },
  { as: "owner", op: "tpl", name: "", department: "Finance", fields: [{ key: "a", type: "text" }], steps: [] },
  { as: "owner", op: "tpl", name: "ว่าง", department: "Finance", fields: [], steps: [] },
  { as: "owner", op: "tpl", name: "คีย์ผิด", department: "Finance", fields: [{ key: "Name", type: "text" }], steps: [] },
  { as: "owner", op: "tpl", name: "ตัวเลือกเดียว", department: "Finance", fields: [{ key: "pick", type: "choice", options: ["a"] }], steps: [] },
  { as: "owner", op: "tpl", name: "ซ้ำ", department: "Finance", fields: [{ key: "a", type: "text" }, { key: "a", type: "number" }], steps: [] },
  { as: "owner", op: "tpl", name: "ไม่มีคีย์", department: "Finance", fields: [{}], steps: [] },
  { as: "owner", op: "tpl", name: "ประเภทผิด", department: "Finance", fields: [{ key: "a", type: "image" }], steps: [] },
  { as: "owner", op: "tpl", label: "T1", name: "ขอพื้นที่ขาย", department: "Business Development", fields: tplFields, steps: tplSteps },
  { as: "owner", op: "tpl", label: "T2", name: "บันทึก", department: "Finance", fields: [{ key: "note", type: "choice", options: ["a", "b"] }], steps: [] },
  { as: "owner", op: "tpl", label: "T2", name: "บันทึก (แก้)", department: "Finance", fields: [{ key: "note", type: "text" }], steps: [], id: "@T2" },
  { as: "owner", op: "tpl", name: "ไม่มี", department: "Finance", fields: [{ key: "note", type: "text" }], steps: [], id: missingId },
  { op: "sql", sql: "update subscriptions set plan='free'" },
  { as: "owner", op: "tpl", name: "สาม", department: "Finance", fields: [{ key: "a", type: "text" }], steps: [] },
  { as: "owner", op: "tpl", name: "สี่", department: "Finance", fields: [{ key: "a", type: "text" }], steps: [] },
  { op: "sql", sql: "update subscriptions set plan='business'" },
  { as: "manager", op: "target", ref: "T1", kind: "expenses", map: {} },
  { as: "owner", op: "target", ref: "T1", kind: "nope", map: {} },
  { as: "owner", op: "target", ref: "T1", kind: "expenses", map: [1] },
  { as: "owner", op: "target", ref: "T1", kind: "expenses", map: { a: "x".repeat(4990) } },
  { as: "owner", op: "target", ref: "T1", kind: "expenses", map: { a: "x".repeat(4992) } },
  { as: "owner", op: "target", ref: "missing", kind: "expenses", map: {} },
  { as: "owner", op: "target", ref: "T2", kind: null, map: null },
  { as: "owner", op: "target", ref: "T1", kind: "expenses", map: { title: "name", cost: "amount" } },

  // Items waiting for approval.
  item(1, { target_kind: "expenses", department: "Finance", group_id: "G1", group_name: "ชื่อเดิม", sender_name: "สมชาย", source_user: "U-staff", doc_code: "EXP-69-0099", template: expenseTpl, values: { name: "ค่าเช่าบูธ", amount: 12000, category: "ค่าเช่า", date: today } }),
  ...file(1, 1),
  item(2, { department: "Purchasing", template: { name: "ขอซื้อ", fields: [{ key: "name", label: "ชื่อ", type: "text" }] }, values: { name: "ซื้อปากกา", lines: [{ name: "ปากกา", qty: 10, price: 20 }] } }),
  item(3, { values: { name: "งานซ่อม", budget: 8000 } }),
  item(4, { status: "draft", values: { name: "ร่าง" } }),
  item(5, { created_by: U.manager, values: { name: "ค่าแท็กซี่", amount: 300 } }),
  item(6, { group_id: "G1", created_at: hoursAgo(48), missing: ["amount", "date"], values: { name: "ค่าน้ำมัน" } }),
  item(7, { group_id: "G1", created_at: hoursAgo(24), missing: ["date"], values: { name: "" } }),
  item(8, { group_id: "G1", created_at: hoursAgo(2), missing: ["x"], values: { name: "ยังไม่ถึงเวลา" } }),
  item(9, { department: "Finance", template: { name: "เบิก", fields: [{ key: "name", label: "ชื่อรายการ", required: true }] }, values: { name: "" } }),
  item(10, { target_kind: "expenses", department: "Finance", template: expenseTpl, values: { name: "ค่าส่งของ", amount: 450 } }),
  item(11, { target_kind: "expenses", department: "Finance", group_id: "G1", source_user: "U-man", template: expenseTpl, values: { name: "ค่าไฟบูธ", amount: 6400, category: "ค่าไฟ", date: today } }),
  ...file(2, 11),
  item(12, {
    target_kind: "expenses",
    department: "Finance",
    template: { name: "ค่าของ", fields: [{ key: "name" }, { key: "amount" }, { key: "supplierId" }] },
    values: { name: "ค่าของ", amount: "abc", supplierId: "ไม่มีผู้ขาย" },
  }),
  ...file(3, 12),
  item(13, { target_kind: "expenses", department: "Finance", template: { name: "ค่าของ", fields: [{ key: "name" }, { key: "amount" }, { key: "supplierId" }] }, values: { name: "ค่าของจากผู้ขาย", amount: 10, supplierId: " ผู้ขายจริง " } }),
  ...file(4, 13),
  item(14, { department: "Business Development", template: { id: "@T1", name: "ขอพื้นที่ขาย", department: "Business Development", fields: tplFields, steps: tplSteps }, values: { title: "บูธเซ็นทรัล", start: "2026-12-01", end: "2026-12-10", project: "งานเซ็นทรัล", rent: 20000, location: "เซ็นทรัลเวิลด์", cost: 20000 } }),
  item(15, { department: "Business Development", template: { id: "@T1", name: "ขอพื้นที่ขาย", department: "Business Development", fields: tplFields, steps: tplSteps }, values: { title: "กลับวัน", start: "2026-12-10", end: "2026-12-01" } }),
  item(16, { department: "Business Development", template: { id: "@T1", name: "ขอพื้นที่ขาย", department: "Business Development", fields: tplFields, steps: tplSteps }, values: { title: "อ้างผิด", project_id: missingId } }),
  item(17, { department: "Business Development", template: { id: "@T1", name: "ขอพื้นที่ขาย", department: "Business Development", fields: tplFields, steps: tplSteps }, values: { title: "งานเดิมต่อ", project: "งานเดิม", cost: 900 } }),
  item(18, { department: "Business Development", template: { name: "ขอพื้นที่", department: "Business Development", fields: [{ key: "project", type: "text" }], steps: [{ department: "Sales", name: "ขาย" }] }, values: { project: "งานเซ็นทรัล", rent: -5, location: "ที่เดิม" } }),

  // Two-step chain (Operations, then Finance) on the web: who may act at which step, then the record on approval.
  { as: "staff", op: "web", ing: 1, action: "approve" },
  { as: "hr", op: "web", ing: 1, action: "approve" },
  { op: "act", actor: "manager", ing: 1, action: "approve", step: 1 },
  { op: "act", actor: null, ing: 1, action: "approve" },
  { as: "manager", op: "web", ing: 1, action: "approve" },
  { as: "manager", op: "web", ing: 1, action: "approve" },
  { as: "owner", op: "web", ing: 1, action: "approve", values: { name: "ค่าเช่าบูธสยาม", amount: 12500, category: "ค่าเช่า", date: today, junk: 1 } },
  { as: "owner", op: "web", ing: 1, action: "approve" },
  // Reject needs a reason; send back to fix opens a new round.
  { as: "owner", op: "web", ing: 2, action: "reject", note: " x " },
  { as: "owner", op: "web", ing: 2, action: "reject", note: "แพงไป" },
  { as: "manager", op: "web", ing: 3, action: "fix", note: "ใส่ใบเสนอราคา" },
  { as: "manager", op: "web", ing: 3, action: "approve" },
  { as: "owner", op: "web", ing: 4, action: "approve" },
  { as: "owner", op: "web", ing: missingId, action: "approve" },
  // Own request, missing data, required fields, expense waiting for its slip.
  { as: "manager", op: "web", ing: 5, action: "approve" },
  { as: "owner", op: "web", ing: 5, action: "approve" },
  { as: "owner", op: "web", ing: 6, action: "approve" },
  { as: "owner", op: "web", ing: 9, action: "approve" },
  { as: "owner", op: "web", ing: 10, action: "approve" },
  // LINE approvers (no account): one person per step, stale step, bad command, then the record (no creator).
  { op: "apply", line: "U-a", name: "ผู้อนุมัติ A", ing: 11, action: "approve", step: 0 },
  { op: "apply", line: "U-a", name: "ผู้อนุมัติ A", ing: 11, action: "approve" },
  { op: "apply", line: "U-b", name: "ผู้อนุมัติ B", ing: 11, action: "approve", step: 0 },
  { op: "apply", line: "U-b", name: "ผู้อนุมัติ B", ing: 11, action: "nonsense" },
  { op: "apply", line: "U-b", name: "ผู้อนุมัติ B", ing: 11, action: "approve", step: 1 },
  // The record cannot be made: unknown supplier name and a bad number; a supplier found by name.
  { as: "owner", op: "web", ing: 12, action: "approve" },
  { op: "act", actor: "owner", ing: 13, action: "approve" },
  // Forms with a workflow: new project + deal + tasks, bad dates, bad project link, existing project, negative rent.
  { as: "manager", op: "web", ing: 14, action: "approve" },
  { as: "owner", op: "web", ing: 15, action: "approve" },
  { as: "owner", op: "web", ing: 16, action: "approve" },
  { as: "manager", op: "web", ing: 17, action: "approve" },
  { as: "owner", op: "web", ing: 18, action: "approve" },

  // Deals.
  { as: "owner", op: "save", label: "D1", kind: "deals", data: { name: "พื้นที่สยาม", location: "สยาม", rent: 15000, startDate: "2026-12-01", endDate: "2026-12-31", status: "pending" } },
  { as: "owner", op: "save", label: "D2", kind: "deals", data: { name: "พื้นที่บางนา", location: "บางนา", rent: 5000, projectId: "@PRJ", status: "pending" } },
  { as: "owner", op: "save", label: "D3", kind: "deals", data: { name: "พื้นที่ต่อรอง", location: "รังสิต", rent: 1, status: "negotiating" } },
  { as: "staff", op: "deal", ref: "D1" },
  { as: "hr", op: "deal", ref: "D1" },
  { as: "owner", op: "deal", ref: "D1" },
  { as: "owner", op: "deal", ref: "D1" },
  { as: "manager", op: "deal", ref: "D2" },
  { as: "owner", op: "deal", ref: "D3" },


  // save_entity on behalf of a member.
  { op: "saveAs", user: "stranger", kind: "expenses", data: { name: "x", category: "อื่นๆ", date: today, amount: 1, status: "pending" } },
  { op: "saveAs", user: "staff", kind: "expenses", data: { name: "ค่ากาแฟ", category: "อื่นๆ", date: today, amount: 120, status: "pending" } },
  { op: "saveAs", user: "staff", kind: "tasks", data: { name: "งานออกแบบ", department: "Design", priority: "normal", status: "pending" } },

  // Reminders for items still missing data.
  { op: "nudge" },
  { op: "nudge" },
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
  /** A signed-in person, or null: the database itself (auth.uid() is null, as for the LINE webhook and cron). */
  const login = async (id: string | null, email = "") => {
    await db.exec("reset role;");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id ?? "", email]);
    if (id) await db.exec("set role authenticated;");
  };
  await login(U.owner, "owner@test.local");
  const company = (await db.query<{ id: string }>("select create_company('บริษัททดสอบ') as id")).rows[0].id;
  await login(null);
  await db.query("update subscriptions set plan='business',status='active',current_period_end=now()+interval '30 days' where company_id=$1", [company]);
  for (const m of members)
    await db.query("insert into memberships(company_id,user_id,email,name,role,departments) values ($1,$2,$3,$4,$5,$6)", [company, U[m.who], m.who + "@test.local", m.name, m.role, m.departments]);
  const ownerName = (await db.query<{ name: string }>("select name from memberships where company_id=$1 and user_id=$2", [company, U.owner])).rows[0].name;
  return { db, login, company, ownerName };
}

test("approval functions on D1 match Postgres step for step", async () => {
  const pg = await postgres();
  const lite = new DatabaseSync(":memory:");
  lite.exec(readFileSync("cloudflare/d1/0001_schema.sql", "utf8"));
  const liteCols = (table: string) => (lite.prepare(`select name from pragma_table_info('${table}')`).all() as { name: string }[]).map((c) => c.name);
  const toLite = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "boolean" ? (v ? 1 : 0) : v !== null && typeof v === "object" ? JSON.stringify(v) : (v as string | number | null));
  const copy = async (table: string, where = "") => {
    const cols = liteCols(table);
    for (const r of (await pg.db.query<Data>(`select * from ${table} ${where}`)).rows) {
      const keys = cols.filter((c) => r[c] !== undefined);
      lite.prepare(`insert or replace into "${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => toLite(r[k])));
    }
  };
  await copy("entity_schemas");
  await copy("plans");
  await copy("trial_limits");
  lite.prepare("insert into companies(id,name) values (?,?)").run(pg.company, "บริษัททดสอบ");
  await copy("subscriptions", `where company_id='${pg.company}'`);
  lite.prepare("insert into memberships(company_id,user_id,email,name,role,departments) values (?,?,?,?,?,?)").run(pg.company, U.owner, "owner@test.local", pg.ownerName, "owner", "[]");
  for (const m of members) lite.prepare("insert into memberships(company_id,user_id,email,name,role,departments) values (?,?,?,?,?,?)").run(pg.company, U[m.who], m.who + "@test.local", m.name, m.role, JSON.stringify(m.departments));

  const sql = sqliteDriver(lite);
  const viewers = Object.fromEntries(
    (Object.keys(U) as Who[]).map((w) => {
      const m = members.find((x) => x.who === w);
      return [w, { userId: U[w], email: w + "@test.local", companyId: pg.company, role: m?.role ?? "owner", departments: m?.departments ?? [] } as Viewer];
    }),
  ) as Record<Who, Viewer>;
  type Side = "pg" | "d1";
  const ids = { pg: {} as Record<string, string>, d1: {} as Record<string, string> };
  const resolve = (side: Side, v: unknown): unknown =>
    typeof v === "string" && v.startsWith("@")
      ? ids[side][v.slice(1)]
      : Array.isArray(v)
        ? v.map((x) => resolve(side, x))
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(side, x)]))
          : v;
  const ingestionOut = (r: Data | undefined) =>
    r && {
      status: r.status,
      values: r.values,
      missing: r.missing,
      error: r.error,
      decided: !!r.decided_at,
      decided_by: r.decided_by,
      decided_name: r.decided_name,
      decided_via: r.decided_via,
      decided_group: r.decided_group,
      confirm: r.confirm,
      approval: r.approval,
      nudged: !!r.nudged_at,
    };
  const tplOut = (r: Data) => ({ name: r.name, department: r.department, fields: r.fields, steps: r.steps, version: Number(r.version), target_kind: r.target_kind, field_map: r.field_map });

  async function onPg(s: Step): Promise<unknown> {
    const as = "as" in s ? s.as : null;
    await pg.login(as && U[as], as ? as + "@test.local" : "");
    const q = async <T = Data>(text: string, p: unknown[] = []) => (await pg.db.query<T>(text, p)).rows;
    const ingId = (n: number | string) => (typeof n === "number" ? ing(n) : n);
    try {
      switch (s.op) {
        case "seed": {
          const row = resolve("pg", { company_id: pg.company, ...s.row }) as Data;
          const keys = Object.keys(row);
          await q(`insert into ${s.table}(${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, keys.map((k) => (row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k])));
          return null;
        }
        case "sql":
          await q(s.sql);
          return null;
        case "save": {
          const [r] = await q<{ id: string; data: Data }>("select * from save_entity($1,$2,$3,null,null)", [pg.company, s.kind, JSON.stringify(validateEntity(s.kind, resolve("pg", s.data)))]);
          ids.pg[s.label] = r.id;
          return { data: r.data };
        }
        case "web": {
          const [r] = await q<{ r: Data }>("select web_approval_act($1,$2,$3,$4,$5) as r", [pg.company, ingId(s.ing), s.action, s.values ? JSON.stringify(s.values) : null, s.note ?? null]);
          await pg.login(null);
          return { result: r.r, row: ingestionOut((await q("select * from ingestions where id=$1", [ingId(s.ing)]))[0]) };
        }
        case "act": {
          const [r] = await q<{ r: Data }>("select approval_act($1,$2,$3,$4,$5,$6,$7,$8) as r", [pg.company, s.actor && U[s.actor], ing(s.ing), s.action, s.note ?? null, "line", "G1", s.step ?? null]);
          return { result: r.r, row: ingestionOut((await q("select * from ingestions where id=$1", [ing(s.ing)]))[0]) };
        }
        case "apply": {
          const [r] = await q<{ r: Data }>("select approval_apply($1,$2,null,$3,$4,$5,$6,'line','G1',$7) as r", [pg.company, ing(s.ing), s.line, s.name, s.action, s.note ?? null, s.step ?? null]);
          return { result: r.r, row: ingestionOut((await q("select * from ingestions where id=$1", [ing(s.ing)]))[0]) };
        }
        case "deal": {
          const [r] = await q<{ p: string }>("select approve_deal($1,$2) as p", [pg.company, ids.pg[s.ref]]);
          return { project: r.p };
        }
        case "saveAs": {
          const [r] = await q<{ data: Data; department: string; created_by: string }>("select * from save_entity_as($1,$2,$3,$4)", [s.user === "stranger" ? stranger : U[s.user], pg.company, s.kind, JSON.stringify(validateEntity(s.kind, s.data))]);
          return { data: r.data, department: r.department, created_by: r.created_by };
        }
        case "tpl": {
          const [r] = await q<Data>("select * from save_template($1,$2,$3,$4,$5,$6)", [pg.company, s.name, s.department, JSON.stringify(s.fields), JSON.stringify(s.steps), s.id ? (resolve("pg", s.id) as string) : null]);
          if (s.label) ids.pg[s.label] = r.id as string;
          return tplOut(r);
        }
        case "target": {
          await q("select set_template_target($1,$2,$3,$4)", [pg.company, s.ref === "missing" ? missingId : ids.pg[s.ref], s.kind, s.map === null ? null : JSON.stringify(s.map)]);
          await pg.login(null);
          return tplOut((await q("select * from data_templates where id=$1", [ids.pg[s.ref]]))[0]);
        }
        case "nudge": {
          const [r] = await q<{ n: number }>("select queue_nudges() as n");
          return { n: r.n };
        }
      }
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async function onD1(s: Step): Promise<unknown> {
    const t = new Tenant(sql, viewers["as" in s ? s.as : "owner"]);
    const ingId = (n: number | string) => (typeof n === "number" ? ing(n) : n);
    const ingRow = async (id: string) => ingestionOut((await t.selectInternal<Data>("ingestions", { where: { id } }))[0]);
    try {
      switch (s.op) {
        case "seed": {
          const row = resolve("d1", { company_id: pg.company, ...s.row }) as Data;
          const keys = Object.keys(row);
          lite.prepare(`insert into "${s.table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => toLite(row[k])));
          return null;
        }
        case "sql":
          lite.exec(s.sql);
          return null;
        case "save": {
          const r = await saveEntity(t, s.kind, validateEntity(s.kind, resolve("d1", s.data) as Data));
          ids.d1[s.label] = r.id;
          return { data: r.data };
        }
        case "web":
          return { result: await webApprovalAct(t, ingId(s.ing), s.action, s.values ?? null, s.note ?? null), row: await ingRow(ingId(s.ing)) };
        case "act":
          return { result: await approvalAct(t, s.actor && U[s.actor], ing(s.ing), s.action, s.note ?? null, "line", "G1", s.step ?? null, { authUid: null }), row: await ingRow(ing(s.ing)) };
        case "apply":
          return {
            result: await approvalApply(t, { id: ing(s.ing), actor: null, lineUser: s.line, name: s.name, action: s.action, note: s.note ?? null, via: "line", group: "G1", step: s.step ?? null }, { authUid: null }),
            row: await ingRow(ing(s.ing)),
          };
        case "deal":
          return { project: await approveDeal(t, ids.d1[s.ref]) };
        case "saveAs": {
          const r = await saveEntityAs(sql, pg.company, s.user === "stranger" ? stranger : U[s.user], s.kind, validateEntity(s.kind, s.data));
          return { data: r.data, department: r.department, created_by: r.created_by };
        }
        case "tpl": {
          const r = await saveTemplate(t, s.name, s.department, s.fields, s.steps, s.id ? (resolve("d1", s.id) as string) : null);
          if (s.label) ids.d1[s.label] = r.id;
          return tplOut(r);
        }
        case "target": {
          await setTemplateTarget(t, s.ref === "missing" ? missingId : ids.d1[s.ref], s.kind, s.map as Data | null);
          return tplOut((await t.selectInternal<Data>("data_templates", { where: { id: ids.d1[s.ref] } }))[0]);
        }
        case "nudge":
          return { n: await queueNudges(t) };
      }
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  const raw: { pg: unknown; d1: unknown }[] = [];
  for (const s of steps) raw.push({ pg: await onPg(s), d1: await onD1(s) });

  // Ids made by either database differ: name them after what they are (entity kind + name, template name).
  await pg.login(null);
  const pgRows = async (text: string, p: unknown[] = []) => (await pg.db.query<Data>(text, p)).rows;
  const liteRows = (text: string) => lite.prepare(text).all() as Data[];
  const parse = (r: Data): Data => ({ ...r, data: typeof r.data === "string" ? JSON.parse(r.data) : r.data });
  const rows = {
    pg: { entities: (await pgRows("select * from entities")).map(parse), templates: await pgRows("select id,name from data_templates") },
    d1: { entities: liteRows("select * from entities").map(parse), templates: liteRows("select id,name from data_templates") },
  };
  const names = { pg: new Map<string, string>(), d1: new Map<string, string>() };
  for (const side of ["pg", "d1"] as Side[]) {
    for (const e of rows[side].entities) names[side].set(String(e.id), `${e.kind}:${(e.data as Data).name}`);
    for (const r of rows[side].templates) names[side].set(String(r.id), `template:${r.name}`);
    for (const [w, id] of Object.entries(U)) names[side].set(id, w);
  }
  const TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
  const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const norm = (side: Side, v: unknown): unknown =>
    v instanceof Date
      ? "<ts>"
      : typeof v === "string"
        ? (names[side].get(v) ?? (TS.test(v) ? "<ts>" : UUIDRE.test(v) && !v.startsWith("20000000") && !v.startsWith("30000000") ? "<uuid>" : v))
        : Array.isArray(v)
          ? v.map((x) => norm(side, x))
          : v && typeof v === "object"
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(side, x)]))
            : v;

  for (const [i, s] of steps.entries()) {
    const a = JSON.parse(JSON.stringify(norm("pg", raw[i].pg))),
      b = JSON.parse(JSON.stringify(norm("d1", raw[i].d1)));
    if (process.env.SHOW_PARITY) console.log(i + 1, s.op, JSON.stringify(a).slice(0, 240));
    assert.deepEqual(b, a, `step ${i + 1} (${s.op} ${JSON.stringify(s).slice(0, 160)})`);
  }

  // Side effects: every record (with its code, source and links), project stages, files, items, outbox, audit log.
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;
  const sorted = (xs: unknown[]) => xs.map((x) => JSON.stringify(canon(x))).sort();
  const entityOut = (side: Side, r: Data) => norm(side, { kind: r.kind, department: r.department, data: r.data, created_by: r.created_by, version: Number(r.version) });
  assert.deepEqual(sorted(rows.d1.entities.map((r) => entityOut("d1", r))), sorted(rows.pg.entities.map((r) => entityOut("pg", r))));
  const stages = (side: Side, rs: Data[]) => sorted(rs.map((r) => norm(side, [r.project_id, r.key, r.department])));
  assert.deepEqual(stages("d1", liteRows("select * from project_stages")), stages("pg", await pgRows("select * from project_stages")));
  const files = (side: Side, rs: Data[]) => sorted(rs.map((r) => norm(side, [r.id, r.entity_id, r.department])));
  assert.deepEqual(files("d1", liteRows("select * from attachments")), files("pg", await pgRows("select * from attachments")));
  const items = (side: Side, rs: Data[]) =>
    sorted(rs.map((r) => norm(side, { id: r.id, ...ingestionOut(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, side === "d1" && typeof v === "string" && /^[[{]/.test(v) ? JSON.parse(v) : side === "d1" && k === "confirm" ? !!v : v]))) })));
  assert.deepEqual(items("d1", liteRows("select * from ingestions")), items("pg", await pgRows("select * from ingestions")));
  const outbox = (rs: Data[]) => sorted(rs.map((r) => [r.target, r.body, r.ingestion_id ?? null, r.role ?? null]));
  assert.deepEqual(outbox(liteRows("select * from notification_outbox")), outbox(await pgRows("select * from notification_outbox")));
  const audit = (side: Side, rs: Data[]) => sorted(rs.map((r) => norm(side, [r.actor, r.action, r.target])));
  assert.deepEqual(audit("d1", liteRows("select * from audit_events")), audit("pg", await pgRows("select * from audit_events where action<>'company_created'")));
  const codes = (side: Side, rs: Data[]) => sorted(rs.map((r) => norm(side, [r.prefix, Number(r.last)])));
  assert.deepEqual(codes("d1", liteRows("select * from doc_counters")), codes("pg", await pgRows("select * from doc_counters")));

  // approval_statuses() is mirrored in dept-rules.ts.
  assert.deepEqual(approvalStatuses, (await pgRows("select approval_statuses() as s"))[0].s);
  await pg.db.close();
});
