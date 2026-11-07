// Home dashboard (design page 16) extras: my diary notes, the month's sales goal, "งานของฉัน" (items I can approve
// or follow), the recent-activity timeline and my avatar. KPI cards and the sales chart are computed on the page from
// GET /home (finance rows), so they need nothing here.
import { z } from "zod";
import { supabaseServer } from "./supabase/server";
import { demoRead, demoMutate, type DemoState } from "./demo";
import { assert, canRead } from "./domain";
import { dbError } from "./data";
import { catalog } from "./catalog";
import type { Context, Entity, Ingestion } from "./types";

export type NoteItem = { text: string; done: boolean };
export type UserNote = { day: string; body: string; items: NoteItem[]; updated_at: string };
export type WorkGroup = "approve" | "review" | "follow";
export type WorkStatus = "pending" | "review" | "follow" | "approved" | "rejected";
export type WorkItem = {
  id: string;
  /** ingestion (LINE item) or an entity kind: leaves, expenses, purchases, tasks */
  source: string;
  group: WorkGroup | "done";
  title: string;
  sub: string;
  requester: string;
  department: string;
  at: string;
  priority: "urgent" | "high" | "normal";
  status: WorkStatus;
  decidedBy?: string | null;
  decidedAt?: string | null;
  /** Workspace view to open. */
  view: string;
};
export type Activity = {
  id: string;
  at: string;
  icon: "created" | "updated" | "approved" | "rejected";
  kind: string;
  text: string;
  by: string;
  department: string;
};
export type HomeExtra = {
  today: string;
  notes: UserNote[];
  goal: { month: string; target: number } | null;
  canSetGoal: boolean;
  work: WorkItem[];
  counts: { all: number; approve: number; review: number; follow: number };
  activity: Activity[];
  avatar: string | null;
};

type HomeDemo = DemoState & {
  homeNotes?: (UserNote & { user_id: string })[];
  monthlyGoals?: { month: string; target: number }[];
};
const BKK = "Asia/Bangkok";
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: BKK });
const approver = (ctx: Context) => ["owner", "manager"].includes(ctx.member.role);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

const noteSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ไม่ถูกต้อง"),
  body: z.string().max(4000, "บันทึกยาวเกิน 4,000 ตัวอักษร").default(""),
  items: z
    .array(z.object({ text: z.string().max(200, "แต่ละรายการไม่เกิน 200 ตัวอักษร"), done: z.boolean().default(false) }))
    .max(30, "รายการสูงสุด 30 ข้อ")
    .default([]),
});
const goalSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "เดือนไม่ถูกต้อง"),
  target: z.number().min(0).max(1e12),
});

/** Does a free-text assignee name mean me? (full name, or the first word of either name) */
function isMe(ctx: Context, name: unknown) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  const mine = [ctx.user.name, ctx.member.name, ctx.user.email]
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean);
  const first = (s: string) => s.split(/\s+/)[0];
  return mine.some((m) => m === n || first(m) === first(n));
}

const pendingStatus: Record<string, string> = { leaves: "pending", expenses: "pending", purchases: "draft" };
const label = (kind: string) => catalog[kind]?.label || kind;
const nameOf = (e: Entity) => String(e.data.name || e.data.code || label(e.kind));

