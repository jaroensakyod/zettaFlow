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
  Home,
  Folder,
  ChevronDown,
  Search,
  Plus,
  RefreshCw,
  LogOut,
  CalendarDays,
  ArrowRight,
  Sparkles,
  Wallet,
  TriangleAlert,
  CheckCircle2,
  Bell,
  LayoutDashboard,
  Command,
} from "lucide-react";
import { catalog, modules } from "@/lib/catalog";
import type { Context, Entity } from "@/lib/types";
import { api, Empty, Loading, money, Modal } from "./shared";
import { Auth, Onboarding } from "./auth";
import { Records } from "./records";
import { HomeDashboard } from "./home-dashboard";
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
// Shortcuts shown in the top bar; everything else lives under the แผนก menu.
const primary: [string, string, LucideIcon][] = [
  ["dashboard", "หน้าหลัก", Home],
  ["customers", "ลูกค้า", UserRound],
  ["suppliers", "Supplier", Truck],
  ["company", "บริษัท", Building2],
  ["employees", "พนักงาน", Users],
  ["projects", "โปรเจกต์", Folder],
  ["chat", "แชท", MessageCircle],
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
  const navRef = useRef<HTMLElement>(null);
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
    [menu, setMenu] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(""),
    [alerts, setAlerts] = useState(false),
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
    setMenu(false);
  }, [initialView]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !navRef.current?.contains(e.target as Node)
      )
        setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);
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
      setMenu(false);
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
  const openCompanies = async () => {
    setMenu(false);
    setCompanyModal(true);
    try {
      setCompanyChoices(await api("/companies"));
      setCompanyError("");
    } catch (e) {
      setCompanyError((e as Error).message);
    }
  };
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
      className={"workspace top-layout theme-" + theme}
    >
      <div className="workspace-body">
        <header className="topnav" ref={navRef}>
          <button
            className="topnav-brand"
            onClick={() => navigate("dashboard")}
          >
            <span className="topnav-mark">
              {brand === "EliteFlow" ? "EF" : "ZF"}
            </span>
            <strong>{brand}</strong>
          </button>
          <nav className="topnav-links" aria-label="เมนูหลัก">
            {primary
              .filter(([key]) => visible(key))
              .map(([key, label, Ico]) => (
                <button
                  key={key}
                  className={"topnav-link" + (view === key ? " active" : "")}
                  aria-current={view === key ? "page" : undefined}
                  onClick={() => navigate(key)}
                >
                  <Ico size={16} />
                  {label}
                </button>
              ))}
            <button
              className={
                "topnav-link" +
                (menu || !primary.some(([key]) => key === view)
                  ? " active"
                  : "")
              }
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Grid2X2 size={16} />
              แผนก
              <ChevronDown size={14} className={menu ? "flip" : ""} />
            </button>
          </nav>
          <div className="topnav-actions">
            <button
              className="icon-button"
              aria-label="ค้นหาเครื่องมือ"
              title="ค้นหาเครื่องมือ (⌘K)"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={18} />
            </button>
            <button
              className="notification-button icon-button"
              aria-label="แจ้งเตือน"
              onClick={() => setAlerts(!alerts)}
            >
              <Bell size={18} />
              {data.summary.lowStock.length > 0 && <i />}
            </button>
            <button
              className="user-profile"
              title={ctx.company.name + " · สลับบริษัท"}
              onClick={openCompanies}
            >
              <span className="avatar">{ctx.user.name[0]}</span>
              <span>
                <strong>{ctx.user.name}</strong>
                <small>{ctx.company.name}</small>
              </span>
            </button>
            <button
              className="icon-button topnav-logout"
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
          {menu && (
            <div className="topnav-menu">
              {groups.map((group) => {
                const items = group.items.filter(
                  (key) => visible(key) && !primary.some(([k]) => k === key),
                );
                if (!items.length) return null;
                return (
                  <div className="topnav-menu-group" key={group.label}>
                    <span>{group.label}</span>
                    {items.map((key) => (
                      <button
                        key={key}
                        className={view === key ? "active" : ""}
                        onClick={() => navigate(key)}
                      >
                        <Icon name={details(key).icon} size={16} />
                        {details(key).label}
                        {key === "ai-inbox" && <span className="nav-ai">AI</span>}
                      </button>
                    ))}
                  </div>
                );
              })}
              <div className="topnav-menu-group">
                <span>อื่นๆ</span>
                <button onClick={openCompanies}>
                  <Building2 size={16} />
                  สลับบริษัท
                </button>
                <button onClick={() => router.push("/zetta/dashboard")}>
                  <Sparkles size={16} />
                  เปิด ZettaFlow AI
                </button>
              </div>
            </div>
          )}
        </header>
        {ctx.demo && (
          <div className="demo-banner">
            <span>DEMO</span>ข้อมูลตัวอย่างสำหรับทดสอบบนเครื่อง · เมื่อ deploy
            จะใช้ Supabase และบัญชีจริง
          </div>
        )}
        <main className="main" key={ctx.company.id}>
          {view !== "dashboard" && view !== "company" && (
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
          )}
          {error && <p className="form-error">{error}</p>}
          {view === "dashboard" ? (
            <HomeDashboard
              ctx={ctx}
              summary={data.summary}
              navigate={navigate}
              refreshKey={lastSync.getTime()}
            />
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
