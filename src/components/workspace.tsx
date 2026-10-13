"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Store,
  Truck,
  UserRound,
  ContactRound,
  Folders,
  MapPin,
  ListTodo,
  Monitor,
  Package,
  ShoppingCart,
  ChartNoAxesCombined,
  Receipt,
  FileText,
  CreditCard,
  Megaphone,
  Headset,
  Scale,
  CalendarOff,
  Files,
  MessageCircle,
  PanelsTopLeft,
  Plug,
  Building2,
  ShieldCheck,
  Grid2X2,
  BadgeDollarSign,
  Bot,
  type LucideIcon,
  Layers,
  ChevronDown,
  Search,
  Menu,
  X,
  Plus,
  RefreshCw,
  LogOut,
  ArrowUpRight,
  CalendarDays,
  ArrowRight,
  Sparkles,
  TrendingUp,
  Wallet,
  Workflow,
  FolderKanban,
  TriangleAlert,
  CheckCircle2,
  Bell,
  LayoutDashboard,
  Command,
} from "lucide-react";
import { catalog, modules, statusLabels } from "@/lib/catalog";
import type { Context, Entity } from "@/lib/types";
import { api, Empty, Loading, money, displayDate, Modal } from "./shared";
import { Auth, Onboarding } from "./auth";
import { Records } from "./records";
import { AiWorkspace } from "./ai-workspace";
import { ZettaWorkspace } from "./zetta-workspace";
import { CompanySettings, Team, Integrations } from "./settings";
import {
  Chat,
  Calendar,
  Reports,
  ModuleStore,
  Pricing,
  Assistant,
} from "./tools";
const groups = [
  { label: "ภาพรวม", items: ["dashboard", "calendar", "chat"] },
  {
    label: "ธุรกิจ & ลูกค้า",
    items: ["customers", "leads", "dealers", "deals", "projects", "tasks", "events"],
  },
  {
    label: "บุคลากร",
    items: ["employees", "freelancers", "leaves", "payroll"],
  },
  {
    label: "คลัง & จัดซื้อ",
    items: ["products", "purchases", "suppliers", "assets"],
  },
  {
    label: "การเงิน & แผนก",
    items: [
      "sales",
      "expenses",
      "invoices",
      "payments",
      "campaigns",
      "tickets",
      "contracts",
      "documents",
      "reports",
    ],
  },
  {
    label: "ZettaFlow AI",
    items: ["ai-inbox", "templates", "assistant", "integrations"],
  },
  { label: "จัดการระบบ", items: ["company", "team", "store", "pricing"] },
];
const extra: Record<
  string,
  { label: string; icon: string; description: string }
> = {
  assistant: {
    label: "AI Assistant",
    icon: "Bot",
    description: "ถามและสรุปภาพรวมจากข้อมูลธุรกิจที่คุณมีสิทธิ์ดู",
  },
  dashboard: {
    label: "Executive Dashboard",
    icon: "LayoutDashboard",
    description: "ภาพรวมธุรกิจและสิ่งที่ทีมต้องติดตาม",
  },
  calendar: {
    label: "ปฏิทินธุรกิจ",
    icon: "CalendarDays",
    description: "กำหนดการโครงการ อีเวนต์ และวันครบกำหนด",
  },
  chat: {
    label: "แชททีม",
    icon: "MessageCircle",
    description: "พื้นที่พูดคุยของทีม แยกตามแผนกและบริษัท",
  },
  reports: {
    label: "รายงาน & Export",
    icon: "ChartNoAxesCombined",
    description: "สรุปข้อมูลและส่งออกสำหรับการวิเคราะห์",
  },
  "ai-inbox": {
    label: "ZettaFlow · Data Inbox",
    icon: "Sparkles",
    description: "เปลี่ยนข้อความและเอกสารเป็นข้อมูลที่ตรวจทานได้",
  },
  templates: {
    label: "Data Templates",
    icon: "PanelsTopLeft",
    description: "กำหนดฟิลด์ข้อมูลและงานหลังอนุมัติด้วยตัวเอง",
  },
  integrations: {
    label: "LINE & Integrations",
    icon: "Plug",
    description: "เชื่อมต่อบริการและตรวจสถานะการประมวลผล",
  },
  company: {
    label: "โปรไฟล์บริษัท",
    icon: "Building2",
    description: "ข้อมูลบริษัท เอกสารอ้างอิง และการปรับแต่ง workspace",
  },
  team: {
    label: "ทีม & สิทธิ์",
    icon: "ShieldCheck",
    description: "จัดการสมาชิกและสิทธิ์การเข้าถึงแต่ละแผนก",
  },
  store: {
    label: "Module Library",
    icon: "Grid2X2",
    description: "เครื่องมือสำหรับทุกทีมในธุรกิจของคุณ",
  },
  pricing: {
    label: "แพ็กเกจบริการ",
    icon: "BadgeDollarSign",
    description: "รูปแบบแพ็กเกจสำหรับ ZettaFlow AI",
  },
};
const details = (view: string) =>
  catalog[view] || extra[view] || extra.dashboard;
