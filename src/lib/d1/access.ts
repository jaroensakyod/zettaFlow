// Who may read which rows: the 65 row-level security policies of the Supabase schema, written out per table for D1
// (SQLite has no RLS). Each rule returns a WHERE fragment over the table aliased "t". One difference by design: where
// Postgres allowed any company the person belongs to, these allow only the company of the current request, which is
// what every page asks for anyway. A table missing here cannot be read through the scoped layer at all.
import type { SqlValue } from "./driver";
import type { Role } from "../types";

export type Viewer = {
  userId: string;
  email: string;
  /** The company of this request. */
  companyId: string;
  role: Role;
  /** ใช้งาน departments: read and write. */
  departments: string[];
  /** ดู departments (memberships.read_departments, 0085): read only, never writes. */
  readDepartments?: string[];
  /** A platform admin looking read-only (ดูในมุมมองลูกค้า): reads every department, writes nothing. */
  support?: boolean;
};
export type Where = { sql: string; params: SqlValue[] };
type Rule = (v: Viewer, now: string) => Where;

/** can_read_dept(c, d): the owner, a department in either list, or an open support view. */
export const canReadDept = (v: Viewer, d: string) => v.role === "owner" || !!v.support || v.departments.includes(d) || !!v.readDepartments?.includes(d);
/** can_write_dept(c, d): never a viewer or a support view; the owner or a ใช้งาน department (read_departments do not count). */
export const canWriteDept = (v: Viewer, d: string) => !v.support && v.role !== "viewer" && (v.role === "owner" || v.departments.includes(d));
/** Every department the person reads (departments ∪ read_departments). */
const readable = (v: Viewer) => JSON.stringify([...v.departments, ...(v.readDepartments ?? [])]);

const all: Rule = () => ({ sql: "1", params: [] });
const company = (v: Viewer, extra?: Where): Where => ({ sql: `t.company_id = ?${extra ? ` AND (${extra.sql})` : ""}`, params: [v.companyId, ...(extra?.params || [])] });
const yes = { sql: "1", params: [] },
  no = { sql: "0", params: [] };
const member: Rule = (v) => company(v);
const owner: Rule = (v) => company(v, v.role === "owner" ? yes : no);
const ownerManager: Rule = (v) => company(v, v.role === "owner" || v.role === "manager" ? yes : no);
/** can_read_dept(company_id, '<fixed>') */
const dept =
  (d: string): Rule =>
  (v) =>
    company(v, canReadDept(v, d) ? yes : no);
/** can_read_dept(company_id, department): the row's own department. */
const deptColumn: Rule = (v) => (canReadDept(v, "*") ? company(v) : company(v, { sql: `t.department IN (SELECT value FROM json_each(?))`, params: [readable(v)] }));
const projectAlive = (col: string) => `EXISTS (SELECT 1 FROM entities e WHERE e.id = t.${col} AND e.company_id = t.company_id AND e.archived_at IS NULL)`;
const and = (a: Where, sql: string): Where => ({ sql: `(${a.sql}) AND ${sql}`, params: a.params });

