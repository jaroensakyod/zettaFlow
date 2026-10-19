"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Download,
  TriangleAlert,
  Clock,
  Info,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { statusLabels } from "@/lib/catalog";
import type { Context, Entity, HomeData } from "@/lib/types";
import { api, money, displayDate, Loading, Empty } from "./shared";

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
const priorityLabels: Record<string, string> = {
  urgent: "ด่วน",
  high: "สำคัญ",
  normal: "ปกติ",
};
const taskStatuses = [
  ["all", "ทั้งหมด"],
  ["pending", "ยังไม่เริ่ม"],
  ["progress", "กำลังทำ"],
  ["review", "รอตรวจ"],
  ["done", "เสร็จแล้ว"],
];
const weekdays = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: BKK });
const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayDiff = (a: string, b: string) =>
  Math.round(
    (Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5,
  );
const thai = (s: string, o: Intl.DateTimeFormatOptions) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("th-TH", {
    ...o,
    timeZone: "UTC",
  });
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
  const hour =
    Number(
      new Date().toLocaleString("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: BKK,
      }),
    ) % 24;
  return hour < 12
    ? "สวัสดีตอนเช้า"
    : hour < 17
      ? "สวัสดีตอนบ่าย"
      : "สวัสดีตอนเย็น";
};
// Range of an entry on the calendar: events and projects span days, tasks sit on their due date.
const entrySpan = (e: Entity) => {
  const d = e.data,
    start = String(d.startDate || d.dueDate || d.date || ""),
    end = String(d.endDate || start);
  return [start, end < start ? start : end];
};

