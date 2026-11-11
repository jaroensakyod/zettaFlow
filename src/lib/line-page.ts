// หน้า LINE Integration (Canva page 15): one read for the whole page — connected groups with their members,
// senders, approvers and the kinds of data each group produced, the page stats, the LINE package (from the
// billing plan) and the recent activity timeline. Everything is derived from real rows; nothing is invented.
// Pure helpers come first (unit-tested in tests/line-page.test.ts); server modules are loaded lazily so the
// helpers can be imported without Supabase / Next.
import { assert } from "./domain";
import { catalog } from "./catalog";
import { deptThai } from "./line-message";
import { freePlan, plans as allPlans, type Plan } from "./billing";
import type { Context } from "./types";

export type GroupStatus = "connected" | "warn" | "problem" | "test";
export type Person = { name: string; picture: string | null };
export type Approver = { name: string; role: "owner" | "manager"; departments: string[] };
export type PageGroup = {
  group_id: string;
  /** Name in the system (may be empty: then lineName, then a numbered fallback). */
  name: string;
  lineName: string;
  title: string;
  picture: string | null;
  /** Members in the LINE group (LINE API), null when LINE cannot tell. */
  members: number | null;
  department: string | null;
  departmentLabel: string;
  tone: string;
  template_id: string | null;
  templateName: string | null;
  approve_keywords: string[];
  test: boolean;
  found: boolean;
  status: GroupStatus;
  /** Page labels of what this group's messages became (most frequent first). */
  kinds: string[];
  /** People who sent work from this group (most recent first, at most 3 with name/picture). */
  senders: Person[];
  senderCount: number;
  /** Linked LINE accounts allowed to approve in this group (owner, or manager of the group's department). */
  approvers: Approver[];
  /** People who actually approved / rejected items of this group. */
  deciders: string[];
  total: number;
  week: number;
  waiting: number;
  incomplete: number;
  failedWeek: number;
  lastAt: string | null;
  createdAt: string | null;
  /** Lower-case text the client searches (names, LINE name, department). */
  search: string;
};
export type ActivityKind = "paired" | "pulled" | "waiting" | "decided" | "failed";
export type Activity = { at: string; kind: ActivityKind; text: string; group: string | null };
export type PackageTier = { id: string; name: string; range: string; note: string; limit: number | null; current: boolean };
export type LinePackage = {
  planId: string | null;
  planName: string;
  trial: boolean;
  limit: number | null;
  used: number;
  tiers: PackageTier[];
};
export type LineStats = { groups: number; connected: number; pending: number; problems: number; waiting: number };
export type LinePageData = {
  configured: boolean;
  /** Service role available: approvers and pending codes can be read. */
  adminReady: boolean;
  groups: PageGroup[];
  stats: LineStats;
  linked: Approver[];
  activity: Activity[];
  package: LinePackage;
};

/** Colour family of a department chip (matches line.css `.lp-tone-*`). */
const tones: Record<string, string> = {
  Finance: "violet",
  Accounting: "violet",
  Sales: "pink",
  Marketing: "rose",
  Purchasing: "blue",
  Warehouse: "sky",
  Operations: "teal",
  Admin: "slate",
  HR: "amber",
  IT: "indigo",
  Legal: "slate",
  Event: "orange",
  Design: "pink",
  "Customer Service": "teal",
  Data: "indigo",
  "Business Development": "green",
};
export const deptTone = (d: string | null | undefined) => (d ? tones[d] || "violet" : "none");
export const deptLabel = (d: string | null | undefined) => (d ? deptThai[d] || d : "");

/** What a person recognises the group by: its name in the system, else its LINE name. */
export function groupTitle(g: { name?: string | null; lineName?: string | null; test?: boolean }, i: number) {
  return g.name || g.lineName || (g.test ? `กลุ่มทดสอบ ${i + 1}` : `กลุ่ม ${i + 1} (ยังไม่ได้ตั้งชื่อ)`);
}

type Row = {
  group_id: string | null;
  status: string;
  created_at: string;
  source_user?: string | null;
  target_kind?: string | null;
  template?: { name?: string; target_kind?: string | null } | null;
  missing?: unknown;
  raw?: string | null;
  decided_name?: string | null;
  decided_at?: string | null;
};

