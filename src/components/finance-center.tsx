"use client";
// Financial Center / การเงินองค์กร: yearly budget plan per department, targets, actual revenue / expenses from records,
// per-department performance, multi-year comparison and the year-end closing checklist. Data: GET /api/finance?year=.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  Wallet, TrendingUp, ReceiptText, ChartColumn, Percent, ChevronLeft, ChevronRight, CalendarDays, RefreshCw,
  LayoutDashboard, ClipboardList, Network, ChartLine, Landmark, CircleCheck, Layers, Target, Clock, CircleAlert,
  FileSearch, Coins, Save, Check, Undo2, Megaphone, Monitor, Users, Cog, Building, Shield, CircleDashed, Package,
  ShoppingCart, Briefcase, Palette, Headphones, Scale, Database, Calculator, Lock, Eye, EyeOff, Sparkles,
} from "lucide-react";
import type { Context } from "@/lib/types";
import { api, money, Empty, Loading } from "./shared";
import type { FinanceOverview, YearTotals } from "@/lib/finance-center";
import { financeSample, financeIsEmpty, type FinanceSample } from "@/lib/mock/finance";

/** True while the page shows the sample ("ตัวอย่าง") dataset: cards get a badge and every write is disabled. */
const SampleCtx = createContext(false);
const useSample = () => useContext(SampleCtx);
const sampleExtras = (d: FinanceOverview) => (d as Partial<FinanceSample>).sample;
const readOnlyNote = (sample: boolean) => (sample ? "ข้อมูลตัวอย่าง — บันทึกไม่ได้ ปิดตัวอย่างเพื่อเริ่มใช้งานจริง" : "เฉพาะเจ้าของหรือผู้จัดการฝ่ายการเงินที่แก้ไขได้");

type Tab = "overview" | "plan" | "allocate" | "track" | "tax" | "closing" | "compare";
type Period = "day" | "week" | "month" | "year";
const tabs: { id: Tab; label: string; short: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "overview", label: "ภาพรวม", short: "ภาพรวม", icon: LayoutDashboard },
  { id: "plan", label: "วางแผนงบประมาณ", short: "งบประมาณ", icon: ClipboardList },
  { id: "allocate", label: "จัดสรรงบแผนก", short: "รายแผนก", icon: Network },
  { id: "track", label: "ติดตามผล & วิเคราะห์", short: "ติดตามผล", icon: ChartLine },
  { id: "closing", label: "ปิดงบประจำปี", short: "ปิดงบ", icon: CircleCheck },
  { id: "compare", label: "เปรียบเทียบหลายปี", short: "หลายปี", icon: Layers },
];
const periods: [Period, string][] = [
  ["day", "รายวัน"],
  ["week", "รายสัปดาห์"],
  ["month", "รายเดือน"],
  ["year", "รายปี"],
];
const closingSteps = [
  { step: 1, label: "ตรวจสอบรายการ", month: "ธ.ค.", next: false },
  { step: 2, label: "ปรับปรุงบัญชี", month: "ธ.ค.", next: false },
  { step: 3, label: "คำนวณภาษี", month: "ม.ค.", next: true },
  { step: 4, label: "จัดทำงบการเงิน", month: "ม.ค.", next: true },
  { step: 5, label: "ปิดงบและรายงาน", month: "ม.ค.", next: true },
];
const palette = ["#8b5cf6", "#3b82f6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#f97316", "#6366f1", "#84cc16", "#e11d48", "#14b8a6", "#a855f7", "#0ea5e9", "#eab308", "#64748b"];
const deptIcons: Record<string, React.ComponentType<{ size?: number }>> = {
  Operations: Cog, "Business Development": Briefcase, Design: Palette, Purchasing: ShoppingCart, Warehouse: Package,
  Sales: TrendingUp, Finance: Calculator, Marketing: Megaphone, HR: Users, IT: Monitor, "Customer Service": Headphones,
  Legal: Scale, Data: Database, Event: CalendarDays, Admin: Building, Reserve: Shield, Unassigned: CircleDashed,
};
const thb = (n: number) => (n < 0 ? "-฿" : "฿") + money(Math.abs(Math.round(n)));
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const pctText = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
const beYear = (y: number) => y + 543;
const thaiDate = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).toLocaleDateString("th-TH", { ...o, timeZone: iso.length === 10 ? "UTC" : "Asia/Bangkok" });
const shortMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)),
    n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const compact = (n: number) =>
  Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString("th-TH", { maximumFractionDigits: 1 }) + "M" : Math.abs(n) >= 1e3 ? (n / 1e3).toLocaleString("th-TH", { maximumFractionDigits: 0 }) + "K" : String(Math.round(n));

