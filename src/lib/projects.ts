// โครงการ (Projects) pages: one call for the list (cards, timeline, calendar, report) and one for a project's
// detail page. Figures come from the records that point at the project (projectId) — sales, expenses, invoices,
// tasks, events, documents — plus the project's stages; nothing is made up, an empty project shows zeros.
import { z } from "zod";
import type { Attachment, Context, Entity, ProjectStage, StageHistory } from "./types";
import { assert, canRead } from "./domain";
import { allEntities, dbError } from "./data";
import { catalog } from "./catalog";
import { expenseCalc } from "./tax";
import { projectWorkflow, referenceImages } from "./zetta";
import { demoRead } from "./demo";
import { supabaseServer } from "./supabase/server";
import { stageData } from "./project-stages";
import { files } from "./files";

// ---------------------------------------------------------------- pure helpers (unit tested)

export type StageStatus = ProjectStage["status"];
export type StageLite = { key: string; label: string; status: StageStatus; ordinal: number };
/** How much of a stage counts toward the project's progress. */
const stageCredit: Record<StageStatus, number> = { pending: 0, progress: 0.5, review: 0.8, done: 1 };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v) || 0;

/** Stage-based progress (0–100), or null while no stage has started (new projects start with every stage pending). */
export function stageProgress(stages: { status: StageStatus }[]): number | null {
  if (!stages.length || stages.every((s) => s.status === "pending")) return null;
  return Math.round((stages.reduce((s, x) => s + stageCredit[x.status], 0) / stages.length) * 100);
}

/** Progress from the project's status and dates when its stages are not in use. */
export function statusProgress(status: string, start: unknown, end: unknown, today: string): number {
  if (status === "completed") return 100;
  if (status === "planning" || status === "cancelled" || !status) return 0;
  if (status === "review") return 90;
  // active / paused: the share of the planned period that has passed (never shown as finished).
  const a = Date.parse(String(start || "")),
    b = Date.parse(String(end || "")),
    t = Date.parse(today);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return clamp(Math.round(((t - a) / (b - a)) * 100), 0, 95);
}

export function projectProgress(status: string, stages: { status: StageStatus }[], start: unknown, end: unknown, today: string) {
  if (status === "completed") return { percent: 100, source: "status" as const };
  const fromStages = stageProgress(stages);
  return fromStages === null
    ? { percent: statusProgress(status, start, end, today), source: "status" as const }
    : { percent: fromStages, source: "stages" as const };
}

/** The stage being worked on: the first one in progress / review, else the first pending one after work began. */
export function currentStage<T extends { status: StageStatus; ordinal: number }>(stages: T[]): T | null {
  const sorted = [...stages].sort((a, b) => a.ordinal - b.ordinal);
  if (!sorted.length || sorted.every((s) => s.status === "pending")) return null;
  return (
    sorted.find((s) => s.status === "progress" || s.status === "review") ||
    sorted.find((s) => s.status === "pending") ||
    sorted[sorted.length - 1]
  );
}

