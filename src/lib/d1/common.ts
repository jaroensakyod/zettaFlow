// Small pieces every D1 port shares: the error with the exact Postgres text, the request clock, Postgres text
// semantics, the tenants of code that runs without a signed-in person, member_role for any company, dept_th and the
// ten project stages. One definition each; the port files import them from here.
import { AppError } from "../domain";
import type { Role } from "../types";
import type { Sql } from "./driver";
import { Tenant } from "./tenant";

export type Data = Record<string, unknown>;

/** raise exception '<message>' — AppError with the exact Postgres text (status for the HTTP answer). */
export const fail = (message: string, status = 400): never => {
  throw new AppError(message, status);
};
/** now(): one ISO timestamp (take it once per call, like Postgres's transaction time). */
export const now = () => new Date().toISOString();

// ---------- Postgres text ----------
/** trim(text): spaces only, not tabs or newlines. */
export const pgTrim = (s: string) => s.replace(/^ +| +$/g, "");
/** length(text): characters, not UTF-16 units. */
export const pgLen = (s: string) => [...s].length;
/** left(text, n): characters, not UTF-16 units. */
export const pgLeft = (s: string, n: number) => [...s].slice(0, n).join("");
/** jsonb ->> key: strings as they are, other JSON values as their JSON text, missing / JSON null as null. */
export const pgText = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v));
/** jsonb_typeof (null for a missing key). */
export const jsonType = (v: unknown): string | null =>
  v === undefined ? null : v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";

const UUID_IN = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;
/** text::uuid, with Postgres's error for anything that is not one (null stays null). */
export function pgUuid(v: string | null): string | null {
  if (v === null) return null;
  if (!UUID_IN.test(v)) fail(`invalid input syntax for type uuid: "${v}"`);
  const h = v.replace(/[{}-]/g, "").toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** text::numeric of a JSON value (null stays null), with Postgres's error for anything else. */
export function pgNum(v: unknown): number | null {
  const s = pgText(v);
  if (s === null) return null;
  const n = Number(s.trim());
  if (s.trim() === "" || Number.isNaN(n)) fail(`invalid input syntax for type numeric: "${s}"`);
  return n;
}
/** round(numeric, d): half away from zero. */
export const pgRound = (n: number, d = 0) => {
  const f = 10 ** d,
    x = Math.round(Math.abs(n) * f + 1e-9) / f;
  return n < 0 ? -x : x;
};

// ---------- tenants without a signed-in person ----------
/**
 * service_role: work Postgres only granted to the service role (platform admin console, cron, outbox worker, share
 * page). auth.uid() is null, nothing is checked by the database, so the caller must have checked who may do this.
 */
export const serviceTenant = (sql: Sql, companyId = "") => new Tenant(sql, { userId: "", email: "", companyId, role: "owner", departments: [] });
/**
 * The LINE webhook and the ingestion worker: auth.uid() is null and member_role() is null, so can_write_dept() and
 * friends say no (unlike serviceTenant, which may write any department).
 */
export const systemTenant = (sql: Sql, companyId = "") => new Tenant(sql, { userId: "", email: "", companyId, role: "viewer", departments: [] });

// ---------- who is asking ----------
/** support_viewer(c) for a user: a platform admin with an open, unexpired support session on the company. */
export async function supportViewerIn(t: Tenant, userId: string, companyId: string, at = now()): Promise<boolean> {
  const rows = await t.selectGlobal<{ expires_at: string }>("support_access", { where: { company_id: companyId, user_id: userId, ended_at: null } });
  return rows.some((r) => Date.parse(r.expires_at) > Date.parse(at));
}
/**
 * member_role(c) for any company: the person's role there (not when disabled), else 'viewer' for a support session,
 * else null. The request's own support view answers 'viewer' straight away.
 */
export async function memberRoleIn(t: Tenant, companyId: string, userId = t.viewer.userId): Promise<Role | null> {
  if (companyId === t.viewer.companyId && userId === t.viewer.userId && t.viewer.support) return "viewer";
  const [m] = await t.selectGlobal<{ role: Role }>("memberships", { where: { company_id: companyId, user_id: userId, disabled: false }, limit: 1 });
  if (m) return m.role;
  return (await supportViewerIn(t, userId, companyId)) ? "viewer" : null;
}

const DEPT_TH: Record<string, string> = {
  Finance: "ฝ่ายบัญชีและการเงิน",
  HR: "ฝ่ายบุคคล",
  Warehouse: "คลังสินค้า",
  Sales: "ฝ่ายขาย",
  Marketing: "การตลาด",
  IT: "ฝ่าย IT",
  Operations: "ฝ่ายปฏิบัติการ",
  Purchasing: "จัดซื้อ",
  Legal: "กฎหมาย",
  Event: "อีเวนต์",
  Admin: "บริหารองค์กร",
  Design: "ออกแบบ",
  "Customer Service": "บริการลูกค้า",
  Data: "ข้อมูล",
  "Business Development": "พัฒนาธุรกิจ",
};
/** dept_th(d): a department's Thai name (the name itself when unknown, '' for null). */
export const deptTh = (d: string | null | undefined): string => (d ? (DEPT_TH[d] ?? d) : "");

/** init_project_stages(): the ten stages every new project starts with. */
export const projectStages: [key: string, ordinal: number, department: string, label: string, english: string][] = [
  ["location", 0, "Business Development", "หา Location", "Location"],
  ["contract", 1, "Legal", "ทำสัญญา", "Contract"],
  ["payment", 2, "Finance", "ชำระเงิน", "Payment"],
  ["layout", 3, "Design", "เขียนแบบ", "Layout"],
  ["procurement", 4, "Purchasing", "จัดซื้อ", "Procurement"],
  ["warehouse", 5, "Warehouse", "คลังสินค้า", "Warehouse"],
  ["setup", 6, "Operations", "เตรียมงาน", "Setup"],
  ["selling", 7, "Sales", "PC ขายของ", "Selling"],
  ["summary", 8, "Marketing", "สรุปผล", "Summary"],
  ["close", 9, "Operations", "ปิดงาน", "Close"],
];
/** The project_stages rows of a project (without company_id: the Tenant adds it, or the caller for another company). */
export const projectStageRows = (projectId: string) => projectStages.map(([key, ordinal, department, label, english]) => ({ project_id: projectId, key, ordinal, department, label, english }));
