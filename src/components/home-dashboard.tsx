"use client";
// Home (ภาพรวม) — design page 16: greeting + 6 KPI cards, calendar & today's agenda, my diary, sales overview,
// งานของฉัน (items to approve / review / follow), alerts, recent activity and this month's sales goal.
// Finance rows and tasks come from GET /home; notes, goal, my work, activity and avatar from GET /home/extra.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarOff,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Clock,
  Coins,
  Droplet,
  Ellipsis,
  FileText,
  Flag,
  Flame,
  Handshake,
  History,
  Hourglass,
  Info,
  Layers,
  ListChecks,
  ListTodo,
  MessageSquareText,
  NotebookPen,
  Pencil,
  Percent,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  Target,
  Trash2,
  TriangleAlert,
  UserPlus,
  X,
  ChartColumn,
  Bell,
  CircleAlert,
  Eye,
  EyeOff,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Context, Entity, HomeData } from "@/lib/types";
import type { HomeExtra, NoteItem, UserNote, WorkItem, Activity } from "@/lib/home-extra";
import { api, money, Loading, Modal } from "./shared";
import { WidgetBoard } from "./platform";
import { HelloAd } from "./hello-ad";
import { homeSample, homeIsEmpty } from "@/lib/mock/home";
import { isCostCategory } from "@/lib/expense-categories";

/** True while the dashboard shows the sample ("ตัวอย่าง") dataset: cards get a badge and every write is disabled. */
const SampleCtx = createContext(false);
const useSample = () => useContext(SampleCtx);
function SampleBadge() {
  return useSample() ? <span className="sample-badge hd-sample-badge">ตัวอย่าง</span> : null;
}

const BKK = "Asia/Bangkok";
export const deptLabels: Record<string, string> = {
  Operations: "ปฏิบัติการ",
  "Business Development": "พัฒนาธุรกิจ",
  Design: "ออกแบบ",
  Purchasing: "จัดซื้อ",
  Warehouse: "สต็อก",
  Sales: "ฝ่ายขาย",
  Finance: "บัญชี",
  Marketing: "Marketing",
  HR: "HR",
  IT: "IT",
  "Customer Service": "Customer Service",
  Legal: "กฎหมาย",
  Data: "DATA",
};
const kindLabels: Record<string, string> = {
  tasks: "งาน",
  events: "อีเวนต์",
  deals: "ดีล",
  projects: "โครงการ",
};
const weekdays = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const quotes = [
  "จัดการงาน วันนี้ให้สำเร็จ แล้วไปต่อกับเป้าหมายใหญ่กันค่ะ",
  "ทีละก้าวเล็ก ๆ คือทางไปสู่ความสำเร็จที่ยิ่งใหญ่",
  "โฟกัสสิ่งที่สำคัญที่สุดก่อน แล้ววันนี้จะเบาลง",
  "ทุกตัวเลขที่ดีขึ้น เริ่มจากการลงมือวันนี้",
  "วางแผนให้ชัด ลงมือให้ไว แล้วผลลัพธ์จะตามมา",
  "ความสม่ำเสมอชนะทุกอย่าง สู้ ๆ นะคะ",
  "วันนี้คือโอกาสใหม่ที่จะทำให้ดีกว่าเมื่อวาน",
];

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: BKK });
const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
const monthDays = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const thai = (s: string, o: Intl.DateTimeFormatOptions) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("th-TH", { ...o, timeZone: "UTC" });
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BKK,
  }) + " น.";
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: BKK });
const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return Math.round(n / 1e3) + "K";
  return String(Math.round(n));
};
const niceMax = (n: number) => {
  if (n <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / (step / 2)) * (step / 2);
};
const greeting = () => {
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: BKK })) % 24;
  return hour < 12 ? "สวัสดีตอนเช้า" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
};
const tones = ["#7c5cf0", "#f08a5c", "#3b9bf0", "#2fb37a", "#e85d9b", "#e0a92e"];
const toneOf = (s: string) => tones[[...s].reduce((h, c) => h + c.charCodeAt(0), 0) % tones.length];
const initial = (s: string) => (s.trim()[0] || "?").toUpperCase();
// Range of an entry on the calendar: events and projects span days, tasks sit on their due date.
const entrySpan = (e: Entity) => {
  const d = e.data,
    start = String(d.startDate || d.dueDate || d.date || ""),
    end = String(d.endDate || start);
  return [start, end < start ? start : end];
};
const entryTime = (e: Entity) => String(e.data.startTime || e.data.time || "").slice(0, 5);

type Summary = {
  pendingDeals: number;
  lowStock: Entity[];
  widgets?: { key: string; name: string; label: string; total: number; count: number }[];
};
type Navigate = (v: string) => void;

