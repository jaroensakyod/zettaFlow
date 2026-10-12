"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Store,
  CalendarDays,
  FolderKanban,
  PenTool,
  ShoppingCart,
  Warehouse,
  TrendingUp,
  Wallet,
  Files,
  ChartNoAxesCombined,
  Users,
  Settings,
  CheckCircle2,
  Clock3,
  XCircle,
  MessageCircle,
  Sparkles,
  Plus,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Menu,
  Bell,
  LogOut,
  Upload,
  FileText,
  MapPin,
  Maximize2,
  Download,
  Pencil,
  Bot,
  Plug,
  PanelsTopLeft,
  RefreshCw,
} from "lucide-react";
import type { Context, Entity, Attachment } from "@/lib/types";
import { catalog } from "@/lib/catalog";
import { api, Loading, Empty, Modal, money } from "./shared";
import { Records, FieldControl } from "./records";
import { DesignPanel } from "./design-panel";
import { AiWorkspace } from "./ai-workspace";
import { CompanySettings, Team, Integrations } from "./settings";
import { Calendar, Reports, Assistant, Pricing } from "./tools";
import {
  spaceStatistics,
  projectNumbers,
  periodDays,
  workflowDepartments,
} from "@/lib/zetta";

const navigation = [
  ["dashboard", "Executive Dashboard", LayoutDashboard],
  ["spaces", "Space Approval", Store],
  ["calendar", "Calendar", CalendarDays],
  ["projects", "Projects", FolderKanban],
  ["design", "Layout & Design", PenTool],
  ["purchasing", "Purchasing", ShoppingCart],
  ["warehouse", "Warehouse", Warehouse],
  ["sales", "Sales", TrendingUp],
  ["finance", "Finance", Wallet],
  ["documents", "Document", Files],
  ["reports", "Report", ChartNoAxesCombined],
  ["team", "Team", Users],
  ["settings", "Setting", Settings],
] as const;
const secondary = [
  ["inbox", "Data Inbox", Sparkles],
  ["templates", "Dynamic Form Designer", PanelsTopLeft],
  ["integrations", "Connect LINE", Plug],
  ["assistant", "AI Chat Assistant", Bot],
  ["pricing", "Subscription", Wallet],
] as const;
const statusNames: Record<string, string> = {
  approved: "Approved",
  active: "Running",
  planning: "Planning",
  negotiating: "Negotiating",
  pending: "Pending Approval",
  rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed",
  review: "Pending Approval",
  progress: "In Progress",
  done: "Completed",
};
const relatedKinds = [
  "deals",
  "projects",
  "tasks",
  "sales",
  "expenses",
  "purchases",
  "products",
  "documents",
  "payments",
];
type Business = {
  entities: Entity[];
  summary: {
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
  audit: { id: string; action: string; target: string; created_at: string }[];
};
const text = (row: Entity | undefined, key: string) =>
  String(row?.data[key] ?? "—");
const displayDate = (value: unknown) =>
  value && Number.isFinite(Number(new Date(String(value))))
    ? new Date(String(value)).toLocaleDateString("en-GB", {
        timeZone: "Asia/Bangkok",
      })
    : "—";
function Badge({ value }: { value: unknown }) {
  return (
    <span className={"z-badge z-" + String(value)}>
      {value === "approved" || value === "done" ? (
        <CheckCircle2 size={12} />
      ) : null}
      {statusNames[String(value)] || String(value || "—")}
    </span>
  );
}
function ZettaLogo() {
  return (
    <span className="z-brand">
      <svg viewBox="0 0 50 50" aria-hidden="true">
        <defs>
          <linearGradient id="zetta-logo" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#70efff" />
            <stop offset=".45" stopColor="#a453ff" />
            <stop offset="1" stopColor="#5528ee" />
          </linearGradient>
        </defs>
        <path
          d="M6 5h33c7 0 9 7 4 12L15 36h27v10H9c-8 0-10-8-4-13l28-18H6z"
          fill="url(#zetta-logo)"
        />
      </svg>
      <span>
        <strong>Zetta Flow AI</strong>
        <small>
          AI That Moves
          <br />
          Your Business Forward
        </small>
      </span>
    </span>
  );
}
function Metric({
  label,
  value,
  color = "violet",
  icon: Icon = TrendingUp,
}: {
  label: string;
  value: unknown;
  color?: string;
  icon?: typeof TrendingUp;
}) {
  return (
    <div className={"z-metric z-tone-" + color}>
      <div>
        <span>{label}</span>
        <strong>
          {typeof value === "number" ? money(value) : String(value)}
        </strong>
      </div>
      <Icon size={28} />
    </div>
  );
}
function SalesChart({ rows }: { rows: Entity[] }) {
  const daily = new Map<string, number>();
  rows
    .filter((r) => r.data.status === "confirmed")
    .forEach((r) => {
      const date = String(r.data.date || "");
      if (date)
        daily.set(date, (daily.get(date) || 0) + Number(r.data.amount || 0));
    });
  const points = [...daily].sort((a, b) => a[0].localeCompare(b[0])).slice(-12),
    max = Math.max(1, ...points.map((p) => p[1]));
  if (!points.length)
    return (
      <Empty
        title="ยังไม่มีรายงานยอดขาย"
        description="กราฟจะแสดงเมื่อยืนยันยอดขาย"
      />
    );
  const coords = points.map(
    (p, i) =>
      `${40 + (i * 490) / Math.max(1, points.length - 1)},${170 - (p[1] / max) * 140}`,
  );
  return (
    <div className="z-chart">
      <svg viewBox="0 0 565 210" role="img" aria-label="กราฟยอดขายตามวันที่">
        <defs>
          <linearGradient id="zetta-chart" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#8041f0" stopOpacity=".22" />
            <stop offset="1" stopColor="#8041f0" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[30, 65, 100, 135, 170].map((y, i) => (
          <g key={y}>
            <line x1="40" x2="540" y1={y} y2={y} stroke="#eceaf4" />
            <text x="0" y={y + 4} fontSize="9" fill="#9793a6">
              {money(max * (1 - i / 4))}
            </text>
          </g>
        ))}
        <path
          d={`M40,170 L${coords.join(" L")} L${40 + ((points.length - 1) * 490) / Math.max(1, points.length - 1)},170 Z`}
          fill="url(#zetta-chart)"
        />
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="#7434e5"
          strokeWidth="2.5"
        />
        {points.map((p, i) => (
          <g key={p[0]}>
            <circle
              cx={40 + (i * 490) / Math.max(1, points.length - 1)}
              cy={170 - (p[1] / max) * 140}
              r="3.5"
              fill="white"
              stroke="#7434e5"
              strokeWidth="2"
            />
            <text
              x={40 + (i * 490) / Math.max(1, points.length - 1)}
              y="195"
              textAnchor="middle"
              fontSize="9"
              fill="#6d6680"
            >
              {p[0].slice(5)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
function Workflow({
  tasks,
  onOpen,
}: {
  tasks: Entity[];
  onOpen: (department: string) => void;
}) {
  return (
    <div className="z-workflow">
      {workflowDepartments.map((d, i) => {
        const work = tasks.filter((t) => t.department === d.department),
          complete =
            work.length > 0 && work.every((t) => t.data.status === "done");
        return (
          <div className="z-workflow-step" key={d.department}>
            <button onClick={() => onOpen(d.department)}>
              <span className={"z-work-icon z-tone-" + d.color}>
                {complete ? <CheckCircle2 size={22} /> : <d.icon size={22} />}
              </span>
              <div>
                <strong>{d.label}</strong>
                <small>{d.description}</small>
                <Badge
                  value={
                    complete
                      ? "done"
                      : work.some((t) => t.data.status === "progress")
                        ? "progress"
                        : "pending"
                  }
                />
              </div>
            </button>
            {i < 4 && <ArrowRight size={18} className="z-work-arrow" />}
          </div>
        );
      })}
    </div>
  );
}

export function ZettaWorkspace({
  ctx,
  view,
  changed,
  onLogout,
}: {
  ctx: Context;
  view: string;
  changed: () => void;
  onLogout: () => Promise<void>;
}) {
  const router = useRouter(),
    searchParams = useSearchParams();
  const selectedId = searchParams.get("project");
  const [business, setBusiness] = useState<Business | null>(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [editor, setEditor] = useState<{
      kind: string;
      row?: Entity;
      projectId?: string;
    } | null>(null),
    [refreshing, setRefreshing] = useState(false);
  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  }, []);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [workspace, ...sets] = await Promise.all([
        api("/workspace"),
        ...relatedKinds.map(async (kind) => {
          const first = await api(`/entities/${kind}?page=0`);
          const rows: Entity[] = [...first.rows];
          // Read every page so totals never come from a truncated list.
          for (let page = 1; page < Math.ceil(first.count / 25); page++)
            rows.push(...(await api(`/entities/${kind}?page=${page}`)).rows);
          return rows;
        }),
      ]);
      setBusiness({
        entities: sets.flat(),
        summary: workspace.summary,
        audit: workspace.audit,
      });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    if (active) load();
    const t = setInterval(() => {
      if (!document.hidden && !document.querySelector("dialog[open]")) load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [load]);
  useEffect(() => {
    setMobile(false);
  }, [view, selectedId]);
  const navigate = (next: string, project?: string) =>
    router.push(
      "/zetta/" +
        next +
        (project ? "?project=" + encodeURIComponent(project) : ""),
    );
  const update = () => {
    load();
    changed();
  };
  const permitted = (key: string) =>
    key !== "team" || ctx.member.role === "owner";
  const title =
    [...navigation, ...secondary].find((n) => n[0] === view)?.[1] ||
    "Zetta Flow AI";
  const project = business?.entities.find(
    (e) => e.kind === "projects" && e.id === selectedId,
  );
  const rows = (kind: string) =>
    business?.entities.filter((e) => e.kind === kind) || [];
  return (
    <div className={"zetta-workspace" + (mobile ? " z-mobile-open" : "")}>
      {mobile && (
        <button
          className="z-overlay"
          aria-label="ปิดเมนู"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className="z-sidebar">
        <button className="z-logo-button" onClick={() => navigate("dashboard")}>
          <ZettaLogo />
        </button>
        <nav aria-label="ZettaFlow navigation">
          {navigation
            .filter((n) => permitted(n[0]))
            .map(([key, label, Icon]) => (
              <button
                key={key}
                className={"z-nav " + (view === key ? "active" : "")}
                onClick={() => navigate(key)}
                aria-current={view === key ? "page" : undefined}
              >
                <Icon size={19} />
                {label}
              </button>
            ))}
        </nav>
        <div className="z-side-tools">
          <span>AI BUSINESS PLATFORM</span>
          {secondary.map(([key, label, Icon]) => (
            <button
              key={key}
              className={"z-nav " + (view === key ? "active" : "")}
              onClick={() => navigate(key)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </div>
        <div className="z-side-bottom">
          <button className="z-profile" onClick={() => navigate("settings")}>
            <span className="avatar">{ctx.user.name[0]}</span>
            <span>
              <strong>{ctx.user.name}</strong>
              <small>{ctx.company.name}</small>
              <small>
                <i className="z-online" />
                {ctx.member.role.toUpperCase()}
              </small>
            </span>
          </button>
          <button className="z-elite-link" onClick={() => router.push("/")}>
            EliteFlow Workspace
            <ArrowRight size={14} />
          </button>
        </div>
      </aside>
      <div className="z-content">
        <header className="z-topbar">
          <button
            className="icon-button z-menu"
            aria-label="เปิดเมนู"
            onClick={() => setMobile(true)}
          >
            <Menu size={21} />
          </button>
          <span>
            Zetta Flow AI <ChevronRight size={13} />
            <strong>{title}</strong>
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="รีเฟรชข้อมูล"
              onClick={load}
              disabled={refreshing}
            >
              <RefreshCw size={17} className={refreshing ? "spin" : ""} />
            </button>
            <button
              className="icon-button"
              aria-label="ดูงานรออนุมัติ"
              onClick={() => navigate("inbox")}
            >
              <Bell size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="ตั้งค่าองค์กร"
              onClick={() => navigate("settings")}
            >
              <Settings size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="ออกจากระบบ"
              onClick={async () => {
                try {
                  await onLogout();
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {ctx.demo && (
          <div className="z-demo">
            <span>DEMO</span>ข้อมูลตัวอย่าง · บริการ LINE / AI
            จริงต้องตั้งค่าก่อนใช้งาน
          </div>
        )}
        <main className="z-main">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!business ? (
            <Loading />
          ) : (
            <>
              {view === "dashboard" && (
                <Executive business={business} navigate={navigate} />
              )}
              {view === "spaces" && (
                <Spaces
                  rows={rows("deals")}
                  tasks={rows("tasks")}
                  ctx={ctx}
                  edit={(row) => setEditor({ kind: "deals", row })}
                  navigate={navigate}
                  update={update}
                  notify={notify}
                />
              )}
              {view === "projects" &&
                (project ? (
                  <ProjectDetail
                    project={project}
                    business={business}
                    ctx={ctx}
                    navigate={navigate}
                    edit={(kind, row) =>
                      setEditor({ kind, row, projectId: project.id })
                    }
                    notify={notify}
                    changed={update}
                  />
                ) : (
                  <>
                    <PageHeading
                      title="Projects"
                      subtitle="ภาพรวมโครงการและสถานะการทำงาน"
                      action={
                        ctx.member.role !== "viewer" ? (
                          <button
                            className="primary"
                            onClick={() => setEditor({ kind: "projects" })}
                          >
                            <Plus size={15} />
                            Add Project
                          </button>
                        ) : null
                      }
                    />
                    <div className="z-project-grid">
                      {rows("projects").map((p) => (
                        <ProjectCard
                          key={p.id}
                          project={p}
                          business={business}
                          open={() => navigate("projects", p.id)}
                        />
                      ))}
                    </div>
                    {!rows("projects").length && (
                      <Empty title="ยังไม่มีโครงการ" />
                    )}
                  </>
                ))}
              {view === "calendar" && (
                <>
                  <PageHeading
                    title="Calendar"
                    subtitle="กำหนดการโครงการและวันครบกำหนด"
                  />
                  <Calendar
                    navigate={(v) => navigate(v === "deals" ? "spaces" : v)}
                  />
                </>
              )}
              {view === "inbox" || view === "templates" ? (
                <>
                  <PageHeading
                    title={title}
                    subtitle={
                      view === "inbox"
                        ? "ตรวจทานข้อมูลจาก LINE และเอกสารก่อนเริ่ม Workflow"
                        : "ออกแบบข้อมูลที่ต้องการให้ AI สกัด"
                    }
                  />
                  <AiWorkspace
                    ctx={ctx}
                    view={view === "inbox" ? "ai-inbox" : "templates"}
                    notify={notify}
                    changed={update}
                  />
                </>
              ) : null}
              {view === "design" && (
                <>
                  <PageHeading
                    title="Layout & Design"
                    subtitle="เขียนแบบ / Perspective และติดตามการอนุมัติ"
                  />
                  <div className="z-project-grid">
                    {rows("projects").map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        business={business}
                        open={() => navigate("projects", p.id)}
                      />
                    ))}
                  </div>
                  <h2 className="z-section-title">Design Workflow</h2>
                  <section className="z-card">
                    {rows("tasks")
                      .filter((t) => t.department === "Design")
                      .map((t) => (
                        <div className="z-requirement" key={t.id}>
                          <div>
                            <strong>{text(t, "name")}</strong>
                            <small>
                              {text(t, "assignee")} ·{" "}
                              {displayDate(t.data.dueDate)}
                            </small>
                          </div>
                          <Badge value={t.data.status} />
                          {ctx.member.role !== "viewer" && (
                            <button
                              className="z-small-button"
                              onClick={() =>
                                setEditor({ kind: "tasks", row: t })
                              }
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      ))}
                    {!rows("tasks").some((t) => t.department === "Design") && (
                      <Empty title="ยังไม่มีงานของ Design Team" />
                    )}
                  </section>
                </>
              )}
              {view === "purchasing" && (
                <>
                  <PageHeading
                    title="Purchasing"
                    subtitle="ขอใบเสนอราคา / Spec และรับสินค้าเข้าคลัง"
                  />
                  <div className="z-stats">
                    <Metric
                      label="Purchase Orders"
                      value={rows("purchases").length}
                    />
                    <Metric
                      label="Pending Approval"
                      value={
                        rows("purchases").filter(
                          (e) => e.data.status === "draft",
                        ).length
                      }
                      color="amber"
                    />
                    <Metric
                      label="Approved"
                      value={
                        rows("purchases").filter(
                          (e) => e.data.status === "approved",
                        ).length
                      }
                      color="blue"
                    />
                    <Metric
                      label="Received"
                      value={
                        rows("purchases").filter(
                          (e) => e.data.status === "received",
                        ).length
                      }
                      color="green"
                    />
                  </div>
                  <Records
                    kind="purchases"
                    ctx={ctx}
                    notify={notify}
                    changed={update}
                  />
                </>
              )}
              {view === "warehouse" && (
                <>
                  <PageHeading
                    title="Warehouse"
                    subtitle="เตรียมสินค้า / สต็อก และรายการรับ–จ่าย"
                  />
                  <div className="z-stats">
                    <Metric
                      label="Total Products"
                      value={rows("products").length}
                    />
                    <Metric
                      label="Stock Quantity"
                      value={rows("products").reduce(
                        (s, e) => s + Number(e.data.stock || 0),
                        0,
                      )}
                      color="blue"
                    />
                    <Metric
                      label="Low Stock"
                      value={business.summary.lowStock.length}
                      color="amber"
                    />
                    <Metric
                      label="Received POs"
                      value={
                        rows("purchases").filter(
                          (e) => e.data.status === "received",
                        ).length
                      }
                      color="green"
                    />
                  </div>
                  <Records
                    kind="products"
                    ctx={ctx}
                    notify={notify}
                    changed={update}
                  />
                </>
              )}
              {view === "sales" && (
                <>
                  <PageHeading
                    title="Sales"
                    subtitle="รายงานยอดขายและติดตามเป้าหมาย"
                  />
                  <div className="z-stats">
                    <Metric
                      label="Confirmed Sales (THB)"
                      value={business.summary.sales}
                      color="green"
                    />
                    <Metric
                      label="Sales Reports"
                      value={rows("sales").length}
                    />
                    <Metric
                      label="Sales Target (THB)"
                      value={rows("deals").reduce(
                        (s, e) => s + Number(e.data.targetSales || 0),
                        0,
                      )}
                      color="blue"
                    />
                  </div>
                  <section className="z-card">
                    <h2>Daily Sales (THB)</h2>
                    <SalesChart rows={rows("sales")} />
                  </section>
                  <Records
                    kind="sales"
                    ctx={ctx}
                    notify={notify}
                    changed={update}
                  />
                </>
              )}
              {view === "finance" && (
                <>
                  <PageHeading
                    title="Finance"
                    subtitle="ค่าใช้จ่าย การรับชำระ และเอกสารการเงิน"
                  />
                  <div className="z-stats">
                    <Metric
                      label="Total Sales (THB)"
                      value={business.summary.sales}
                      color="green"
                    />
                    <Metric
                      label="Total Expenses (THB)"
                      value={business.summary.expenses}
                      color="rose"
                    />
                    <Metric
                      label="Sales − Expenses (THB)"
                      value={business.summary.sales - business.summary.expenses}
                    />
                  </div>
                  <Finance ctx={ctx} notify={notify} changed={update} />
                </>
              )}
              {view === "documents" && (
                <>
                  <PageHeading
                    title="Document Archive"
                    subtitle="คลังเอกสารและหลักฐานขององค์กร"
                  />
                  <Records
                    kind="documents"
                    ctx={ctx}
                    notify={notify}
                    changed={update}
                  />
                </>
              )}
              {view === "reports" && (
                <>
                  <PageHeading
                    title="Report & Export"
                    subtitle="รายงานธุรกิจและส่งออกข้อมูล"
                  />
                  <Reports notify={notify} />
                </>
              )}
              {view === "team" && (
                <>
                  <PageHeading
                    title="Team & Permission"
                    subtitle="กำหนดสิทธิ์ผู้ส่งข้อมูล ผู้ตรวจทาน และผู้อนุมัติ"
                  />
                  <Team ctx={ctx} notify={notify} />
                </>
              )}
              {view === "settings" && (
                <>
                  <PageHeading
                    title="Setting"
                    subtitle="ตั้งค่าองค์กรและข้อมูลบริษัท"
                  />
                  <CompanySettings ctx={ctx} notify={notify} changed={update} />
                </>
              )}
              {view === "integrations" && (
                <>
                  <PageHeading
                    title="Connect LINE"
                    subtitle="เชื่อม LINE Official Account และกลุ่มของแต่ละแผนก"
                  />
                  <Integrations ctx={ctx} notify={notify} />
                </>
              )}
              {view === "assistant" && (
                <>
                  <PageHeading
                    title="AI Chat Assistant"
                    subtitle="ถามข้อมูลโครงการและภาพรวมองค์กร"
                  />
                  <Assistant />
                </>
              )}
              {view === "pricing" && (
                <>
                  <PageHeading
                    title="ZettaFlow AI Subscription"
                    subtitle="แพ็กเกจรายเดือน / รายปี"
                  />
                  <Pricing />
                </>
              )}
            </>
          )}
        </main>
        <footer className="z-footer">
          Zetta Flow AI · One AI Platform. Unlimited Business Workflows.
          <span>ข้อมูลตามสิทธิ์ของบัญชีนี้</span>
        </footer>
      </div>
      {editor && (
        <RecordEditor
          ctx={ctx}
          {...editor}
          close={() => setEditor(null)}
          done={() => {
            setEditor(null);
            update();
            notify("บันทึกข้อมูลแล้ว");
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="z-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function Executive({
  business,
  navigate,
}: {
  business: Business;
  navigate: (v: string, p?: string) => void;
}) {
  const s = business.summary,
    projects = business.entities.filter((e) => e.kind === "projects"),
    tasks = business.entities.filter((e) => e.kind === "tasks"),
    due = tasks.filter(
      (e) =>
        e.data.status !== "done" &&
        e.data.dueDate &&
        Number(new Date(String(e.data.dueDate))) <= Date.now() + 3 * 86400000,
    ),
    sales = business.entities.filter((e) => e.kind === "sales"),
    complete = tasks.filter((t) => t.data.status === "done").length;
  return (
    <>
      <PageHeading
        title="Executive Dashboard"
        subtitle={"ข้อมูลอัปเดตล่าสุด " + new Date().toLocaleString("th-TH")}
      />
      <div className="z-executive-metrics">
        <Metric label="ยอดขายรวมทั้งหมด" value={s.sales} icon={TrendingUp} />
        <Metric label="ค่าใช้จ่ายรวม" value={s.expenses} icon={Wallet} />
        <Metric
          label="โครงการที่กำลังดำเนินการ"
          value={s.projects}
          icon={FolderKanban}
        />
        <Metric
          label="งานรออนุมัติ"
          value={
            s.pendingDeals +
            tasks.filter((t) => t.data.status === "review").length
          }
          color="amber"
          icon={Clock3}
        />
        <Metric
          label="งานใกล้ครบกำหนด"
          value={due.length}
          color="rose"
          icon={CalendarDays}
        />
        <Metric
          label="งานที่ต้องติดตาม"
          value={s.tasks}
          color="blue"
          icon={FileText}
        />
      </div>
      <div className="z-dashboard-charts">
        <section className="z-card z-ai-summary">
          <h2>
            <Sparkles size={18} />
            AI Executive Summary
          </h2>
          <ul>
            <li>มี {s.pendingDeals} พื้นที่รออนุมัติ</li>
            <li>มี {due.length} งานใกล้ครบกำหนด</li>
            <li>Stock ถึงจุดสั่งซื้อ {s.lowStock.length} รายการ</li>
            <li>ยอดขายที่ยืนยัน {money(s.sales)} บาท</li>
            <li>ค่าใช้จ่ายที่อนุมัติ {money(s.expenses)} บาท</li>
          </ul>
          <small>สรุปจากข้อมูลธุรกิจ · ไม่ใช่ผลวิเคราะห์จาก AI</small>
          <button
            className="z-small-button"
            onClick={() => navigate("assistant")}
          >
            ดูรายละเอียดเพิ่มเติม
            <ArrowRight size={13} />
          </button>
        </section>
        <section className="z-card">
          <h2>ยอดขาย & ค่าใช้จ่าย</h2>
          <SalesChart rows={sales} />
        </section>
        <section className="z-card">
          <h2>สถานะงานทั้งหมด</h2>
          <div
            className="z-donut"
            style={{
              background: `conic-gradient(#24bb70 0 ${tasks.length ? (complete / tasks.length) * 100 : 0}%,#7844e8 0 100%)`,
            }}
          >
            <span>
              <strong>{tasks.length}</strong>
              <small>Tasks</small>
            </span>
          </div>
          <div className="z-donut-legend">
            <span>
              <i style={{ background: "#24bb70" }} />
              เสร็จแล้ว {complete}
            </span>
            <span>
              <i style={{ background: "#7844e8" }} />
              ติดตาม {tasks.length - complete}
            </span>
          </div>
        </section>
      </div>
      <section className="z-card">
        <div className="z-card-heading">
          <h2>งานที่กำลังดำเนินการ (Active Projects)</h2>
          <button className="text-button" onClick={() => navigate("projects")}>
            ดูทั้งหมด
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="z-active-projects">
          {projects
            .filter(
              (p) => !["completed", "cancelled"].includes(text(p, "status")),
            )
            .map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                business={business}
                open={() => navigate("projects", p.id)}
              />
            ))}
          {!projects.length && <Empty title="ยังไม่มีโครงการ" />}
        </div>
      </section>
      <section className="z-card">
        <h2>ภาพรวมทุกขั้นตอนของโครงการ (Workflow Overview)</h2>
        <Workflow
          tasks={tasks}
          onOpen={(d) =>
            navigate(
              d === "Design"
                ? "design"
                : d === "Purchasing"
                  ? "purchasing"
                  : d === "Warehouse"
                    ? "warehouse"
                    : d === "Sales"
                      ? "sales"
                      : "projects",
            )
          }
        />
      </section>
      {!!s.widgets?.length && (
        <section className="z-card">
          <h2>Auto-Generated Dashboard · Data Templates</h2>
          <div className="z-stats">
            {s.widgets.map((w) => (
              <Metric
                key={w.key}
                label={w.name + " · " + w.label}
                value={w.total}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
function ProjectCard({
  project,
  business,
  open,
}: {
  project: Entity;
  business: Business;
  open: () => void;
}) {
  const n = projectNumbers(project, business.entities);
  return (
    <button className="z-project-card" onClick={open}>
      <div>
        <strong>{text(project, "name")}</strong>
        <Badge value={project.data.status} />
      </div>
      <small>
        {displayDate(project.data.startDate)} –{" "}
        {displayDate(project.data.endDate)}
      </small>
      <span className="z-progress">
        <i style={{ width: n.progress + "%" }} />
      </span>
      <span className="z-project-values">
        <span>
          ยอดขาย<strong>฿ {money(n.sales)}</strong>
        </span>
        <span>
          งานที่เสร็จ
          <strong>
            {n.done} / {n.tasks.length}
          </strong>
        </span>
        <span>
          ความคืบหน้า<strong>{n.progress}%</strong>
        </span>
      </span>
    </button>
  );
}
function Spaces({
  rows,
  tasks,
  ctx,
  edit,
  navigate,
  update,
  notify,
}: {
  rows: Entity[];
  tasks: Entity[];
  ctx: Context;
  edit: (row?: Entity) => void;
  navigate: (v: string, p?: string) => void;
  update: () => void;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [page, setPage] = useState(0),
    [query, setQuery] = useState(""),
    [month, setMonth] = useState(""),
    [busy, setBusy] = useState(false);
  const filtered = rows.filter(
      (r) =>
        (text(r, "name") + text(r, "location"))
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!month || String(r.data.startDate || "").startsWith(month)),
    ),
    visible = filtered.slice(page * 5, page * 5 + 5),
    current = filtered.find((r) => r.id === selected) || visible[0],
    stats = spaceStatistics(filtered);
  const scoped = tasks.filter(
    (t) => current && t.data.projectId === current.data.projectId,
  );
  return (
    <>
      <PageHeading
        title="Space Approval Overview"
        subtitle="ภาพรวมการอนุมัติพื้นที่ขาย"
        action={
          <div className="z-heading-actions">
            <input
              type="month"
              aria-label="เดือนของพื้นที่"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setPage(0);
              }}
            />
            {ctx.member.role !== "viewer" && (
              <button className="primary" onClick={() => edit()}>
                <Plus size={15} />
                Add New Space
              </button>
            )}
          </div>
        }
      />
      <div className="z-space-stats">
        <Metric label="Total Spaces" value={stats.total} icon={Store} />
        <Metric
          label="Approved"
          value={stats.approved}
          color="green"
          icon={CheckCircle2}
        />
        <Metric
          label="Pending Approval"
          value={stats.pending}
          color="amber"
          icon={Clock3}
        />
        <Metric
          label="Negotiating"
          value={stats.negotiating}
          color="blue"
          icon={Users}
        />
        <Metric
          label="Cancelled"
          value={stats.cancelled}
          color="rose"
          icon={XCircle}
        />
      </div>
      <div className="z-space-body">
        <section className="z-space-list">
          <label className="z-search">
            <input
              value={query}
              placeholder="ค้นหา Space / Location…"
              aria-label="ค้นหาพื้นที่"
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <div className="z-space-table">
            <div className="z-space-row z-space-columns">
              <span>Space / Location</span>
              <span>Status</span>
              <span>Period</span>
              <span>Area</span>
              <span>Floor / Zone</span>
            </div>
            {visible.map((r) => (
              <button
                key={r.id}
                className={
                  "z-space-row " + (r.id === current?.id ? "selected" : "")
                }
                onClick={() => setSelected(r.id)}
              >
                <span className="z-space-name">
                  <span className="z-location-icon">
                    <Store size={24} />
                  </span>
                  <span>
                    <strong>{text(r, "name")}</strong>
                    <small>{text(r, "location")}</small>
                  </span>
                </span>
                <Badge value={r.data.status} />
                <span>
                  {displayDate(r.data.startDate)} –{" "}
                  {displayDate(r.data.endDate)}
                  <small>
                    ({periodDays(r.data.startDate, r.data.endDate)} Days)
                  </small>
                </span>
                <span>
                  {money(r.data.area)}
                  <small>Sq.m</small>
                </span>
                <span>
                  {text(r, "zone")}
                  <ChevronRight size={13} />
                </span>
              </button>
            ))}
          </div>
          {!visible.length && <Empty title="ไม่พบพื้นที่ขาย" />}
          <div className="z-pagination">
            <span>
              Showing {filtered.length ? page * 5 + 1 : 0} to{" "}
              {Math.min(page * 5 + 5, filtered.length)} of {filtered.length}{" "}
              spaces
            </span>
            <div>
              <button
                disabled={page === 0}
                aria-label="หน้าก่อนหน้า"
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={14} />
              </button>
              <span>{page + 1}</span>
              <button
                disabled={(page + 1) * 5 >= filtered.length}
                aria-label="หน้าถัดไป"
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </section>
        <aside className="z-card z-space-details">
          {current ? (
            <>
              <div className="z-card-heading">
                <div>
                  <h2>{text(current, "name")}</h2>
                  <small>{text(current, "location")}</small>
                </div>
                <Badge value={current.data.status} />
              </div>
              <ProjectImages entity={current} />
              <dl className="z-details">
                <div>
                  <dt>Period</dt>
                  <dd>
                    {displayDate(current.data.startDate)} –{" "}
                    {displayDate(current.data.endDate)} (
                    {periodDays(current.data.startDate, current.data.endDate)}{" "}
                    Days)
                  </dd>
                </div>
                <div>
                  <dt>Floor / Zone</dt>
                  <dd>{text(current, "zone")}</dd>
                </div>
                <div>
                  <dt>Area Size</dt>
                  <dd>{money(current.data.area)} Sq.m</dd>
                </div>
              </dl>
              <h3 className="z-subheading">Rental Details</h3>
              <dl className="z-details">
                <div>
                  <dt>Commission</dt>
                  <dd>{money(current.data.gp)}%</dd>
                </div>
                <div>
                  <dt>Minimum Rental</dt>
                  <dd>{money(current.data.rent)} THB Ex Vat 7%</dd>
                </div>
                <div>
                  <dt>Minimum Sales</dt>
                  <dd>{money(current.data.targetSales)} THB Ex Vat 7%</dd>
                </div>
              </dl>
              <div className="z-detail-actions">
                {ctx.member.role !== "viewer" && (
                  <button className="secondary" onClick={() => edit(current)}>
                    <Pencil size={13} />
                    Edit
                  </button>
                )}
                {["owner", "manager"].includes(ctx.member.role) &&
                  ["pending", "negotiating"].includes(
                    text(current, "status"),
                  ) && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api("/deal/" + current.id, {
                            method: "POST",
                            body: {},
                          });
                          update();
                          notify("อนุมัติและสร้าง Workflow แล้ว");
                        } catch (e) {
                          notify((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <CheckCircle2 size={14} />
                      Approve
                    </button>
                  )}
                {!!current.data.projectId && (
                  <button
                    className="text-button"
                    onClick={() =>
                      navigate("projects", String(current.data.projectId))
                    }
                  >
                    Open Project
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <Empty title="เลือกพื้นที่เพื่อดูรายละเอียด" />
          )}
        </aside>
      </div>
      <section className="z-card">
        <h2>Next Steps After Approval (Workflow)</h2>
        <Workflow
          tasks={scoped}
          onOpen={(d) =>
            navigate(
              d === "Design"
                ? "design"
                : d === "Purchasing"
                  ? "purchasing"
                  : d === "Warehouse"
                    ? "warehouse"
                    : d === "Sales"
                      ? "sales"
                      : "projects",
            )
          }
        />
      </section>
    </>
  );
}
function RecordEditor({
  ctx,
  kind,
  row,
  projectId,
  close,
  done,
}: {
  ctx: Context;
  kind: string;
  row?: Entity;
  projectId?: string;
  close: () => void;
  done: () => void;
}) {
  const module = catalog[kind];
  const [values, setValues] = useState<Record<string, unknown>>(
      row
        ? { ...row.data }
        : {
            status:
              module.statusOptions?.[0] ||
              module.fields.find((f) => f.key === "status")?.options?.[0],
            priority: "normal",
            ...(projectId ? { projectId } : {}),
          },
    ),
    [options, setOptions] = useState<
      { id: string; name: string; kind: string }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Modal title={(row ? "Edit " : "Add ") + module.label} onClose={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/entities/" + kind + (row ? "/" + row.id : ""), {
              method: row ? "PATCH" : "POST",
              body: { data: values, version: row?.version },
            });
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {module.fields.map((f) => (
            <FieldControl
              key={f.key}
              field={f}
              value={values[f.key]}
              options={options}
              set={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
            />
          ))}
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
        <div className="modal-footer">
          <button className="secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || ctx.member.role === "viewer"}
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ProjectImages({ entity }: { entity: Entity }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setAttachments([]);
    setError("");
    api("/files?entity=" + entity.id)
      .then((files) => {
        if (active) setAttachments(files);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [entity.id]);
  const images = attachments.filter((f) => f.mime.startsWith("image/"));
  return (
    <div className="z-project-images">
      {images.length ? (
        images.slice(0, 2).map((f) => (
          <figure key={f.id}>
            <img src={"/api/files/" + f.id} alt={f.name} />
            <figcaption>{f.name}</figcaption>
          </figure>
        ))
      ) : (
        <div className="z-image-empty">
          <PenTool size={29} />
          <span>Layout Plan / Perspective</span>
          <small>ยังไม่มีภาพแนบสำหรับพื้นที่นี้</small>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
function Finance({
  ctx,
  notify,
  changed,
}: {
  ctx: Context;
  notify: (s: string) => void;
  changed: () => void;
}) {
  const [kind, setKind] = useState("expenses");
  return (
    <>
      <div className="z-tabs">
        {[
          ["expenses", "Expenses"],
          ["invoices", "Invoices"],
          ["payments", "Payments"],
        ].map(([k, l]) => (
          <button
            className={kind === k ? "active" : ""}
            key={k}
            onClick={() => setKind(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <Records
        key={kind}
        kind={kind}
        ctx={ctx}
        notify={notify}
        changed={changed}
      />
    </>
  );
}

function ProjectDetail({
  project,
  business,
  ctx,
  navigate,
  edit,
  notify,
  changed,
}: {
  project: Entity;
  business: Business;
  ctx: Context;
  navigate: (v: string, p?: string) => void;
  edit: (kind: string, row?: Entity) => void;
  notify: (s: string) => void;
  changed: () => void;
}) {
  const [tab, setTab] = useState("Overview"),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [fileError, setFileError] = useState("");
  const n = projectNumbers(project, business.entities),
    deal = business.entities.find(
      (e) => e.kind === "deals" && e.data.projectId === project.id,
    ),
    expenses = business.entities.filter(
      (e) => e.kind === "expenses" && e.data.projectId === project.id,
    ),
    sales = business.entities.filter(
      (e) => e.kind === "sales" && e.data.projectId === project.id,
    );
  const loadFiles = useCallback(() => {
    setFileError("");
    api("/files?entity=" + project.id)
      .then(setAttachments)
      .catch((e) => setFileError(e.message));
  }, [project.id]);
  useEffect(() => {
    setAttachments([]);
    setTab("Overview");
    loadFiles();
  }, [loadFiles]);
  const writable = ctx.member.role !== "viewer";
  const tabs = [
    "Overview",
    "Layout Plan",
    "Perspective 3D",
    "Requirements",
    "ภาพหน้างานจริง",
    "เอกสารไฟล์",
    "การเงิน",
  ];
  return (
    <>
      <button
        className="text-button z-back"
        onClick={() => navigate("projects")}
      >
        <ArrowLeft size={15} />
        Projects
      </button>
      <PageHeading
        title={text(project, "name")}
        subtitle={text(project, "code") + " · " + text(deal, "location")}
        action={
          <div className="z-heading-actions">
            <Badge value={deal?.data.status || project.data.status} />
            {writable && (
              <>
                <button
                  className="secondary"
                  onClick={() => edit("projects", project)}
                >
                  <Pencil size={14} />
                  Edit
                </button>
                <button className="primary" onClick={() => edit("expenses")}>
                  <Plus size={14} />
                  Expense
                </button>
              </>
            )}
          </div>
        }
      />
      <div className="z-executive-metrics">
        <Metric
          label="งบประมาณ"
          value={project.data.budget || deal?.data.rent || 0}
          icon={Wallet}
        />
        <Metric label="ยอดขายเป้าหมาย" value={n.target} icon={TrendingUp} />
        <Metric label="ยอดขายปัจจุบัน" value={n.sales} color="green" />
        <Metric label="ยอดขาย − ค่าใช้จ่าย" value={n.sales - n.expenses} />
        <Metric
          label="ความคืบหน้า"
          value={n.progress + "%"}
          color="green"
          icon={CheckCircle2}
        />
        <Metric
          label="Owner (ผู้รับผิดชอบ)"
          value={project.data.owner || "ยังไม่ระบุ"}
          icon={Users}
        />
      </div>
      <div className="z-tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Overview" ? (
        <>
          <div className="z-project-overview">
            <section className="z-card">
              <h2>{text(project, "name")}</h2>
              <ProjectImages entity={project} />
              <dl className="z-details">
                <div>
                  <dt>Period</dt>
                  <dd>
                    {displayDate(project.data.startDate)} –{" "}
                    {displayDate(project.data.endDate)} (
                    {periodDays(project.data.startDate, project.data.endDate)}{" "}
                    Days)
                  </dd>
                </div>
                <div>
                  <dt>Floor / Zone</dt>
                  <dd>{text(deal, "zone")}</dd>
                </div>
                <div>
                  <dt>Area Size</dt>
                  <dd>{money(deal?.data.area)} Sq.m</dd>
                </div>
              </dl>
              <h3 className="z-subheading">Rental Details</h3>
              <dl className="z-details">
                <div>
                  <dt>Commission</dt>
                  <dd>{money(deal?.data.gp)}%</dd>
                </div>
                <div>
                  <dt>Minimum Rental</dt>
                  <dd>{money(deal?.data.rent)} THB Ex Vat 7%</dd>
                </div>
                <div>
                  <dt>Minimum Sales</dt>
                  <dd>{money(n.target)} THB Ex Vat 7%</dd>
                </div>
              </dl>
            </section>
            <section className="z-card">
              <h2>Status & Progress</h2>
              <Workflow tasks={n.tasks} onOpen={() => setTab("Requirements")} />
              <div className="z-project-summary">
                <h3>Project Summary</h3>
                <p>
                  <CheckCircle2 size={15} />
                  {n.done} งานเสร็จแล้ว จาก {n.tasks.length} งาน
                </p>
                <p>
                  <Clock3 size={15} />
                  {
                    n.tasks.filter((t) => t.data.status === "review").length
                  }{" "}
                  งานรอตรวจทาน
                </p>
                <p>
                  <Wallet size={15} />
                  ค่าใช้จ่ายที่อนุมัติ {money(n.expenses)} บาท
                </p>
                <small>คำนวณจากข้อมูลจริงของโครงการ</small>
              </div>
            </section>
            <section className="z-card">
              <div className="z-card-heading">
                <h2>Daily Sales (THB)</h2>
                <small>Target: {money(n.target)}</small>
              </div>
              <span>Total Sales</span>
              <strong className="z-big-number">{money(n.sales)}</strong>
              <SalesChart rows={sales} />
              <div className="z-project-values">
                <span>
                  Daily Average
                  <strong>
                    {money(
                      n.sales /
                        Math.max(
                          1,
                          new Set(sales.map((r) => r.data.date)).size,
                        ),
                    )}
                  </strong>
                </span>
                <span>
                  Remaining Target
                  <strong>{money(Math.max(0, n.target - n.sales))}</strong>
                </span>
              </div>
            </section>
          </div>
          <div className="z-project-bottom">
            <section className="z-card">
              <div className="z-card-heading">
                <h2>Expenses</h2>
                {writable && (
                  <button
                    className="z-small-button"
                    onClick={() => edit("expenses")}
                  >
                    <Plus size={12} />
                    Add Expense
                  </button>
                )}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Amount (THB)</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((r) => (
                      <tr key={r.id}>
                        <td>{text(r, "category")}</td>
                        <td>
                          {writable ? (
                            <button
                              className="text-button"
                              onClick={() => edit("expenses", r)}
                            >
                              {text(r, "name")}
                            </button>
                          ) : (
                            text(r, "name")
                          )}
                        </td>
                        <td>{money(r.data.amount)}</td>
                        <td>
                          <Badge value={r.data.status} />
                        </td>
                        <td>{displayDate(r.data.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!expenses.length && <Empty title="ยังไม่มีค่าใช้จ่าย" />}
            </section>
            <section className="z-card">
              <h2>Documents</h2>
              <FileList attachments={attachments} />
              {fileError && <p className="form-error">{fileError}</p>}
              <button
                className="z-small-button"
                onClick={() => setTab("เอกสารไฟล์")}
              >
                View All Documents
              </button>
            </section>
            <section className="z-card">
              <h2>Activity Timeline</h2>
              {business.audit
                .filter((a) =>
                  [project.id, ...n.tasks.map((t) => t.id)].includes(a.target),
                )
                .slice(0, 8)
                .map((a) => (
                  <div className="z-timeline" key={a.id}>
                    <CheckCircle2 size={17} />
                    <div>
                      <small>{displayDate(a.created_at)}</small>
                      <p>{a.action.replaceAll("_", " ")}</p>
                    </div>
                  </div>
                ))}
              <div className="z-project-note">
                <h3>Notes</h3>
                <p>
                  {project.data.description
                    ? text(project, "description")
                    : "ยังไม่มีหมายเหตุ"}
                </p>
                {writable && (
                  <button
                    className="text-button"
                    onClick={() => edit("projects", project)}
                  >
                    Edit Note
                  </button>
                )}
              </div>
            </section>
          </div>
        </>
      ) : ["Layout Plan", "Perspective 3D", "ภาพหน้างานจริง"].includes(tab) ? (
        <DesignPanel
          project={project}
          ctx={ctx}
          category={
            tab === "Layout Plan"
              ? "layout"
              : tab === "Perspective 3D"
                ? "perspective"
                : "site"
          }
          changed={changed}
          notify={notify}
        />
      ) : tab === "Requirements" ? (
        <section className="z-card">
          <h2>Project Requirements / Workflow</h2>
          {n.tasks.map((t) => (
            <div className="z-requirement" key={t.id}>
              <div>
                <strong>{text(t, "name")}</strong>
                <small>
                  {t.department} · {text(t, "assignee")}
                </small>
              </div>
              <Badge value={t.data.status} />
              {writable && (
                <button
                  className="z-small-button"
                  onClick={() => edit("tasks", t)}
                >
                  Edit
                </button>
              )}
            </div>
          ))}
          {!n.tasks.length && <Empty title="ยังไม่มีงานของโครงการ" />}
        </section>
      ) : tab === "การเงิน" ? (
        <section className="z-card">
          <h2>Project Finance</h2>
          <div className="z-stats">
            <Metric label="Sales" value={n.sales} />
            <Metric label="Approved Expenses" value={n.expenses} />
            <Metric label="Sales − Expenses" value={n.sales - n.expenses} />
          </div>
          {writable && (
            <button className="primary" onClick={() => edit("expenses")}>
              <Plus size={14} />
              Add Expense
            </button>
          )}
        </section>
      ) : (
        <section className="z-card">
          <div className="z-card-heading">
            <h2>{tab}</h2>
            {writable && (
              <label className="primary z-upload">
                <Upload size={15} />
                Upload New
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,.xlsx"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.set("file", file);
                    form.set("department", project.department);
                    form.set("entity", project.id);
                    try {
                      const r = await fetch("/api/files", {
                        method: "POST",
                        body: form,
                      });
                      const d = await r.json();
                      if (!r.ok) throw Error(d.error);
                      loadFiles();
                      changed();
                      notify("อัปโหลดไฟล์แล้ว");
                    } catch (err) {
                      setFileError((err as Error).message);
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          {fileError && (
            <p className="form-error" role="alert">
              {fileError}
            </p>
          )}
          {tab !== "เอกสารไฟล์" && <ProjectImages entity={project} />}
          <FileList attachments={attachments} />
        </section>
      )}
    </>
  );
}
function FileList({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="z-file-list">
      {attachments.map((f) => (
        <a
          key={f.id}
          href={"/api/files/" + f.id}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileText size={23} />
          <span>
            <strong>{f.name}</strong>
            <small>
              {(f.size / 1000000).toFixed(2)} MB · {displayDate(f.created_at)}
            </small>
          </span>
          <Download size={15} />
        </a>
      ))}
      {!attachments.length && <Empty title="ยังไม่มีไฟล์แนบ" />}
    </div>
  );
}