/** Stage counts by status, as shares of all stages (for the progress donut). */
export function stageBreakdown(stages: { status: StageStatus }[]) {
  const total = stages.length || 1;
  return (["done", "review", "progress", "pending"] as StageStatus[]).map((status) => {
    const count = stages.filter((s) => s.status === status).length;
    return { status, count, percent: Math.round((count / total) * 100) };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Team member ids saved as comma separated text (the `team` field). */
export function teamIds(value: unknown): string[] {
  return [...new Set(String(value || "").split(/[\s,]+/).filter((s) => UUID.test(s)).map((s) => s.toLowerCase()))];
}

/** Counts for the five tiles: ทั้งหมด / กำลังดำเนินการ (planning, active, review) / เสร็จสิ้น / พักชั่วคราว / ยกเลิก. */
export function statusCounts(statuses: string[]) {
  return {
    all: statuses.length,
    active: statuses.filter((s) => s === "planning" || s === "active" || s === "review").length,
    completed: statuses.filter((s) => s === "completed").length,
    paused: statuses.filter((s) => s === "paused").length,
    cancelled: statuses.filter((s) => s === "cancelled").length,
  };
}

/** A sale that counts toward the project's figures (drafts and cancelled ones do not). */
export const countsAsSale = (d: Record<string, unknown>) => d.status !== "draft" && d.status !== "cancelled";
/** An expense that counts toward project cost (rejected ones do not). */
export const countsAsExpense = (d: Record<string, unknown>) => d.status !== "rejected";

const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export type SeriesMode = "month" | "quarter" | "year";
export type SeriesPoint = { key: string; label: string; sales: number; expenses: number };
/** Sales and expenses per month (last 6), quarter (last 4) or year (last 3), oldest first. */
export function periodSeries(
  sales: { date: string; amount: number }[],
  expenses: { date: string; amount: number }[],
  mode: SeriesMode,
  today: string,
): SeriesPoint[] {
  const y = Number(today.slice(0, 4)),
    m = Number(today.slice(5, 7)) - 1;
  const keys: { key: string; label: string }[] = [];
  if (mode === "month")
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - i, 1)),
        yy = d.getUTCFullYear(),
        mm = d.getUTCMonth();
      keys.push({ key: `${yy}-${String(mm + 1).padStart(2, "0")}`, label: `${thaiMonths[mm]} ${String((yy + 543) % 100).padStart(2, "0")}` });
    }
  else if (mode === "quarter") {
    const q = Math.floor(m / 3);
    for (let i = 3; i >= 0; i--) {
      const idx = y * 4 + q - i,
        yy = Math.floor(idx / 4),
        qq = idx % 4;
      keys.push({ key: `${yy}-Q${qq + 1}`, label: `Q${qq + 1}/${String((yy + 543) % 100).padStart(2, "0")}` });
    }
  } else for (let i = 2; i >= 0; i--) keys.push({ key: String(y - i), label: String(y - i + 543) });
  const keyOf = (date: string) => {
    const yy = date.slice(0, 4),
      mm = Number(date.slice(5, 7));
    return mode === "month" ? date.slice(0, 7) : mode === "quarter" ? `${yy}-Q${Math.floor((mm - 1) / 3) + 1}` : yy;
  };
  const points = keys.map((k) => ({ ...k, sales: 0, expenses: 0 }));
  const byKey = new Map(points.map((p) => [p.key, p]));
  for (const s of sales) {
    const p = byKey.get(keyOf(String(s.date || "")));
    if (p) p.sales = round2(p.sales + num(s.amount));
  }
  for (const e of expenses) {
    const p = byKey.get(keyOf(String(e.date || "")));
    if (p) p.expenses = round2(p.expenses + num(e.amount));
  }
  return points;
}

/** The employee a free-text owner / assignee name refers to (full name or nickname). */
export function matchPerson<T extends { name: string; nickname?: string }>(name: unknown, people: T[]): T | undefined {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return undefined;
  return (
    people.find((p) => p.name.toLowerCase() === n || (p.nickname || "").toLowerCase() === n) ||
    people.find((p) => n.length >= 3 && (p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase())))
  );
}