export function HomeDashboard({
  ctx,
  summary,
  navigate,
  notify,
  refreshKey,
}: {
  ctx: Context;
  summary: Summary;
  navigate: Navigate;
  notify: (s: string) => void;
  refreshKey: number;
}) {
  const [home, setHome] = useState<HomeData | null>(null),
    [extra, setExtra] = useState<HomeExtra | null>(null),
    [upcoming, setUpcoming] = useState<Entity[]>([]),
    [error, setError] = useState(""),
    [workFilter, setWorkFilter] = useState<"all" | "approve" | "review" | "follow">("all"),
    [calKey, setCalKey] = useState(0),
    // The calendar's day and period (วัน / สัปดาห์ / เดือน / ปี): every overview card totals that period.
    [period, setPeriod] = useState<Period>("month"),
    [picked, setPicked] = useState(todayIso),
    // "auto" = show the sample only while the company has nothing of its own here; "on" / "off" = the user's choice.
    [sampleMode, setSampleMode] = useState<"auto" | "on" | "off">("auto");
  const today = todayIso(),
    tomorrow = addDays(today, 1);
  const realEmpty = !!home && !!extra && homeIsEmpty(home, extra),
    // Samples only in the public demo; a real company sees its own data or empty states.
    sample = ctx.demo && (sampleMode === "on" || (sampleMode === "auto" && realEmpty)),
    demo = useMemo(() => homeSample(today), [today]);
  // Never mix: in sample mode every card reads the sample set only.
  const vHome = sample ? demo.home : home,
    vExtra = sample ? demo.extra : extra,
    vSummary = sample ? demo.summary : summary,
    vUpcoming = sample ? demo.calendar : upcoming;
  const loadExtra = useCallback(
    () =>
      api("/home/extra")
        .then((d: HomeExtra) => setExtra(d))
        .catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => {
    let live = true;
    api("/home")
      .then((d) => live && (setHome(d), setError("")))
      .catch((e) => live && setError((e as Error).message));
    api("/home/extra")
      .then((d) => live && setExtra(d))
      .catch((e) => live && setError((e as Error).message));
    api("/calendar?month=" + tomorrow.slice(0, 7))
      .then((rows: Entity[]) => live && setUpcoming(rows))
      .catch(() => live && setUpcoming([]));
    return () => {
      live = false;
    };
  }, [refreshKey, tomorrow, calKey]);
  const firstName = ctx.user.name.trim().split(/\s+/)[0] || ctx.user.name;
  const showWork = (f: "approve" | "review" | "follow") => {
    setWorkFilter(f);
    document.getElementById("hd-work")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <SampleCtx.Provider value={sample}>
    <div className={"hd" + (sample ? " hd-is-sample" : "")}>
      {sample && (
        <div className="hd-sample-banner" role="status">
          <Sparkles size={18} />
          <p>
            <b>กำลังดูตัวอย่าง</b> — ข้อมูลสมมติเพื่อให้เห็นหน้าตาเมื่อมีข้อมูลจริง
            {realEmpty ? " (ยังไม่มีงาน ยอดขาย บันทึก หรือรายการรออนุมัติของบริษัท ตัวอย่างจะหายไปเองเมื่อมีข้อมูลจริง)" : ""}
          </p>
          <div>
            <button className="secondary" onClick={() => setSampleMode("off")}>
              <EyeOff size={15} />
              {realEmpty ? "เริ่มใช้งานจริง" : "ปิดตัวอย่าง"}
            </button>
          </div>
        </div>
      )}
      {error && !sample && <p className="form-error">{error}</p>}
      <div className="hd-top">
        <Hello
          name={firstName}
          today={today}
          avatar={sample ? null : extra?.avatar || null}
          ad={<HelloAd demo={!!ctx.demo} />}
          action={
            ctx.demo && <button className={"hd-sample-toggle" + (sample ? " on" : "")} aria-pressed={sample} onClick={() => setSampleMode(sample ? "off" : "on")}>
              {sample ? <EyeOff size={14} /> : <Eye size={14} />}
              {sample ? "ปิดตัวอย่าง" : "ดูตัวอย่าง"}
            </button>
          }
        />
        {vHome ? (
          <Kpis
            home={vHome}
            today={today}
            period={period}
            day={picked}
            navigate={navigate}
            sampleRows={sample ? demo.home.finance : undefined}
            refreshKey={refreshKey}
          />
        ) : (
          <section className="hd-card hd-kpis-loading">
            <Loading />
          </section>
        )}
      </div>
      <div className="hd-mid">
        <CalendarCard
          ctx={ctx}
          today={today}
          navigate={navigate}
          notify={notify}
          onAdded={() => setCalKey((k) => k + 1)}
          refreshKey={refreshKey + calKey}
          sampleEntries={sample ? demo.calendar : undefined}
          period={period}
          setPeriod={setPeriod}
          selected={picked}
          setSelected={setPicked}
        />
        <Diary today={today} extra={vExtra} notify={notify} reload={loadExtra} />
        {vHome ? (
          <SalesCard today={today} home={vHome} />
        ) : (
          <section className="hd-card">
            <Loading />
          </section>
        )}
        <MyWork extra={vExtra} filter={workFilter} setFilter={setWorkFilter} navigate={navigate} />
      </div>
      <div className="hd-bottom">
        <Alerts
          today={today}
          tomorrow={tomorrow}
          summary={vSummary}
          tasks={vHome?.tasks || []}
          upcoming={vUpcoming}
          approvals={
            sample ? demo.extra.work.filter((w) => w.group === "approve" && w.status === "pending").length : extra?.counts.approve || 0
          }
          navigate={navigate}
          showWork={showWork}
        />
        <ActivityCard activity={vExtra?.activity || null} today={today} navigate={navigate} />
        <GoalCard today={today} home={vHome} extra={vExtra} notify={notify} reload={loadExtra} />
      </div>
      {/* Owners reorder, hide and set per-role visibility here, and share the board by link (real data only). */}
      {!sample && (
        <div className="elite-zone">
          <WidgetBoard ctx={ctx} notify={notify} />
        </div>
      )}
    </div>
    </SampleCtx.Provider>
  );
}