export const readRules: Record<string, Rule> = {
  // Shared catalogues and public content.
  ad_packages: all,
  addons: all,
  coin_packs: all,
  entity_schemas: all,
  free_limits: all,
  plans: all,
  trial_limits: all,
  post_comments: all,
  modules: () => ({ sql: "t.active = 1", params: [] }),
  shop_items: () => ({ sql: "t.active = 1", params: [] }),
  announcements: (_v, now) => ({ sql: "t.active = 1 AND t.published_at <= ? AND (t.expires_at IS NULL OR t.expires_at > ?)", params: [now, now] }),
  promos: (_v, now) => ({ sql: "t.active = 1 AND t.starts_at <= ? AND (t.ends_at IS NULL OR t.ends_at > ?)", params: [now, now] }),
  company_posts: () => ({ sql: "t.archived_at IS NULL", params: [] }),

  // The company itself and what any member sees.
  companies: (v) => ({ sql: "t.id = ?", params: [v.companyId] }),
  company_follows: (v) => ({ sql: "t.follower_id = ?", params: [v.companyId] }),
  coin_wallets: member,
  company_modules: member,
  company_shop_items: member,
  company_shop_settings: member,
  cost_centers: member,
  feed_ads: member,
  monthly_goals: member,
  subscriptions: member,

  // Owner only / owner and managers.
  audit_events: owner,
  billing_payments: owner,
  coin_topups: owner,
  dashboard_shares: owner,
  line_groups: owner,
  notification_outbox: owner,
  coin_ledger: ownerManager,
  support_messages: ownerManager,
  support_threads: ownerManager,

  // By department.
  accounts: dept("Finance"),
  finance_budgets: dept("Finance"),
  finance_closing: dept("Finance"),
  finance_targets: dept("Finance"),
  journal_entries: dept("Finance"),
  payment_slips: dept("Finance"),
  wht_certificates: dept("Finance"),
  stock_movements: dept("Warehouse"),
  attachments: deptColumn,
  data_templates: deptColumn,
  ingestions: deptColumn,
  messages: deptColumn,
  // Branches are shown to every member; other records by their department.
  entities: (v) => (canReadDept(v, "*") ? company(v) : company(v, { sql: `t.kind = 'branches' OR t.department IN (SELECT value FROM json_each(?))`, params: [readable(v)] })),
  design_revisions: (v) => and(dept("Design")(v, ""), projectAlive("project_id")),
  project_inventory: (v) => and(dept("Warehouse")(v, ""), projectAlive("project_id")),
  project_stages: (v) => and(deptColumn(v, ""), projectAlive("project_id")),
  project_stage_history: (v) => and(deptColumn(v, ""), projectAlive("project_id")),
  stock_transfers: (v) =>
    and(
      dept("Warehouse")(v, ""),
      "(t.from_project IS NULL OR EXISTS (SELECT 1 FROM entities e WHERE e.id = t.from_project AND e.company_id = t.company_id)) AND (t.to_project IS NULL OR EXISTS (SELECT 1 FROM entities e WHERE e.id = t.to_project AND e.company_id = t.company_id))",
    ),
  design_comments: (v) => {
    const r = canReadDept(v, "Design");
    return {
      sql: `EXISTS (SELECT 1 FROM design_revisions r WHERE r.id = t.revision_id AND r.company_id = ? AND ${r ? "1" : "0"} AND EXISTS (SELECT 1 FROM entities e WHERE e.id = r.project_id AND e.company_id = r.company_id AND e.archived_at IS NULL))`,
      params: [v.companyId],
    };
  },
  journal_lines: (v) => ({ sql: `EXISTS (SELECT 1 FROM journal_entries j WHERE j.id = t.entry_id AND j.company_id = ? AND ${canReadDept(v, "Finance") ? "1" : "0"})`, params: [v.companyId] }),
  line_group_approvers: (v) => ({ sql: "EXISTS (SELECT 1 FROM line_groups g WHERE g.group_id = t.group_id AND g.company_id = ?)", params: [v.companyId] }),
  post_proposals: (v) => ({ sql: "t.company_id = ? OR EXISTS (SELECT 1 FROM company_posts p WHERE p.id = t.post_id AND p.company_id = ?)", params: [v.companyId, v.companyId] }),

  // RLS on and select granted, but no policy: a signed-in person reads no rows (no error); only the service role does.
  line_users: () => no,

  // Rows about the person themself.
  memberships: (v) => ({ sql: `t.user_id = ? OR (t.company_id = ? AND ${v.role === "owner" ? "1" : "0"})`, params: [v.userId, v.companyId] }),
  invitations: (v) => ({ sql: `(t.company_id = ? AND ${v.role === "owner" ? "1" : "0"}) OR t.email = ?`, params: [v.companyId, v.email.toLowerCase()] }),
  user_notes: (v) => ({ sql: "t.user_id = ? AND t.company_id = ?", params: [v.userId, v.companyId] }),
  support_access: (v) => company(v, v.role === "owner" || v.role === "manager" ? (v.support ? no : yes) : no),
};
