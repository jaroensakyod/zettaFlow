"use client";
import { Suspense, useState, useEffect, useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  Network,
  BriefcaseBusiness,
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
  ScanLine,
  LifeBuoy,
} from "lucide-react";
import { catalog, modules } from "@/lib/catalog";
import type { Context, Entity } from "@/lib/types";
import { api, Empty, Loading, money, Modal } from "./shared";
import { Auth, Onboarding } from "./auth";
import { Records } from "./records";
import { HomeDashboard } from "./home-dashboard";
import { Feed } from "./feed";
import { Jobs } from "./jobs";
import { FlowAssistant } from "./flow-assistant";
import { SubscriptionPanel, SlipChecker } from "./platform";
import { SupportChat, AdminConsole } from "./engage";
import { AiWorkspace } from "./ai-workspace";
import { CoinBadge, CoinStore, Departments } from "./coins";
import { Accounting } from "./accounting";
import { Directory } from "./directory";
import { DepartmentMegaMenu, DEPT_KEY } from "./dept-menu";
import { DepartmentSidebar } from "./dept-sidebar";
import { SampleDataCard } from "./sample-data-card";
import { ExpenseForm } from "./expense-form";
import { departmentOf } from "@/lib/departments";
import { TaxReport, Expiries, TransfersPage, ExpiryAlerts } from "./dept-views";
import { ZettaWorkspace } from "./zetta-workspace";
import { CompanySettings, Team, Integrations } from "./settings";
import {
  Chat,
  Calendar,
  Reports,
  Assistant,
} from "./tools";
// Pages outside the department cards, listed in the menu's bottom row.
const toolKeys = [
  "calendar", "chat", "projects", "dealers", "deals", "freelancers", "slips", "reports",
  "ai-inbox", "templates", "assistant", "integrations",
  "departments", "company", "team", "store", "pricing", "admin",
];
// Shortcuts shown in the top bar; everything else lives under the แผนก menu.
const primary: [string, string, LucideIcon][] = [
  ["feed", "เครือข่ายธุรกิจ", Network],
  ["jobs", "หางาน & จับคู่", BriefcaseBusiness],
  ["dashboard", "ภาพรวม", LayoutDashboard],
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
  jobs: {
    label: "หางาน & จับคู่งาน",
    icon: "BriefcaseBusiness",
    description: "ตำแหน่งงาน ฟรีแลนซ์ และงาน B2B ที่เข้ากับบริษัทคุณ",
  },
  feed: {
    label: "เครือข่ายธุรกิจ",
    icon: "Network",
    description: "อัปเดต ประกาศงาน และโอกาสจากบริษัทในเครือข่าย",
  },
  dashboard: {
    label: "ภาพรวมงาน",
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
  "expense-new": {
    label: "บันทึกค่าใช้จ่าย",
    icon: "Wallet",
    description: "กรอกข้อมูลค่าใช้จ่าย เพื่ออนุมัติและบันทึกเข้าระบบ",
  },
  tax: {
    label: "ภาษี & ภ.ง.ด.",
    icon: "Wallet",
    description: "ภาษีซื้อ ภ.พ.30 และหัก ณ ที่จ่าย ภ.ง.ด.3 / ภ.ง.ด.53 รายเดือน จากค่าใช้จ่ายที่ตรวจแล้ว",
  },
  expiries: {
    label: "ติดตามวันหมดอายุ",
    icon: "CalendarDays",
    description: "สัญญา ไลเซนส์ ทรัพย์สินทางปัญญา ภาษี/ประกันรถ และนัดคดี เรียงตามวันที่ใกล้สุด",
  },
  transfers: {
    label: "โอนย้ายสินค้า",
    icon: "Package",
    description: "โอนสินค้าจากคลังกลางไปโปรเจกต์ และดูยอดคงเหลือแต่ละโปรเจกต์",
  },
  departments: {
    label: "แผนกทั้งหมด",
    icon: "Grid2X2",
    description: "เลือกแผนกเพื่อเปิดระบบงานของแผนกนั้น",
  },
  store: {
    label: "Module Store",
    icon: "Store",
    description: "ซื้อระบบของแต่ละแผนกด้วยเหรียญ ซื้อครั้งเดียวใช้ได้ตลอด",
  },
  pricing: {
    label: "แพ็กเกจบริการ",
    icon: "BadgeDollarSign",
    description: "เลือกแพ็กเกจ ดูโควตาการใช้งาน และชำระเงินด้วยสลิปโอน",
  },
  slips: {
    label: "ตรวจสลิปโอนเงิน",
    icon: "ScanLine",
    description: "อ่าน QR บนสลิป เทียบยอด และกันการใช้สลิปซ้ำ",
  },
  admin: {
    label: "Admin Console",
    icon: "LifeBuoy",
    description: "แชทลูกค้า · โปรโมชัน · ประกาศ · ยืนยันการชำระเงิน",
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
  Network,
  BriefcaseBusiness,
  CalendarDays,
  Sparkles,
  Wallet,
  ScanLine,
  LifeBuoy,
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
  platformAdmin?: boolean;
};
type WorkspaceProps = { initialView?: string; product?: "elite" | "zetta" };
// The workspace reads the URL query (sidebar, list filters, the expense being edited), so Next needs a Suspense
// boundary around it for pages it prerenders.
export function Workspace(props: WorkspaceProps) {
  return (
    <Suspense fallback={<div className="boot-screen" />}>
      <WorkspaceView {...props} />
    </Suspense>
  );
}

function WorkspaceView({ initialView = "feed", product = "elite" }: WorkspaceProps) {
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
    [menuClosing, setMenuClosing] = useState(false),
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
      router.push(next === "feed" ? "/eliteflow" : "/workspace/" + next);
    },
    [router],
  );
  // Department pages get that department's left sidebar (the last department used wins when a page is shared).
  const searchParams = useSearchParams(),
    fullView = view + (searchParams.toString() ? "?" + searchParams.toString() : ""),
    [preferredDept, setPreferredDept] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPreferredDept(sessionStorage.getItem(DEPT_KEY));
    } catch {}
  }, [fullView]);
  const sideDept = departmentOf(fullView, preferredDept);
  // Menu links like "content?channel=social" or "leaves?status=pending" narrow a record list.
  const listFilter = (() => {
    const m = catalog[view];
    if (!m) return undefined;
    for (const [k, v] of searchParams.entries()) {
      if (k === "channel" && v === "social")
        return { label: "Social Media", test: (e: Entity) => ["Facebook", "Instagram", "TikTok", "LINE OA", "YouTube"].includes(String(e.data.channel)) };
      const f = m.fields.find((x) => x.key === k && x.options?.includes(v));
      if (f) return { label: f.label + ": " + v, test: (e: Entity) => e.data[k] === v };
    }
  })();
  // แผนก opens when a mouse points at it and fades out shortly after the pointer leaves both the button and the menu.
  const menuTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    lastPointer = useRef("");
  useEffect(() => () => clearTimeout(menuTimer.current), []);
  const menuHoverOpen = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(menuTimer.current);
    setMenuClosing(false);
    setMenu(true);
  };
  const menuHoverClose = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(menuTimer.current);
    menuTimer.current = setTimeout(() => {
      setMenuClosing(true);
      menuTimer.current = setTimeout(() => {
        setMenu(false);
        setMenuClosing(false);
      }, 160);
    }, 220);
  };
  if (onboarding) return <Onboarding onComplete={load} />;
  if (auth && config)
    return (
      <Auth demo={config.demo} configured={config.configured} onLogin={load} product={product} />
    );
  if (!data)
    return (
      <div className="boot-screen">
        {product === "elite" && (
          <img className="boot-logo" src="/brand/eliteflow-mark.png" alt="EliteFlow" width={64} height={64} />
        )}
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
    key === "admin"
      ? !!data.platformAdmin
      : key === "team"
      ? ctx.member.role === "owner"
      : key === "tax"
      ? ctx.member.role === "owner" || ctx.member.departments.includes("Finance")
      : key === "transfers"
      ? ctx.member.role === "owner" || ctx.member.departments.includes("Warehouse")
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
            onClick={() => navigate("feed")}
          >
            {brand === "EliteFlow" ? (
              <img className="topnav-logo" src="/brand/eliteflow-mark.png" alt="" width={36} height={36} />
            ) : (
              <span className="topnav-mark">ZF</span>
            )}
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
              onPointerDown={(e) => (lastPointer.current = e.pointerType)}
              onPointerEnter={menuHoverOpen}
              onPointerLeave={menuHoverClose}
              onClick={() => {
                // A mouse already opened it on hover; a click shouldn't snap it shut again.
                if (lastPointer.current === "mouse" && menu) return;
                setMenuClosing(false);
                setMenu(!menu);
              }}
            >
              <Grid2X2 size={16} />
              แผนก
              <ChevronDown size={14} className={menu ? "flip" : ""} />
            </button>
          </nav>
          <div className="topnav-actions">
            <CoinBadge ctx={ctx} />
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
            <DepartmentMegaMenu
              view={view}
              visible={visible}
              navigate={navigate}
              closing={menuClosing}
              onPointerEnter={menuHoverOpen}
              onPointerLeave={menuHoverClose}
            />
          )}
        </header>
        {ctx.demo && (
          <div className="demo-banner">
            <span>DEMO</span>ข้อมูลตัวอย่างสำหรับทดสอบบนเครื่อง · เมื่อ deploy
            จะใช้ Supabase และบัญชีจริง
          </div>
        )}
        <div className={"dept-shell" + (sideDept ? " with-side" : "")}>
        {sideDept && <DepartmentSidebar dept={sideDept} view={fullView} navigate={navigate} />}
        <main className="main" key={ctx.company.id}>
          {!["feed", "jobs", "dashboard", "company", "expense-new"].includes(view) && (
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
          {view === "feed" ? (
            <Feed ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "jobs" ? (
            <Jobs ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "dashboard" ? (
            <HomeDashboard
              ctx={ctx}
              summary={data.summary}
              navigate={navigate}
              notify={notify}
              refreshKey={lastSync.getTime()}
            />
          ) : view === "expense-new" ? (
            <ExpenseForm key={searchParams.get("id") || "new"} ctx={ctx} id={searchParams.get("id")} navigate={navigate} notify={notify} changed={load} />
          ) : view === "expenses" && catalog[view] ? (
            <>
              <Accounting key={"acc:" + fullView} ctx={ctx} notify={notify} changed={load} navigate={navigate} />
              <h2 className="acc-table-title">ตารางค่าใช้จ่ายทั้งหมด</h2>
              <Records key={view} kind={view} ctx={ctx} notify={notify} changed={load} refresh={lastSync.getTime()} />
            </>
          ) : view === "customers" || view === "suppliers" || view === "employees" ? (
            <Directory key={view} kind={view} ctx={ctx} notify={notify} changed={load} navigate={navigate} />
          ) : catalog[view] ? (
            <Records
              key={fullView}
              kind={view}
              ctx={ctx}
              notify={notify}
              changed={load}
              only={listFilter}
            />
          ) : view === "ai-inbox" || view === "templates" ? (
            <AiWorkspace ctx={ctx} view={view} notify={notify} changed={load} />
          ) : view === "company" ? (
            <>
              <SampleDataCard ctx={ctx} notify={notify} changed={load} />
              <CompanySettings ctx={ctx} notify={notify} changed={load} />
            </>
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
            <CoinStore ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "tax" ? (
            <TaxReport navigate={navigate} />
          ) : view === "expiries" ? (
            <Expiries navigate={navigate} />
          ) : view === "transfers" ? (
            <TransfersPage ctx={ctx} notify={notify} changed={load} />
          ) : view === "departments" ? (
            <Departments ctx={ctx} navigate={navigate} />
          ) : view === "pricing" ? (
            <div className="elite-zone">
              <SubscriptionPanel ctx={ctx} notify={notify} />
            </div>
          ) : view === "slips" ? (
            <div className="elite-zone">
              <SlipChecker />
            </div>
          ) : view === "admin" && data.platformAdmin ? (
            <div className="elite-zone">
              <AdminConsole notify={notify} />
            </div>
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
                    navigate("feed");
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
                  navigate("feed");
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
      <FlowAssistant ctx={ctx} navigate={navigate} notify={notify} />
      {/* Stacked above the Flow mascot so the two launchers never overlap. */}
      <div className="elite-support">
        <SupportChat ctx={ctx} />
      </div>
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
            <ExpiryAlerts navigate={(v) => { setAlerts(false); navigate(v); }} />
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