/** Turn the raw rows into "งานของฉัน" items. Pure, so demo and Supabase share it. */
export function buildWork(
  ctx: Context,
  input: {
    ingestions: Ingestion[];
    pending: Entity[];
    tasks: Entity[];
    people: Map<string, string>;
    employees: Map<string, string>;
    projects: Map<string, string>;
    today: string;
  },
): WorkItem[] {
  const can = approver(ctx),
    out: WorkItem[] = [],
    stale = (at: string) => Date.now() - Date.parse(at) > 2 * 864e5;
  for (const i of input.ingestions) {
    const mine = i.created_by === ctx.user.id,
      title = String(i.values?.name || i.values?.title || i.template?.name || "รายการจาก LINE"),
      who = (i as Ingestion & { sender_name?: string | null }).sender_name || (i.created_by && input.people.get(i.created_by)) || i.source;
    const base = {
      id: i.id,
      source: "ingestion",
      title: (i.status === "review" ? "ขออนุมัติ" : "") + title,
      sub: "LINE · " + (i.target_kind ? label(i.target_kind) : i.template?.name || ""),
      requester: who || "LINE",
      department: (i as Ingestion & { department?: string }).department || i.template?.department || "",
      at: i.created_at,
      view: i.target_kind || "ai-inbox",
    };
    if (i.status === "review" && (can || mine))
      out.push({ ...base, group: can ? "approve" : "follow", priority: stale(i.created_at) ? "high" : "normal", status: can ? "pending" : "follow" });
    else if ((i.status === "approved" || i.status === "rejected") && i.decided_at && (can || mine))
      out.push({
        ...base,
        group: "done",
        priority: "normal",
        status: i.status,
        decidedBy: i.decided_name || null,
        decidedAt: i.decided_at,
      });
  }
  for (const e of input.pending) {
    if (e.data.status !== pendingStatus[e.kind]) continue;
    const mine = e.created_by === ctx.user.id;
    if (!can && !mine) continue;
    const d = e.data,
      requester: string =
        (d.employeeId ? input.employees.get(String(d.employeeId)) : "") ||
        String(d.requestor || d.payee || "") ||
        input.people.get(e.created_by) ||
        "—",
      project = d.projectId ? input.projects.get(String(d.projectId)) : "",
      amount = Number(d.total ?? d.amount ?? 0);
    out.push({
      id: e.id,
      source: e.kind,
      group: can ? "approve" : "follow",
      title:
        e.kind === "purchases"
          ? `ขออนุมัติใบสั่งซื้อ (${String(d.poNumber || d.name)})`
          : e.kind === "leaves"
            ? `ขออนุมัติการลา: ${nameOf(e)}`
            : `ขออนุมัติค่าใช้จ่าย: ${nameOf(e)}`,
      sub: project
        ? "โปรเจกต์: " + project
        : amount
          ? "ยอด ฿" + amount.toLocaleString("th-TH", { maximumFractionDigits: 2 })
          : label(e.kind),
      requester,
      department: String(d.department || e.department),
      at: e.created_at,
      priority: d.priority === "urgent" || d.priority === "high" ? (d.priority as "urgent" | "high") : stale(e.created_at) ? "high" : "normal",
      status: can ? "pending" : "follow",
      view: e.kind,
    });
  }
  for (const t of input.tasks) {
    const d = t.data,
      st = String(d.status || "");
    if (st === "done") continue;
    const assigned = isMe(ctx, d.assignee);
    const review = st === "review" && (assigned || can);
    if (!review && !assigned) continue;
    const due = String(d.dueDate || ""),
      project = d.projectId ? input.projects.get(String(d.projectId)) : "";
    out.push({
      id: t.id,
      source: "tasks",
      group: review ? "review" : "follow",
      title: nameOf(t),
      sub: [project ? "โปรเจกต์: " + project : "แผนก: " + String(d.department || t.department), due ? (due < input.today ? "เลยกำหนด " : "ครบกำหนด ") + due : ""]
        .filter(Boolean)
        .join(" · "),
      requester: input.people.get(t.created_by) || String(d.assignee || "—"),
      department: String(d.department || t.department),
      at: t.updated_at,
      priority: d.priority === "urgent" || d.priority === "high" ? (d.priority as "urgent" | "high") : due && due < input.today ? "high" : "normal",
      status: review ? "review" : "follow",
      view: "tasks",
    });
  }
  const rank = { approve: 0, review: 1, follow: 2, done: 3 };
  return out.sort((a, b) => rank[a.group] - rank[b.group] || b.at.localeCompare(a.at)).slice(0, 60);
}

export function buildActivity(
  entities: Entity[],
  ingestions: Ingestion[],
  people: Map<string, string>,
): Activity[] {
  const rows: Activity[] = entities.map((e) => {
    const created = e.version <= 1 || Math.abs(Date.parse(e.updated_at) - Date.parse(e.created_at)) < 60e3,
      status = String(e.data.status || "");
    return {
      id: e.id,
      at: e.updated_at,
      icon: created ? "created" : status === "approved" ? "approved" : status === "rejected" ? "rejected" : "updated",
      kind: e.kind,
      text: (created ? `เพิ่ม${label(e.kind)}ใหม่: ` : `อัปเดต${label(e.kind)}: `) + nameOf(e),
      by: (created && people.get(e.created_by)) || "",
      department: String(e.data.department || e.department),
    };
  });
  for (const i of ingestions)
    if ((i.status === "approved" || i.status === "rejected") && i.decided_at)
      rows.push({
        id: "ing:" + i.id,
        at: i.decided_at,
        icon: i.status,
        kind: i.target_kind || "ai-inbox",
        text: (i.status === "approved" ? "อนุมัติ" : "ไม่อนุมัติ") + " " + String(i.values?.name || i.template?.name || "รายการจาก LINE"),
        by: i.decided_name || "",
        department: i.template?.department || "",
      });
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
}