export function FinanceCenter({ ctx, notify, navigate }: { ctx: Context; notify: (s: string) => void; navigate: (view: string) => void }) {
  const [year, setYear] = useState(() => {
      const y = typeof window === "undefined" ? null : Number(new URLSearchParams(window.location.search).get("year"));
      return y && y > 2000 && y < 2200 ? y : new Date(Date.now() + 7 * 3600000).getUTCFullYear();
    }),
    [tab, setTab] = useState<Tab>(() => {
      const t = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
      return tabs.some((x) => x.id === t) ? (t as Tab) : "overview";
    }),
    [period, setPeriod] = useState<Period>("month"),
    [data, setData] = useState<FinanceOverview | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    // "auto" = show the sample only while the year has no data of its own; "on" / "off" = the user's choice.
    [sampleMode, setSampleMode] = useState<"auto" | "on" | "off">("auto");
  const load = useCallback(async (y: number) => {
    setLoading(true);
    setError("");
    try {
      setData(await api("/finance?year=" + y));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(year);
  }, [load, year]);
  const thisYear = Number((data?.today || new Date().toISOString()).slice(0, 4));
  const go = (t: Tab) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", u);
    } catch {}
  };
  const realEmpty = !!data && financeIsEmpty(data),
    // Samples only in the public demo; a real company sees its own figures or empty states.
    sample = ctx.demo && (sampleMode === "on" || (sampleMode === "auto" && realEmpty)),
    sampleData = useMemo(() => financeSample(year, data?.today), [year, data?.today]),
    view = sample ? sampleData : data;
  const saved = (msg: string) => {
    if (sample) return; // never reached: sample mode disables every save
    notify(msg);
    load(year);
  };
  const startReal = () => {
    setSampleMode("off");
    if (realEmpty && data?.canManage) go("allocate");
  };

  return (
    <div className="fc">
      <header className="fc-head">
        <div className="fc-title">
          <div className="eyebrow">YOUR BUSINESS, CONNECTED</div>
          <h1>
            Financial Center <span>/ การเงินองค์กร</span>
          </h1>
          <p>วางแผน · จัดสรรงบ · ควบคุมค่าใช้จ่าย · วิเคราะห์ผล · ปิดงบหลายปี</p>
        </div>
        <div className="fc-controls">
          <div className="fc-year" role="group" aria-label="ปีบัญชี">
            <span>ปีบัญชี</span>
            <button className="fc-icon-btn" aria-label="ปีก่อนหน้า" onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft size={16} />
            </button>
            <select aria-label="เลือกปีบัญชี" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, i) => thisYear + 1 - i)
                .concat(year > thisYear + 1 || year < thisYear - 6 ? [year] : [])
                .sort((a, b) => b - a)
                .map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
            </select>
            <button className="fc-icon-btn" aria-label="ปีถัดไป" onClick={() => setYear((y) => y + 1)}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="fc-seg" role="group" aria-label="ช่วงเวลาของกราฟ">
            {periods.map(([id, label]) => (
              <button key={id} className={period === id ? "on" : ""} aria-pressed={period === id} onClick={() => setPeriod(id)}>
                {label}
              </button>
            ))}
          </div>
          <span className="fc-date">
            <CalendarDays size={15} />
            {thaiDate(data?.today || new Date().toISOString().slice(0, 10), { month: "short", year: "numeric" })}
          </span>
          {ctx.demo && <button
            className={"fc-sample-toggle" + (sample ? " on" : "")}
            aria-pressed={sample}
            onClick={() => setSampleMode(sample ? "off" : "on")}
            title="สลับดูหน้าตัวอย่างพร้อมข้อมูลสมมติ"
          >
            {sample ? <EyeOff size={15} /> : <Eye size={15} />}
            {sample ? "ปิดตัวอย่าง" : "ดูตัวอย่าง"}
          </button>}
          <button className="fc-icon-btn fc-refresh" aria-label="รีเฟรชข้อมูล" onClick={() => load(year).then(() => notify("อัปเดตข้อมูลการเงินแล้ว"))}>
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <nav className="fc-tabs" role="tablist" aria-label="ส่วนของศูนย์การเงิน">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => go(t.id)}>
            <t.icon size={16} />
            <span className="fc-tab-long">{t.label}</span>
            <span className="fc-tab-short">{t.short}</span>
          </button>
        ))}
      </nav>

      {sample && (
        <div className="fc-sample-banner" role="status">
          <Sparkles size={18} />
          <p>
            <b>กำลังดูตัวอย่าง</b> — ข้อมูลสมมติเพื่อให้เห็นหน้าตาเมื่อมีข้อมูลจริง
            {realEmpty ? " (ปีนี้ยังไม่มีงบ เป้าหมาย หรือรายการของบริษัท ตัวอย่างจะหายไปเองเมื่อมีข้อมูลจริง)" : ""}
          </p>
          <div>
            <button className="secondary" onClick={() => setSampleMode("off")}>
              <EyeOff size={15} />
              ปิดตัวอย่าง
            </button>
            {realEmpty && data?.canManage && (
              <button className="primary" onClick={startReal}>
                เริ่มใช้งานจริง
              </button>
            )}
          </div>
        </div>
      )}
      {error && !sample && <p className="form-error">{error}</p>}
      {!view ? (
        loading ? <Loading /> : null
      ) : (
        <SampleCtx.Provider value={sample}>
          {/* key: remount the editors so sample values never stay in a form after switching back to real data */}
          <div key={sample ? "sample" : "real"} className={"fc-body" + (loading && !sample ? " fc-busy" : "") + (sample ? " fc-is-sample" : "")} role="tabpanel">
            {tab === "overview" && <Overview d={view} period={period} go={go} navigate={navigate} />}
            {tab === "plan" && <PlanTab d={view} saved={saved} />}
            {tab === "allocate" && <AllocateTab d={view} saved={saved} />}
            {tab === "track" && (
              <>
                <TrendCard d={view} period={period} wide />
                <div className="fc-grid fc-grid-track">
                  <DeptTable d={view} go={go} />
                  <StatusCard d={view} go={go} navigate={navigate} />
                </div>
              </>
            )}
            {tab === "closing" && <ClosingCard d={view} saved={saved} notify={notify} large />}
            {tab === "compare" && <CompareTab d={view} />}
            {ctx.demo && !sample && <p className="fc-note">โหมดตัวอย่าง: ตัวเลขคำนวณจากข้อมูลตัวอย่างในระบบ</p>}
          </div>
        </SampleCtx.Provider>
      )}
    </div>
  );
}