/** Next free PRJ-### code from the codes already used. */
export function nextProjectCode(codes: unknown[]) {
  const max = codes.reduce<number>((m, c) => {
    const hit = /^PRJ-(\d+)$/i.exec(String(c || "").trim());
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return "PRJ-" + String(max + 1).padStart(3, "0");
}

// ---------------------------------------------------------------- server aggregation

export type Person = { id: string | null; name: string; nickname?: string; position: string; department: string; photo: string | null };
export type ProjectCard = {
  id: string;
  version: number;
  department: string;
  created_at: string;
  updated_at: string;
  data: Record<string, unknown>;
  name: string;
  subtitle: string;
  code: string;
  status: string;
  startDate: string;
  endDate: string;
  /** Attachment id of the cover photo. */
  cover: string | null;
  /** Sample picture for demo projects without a cover. */
  sample: string | null;
  owner: Person | null;
  team: Person[];
  stageLabel: string | null;
  progress: number;
  progressSource: "stages" | "status";
  budget: number;
  salesTarget: number;
  sales: number;
  expenses: number;
};
export type CalendarItem = { id: string; projectId: string; kind: "event" | "task"; name: string; date: string; endDate: string; place: string; status: string };
export type ActivityItem = { id: string; kind: "stage" | "file" | "document" | "sale" | "task" | "project"; title: string; detail: string; at: string };
export type DocItem = { id: string; name: string; mime: string; size: number; at: string; href: string | null; category: string };
export type LiteRow = { id: string; name: string; date: string; amount: number; status: string; extra: string };

const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
/** Records of a related kind, or none when this user cannot read that department (tasks / documents / events carry their own). */
const related = (ctx: Context, kind: string) =>
  canRead(ctx, catalog[kind].department) || ["tasks", "documents", "events"].includes(kind)
    ? allEntities(ctx, kind, 5000)
    : Promise.resolve([] as Entity[]);

const personOf = (e: Entity): Person => ({
  id: e.id,
  name: String(e.data.name || ""),
  nickname: e.data.nickname ? String(e.data.nickname) : undefined,
  position: String(e.data.position || ""),
  department: String(e.data.department || ""),
  photo: e.data.photo ? String(e.data.photo) : null,
});
const namedPerson = (name: string): Person => ({ id: null, name, position: "", department: "", photo: null });

type StageRow = StageLite & { project_id: string };
async function allStages(ctx: Context): Promise<StageRow[]> {
  if (ctx.demo) return ((await demoRead()).stages || []).filter((s) => s.company_id === ctx.company.id);
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("project_stages")
    .select("project_id,key,label,status,ordinal")
    .eq("company_id", ctx.company.id)
    .limit(20000);
  dbError(error);
  return (data || []) as StageRow[];
}

function stageLabelOf(status: string, stage: { label: string } | null) {
  if (stage) return stage.label;
  return (
    { planning: "วางแผนงาน", active: "ดำเนินการ", review: "ตรวจสอบ / สรุปผล", paused: "พักโครงการ", completed: "เสร็จสิ้น", cancelled: "ยกเลิกโครงการ" }[status] ||
    null
  );
}

function buildCard(
  ctx: Context,
  p: Entity,
  stages: StageLite[],
  people: Person[],
  sales: number,
  expenses: number,
  assignees: string[],
  dealTarget: number,
  now: string,
): ProjectCard {
  const d = p.data,
    status = String(d.status || "planning");
  const progress = projectProgress(status, stages, d.startDate, d.endDate, now);
  const owner = d.owner ? matchPerson(d.owner, people) || namedPerson(String(d.owner)) : null;
  // Team: members picked on the form, else the people the project's tasks are assigned to.
  const picked = teamIds(d.team)
    .map((id) => people.find((x) => x.id === id))
    .filter((x): x is Person => !!x);
  const fromTasks = assignees.map((n) => matchPerson(n, people) || namedPerson(n));
  const team: Person[] = [];
  for (const x of picked.length ? picked : fromTasks)
    if (!team.some((t) => t.name === x.name) && x.name !== owner?.name) team.push(x);
  const stage = currentStage(stages);
  return {
    id: p.id,
    version: p.version,
    department: p.department,
    created_at: p.created_at,
    updated_at: p.updated_at,
    data: d,
    name: String(d.name || ""),
    subtitle: String(d.subtitle || d.description || ""),
    code: String(d.code || ""),
    status,
    startDate: String(d.startDate || ""),
    endDate: String(d.endDate || ""),
    cover: d.cover ? String(d.cover) : null,
    sample: ctx.demo && !d.cover ? referenceImages(String(d.name || ""))?.location || null : null,
    owner,
    team,
    stageLabel: stageLabelOf(status, stage),
    progress: progress.percent,
    progressSource: progress.source,
    budget: num(d.budget),
    // The project's own target, else the sales targets of its deals (พื้นที่ขาย & ดีล).
    salesTarget: num(d.salesTarget) || dealTarget,
    sales,
    expenses,
  };
}

async function gather(ctx: Context) {
  assert(canRead(ctx, catalog.projects.department), "ไม่มีสิทธิ์ดูโครงการ", 403);
  const [projects, sales, expenses, tasks, events, employees, deals, stages] = await Promise.all([
    allEntities(ctx, "projects", 2000),
    related(ctx, "sales"),
    related(ctx, "expenses"),
    related(ctx, "tasks"),
    related(ctx, "events"),
    related(ctx, "employees"),
    related(ctx, "deals"),
    allStages(ctx),
  ]);
  return { projects, sales, expenses, tasks, events, deals, people: employees.map(personOf), stages };
}

const sumBy = (rows: Entity[], keep: (d: Record<string, unknown>) => boolean, value: (d: Record<string, unknown>) => number) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const id = String(r.data.projectId || "");
    if (id && keep(r.data)) m.set(id, round2((m.get(id) || 0) + value(r.data)));
  }
  return m;
};
const expenseAmount = (d: Record<string, unknown>) => expenseCalc(d).gross;

