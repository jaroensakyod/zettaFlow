"use client";
import { useEffect, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Users,
  Package,
  AlertTriangle,
  Share2,
  Download,
  MoreHorizontal,
  Home,
  FolderKanban,
  Plus,
  ChartNoAxesCombined,
} from "lucide-react";
import type { Context, Entity, ProjectInventory } from "@/lib/types";
import { api, Empty, money } from "./shared";
import { NumberCard, LineChart, Donut, amountSeries } from "./dashboard-charts";
import { projectNumbers, referenceImages } from "@/lib/zetta";
import { ProjectStages } from "./project-stages";
type Summary = {
  sales: number;
  expenses: number;
  projects: number;
  tasks: number;
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
export function ExecutiveDashboard({
  entities,
  summary: s,
  ctx,
  navigate,
  changed,
}: {
  entities: Entity[];
  summary: Summary;
  ctx: Context;
  navigate: (v: string, id?: string) => void;
  changed: () => void;
}) {
  const [report, setReport] = useState(false),
    [selected, setSelected] = useState("");
  const [inventory, setInventory] = useState<ProjectInventory[] | null>(null);
  useEffect(() => {
    let active = true;
    setInventory(null);
    if (
      ctx.member.role === "owner" ||
      ctx.member.departments.includes("Warehouse")
    ) {
      api("/transfers")
        .then((d) => {
          if (active) setInventory(d.inventory);
        })
        .catch(() => {
          if (active) setInventory(null);
        });
    }
    return () => {
      active = false;
    };
  }, [ctx.company.id, ctx.member.role, ctx.member.departments, entities]);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Bangkok",
  });
  const calendarDate = (offset: number) =>
    new Date(Date.parse(today + "T12:00:00Z") + offset * 86400000)
      .toISOString()
      .slice(0, 10);
  const nearDate = calendarDate(3);
  const projects = entities.filter((e) => e.kind === "projects"),
    tasks = entities.filter((e) => e.kind === "tasks"),
    sales = entities.filter(
      (e) => e.kind === "sales" && e.data.status === "confirmed",
    ),
    active = projects.filter(
      (p) => !["completed", "cancelled"].includes(String(p.data.status)),
    ),
    done = projects.filter((p) => p.data.status === "completed"),
    pending = entities.filter(
      (e) =>
        (e.kind === "deals" && e.data.status === "pending") ||
        (e.kind === "tasks" && e.data.status === "review") ||
        (e.kind === "purchases" && e.data.status === "draft"),
    ),
    near = tasks.filter(
      (t) =>
        t.data.status !== "done" &&
        t.data.dueDate &&
        String(t.data.dueDate) >= today &&
        String(t.data.dueDate) <= nearDate,
    ),
    late = tasks.filter(
      (t) =>
        t.data.status !== "done" &&
        t.data.dueDate &&
        String(t.data.dueDate) < today,
    ),
    dated = tasks.filter((t) => t.data.dueDate),
    todaySales = sales.filter((r) => r.data.date === today),
    currentProject =
      projects.find((p) => p.id === selected) || active[0] || projects[0];
  const weekSales = Array.from({ length: 7 }, (_, i) => {
    const date = calendarDate(i - 6);
    return {
      label: date.slice(5),
      value: sales
        .filter((r) => r.data.date === date)
        .reduce((total, r) => total + Number(r.data.amount || 0), 0),
    };
  });
  const projectStates = [
      {
        label: "Running",
        value: active.filter((p) => p.data.status === "active").length,
      },
      {
        label: "Waiting Approval",
        value: projects.filter((p) => p.data.status === "review").length,
      },
      {
        label: "Planning / Setup",
        value: projects.filter((p) => p.data.status === "planning").length,
      },
      {
        label: "Cancelled",
        value: projects.filter((p) => p.data.status === "cancelled").length,
      },
      { label: "Completed", value: done.length },
    ],
    completedTasks = tasks.filter((t) => t.data.status === "done").length,
    teamPerformance = tasks.length
      ? Math.round((completedTasks / tasks.length) * 100)
      : null;
  const topBranch = projects
    .map((p) => ({
      name: String(p.data.name),
      sales: projectNumbers(p, entities).sales,
    }))
    .filter((p) => p.sales > 0)
    .sort((a, b) => b.sales - a.sales)[0];
  return (
    <div className="zec-dashboard">
      <div className="z-heading">
        <div>
          <h1>{report ? "AI EXECUTIVE REPORT" : "Executive Dashboard"}</h1>
          <p>
            ข้อมูลอัปเดตล่าสุด{" "}
            {new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
          </p>
        </div>
        <button
          className="z-small-button zec-report-toggle"
          onClick={() => setReport(!report)}
        >
          {report ? "Today Overview" : "AI Executive Report"}
          <ArrowRight size={13} />
        </button>
      </div>
      <section className="zec-mobile-overview">
        <h2>
          TODAY OVERVIEW{" "}
          <small>
            updated{" "}
            {new Date().toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Bangkok",
            })}
          </small>
        </h2>
        <div className="zec-mobile-metrics">
          <MobileMetric
            title="Sales Revenue"
            value={
              "฿" +
              money(
                todaySales.reduce(
                  (sum, r) => sum + Number(r.data.amount || 0),
                  0,
                ),
              )
            }
            points={amountSeries(sales)}
            color="#823fff"
          />
          <MobileMetric
            title="Projects Active"
            value={String(active.length)}
            points={[]}
            color="#2686fb"
          />
          <MobileMetric
            title="Tasks Completed"
            value={String(completedTasks)}
            points={[]}
            color="#2686fb"
          />
          <MobileMetric
            title="Team Performance"
            value={teamPerformance === null ? "—" : teamPerformance + "%"}
            points={[]}
            color="#eb46cd"
          />
        </div>
      </section>
      {!report ? (
        <>
          <div className="zec-six">
            <NumberCard label="ยอดขายรวมทั้งหมด" value={s.sales} />
            <NumberCard
              label="กำไรรวมทั้งสิ้น"
              value={s.sales - s.expenses}
              note={
                s.sales
                  ? money(((s.sales - s.expenses) / s.sales) * 100) + "%"
                  : "ยังไม่มีข้อมูลยอดขาย"
              }
            />
            <NumberCard
              label="งานที่กำลังดำเนินการ"
              value={active.length}
              note="งาน"
            />
            <NumberCard
              label="รออนุมัติ"
              value={pending.length}
              note="งาน"
              tone="amber"
            />
            <NumberCard
              label="ใกล้ครบกำหนด"
              value={near.length}
              note="งาน"
              tone="amber"
            />
            <NumberCard
              label="เสร็จสิ้น"
              value={done.length}
              note="งาน"
              tone="green"
            />
          </div>
          <div className="zec-chart-grid">
            <section className="z-card z-ai-summary">
              <h2>
                <Sparkles size={18} />
                AI Executive Summary
              </h2>
              <ul>
                <li>มี {pending.length} งานรออนุมัติ</li>
                <li>มี {near.length} งานใกล้ครบกำหนด</li>
                <li>Stock ถึงจุดสั่งซื้อ {s.lowStock.length} รายการ</li>
                <li>
                  Sale วันนี้{" "}
                  {money(
                    todaySales.reduce(
                      (sum, r) => sum + Number(r.data.amount || 0),
                      0,
                    ),
                  )}{" "}
                  บาท
                </li>
                <li>มี {late.length} งานเกินกำหนด</li>
              </ul>
              <button
                className="z-small-button"
                onClick={() => navigate("assistant")}
              >
                ดูรายละเอียดทั้งหมด
              </button>
              <small>
                ข้อมูลสถานะจริง · เปิด AI Assistant เพื่อวิเคราะห์เพิ่มเติม
              </small>
            </section>
            <section className="z-card">
              <h2>ยอดขาย 7 วันที่ผ่านมา</h2>
              <LineChart points={weekSales} />
            </section>
            <section className="z-card">
              <h2>สถานะงานทั้งหมด</h2>
              <Donut items={projectStates} title="รวม" unit="โครงการ" />
            </section>
          </div>
          <section className="z-card">
            <div className="z-card-heading">
              <h2>งานที่กำลังดำเนินการ (Active Projects)</h2>
              <button
                className="text-button"
                onClick={() => navigate("projects")}
              >
                ดูทั้งหมด
                <ArrowRight size={13} />
              </button>
            </div>
            <div className="zec-active">
              {active.slice(0, 5).map((p) => (
                <ActiveCard
                  key={p.id}
                  project={p}
                  entities={entities}
                  demo={ctx.demo}
                  open={() => navigate("projects", p.id)}
                />
              ))}
              {!active.length && <Empty title="ยังไม่มีโครงการที่ดำเนินการ" />}
            </div>
          </section>
          <section className="z-card">
            <div className="z-card-heading">
              <h2>ภาพรวมทุกขั้นตอนของโครงการ (Workflow Overview)</h2>
              {currentProject && (
                <select
                  aria-label="เลือกโครงการใน Workflow"
                  value={currentProject.id}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {projects.map((p) => (
                    <option value={p.id} key={p.id}>
                      {String(p.data.name)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {currentProject ? (
              <ProjectStages
                projectId={currentProject.id}
                ctx={ctx}
                changed={changed}
                compact
              />
            ) : (
              <Empty title="ยังไม่มีโครงการ" />
            )}
          </section>
        </>
      ) : (
        <>
          <section className="zec-health">
            <span>BUSINESS STATUS</span>
            <h2>
              <i />
              {late.length ? "Requires Attention" : "No Overdue Tasks"}
            </h2>
            <p>
              {late.length
                ? `มี ${late.length} งานเกินกำหนด ควรติดตามผู้รับผิดชอบ`
                : "ไม่พบงานเกินกำหนดจากข้อมูลที่บัญชีนี้มีสิทธิ์ดู"}
            </p>
            <div>
              <strong>
                {dated.length
                  ? Math.round(
                      ((dated.length - late.length) / dated.length) * 100,
                    )
                  : "—"}
              </strong>
              <span>งานตรงเวลา (%)</span>
            </div>
          </section>
          <div className="zec-report-metrics">
            <NumberCard
              label="SALES TODAY"
              value={todaySales.reduce(
                (sum, r) => sum + Number(r.data.amount || 0),
                0,
              )}
              tone="green"
            />
            <NumberCard label="TOP BRANCH" value={topBranch?.name || "—"} />
            <NumberCard label="TOTAL REVENUE" value={s.sales} />
            <NumberCard
              label="PENDING TASKS"
              value={tasks.filter((t) => t.data.status !== "done").length}
            />
          </div>
          <section className="z-card">
            <div className="z-card-heading">
              <h2>PROJECT SUMMARY</h2>
              <button
                className="text-button"
                onClick={() => navigate("projects")}
              >
                View All
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project Name</th>
                    <th>Start – End</th>
                    <th>Status</th>
                    <th>Sales</th>
                    <th>Stock Left</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.slice(0, 8).map((p) => {
                    const n = projectNumbers(p, entities);
                    return (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => navigate("projects", p.id)}
                          >
                            {String(p.data.name)}
                          </button>
                        </td>
                        <td>
                          {String(p.data.startDate || "—")} –{" "}
                          {String(p.data.endDate || "—")}
                        </td>
                        <td>
                          <span
                            className={"z-badge z-" + String(p.data.status)}
                          >
                            {String(p.data.status)}
                          </span>
                        </td>
                        <td>{money(n.sales)}</td>
                        <td>
                          {inventory
                            ? money(
                                inventory
                                  .filter((i) => i.project_id === p.id)
                                  .reduce(
                                    (total, i) => total + Number(i.quantity),
                                    0,
                                  ),
                              )
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="z-card">
            <div className="z-card-heading">
              <h2>BRANCH LIVE VIEW</h2>
              <button
                className="text-button"
                onClick={() => navigate("projects")}
              >
                View All
              </button>
            </div>
            <div className="zec-branches">
              {projects.slice(0, 3).map((p) => (
                <button key={p.id} onClick={() => navigate("projects", p.id)}>
                  {ctx.demo && referenceImages(String(p.data.name)) ? (
                    <img
                      src={referenceImages(String(p.data.name))!.location}
                      alt="ภาพตัวอย่างสาขาจาก PPTX"
                    />
                  ) : (
                    <span>
                      <Package size={30} />
                      เปิดภาพของโครงการ
                    </span>
                  )}
                  <strong>{String(p.data.name)}</strong>
                  <small>
                    {ctx.demo && referenceImages(String(p.data.name))
                      ? "ภาพตัวอย่างจาก PPTX"
                      : "เปิดไฟล์และข้อมูลโครงการล่าสุด"}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      <section className="zec-mobile-insights z-card">
        <div className="z-card-heading">
          <h2>AI INSIGHTS</h2>
          <button className="text-button" onClick={() => navigate("assistant")}>
            See All
          </button>
        </div>
        <p>
          <i />
          มี {pending.length} รายการรออนุมัติ
        </p>
        <p>
          <i />
          มี {s.lowStock.length} รายการถึงจุดสั่งซื้อ
        </p>
        <p>
          <i />
          มี {near.length} งานใกล้ครบกำหนด
        </p>
      </section>
      <section className="zec-mobile-branches z-card">
        <div className="z-card-heading">
          <h2>BRANCH OVERVIEW</h2>
          <button className="text-button" onClick={() => navigate("projects")}>
            View All
          </button>
        </div>
        <div className="zec-branches">
          {projects.slice(0, 3).map((p) => (
            <ActiveCard
              key={p.id}
              project={p}
              entities={entities}
              demo={ctx.demo}
              open={() => navigate("projects", p.id)}
            />
          ))}
        </div>
      </section>
      {!report && !!s.widgets?.length && (
        <section className="z-card">
          <h2>Data Templates · Auto-Generated Dashboard</h2>
          <div className="z-stats">
            {s.widgets.map((w) => (
              <NumberCard
                key={w.key}
                label={w.name + " · " + w.label}
                value={w.total}
                note={w.count + " รายการที่อนุมัติ"}
              />
            ))}
          </div>
        </section>
      )}
      <nav className="zec-mobile-nav" aria-label="เมนูมือถือ">
        <button
          className={!report ? "active" : ""}
          onClick={() => setReport(false)}
        >
          <Home size={19} />
          Overview
        </button>
        <button onClick={() => navigate("projects")}>
          <FolderKanban size={19} />
          Projects
        </button>
        <button
          className="zec-mobile-plus"
          aria-label="รับข้อมูลใหม่"
          onClick={() => navigate("inbox")}
        >
          <Plus size={24} />
        </button>
        <button
          className={report ? "active" : ""}
          onClick={() => setReport(true)}
        >
          <ChartNoAxesCombined size={19} />
          Analytics
        </button>
        <button onClick={() => navigate("settings")}>
          <MoreHorizontal size={20} />
          More
        </button>
      </nav>
    </div>
  );
}
function ActiveCard({
  project,
  entities,
  demo,
  open,
}: {
  project: Entity;
  entities: Entity[];
  demo: boolean;
  open: () => void;
}) {
  const n = projectNumbers(project, entities),
    image = demo ? referenceImages(String(project.data.name))?.location : null;
  return (
    <button className="zec-active-card" onClick={open}>
      <div>
        {image ? <img src={image} alt="ภาพตัวอย่างพื้นที่" /> : null}
        <span>
          <strong>{String(project.data.name)}</strong>
          <small>
            {String(project.data.startDate || "—")} –{" "}
            {String(project.data.endDate || "—")}
          </small>
          <em>
            {project.data.status === "active"
              ? "Running"
              : String(project.data.status)}
          </em>
        </span>
      </div>
      <div className="zec-active-values">
        <span>
          Target<strong>{money(n.target)}</strong>
        </span>
        <span>
          Sales<strong>{money(n.sales)}</strong>
        </span>
        <span>
          <strong>
            {n.target ? Math.round((n.sales / n.target) * 100) + "%" : "—"}
          </strong>
        </span>
      </div>
      <span className="z-progress">
        <i
          style={{
            width:
              Math.min(100, n.target ? (n.sales / n.target) * 100 : 0) + "%",
          }}
        />
      </span>
      <footer>
        <span>
          <Users size={10} />
          {n.tasks.length} งาน
        </span>
        <span>
          <CheckCircle2 size={10} />
          {n.done} งานเสร็จ
        </span>
      </footer>
    </button>
  );
}
function MobileMetric({
  title,
  value,
  points,
  color,
}: {
  title: string;
  value: string;
  points: { label: string; value: number }[];
  color: string;
}) {
  return (
    <div className="zec-mobile-metric">
      <span>{title}</span>
      <strong>{value}</strong>
      {points.length ? (
        <LineChart points={points} color={color} unit="" />
      ) : (
        <small>ข้อมูลจากระบบล่าสุด</small>
      )}
    </div>
  );
}
