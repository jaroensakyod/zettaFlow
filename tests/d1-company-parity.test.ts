// The D1 port of the company / members / support / presence / sample data / shares / notes / outbox functions must
// behave exactly like Postgres: the same steps run against the real schema (PGlite, every migration) and against D1
// (node:sqlite + src/lib/d1/company*.ts), and every outcome — the returned rows, or the exact error message — and the
// rows left behind have to match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { sqliteDriver } from "../src/lib/d1/driver";
import { Tenant } from "../src/lib/d1/tenant";
import { canReadDept, canWriteDept, type Viewer } from "../src/lib/d1/access";
import type { Role } from "../src/lib/types";
import { sampleRows } from "../src/lib/sample-data";
import {
  acceptInvitations,
  companyCard,
  companyCover,
  createCompany,
  departmentNames,
  deptList,
  editMember,
  endSupportAccess,
  inviteMember,
  memberRole,
  presencePing,
  saveCompany,
  sendMessage,
  setMemberAccess,
  supportReply,
  supportSeen,
  supportSend,
  supportViewer,
  type SignedInUser,
} from "../src/lib/d1/company";
import { claimNotifications, createShare, initProjectStages, noteDelete, noteSave, revokeShare, saveDashboardLayout, shareFailed, shareLockout, shareMetrics } from "../src/lib/d1/company-share";
import { clearSampleData, loadSampleData } from "../src/lib/d1/company-sample";