function cardsFor(ctx: Context, c: Awaited<ReturnType<typeof gather>>, now: string, only?: string) {
  const salesBy = sumBy(c.sales, countsAsSale, (d) => num(d.amount)),
    costBy = sumBy(c.expenses, countsAsExpense, expenseAmount),
    dealBy = sumBy(c.deals, (d) => !["rejected", "cancelled"].includes(String(d.status)), (d) => num(d.targetSales));
  return c.projects
    .filter((p) => !only || p.id === only)
    .map((p) => {
      const stages = c.stages.filter((s) => s.project_id === p.id);
      const assignees = [
        ...new Set(c.tasks.filter((t) => t.data.projectId === p.id && t.data.assignee).map((t) => String(t.data.assignee))),
      ];
      return buildCard(ctx, p, stages, c.people, salesBy.get(p.id) || 0, costBy.get(p.id) || 0, assignees, dealBy.get(p.id) || 0, now);
    });
}

/** Everything the project list needs: cards, counts, people for the team picker and dated items for the calendar. */
export async function projectsOverview(ctx: Context) {
  const now = today(),
    c = await gather(ctx);
  const projects = cardsFor(ctx, c, now);
  const ids = new Set(projects.map((p) => p.id));
  const calendar: CalendarItem[] = [
    ...c.events
      .filter((e) => ids.has(String(e.data.projectId || "")) && e.data.startDate)
      .map((e) => ({
        id: e.id,
        projectId: String(e.data.projectId),
        kind: "event" as const,
        name: String(e.data.name || ""),
        date: String(e.data.startDate),
        endDate: String(e.data.endDate || e.data.startDate),
        place: String(e.data.location || ""),
        status: String(e.data.status || ""),
      })),
    ...c.tasks
      .filter((t) => ids.has(String(t.data.projectId || "")) && t.data.dueDate)
      .map((t) => ({
        id: t.id,
        projectId: String(t.data.projectId),
        kind: "task" as const,
        name: String(t.data.name || ""),
        date: String(t.data.dueDate),
        endDate: String(t.data.dueDate),
        place: String(t.data.assignee || ""),
        status: String(t.data.status || ""),
      })),
  ];
  return {
    today: now,
    projects,
    counts: statusCounts(projects.map((p) => p.status)),
    people: c.people,
    calendar,
    nextCode: nextProjectCode(projects.map((p) => p.code)),
  };
}

const projectIdSchema = z.uuid();