/** Page labels of the kinds a group's messages became, most frequent first; else the group's own form. */
export function kindsOf(rows: Row[], templateName: string | null, max = 3) {
  const count = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "skipped") continue;
    const kind = r.target_kind || r.template?.target_kind || null;
    const label = (kind && catalog[kind]?.label) || (r.template?.name && r.template.name !== "AI แยกอัตโนมัติ" ? r.template.name : "");
    if (label) count.set(label, (count.get(label) || 0) + 1);
  }
  const list = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  if (!list.length && templateName) list.push(templateName);
  return list.slice(0, max);
}

/** Distinct LINE senders, most recent first (rows must be newest first). */
export function sendersOf(rows: Row[]) {
  const seen: string[] = [];
  for (const r of rows) if (r.source_user && !seen.includes(r.source_user)) seen.push(r.source_user);
  return seen;
}

/**
 * Who may approve in a group (mirrors line_decide in 0034): a linked owner always; a linked manager for items of
 * a department in their departments — so for a department group, managers of that department; for a group with
 * no department, every linked manager (each for their own departments).
 */
export function approversFor(department: string | null, linked: Approver[]) {
  return linked
    .filter((a) => a.role === "owner" || !department || a.departments.includes(department))
    .sort((a, b) => Number(a.role !== "manager") - Number(b.role !== "manager") || a.name.localeCompare(b.name, "th"));
}

export function groupStatus(g: { test: boolean; found: boolean; failedWeek: number }, configured: boolean): GroupStatus {
  if (g.test) return "test";
  if (configured && !g.found) return "problem";
  if (g.failedWeek > 0) return "warn";
  return "connected";
}

export function lineStats(groups: Pick<PageGroup, "status" | "waiting">[], pendingCodes: number): LineStats {
  const real = groups.filter((g) => g.status !== "test");
  return {
    groups: real.length,
    connected: real.filter((g) => g.status === "connected" || g.status === "warn").length,
    pending: pendingCodes,
    problems: real.filter((g) => g.status === "problem" || g.status === "warn").length,
    waiting: groups.reduce((s, g) => s + g.waiting, 0),
  };
}

const bangkokDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);