type Summary = {
  pendingDeals: number;
  lowStock: Entity[];
  widgets?: {
    key: string;
    name: string;
    label: string;
    total: number;
    count: number;
  }[];
};
export function HomeDashboard({
  ctx,
  summary,
  navigate,
  refreshKey,
}: {
  ctx: Context;
  summary: Summary;
  navigate: (v: string) => void;
  refreshKey: number;
}) {
  const [home, setHome] = useState<HomeData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api("/home")
      .then((d) => live && (setHome(d), setError("")))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [refreshKey]);
  const today = todayIso(),
    firstName = ctx.user.name.trim().split(/\s+/)[0] || ctx.user.name;
  return (
    <>
      <div className="page-heading home-heading">
        <div>
          <h1>
            {greeting()}, คุณ {firstName}
          </h1>
          <p>
            {thai(today, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="heading-actions">
          <button className="secondary" onClick={() => navigate("reports")}>
            <Download size={15} />
            ส่งออกรายงาน
          </button>
          <button className="primary" onClick={() => navigate("tasks")}>
            <Plus size={15} />
            สร้างงานใหม่
          </button>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="home-top">
        <div className="home-side">
          <MiniCalendar today={today} navigate={navigate} />
          <Alerts
            today={today}
            summary={summary}
            tasks={home?.tasks || []}
            navigate={navigate}
          />
        </div>
        {home ? (
          <FinanceCard today={today} home={home} />
        ) : (
          <section className="card">
            <Loading />
          </section>
        )}
      </div>
      {home && (
        <TaskBoard today={today} tasks={home.tasks} navigate={navigate} />
      )}
      {!!summary.widgets?.length && (
        <section className="card dynamic-widgets">
          <div className="card-heading">
            <h2>ข้อมูลตาม Data Template</h2>
            <span className="muted">ปรับตามฟิลด์ตัวเลขที่กำหนด</span>
          </div>
          <div className="widget-grid">
            {summary.widgets.map((w) => (
              <div className="widget-item" key={w.key}>
                <span>
                  {w.name} · {w.label}
                </span>
                <strong>{money(w.total)}</strong>
                <small>{w.count} รายการที่อนุมัติ</small>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function MiniCalendar({
  today,
  navigate,
}: {
  today: string;
  navigate: (v: string) => void;
}) {
  const [month, setMonth] = useState(today.slice(0, 7)),
    [selected, setSelected] = useState(today),
    [entries, setEntries] = useState<Entity[]>([]);
  useEffect(() => {
    let live = true;
    api("/calendar?month=" + month)
      .then((rows) => live && setEntries(rows))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [month]);
  const [y, m] = month.split("-").map(Number),
    first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
    days = new Date(Date.UTC(y, m, 0)).getUTCDate(),
    on = (day: string) =>
      entries.filter((e) => {
        const [start, end] = entrySpan(e);
        return start && start <= day && day <= end;
      }),
    shift = (n: number) => {
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      setMonth(d.toISOString().slice(0, 7));
    },
    agenda = on(selected);
  return (
    <section className="card mini-cal">
      <div className="mini-cal-head">
        <strong>{thai(month + "-01", { month: "long", year: "numeric" })}</strong>
        <div>
          <button
            className="icon-button"
            aria-label="เดือนก่อนหน้า"
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="เดือนถัดไป"
            onClick={() => shift(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="mini-cal-grid">
        {weekdays.map((d) => (
          <span className="mini-cal-dow" key={d}>
            {d}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={"blank" + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              key={day}
              className={
                "mini-cal-day" +
                (day === today ? " today" : "") +
                (day === selected ? " selected" : "")
              }
              onClick={() => setSelected(day)}
            >
              {i + 1}
              {on(day).length > 0 && <i />}
            </button>
          );
        })}
      </div>
      <div className="mini-cal-legend">
        <span>
          <i className="dot" />
          มีกิจกรรม / งาน
        </span>
        <span>
          <i className="ring" />
          วันนี้
        </span>
      </div>
      <div className="agenda">
        <div className="agenda-head">
          <strong>
            {selected === today ? "วันนี้ · " : ""}
            {thai(selected, { weekday: "long", day: "numeric", month: "short" })}
          </strong>
          <small>{agenda.length} รายการ</small>
        </div>
        {agenda.slice(0, 4).map((e) => (
          <button
            key={e.id}
            className={"agenda-item " + e.kind}
            onClick={() => navigate(e.kind)}
          >
            <strong>{String(e.data.name)}</strong>
            <small>
              {kindLabels[e.kind]}
              {e.data.location ? " · " + String(e.data.location) : ""}
              {e.kind === "tasks" && e.data.department
                ? " · " + (deptLabels[String(e.data.department)] || String(e.data.department))
                : ""}
            </small>
          </button>
        ))}
        {!agenda.length && <p className="agenda-empty">ไม่มีกำหนดการ</p>}
        <button className="secondary full" onClick={() => navigate("events")}>
          <Plus size={14} />
          เพิ่มนัดหมาย
        </button>
      </div>
    </section>
  );
}

function Alerts({
  today,
  summary,
  tasks,
  navigate,
}: {
  today: string;
  summary: Summary;
  tasks: Entity[];
  navigate: (v: string) => void;
}) {
  const open = tasks.filter((t) => t.data.status !== "done" && t.data.dueDate),
    overdue = open.filter((t) => String(t.data.dueDate) < today),
    soon = open.filter((t) => {
      const diff = dayDiff(String(t.data.dueDate), today);
      return diff >= 0 && diff <= 3;
    });
  const items: {
    tone: "danger" | "warn" | "info";
    icon: LucideIcon;
    title: string;
    note: string;
    view: string;
  }[] = [
    ...summary.lowStock.slice(0, 3).map((p) => ({
      tone: "danger" as const,
      icon: TriangleAlert,
      title: "สินค้าใกล้หมด: " + String(p.data.name),
      note: `เหลือ ${money(p.data.stock)} · จุดสั่งซื้อ ${money(p.data.reorderLevel)}`,
      view: "products",
    })),
    ...(overdue.length
      ? [
          {
            tone: "danger" as const,
            icon: TriangleAlert,
            title: `งานเลยกำหนด ${overdue.length} งาน`,
            note: String(overdue[0].data.name),
            view: "tasks",
          },
        ]
      : []),
    ...(soon.length
      ? [
          {
            tone: "warn" as const,
            icon: Clock,
            title: `งานครบกำหนดใน 3 วัน ${soon.length} งาน`,
            note: String(soon[0].data.name),
            view: "tasks",
          },
        ]
      : []),
    ...(summary.pendingDeals
      ? [
          {
            tone: "info" as const,
            icon: Info,
            title: `ดีลรออนุมัติ ${summary.pendingDeals} รายการ`,
            note: "ตรวจและยืนยันดีลจากทีม",
            view: "deals",
          },
        ]
      : []),
  ];
  return (
    <section className="card home-alerts">
      <div className="card-heading">
        <h2>แจ้งเตือน</h2>
        {items.length > 0 && (
          <span className="alert-count">{items.length} ใหม่</span>
        )}
      </div>
      {items.map((a) => (
        <button
          key={a.title}
          className={"home-alert " + a.tone}
          onClick={() => navigate(a.view)}
        >
          <a.icon size={16} />
          <span>
            <strong>{a.title}</strong>
            <small>{a.note}</small>
          </span>
        </button>
      ))}
      {!items.length && <p className="agenda-empty">ไม่มีเรื่องที่ต้องติดตาม</p>}
    </section>
  );
}

type Period = "day" | "week" | "month" | "year";
function buckets(period: Period, today: string) {
  if (period === "day" || period === "week")
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(today, i - 6);
      return {
        label: weekdays[new Date(d + "T00:00:00Z").getUTCDay()] + ".",
        from: d,
        to: d,
      };
    });
  if (period === "month") {
    const start = today.slice(0, 8) + "01",
      [y, m] = today.split("-").map(Number),
      last = new Date(Date.UTC(y, m, 0)).getUTCDate(),
      out = [];
    for (let d = 1; d <= last; d += 7) {
      const end = Math.min(last, d + 6);
      out.push({
        label: `${d}–${end}`,
        from: addDays(start, d - 1),
        to: addDays(start, end - 1),
      });
    }
    return out;
  }
  const year = today.slice(0, 4);
  return Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0"),
      last = new Date(Date.UTC(Number(year), i + 1, 0)).getUTCDate();
    return {
      label: thai(`${year}-${mm}-01`, { month: "short" }),
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-${last}`,
    };
  });
}
function FinanceCard({ today, home }: { today: string; home: HomeData }) {
  const [period, setPeriod] = useState<Period>("week"),
    [project, setProject] = useState("all");
  const view = useMemo(() => {
    const rows = home.finance.filter(
        (r) => project === "all" || r.projectId === project,
      ),
      sum = (from: string, to: string, kind: string) =>
        rows
          .filter((r) => r.kind === kind && r.date >= from && r.date <= to)
          .reduce((s, r) => s + r.amount, 0),
      groups = buckets(period, today).map((b) => {
        const sales = sum(b.from, b.to, "sales"),
          cost = sum(b.from, b.to, "expenses");
        return { ...b, sales, cost, profit: sales - cost };
      }),
      [from, to] =
        period === "day"
          ? [today, today]
          : [groups[0].from, groups[groups.length - 1].to],
      sales = sum(from, to, "sales"),
      cost = sum(from, to, "expenses");
    return {
      groups,
      empty: groups.every((g) => !g.sales && !g.cost),
      sales,
      cost,
      profit: sales - cost,
      max: niceMax(
        Math.max(0, ...groups.flatMap((g) => [g.sales, g.cost, g.profit])),
      ),
      range:
        period === "day"
          ? "วันนี้ · " + thai(today, { day: "numeric", month: "short" })
          : period === "week"
            ? `7 วันล่าสุด · ${thai(from, { day: "numeric" })}–${thai(to, { day: "numeric", month: "short" })}`
            : period === "month"
              ? "เดือน " + thai(today, { month: "long", year: "numeric" })
              : "ปี " + thai(today, { year: "numeric" }),
    };
  }, [home, period, project, today]);
  const margin = view.sales ? (view.profit / view.sales) * 100 : 0;
  return (
    <section className="card fin-card">
      <div className="fin-head">
        <div>
          <h2>ยอดขาย ทุน และกำไร</h2>
          <p>{view.range} · ข้อมูลจากรายการที่ยืนยันแล้ว</p>
        </div>
        <div className="fin-controls">
          <label className="inline-select">
            สาขา
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="all">ทุกสาขา</option>
              {home.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="tablist">
            {(
              [
                ["day", "วันนี้"],
                ["week", "รายสัปดาห์"],
                ["month", "รายเดือน"],
                ["year", "รายปี"],
              ] as [Period, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={period === key}
                className={period === key ? "active" : ""}
                onClick={() => setPeriod(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="fin-kpis">
        <div className="fin-kpi sales">
          <span>ยอดขาย</span>
          <strong>฿{money(view.sales)}</strong>
        </div>
        <div className="fin-kpi cost">
          <span>ทุน</span>
          <strong>฿{money(view.cost)}</strong>
        </div>
        <div className={"fin-kpi profit" + (view.profit < 0 ? " loss" : "")}>
          <span>{view.profit < 0 ? "ขาดทุน" : "กำไร"}</span>
          <strong>฿{money(view.profit)}</strong>
        </div>
        <div className="fin-kpi margin">
          <span>อัตรากำไร</span>
          <strong>{margin.toFixed(1)}%</strong>
        </div>
      </div>
      <div className={"fin-chart" + (view.empty ? " empty" : "")}>
        {view.empty && (
          <p className="fin-empty">ยังไม่มียอดขายหรือค่าใช้จ่ายที่ยืนยันในช่วงนี้</p>
        )}
        <div className="fin-axis">
          <span>฿{compact(view.max)}</span>
          <span>฿{compact(view.max / 2)}</span>
          <span>฿0</span>
        </div>
        <div className="fin-bars">
          {view.groups.map((g) => (
            <div className="fin-group" key={g.from}>
              <div className="fin-trio">
                {(
                  [
                    ["sales", g.sales, "ยอดขาย"],
                    ["cost", g.cost, "ทุน"],
                    ["profit", Math.max(0, g.profit), "กำไร"],
                  ] as [string, number, string][]
                ).map(([key, value, label]) => (
                  <i
                    key={key}
                    className={key}
                    style={{ height: (value / view.max) * 100 + "%" }}
                    title={`${label} ฿${money(value)}`}
                  />
                ))}
              </div>
              <small>{g.label}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="fin-foot">
        <div className="fin-legend">
          <span>
            <i className="sales" />
            ยอดขาย
          </span>
          <span>
            <i className="cost" />
            ทุน
          </span>
          <span>
            <i className="profit" />
            กำไร
          </span>
        </div>
        <small>หน่วย: บาท · ทุน = ค่าใช้จ่ายที่อนุมัติหรือจ่ายแล้ว</small>
      </div>
    </section>
  );
}

function TaskBoard({
  today,
  tasks,
  navigate,
}: {
  today: string;
  tasks: Entity[];
  navigate: (v: string) => void;
}) {
  const [dept, setDept] = useState("all"),
    [status, setStatus] = useState("all");
  const depts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      const d = String(t.data.department || t.department);
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [tasks]);
  const inDept = tasks.filter(
      (t) => dept === "all" || String(t.data.department || t.department) === dept,
    ),
    shown = inDept
      .filter((t) => status === "all" || t.data.status === status)
      .sort(
        (a, b) =>
          Number(a.data.status === "done") - Number(b.data.status === "done") ||
          String(a.data.dueDate || "9999").localeCompare(
            String(b.data.dueDate || "9999"),
          ),
      );
  return (
    <section className="card home-tasks">
      <div className="card-heading">
        <div>
          <h2>งานทั้งหมดทุกแผนก</h2>
          <p>ดูงานของทุกแผนกในหน้าเดียว เรียงตามวันครบกำหนด</p>
        </div>
        <button className="text-button" onClick={() => navigate("tasks")}>
          ดูทั้งหมด
          <ArrowRight size={14} />
        </button>
      </div>
      <div className="chip-row">
        <span className="chip-label">แผนก</span>
        <button
          className={"chip" + (dept === "all" ? " active" : "")}
          onClick={() => setDept("all")}
        >
          ทุกแผนก
        </button>
        {depts.map(([d, n]) => (
          <button
            key={d}
            className={"chip" + (dept === d ? " active" : "")}
            onClick={() => setDept(d)}
          >
            {deptLabels[d] || d}
            <b>{n}</b>
          </button>
        ))}
      </div>
      <div className="chip-row">
        <span className="chip-label">สถานะ</span>
        {taskStatuses.map(([key, label]) => (
          <button
            key={key}
            className={"chip" + (status === key ? " active" : "")}
            onClick={() => setStatus(key)}
          >
            {label}
            <b>
              {key === "all"
                ? inDept.length
                : inDept.filter((t) => t.data.status === key).length}
            </b>
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className="task-grid">
          {shown.slice(0, 8).map((t) => {
            const due = String(t.data.dueDate || ""),
              diff = due ? dayDiff(due, today) : null,
              done = t.data.status === "done",
              priority = String(t.data.priority || "normal"),
              assignee = String(t.data.assignee || "");
            return (
              <button
                key={t.id}
                className="task-card"
                onClick={() => navigate("tasks")}
              >
                <div className="task-card-top">
                  <span className="dept-tag">
                    {deptLabels[String(t.data.department)] ||
                      String(t.data.department || "—")}
                  </span>
                  <span className={"prio " + priority}>
                    {priorityLabels[priority] || priority}
                  </span>
                </div>
                <h3>{String(t.data.name)}</h3>
                {!!t.data.notes && (
                  <p className="task-card-note">{String(t.data.notes)}</p>
                )}
                <div className="task-card-meta">
                  <span className="avatar">{assignee[0] || "?"}</span>
                  <span>
                    <strong>{assignee || "ยังไม่มอบหมาย"}</strong>
                    <small>ผู้รับผิดชอบ</small>
                  </span>
                  <span
                    className={
                      "task-due" +
                      (!done && diff !== null && diff < 0 ? " late" : "")
                    }
                  >
                    <strong>{due ? displayDate(due) : "—"}</strong>
                    <small>
                      {done || diff === null
                        ? ""
                        : diff < 0
                          ? `เลย ${-diff} วัน`
                          : diff === 0
                            ? "วันนี้"
                            : `อีก ${diff} วัน`}
                    </small>
                  </span>
                </div>
                <div className="task-card-foot">
                  <span className={"badge " + String(t.data.status)}>
                    {statusLabels[String(t.data.status)] || String(t.data.status)}
                  </span>
                  <span className="task-card-link">
                    ดูรายละเอียดงาน
                    <ArrowRight size={13} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty
          title="ยังไม่มีงานในตัวกรองนี้"
          action={
            <button className="secondary" onClick={() => navigate("tasks")}>
              สร้างงานใหม่
            </button>
          }
        />
      )}
      {shown.length > 8 && (
        <button className="secondary task-more" onClick={() => navigate("tasks")}>
          ดูงานทั้งหมดของทุกแผนก ({shown.length})
        </button>
      )}
    </section>
  );
}