// ---------- overview ----------
function Overview({ d, period, go, navigate }: { d: FinanceOverview; period: Period; go: (t: Tab) => void; navigate: (v: string) => void }) {
  return (
    <>
      <Kpis d={d} />
      <div className="fc-grid fc-grid-3">
        <AllocationCard d={d} go={go} />
        <TrendCard d={d} period={period} />
        <TargetsCard d={d} go={go} />
      </div>
      <div className="fc-grid fc-grid-perf">
        <DeptTable d={d} go={go} />
        <SummaryCard d={d} />
        <StatusCard d={d} go={go} />
      </div>
      <TaxCard d={d} navigate={navigate} />
      <div className="fc-grid fc-grid-2">
        <YearsTable d={d} />
        <ClosingCard d={d} />
      </div>
    </>
  );
}

function Kpis({ d }: { d: FinanceOverview }) {
  const budget = Object.values(d.budgets).reduce((s, v) => s + v, 0),
    t = d.totals,
    rev = d.targets.revenue;
  const items: { tone: string; icon: React.ComponentType<{ size?: number }>; label: string; value: string; note: React.ReactNode }[] = [
    { tone: "hero", icon: Database, label: "งบประมาณทั้งปี", value: budget ? thb(budget) : "ยังไม่ตั้งงบ", note: budget ? `ปี ${d.year}` : "ตั้งได้ที่แท็บจัดสรรงบแผนก" },
    {
      tone: "green", icon: TrendingUp, label: "รายได้สะสม (YTD)", value: thb(t.revenue),
      note: rev ? <b className="up">{pctText(pct(t.revenue, rev))} ของเป้าหมาย</b> : "ยังไม่ตั้งเป้ารายได้",
    },
    {
      tone: "pink", icon: Wallet, label: "ค่าใช้จ่ายสะสม (YTD)", value: thb(t.expense),
      note: budget ? <b className={t.expense > budget ? "down" : "warn"}>{pctText(pct(t.expense, budget))} ของงบ</b> : "ยังไม่มีงบเทียบ",
    },
    {
      tone: "blue", icon: ChartColumn, label: "กำไรก่อนภาษี", value: thb(t.profit),
      note: t.revenue ? <b className={t.profit < 0 ? "down" : "up"}>อัตรากำไร {pctText(pct(t.profit, t.revenue))}</b> : "ยังไม่มีรายได้",
    },
    { tone: "amber", icon: Percent, label: "ประมาณการภาษี (CIT)", value: thb(t.tax), note: "(อัตรา 20% ของกำไร)" },
  ];
  const sample = useSample();
  return (
    <div className={"fc-kpis" + (sample ? " sample" : "")}>
      {sample && <span className="sample-badge fc-sample-badge fc-kpis-badge">ตัวอย่าง</span>}
      {items.map((k) => (
        <article key={k.label} className={"fc-kpi " + k.tone}>
          <span className="fc-kpi-icon">
            <k.icon size={22} />
          </span>
          <div>
            <span>{k.label}</span>
            <strong>{k.value}</strong>
            <small>{k.note}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

function Card({ title, icon: Icon, action, children, className = "" }: { title: string; icon: React.ComponentType<{ size?: number }>; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const sample = useSample();
  return (
    <section className={"fc-card " + className}>
      <div className="fc-card-head">
        <h2>
          <Icon size={18} />
          {title}
          {sample && <span className="sample-badge fc-sample-badge">ตัวอย่าง</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Donut({ parts, center, caption }: { parts: { id: string; value: number; color: string }[]; center: string; caption: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1,
    r = 42,
    c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg className="fc-donut" viewBox="0 0 120 120" role="img" aria-label={`สัดส่วนงบประมาณ ${caption} ${center}`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="18" />
      {parts.map((p) => {
        const len = (p.value / total) * c,
          el = (
            <circle key={p.id} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="18" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />
          );
        offset += len;
        return el;
      })}
      <text x="60" y="60" textAnchor="middle" className="fc-donut-value">
        {center}
      </text>
      <text x="60" y="74" textAnchor="middle" className="fc-donut-caption">
        {caption}
      </text>
    </svg>
  );
}

function allocation(d: FinanceOverview, budgets = d.budgets) {
  const total = Object.values(budgets).reduce((s, v) => s + v, 0);
  const rows = d.departments
    .map((x, i) => ({ ...x, amount: budgets[x.id] || 0, color: x.id === "Reserve" ? "#94a3b8" : palette[i % palette.length] }))
    .filter((x) => x.amount > 0);
  return { total, rows, depts: rows.filter((x) => x.id !== "Reserve"), reserve: rows.find((x) => x.id === "Reserve") };
}

function AllocationList({ rows, total }: { rows: { id: string; label: string; amount: number; color: string }[]; total: number }) {
  return (
    <ul className="fc-alloc-list">
      {rows.map((r) => {
        const Icon = deptIcons[r.id] || CircleDashed;
        return (
          <li key={r.id} className={r.id === "Reserve" ? "reserve" : ""}>
            <span className="fc-dot" style={{ color: r.color }}>
              <Icon size={15} />
            </span>
            <span className="fc-alloc-name">{r.label}</span>
            <span className="fc-alloc-pct">{Math.round(pct(r.amount, total))}%</span>
            <b>{thb(r.amount)}</b>
          </li>
        );
      })}
    </ul>
  );
}

function AllocationCard({ d, go }: { d: FinanceOverview; go: (t: Tab) => void }) {
  const a = allocation(d),
    allocated = a.depts.reduce((s, x) => s + x.amount, 0);
  return (
    <Card title={`การจัดสรรงบประมาณรายแผนก (ปี ${d.year})`} icon={ChartColumn} className="fc-alloc">
      {!a.total ? (
        <Empty
          title="ยังไม่ได้ตั้งงบประมาณปีนี้"
          description={d.canManage ? "กำหนดงบแต่ละแผนกและเงินสำรององค์กร เพื่อเริ่มติดตามการใช้งบ" : "ให้เจ้าของหรือผู้จัดการฝ่ายการเงินตั้งงบประมาณ"}
          action={d.canManage && <button className="primary" onClick={() => go("allocate")}>ตั้งงบประมาณ</button>}
        />
      ) : (
        <div className="fc-alloc-body">
          <Donut parts={a.rows.map((r) => ({ id: r.id, value: r.amount, color: r.color }))} center={thb(allocated)} caption="งบจัดสรรแผนก" />
          <AllocationList rows={a.rows} total={a.total} />
        </div>
      )}
    </Card>
  );
}

// ---------- trend ----------
type Bucket = { label: string; revenue: number; expense: number };
function buckets(d: FinanceOverview, period: Period): Bucket[] {
  if (period === "year")
    return [...d.years].reverse().map((y) => ({ label: String(y.year), revenue: y.revenue, expense: y.expense }));
  if (period === "month")
    return shortMonths.map((label, i) => {
      const m = `${d.year}-${String(i + 1).padStart(2, "0")}`,
        rows = d.daily.filter((x) => x.date.startsWith(m));
      return { label, revenue: rows.reduce((s, x) => s + x.revenue, 0), expense: rows.reduce((s, x) => s + x.expense, 0) };
    });
  // Day / week: the last 30 days or 12 weeks of the fiscal year up to today.
  const yearEnd = `${d.year}-12-31`,
    end = new Date((d.today < yearEnd ? d.today : yearEnd) + "T00:00:00Z"),
    yearStart = `${d.year}-01-01`,
    span = period === "day" ? 1 : 7,
    count = period === "day" ? 30 : 12,
    out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const to = new Date(end.getTime() - i * span * 864e5),
      from = new Date(to.getTime() - (span - 1) * 864e5),
      f = from.toISOString().slice(0, 10),
      t = to.toISOString().slice(0, 10);
    if (t < yearStart) continue;
    const rows = d.daily.filter((x) => x.date >= f && x.date <= t);
    out.push({
      label: period === "day" ? String(to.getUTCDate()) : thaiDate(t, { day: "numeric", month: "short" }),
      revenue: rows.reduce((s, x) => s + x.revenue, 0),
      expense: rows.reduce((s, x) => s + x.expense, 0),
    });
  }
  return out;
}

function TrendCard({ d, period, wide }: { d: FinanceOverview; period: Period; wide?: boolean }) {
  const data = useMemo(() => buckets(d, period), [d, period]);
  const empty = data.every((b) => !b.revenue && !b.expense);
  const W = 560,
    H = 230,
    L = 52,
    R = 10,
    T = 12,
    B = 28;
  const hi = niceMax(Math.max(0, ...data.flatMap((b) => [b.revenue, b.expense, b.revenue - b.expense]))),
    loRaw = Math.min(0, ...data.map((b) => b.revenue - b.expense)),
    lo = loRaw < 0 ? -niceMax(-loRaw) : 0,
    y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B),
    slot = (W - L - R) / Math.max(1, data.length),
    bw = Math.max(2, Math.min(14, slot / 3)),
    ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4),
    every = data.length > 16 ? Math.ceil(data.length / 10) : 1,
    line = data.map((b, i) => `${L + slot * i + slot / 2},${y(b.revenue - b.expense)}`).join(" ");
  return (
    <Card title="แนวโน้มรายได้ - ค่าใช้จ่าย - กำไร" icon={ChartLine} className={"fc-trend" + (wide ? " wide" : "")}>
      {empty ? (
        <Empty title="ยังไม่มีรายได้หรือค่าใช้จ่ายในช่วงนี้" description="ตัวเลขมาจากยอดขายที่ยืนยัน ค่าใช้จ่ายที่อนุมัติ/จ่ายแล้ว และการรับ-จ่ายเงิน" />
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="fc-chart" role="img" aria-label="กราฟแท่งรายได้และค่าใช้จ่าย พร้อมเส้นกำไร">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? "fc-axis zero" : "fc-axis"} />
                <text x={L - 6} y={y(t) + 4} textAnchor="end" className="fc-tick">
                  {compact(t)}
                </text>
              </g>
            ))}
            {data.map((b, i) => {
              const x = L + slot * i + slot / 2;
              return (
                <g key={i}>
                  <title>{`${b.label}: รายได้ ${thb(b.revenue)} · ค่าใช้จ่าย ${thb(b.expense)} · กำไร ${thb(b.revenue - b.expense)}`}</title>
                  <rect x={x - bw - 1} y={y(b.revenue)} width={bw} height={Math.max(0, y(0) - y(b.revenue))} rx="2" className="fc-bar rev" />
                  <rect x={x + 1} y={y(b.expense)} width={bw} height={Math.max(0, y(0) - y(b.expense))} rx="2" className="fc-bar exp" />
                  {i % every === 0 && (
                    <text x={x} y={H - 8} textAnchor="middle" className="fc-tick">
                      {b.label}
                    </text>
                  )}
                </g>
              );
            })}
            <polyline points={line} className="fc-line" />
            {data.map((b, i) => (
              <circle key={i} cx={L + slot * i + slot / 2} cy={y(b.revenue - b.expense)} r="3" className="fc-line-dot" />
            ))}
          </svg>
          <div className="fc-legend">
            <span><i className="rev" />รายได้</span>
            <span><i className="exp" />ค่าใช้จ่าย</span>
            <span><i className="line" />กำไร</span>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- targets ----------
function TargetsCard({ d, go }: { d: FinanceOverview; go: (t: Tab) => void }) {
  const { revenue, profit, expenseCap } = d.targets,
    t = d.totals,
    rows = [
      revenue !== null && { icon: TrendingUp, tone: "green", label: "เป้าหมายรายได้", target: thb(revenue), p: pct(t.revenue, revenue) },
      profit !== null && { icon: ChartLine, tone: "violet", label: "เป้าหมายกำไร", target: thb(profit), p: profit > 0 ? pct(t.profit, profit) : 0 },
      expenseCap !== null && { icon: Shield, tone: "pink", label: "ควบคุมค่าใช้จ่าย", target: "≤ " + thb(expenseCap), p: pct(t.expense, expenseCap) },
    ].filter(Boolean) as { icon: React.ComponentType<{ size?: number }>; tone: string; label: string; target: string; p: number }[];
  const fixed = sampleExtras(d)?.targetPct;
  if (fixed && rows.length === 3) [fixed.revenue, fixed.profit, fixed.expenseCap].forEach((p, i) => (rows[i].p = p));
  return (
    <Card title={`เป้าหมายปี ${d.year}`} icon={Target} className="fc-targets">
      {!rows.length ? (
        <Empty
          title="ยังไม่ได้ตั้งเป้าหมาย"
          description="ตั้งเป้ารายได้ กำไร และเพดานค่าใช้จ่ายของปี"
          action={d.canManage && <button className="primary" onClick={() => go("plan")}>ตั้งเป้าหมาย</button>}
        />
      ) : (
        <ul className="fc-target-list">
          {rows.map((r) => (
            <li key={r.label} className={r.tone}>
              <span className="fc-target-icon">
                <r.icon size={16} />
              </span>
              <div>
                <div className="fc-target-top">
                  <span>{r.label}</span>
                  <b>{r.target}</b>
                </div>
                <div className="fc-progress" role="progressbar" aria-label={r.label} aria-valuenow={Math.round(r.p)} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: Math.min(100, Math.max(0, r.p)) + "%" }} />
                </div>
                <small>{Math.round(r.p)}%</small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- department performance ----------
function DeptTable({ d, go }: { d: FinanceOverview; go: (t: Tab) => void }) {
  const rows = d.byDept,
    sum = (k: "budget" | "spent" | "revenue") => rows.reduce((s, r) => s + r[k], 0),
    total = { budget: sum("budget"), spent: sum("spent"), revenue: sum("revenue") };
  return (
    <Card title="ผลการดำเนินงานรายแผนก (สะสมถึงปัจจุบัน)" icon={ChartColumn} className="fc-perf">
      {!rows.length ? (
        <Empty
          title="ยังไม่มีงบหรือรายการของแผนกในปีนี้"
          action={d.canManage && <button className="secondary" onClick={() => go("allocate")}>ตั้งงบประมาณ</button>}
        />
      ) : (
        <>
          <div className="fc-table-wrap">
            <table className="fc-table">
              <thead>
                <tr>
                  <th>แผนก</th>
                  <th>งบประมาณ</th>
                  <th>ใช้ไป</th>
                  <th>คงเหลือ</th>
                  <th>รายได้</th>
                  <th>กำไร/(ขาดทุน)</th>
                  <th>ใช้งบ (%)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <PerfRow key={r.id} id={r.id} label={r.label} budget={r.budget} spent={r.spent} revenue={r.revenue} />
                ))}
              </tbody>
              <tfoot>
                <PerfRow id="total" label="รวม" {...total} />
              </tfoot>
            </table>
          </div>
          <ul className="fc-perf-mobile">
            {rows.map((r) => {
              const Icon = deptIcons[r.id] || CircleDashed,
                p = pct(r.spent, r.budget);
              return (
                <li key={r.id}>
                  <Icon size={15} />
                  <span>{r.label}</span>
                  <small>
                    ใช้ {thb(r.spent)}
                    {r.budget ? " / " + thb(r.budget) : ""}
                  </small>
                  <div className={"fc-progress" + (p > 100 ? " over" : "")}>
                    <i style={{ width: Math.min(100, p) + "%" }} />
                  </div>
                  <b>{r.budget ? Math.round(p) + "%" : "–"}</b>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
function PerfRow({ id, label, budget, spent, revenue }: { id: string; label: string; budget: number; spent: number; revenue: number }) {
  const Icon = deptIcons[id],
    left = budget - spent,
    profit = revenue - spent,
    p = pct(spent, budget);
  return (
    <tr className={id === "total" ? "fc-total" : ""}>
      <th scope="row">
        {Icon && <Icon size={15} />}
        {label}
      </th>
      <td>{budget ? thb(budget) : "-"}</td>
      <td>{thb(spent)}</td>
      <td className={budget ? (left < 0 ? "down" : "up") : ""}>{budget ? thb(left) : "-"}</td>
      <td>{revenue ? thb(revenue) : "-"}</td>
      <td className={profit < 0 ? "down" : profit > 0 ? "up" : ""}>{revenue || spent ? thb(profit) : "-"}</td>
      <td>
        {budget ? (
          <span className="fc-usage">
            <b>{Math.round(p)}%</b>
            <span className={"fc-progress" + (p > 100 ? " over" : "")}>
              <i style={{ width: Math.min(100, p) + "%" }} />
            </span>
          </span>
        ) : (
          "-"
        )}
      </td>
    </tr>
  );
}

function SummaryCard({ d }: { d: FinanceOverview }) {
  const t = d.totals;
  const rows: [React.ComponentType<{ size?: number }>, string, string, number][] = [
    [TrendingUp, "green", "รายได้รวม", t.revenue],
    [Wallet, "pink", "ค่าใช้จ่ายรวม", t.expense],
    [ChartColumn, "blue", "กำไรก่อนภาษี", t.profit],
    [Percent, "amber", "ภาษีเงินได้นิติบุคคล (20%)", t.tax],
  ];
  return (
    <Card title="สรุปผลการดำเนินงานองค์กร" icon={ReceiptText} className="fc-summary">
      <ul className="fc-sum-list">
        {rows.map(([Icon, tone, label, v]) => (
          <li key={label}>
            <span className={"fc-sum-icon " + tone}>
              <Icon size={15} />
            </span>
            <span>{label}</span>
            <b className={label === "ภาษีเงินได้นิติบุคคล (20%)" ? "down" : v < 0 ? "down" : label === "กำไรก่อนภาษี" ? "up" : ""}>{thb(v)}</b>
          </li>
        ))}
      </ul>
      <div className="fc-net">
        <Coins size={18} />
        <span>กำไรสุทธิ</span>
        <b>{thb(t.net)}</b>
      </div>
    </Card>
  );
}

function StatusCard({ d, go, navigate }: { d: FinanceOverview; go: (t: Tab) => void; navigate?: (v: string) => void }) {
  const x = sampleExtras(d),
    set = x ? x.budgetItems : d.byDept.filter((r) => r.budget > 0).length + (d.budgets.Reserve ? 1 : 0),
    over = x ? x.overBudget : d.byDept.filter((r) => r.budget > 0 && r.spent > r.budget).length;
  return (
    <Card title="สถานะงบประมาณ" icon={ClipboardList} className="fc-status">
      <ul className="fc-status-list">
        <li>
          <CircleCheck size={18} className="ok" />
          <span>งบแผนกที่ตั้งแล้ว</span>
          <b>{set} รายการ</b>
        </li>
        <li>
          <Clock size={18} className="wait" />
          <span>ค่าใช้จ่ายรออนุมัติ</span>
          {navigate ? (
            <button className="fc-link" onClick={() => navigate("expenses?filter=pending")}>
              {d.pendingExpenses} รายการ
            </button>
          ) : (
            <b>{d.pendingExpenses} รายการ</b>
          )}
        </li>
        <li>
          <CircleAlert size={18} className="bad" />
          <span>ใช้งบเกินแผน</span>
          <b>{over} แผนก</b>
        </li>
      </ul>
      {!navigate && (
        <button className="fc-outline" onClick={() => go("track")}>
          <FileSearch size={16} />
          ดูรายละเอียด
        </button>
      )}
    </Card>
  );
}

// ---------- years & closing ----------
function YearsTable({ d }: { d: FinanceOverview }) {
  const ys = d.years;
  return (
    <Card title="เปรียบเทียบผลการดำเนินงานหลายปี" icon={Layers} className="fc-years">
      {ys.every((y) => !y.revenue && !y.expense) ? (
        <Empty title="ยังไม่มีข้อมูลรายได้หรือค่าใช้จ่ายย้อนหลัง" />
      ) : (
        <div className="fc-table-wrap">
          <table className="fc-table">
            <thead>
              <tr>
                <th>ปีบัญชี</th>
                <th>รายได้</th>
                <th>ค่าใช้จ่าย</th>
                <th>กำไรสุทธิ</th>
                <th>อัตรากำไร</th>
                <th>เติบโต (รายได้)</th>
              </tr>
            </thead>
            <tbody>
              {ys.map((y, i) => (
                <YearRow key={y.year} y={y} prev={ys[i + 1]} current={y.year === d.year} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
function YearRow({ y, prev, current }: { y: YearTotals; prev?: YearTotals; current: boolean }) {
  const growth = prev && prev.revenue ? pct(y.revenue - prev.revenue, prev.revenue) : null;
  return (
    <tr>
      <th scope="row">
        <span className={current ? "fc-year-pill" : ""}>{y.year}</span>
      </th>
      <td>{thb(y.revenue)}</td>
      <td>{thb(y.expense)}</td>
      <td className={y.net < 0 ? "down" : "up"}>{thb(y.net)}</td>
      <td>{y.revenue ? pctText(pct(y.net, y.revenue)) : "-"}</td>
      <td className={growth === null ? "" : growth < 0 ? "down" : "up"}>{growth === null ? "-" : (growth > 0 ? "+" : "") + pctText(growth)}</td>
    </tr>
  );
}

function ClosingCard({ d, saved, notify, large }: { d: FinanceOverview; saved?: (m: string) => void; notify?: (m: string) => void; large?: boolean }) {
  const done = new Map(d.closing.map((c) => [c.step, c.doneAt])),
    current = closingSteps.find((s) => !done.has(s.step))?.step || 0,
    [busy, setBusy] = useState(0),
    yy = (next: boolean) => String(beYear(d.year + (next ? 1 : 0))).slice(-2),
    sample = useSample();
  const toggle = async (step: number, value: boolean) => {
    if (sample) return;
    setBusy(step);
    try {
      await api("/finance/closing", { method: "POST", body: { year: d.year, step, done: value } });
      saved?.(value ? "บันทึกขั้นตอนเสร็จแล้ว" : "เปิดขั้นตอนอีกครั้งแล้ว");
    } catch (e) {
      notify?.((e as Error).message);
    } finally {
      setBusy(0);
    }
  };
  return (
    <Card title={`กรอบการปิดงบประจำปี (${d.year})`} icon={CircleCheck} className={"fc-closing" + (large ? " large" : "")}>
      <ol className="fc-steps">
        {closingSteps.map((s) => {
          const state = done.has(s.step) ? "done" : s.step === current ? "current" : "pending",
            last = [...done.keys()].sort((a, b) => b - a)[0];
          return (
            <li key={s.step} className={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="fc-step-dot">{state === "done" ? <Check size={14} /> : s.step}</span>
              <strong>{s.label}</strong>
              <small>
                ({s.month} {yy(s.next)})
              </small>
              {large && (
                <div className="fc-step-act">
                  {state === "done" && <em>เสร็จ {thaiDate(done.get(s.step)!, { day: "numeric", month: "short", year: "2-digit" })}</em>}
                  {d.canManage && state === "current" && (
                    <button className="primary" disabled={!!busy} onClick={() => toggle(s.step, true)}>
                      <Check size={14} />
                      ทำเสร็จแล้ว
                    </button>
                  )}
                  {d.canManage && state === "done" && s.step === last && (
                    <button className="secondary" disabled={!!busy} onClick={() => toggle(s.step, false)}>
                      <Undo2 size={14} />
                      เปิดอีกครั้ง
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {large && !d.canManage && (
        <p className="fc-note">
          <Lock size={13} /> {sample ? readOnlyNote(true) : "เฉพาะเจ้าของหรือผู้จัดการฝ่ายการเงินที่บันทึกขั้นตอนได้"}
        </p>
      )}
      {large && current === 0 && <p className="fc-note ok">ปิดงบปี {d.year} ครบทุกขั้นตอนแล้ว</p>}
    </Card>
  );
}

// ---------- planning tabs ----------
const parseAmount = (s: string) => {
  const n = Number(s.replace(/[,\s฿]/g, ""));
  return s.trim() === "" ? null : Number.isFinite(n) ? n : NaN;
};
function PlanTab({ d, saved }: { d: FinanceOverview; saved: (m: string) => void }) {
  const init = (v: number | null) => (v === null ? "" : String(v));
  const [f, setF] = useState({ revenue: init(d.targets.revenue), profit: init(d.targets.profit), expenseCap: init(d.targets.expenseCap) }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    sample = useSample();
  const budget = Object.values(d.budgets).reduce((s, v) => s + v, 0),
    last = d.years.find((y) => y.year === d.year - 1);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sample || !d.canManage) return;
    const v = { revenue: parseAmount(f.revenue), profit: parseAmount(f.profit), expenseCap: parseAmount(f.expenseCap) };
    if (Object.values(v).some((x) => Number.isNaN(x)) || (v.revenue ?? 0) < 0 || (v.expenseCap ?? 0) < 0) return setError("กรุณากรอกตัวเลขให้ถูกต้อง");
    setBusy(true);
    setError("");
    try {
      await api("/finance/targets", { method: "POST", body: { year: d.year, ...v } });
      saved("บันทึกเป้าหมายปี " + d.year + " แล้ว");
    } catch (er) {
      setError((er as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fields: [keyof typeof f, string, string][] = [
    ["revenue", "เป้าหมายรายได้ทั้งปี", last ? "ปี " + last.year + " ทำได้ " + thb(last.revenue) : ""],
    ["profit", "เป้าหมายกำไร (ก่อนภาษี)", last ? "ปี " + last.year + " ทำได้ " + thb(last.profit) : ""],
    ["expenseCap", "เพดานค่าใช้จ่ายทั้งปี", budget ? "งบประมาณรวมที่ตั้งไว้ " + thb(budget) : ""],
  ];
  return (
    <div className="fc-grid fc-grid-2">
      <Card title={`เป้าหมายปี ${d.year}`} icon={Target}>
        <form className="fc-form" onSubmit={submit}>
          {fields.map(([k, label, hint]) => (
            <label key={k}>
              <span>{label} (บาท)</span>
              <input inputMode="decimal" value={f[k]} disabled={!d.canManage} placeholder="เว้นว่าง = ไม่ตั้ง" onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              {hint && <small>{hint}</small>}
            </label>
          ))}
          {error && <p className="form-error">{error}</p>}
          {d.canManage ? (
            <button className="primary" disabled={busy}>
              <Save size={16} />
              บันทึกเป้าหมาย
            </button>
          ) : (
            <p className="fc-note"><Lock size={13} /> {readOnlyNote(sample)}</p>
          )}
        </form>
      </Card>
      <TargetsCard d={d} go={() => {}} />
      <BudgetEditor d={d} saved={saved} />
    </div>
  );
}

function AllocateTab({ d, saved }: { d: FinanceOverview; saved: (m: string) => void }) {
  return (
    <div className="fc-grid fc-grid-2">
      <BudgetEditor d={d} saved={saved} preview />
    </div>
  );
}

function BudgetEditor({ d, saved, preview }: { d: FinanceOverview; saved: (m: string) => void; preview?: boolean }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(d.departments.map((x) => [x.id, d.budgets[x.id] ? String(d.budgets[x.id]) : ""]))),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const parsed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, parseAmount(v)])),
    invalid = Object.values(parsed).some((v) => v !== null && (Number.isNaN(v) || v < 0)),
    budgets = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v && v > 0) as [string, number][]),
    a = allocation(d, budgets),
    spent = new Map(d.byDept.map((r) => [r.id, r.spent])),
    sample = useSample();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sample || !d.canManage) return;
    if (invalid) return setError("กรุณากรอกตัวเลขที่ไม่ติดลบ");
    setBusy(true);
    setError("");
    try {
      await api("/finance/budgets", { method: "POST", body: { year: d.year, budgets } });
      saved("บันทึกงบประมาณปี " + d.year + " แล้ว");
    } catch (er) {
      setError((er as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card title={`งบประมาณรายแผนก ปี ${d.year}`} icon={Wallet} className="fc-editor">
        <form className="fc-form" onSubmit={submit}>
          <div className="fc-budget-rows">
            {d.departments.map((x) => {
              const Icon = deptIcons[x.id] || CircleDashed,
                used = spent.get(x.id) || 0;
              return (
                <label key={x.id} className={x.id === "Reserve" ? "reserve" : ""}>
                  <span className="fc-budget-name">
                    <Icon size={15} />
                    {x.label}
                  </span>
                  <input
                    inputMode="decimal"
                    aria-label={"งบประมาณ " + x.label}
                    value={values[x.id]}
                    disabled={!d.canManage}
                    placeholder="0"
                    onChange={(e) => setValues({ ...values, [x.id]: e.target.value })}
                  />
                  <small>{used ? "ใช้ไปแล้ว " + thb(used) : ""}</small>
                </label>
              );
            })}
          </div>
          <div className="fc-budget-total">
            <span>รวมงบประมาณทั้งปี</span>
            <b>{thb(a.total)}</b>
          </div>
          {error && <p className="form-error">{error}</p>}
          {d.canManage ? (
            <button className="primary" disabled={busy || invalid}>
              <Save size={16} />
              บันทึกงบประมาณ
            </button>
          ) : (
            <p className="fc-note"><Lock size={13} /> {readOnlyNote(sample)}</p>
          )}
        </form>
      </Card>
      {preview && (
        <Card title="สัดส่วนการจัดสรร" icon={ChartColumn} className="fc-alloc">
          {a.total ? (
            <div className="fc-alloc-body">
              <Donut parts={a.rows.map((r) => ({ id: r.id, value: r.amount, color: r.color }))} center={thb(a.depts.reduce((s, x) => s + x.amount, 0))} caption="งบจัดสรรแผนก" />
              <AllocationList rows={a.rows} total={a.total} />
            </div>
          ) : (
            <Empty title="กรอกงบแต่ละแผนกเพื่อดูสัดส่วน" />
          )}
        </Card>
      )}
    </>
  );
}

// Every tax in one place: ภ.พ.30 (sales VAT − purchase VAT), withholding to remit, and the CIT estimate.
type TaxRow = { month: string; vat: number; pnd3: number; pnd53: number; outVat?: number; income?: number };
function TaxCard({ d, navigate }: { d: FinanceOverview; navigate: (v: string) => void }) {
  const sample = useSample(),
    [rows, setRows] = useState<TaxRow[] | null>(null);
  useEffect(() => {
    if (!sample) api("/tax-report").then(setRows).catch(() => setRows([]));
  }, [sample]);
  const month = (d.today || new Date().toISOString()).slice(0, 7),
    year = rows?.filter((r) => r.month.startsWith(String(d.year))) || [],
    sum = (f: (r: TaxRow) => number) => Math.round(year.reduce((s, r) => s + f(r), 0) * 100) / 100,
    now = rows?.find((r) => r.month === month),
    outVat = sum((r) => r.outVat || 0),
    inVat = sum((r) => r.vat),
    vatNow = Math.round(((now?.outVat || 0) - (now?.vat || 0)) * 100) / 100,
    whtNow = Math.round(((now?.pnd3 || 0) + (now?.pnd53 || 0)) * 100) / 100,
    show = (v: number) => (sample || !rows ? "—" : thb(v));
  const items: [string, string, string, string][] = [
    ["ภาษีขายทั้งปี", show(outVat), "จากใบแจ้งหนี้", "green"],
    ["ภาษีซื้อทั้งปี", show(inVat), "จากค่าใช้จ่ายที่ตรวจแล้ว", "blue"],
    [
      "ภ.พ.30 เดือนนี้",
      sample || !rows ? "—" : vatNow >= 0 ? thb(vatNow) : "ขอคืน " + thb(-vatNow),
      vatNow > 0 ? "ต้องชำระภายในวันที่ 15 เดือนหน้า" : "ภาษีขาย − ภาษีซื้อ",
      "pink",
    ],
    ["หัก ณ ที่จ่ายค้างนำส่ง", show(whtNow), "ภ.ง.ด.3 / ภ.ง.ด.53 เดือนนี้", "amber"],
    ["ภาษีเงินได้นิติบุคคล", thb(d.totals.tax), "ประมาณการ 20% ของกำไร", "purple"],
  ];
  return (
    <Card
      title={`ภาษี ปี ${d.year}`}
      icon={Landmark}
      className="fc-tax"
      action={
        <span className="fc-tax-links">
          <button className="fc-link" onClick={() => navigate("income")}>รายรับ</button>
          <button className="fc-link" onClick={() => navigate("expenses")}>ค่าใช้จ่าย</button>
        </span>
      }
    >
      <div className="fc-tax-grid">
        {items.map(([label, value, note, tone]) => (
          <div key={label} className={"fc-tax-item " + tone}>
            <span>{label}</span>
            <b>{value}</b>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <p className="fc-note">ตัวเลขคำนวณจากรายการในระบบ ยังไม่รวมรายการปรับปรุงทางภาษี — ตัวเลขจริงให้ผู้สอบบัญชียืนยัน</p>
    </Card>
  );
}

function CompareTab({ d }: { d: FinanceOverview }) {
  const ys = [...d.years].reverse(),
    max = niceMax(Math.max(0, ...ys.map((y) => Math.max(y.revenue, y.expense))));
  return (
    <>
      <YearsTable d={d} />
      {ys.some((y) => y.revenue || y.expense) && (
        <Card title="รายได้ ค่าใช้จ่าย และกำไรสุทธิรายปี" icon={ChartColumn}>
          <div className="fc-ybars">
            {ys.map((y) => (
              <div key={y.year} className="fc-ybar">
                <span>{y.year}</span>
                {([["rev", "รายได้", y.revenue], ["exp", "ค่าใช้จ่าย", y.expense], ["net", "กำไรสุทธิ", y.net]] as const).map(([k, label, v]) => (
                  <div key={k} className="fc-ybar-row">
                    <small>{label}</small>
                    <div className="fc-ybar-track">
                      <i className={k + (v < 0 ? " neg" : "")} style={{ width: Math.min(100, (Math.abs(v) / max) * 100) + "%" }} />
                    </div>
                    <b className={v < 0 ? "down" : ""}>{thb(v)}</b>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