type Data = Record<string, unknown>;
type Who = "O" | "S" | "V" | "X" | "U" | "A";
const users: Record<Who, { id: string; email: string; name: string | null; confirmed: boolean }> = {
  O: { id: "10000000-0000-4000-8000-000000000001", email: "owner@test.local", name: "คุณเจ้าของ", confirmed: true },
  S: { id: "10000000-0000-4000-8000-000000000002", email: "staff@test.local", name: null, confirmed: true },
  V: { id: "10000000-0000-4000-8000-000000000003", email: "viewer@test.local", name: "วิว", confirmed: true },
  X: { id: "10000000-0000-4000-8000-000000000004", email: "extra@test.local", name: "เอ็กซ์", confirmed: true },
  U: { id: "10000000-0000-4000-8000-000000000005", email: "unconfirmed@test.local", name: null, confirmed: false },
  A: { id: "10000000-0000-4000-8000-000000000006", email: "admin@platform.local", name: "แอดมิน", confirmed: true },
};
// Fixed ids, the same on both sides.
const fixed: Record<string, string> = {
  ACC: "20000000-0000-4000-8000-000000000001",
  ACC2: "20000000-0000-4000-8000-000000000002",
  T1: "20000000-0000-4000-8000-000000000003",
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`N${i + 1}`, `30000000-0000-4000-8000-00000000000${i + 1}`])),
};
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const today = new Date().toISOString().slice(0, 10);
const pgArray = (a: string[]) => "{" + a.map((x) => '"' + x.replace(/["\\]/g, "\\$&") + '"').join(",") + "}";

type Raw = { op: "raw"; pg: string; lite: string; params: (id: (label: string) => string) => (string | number | null)[] };
type Step = { as?: Who; co?: string } & (
  | { op: "create"; label: string; name: string }
  | { op: "role" | "supportViewer"; who: Who }
  | { op: "save"; profile: Data; settings?: Data }
  | { op: "invite"; email: string; role: string; departments: string[] }
  | { op: "accept" }
  | { op: "edit"; who: Who | "unknown"; role: string; departments: string[]; disabled: boolean; readDepartments?: string[] | null }
  | { op: "access"; who: Who | "unknown"; role: string | null; departments: string[]; readDepartments: string[] }
  | { op: "can"; who: Who; dept: string }
  | { op: "deptList"; list: string[] }
  | { op: "deptNames" }
  | { op: "supportSend"; body: string }
  | { op: "supportReply"; name: string; body: string }
  | { op: "supportSeen" }
  | { op: "endSupport"; ref: string }
  | { op: "presence"; companies: string[] }
  | { op: "card" | "cover"; ref: string }
  | { op: "message"; department: string; body: string }
  | { op: "sample"; rows: unknown }
  | { op: "clearSample" }
  | { op: "initStages"; ref: string }
  | { op: "note"; day: string; body: string | null; items: unknown }
  | { op: "noteDelete"; day: string }
  | { op: "layout"; layout: unknown }
  | { op: "share"; label: string | null; keys: string[]; expires: string; tag: string }
  | { op: "revoke"; ref: string }
  | { op: "failed" | "lockout"; token: string; client: string }
  | { op: "metrics"; keys: string[] }
  | { op: "claim" }
  | Raw
);

const sample = sampleRows();
const project = sample.find((r) => r.kind === "projects")!.id;
const P = randomUUID(),
  SI = randomUUID();
const bigLayout = Object.fromEntries(Array.from({ length: 1800 }, (_, i) => ["k" + i, 0]));
const steps: Step[] = [
  // create_company
  { as: "U", op: "create", label: "Z", name: "บริษัทยังไม่ยืนยัน" },
  { as: "O", op: "create", label: "Z", name: "   " },
  { as: "O", op: "create", label: "Z", name: "ก".repeat(201) },
  { as: "O", op: "create", label: "A1", name: "  บริษัทเอ  " },
  { as: "X", op: "create", label: "B", name: "บริษัทบี" },
  { op: "role", who: "O" },
  { op: "role", who: "S" },
  // save_company, company_card, company_cover
  { as: "O", op: "save", profile: { name: " " } },
  { as: "O", op: "save", profile: { industry: "อีเวนต์" } },
  { as: "O", op: "save", profile: { name: "บริษัทเอ ใหม่", industry: "อีเวนต์", province: "กรุงเทพ", description: "ข".repeat(350), logo: "l.png", cover: "c.png" }, settings: { theme: "dark" } },
  { as: "X", op: "card", ref: "A1" },
  { as: "X", op: "cover", ref: "A1" },
  { as: "O", op: "save", profile: { name: "บริษัทเอ", cover: "" } },
  { as: "O", op: "cover", ref: "A1" },
  { as: "O", op: "card", ref: "Z" },
  { as: "O", op: "card", ref: "B" },
  // invite_member, accept_invitations, the users quota
  { as: "O", op: "invite", email: "staff@test.local", role: "owner", departments: ["Sales"] },
  { as: "O", op: "invite", email: "staff@test.local", role: "staff", departments: [] },
  { as: "O", op: "invite", email: "staff@test", role: "staff", departments: ["Sales"] },
  { as: "O", op: "invite", email: "  Staff@Test.local ", role: "staff", departments: ["Sales"] },
  { as: "O", op: "invite", email: "staff@test.local", role: "staff", departments: ["Purchasing", "Operations", "Warehouse"] },
  { as: "O", op: "invite", email: "viewer@test.local", role: "viewer", departments: ["Sales"] },
  { as: "O", op: "invite", email: "extra@test.local", role: "staff", departments: ["Sales"] },
  { as: "U", op: "accept" },
  { as: "S", op: "accept" },
  { as: "V", op: "accept" },
  { as: "X", op: "accept" },
  { as: "S", op: "invite", email: "a@b.co", role: "staff", departments: ["Sales"] },
  { op: "raw", pg: "update subscriptions set plan='business',status='active',current_period_end=$2 where company_id=$1", lite: "update subscriptions set plan='business',status='active',current_period_end=?2 where company_id=?1", params: (id) => [id("A1"), iso(30 * 86400000)] },
  { as: "X", op: "accept" },
  { as: "X", co: "B", op: "invite", email: "staff@test.local", role: "staff", departments: ["Sales"] },
  { as: "X", co: "B", op: "invite", email: "viewer@test.local", role: "viewer", departments: ["Sales"] },
  { op: "raw", pg: "update subscriptions set status='trial',trial_ends_at=$2 where company_id=$1", lite: "update subscriptions set status='trial',trial_ends_at=?2 where company_id=?1", params: (id) => [id("B"), iso(86400000)] },
  { op: "raw", pg: "update trial_limits set amount=1 where resource='users'", lite: "update trial_limits set amount=1 where resource='users'", params: () => [] },
  { as: "S", op: "accept" },
  { op: "raw", pg: "update trial_limits set amount=5 where resource='users'", lite: "update trial_limits set amount=5 where resource='users'", params: () => [] },
  { op: "raw", pg: "update invitations set expires_at=$1 where email='viewer@test.local' and accepted_at is null", lite: "update invitations set expires_at=? where email='viewer@test.local' and accepted_at is null", params: () => [iso(-60000)] },
  { as: "S", op: "accept" },
  { as: "V", op: "accept" },
  { op: "role", who: "S" },
  { op: "role", who: "V" },
  // edit_member
  { as: "S", op: "edit", who: "V", role: "staff", departments: ["Sales"], disabled: false },
  { as: "O", op: "edit", who: "V", role: "owner", departments: ["Sales"], disabled: false },
  { as: "O", op: "edit", who: "V", role: "staff", departments: [], disabled: false },
  { as: "O", op: "edit", who: "O", role: "staff", departments: ["Sales"], disabled: false },
  { as: "O", op: "edit", who: "unknown", role: "staff", departments: ["Sales"], disabled: false },
  { as: "O", op: "edit", who: "S", role: "manager", departments: ["Purchasing", "Operations", "Warehouse"], disabled: false },
  { as: "O", op: "edit", who: "V", role: "viewer", departments: ["Sales", "Marketing"], disabled: false },
  { op: "role", who: "S" },
  // set_member_access (0085): ใช้งาน / ดู per department; edit_member keeps the ดู list unless given one
  { op: "deptNames" },
  { op: "deptList", list: [" ", "Sales", "", "HR", "Sales", " Sales"] },
  { op: "deptList", list: [] },
  { as: "S", op: "access", who: "V", role: "staff", departments: ["Sales"], readDepartments: [] },
  { as: "O", op: "access", who: "V", role: null, departments: ["Sales"], readDepartments: [] },
  { as: "O", op: "access", who: "V", role: "owner", departments: ["Sales"], readDepartments: [] },
  { as: "O", op: "access", who: "V", role: "staff", departments: ["Sales", "Nope"], readDepartments: [] },
  { as: "O", op: "access", who: "V", role: "staff", departments: [], readDepartments: ["Nope"] },
  { as: "O", op: "access", who: "V", role: "staff", departments: [" "], readDepartments: [""] },
  { as: "O", op: "access", who: "unknown", role: "staff", departments: ["Sales"], readDepartments: [] },
  { as: "O", op: "access", who: "O", role: "staff", departments: ["Sales"], readDepartments: [] },
  { as: "O", op: "access", who: "S", role: "staff", departments: ["Sales", "Sales", " "], readDepartments: ["Finance", "Sales", "HR", "Finance"] },
  { as: "S", op: "can", who: "S", dept: "Sales" },
  { as: "S", op: "can", who: "S", dept: "Finance" },
  { as: "S", op: "can", who: "S", dept: "Warehouse" },
  { as: "O", op: "can", who: "O", dept: "Finance" },
  { as: "V", op: "can", who: "V", dept: "Sales" },
  { as: "V", op: "can", who: "V", dept: "HR" },
  { as: "O", op: "edit", who: "S", role: "manager", departments: ["Warehouse"], disabled: false },
  { as: "S", op: "can", who: "S", dept: "HR" },
  { as: "O", op: "edit", who: "S", role: "manager", departments: ["Finance"], disabled: false, readDepartments: ["Finance", "Legal"] },
  { as: "O", op: "edit", who: "S", role: "manager", departments: [], disabled: false, readDepartments: ["Nope"] },
  { as: "O", op: "edit", who: "S", role: "manager", departments: [], disabled: false, readDepartments: [] },
  { as: "O", op: "edit", who: "S", role: "staff", departments: [], disabled: false, readDepartments: ["Legal"] },
  { as: "S", op: "can", who: "S", dept: "Legal" },
  { as: "S", op: "can", who: "S", dept: "Finance" },
  { as: "O", op: "edit", who: "S", role: "manager", departments: ["Purchasing", "Operations", "Warehouse"], disabled: false, readDepartments: [] },
  { op: "role", who: "S" },
  // support chat
  { as: "V", op: "supportSend", body: "ขอความช่วยเหลือ" },
  { as: "O", op: "supportSend", body: "   " },
  { as: "O", op: "supportSend", body: "  ช่วยด้วย  " },
  { as: "S", op: "supportSend", body: "อีกเรื่อง" },
  { op: "supportReply", name: "", body: "ตอบแล้ว" },
  { op: "supportReply", name: "ส".repeat(120), body: "  " },
  { op: "supportReply", name: "สมชาย", body: "ตอบอีกครั้ง" },
  { as: "V", op: "supportSeen" },
  { as: "O", op: "supportSeen" },
  { op: "supportReply", name: "สมชาย", body: "เรื่องใหม่" },
  // support access
  {
    op: "raw",
    pg: "insert into support_access(id,company_id,user_id,admin_email,reason,expires_at) values($1,$2,$3,'admin@platform.local','ตรวจสอบปัญหาลูกค้า',$4),($5,$6,$3,'admin@platform.local','ตรวจสอบปัญหาลูกค้า',$4)",
    lite: "insert into support_access(id,company_id,user_id,admin_email,reason,expires_at) values(?1,?2,?3,'admin@platform.local','ตรวจสอบปัญหาลูกค้า',?4),(?5,?6,?3,'admin@platform.local','ตรวจสอบปัญหาลูกค้า',?4)",
    params: (id) => [fixed.ACC, id("A1"), users.A.id, iso(3600000), fixed.ACC2, id("B")],
  },
  { op: "role", who: "A" },
  { op: "supportViewer", who: "A" },
  { as: "V", op: "endSupport", ref: "ACC" },
  { as: "O", op: "endSupport", ref: "ACC2" },
  { as: "O", op: "endSupport", ref: "N9" },
  { as: "S", op: "endSupport", ref: "ACC" },
  { as: "O", op: "endSupport", ref: "ACC" },
  { op: "role", who: "A" },
  { op: "supportViewer", who: "A" },
  // presence
  { as: "X", co: "B", op: "presence", companies: [] },
  { as: "O", op: "presence", companies: ["B"] },
  { as: "O", op: "presence", companies: Array.from({ length: 301 }, () => "B") },
  { as: "O", op: "edit", who: "X", role: "staff", departments: ["Sales"], disabled: true },
  { as: "X", op: "presence", companies: [] },
  { op: "role", who: "X" },
  // send_message
  { as: "S", op: "message", department: "Purchasing", body: "  สั่งของแล้ว  " },
  { as: "S", op: "message", department: "Finance", body: "ไม่มีสิทธิ์" },
  { as: "V", op: "message", department: "Sales", body: "ผู้ชม" },
  { as: "S", op: "message", department: "Operations", body: "   " },
  { as: "O", op: "message", department: "Finance", body: "เจ้าของ" },
  // load_sample_data / clear_sample_data
  { as: "S", op: "sample", rows: sample },
  { as: "O", op: "sample", rows: [] },
  { as: "O", op: "sample", rows: { kind: "customers" } },
  { as: "O", op: "sample", rows: [{ id: randomUUID(), kind: "customers", data: { name: "ลูกค้าก่อน", status: "active" } }, { id: randomUUID(), kind: "nope", data: {} }] },
  { as: "O", op: "sample", rows: [{ id: randomUUID(), kind: "customers", data: { name: "ไม่ครบ" } }] },
  { as: "O", op: "sample", rows: [{ id: randomUUID(), kind: "customers", data: { name: "สถานะผิด", status: "x" } }] },
  { as: "O", op: "sample", rows: [{ id: randomUUID(), kind: "invoices", data: { name: "ใบแจ้งหนี้", customerId: randomUUID(), date: today, dueDate: today, subtotal: 10, vat: 7 } }] },
  { as: "O", op: "sample", rows: [{ id: randomUUID(), kind: "invoices", data: { name: "ใบแจ้งหนี้", customerId: "ไม่ใช่ไอดี", date: today, dueDate: today, subtotal: 10, vat: 7 } }] },
  { as: "O", op: "sample", rows: [{ id: randomUUID(), kind: "expenses", data: { name: "วันผิด", category: "ค่าเดินทางและที่พัก", date: "2026-02-30", amount: 1, status: "pending" } }] },
  { as: "O", op: "sample", rows: [{ id: randomUUID(), kind: "expenses", data: { name: "จำนวนผิด", category: "ค่าเดินทางและที่พัก", date: today, amount: "1", status: "pending" } }] },
  {
    as: "O",
    op: "sample",
    rows: [
      { id: P, kind: "products", data: { name: "ไม้อัด", sku: "PLY", unit: "แผ่น", cost: 1, price: 2, reorderLevel: 1, status: "active" }, stock: 5 },
      { id: SI, kind: "stock_issues", data: { name: "เบิกเกิน", productId: P, quantity: 9, requester: "สมชาย", date: today, status: "จ่ายของแล้ว" } },
    ],
  },
  { as: "O", op: "sample", rows: sample },
  { as: "O", op: "sample", rows: sample.slice(0, 2) },
  { as: "O", op: "initStages", ref: "PROJECT" },
  { as: "O", op: "initStages", ref: "N9" },
  { as: "S", op: "clearSample" },
  { as: "O", op: "clearSample" },
  { as: "O", op: "clearSample" },
  // day notes
  { as: "S", op: "note", day: today, body: " งานวันนี้ ", items: [{ text: " โทรหาลูกค้า ", done: true }, { text: "   " }, { text: "ส่งของ" }, { done: true }, { text: "x", done: "yes" }] },
  { as: "S", op: "note", day: "1999-12-31", body: "เก่า", items: [] },
  { as: "S", op: "note", day: "2999-01-01", body: "อนาคต", items: [] },
  { as: "S", op: "note", day: today, body: "ก".repeat(4001), items: [] },
  { as: "S", op: "note", day: today, body: "x", items: { text: "a" } },
  { as: "S", op: "note", day: today, body: "x", items: Array.from({ length: 31 }, () => ({ text: "a" })) },
  { as: "S", op: "note", day: today, body: "x", items: [1] },
  { as: "S", op: "note", day: today, body: "x", items: [{ text: 5 }] },
  { as: "S", op: "note", day: today, body: "x", items: [{ text: null }] },
  { as: "S", op: "note", day: today, body: "x", items: [{ text: "ก".repeat(201) }] },
  { as: "O", op: "note", day: today, body: "ของเจ้าของ", items: null },
  { as: "S", op: "note", day: today, body: "  ", items: [{ text: " " }] },
  { as: "S", op: "note", day: today, body: "อีกครั้ง", items: [] },
  { as: "S", op: "noteDelete", day: today },
  { as: "O", op: "note", day: today, body: "แก้ไข", items: [{ text: "หนึ่ง", done: false }] },
  // dashboard layout
  { as: "S", op: "layout", layout: { a: 1 } },
  { as: "O", op: "layout", layout: [1, 2] },
  { as: "O", op: "layout", layout: bigLayout },
  { as: "O", op: "layout", layout: { widgets: ["sales", "stock"], cols: 3 } },
  // dashboard shares
  { as: "S", op: "share", label: "x", keys: ["sales"], expires: iso(86400000), tag: "SH0" },
  { as: "O", op: "share", label: "x", keys: ["sales"], expires: iso(-1000), tag: "SH0" },
  { as: "O", op: "share", label: "x", keys: ["sales"], expires: iso(400 * 86400000), tag: "SH0" },
  { as: "O", op: "share", label: "x", keys: [], expires: iso(86400000), tag: "SH0" },
  { as: "O", op: "share", label: "ป".repeat(250), keys: ["sales", "stock"], expires: iso(7 * 86400000), tag: "SH1" },
  { as: "O", op: "share", label: null, keys: ["sales"], expires: iso(86400000), tag: "SH2" },
  { as: "S", op: "revoke", ref: "SH1" },
  { as: "O", op: "revoke", ref: "SH1" },
  { as: "O", op: "revoke", ref: "N9" },
  { op: "raw", pg: "insert into share_attempts(token_hash,client_hash,created_at) values('tok1','old',$1)", lite: "insert into share_attempts(token_hash,client_hash,created_at) values('tok1','old',?)", params: () => [iso(-2 * 86400000)] },
  ...Array.from({ length: 5 }, (): Step => ({ op: "failed", token: "tok1", client: "cli1" })),
  { op: "lockout", token: "tok1", client: "cli1" },
  { op: "lockout", token: "tok1", client: "cli2" },
  { op: "lockout", token: "tok2", client: "cli1" },
  // share_metrics
  {
    op: "raw",
    pg: `insert into data_templates(id,company_id,name,department,fields) values($1,$2,'ยอดขายรายวัน','Sales','[{"key":"amount","label":"ยอด","type":"number"},{"key":"kind","label":"ประเภท","type":"choice"},{"key":"note","label":"หมายเหตุ","type":"text"}]')`,
    lite: `insert into data_templates(id,company_id,name,department,fields) values(?,?,'ยอดขายรายวัน','Sales','[{"key":"amount","label":"ยอด","type":"number"},{"key":"kind","label":"ประเภท","type":"choice"},{"key":"note","label":"หมายเหตุ","type":"text"}]')`,
    params: (id) => [fixed.T1, id("A1")],
  },
  ...[
    ["approved", '{"amount":100,"kind":"ปลีก"}'],
    ["approved", '{"amount":50.5,"kind":"ส่ง"}'],
    ["approved", '{"amount":"30","kind":"ปลีก"}'],
    ["approved", '{"kind":7}'],
    ["queued", '{"amount":999,"kind":"ปลีก"}'],
  ].map(
    ([status, values]): Raw => ({
      op: "raw",
      pg: `insert into ingestions(company_id,template,department,status,"values") values($1,$2,'Sales',$3,$4)`,
      lite: `insert into ingestions(company_id,template,department,status,"values") values(?,?,'Sales',?,?)`,
      params: (id) => [id("A1"), JSON.stringify({ id: fixed.T1, name: "ยอดขายรายวัน" }), status, values],
    }),
  ),
  { op: "metrics", keys: [`${fixed.T1}:amount`, `${fixed.T1}:kind`, `${fixed.T1}:note`, "x:y"] },
  { op: "metrics", keys: [] },
  // claim_notifications
  ...(
    [
      ["N1", "queued", 0, -600, null, 0],
      ["N2", "processing", 1, -540, -60, 0],
      ["N3", "processing", 1, -480, 600, 0],
      ["N4", "queued", 0, -420, null, 0],
      ["N5", "queued", 0, -360, null, 0],
      ["N6", "queued", 2, -300, null, 0],
      ["N7", "queued", 0, -240, null, 0],
      ["N8", "queued", 5, -180, null, 0],
      ["N9", "queued", 0, -120, null, 3600],
    ] as const
  ).map(
    ([n, status, attempts, created, lease, next]): Raw => ({
      op: "raw",
      pg: "insert into notification_outbox(id,company_id,target,body,status,attempts,created_at,lease_until,next_at) values($1,$2,'line:U1','สวัสดี',$3,$4,$5,$6,$7)",
      lite: "insert into notification_outbox(id,company_id,target,body,status,attempts,created_at,lease_until,next_at) values(?,?,'line:U1','สวัสดี',?,?,?,?,?)",
      params: (id) => [fixed[n], id("A1"), status, attempts, iso(created * 1000), lease === null ? null : iso(lease * 1000), iso(next * 1000)],
    }),
  ),
  { op: "claim" },
  { op: "claim" },
  { op: "claim" },
];

async function postgres() {
  const db = new PGlite();
  const rows = (Object.values(users) as (typeof users)[Who][]).map((u) => `('${u.id}','${u.email}',${u.name ? `'{"name":"${u.name}"}'` : "'{}'"},${u.confirmed ? "now()" : "null"})`);
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text)returns text[]language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
    insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at)values${rows.join(",")};`);
  for (const f of (await readdir("supabase/migrations")).sort()) await db.exec((await readFile("supabase/migrations/" + f, "utf8")).replace("create extension if not exists pgcrypto;", ""));
  /** As a signed-in person, or (null) as the database owner: what the service role and triggers run as. */
  const login = async (who: Who | null) => {
    await db.exec("reset role;");
    const u = who ? users[who] : null;
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [u?.id ?? "", u?.email ?? ""]);
    if (u) await db.exec("set role authenticated;");
  };
  return { db, login };
}

test("company / members / support / sample data / shares / notes / outbox on D1 match Postgres step for step", async () => {
  const pg = await postgres();
  const lite = new DatabaseSync(":memory:");
  lite.exec(readFileSync("cloudflare/d1/0001_schema.sql", "utf8"));
  await pg.login(null);
  for (const s of (await pg.db.query<Data>("select kind,department,fields from entity_schemas")).rows) lite.prepare("insert into entity_schemas(kind,department,fields) values (?,?,?)").run(s.kind as string, s.department as string, JSON.stringify(s.fields));
  for (const p of (await pg.db.query<Data>("select id,name,monthly::float8 m,yearly::float8 y,workflows,documents,line_groups,users,ordinal from plans")).rows)
    lite.prepare("insert into plans(id,name,monthly,yearly,workflows,documents,line_groups,users,ordinal) values (?,?,?,?,?,?,?,?,?)").run(...(["id", "name", "m", "y", "workflows", "documents", "line_groups", "users", "ordinal"].map((k) => p[k] as string | number | null)));
  lite.exec("delete from trial_limits");
  for (const r of (await pg.db.query<Data>("select resource,amount,label from trial_limits")).rows) lite.prepare("insert into trial_limits(resource,amount,label) values (?,?,?)").run(r.resource as string, r.amount as number, r.label as string);
  const sql = sqliteDriver(lite);

  type Side = "pg" | "d1";
  const ids = { pg: { ...fixed, PROJECT: project } as Record<string, string>, d1: { ...fixed, PROJECT: project } as Record<string, string> };
  for (const [w, u] of Object.entries(users)) (ids.pg[w] = u.id), (ids.d1[w] = u.id);
  const sampleIds = new Set([...sample.map((r) => r.id), P, SI]);
  const label = (side: Side, v: unknown): unknown => {
    if (typeof v === "bigint") return Number(v);
    if (v instanceof Date) return "<ts>";
    if (typeof v === "string") {
      const hit = Object.entries(ids[side]).find(([, id]) => id === v)?.[0];
      if (hit) return "@" + hit;
      if (sampleIds.has(v)) return v;
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return "<ts>";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) return "<uuid>";
      return v.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => (Object.entries(ids[side]).find(([, id]) => id === m)?.[0] ? "@" + Object.entries(ids[side]).find(([, id]) => id === m)![0] : m));
    }
    if (Array.isArray(v)) return v.map((x) => label(side, x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, label(side, x)]));
    return v;
  };
  const co = (side: Side, s: Step) => ids[side][s.co ?? "A1"];
  const signedIn = (w: Who): SignedInUser => ({ userId: users[w].id, email: users[w].email, name: users[w].name, emailConfirmed: users[w].confirmed });
  const viewer = (w: Who, companyId: string): Viewer => {
    const m = lite.prepare("select role, departments, read_departments from memberships where company_id=? and user_id=?").get(companyId, users[w].id) as { role: Role; departments: string; read_departments: string } | undefined;
    return { userId: users[w].id, email: users[w].email, companyId, role: m?.role ?? "viewer", departments: m ? JSON.parse(m.departments) : [], readDepartments: m ? JSON.parse(m.read_departments) : [] };
  };
  const memberId = async (side: Side, w: Who | "unknown", c: string) => {
    if (w === "unknown") return fixed.N9;
    if (side === "pg") {
      await pg.login(null);
      return (await pg.db.query<{ id: string }>("select id from memberships where company_id=$1 and user_id=$2", [c, users[w].id])).rows[0].id;
    }
    return (lite.prepare("select id from memberships where company_id=? and user_id=?").get(c, users[w].id) as { id: string }).id;
  };

  async function onPg(s: Step): Promise<unknown> {
    const c = co("pg", s);
    const q = async <T = Data>(text: string, p: unknown[] = []) => (await pg.db.query<T>(text, p)).rows;
    try {
      if (s.op === "raw") {
        await pg.login(null);
        await q(s.pg, s.params((l) => ids.pg[l]));
        return null;
      }
      if (s.op === "edit") {
        const id = await memberId("pg", s.who, c);
        await pg.login(s.as!);
        if (s.readDepartments === undefined) await q("select edit_member($1,$2,$3,$4,$5)", [c, id, s.role, pgArray(s.departments), s.disabled]);
        else await q("select edit_member($1,$2,$3,$4,$5,$6)", [c, id, s.role, pgArray(s.departments), s.disabled, s.readDepartments && pgArray(s.readDepartments)]);
        return null;
      }
      if (s.op === "access") {
        const id = await memberId("pg", s.who, c);
        await pg.login(s.as!);
        const [m] = await q<Data>("select * from set_member_access($1,$2,$3,$4,$5)", [c, id, s.role, pgArray(s.departments), pgArray(s.readDepartments)]);
        return { id: m.id, user_id: m.user_id, role: m.role, departments: m.departments, read_departments: m.read_departments, disabled: m.disabled };
      }
      if (s.op === "can") {
        await pg.login(s.who);
        return (await q("select can_read_dept($1,$2) as read, can_write_dept($1,$2) as write", [c, s.dept]))[0];
      }
      if (s.op === "deptList") {
        await pg.login(null);
        return (await q<{ r: string[] }>("select dept_list($1::text[]) as r", [pgArray(s.list)]))[0].r;
      }
      if (s.op === "deptNames") {
        await pg.login(null);
        return (await q<{ r: string[] }>("select department_names() as r"))[0].r;
      }
      await pg.login(["supportReply", "failed", "lockout", "metrics", "claim", "initStages", "role", "supportViewer"].includes(s.op) ? null : s.as!);
      switch (s.op) {
        case "create": {
          const [r] = await q<{ id: string }>("select create_company($1) as id", [s.name]);
          ids.pg[s.label] = r.id;
          return "created";
        }
        case "role":
          await pg.login(s.who);
          return (await q<{ r: string | null }>("select member_role($1) as r", [c]))[0].r;
        case "supportViewer":
          await pg.login(s.who);
          return (await q<{ r: boolean }>("select support_viewer($1) as r", [c]))[0].r;
        case "save":
          await q("select save_company($1,$2,$3)", [c, JSON.stringify(s.profile), s.settings ? JSON.stringify(s.settings) : null]);
          return null;
        case "card":
          return (await q<{ r: unknown }>("select company_card($1) as r", [ids.pg[s.ref] ?? fixed.N9]))[0].r;
        case "cover":
          return (await q<{ r: unknown }>("select company_cover($1) as r", [ids.pg[s.ref]]))[0].r;
        case "invite":
          await q("select invite_member($1,$2,$3,$4)", [c, s.email, s.role, pgArray(s.departments)]);
          return null;
        case "accept":
          await q("select accept_invitations()");
          return null;
        case "supportSend":
          return (await q("select * from support_send($1,$2)", [c, s.body]))[0];
        case "supportReply":
          return (await q("select * from support_reply($1,$2,$3)", [c, s.name, s.body]))[0];
        case "supportSeen":
          await q("select support_seen($1)", [c]);
          return null;
        case "endSupport":
          return (await q("select * from end_support_access($1)", [ids.pg[s.ref]]))[0];
        case "presence": {
          const [r] = await q<{ r: { companies: string[]; users: string[] } }>("select presence_ping($1,$2) as r", [c, pgArray(s.companies.map((l) => ids.pg[l]))]);
          return { companies: r.r.companies.map((x) => label("pg", x) as string).sort(), users: r.r.users.map((x) => label("pg", x) as string).sort() };
        }
        case "message":
          return (await q("select * from send_message($1,$2,$3)", [c, s.department, s.body]))[0];
        case "sample":
          return (await q<{ n: number }>("select load_sample_data($1,$2) as n", [c, JSON.stringify(s.rows)]))[0].n;
        case "clearSample":
          return (await q<{ n: number }>("select clear_sample_data($1) as n", [c]))[0].n;
        case "initStages":
          await q("select init_project_stages($1)", [ids.pg[s.ref]]);
          return null;
        case "note":
          return (await q<{ r: unknown }>("select note_save($1,$2,$3,$4) as r", [c, s.day, s.body, s.items === null ? null : JSON.stringify(s.items)]))[0].r;
        case "noteDelete":
          await q("select note_delete($1,$2)", [c, s.day]);
          return null;
        case "layout":
          await q("select save_dashboard_layout($1,$2)", [c, JSON.stringify(s.layout)]);
          return null;
        case "share": {
          const [r] = await q<Data>("select * from create_share($1,$2,$3,$4,$5,$6)", [c, "hash-" + s.tag, null, s.label, pgArray(s.keys), s.expires]);
          ids.pg[s.tag] = r.id as string;
          return r;
        }
        case "revoke":
          await q("select revoke_share($1,$2)", [c, ids.pg[s.ref]]);
          return null;
        case "failed":
          await q("select share_failed($1,$2)", [s.token, s.client]);
          return null;
        case "lockout":
          return (await q<{ r: number }>("select share_lockout($1,$2) as r", [s.token, s.client]))[0].r;
        case "metrics": {
          const [r] = await q<{ r: Data[] }>("select share_metrics($1,$2) as r", [c, pgArray(s.keys)]);
          return [...r.r].sort((a, b) => String(a.key).localeCompare(String(b.key)));
        }
        case "claim":
          return await q("select * from claim_notifications()");
      }
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async function onD1(s: Step): Promise<unknown> {
    const c = co("d1", s);
    const t = () => new Tenant(sql, viewer(s.as!, c));
    try {
      switch (s.op) {
        case "raw": {
          lite.prepare(s.lite).run(...s.params((l) => ids.d1[l]));
          return null;
        }
        case "create": {
          // The seeding finance.ts does (seed_accounts): here copied from what Postgres seeded.
          await pg.login(null);
          const accounts = (await pg.db.query<Data>("select code,name,type,category from accounts where company_id=(select id from companies order by created_at limit 1)")).rows;
          ids.d1[s.label] = await createCompany(sql, signedIn(s.as!), s.name, {
            seedAccounts: (tt) => [...accounts.map((a) => tt.insertStmt("accounts", a)), tt.insertStmt("cost_centers", { code: "HQ", name: "สำนักงานใหญ่", kind: "branch" })],
          });
          return "created";
        }
        case "role":
          return await memberRole(sql, users[s.who].id, c);
        case "supportViewer":
          return await supportViewer(sql, users[s.who].id, c);
        case "save":
          await saveCompany(t(), s.profile, s.settings);
          return null;
        case "card":
          return await companyCard(t(), ids.d1[s.ref] ?? fixed.N9);
        case "cover":
          return await companyCover(t(), ids.d1[s.ref]);
        case "invite":
          await inviteMember(t(), s.email, s.role, s.departments);
          return null;
        case "accept":
          await acceptInvitations(sql, signedIn(s.as!));
          return null;
        case "edit":
          await editMember(t(), await memberId("d1", s.who, c), s.role, s.departments, s.disabled, s.readDepartments ?? null);
          return null;
        case "access": {
          const m = await setMemberAccess(t(), await memberId("d1", s.who, c), s.role, s.departments, s.readDepartments);
          return { id: m.id, user_id: m.user_id, role: m.role, departments: m.departments, read_departments: m.read_departments, disabled: m.disabled };
        }
        case "can": {
          const v = viewer(s.who, c);
          return { read: canReadDept(v, s.dept), write: canWriteDept(v, s.dept) };
        }
        case "deptList":
          return deptList(s.list);
        case "deptNames":
          return departmentNames();
        case "supportSend":
          return await supportSend(t(), s.body);
        case "supportReply":
          return await supportReply(sql, c, s.name, s.body);
        case "supportSeen":
          await supportSeen(t());
          return null;
        case "endSupport":
          return await endSupportAccess(t(), ids.d1[s.ref]);
        case "presence": {
          const r = await presencePing(t(), s.companies.map((l) => ids.d1[l]));
          return { companies: r.companies.map((x) => label("d1", x) as string).sort(), users: r.users.map((x) => label("d1", x) as string).sort() };
        }
        case "message":
          return await sendMessage(t(), s.department, s.body);
        case "sample":
          return await loadSampleData(t(), JSON.parse(JSON.stringify(s.rows)));
        case "clearSample":
          return await clearSampleData(t());
        case "initStages":
          await initProjectStages(t(), ids.d1[s.ref]);
          return null;
        case "note":
          return await noteSave(t(), s.day, s.body, s.items);
        case "noteDelete":
          await noteDelete(t(), s.day);
          return null;
        case "layout":
          await saveDashboardLayout(t(), s.layout);
          return null;
        case "share": {
          const r = await createShare(t(), "hash-" + s.tag, null, s.label, s.keys, s.expires);
          ids.d1[s.tag] = r.id;
          return r;
        }
        case "revoke":
          await revokeShare(t(), ids.d1[s.ref]);
          return null;
        case "failed":
          await shareFailed(sql, s.token, s.client);
          return null;
        case "lockout":
          return await shareLockout(sql, s.token, s.client);
        case "metrics":
          return [...(await shareMetrics(sql, c, s.keys))].sort((a, b) => a.key.localeCompare(b.key));
        case "claim":
          return await claimNotifications(sql);
      }
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  const norm = (side: Side, v: unknown) => JSON.parse(JSON.stringify(label(side, v) ?? null));
  for (const [i, s] of steps.entries()) {
    const a = await onPg(s),
      b = await onD1(s);
    assert.deepEqual(norm("d1", b), norm("pg", a), `step ${i + 1} (${s.as ?? "-"} ${s.op} ${JSON.stringify(s).slice(0, 160)})`);
    if (process.env.SHOW_PARITY) console.log(i + 1, s.as ?? "-", s.op, JSON.stringify(norm("pg", a)).slice(0, 200));
  }

  // What is left behind, table by table.
  await pg.login(null);
  const pgRows = async (q: string) => (await pg.db.query<Data>(q)).rows;
  const liteRows = (q: string) => lite.prepare(q).all() as Data[];
  const same = async (what: string, pgQ: string, liteQ: string, shape: (r: Data) => unknown) => {
    const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Data)[k])])) : v);
    const sort = (side: Side, rows: Data[]) => rows.map((r) => JSON.stringify(canon(norm(side, shape(r))))).sort();
    assert.deepEqual(sort("d1", liteRows(liteQ)), sort("pg", await pgRows(pgQ)), what);
  };
  const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  await same("companies", "select * from companies", "select * from companies", (r) => [r.id, r.name, json(r.profile), json(r.settings)]);
  await same("subscriptions", "select * from subscriptions", "select * from subscriptions", (r) => [r.company_id, r.plan, r.status]);
  await same("memberships", "select * from memberships", "select * from memberships", (r) => [r.company_id, r.user_id, r.name, r.email, r.role, json(r.departments), json(r.read_departments), !!r.disabled, !!r.last_seen_at]);
  await same("invitations", "select * from invitations", "select * from invitations", (r) => [r.company_id, r.email, r.role, json(r.departments), !!r.accepted_at]);
  await same("accounts", "select company_id, count(*)::int n from accounts group by 1", "select company_id, count(*) n from accounts group by 1", (r) => [r.company_id, Number(r.n)]);
  await same("cost_centers", "select * from cost_centers", "select * from cost_centers", (r) => [r.company_id, r.code, r.name, r.kind]);
  await same("audit_events", "select * from audit_events", "select * from audit_events", (r) => [r.company_id, r.actor, r.action, r.target]);
  await same("support_messages", "select * from support_messages", "select * from support_messages", (r) => [r.company_id, r.sender, r.user_id, r.name, r.body]);
  await same("support_threads", "select * from support_threads", "select * from support_threads", (r) => [r.company_id, r.unread_admin, r.unread_customer, r.status]);
  await same("support_access", "select * from support_access", "select * from support_access", (r) => [r.id, !!r.ended_at, r.ended_by]);
  await same("messages", "select * from messages", "select * from messages", (r) => [r.company_id, r.department, r.channel, r.body, r.user_id, r.name]);
  await same(
    "entities",
    "select id,kind,department,data,version,archived_at,created_by from entities",
    "select id,kind,department,data,version,archived_at,created_by from entities",
    (r) => [r.id, r.kind, r.department, json(r.data), Number(r.version), !!r.archived_at, r.created_by],
  );
  await same("stock_movements", "select * from stock_movements", "select * from stock_movements", (r) => [r.product_id, r.type, Number(r.quantity), r.reference, r.notes, r.created_by]);
  await same("project_stages", "select * from project_stages", "select * from project_stages", (r) => [r.project_id, r.key, r.ordinal, r.department, r.label, r.english, r.status, r.version]);
  await same("doc_counters", "select * from doc_counters", "select * from doc_counters", (r) => [r.company_id, r.prefix, r.year, Number(r.last)]);
  await same("user_notes", "select * from user_notes", "select * from user_notes", (r) => [r.user_id, String(r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day), r.body, json(r.items)]);
  await same("dashboard_shares", "select * from dashboard_shares", "select * from dashboard_shares", (r) => [r.token_hash, r.label, json(r.widget_keys), !!r.revoked_at, r.created_by]);
  await same("share_attempts", "select * from share_attempts", "select * from share_attempts", (r) => [r.token_hash, r.client_hash]);
  await same("notification_outbox", "select * from notification_outbox", "select * from notification_outbox", (r) => [r.id, r.status, Number(r.attempts), !!r.lease_until]);
  await pg.db.close();
});