/* ---------- greeting ---------- */
function Hello({ name, today, avatar, action, ad }: { name: string; today: string; avatar: string | null; action?: React.ReactNode; ad?: React.ReactNode }) {
  const quote = quotes[Math.floor(Date.parse(today) / 864e5) % quotes.length];
  return (
    <section className="hd-card hd-hello">
      <div className="hd-avatar-ring">
        {avatar ? (
          <img className="hd-avatar" src={"/api/files/" + avatar} alt="" />
        ) : (
          <svg className="hd-avatar" viewBox="0 0 80 80" aria-hidden="true">
            <defs>
              <linearGradient id="hd-av-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#efe8ff" />
                <stop offset="1" stopColor="#ffe6f1" />
              </linearGradient>
              <linearGradient id="hd-av-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#8b6cf5" />
                <stop offset="1" stopColor="#6a4bdb" />
              </linearGradient>
            </defs>
            <circle cx="40" cy="40" r="40" fill="url(#hd-av-bg)" />
            <path d="M14 80c2-16 13-24 26-24s24 8 26 24z" fill="url(#hd-av-body)" />
            <circle cx="40" cy="34" r="15" fill="#ffd9c2" />
            <text x="40" y="76" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff">
              {initial(name)}
            </text>
          </svg>
        )}
      </div>
      <div className="hd-hello-text">
        <h1>
          {greeting()}, คุณ {name} <span aria-hidden="true">👋</span>
        </h1>
        <p className="hd-hello-date">
          {thai(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
        <p className="hd-hello-quote">“{quote}”</p>
        {action && <div className="hd-hello-actions">{action}<SampleBadge /></div>}
      </div>
      {ad}
    </section>
  );
}

/* ---------- KPI cards ---------- */
function Spark({ values, color }: { values: number[]; color: string }) {
  const v = values.length > 1 ? values : [values[0] || 0, values[0] || 0],
    min = Math.min(...v),
    max = Math.max(...v),
    span = max - min || 1,
    pts = v.map((y, i) => [(i / (v.length - 1)) * 100, 28 - ((y - min) / span) * 24]),
    line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
    id = "hd-sp-" + color.slice(1);
  return (
    <svg className="hd-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${line} 100,30`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
type Kpi = {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  color: string;
  change?: { text: string; up: boolean; good: boolean } | null;
  note?: string;
  spark?: number[];
  view: string;
  /** Second figure under the main one (the profit card shows the margin here). */
  extra?: React.ReactNode;
};
const periodNames: Record<Period, string> = { day: "วัน", week: "สัปดาห์", month: "เดือน", year: "ปี" };
/** The day, week (Sunday to Saturday), month or year that `day` falls in. */
function periodRange(period: Period, day: string) {
  if (period === "day") return { from: day, to: day };
  if (period === "week") {
    const from = addDays(day, -new Date(day + "T00:00:00Z").getUTCDay());
    return { from, to: addDays(from, 6) };
  }
  if (period === "month") return { from: day.slice(0, 8) + "01", to: day.slice(0, 8) + monthDays(day.slice(0, 7)) };
  return { from: day.slice(0, 4) + "-01-01", to: day.slice(0, 4) + "-12-31" };
}
/** A day in the period before. */
const periodBefore = (period: Period, from: string) =>
  period === "day" ? addDays(from, -1) : period === "week" ? addDays(from, -7) : period === "month" ? shiftMonth(from.slice(0, 7), -1) + "-01" : Number(from.slice(0, 4)) - 1 + "-01-01";
/** "9–15 พ.ย. 2569", "พฤศจิกายน 2569", "ปี 2569"… */
function periodText(period: Period, from: string, to: string) {
  if (period === "day") return thai(from, { day: "numeric", month: "short", year: "numeric" });
  if (period === "week")
    return from.slice(0, 7) === to.slice(0, 7)
      ? `${Number(from.slice(8))}–${thai(to, { day: "numeric", month: "short", year: "numeric" })}`
      : `${thai(from, { day: "numeric", month: "short" })} – ${thai(to, { day: "numeric", month: "short", year: "numeric" })}`;
  if (period === "month") return thai(from, { month: "long", year: "numeric" });
  return "ปี " + (Number(from.slice(0, 4)) + 543);
}
/** What the cards compare with: a period still running is compared up to the same point of the one before. */
function periodWindow(period: Period, day: string, today: string) {
  const { from, to } = periodRange(period, day),
    running = from <= today && today <= to,
    end = running ? today : to,
    prev = periodRange(period, periodBefore(period, from)),
    prevTo = running ? [addDays(prev.from, dayDiff(end, from)), prev.to].sort()[0] : prev.to;
  return { from, to, end, prevFrom: prev.from, prevTo, running };
}
function financeKpis(rows: HomeData["finance"], period: Period, w: ReturnType<typeof periodWindow>) {
  const part = (r: HomeData["finance"][number]) => (r.kind === "sales" ? "sales" : isCostCategory(r.category) ? "cost" : "expense"),
    total = (a: string, b: string) => {
      const t = { sales: 0, cost: 0, expense: 0 };
      for (const r of rows) if (r.date >= a && r.date <= b) t[part(r)] += r.amount;
      return t;
    },
    profitOf = (t: { sales: number; cost: number; expense: number }) => t.sales - t.cost - t.expense,
    marginOf = (t: { sales: number; cost: number; expense: number }) => (t.sales ? (profitOf(t) / t.sales) * 100 : 0);
  // Whole period for the figures; the same stretch of the period before for the change.
  const cur = total(w.from, w.to),
    now = total(w.from, w.end),
    old = total(w.prevFrom, w.prevTo);
  // Running totals for the sparklines: by day, or by month for a year.
  const series = { sales: [] as number[], cost: [] as number[], expense: [] as number[], profit: [] as number[], margin: [] as number[] };
  const steps: [string, string][] = [];
  if (period === "year")
    for (let m = 1; m <= 12; m++) {
      const mm = w.from.slice(0, 5) + String(m).padStart(2, "0");
      if (mm + "-01" > w.end) break;
      steps.push([mm + "-01", mm + "-" + monthDays(mm)]);
    }
  else if (period !== "day") for (let d = w.from; d <= w.end; d = addDays(d, 1)) steps.push([d, d]);
  const run = { sales: 0, cost: 0, expense: 0 };
  for (const [a, b] of steps) {
    const t = total(a, b);
    run.sales += t.sales;
    run.cost += t.cost;
    run.expense += t.expense;
    series.sales.push(run.sales);
    series.cost.push(run.cost);
    series.expense.push(run.expense);
    series.profit.push(profitOf(run));
    series.margin.push(marginOf(run));
  }
  const pct = (x: number, y: number, upIsGood = true) => {
    if (!y) return null;
    const p = ((x - y) / Math.abs(y)) * 100;
    return { text: Math.abs(p).toFixed(1) + "%", up: p >= 0, good: p >= 0 === upIsGood };
  };
  const mDiff = marginOf(now) - marginOf(old);
  return {
    cur,
    profit: profitOf(cur),
    margin: marginOf(cur),
    series: steps.length > 1 ? series : null,
    change: {
      cost: pct(now.cost, old.cost, false),
      expense: pct(now.expense, old.expense, false),
      sales: pct(now.sales, old.sales),
      profit: pct(profitOf(now), profitOf(old)),
      margin: old.sales ? { text: Math.abs(mDiff).toFixed(1) + " จุด", up: mDiff >= 0, good: mDiff >= 0 } : null,
    },
  };
}
function Kpis({
  home,
  today,
  period,
  day,
  navigate,
  sampleRows,
  refreshKey,
}: {
  home: HomeData;
  today: string;
  period: Period;
  /** Any day of the period to show (the day picked on the calendar). */
  day: string;
  navigate: Navigate;
  /** Sample mode: these rows instead of GET /home/finance. */
  sampleRows?: HomeData["finance"];
  refreshKey: number;
}) {
  const sample = useSample(),
    w = useMemo(() => periodWindow(period, day, today), [period, day, today]),
    [fetched, setFetched] = useState<{ key: string; rows: HomeData["finance"] } | null>(null),
    key = w.prevFrom + "|" + w.to;
  useEffect(() => {
    if (sampleRows) return;
    let live = true;
    api(`/home/finance?from=${w.prevFrom}&to=${w.to}`)
      .then((rows: HomeData["finance"]) => live && setFetched({ key, rows }))
      .catch(() => live && setFetched({ key, rows: [] }));
    return () => {
      live = false;
    };
  }, [key, w.prevFrom, w.to, sampleRows, refreshKey]);
  const rows = sampleRows || fetched?.rows || [],
    loading = !sampleRows && fetched?.key !== key,
    f = useMemo(() => financeKpis(rows, period, w), [rows, period, w]);
  // Tasks due in the period (or created in it when they have no due date).
  const due = (t: Entity) => String(t.data.dueDate || t.created_at.slice(0, 10)),
    inPeriod = home.tasks.filter((t) => due(t) >= w.from && due(t) <= w.to),
    open = inPeriod.filter((t) => t.data.status !== "done"),
    late = open.filter((t) => t.data.dueDate && String(t.data.dueDate) < today).length,
    done = inPeriod.length - open.length,
    name = periodNames[period],
    thisName = w.running ? (period === "day" ? "วันนี้" : name + "นี้") : name + "ที่เลือก",
    noPrev = `ไม่มียอด${name}ก่อนหน้าให้เทียบ`,
    spark = (k: "sales" | "cost" | "expense" | "profit" | "margin") => f.series?.[k];
  const baht = (n: number) => (n < 0 ? "-฿" : "฿") + money(Math.abs(Math.round(n)));
  const cards: Kpi[] = [
    { key: "sales", label: "ยอดขาย", value: baht(f.cur.sales), icon: ChartColumn, color: "#3b82f6", change: f.change.sales, note: noPrev, spark: spark("sales"), view: "sales" },
    { key: "cost", label: "ต้นทุน", value: baht(f.cur.cost), icon: Coins, color: "#f08a3c", change: f.change.cost, note: noPrev, spark: spark("cost"), view: "expenses" },
    { key: "expense", label: "ค่าใช้จ่าย", value: baht(f.cur.expense), icon: Receipt, color: "#ef4f6b", change: f.change.expense, note: noPrev, spark: spark("expense"), view: "expenses" },
    {
      key: "profit",
      label: f.profit < 0 ? "ขาดทุน" : "กำไร / ขาดทุน",
      value: baht(f.profit),
      icon: Target,
      color: "#22a55e",
      change: f.change.profit,
      note: noPrev,
      spark: spark("profit"),
      view: "reports",
      extra: (
        <span className="hd-kpi-margin-line">
          <Percent size={12} /> อัตรากำไร <b>{f.margin.toFixed(1)}%</b>
          {f.change.margin && (
            <span className={f.change.margin.good ? "good" : "bad"}>
              ({(f.change.margin.up ? "+" : "-") + f.change.margin.text})
            </span>
          )}
        </span>
      ),
    },
    { key: "tasks", label: "งานทั้งหมด", value: inPeriod.length + " งาน", icon: ListChecks, color: "#3b9bf0", note: `เสร็จแล้ว ${done} งาน`, view: "tasks" },
    { key: "open", label: "งานคงค้าง", value: open.length + " งาน", icon: Hourglass, color: "#e85d9b", note: late ? `เลยกำหนด ${late} งาน` : "ไม่มีงานเลยกำหนด", view: "tasks" },
  ];
  const compare = w.running ? `เทียบช่วงเดียวกันของ${name}ก่อน` : `เทียบกับ${name}ก่อนหน้า`,
    range = periodText(period, w.from, w.to);
  return (
    <div className={"hd-kpis" + (sample ? " sample" : "") + (loading ? " loading" : "")} aria-busy={loading}>
      {sample && <span className="sample-badge hd-sample-badge hd-kpis-badge">ตัวอย่าง</span>}
      {cards.map((k) => (
        <button key={k.key} className={"hd-card hd-kpi hd-kpi-" + k.key} onClick={() => navigate(k.view)} title={`${range} · ${compare}`}>
          <span className="hd-kpi-icon" style={{ color: k.color, background: k.color + "1f" }}>
            <k.icon size={20} />
          </span>
          <span className="hd-kpi-body">
            <span className="hd-kpi-label">{k.label}</span>
            <strong className="hd-kpi-value">{k.value}</strong>
            {k.change ? (
              <span className={"hd-kpi-change " + (k.change.good ? "good" : "bad")}>
                {k.change.up ? "▲" : "▼"} {(k.change.up ? "+" : "-") + k.change.text}
              </span>
            ) : (
              <span className="hd-kpi-change muted">{k.note}</span>
            )}
            {k.extra}
          </span>
          {k.spark && <Spark values={k.spark} color={k.color} />}
        </button>
      ))}
      <div className="hd-card hd-kpi hd-kpi-period" role="status">
        <span className="hd-kpi-icon">
          <CalendarDays size={20} />
        </span>
        <span className="hd-kpi-body">
          <span className="hd-kpi-label">ยอด{thisName}</span>
          <strong className="hd-kpi-value">{range}</strong>
          <span className="hd-kpi-change muted">{compare} · เปลี่ยนได้ที่ปฏิทิน</span>
        </span>
      </div>
    </div>
  );
}

/* ---------- calendar + today's agenda ---------- */
const agendaIcons: Record<string, LucideIcon> = { events: CalendarDays, tasks: ListTodo, deals: Handshake, projects: Layers };
function CalendarCard({
  ctx,
  today,
  navigate,
  notify,
  onAdded,
  refreshKey,
  sampleEntries,
  period,
  setPeriod,
  selected,
  setSelected,
}: {
  ctx: Context;
  today: string;
  navigate: Navigate;
  notify: (s: string) => void;
  onAdded: () => void;
  refreshKey: number;
  /** Sample mode: show these instead of GET /calendar. */
  sampleEntries?: Entity[];
  /** Period the overview cards total, around the selected day. */
  period: Period;
  setPeriod: (p: Period) => void;
  selected: string;
  setSelected: (d: string) => void;
}) {
  const [month, setMonth] = useState(selected.slice(0, 7)),
    [realEntries, setEntries] = useState<Entity[]>([]),
    [adding, setAdding] = useState(false),
    entries = sampleEntries || realEntries;
  useEffect(() => {
    let live = true;
    if (sampleEntries) return;
    api("/calendar?month=" + month)
      .then((rows) => live && setEntries(rows))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [month, refreshKey, sampleEntries]);
  const [y, m] = month.split("-").map(Number),
    first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
    days = monthDays(month),
    on = (day: string) =>
      entries.filter((e) => {
        const [start, end] = entrySpan(e);
        return start && start <= day && day <= end;
      }),
    agenda = on(selected).sort((a, b) => (entryTime(a) || "99").localeCompare(entryTime(b) || "99")),
    range = periodRange(period, selected),
    // Moving the month moves a month / year view with it (to today in the current month, else the 1st).
    goMonth = (n: number) => {
      const next = shiftMonth(month, n);
      setMonth(next);
      if (period === "month" || period === "year") setSelected(next === today.slice(0, 7) ? today : next + "-01");
    };
  return (
    <section className="hd-card hd-cal">
      <div className="hd-cal-head">
        <strong>
          {thai(month + "-01", { month: "long", year: "numeric" })}
          <SampleBadge />
        </strong>
        <div>
          <button className="hd-round" aria-label="เดือนก่อนหน้า" onClick={() => goMonth(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button className="hd-round" aria-label="เดือนถัดไป" onClick={() => goMonth(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="hd-period" role="group" aria-label="ดูยอดการ์ดภาพรวมแบบ">
        {(Object.keys(periodNames) as Period[]).map((p) => (
          <button key={p} className={period === p ? "on" : ""} aria-pressed={period === p} onClick={() => setPeriod(p)}>
            ราย{periodNames[p]}
          </button>
        ))}
      </div>
      <p className="hd-period-range">
        ยอดในการ์ด: <b>{periodText(period, range.from, range.to)}</b>
      </p>
      <div className="hd-cal-grid">
        {weekdays.map((d) => (
          <span className="hd-cal-dow" key={d}>
            {d}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={"blank" + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, "0")}`,
            busy = on(day).length > 0;
          return (
            <button
              key={day}
              className={
                "hd-cal-day" +
                (day === today ? " today" : "") +
                (day === selected ? " selected" : "") +
                ((period === "week" || period === "day") && day >= range.from && day <= range.to ? " in-range" : "")
              }
              onClick={() => setSelected(day)}
              aria-label={thai(day, { day: "numeric", month: "long" }) + (busy ? ` มี ${on(day).length} รายการ` : "")}
            >
              {i + 1}
              {busy && <i />}
            </button>
          );
        })}
      </div>
      <div className="hd-cal-legend">
        <span>
          <i className="dot" />
          มีกิจกรรม / งาน
        </span>
        <span>
          <i className="ring" />
          วันนี้
        </span>
      </div>
      <div className="hd-agenda">
        <div className="hd-agenda-head">
          <strong>
            {selected === today ? "วันนี้ - " : ""}
            {thai(selected, { day: "numeric", month: "short", year: "numeric" })}
          </strong>
          <small>{agenda.length} รายการ</small>
        </div>
        <ul className="hd-agenda-list">
          {agenda.slice(0, 6).map((e) => {
            const Icon = agendaIcons[e.kind] || CalendarDays;
            return (
              <li key={e.id}>
                <button onClick={() => navigate(e.kind === "events" ? "calendar" : e.kind)}>
                  <span className="hd-agenda-time">{entryTime(e) || kindLabels[e.kind] || "ทั้งวัน"}</span>
                  <Icon size={15} className={"hd-agenda-icon " + e.kind} />
                  <span className="hd-agenda-title">{String(e.data.name)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!agenda.length && <p className="hd-empty">ไม่มีกำหนดการ</p>}
        {agenda.length > 6 && (
          <button className="hd-link" onClick={() => navigate("calendar")}>
            ดูอีก {agenda.length - 6} รายการในปฏิทิน
          </button>
        )}
        <button className="hd-add" onClick={() => setAdding(true)} disabled={ctx.member.role === "viewer" || !!sampleEntries}>
          <Plus size={15} />
          เพิ่มกิจกรรม
        </button>
      </div>
      {adding && !sampleEntries && (
        <EventModal
          ctx={ctx}
          day={selected}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            notify("เพิ่มกิจกรรมแล้ว");
            onAdded();
          }}
        />
      )}
    </section>
  );
}
function EventModal({ ctx, day, onClose, onSaved }: { ctx: Context; day: string; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget),
      get = (k: string) => String(form.get(k) || "").trim(),
      start = get("startDate"),
      end = get("endDate");
    setBusy(true);
    setError("");
    try {
      await api("/entities/events", {
        method: "POST",
        body: {
          data: {
            name: get("name"),
            startDate: start,
            endDate: end && end >= start ? end : start,
            location: get("location") || undefined,
            notes: get("notes") || undefined,
            owner: ctx.user.name,
            status: "planning",
          },
        },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="เพิ่มกิจกรรม" onClose={onClose}>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label className="wide">
              ชื่อกิจกรรม
              <input name="name" required maxLength={200} autoFocus placeholder="เช่น ประชุมทีมการตลาด" />
            </label>
            <label>
              วันเริ่ม
              <input name="startDate" type="date" required defaultValue={day} />
            </label>
            <label>
              วันสิ้นสุด
              <input name="endDate" type="date" defaultValue={day} />
            </label>
            <label className="wide">
              สถานที่
              <input name="location" maxLength={200} />
            </label>
            <label className="wide">
              รายละเอียด
              <textarea name="notes" rows={3} maxLength={2000} />
            </label>
          </div>
        </fieldset>
        <p role="alert" className="form-error">
          {error}
        </p>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="primary" disabled={busy}>
            <Check size={15} />
            {busy ? "กำลังบันทึก…" : "บันทึกกิจกรรม"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- diary ---------- */
function Notebook() {
  return (
    <svg className="hd-notebook" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id="hd-nb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b18cff" />
          <stop offset="1" stopColor="#6d43e0" />
        </linearGradient>
      </defs>
      <path d="M70 26c10-20 30-22 38-18-4 12-18 24-38 18z" fill="#7bc77e" />
      <path d="M62 30c-2-18 10-28 18-30 2 12-6 26-18 30z" fill="#9ad68f" />
      <rect x="30" y="28" width="62" height="80" rx="9" transform="rotate(-10 61 68)" fill="#e9defe" />
      <rect x="26" y="26" width="62" height="80" rx="9" transform="rotate(-10 57 66)" fill="url(#hd-nb)" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={26 + i * 0.4} cy={36 + i * 12} r="3" transform="rotate(-10 57 66)" fill="#fff" opacity="0.85" />
      ))}
      <text x="60" y="62" transform="rotate(-10 57 66)" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" opacity="0.9">
        EliteFlow
      </text>
    </svg>
  );
}
function Diary({
  today,
  extra,
  notify,
  reload,
}: {
  today: string;
  extra: HomeExtra | null;
  notify: (s: string) => void;
  reload: () => Promise<unknown>;
}) {
  const [day, setDay] = useState(today),
    [menu, setMenu] = useState(false),
    [editing, setEditing] = useState(false),
    [local, setLocal] = useState<UserNote | null | undefined>(undefined),
    sample = useSample();
  const stored = extra?.notes.find((n) => n.day === day) || null,
    note = local !== undefined ? local : stored;
  useEffect(() => setLocal(undefined), [extra, day]);
  async function save(body: string, items: NoteItem[]) {
    if (sample) return;
    await api("/home/notes", { method: "PUT", body: { day, body, items } });
    await reload();
  }
  async function toggle(i: number) {
    if (!note || sample) return;
    const items = note.items.map((it, j) => (j === i ? { ...it, done: !it.done } : it));
    setLocal({ ...note, items });
    try {
      await save(note.body, items);
    } catch (e) {
      setLocal(undefined);
      notify((e as Error).message);
    }
  }
  async function remove() {
    setMenu(false);
    if (!note || sample || !confirm("ลบบันทึกของวันนี้?")) return;
    try {
      await api("/home/notes/" + day, { method: "DELETE" });
      await reload();
      notify("ลบบันทึกแล้ว");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const done = note?.items.filter((i) => i.done).length || 0;
  return (
    <section className="hd-card hd-diary">
      <div className="hd-head">
        <h2>
          <NotebookPen size={18} className="hd-head-icon" />
          ไดอารี่ของฉัน <span aria-hidden="true">✨</span>
          <SampleBadge />
        </h2>
        <div className="hd-head-actions">
          <button className="hd-pill-btn" onClick={() => setEditing(true)} disabled={sample}>
            <Plus size={14} />
            เขียนบันทึก
          </button>
          <div className="hd-menu-wrap">
            <button className="hd-round" aria-label="ตัวเลือกไดอารี่" aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={sample}>
              <Ellipsis size={16} />
            </button>
            {menu && (
              <div className="hd-menu" role="menu">
                <small>บันทึกย้อนหลัง</small>
                <button role="menuitem" className={day === today ? "active" : ""} onClick={() => (setDay(today), setMenu(false))}>
                  วันนี้
                </button>
                {(extra?.notes || [])
                  .filter((n) => n.day !== today)
                  .slice(0, 8)
                  .map((n) => (
                    <button
                      role="menuitem"
                      key={n.day}
                      className={day === n.day ? "active" : ""}
                      onClick={() => (setDay(n.day), setMenu(false))}
                    >
                      {thai(n.day, { weekday: "short", day: "numeric", month: "short" })}
                    </button>
                  ))}
                {note && (
                  <button role="menuitem" className="danger" onClick={remove}>
                    <Trash2 size={13} />
                    ลบบันทึกนี้
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="hd-diary-body">
        <div className="hd-date-badge">
          <strong>{Number(day.slice(8))}</strong>
          <small>{thai(day, { month: "short" })}</small>
        </div>
        <div className="hd-diary-note">
          <h3>
            {day === today ? "บันทึกวันนี้" : "บันทึก " + thai(day, { day: "numeric", month: "short" })}{" "}
            <span aria-hidden="true">✏️</span>
            {note && note.items.length > 0 && (
              <small>
                {done}/{note.items.length} เสร็จ
              </small>
            )}
          </h3>
          {!extra ? (
            <Loading />
          ) : note ? (
            <>
              {note.body && <p className="hd-diary-text">{note.body}</p>}
              <ul className="hd-check">
                {note.items.map((it, i) => (
                  <li key={i}>
                    <label className={it.done ? "done" : ""}>
                      <input type="checkbox" checked={it.done} onChange={() => toggle(i)} disabled={sample} />
                      <span>{it.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {!sample && (
                <button className="hd-link" onClick={() => setEditing(true)}>
                  <Pencil size={12} />
                  แก้ไขบันทึก
                </button>
              )}
            </>
          ) : (
            <p className="hd-empty">
              ยังไม่มีบันทึก — จดสิ่งที่ต้องทำและเรื่องสำคัญของวันไว้ที่นี่ (เห็นเฉพาะคุณ)
            </p>
          )}
        </div>
        <Notebook />
      </div>
      {editing && !sample && (
        <NoteEditor
          day={day}
          note={note}
          onClose={() => setEditing(false)}
          onSave={async (body, items) => {
            await save(body, items);
            setEditing(false);
            notify("บันทึกไดอารี่แล้ว");
          }}
        />
      )}
    </section>
  );
}
function NoteEditor({
  day,
  note,
  onClose,
  onSave,
}: {
  day: string;
  note: UserNote | null;
  onClose: () => void;
  onSave: (body: string, items: NoteItem[]) => Promise<void>;
}) {
  const [body, setBody] = useState(note?.body || ""),
    [items, setItems] = useState<NoteItem[]>(note?.items.length ? note.items : [{ text: "", done: false }]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (i: number, patch: Partial<NoteItem>) => setItems((s) => s.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(body, items.filter((i) => i.text.trim()));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title={"บันทึก " + thai(day, { weekday: "long", day: "numeric", month: "long" })} onClose={onClose}>
      <form onSubmit={submit} className="hd-editor">
        <fieldset disabled={busy}>
          <label>
            บันทึก
            <textarea rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="วันนี้มีอะไรสำคัญบ้าง…" />
          </label>
          <div className="hd-editor-items">
            <span>รายการที่ต้องทำ</span>
            {items.map((it, i) => (
              <div className="hd-editor-item" key={i}>
                <input type="checkbox" checked={it.done} onChange={(e) => set(i, { done: e.target.checked })} aria-label="ทำเสร็จแล้ว" />
                <input
                  value={it.text}
                  maxLength={200}
                  placeholder={"รายการที่ " + (i + 1)}
                  onChange={(e) => set(i, { text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (items.length < 30) setItems((s) => [...s.slice(0, i + 1), { text: "", done: false }, ...s.slice(i + 1)]);
                    }
                  }}
                />
                <button type="button" className="hd-round" aria-label="ลบรายการ" onClick={() => setItems((s) => s.filter((_, j) => j !== i))}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {items.length < 30 && (
              <button type="button" className="hd-link" onClick={() => setItems((s) => [...s, { text: "", done: false }])}>
                <Plus size={13} />
                เพิ่มรายการ
              </button>
            )}
          </div>
        </fieldset>
        <p role="alert" className="form-error">
          {error}
        </p>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="primary" disabled={busy}>
            <Check size={15} />
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- sales overview ---------- */
type Period = "day" | "week" | "month" | "year";
function buckets(period: Period, today: string) {
  if (period === "day")
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i - 13);
      return { label: String(Number(d.slice(8))), from: d, to: d };
    });
  if (period === "week") {
    // This week, Sunday to Saturday.
    const start = addDays(today, -new Date(today + "T00:00:00Z").getUTCDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      return { label: weekdays[i] + ".", from: d, to: d };
    });
  }
  if (period === "month") {
    const start = today.slice(0, 8) + "01",
      last = monthDays(today.slice(0, 7)),
      out = [];
    for (let d = 1; d <= last; d += 7) {
      const end = Math.min(last, d + 6);
      out.push({ label: `${d}–${end}`, from: addDays(start, d - 1), to: addDays(start, end - 1) });
    }
    return out;
  }
  const year = today.slice(0, 4);
  return Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    return {
      label: thai(`${year}-${mm}-01`, { month: "short" }),
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-${monthDays(`${year}-${mm}`)}`,
    };
  });
}
function SalesCard({ today, home }: { today: string; home: HomeData }) {
  const [period, setPeriod] = useState<Period>("week"),
    [mode, setMode] = useState<"branch" | "project">("branch"),
    [project, setProject] = useState("all");
  const view = useMemo(() => {
    const rows = home.finance.filter((r) => mode === "branch" || project === "all" || r.projectId === project),
      sum = (from: string, to: string, kind: string) =>
        rows.filter((r) => r.kind === kind && r.date >= from && r.date <= to).reduce((s, r) => s + r.amount, 0),
      groups = buckets(period, today).map((b) => {
        const sales = sum(b.from, b.to, "sales"),
          cost = sum(b.from, b.to, "expenses");
        return { ...b, sales, cost, profit: sales - cost };
      });
    return {
      groups,
      empty: groups.every((g) => !g.sales && !g.cost),
      max: niceMax(Math.max(0, ...groups.flatMap((g) => [g.sales, g.cost, g.profit]))),
    };
  }, [home, period, project, mode, today]);
  return (
    <section className="hd-card hd-sales">
      <div className="hd-head">
        <h2>
          <ChartColumn size={18} className="hd-head-icon" />
          ภาพรวมยอดขาย
          <SampleBadge />
        </h2>
      </div>
      <div className="hd-sales-controls">
        <div className="hd-toggle" role="tablist" aria-label="มุมมอง">
          <button role="tab" aria-selected={mode === "branch"} className={mode === "branch" ? "active" : ""} onClick={() => setMode("branch")}>
            <Store size={14} />
            สาขา
          </button>
          <button role="tab" aria-selected={mode === "project"} className={mode === "project" ? "active" : ""} onClick={() => setMode("project")}>
            <Layers size={14} />
            โปรเจกต์
          </button>
        </div>
        {mode === "branch" ? (
          <select className="hd-select" value="all" disabled aria-label="สาขา">
            <option value="all">ทุกสาขา</option>
          </select>
        ) : (
          <select className="hd-select" value={project} onChange={(e) => setProject(e.target.value)} aria-label="โปรเจกต์">
            <option value="all">ทุกโปรเจกต์</option>
            {home.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="hd-periods" role="tablist" aria-label="ช่วงเวลา">
          {(
            [
              ["day", "รายวัน"],
              ["week", "รายสัปดาห์"],
              ["month", "รายเดือน"],
              ["year", "รายปี"],
            ] as [Period, string][]
          ).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={period === key} className={period === key ? "active" : ""} onClick={() => setPeriod(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={"hd-chart" + (view.empty ? " empty" : "")}>
        {view.empty && <p className="hd-chart-empty">ยังไม่มียอดขายหรือค่าใช้จ่ายที่ยืนยันในช่วงนี้</p>}
        <div className="hd-axis">
          <span>{compact(view.max)}</span>
          <span>{compact(view.max / 2)}</span>
          <span>0</span>
        </div>
        <div className="hd-bars">
          {view.groups.map((g) => (
            <div className="hd-group" key={g.from}>
              <div className="hd-trio">
                {(
                  [
                    ["sales", g.sales, "ยอดขาย"],
                    ["cost", g.cost, "ต้นทุน + ค่าใช้จ่าย"],
                    ["profit", Math.max(0, g.profit), "กำไร"],
                  ] as [string, number, string][]
                ).map(([key, value, label]) => (
                  <i key={key} className={key} style={{ height: (value / view.max) * 100 + "%" }} title={`${label} ฿${money(value)}`} />
                ))}
              </div>
              <small>{g.label}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="hd-legend">
        <span>
          <i className="sales" />
          ยอดขาย
        </span>
        <span>
          <i className="cost" />
          ต้นทุน + ค่าใช้จ่าย
        </span>
        <span>
          <i className="profit" />
          กำไร
        </span>
      </div>
    </section>
  );
}

/* ---------- my work ---------- */
const workIcons: Record<string, LucideIcon> = {
  ingestion: MessageSquareText,
  purchases: ShoppingCart,
  expenses: Receipt,
  leaves: CalendarOff,
  tasks: ListTodo,
};
const priorityChip = {
  urgent: { label: "ด่วน", icon: Flame },
  high: { label: "สำคัญ", icon: Flag },
  normal: { label: "ทั่วไป", icon: Droplet },
};
function WorkStatusCell({ w }: { w: WorkItem }) {
  if (w.status === "approved" || w.status === "rejected") {
    const Icon = w.status === "approved" ? CircleCheck : CircleX;
    return (
      <span className={"hd-status-box " + w.status}>
        <Icon size={18} />
        <span>
          <strong>{w.status === "approved" ? "อนุมัติแล้ว" : "ไม่อนุมัติ"}</strong>
          <small>
            {w.decidedBy ? "โดย " + w.decidedBy : ""}
            {w.decidedAt ? <br /> : null}
            {w.decidedAt ? stamp(w.decidedAt) : ""}
          </small>
        </span>
      </span>
    );
  }
  const s = {
    pending: { label: "รออนุมัติ", icon: Clock },
    review: { label: "รอตรวจสอบ", icon: Search },
    follow: { label: "ติดตาม", icon: History },
  }[w.status];
  return (
    <span className={"hd-status " + w.status}>
      <s.icon size={14} />
      {s.label}
    </span>
  );
}
function MyWork({
  extra,
  filter,
  setFilter,
  navigate,
}: {
  extra: HomeExtra | null;
  filter: "all" | "approve" | "review" | "follow";
  setFilter: (f: "all" | "approve" | "review" | "follow") => void;
  navigate: Navigate;
}) {
  const [more, setMore] = useState(false);
  const rows = (extra?.work || []).filter((w) => filter === "all" || w.group === filter),
    shown = more ? rows : rows.slice(0, 6);
  const pills: ["all" | "approve" | "review" | "follow", string, number][] = [
    ["all", "ทั้งหมด", extra?.counts.all || 0],
    ["approve", "รออนุมัติ", extra?.counts.approve || 0],
    ["review", "รอตรวจสอบ", extra?.counts.review || 0],
    ["follow", "ติดตาม", extra?.counts.follow || 0],
  ];
  return (
    <section className="hd-card hd-work" id="hd-work">
      <div className="hd-head">
        <h2>
          <ClipboardCheck size={18} className="hd-head-icon" />
          งานของฉัน <span className="hd-head-sub">(รายการที่ต้องอนุมัติ / ติดตาม)</span>
          <SampleBadge />
        </h2>
        <div className="hd-pills" role="tablist">
          {pills.map(([key, label, n]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              className={"hd-pill " + key + (filter === key ? " active" : "")}
              onClick={() => (setFilter(key), setMore(false))}
            >
              {label} ({n})
            </button>
          ))}
        </div>
      </div>
      {!extra ? (
        <Loading />
      ) : rows.length ? (
        <ul className="hd-work-list">
          {shown.map((w) => {
            const Icon = w.source === "tasks" && w.group === "review" ? ClipboardCheck : workIcons[w.source] || FileText,
              p = priorityChip[w.priority];
            return (
              <li key={w.source + w.id}>
                <button className="hd-work-row" onClick={() => navigate(w.view)}>
                  <span className={"hd-work-icon " + w.source}>
                    <Icon size={18} />
                  </span>
                  <span className="hd-work-title">
                    <strong>{w.title}</strong>
                    <small>{w.sub}</small>
                  </span>
                  <span className="hd-work-who">
                    <span className="hd-mini-avatar" style={{ background: toneOf(w.requester) }}>
                      {initial(w.requester)}
                    </span>
                    <span>
                      <strong>
                        {w.requester}
                        {w.department ? ` (${deptLabels[w.department] || w.department})` : ""}
                      </strong>
                      <small>
                        <CalendarDays size={12} /> ส่งมา {stamp(w.at)}
                      </small>
                    </span>
                  </span>
                  <span className={"hd-prio " + w.priority}>
                    <p.icon size={13} />
                    {p.label}
                  </span>
                  <WorkStatusCell w={w} />
                  <ChevronRight size={16} className="hd-chev" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hd-empty hd-work-empty">
          <CircleCheck size={18} />
          ไม่มีรายการค้างในตัวกรองนี้
        </p>
      )}
      {rows.length > 6 && (
        <button className="hd-link hd-work-more" onClick={() => setMore(!more)}>
          {more ? "ย่อรายการ" : `ดูทั้งหมด (${rows.length})`}
        </button>
      )}
    </section>
  );
}

/* ---------- alerts ---------- */
function Alerts({
  today,
  tomorrow,
  summary,
  tasks,
  upcoming,
  approvals,
  navigate,
  showWork,
}: {
  today: string;
  tomorrow: string;
  summary: Summary;
  tasks: Entity[];
  upcoming: Entity[];
  approvals: number;
  navigate: Navigate;
  showWork: (f: "approve") => void;
}) {
  const open = tasks.filter((t) => t.data.status !== "done" && t.data.dueDate),
    overdue = open.filter((t) => String(t.data.dueDate) < today),
    soon = open.filter((t) => {
      const diff = dayDiff(String(t.data.dueDate), today);
      return diff >= 0 && diff <= 3;
    }),
    meetings = upcoming.filter((e) => e.kind === "events" && entrySpan(e)[0] === tomorrow);
  const items: { tone: "danger" | "warn" | "info"; icon: LucideIcon; title: string; go: () => void }[] = [
    ...summary.lowStock.slice(0, 3).map((p) => ({
      tone: "danger" as const,
      icon: TriangleAlert,
      title: `สินค้าใกล้หมด: ${String(p.data.name)} (คงเหลือ ${money(p.data.stock)} ชิ้น)`,
      go: () => navigate("products"),
    })),
    ...(approvals ? [{ tone: "warn" as const, icon: CircleAlert, title: `มี ${approvals} งานรอการอนุมัติ`, go: () => showWork("approve") }] : []),
    ...(overdue.length
      ? [{ tone: "danger" as const, icon: TriangleAlert, title: `งานเลยกำหนด ${overdue.length} งาน: ${String(overdue[0].data.name)}`, go: () => navigate("tasks") }]
      : []),
    ...(soon.length ? [{ tone: "warn" as const, icon: Clock, title: `งานครบกำหนดใน 3 วัน ${soon.length} งาน`, go: () => navigate("tasks") }] : []),
    ...meetings.slice(0, 2).map((e) => ({
      tone: "info" as const,
      icon: Info,
      title: `${String(e.data.name)} พรุ่งนี้${entryTime(e) ? " เวลา " + entryTime(e) + " น." : ""}`,
      go: () => navigate("calendar"),
    })),
    ...(summary.pendingDeals
      ? [{ tone: "info" as const, icon: Handshake, title: `ดีลรออนุมัติ ${summary.pendingDeals} รายการ`, go: () => navigate("deals") }]
      : []),
  ];
  return (
    <section className="hd-card hd-alerts">
      <div className="hd-head">
        <h2>
          <Bell size={18} className="hd-head-icon" />
          แจ้งเตือนสำคัญ
          {items.length > 0 && <span className="hd-badge">{items.length}</span>}
          <SampleBadge />
        </h2>
      </div>
      <ul className="hd-alert-list">
        {items.slice(0, 6).map((a) => (
          <li key={a.title}>
            <button className={"hd-alert " + a.tone} onClick={a.go}>
              <a.icon size={16} />
              <span>{a.title}</span>
              <ChevronRight size={15} />
            </button>
          </li>
        ))}
      </ul>
      {!items.length && <p className="hd-empty">ไม่มีเรื่องที่ต้องติดตาม</p>}
    </section>
  );
}

/* ---------- recent activity ---------- */
const activityIcons: Record<Activity["icon"], LucideIcon> = {
  created: UserPlus,
  updated: Layers,
  approved: CircleCheck,
  rejected: CircleX,
};
function ActivityCard({ activity, today, navigate }: { activity: Activity[] | null; today: string; navigate: Navigate }) {
  const [all, setAll] = useState(false),
    shown = all ? activity || [] : (activity || []).slice(0, 3);
  return (
    <section className="hd-card hd-activity">
      <div className="hd-head">
        <h2>
          <History size={18} className="hd-head-icon" />
          กิจกรรมล่าสุด
          <SampleBadge />
        </h2>
        {(activity?.length || 0) > 3 && (
          <button className="hd-link" onClick={() => setAll(!all)}>
            {all ? "ย่อ" : "ดูทั้งหมด"}
            <ChevronRight size={14} />
          </button>
        )}
      </div>
      {!activity ? (
        <Loading />
      ) : activity.length ? (
        <ol className="hd-timeline">
          {shown.map((a) => {
            const Icon = activityIcons[a.icon],
              day = new Date(a.at).toLocaleDateString("en-CA", { timeZone: BKK });
            return (
              <li key={a.id}>
                <button onClick={() => navigate(a.kind)}>
                  <span className="hd-tl-time">{day === today ? clock(a.at) : thai(day, { day: "numeric", month: "short" })}</span>
                  <span className={"hd-tl-icon " + a.icon}>
                    <Icon size={15} />
                  </span>
                  <span className="hd-tl-text">
                    <strong>{a.text}</strong>
                    <small>
                      {a.by ? "โดย คุณ" + a.by : a.department ? "โดย" + (deptLabels[a.department] || a.department) : ""}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="hd-empty">ยังไม่มีความเคลื่อนไหว</p>
      )}
    </section>
  );
}

/* ---------- monthly goal ---------- */
function TargetArt() {
  return (
    <svg className="hd-target-art" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="58" cy="64" r="46" fill="#ece4ff" />
      <circle cx="58" cy="64" r="36" fill="#fff" />
      <circle cx="58" cy="64" r="28" fill="#b597ff" />
      <circle cx="58" cy="64" r="19" fill="#fff" />
      <circle cx="58" cy="64" r="10" fill="#7c4dff" />
      <path d="M58 64 102 20" stroke="#5b34d6" strokeWidth="4" strokeLinecap="round" />
      <path d="M96 14 110 10 106 24 100 26 94 20z" fill="#f2668b" />
    </svg>
  );
}
function GoalCard({
  today,
  home,
  extra,
  notify,
  reload,
}: {
  today: string;
  home: HomeData | null;
  extra: HomeExtra | null;
  notify: (s: string) => void;
  reload: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false);
  const month = today.slice(0, 7),
    sales = (home?.finance || [])
      .filter((r) => r.kind === "sales" && r.date.startsWith(month) && r.date <= today)
      .reduce((s, r) => s + r.amount, 0),
    target = extra?.goal?.target || 0,
    pct = target ? Math.min(100, Math.round((sales / target) * 100)) : 0;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!extra?.canSetGoal) return;
    const n = Number(value.replace(/[,\s฿]/g, ""));
    if (!Number.isFinite(n) || n < 0) return notify("ใส่ยอดเป้าหมายเป็นตัวเลข");
    setBusy(true);
    try {
      await api("/home/goal", { method: "PUT", body: { month, target: n } });
      await reload();
      setEditing(false);
      notify("ตั้งเป้าหมายเดือนนี้แล้ว");
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="hd-card hd-goal">
      <div className="hd-head">
        <h2>
          <Target size={18} className="hd-head-icon" />
          เป้าหมายเดือนนี้
          <SampleBadge />
        </h2>
        {extra?.canSetGoal && !editing && (
          <button
            className="hd-round"
            aria-label="ตั้งเป้าหมาย"
            onClick={() => {
              setValue(target ? String(target) : "");
              setEditing(true);
            }}
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
      <div className="hd-goal-body">
        <div className="hd-goal-text">
          <span>ยอดขายรวม · {thai(month + "-01", { month: "long" })}</span>
          {editing ? (
            <form className="hd-goal-form" onSubmit={save}>
              <input
                inputMode="decimal"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="เช่น 1200000"
                aria-label="ยอดขายเป้าหมาย (บาท)"
              />
              <button className="primary" disabled={busy}>
                <Check size={14} />
              </button>
              <button type="button" className="secondary" onClick={() => setEditing(false)} aria-label="ยกเลิก">
                <X size={14} />
              </button>
            </form>
          ) : target ? (
            <strong>฿{money(target)}</strong>
          ) : (
            <p className="hd-empty">
              {extra?.canSetGoal ? "ยังไม่ได้ตั้งเป้า — กดดินสอเพื่อตั้งยอดขายเป้าหมาย" : "ยังไม่ได้ตั้งเป้าหมายเดือนนี้"}
            </p>
          )}
        </div>
        <TargetArt />
      </div>
      {target > 0 && (
        <div className="hd-goal-progress">
          <div className="hd-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: pct + "%" }} />
          </div>
          <strong>{pct}%</strong>
          <small>
            ทำได้ ฿{money(Math.round(sales))}
            {sales < target ? ` · ขาดอีก ฿${money(Math.round(target - sales))}` : " · ถึงเป้าแล้ว 🎉"}
          </small>
        </div>
      )}
    </section>
  );
}