const count = (work: WorkItem[]) => ({
  all: work.length,
  approve: work.filter((w) => w.group === "approve").length,
  review: work.filter((w) => w.group === "review").length,
  follow: work.filter((w) => w.group === "follow").length,
});

export async function homeExtra(ctx: Context): Promise<HomeExtra> {
  const today = todayIso(),
    month = today.slice(0, 7) + "-01",
    since = new Date(Date.parse(today) - 60 * 864e5).toISOString().slice(0, 10);
  if (ctx.demo) {
    const s = (await demoRead()) as HomeDemo,
      live = s.entities.filter((e) => !e.archived_at && canRead(ctx, e.department)),
      people = new Map(s.members.map((m) => [m.user_id, m.name])),
      employees = new Map(live.filter((e) => e.kind === "employees").map((e) => [e.id, String(e.data.name)])),
      projects = new Map(live.filter((e) => e.kind === "projects").map((e) => [e.id, String(e.data.name)])),
      ingestions = s.ingestions.filter((i) => canRead(ctx, i.template.department));
    const work = buildWork(ctx, {
      ingestions,
      pending: live.filter((e) => e.kind in pendingStatus),
      tasks: live.filter((e) => e.kind === "tasks"),
      people,
      employees,
      projects,
      today,
    });
    const me = live.find(
      (e) => e.kind === "employees" && e.data.photo && String(e.data.email || "").toLowerCase() === ctx.user.email.toLowerCase(),
    );
    const goal = (s.monthlyGoals || []).find((g) => g.month === month);
    return {
      today,
      notes: (s.homeNotes || [])
        .filter((n) => n.user_id === ctx.user.id && n.day >= since)
        .sort((a, b) => b.day.localeCompare(a.day))
        .map(({ day, body, items, updated_at }) => ({ day, body, items, updated_at })),
      goal: goal ? { month: goal.month, target: goal.target } : null,
      canSetGoal: approver(ctx),
      work,
      counts: count(work),
      activity: buildActivity(
        [...live].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 15),
        ingestions,
        people,
      ),
      avatar: me ? String(me.data.photo) : null,
    };
  }
  const sb = await supabaseServer(),
    company = ctx.company.id;
  const [notes, goal, ings, pending, tasks, recent, members, me] = await Promise.all([
    sb.from("user_notes").select("day,body,items,updated_at").eq("company_id", company).eq("user_id", ctx.user.id).gte("day", since).order("day", { ascending: false }).limit(60),
    sb.from("monthly_goals").select("month,sales_target").eq("company_id", company).eq("month", month).maybeSingle(),
    sb
      .from("ingestions")
      .select("id,template,values,status,source,target_kind,department,sender_name,created_by,created_at,decided_name,decided_at")
      .eq("company_id", company)
      .or(`status.eq.review,and(status.in.(approved,rejected),decided_at.gte."${daysAgo(3)}")`)
      .order("created_at", { ascending: false })
      .limit(80),
    sb
      .from("entities")
      .select("*")
      .eq("company_id", company)
      .is("archived_at", null)
      .or("and(kind.in.(leaves,expenses),data->>status.eq.pending),and(kind.eq.purchases,data->>status.eq.draft)")
      .order("created_at", { ascending: false })
      .limit(80),
    sb.from("entities").select("*").eq("company_id", company).is("archived_at", null).eq("kind", "tasks").neq("data->>status", "done").order("updated_at", { ascending: false }).limit(300),
    sb.from("entities").select("*").eq("company_id", company).is("archived_at", null).order("updated_at", { ascending: false }).limit(15),
    // Only the owner can read other members; everyone else gets their own row (names fall back to the department).
    sb.from("memberships").select("user_id,name").eq("company_id", company),
    sb
      .from("entities")
      .select("photo:data->>photo")
      .eq("company_id", company)
      .eq("kind", "employees")
      .is("archived_at", null)
      .ilike("data->>email", ctx.user.email.replace(/[%_\\]/g, "\\$&"))
      .not("data->>photo", "is", null)
      .limit(1),
  ]);
  for (const r of [notes, goal, ings, pending, tasks, recent, members]) dbError(r.error);
  const pend = (pending.data || []) as Entity[],
    taskRows = (tasks.data || []) as Entity[],
    ingRows = (ings.data || []) as unknown as Ingestion[];
  const relIds = (key: string) => [...new Set([...pend, ...taskRows].map((e) => e.data[key]).filter(Boolean).map(String))].slice(0, 100);
  const [emps, projs] = await Promise.all(
    [relIds("employeeId"), relIds("projectId")].map((ids) =>
      ids.length ? sb.from("entities").select("id,name:data->>name").eq("company_id", company).in("id", ids) : Promise.resolve({ data: [], error: null }),
    ),
  );
  const pairs = (rows: unknown) => new Map(((rows || []) as { id: string; name: string }[]).map((r) => [r.id, r.name])),
    people = new Map(((members.data || []) as { user_id: string; name: string }[]).map((m) => [m.user_id, m.name]));
  const work = buildWork(ctx, {
    ingestions: ingRows,
    pending: pend,
    tasks: taskRows,
    people,
    employees: pairs(emps.data),
    projects: pairs(projs.data),
    today,
  });
  const g = goal.data as { month: string; sales_target: number | string } | null;
  return {
    today,
    notes: ((notes.data || []) as UserNote[]).map((n) => ({ ...n, items: Array.isArray(n.items) ? n.items : [] })),
    goal: g ? { month: g.month, target: Number(g.sales_target) } : null,
    canSetGoal: approver(ctx),
    work,
    counts: count(work),
    activity: buildActivity((recent.data || []) as Entity[], ingRows, people),
    avatar: ((me.data || []) as { photo: string | null }[])[0]?.photo || null,
  };
}