const iconMap: Record<string, LucideIcon> = {
  Users,
  Store,
  Truck,
  UserRound,
  ContactRound,
  Folders,
  MapPin,
  ListTodo,
  Monitor,
  Package,
  ShoppingCart,
  ChartNoAxesCombined,
  Receipt,
  FileText,
  CreditCard,
  Megaphone,
  Headset,
  Scale,
  CalendarOff,
  Files,
  MessageCircle,
  PanelsTopLeft,
  Plug,
  Building2,
  ShieldCheck,
  Grid2X2,
  BadgeDollarSign,
  Bot,
  LayoutDashboard,
  CalendarDays,
  Sparkles,
  Wallet,
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Component = iconMap[name] || LayoutDashboard;
  return <Component size={size} />;
}
type Summary = {
  sales: number;
  expenses: number;
  projects: number;
  tasks: number;
  pendingDeals: number;
  lowStock: Entity[];
  series?: { date: string; sales: number; expenses: number }[];
  widgets?: {
    key: string;
    name: string;
    label: string;
    total: number;
    count: number;
  }[];
};
type WorkspaceData = {
  context: Context;
  summary: Summary;
  recent: Entity[];
  audit: { id: string; action: string; target: string; created_at: string }[];
};
export function Workspace({
  initialView = "dashboard",
  product = "elite",
}: {
  initialView?: string;
  product?: "elite" | "zetta";
}) {
  const router = useRouter();
  const requestEpoch = useRef(0);
  const [companyModal, setCompanyModal] = useState(false),
    [companyChoices, setCompanyChoices] = useState<
      { id: string; name: string; role: string }[]
    >([]),
    [companyError, setCompanyError] = useState("");
  const [view, setView] = useState(initialView),
    [data, setData] = useState<WorkspaceData | null>(null),
    [config, setConfig] = useState<{
      configured: boolean;
      demo: boolean;
    } | null>(null),
    [auth, setAuth] = useState(false),
    [onboarding, setOnboarding] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(""),
    [alerts, setAlerts] = useState(false),
    [expanded, setExpanded] = useState(
      () => new Set(["ภาพรวม", "ธุรกิจ & ลูกค้า", "ZettaFlow AI"]),
    ),
    [lastSync, setLastSync] = useState(new Date());
  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  }, []);
  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    try {
      const d = await api("/workspace");
      if (epoch !== requestEpoch.current) return;
      setData(d);
      setAuth(false);
      setOnboarding(false);
      setError("");
      setLastSync(new Date());
    } catch (e) {
      if (epoch !== requestEpoch.current) return;
      const err = e as Error & { status: number };
      if (err.status === 401) setAuth(true);
      else if (err.status === 428) setOnboarding(true);
      else if (err.status === 503) setAuth(true);
      else setError(err.message);
    }
  }, []);
  useEffect(() => {
    api("/config")
      .then((c) => {
        setConfig(c);
        if (c.configured || c.demo) load();
        else setAuth(true);
      })
      .catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    setView(initialView);
    const activeGroup = groups.find((g) => g.items.includes(initialView));
    if (activeGroup) setExpanded((s) => new Set([...s, activeGroup.label]));
    setMobile(false);
  }, [initialView]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!data || auth) return;
    const timer = setInterval(() => {
      if (!document.hidden && !document.querySelector("dialog[open]")) load();
    }, 30000);
    return () => clearInterval(timer);
  }, [data, auth, load]);
  const navigate = useCallback(
    (next: string) => {
      setMobile(false);
      setSearchOpen(false);
      router.push(next === "dashboard" ? "/eliteflow" : "/workspace/" + next);
    },
    [router],
  );
  if (onboarding) return <Onboarding onComplete={load} />;
  if (auth && config)
    return (
      <Auth demo={config.demo} configured={config.configured} onLogin={load} product={product} />
    );
  if (!data)
    return (
      <div className="boot-screen">
        <span className="brand-mark">
          <Layers size={27} />
        </span>
        {error ? <p className="form-error">{error}</p> : <Loading />}
      </div>
    );
  const ctx = data.context,
    meta = details(view),
    brand = String(ctx.company.settings.brand || "EliteFlow"),
    theme = String(ctx.company.settings.theme || "violet");
  if (product === "zetta")
    return (
      <ZettaWorkspace
        ctx={ctx}
        view={initialView}
        changed={load}
        onLogout={async () => {
          await api("/auth/logout", { method: "POST" });
          requestEpoch.current++;
          setData(null);
          setAuth(true);
        }}
      />
    );
  const visible = (key: string) =>
    key === "team"
      ? ctx.member.role === "owner"
      : catalog[key]
        ? ctx.member.role === "owner" ||
          ctx.member.departments.includes(catalog[key].department) ||
          ["tasks", "documents", "tickets"].includes(key)
        : true;
  return (
    <div
      className={"workspace theme-" + theme + (mobile ? " mobile-open" : "")}
    >
      <aside className="sidebar">
        <button
          className="brand brand-button"
          onClick={() => navigate("dashboard")}
        >
          <span className="brand-mark">
            <Layers size={21} />
          </span>
          {brand === "EliteFlow" ? (
            <>
              Elite<span>Flow</span>
            </>
          ) : (
            <>
              Zetta<span>Flow</span>
              <small>AI</small>
            </>
          )}
        </button>
        <button
          className="company-selector"
          onClick={async () => {
            setCompanyModal(true);
            try {
              setCompanyChoices(await api("/companies"));
              setCompanyError("");
            } catch (e) {
              setCompanyError((e as Error).message);
            }
          }}
        >
          <div className="company-icon">{ctx.company.name[0]}</div>
          <div>
            <strong>{ctx.company.name}</strong>
            <small>Business Workspace</small>
          </div>
          <ChevronDown size={15} />
        </button>
        <nav>
          {groups.map((group) => {
            const items = group.items.filter(visible);
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <button
                  className="nav-group-label"
                  onClick={() =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (next.has(group.label)) next.delete(group.label);
                      else next.add(group.label);
                      return next;
                    })
                  }
                >
                  {group.label}
                  <ChevronDown
                    size={12}
                    className={expanded.has(group.label) ? "" : "collapsed"}
                  />
                </button>
                {expanded.has(group.label) &&
                  items.map((key) => (
                    <button
                      key={key}
                      className={"nav-item " + (view === key ? "active" : "")}
                      onClick={() => navigate(key)}
                    >
                      <Icon name={details(key).icon} />
                      <span>{details(key).label}</span>
                      {key === "ai-inbox" && <span className="nav-ai">AI</span>}
                    </button>
                  ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button
            className="nav-item"
            onClick={() => router.push("/zetta/dashboard")}
          >
            <Sparkles size={18} />
            เปิด ZettaFlow AI
            <ArrowRight size={15} />
          </button>
          <span className="live-dot" />
          <span>
            {ctx.demo ? "Local demo workspace" : "Supabase workspace"}
          </span>
          <button
            className="icon-button"
            onClick={() => {
              setMobile(false);
            }}
            aria-label="ปิดเมนู"
          >
            <X size={15} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="ปิดเมนู"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="workspace-body">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="เปิดเมนู"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{meta.label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="command-button"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={16} />
              <span>ค้นหาเครื่องมือ</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="notification-button icon-button"
              aria-label="แจ้งเตือน"
              onClick={() => setAlerts(!alerts)}
            >
              <Bell size={19} />
              {data.summary.lowStock.length > 0 && <i />}
            </button>
            <span className="divider" />
            <div className="user-profile">
              <span className="avatar">{ctx.user.name[0]}</span>
              <div>
                <strong>{ctx.user.name}</strong>
                <small>{ctx.member.role.toUpperCase()}</small>
              </div>
            </div>
            <button
              className="icon-button"
              aria-label="ออกจากระบบ"
              onClick={async () => {
                requestEpoch.current++;
                setAuth(true);
                setData(null);
                try {
                  await api("/auth", {
                    method: "POST",
                    body: { action: "logout" },
                  });
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        {ctx.demo && (
          <div className="demo-banner">
            <span>DEMO</span>ข้อมูลตัวอย่างสำหรับทดสอบบนเครื่อง · เมื่อ deploy
            จะใช้ Supabase และบัญชีจริง
          </div>
        )}
        <main className="main" key={ctx.company.id}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR BUSINESS, CONNECTED</div>
              <h1>{meta.label}</h1>
              <p>{meta.description}</p>
            </div>
            <div className="heading-actions">
              <div className="date-chip">
                <CalendarDays size={15} />
                {new Date().toLocaleDateString("th-TH", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "Asia/Bangkok",
                })}
              </div>
              <button
                className="icon-button refresh-button"
                aria-label="รีเฟรช"
                onClick={() => {
                  load();
                  notify("อัปเดตภาพรวมแล้ว");
                }}
              >
                <RefreshCw size={17} />
              </button>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          {view === "dashboard" ? (
            <Dashboard data={data} navigate={navigate} />
          ) : catalog[view] ? (
            <Records
              key={view}
              kind={view}
              ctx={ctx}
              notify={notify}
              changed={load}
            />
          ) : view === "ai-inbox" || view === "templates" ? (
            <AiWorkspace ctx={ctx} view={view} notify={notify} changed={load} />
          ) : view === "company" ? (
            <CompanySettings ctx={ctx} notify={notify} changed={load} />
          ) : view === "team" ? (
            <Team ctx={ctx} notify={notify} />
          ) : view === "integrations" ? (
            <Integrations ctx={ctx} notify={notify} />
          ) : view === "chat" ? (
            <Chat ctx={ctx} notify={notify} />
          ) : view === "calendar" ? (
            <Calendar navigate={navigate} />
          ) : view === "reports" ? (
            <Reports notify={notify} />
          ) : view === "store" ? (
            <ModuleStore navigate={navigate} />
          ) : view === "pricing" ? (
            <Pricing />
          ) : view === "assistant" ? (
            <Assistant />
          ) : (
            <Empty title="ไม่พบหน้า" />
          )}
          <footer className="main-footer">
            <span>{brand} · Business connected.</span>
            <span>
              <span className="live-dot" />
              อัปเดต{" "}
              {lastSync.toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Bangkok",
              })}
            </span>
          </footer>
        </main>
      </div>
      {companyModal && (
        <Modal title="เลือกบริษัท" onClose={() => setCompanyModal(false)}>
          <div className="command-results">
            {companyChoices.map((c) => (
              <button
                key={c.id}
                onClick={async () => {
                  try {
                    if (!ctx.demo)
                      await api("/companies", {
                        method: "POST",
                        body: { id: c.id },
                      });
                    setCompanyModal(false);
                    navigate("dashboard");
                    await load();
                  } catch (e) {
                    setCompanyError((e as Error).message);
                  }
                }}
              >
                <span>{c.name}</span>
                <small>{c.role}</small>
                {c.id === ctx.company.id && <CheckCircle2 size={16} />}
              </button>
            ))}
          </div>
          {!ctx.demo && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/onboarding", {
                    method: "POST",
                    body: { name: new FormData(e.currentTarget).get("name") },
                  });
                  setCompanyModal(false);
                  navigate("dashboard");
                  await load();
                } catch (err) {
                  setCompanyError((err as Error).message);
                }
              }}
            >
              <label>
                สร้างบริษัทเพิ่มเติม
                <input name="name" required maxLength={200} />
              </label>
              <button className="primary full">สร้าง workspace ใหม่</button>
            </form>
          )}
          <p role="alert" className="form-error">
            {companyError}
          </p>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {alerts && (
        <Modal title="สิ่งที่ต้องติดตาม" onClose={() => setAlerts(false)}>
          <div className="alert-list">
            <p>
              {data.summary.pendingDeals} ดีลรออนุมัติ · {data.summary.tasks}{" "}
              งานที่ยังไม่เสร็จ
            </p>
            {data.summary.lowStock.map((p) => (
              <button
                className="alert-item"
                key={p.id}
                onClick={() => {
                  setAlerts(false);
                  navigate("products");
                }}
              >
                <TriangleAlert size={18} />
                <span>
                  {String(p.data.name)}
                  <small>
                    เหลือ {money(p.data.stock)} · จุดสั่งซื้อ{" "}
                    {money(p.data.reorderLevel)}
                  </small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
            {!data.summary.lowStock.length && (
              <Empty title="สต็อกทั้งหมดอยู่เหนือจุดแจ้งเตือน" />
            )}
          </div>
        </Modal>
      )}
      {searchOpen && (
        <Modal title="ไปยังเครื่องมือ" onClose={() => setSearchOpen(false)}>
          <div className="search-box command-search">
            <Search size={18} />
            <input
              aria-label="ค้นหาเครื่องมือ"
              autoFocus
              placeholder="ค้นหาลูกค้า โครงการ สต็อก หรือแผนก…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="command-results">
            {Object.keys({ ...catalog, ...extra })
              .filter(
                (key) =>
                  visible(key) &&
                  (details(key).label + " " + key)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((key) => (
                <button key={key} onClick={() => navigate(key)}>
                  <Icon name={details(key).icon} />
                  <span>{details(key).label}</span>
                  <ArrowRight size={16} />
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Dashboard({
  data,
  navigate,
}: {
  data: WorkspaceData;
  navigate: (v: string) => void;
}) {
  const s = data.summary,
    metrics = [
      {
        label: "ยอดขายที่ยืนยัน",
        value: "฿ " + money(s.sales),
        note: "ยอดขายจากข้อมูลธุรกิจ",
        icon: TrendingUp,
        color: "violet",
        view: "sales",
      },
      {
        label: "ค่าใช้จ่ายที่อนุมัติ",
        value: "฿ " + money(s.expenses),
        note: "ค่าใช้จ่ายที่อนุมัติ / จ่ายแล้ว",
        icon: Wallet,
        color: "rose",
        view: "expenses",
      },
      {
        label: "โครงการที่ดำเนินการ",
        value: s.projects,
        note: "Planning · Active · Review",
        icon: FolderKanban,
        color: "blue",
        view: "projects",
      },
      {
        label: "งานที่ต้องติดตาม",
        value: s.tasks,
        note: "งานที่ยังไม่ปิดสถานะ",
        icon: Workflow,
        color: "mint",
        view: "tasks",
      },
    ];
  const recentProjects = data.recent.filter(
    (e) => e.kind === "projects" || e.kind === "deals",
  );
  const series =
    s.series ||
    data.recent
      .filter((e) => e.kind === "sales" && e.data.status === "confirmed")
      .map((e) => ({
        date: String(e.data.date),
        sales: Number(e.data.amount),
        expenses: 0,
      }));
  const max = Math.max(1, ...series.map((v) => Math.max(v.sales, v.expenses)));
  return (
    <>
      <div className="metric-grid">
        {metrics.map((m) => (
          <button
            className="metric-card"
            key={m.label}
            onClick={() => navigate(m.view)}
          >
            <div className="metric-top">
              <span>{m.label}</span>
              <i className={"metric-icon " + m.color}>
                <m.icon size={19} />
              </i>
            </div>
            <strong>{m.value}</strong>
            <div className="metric-bottom">
              <span>{m.note}</span>
              <ArrowUpRight size={14} />
            </div>
          </button>
        ))}
      </div>
      {!!s.widgets?.length && (
        <section className="card dynamic-widgets">
          <div className="card-heading">
            <h2>ข้อมูลตาม Data Template</h2>
            <span className="muted">ปรับตามฟิลด์ตัวเลขที่กำหนด</span>
          </div>
          <div className="widget-grid">
            {s.widgets.map((w) => (
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
      <div className="dashboard-grid">
        <div className="dashboard-left">
          <section className="card chart-card">
            <div className="card-heading">
              <div>
                <h2>ยอดขาย & ค่าใช้จ่าย</h2>
                <p>ภาพรวมจากรายการที่ยืนยันแล้ว</p>
              </div>
              <button className="secondary" onClick={() => navigate("reports")}>
                ดูรายงาน
                <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="chart-legend">
              <span>
                <i />
                ยอดขาย
              </span>
              <span>
                <i />
                ค่าใช้จ่าย
              </span>
            </div>
            {series.length ? (
              <div className="chart-area">
                <div className="chart-axis">
                  <span>{money(max)}</span>
                  <span>{money(max / 2)}</span>
                  <span>0</span>
                </div>
                <div className="bar-chart">
                  {series.slice(-14).map((day, index) => (
                    <div className="bar-group" key={day.date + index}>
                      <div className="bar-pair">
                        <div
                          className="bar sales"
                          style={{
                            height: Math.max(2, (day.sales / max) * 100) + "%",
                          }}
                          title={`ยอดขาย ${money(day.sales)}`}
                        />
                        <div
                          className="bar expenses"
                          style={{
                            height:
                              Math.max(2, (day.expenses / max) * 100) + "%",
                          }}
                          title={`ค่าใช้จ่าย ${money(day.expenses)}`}
                        />
                      </div>
                      <small>{day.date.slice(5)}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Empty
                title="ยังไม่มีข้อมูลสำหรับกราฟ"
                description="บันทึกและยืนยันยอดขายเพื่อดูภาพรวม"
              />
            )}
          </section>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>โครงการและพื้นที่ล่าสุด</h2>
                <p>งานที่ทีมกำลังขับเคลื่อน</p>
              </div>
              <button
                className="text-button"
                onClick={() => navigate("projects")}
              >
                ดูทั้งหมด
                <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>โครงการ / พื้นที่</th>
                    <th>ผู้รับผิดชอบ</th>
                    <th>วันที่สิ้นสุด</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {recentProjects.slice(0, 5).map((p) => (
                    <tr key={p.id}>
                      <td className="primary-cell">
                        <button
                          className="row-link"
                          onClick={() => navigate(p.kind)}
                        >
                          {String(p.data.name)}
                        </button>
                        <small>{catalog[p.kind].label}</small>
                      </td>
                      <td>{String(p.data.owner || "—")}</td>
                      <td>{displayDate(p.data.endDate)}</td>
                      <td>
                        <span className={"badge " + String(p.data.status)}>
                          {statusLabels[String(p.data.status)]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!recentProjects.length && (
              <Empty
                title="ยังไม่มีโครงการ"
                action={
                  <button
                    className="secondary"
                    onClick={() => navigate("projects")}
                  >
                    เริ่มโครงการใหม่
                  </button>
                }
              />
            )}
          </section>
        </div>
        <aside className="dashboard-right">
          <section className="card insight-card">
            <div className="card-heading">
              <h2>Workspace Summary</h2>
              <Sparkles size={21} />
            </div>
            <p>
              มองเห็นสิ่งสำคัญของธุรกิจ
              <br />
              จากข้อมูลที่ทีมอัปเดต
            </p>
            <div className="insight-line">
              <span className="insight-dot amber" />
              มี <strong>{s.pendingDeals} ดีล</strong> รออนุมัติ
            </div>
            <div className="insight-line">
              <span className="insight-dot violet" />
              ติดตามงาน <strong>{s.tasks} งาน</strong>
            </div>
            <div className="insight-line">
              <span className="insight-dot rose" />
              สต็อกถึงจุดสั่งซื้อ <strong>{s.lowStock.length} รายการ</strong>
            </div>
            <small>คำนวณจากข้อมูลที่บัญชีนี้มีสิทธิ์ดู</small>
            <button
              className="insight-button"
              onClick={() => navigate("ai-inbox")}
            >
              เปิด ZettaFlow AI
              <ArrowRight size={15} />
            </button>
          </section>
          <section className="card">
            <div className="card-heading">
              <h2>เครื่องมือของทีม</h2>
              <span className="muted">QUICK ACCESS</span>
            </div>
            {[
              ["customers", "ลูกค้า & CRM"],
              ["products", "สต็อกสินค้า"],
              ["tasks", "งาน & Workflow"],
              ["ai-inbox", "รับข้อมูลด้วย AI"],
            ].map(([key, label]) => (
              <button
                className="quick-link"
                key={key}
                onClick={() => navigate(key)}
              >
                <span>
                  <Icon name={details(key).icon} />
                </span>
                {label}
                <ArrowUpRight size={15} />
              </button>
            ))}
          </section>
          <section className="card">
            <div className="card-heading">
              <h2>กิจกรรมล่าสุด</h2>
              <span className="live-dot" />
            </div>
            {data.audit.length ? (
              data.audit.slice(0, 4).map((a) => (
                <div className="activity-item" key={a.id}>
                  <span className="activity-dot" />
                  <div>
                    <p>{a.action.replaceAll("_", " ")}</p>
                    <small>
                      {displayDate(a.created_at)} · {a.target.slice(0, 8)}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted activity-empty">
                กิจกรรมของทีมจะแสดงหลังบันทึกข้อมูล
              </p>
            )}
          </section>
        </aside>
      </div>
      <section className="cta-card">
        <div>
          <span className="cta-icon">
            <Sparkles size={23} />
          </span>
          <div>
            <h3>ทุกบทสนทนา ต่อยอดเป็นงานของทีมได้</h3>
            <p>กำหนด Template แล้วรับข้อมูลผ่านเว็บหรือกลุ่ม LINE</p>
          </div>
        </div>
        <button className="secondary" onClick={() => navigate("templates")}>
          ออกแบบ Data Template
          <ArrowRight size={16} />
        </button>
      </section>
    </>
  );
}