/** One project's detail page: the card figures plus stages, sales series, finance, work, documents and activity. */
export async function projectDetail(ctx: Context, id: string) {
  const projectId = projectIdSchema.parse(id),
    now = today(),
    c = await gather(ctx);
  const [project] = cardsFor(ctx, c, now, projectId);
  assert(project, "ไม่พบโครงการ", 404);
  const of = (rows: Entity[]) => rows.filter((r) => r.data.projectId === projectId);
  const [invoices, documents, attachments, stageInfo] = await Promise.all([
    related(ctx, "invoices").then(of),
    related(ctx, "documents").then(of),
    files(ctx, projectId).catch(() => [] as Attachment[]),
    stageData(ctx, projectId)
      .then((s) => s as { stages: ProjectStage[]; history: StageHistory[] })
      .catch(() => ({ stages: [] as ProjectStage[], history: [] as StageHistory[] })),
  ]);
  const sales = of(c.sales).filter((s) => countsAsSale(s.data)),
    expenses = of(c.expenses).filter((e) => countsAsExpense(e.data)),
    tasks = of(c.tasks),
    events = of(c.events);
  const salePoints = sales.map((s) => ({ date: String(s.data.date || ""), amount: num(s.data.amount) })),
    costPoints = expenses.map((e) => ({ date: String(e.data.date || ""), amount: expenseAmount(e.data) }));
  const invoiced = round2(invoices.reduce((s, i) => s + num(i.data.total), 0)),
    received = round2(invoices.reduce((s, i) => s + num(i.data.paid), 0));
  const customers = new Set(
    [...sales, ...invoices].map((r) => String(r.data.customerId || "")).filter(Boolean),
  ).size;
  const doneTasks = tasks.filter((t) => t.data.status === "done").length;

  const upcoming: CalendarItem[] = [
    ...events
      .filter((e) => String(e.data.endDate || e.data.startDate || "") >= now && !["cancelled", "completed"].includes(String(e.data.status)))
      .map((e) => ({
        id: e.id, projectId, kind: "event" as const, name: String(e.data.name || ""),
        date: String(e.data.startDate || now), endDate: String(e.data.endDate || e.data.startDate || now),
        place: String(e.data.location || ""), status: String(e.data.status || ""),
      })),
    ...tasks
      .filter((t) => t.data.dueDate && String(t.data.dueDate) >= now && t.data.status !== "done")
      .map((t) => ({
        id: t.id, projectId, kind: "task" as const, name: String(t.data.name || ""),
        date: String(t.data.dueDate), endDate: String(t.data.dueDate),
        place: String(t.data.assignee || ""), status: String(t.data.status || ""),
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const stageName = (key: string) => projectWorkflow.find((s) => s.key === key)?.label || key;
  const stageWord: Record<StageStatus, string> = { pending: "รอดำเนินการ", progress: "กำลังดำเนินการ", review: "รออนุมัติ", done: "เสร็จแล้ว" };
  const activity: ActivityItem[] = [
    ...stageInfo.history.map((h) => ({
      id: "h" + h.id, kind: "stage" as const, title: "อัปเดตสถานะโครงการ",
      detail: `ขั้นตอน "${stageName(h.key)}" เป็น "${stageWord[h.status]}"`, at: h.created_at,
    })),
    ...attachments.map((a) => ({ id: "f" + a.id, kind: "file" as const, title: "เพิ่มเอกสาร", detail: a.name, at: a.created_at })),
    ...documents.map((d) => ({ id: "d" + d.id, kind: "document" as const, title: "เพิ่มเอกสาร", detail: String(d.data.name || ""), at: d.created_at })),
    ...sales.map((s) => ({
      id: "s" + s.id, kind: "sale" as const, title: "ยอดขายเพิ่มขึ้น",
      detail: "+ " + num(s.data.amount).toLocaleString("th-TH", { maximumFractionDigits: 2 }) + " บาท", at: s.created_at,
    })),
    ...tasks
      .filter((t) => t.data.status === "done")
      .map((t) => ({ id: "t" + t.id, kind: "task" as const, title: "งานเสร็จแล้ว", detail: String(t.data.name || ""), at: t.updated_at })),
    { id: "p-new" + project.id, kind: "project" as const, title: "สร้างโครงการ", detail: project.name, at: project.created_at },
    ...(project.updated_at !== project.created_at
      ? [{ id: "p-up" + project.id, kind: "project" as const, title: "แก้ไขข้อมูลโครงการ", detail: project.name, at: project.updated_at }]
      : []),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 60);

  const docs: DocItem[] = [
    ...attachments.map((a) => ({
      id: a.id, name: a.name, mime: a.mime, size: a.size, at: a.created_at, href: "/api/files/" + a.id, category: "ไฟล์แนบ",
    })),
    ...documents.map((d) => ({
      id: d.id, name: String(d.data.name || ""), mime: "", size: 0, at: d.created_at, href: null, category: String(d.data.category || ""),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const lite = (rows: Entity[], date: string, amount: (d: Record<string, unknown>) => number, extra: (d: Record<string, unknown>) => string): LiteRow[] =>
    rows
      .map((r) => ({ id: r.id, name: String(r.data.name || ""), date: String(r.data[date] || ""), amount: amount(r.data), status: String(r.data.status || ""), extra: extra(r.data) }))
      .sort((a, b) => b.date.localeCompare(a.date));

  const totalSales = round2(salePoints.reduce((s, x) => s + x.amount, 0)),
    totalCost = round2(costPoints.reduce((s, x) => s + x.amount, 0));
  return {
    today: now,
    project,
    stages: stageInfo.stages,
    history: stageInfo.history,
    series: {
      month: periodSeries(salePoints, costPoints, "month", now),
      quarter: periodSeries(salePoints, costPoints, "quarter", now),
      year: periodSeries(salePoints, costPoints, "year", now),
    },
    totals: { sales: totalSales, expenses: totalCost, profit: round2(totalSales - totalCost), invoiced, received, outstanding: round2(invoiced - received) },
    goals: {
      sales: { value: totalSales, target: project.salesTarget },
      customers: { value: customers, target: num(project.data.customerTarget) },
      tasks: { value: doneTasks, target: tasks.length },
    },
    tasks: lite(tasks, "dueDate", () => 0, (d) => String(d.assignee || "")),
    events: lite(events, "startDate", (d) => num(d.budget), (d) => String(d.location || "")),
    sales: lite(sales, "date", (d) => num(d.amount), (d) => String(d.channel || "")).slice(0, 50),
    expenses: lite(expenses, "date", expenseAmount, (d) => String(d.category || "")).slice(0, 50),
    invoices: lite(invoices, "date", (d) => num(d.total), (d) => String(d.dueDate || "")),
    upcoming,
    activity,
    documents: docs,
    people: c.people,
  };
}
export type ProjectsOverview = Awaited<ReturnType<typeof projectsOverview>>;
export type ProjectDetailData = Awaited<ReturnType<typeof projectDetail>>;