export async function saveNote(ctx: Context, input: unknown) {
  const n = noteSchema.parse(input),
    items = n.items.map((i) => ({ text: i.text.trim(), done: i.done })).filter((i) => i.text);
  if (ctx.demo)
    return demoMutate((raw) => {
      const s = raw as HomeDemo,
        list = (s.homeNotes ||= []),
        at = list.findIndex((x) => x.user_id === ctx.user.id && x.day === n.day);
      if (at >= 0) list.splice(at, 1);
      if (!n.body.trim() && !items.length) return null;
      const note = { user_id: ctx.user.id, day: n.day, body: n.body.trim(), items, updated_at: new Date().toISOString() };
      list.push(note);
      return note;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("note_save", {
    p_company: ctx.company.id,
    p_day: n.day,
    p_body: n.body,
    p_items: items,
  });
  dbError(error);
  return data;
}

export async function deleteNote(ctx: Context, day: string) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(day), "วันที่ไม่ถูกต้อง");
  if (ctx.demo)
    return demoMutate((raw) => {
      const s = raw as HomeDemo;
      s.homeNotes = (s.homeNotes || []).filter((x) => !(x.user_id === ctx.user.id && x.day === day));
      return { ok: true };
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("note_delete", { p_company: ctx.company.id, p_day: day });
  dbError(error);
  return { ok: true };
}

export async function setGoal(ctx: Context, input: unknown) {
  assert(approver(ctx), "เฉพาะเจ้าของหรือผู้จัดการตั้งเป้าหมายได้", 403);
  const g = goalSchema.parse(input),
    month = g.month + "-01";
  if (ctx.demo)
    return demoMutate((raw) => {
      const s = raw as HomeDemo;
      s.monthlyGoals = (s.monthlyGoals || []).filter((x) => x.month !== month);
      if (g.target > 0) s.monthlyGoals.push({ month, target: g.target });
      return { ok: true };
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("goal_set", { p_company: ctx.company.id, p_month: month, p_target: g.target });
  dbError(error);
  return { ok: true };
}
