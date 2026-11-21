// Shared pieces of the network port (feed, B2B chat, deal room): Postgres text and number semantics the functions
// rely on (trim only strips spaces, left/length count characters, ->> of a JSON value, numeric/date casts with their
// exact error text, to_char money), the request clock, member_role for any company, and the entities triggers that
// fire when a deal writes records into another company.
import { randomUUID } from "node:crypto";
import { derive, approvalStatuses } from "../dept-rules";
import { beforeEntityInsert, codePrefix } from "./entity-insert";
import { fail, memberRoleIn, projectStageRows } from "./common";
import type { Stmt } from "./driver";
import type { Tenant } from "./tenant";

export { fail };
export type Data = Record<string, unknown>;
export const uuid = () => randomUUID();

// ---------- clock ----------
let last = 0;
/** now() for one call: ISO, and strictly after the previous stamp so rows written by consecutive calls keep their order. */
export function stamp(): string {
  let n = Date.now();
  if (n <= last) n = last + 1;
  last = n;
  return new Date(n).toISOString();
}
const BKK = 7 * 3600000;
/** (now() at time zone 'Asia/Bangkok')::date */
export const bkkDate = (iso: string) => new Date(Date.parse(iso) + BKK).toISOString().slice(0, 10);
/** to_char(now() at time zone 'Asia/Bangkok','YYMM') */
export const bkkYYMM = (iso: string) => {
  const d = bkkDate(iso);
  return d.slice(2, 4) + d.slice(5, 7);
};
/** to_char(ts at time zone 'Asia/Bangkok','DD/MM') */
export const bkkDDMM = (iso: string) => {
  const d = bkkDate(iso);
  return d.slice(8, 10) + "/" + d.slice(5, 7);
};
/** to_char(date,'DD/MM/YYYY') */
export const ddmmyyyy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
export const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const minusDays = (iso: string, n: number) => new Date(Date.parse(iso) - n * 86400000).toISOString();

// ---------- Postgres text ----------
/** trim(): spaces only, like Postgres. */
export const trim = (s: string) => s.replace(/^ +| +$/g, "");
/** left(s, n): characters, not UTF-16 units. */
export const left = (s: string, n: number) => Array.from(s).slice(0, n).join("");
export const len = (s: string) => Array.from(s).length;
/** The text of a JSON value as ->> gives it (null for a missing key or JSON null). */
export function jtext(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return jsonbText(v);
}
/** A JSON value printed the way jsonb::text prints it (keys by length then bytes, ", " and ": "). */
export function jsonbText(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(jsonbText).join(", ") + "]";
  if (typeof v === "object") {
    const keys = Object.keys(v as Data).filter((k) => (v as Data)[k] !== undefined);
    keys.sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return "{" + keys.map((k) => JSON.stringify(k) + ": " + jsonbText((v as Data)[k])).join(", ") + "}";
  }
  return JSON.stringify(v);
}
export const jsonbType = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v === "string" ? "string" : typeof v === "number" ? "number" : "boolean");
/** x ilike pattern (% and _ wildcards, \ escapes). */
export function ilike(text: string | null, pattern: string): boolean {
  if (text === null) return false;
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") re += "[\\s\\S]*";
    else if (c === "_") re += "[\\s\\S]";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$", "iu").test(text);
}
/** Plain text order (C collation), nulls last — ORDER BY x. */
export const textOrder = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

// ---------- Postgres numbers and dates ----------
/** text::numeric (null stays null). */
export function numeric(text: string | null): number | null {
  if (text === null) return null;
  if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(text)) fail(`invalid input syntax for type numeric: "${text}"`);
  return Number(text);
}
/** text::date (null stays null), as YYYY-MM-DD. */
export function date(text: string | null): string | null {
  if (text === null) return null;
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(text);
  if (!m) return fail(`invalid input syntax for type date: "${text}"`);
  const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) fail(`date/time field value out of range: "${text}"`);
  return d;
}
/** text::int (rounds a numeric text like Postgres). */
export const int = (text: string | null) => {
  const n = numeric(text);
  return n === null ? null : Math.sign(n) * Math.round(Math.abs(n));
};
/** Float noise off: what Postgres's exact numeric would have printed. */
export const fix = (x: number) => (Number.isFinite(x) ? Number.parseFloat(x.toPrecision(15)) : x);
/** round(x, 2): half away from zero. */
export const round2 = (x: number) => fix(Math.sign(x) * Number(Math.round(Number(fix(Math.abs(x)) + "e2")) + "e-2"));
/** to_char(x,'FM999,999,999,990.00') */
export const money = (x: number) => {
  const [i, f] = round2(Math.abs(x)).toFixed(2).split(".");
  return (x < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + f;
};
/** jsonb_strip_nulls: drops null fields of every object, recursively (null array elements stay). */
export function stripNulls<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : stripNulls(x))) as T;
  if (v && typeof v === "object") {
    const out: Data = {};
    for (const [k, x] of Object.entries(v as Data)) if (x !== null && x !== undefined) out[k] = stripNulls(x);
    return out as T;
  }
  return v;
}
/** a || b || c with Postgres null propagation: any null part makes the whole text null. */
export const cat = (...parts: (string | number | null | undefined)[]): string | null => (parts.some((p) => p === null || p === undefined) ? null : parts.join(""));
/** nullif(x, '') */
export const nullif = (s: string | null) => (s === "" ? null : s);