/** The activity timeline: pairing, new data per group per day, waiting items, decisions and read failures. */
export function buildActivity(groups: { group_id: string; title: string; createdAt: string | null }[], rows: Row[], max = 40): Activity[] {
  const names = new Map(groups.map((g) => [g.group_id, g.title]));
  const out: Activity[] = [];
  for (const g of groups) if (g.createdAt) out.push({ at: g.createdAt, kind: "paired", group: g.group_id, text: `เชื่อมต่อกลุ่ม "${g.title}" สำเร็จ` });
  const buckets = new Map<string, { at: string; n: number; group: string; kind: ActivityKind; who: Set<string>; status?: string }>();
  const add = (key: string, kind: ActivityKind, group: string, at: string, who?: string | null, status?: string) => {
    const b = buckets.get(key) || { at, n: 0, group, kind, who: new Set<string>(), status };
    b.n++;
    if (at > b.at) b.at = at;
    if (who) b.who.add(who);
    buckets.set(key, b);
  };
  for (const r of rows) {
    if (!r.group_id || !names.has(r.group_id)) continue;
    const g = r.group_id;
    if (r.status !== "skipped") add(`p|${g}|${bangkokDay(r.created_at)}`, "pulled", g, r.created_at);
    if (r.status === "review") add(`w|${g}`, "waiting", g, r.created_at);
    if (r.status === "failed") add(`f|${g}|${bangkokDay(r.created_at)}`, "failed", g, r.created_at);
    if (r.decided_at && (r.status === "approved" || r.status === "rejected"))
      add(`d|${g}|${r.status}|${bangkokDay(r.decided_at)}`, "decided", g, r.decided_at, r.decided_name, r.status);
  }
  for (const b of buckets.values()) {
    const name = names.get(b.group)!;
    const who = [...b.who].slice(0, 2).join(", ");
    const text =
      b.kind === "pulled"
        ? `ดึงข้อมูลใหม่จากกลุ่ม "${name}" (${b.n} รายการ)`
        : b.kind === "waiting"
          ? `มีรายการรออนุมัติ ${b.n} รายการ จากกลุ่ม "${name}"`
          : b.kind === "failed"
            ? `อ่านข้อความไม่สำเร็จ ${b.n} รายการ จากกลุ่ม "${name}"`
            : `${b.status === "approved" ? "อนุมัติ" : "ไม่อนุมัติ"} ${b.n} รายการ ในกลุ่ม "${name}"${who ? " โดย " + who : ""}`;
    out.push({ at: b.at, kind: b.kind, group: b.group, text });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

const tierNotes: Record<string, string> = {
  free: "ใช้ฟรีตลอด · บัญชีและการเงิน",
  starter: "สำหรับธุรกิจขนาดเล็ก",
  growth: "สำหรับทีมที่มีหลายแผนก",
  business: "สำหรับบริษัทหลายแผนก หลายสาขา",
  enterprise: "สำหรับองค์กรขนาดใหญ่ / เครือบริษัท",
};
/** The billing plans as LINE packages: each plan's group range follows from the previous plan's ceiling. */
export function packageTiers(plans: Pick<Plan, "id" | "name" | "line_groups">[], current: string | null): PackageTier[] {
  const sorted = [...plans].sort((a, b) => (a.line_groups ?? Infinity) - (b.line_groups ?? Infinity));
  let from = 1;
  return sorted.map((p) => {
    const range = p.line_groups === null ? "ไม่จำกัดกลุ่ม" : from >= p.line_groups ? `${p.line_groups} กลุ่ม` : `${from} – ${p.line_groups} กลุ่ม`;
    if (p.line_groups !== null) from = p.line_groups + 1;
    return { id: p.id, name: p.name, range, note: tierNotes[p.id] || "", limit: p.line_groups, current: p.id === current };
  });
}

// ---------- server ----------

const ttl = 10 * 60000;
const cache = new Map<string, { at: number; value: unknown }>();
async function lineGet<T>(path: string): Promise<T | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T | null;
  const r = await fetch("https://api.line.me/v2/bot/" + path, { signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  const value = r?.ok ? ((await r.json()) as T) : null;
  cache.set(path, { at: Date.now(), value });
  return value;
}
/** Members in a LINE group (free API call), null when LINE cannot tell. */
async function memberCount(groupId: string) {
  const j = await lineGet<{ count?: number }>(`group/${encodeURIComponent(groupId)}/members/count`);
  return typeof j?.count === "number" ? j.count : null;
}
async function memberProfile(groupId: string, userId: string): Promise<Person> {
  const j = await lineGet<{ displayName?: string; pictureUrl?: string }>(`group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`);
  return { name: j?.displayName || "สมาชิกในกลุ่ม", picture: j?.pictureUrl || null };
}

async function linePackage(ctx: Context): Promise<LinePackage> {
  const { billing } = await import("./platform");
  const b = (await billing(ctx).catch(() => null)) as {
    plan?: Plan;
    plans?: Plan[];
    subscription?: { status?: string };
    limits?: { line_groups?: number | null };
    usage?: { line_groups?: number };
  } | null;
  const plan = b?.plan;
  const list = b?.plans || allPlans;
  return {
    planId: plan?.id || null,
    planName: plan?.name || "",
    trial: b?.subscription?.status === "trial",
    // plan_limit(): a trial uses the trial ceiling, a paid plan its own (null = unlimited).
    limit: b?.limits && "line_groups" in b.limits ? (b.limits.line_groups ?? null) : (plan?.line_groups ?? null),
    used: Number(b?.usage?.line_groups || 0),
    tiers: packageTiers([freePlan, ...list.filter((p) => p.id !== "free")], plan?.id || null),
  };
}

export async function linePageData(ctx: Context): Promise<LinePageData> {
  assert(["owner", "manager"].includes(ctx.member.role), "เฉพาะเจ้าของหรือผู้จัดการ", 403);
  const configured = !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const pkg = await linePackage(ctx);
  if (ctx.demo)
    return { configured: false, adminReady: false, groups: [], stats: lineStats([], 0), linked: [], activity: [], package: pkg };
  const [{ supabaseServer, supabaseAdmin }, { dbError }, { lineGroup }] = await Promise.all([import("./supabase/server"), import("./data"), import("./line")]);
  const sb = await supabaseServer();
  const [{ data: groups, error }, { data: rows, error: e2 }, { data: forms }] = await Promise.all([
    sb.from("line_groups").select("*").eq("company_id", ctx.company.id),
    sb
      .from("ingestions")
      .select("group_id, status, missing, created_at, raw, source_user, target_kind, template, decided_name, decided_at")
      .eq("company_id", ctx.company.id)
      .not("group_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(3000),
    sb.from("data_templates").select("id, name").eq("company_id", ctx.company.id),
  ]);
  dbError(error);
  dbError(e2);

  // line_users / other members / pairing codes are not readable with the user's session: read them with the
  // service role, scoped to this company, after the role check above.
  let linked: Approver[] = [],
    pending = 0,
    adminReady = false;
  try {
    const admin = supabaseAdmin();
    const [{ data: links }, { data: members }, { data: codes }] = await Promise.all([
      admin.from("line_users").select("user_id").eq("company_id", ctx.company.id),
      admin.from("memberships").select("user_id, name, email, role, departments, disabled").eq("company_id", ctx.company.id).in("role", ["owner", "manager"]),
      admin
        .from("line_pairings")
        .select("token_hash")
        .eq("company_id", ctx.company.id)
        .is("user_id", null)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString()),
    ]);
    const ids = new Set((links || []).map((l) => String(l.user_id)));
    linked = (members || [])
      .filter((m) => !m.disabled && ids.has(String(m.user_id)))
      .map((m) => ({ name: String(m.name || m.email), role: m.role as Approver["role"], departments: (m.departments as string[]) || [] }));
    pending = (codes || []).length;
    adminReady = true;
  } catch {
    // No service role (local dev): approvers and pending codes stay empty.
  }

  const weekAgo = Date.now() - 7 * 86400000;
  const all = (rows || []) as Row[];
  const list: PageGroup[] = await Promise.all(
    (groups || []).map(async (g, i) => {
      const id = String(g.group_id);
      const mine = all.filter((r) => r.group_id === id);
      const test = id.startsWith("Ce2e"); // scripts/line-e2e.ts groups do not exist in LINE
      const [info, members] = test ? [null, null] : await Promise.all([lineGroup(id), memberCount(id)]);
      const templateName = g.template_id ? String((forms || []).find((f) => f.id === g.template_id)?.name || "ฟอร์ม") : null;
      const users = sendersOf(mine);
      const senders = test ? users.slice(0, 3).map(() => ({ name: "สมาชิกทดสอบ", picture: null })) : await Promise.all(users.slice(0, 3).map((u) => memberProfile(id, u)));
      const department = (g.department as string | null) || null;
      const failedWeek = mine.filter((r) => r.status === "failed" && Date.parse(r.created_at) > weekAgo).length;
      const found = !!info;
      const base = { name: String(g.name || info?.name || ""), lineName: info?.name || "", test };
      const title = groupTitle(base, i);
      return {
        group_id: id,
        ...base,
        title,
        picture: info?.picture || null,
        members,
        department,
        departmentLabel: deptLabel(department),
        tone: deptTone(department),
        template_id: (g.template_id as string | null) || null,
        templateName,
        approve_keywords: (g.approve_keywords as string[]) || [],
        found,
        status: groupStatus({ test, found, failedWeek }, configured),
        kinds: kindsOf(mine, templateName),
        senders,
        senderCount: users.length,
        approvers: approversFor(department, linked),
        deciders: [...new Set(mine.map((r) => r.decided_name).filter((n): n is string => !!n))].slice(0, 5),
        total: mine.length,
        week: mine.filter((r) => Date.parse(r.created_at) > weekAgo).length,
        waiting: mine.filter((r) => r.status === "review").length,
        incomplete: mine.filter((r) => r.status === "review" && Array.isArray(r.missing) && r.missing.length).length,
        failedWeek,
        lastAt: mine[0]?.created_at || null,
        createdAt: (g.created_at as string | null) || null,
        search: [title, base.lineName, deptLabel(department), department || ""].join(" ").toLowerCase(),
      };
    }),
  );
  // Real groups first, most recently active first.
  list.sort((a, b) => Number(a.test) - Number(b.test) || String(b.lastAt || b.createdAt || "").localeCompare(String(a.lastAt || a.createdAt || "")));
  return {
    configured,
    adminReady,
    groups: list,
    stats: lineStats(list, pending),
    linked,
    activity: buildActivity(list, all),
    package: pkg,
  };
}