// ---------- who is asking ----------
/** member_role(c) for any company (common.ts): the person's role there, 'viewer' for a support view, else null. */
export const memberRole = (t: Tenant, companyId: string): Promise<string | null> => memberRoleIn(t, companyId);
/** The request company's member_role (always the viewer's, read from memberships like Postgres). */
export const myRole = (t: Tenant) => memberRole(t, t.viewer.companyId);
/** feed_author(c): the person's name in the company, or their email. */
export async function feedAuthor(t: Tenant, companyId = t.viewer.companyId): Promise<string | null> {
  const [m] = await t.selectGlobal<{ name: string; email: string }>("memberships", { where: { company_id: companyId, user_id: t.viewer.userId, disabled: false }, limit: 1 });
  return m ? m.name || m.email : null;
}

// ---------- entities written into a company (the deal room's records) ----------
const thaiYear = (iso: string) => (Number(bkkDate(iso).slice(0, 4)) + 543) % 100;

/**
 * INSERT INTO entities for any company, with what its triggers do on insert (entity-insert.ts): entities_code (a
 * running code from that company's counter, taken inside the same batch: Tenant.nextNumberIntoStmts),
 * entities_dept_rules (approval statuses need that company's owner or manager; derived fields), create_project_stages.
 * (purchase_figures / stock effect / item files do nothing for the kinds the deal room writes.)
 */
export async function insertEntityStmts(t: Tenant, row: { id: string; company_id: string; kind: string; department: string; data: Data; created_by?: string | null }, now: string): Promise<Stmt[]> {
  const { data, deferredCode } = await beforeEntityInsert(row.kind, row.data, {
    takeCode: async () => null,
    docCode: async (ing) => (await t.selectGlobal<{ doc_code: string | null }>("ingestions", { where: { id: ing, company_id: row.company_id } }))[0]?.doc_code ?? null,
    approverRole: () => memberRole(t, row.company_id),
  });
  const stmts: Stmt[] = [t.insertGlobalStmt("entities", { ...row, data, created_by: row.created_by ?? null, created_at: now, updated_at: now })];
  // take_code(): PREFIX-yy-nnnn
  if (deferredCode) stmts.push(...t.nextNumberIntoStmts(row.company_id, deferredCode, 0, { table: "entities", id: row.id, key: "data.code", text: `${deferredCode}-${String(thaiYear(now)).padStart(2, "0")}-` }));
  if (row.kind === "projects") for (const r of projectStageRows(row.id)) stmts.push(t.insertGlobalStmt("project_stages", { ...r, company_id: row.company_id, updated_at: now }));
  return stmts;
}
type Ent = { id: string; company_id: string; kind: string; data: Data; version: number };
/**
 * b2b_set_entity(id, patch): data = data || patch on any company's record, version + 1, with the BEFORE update triggers
 * (the code kept, approval statuses, derived fields). A missing record is left alone. Several patches to one record
 * in a call are merged here (the caller passes them in order).
 */
export async function setEntityStmts(t: Tenant, id: string, patch: Data, now: string): Promise<Stmt[]> {
  const [e] = await t.selectGlobal<Ent>("entities", { where: { id } });
  if (!e) return [];
  let data = { ...e.data, ...patch };
  const s = jtext(data.status);
  if (s !== null && approvalStatuses[e.kind]?.includes(s) && jtext(e.data.status) !== s) {
    const role = await memberRole(t, e.company_id);
    if (role !== null && !["owner", "manager"].includes(role)) fail("ต้องให้ Owner หรือ Manager เป็นผู้อนุมัติสถานะนี้");
  }
  if (codePrefix[e.kind] && (jtext(data.code) ?? "") === "" && (jtext(e.data.code) ?? "") !== "") data = { ...data, code: e.data.code };
  data = { ...data, ...derive(e.kind, data) };
  return [t.guardGlobalStmt("entities", { id, version: e.version }), t.updateGlobalStmt("entities", { id }, { data, version: e.version + 1, updated_at: now })];
}
