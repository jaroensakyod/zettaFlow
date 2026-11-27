"use client";
import { SupportViewBanner } from "./support-view";
import type { SupportView } from "@/lib/support-view";
import { Suspense, useState, useEffect, useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Users,
  Store,
  ArrowLeftRight,
  ChevronRight,
  Settings2,
  Settings,
  UserCircle2,
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
  MessageCircle, MessagesSquare,
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
import { api, Empty, Loading, money, Modal, setTabCompany } from "./shared";
import { Auth, Onboarding } from "./auth";
import { Records } from "./records";
import { HomeDashboard } from "./home-dashboard";
import { Feed } from "./feed";
import { Jobs } from "./jobs";
import { FlowAssistant } from "./flow-assistant";
import { SubscriptionPanel, SlipChecker } from "./platform";
import { SupportChat } from "./engage";
import { AdminApp } from "./admin-app";
import { OnlineDot, usePresencePing } from "./presence";
import { AiWorkspace } from "./ai-workspace";
import { LinePending } from "./line-review";
import { LineIntegrationPage } from "./line-integration";
import { CoinBadge } from "./coins";
import { DepartmentsPage, AppShop } from "./app-shop";
import { ThemeApplier } from "./theme-apply";
import { AdStudio } from "./ads";
import { Accounting } from "./accounting";
import { Directory } from "./directory";
import { DepartmentMegaMenu, DEPT_KEY } from "./dept-menu";
import { LockedSystem, LockMark } from "./member-access";
import { canRead, canWrite } from "@/lib/domain";
import { DepartmentSidebar } from "./dept-sidebar";
import { SampleDataCard } from "./sample-data-card";
import { ExpenseForm } from "./expense-form";
import { ProductCatalog } from "./product-catalog";
import { IncomeForm } from "./income-form";
import { UpgradeDialog } from "./upgrade-dialog";
import { AppSettings, savedLang } from "./app-settings";
import { PlanTag } from "./plan-tag";
import { planBadge, type PlanBadge } from "@/lib/plan-badge";
import { departmentOf, sectionTone, systemDepartment } from "@/lib/departments";
import { TaxReport, Expiries, TransfersPage, ExpiryAlerts } from "./dept-views";
import { ZettaWorkspace } from "./zetta-workspace";
import { Team } from "./settings";
import { ChatHub } from "./b2b-chat";
import { EmployeesPage } from "./employees-page";
import { FinanceCenter } from "./finance-center";
import { IncomePage, FinanceTabs } from "./income-page";
import { OrdersPage } from "./orders-page";
import { QuotesPage } from "./quotes-page";
import { FinanceLedger } from "./finance-ledger";
import { ReceiptsPage } from "./receipts-page";
import { CompanyProfilePage } from "./company-profile";
import { CompanySetupGate, companyNeedsSetup } from "./company-setup-card";
import { ProjectsPage } from "./projects";
import {
  Calendar,
  Reports,
  Assistant,
} from "./tools";
// Pages outside the department cards, listed in the menu's bottom row.
const toolKeys = [
  "calendar", "chat", "projects", "dealers", "deals", "freelancers", "slips", "reports",
  "ai-inbox", "templates", "assistant", "integrations",
  "departments", "company", "team", "store", "ads", "pricing", "admin",
];
// Shortcuts shown in the top bar; everything else lives under the แผนก menu.
const primary: [string, string, LucideIcon][] = [
  ["dashboard", "ภาพรวม", LayoutDashboard],
  ["feed", "เครือข่ายธุรกิจ", Network],
  ["customers", "ลูกค้า", UserRound],
  ["suppliers", "Supplier", Truck],
  ["company", "บริษัท", Building2],
  ["employees", "พนักงาน", Users],
  ["projects", "โปรเจกต์", Folder],
  ["chat", "แชท", MessageCircle],
  ["integrations", "LINE", MessagesSquare],
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
  settings: {
    label: "ตั้งค่า",
    icon: "Settings",
    description: "ภาษาและการใช้งานของคุณ",
  },
  profile: {
    label: "หน้าบริษัท",
    icon: "Building2",
    description: "หน้าบริษัทในเครือข่ายธุรกิจ: อัปเดต ผู้ติดตาม และบริษัทที่ติดตาม",
  },
  receipts: {
    label: "ใบเสร็จรับเงิน",
    icon: "Receipt",
    description: "ใบเสร็จรับเงินและใบกำกับภาษี ออกเลขที่ ดู และพิมพ์ จากการรับชำระและใบแจ้งหนี้",
  },
  finance: {
    label: "Financial Center",
    icon: "Landmark",
    description: "ภาพรวมการเงินองค์กร งบประมาณ เป้าหมาย และปิดงบประจำปี",
  },
  chat: {
    label: "แชท",
    icon: "MessageCircle",
    description: "คุยกันในทีมตามแผนก และคุยกับบริษัทอื่นในเครือข่ายธุรกิจ",
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
    label: "LINE",
    icon: "Plug",
    description: "กลุ่ม LINE ที่เชื่อม ข้อความที่ส่งเข้ามา และแต่ละข้อความถูกบันทึกไปที่หน้าไหน",
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
  "income-new": {
    label: "บันทึกรายรับ",
    icon: "Wallet",
    description: "บันทึกเงินที่ได้รับจากลูกค้า ผูกกับใบแจ้งหนี้ แล้วออกใบเสร็จรับเงินได้",
  },
  income: {
    label: "รายรับ",
    icon: "Wallet",
    description: "รายรับ ใบแจ้งหนี้ ภาษีขาย ภ.พ.30 และยอดที่ลูกค้าค้างชำระ",
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
    label: "แผนก (Departments)",
    icon: "Grid2X2",
    description: "เลือกแผนกเพื่อเปิดระบบงานของแผนกนั้น",
  },
  ads: {
    label: "ลงโฆษณา",
    icon: "Megaphone",
    description: "ซื้อการ์ดผู้สนับสนุนในหน้าเครือข่ายธุรกิจด้วยเหรียญ ให้บริษัทอื่นเห็นสินค้าและบริการของคุณ",
  },
  store: {
    label: "App Shop",
    icon: "Store",
    description: "ศูนย์รวมระบบเสริม AI Characters ธีม และฟังก์ชันเฉพาะทาง ซื้อด้วยเหรียญ",
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
  Settings,
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
  /** Platform admins and the EliteFlow company account: every department open. */
  unlockAll?: boolean;
  /** This admin is looking at the company read-only (ดูในมุมมองลูกค้า). */
  support?: SupportView | null;
  /** Owners / managers: the EliteFlow team is looking right now. */
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
  const [navEl, setNavEl] = useState<HTMLElement | null>(null);
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
    [account, setAccount] = useState(false),
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
      // Pin this tab to the company it is showing, so switching in another tab does not move it.
      if (d?.context?.company?.id && !d.context.demo) setTabCompany(d.context.company.id);
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
  // Phones: the top bar slides away while scrolling down and comes back on the way up, so it never sits over the
  // page. --nav-vis is how much of it is on screen; sticky bars and scroll targets in the pages sit below that.
  useEffect(() => {
    const nav = navEl;
    if (!nav) return;
    const root = document.documentElement,
      phone = window.matchMedia("(max-width: 720px)");
    let last = window.scrollY,
      hidden = false;
    const apply = () => {
      const h = nav.offsetHeight,
        y = window.scrollY;
      if (!phone.matches || menu || y < h) hidden = false;
      else if (y > last + 4) hidden = true;
      else if (y < last - 4) hidden = false;
      last = y;
      nav.classList.toggle("nav-hidden", hidden);
      root.style.setProperty("--nav-h", h + "px");
      root.style.setProperty("--nav-vis", (hidden ? 0 : h) + "px");
    };
    const onScroll = apply;
    const ro = new ResizeObserver(onScroll);
    ro.observe(nav);
    window.addEventListener("scroll", onScroll, { passive: true });
    phone.addEventListener("change", onScroll);
    apply();
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      phone.removeEventListener("change", onScroll);
    };
  }, [menu, navEl]);
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
  usePresencePing(!!data && !auth);
  // The company's own package, shown on the account chip (refreshed when the workspace reloads, e.g. after paying).
  const [myPlan, setMyPlan] = useState<PlanBadge | null>(null);
  const signedIn = !!data && !auth;
  useEffect(() => {
    document.documentElement.lang = savedLang();
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    api("/billing")
      .then((b: { subscription?: { plan: string; status: string; current_period_end: string | null; trial_ends_at: string | null } }) =>
        setMyPlan(b.subscription ? planBadge({ plan: b.subscription.plan, status: b.subscription.status, end: b.subscription.current_period_end, trialEnd: b.subscription.trial_ends_at }) : null),
      )
      .catch(() => setMyPlan(null));
  }, [signedIn]);
  const navigate = useCallback(
    (next: string) => {
      setMenu(false);
      setSearchOpen(false);
      router.push("/workspace/" + next);
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
  // Pages opened from the top bar as a whole: the company profile, ลูกค้า, Supplier and พนักงาน — no department sidebar.
  // พนักงาน in the top menu is the company-wide page (no sidebar); opened from ฝ่ายบุคคล (employees?dept=hr) it is HR's first page.
  const sideDept = ["company", "profile", "customers", "suppliers", "settings"].includes(view) || (view === "employees" && !fullView.includes("dept=hr")) ? undefined : departmentOf(fullView, preferredDept);
  const navKey = view === "profile" ? "feed" : view;
  // Menu links like "content?channel=social" or "leaves?status=pending" narrow a record list.
  const listFilter = (() => {
    const m = catalog[view];
    if (!m) return undefined;
    for (const [k, v] of searchParams.entries()) {
      if (k === "channel" && v === "social")
        return { label: "Social Media", test: (e: Entity) => ["Facebook", "Instagram", "TikTok", "LINE OA", "YouTube"].includes(String(e.data.channel)) };
      const f = m.fields.find((x) => x.key === k && x.options?.includes(v));
      // A new record on a narrowed list starts with that value (รับชำระเงิน = payments?direction=income).
      if (f) return { label: k === "direction" && v === "income" ? "รับเงิน" : f.label + ": " + v, test: (e: Entity) => e.data[k] === v, preset: { [k]: v } };
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
          setTabCompany(null);
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
  // Platform-admin and owner-only pages stay hidden from everyone else.
  const visible = (key: string) =>
    key === "admin" ? !!data.platformAdmin : key === "team" ? ctx.member.role === "owner" : true;
  // A department page this member has neither ดู nor ใช้งาน on stays in the menus with a lock and opens LockedSystem.
  const locked = (key: string) => {
    const d = systemDepartment(key);
    return !!d && !canRead(ctx, d);
  };
  return (
    <div
      className={"workspace top-layout theme-" + theme}
    >
      <div className="workspace-body">
        <header
          className="topnav"
          ref={(el) => {
            navRef.current = el;
            setNavEl(el);
          }}
        >
          <button
            className="topnav-brand"
            onClick={() => navigate("dashboard")}
          >
            {brand === "EliteFlow" ? (
              <img className="topnav-logo" src="/brand/eliteflow-mark.png" alt="" width={36} height={36} />
            ) : (
              <span className="topnav-mark">ZF</span>
            )}
            <strong>{brand}</strong>
          </button>
          {/* Company pages belong to the business network tab. */}
          <nav className="topnav-links" aria-label="เมนูหลัก">
            {primary
              .filter(([key]) => visible(key))
              .map(([key, label, Ico]) => (
                <button
                  key={key}
                  className={"topnav-link" + (navKey === key ? " active" : "")}
                  aria-current={navKey === key ? "page" : undefined}
                  onClick={() => navigate(key)}
                >
                  <Ico size={16} />
                  {label}
                  {locked(key) && <LockMark />}
                </button>
              ))}
            <button
              className={
                "topnav-link" +
                (menu || (navKey !== "store" && navKey !== "admin" && !primary.some(([key]) => key === navKey))
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
              แผนกของฉัน
              <ChevronDown size={14} className={menu ? "flip" : ""} />
            </button>
            {/* App Shop right after แผนกของฉัน: where the locked departments are unlocked. */}
            {visible("store") && (
              <button
                className={"topnav-link" + (navKey === "store" ? " active" : "")}
                aria-current={navKey === "store" ? "page" : undefined}
                onClick={() => navigate("store")}
              >
                <Store size={16} />
                App Shop
              </button>
            )}
            {/* หลังบ้าน (Admin Console): only platform admins see it (PLATFORM_ADMIN_EMAILS / admin team). */}
            {visible("admin") && (
              <button
                className={"topnav-link" + (navKey === "admin" ? " active" : "")}
                aria-current={navKey === "admin" ? "page" : undefined}
                onClick={() => navigate("admin")}
              >
                <ShieldCheck size={16} />
                หลังบ้าน
              </button>
            )}
          </nav>
          <div className="topnav-actions">
            <ThemeApplier />
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
            <span className="account-wrap" onKeyDown={(e) => e.key === "Escape" && setAccount(false)}>
              <button
                className={"user-profile" + (account ? " open" : "")}
                aria-haspopup="menu"
                aria-expanded={account}
                title={ctx.company.name + " · " + ctx.user.email}
                onClick={() => setAccount(!account)}
              >
                <OnlineDot on round>
                  {ctx.company.profile.logo ? (
                    <img className="avatar user-logo" src={String(ctx.company.profile.logo)} alt="" />
                  ) : (
                    <span className="avatar">{ctx.user.name[0]}</span>
                  )}
                </OnlineDot>
                <span>
                  <strong>{ctx.user.name}</strong>
                  <small className="user-email">{ctx.user.email}</small>
                  <PlanTag badge={myPlan} className="user-plan" />
                </span>
              </button>
              {account && (
                <>
                  <button className="account-scrim" aria-label="ปิดเมนู" onClick={() => setAccount(false)} />
                  <div className="account-menu" role="menu">
                    <button
                      role="menuitem"
                      className="account-head"
                      onClick={() => {
                        setAccount(false);
                        navigate("profile");
                      }}
                    >
                      {ctx.company.profile.logo ? (
                        <img src={String(ctx.company.profile.logo)} alt="" />
                      ) : (
                        <span className="avatar">{ctx.company.name.slice(0, 2)}</span>
                      )}
                      <span>
                        <strong>{ctx.company.name}</strong>
                        <small>ดูหน้าโปรไฟล์บริษัท</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setAccount(false);
                        navigate("profile");
                      }}
                    >
                      <UserCircle2 size={17} /> หน้าโปรไฟล์บริษัท
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setAccount(false);
                        navigate("company");
                      }}
                    >
                      <Settings2 size={17} /> แก้ไขข้อมูลบริษัท
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setAccount(false);
                        openCompanies();
                      }}
                    >
                      <ArrowLeftRight size={17} /> สลับบริษัท
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setAccount(false);
                        navigate("settings");
                      }}
                    >
                      <Settings size={17} /> ตั้งค่า
                      <em className="account-menu-hint">ภาษา</em>
                    </button>
                  </div>
                </>
              )}
            </span>
            <button
              className="icon-button topnav-logout"
              aria-label="ออกจากระบบ"
              onClick={async () => {
                requestEpoch.current++;
                setTabCompany(null);
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
              locked={locked}
              unlockAll={!!data.unlockAll}
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
        {data.support && <SupportViewBanner support={data.support} company={ctx.company.name} />}
        <div className={"dept-shell" + (sideDept ? " with-side" : "")}>
        {sideDept && <DepartmentSidebar dept={sideDept} view={fullView} navigate={navigate} locked={locked} />}
        {/* Every department's pages: a tint in the department's colour at the top (รายรับ / ค่าใช้จ่าย keep their own). */}
        <main className={"main" + ((sectionTone(sideDept, fullView) || sideDept?.tone) ? " top-" + (sectionTone(sideDept, fullView) || sideDept?.tone) : "")} key={ctx.company.id}>
          {!["feed", "jobs", "dashboard", "company", "expense-new", "income-new", "employees", "finance", "projects", "departments", "store", "integrations", "receipts", "profile", "pricing", "customers", "suppliers", "chat", "admin"].includes(view) && (
          // Department pages: a one-line heading keeps the work near the top (as on the accounting pages).
          <div className={"page-heading" + (sideDept ? " compact" : "")}>
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
          {locked(view) ? (
            <LockedSystem name={meta.label} department={systemDepartment(view)} />
          ) : view === "feed" ? (
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
          ) : view === "income-new" ? (
            <IncomeForm key={searchParams.get("n") || "new"} ctx={ctx} invoiceId={searchParams.get("invoice")} navigate={navigate} notify={notify} changed={load} />
          ) : view === "expense-new" ? (
            <ExpenseForm key={searchParams.get("id") || "new"} ctx={ctx} id={searchParams.get("id")} navigate={navigate} notify={notify} changed={load} />
          ) : view === "expenses" && catalog[view] && !searchParams.get("filter") ? (
            // รายการค่าใช้จ่าย: a summary only — totals with tax for a day / month / year and every row in detail.
            <div className="acc">
              <FinanceTabs current="expenses" navigate={navigate}>
                {canWrite(ctx, "Finance") && (
                  <button className="primary acc-new expense" onClick={() => navigate("expense-new")}>
                    <Plus size={16} /> บันทึกค่าใช้จ่าย
                  </button>
                )}
              </FinanceTabs>
              <FinanceLedger kind="expenses" navigate={navigate} />
            </div>
          ) : view === "expenses" && catalog[view] ? (
            // รออนุมัติ: drop receipts, AI reads them, a person checks each one.
            <>
              <Accounting key={"acc:" + fullView} ctx={ctx} notify={notify} changed={load} navigate={navigate} />
              <h2 className="acc-table-title">ตารางค่าใช้จ่ายทั้งหมด</h2>
              <Records key={view} kind={view} ctx={ctx} notify={notify} changed={load} refresh={lastSync.getTime()} />
            </>
          ) : view === "projects" ? (
            <>
              {!searchParams.get("id") && <LinePending key={"line:" + view} kind={view} ctx={ctx} notify={notify} changed={load} />}
              <ProjectsPage ctx={ctx} notify={notify} changed={load} navigate={navigate} />
            </>
          ) : view === "quotations" && !searchParams.get("manage") ? (
            <QuotesPage key={fullView} ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "sales_orders" && !searchParams.get("manage") ? (
            <OrdersPage key={fullView} ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "income" ? (
            <IncomePage key={fullView} ctx={ctx} navigate={navigate} />
          ) : view === "finance" ? (
            <FinanceCenter key={fullView} ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "employees" ? (
            <EmployeesPage
              key={view}
              ctx={ctx}
              notify={notify}
              changed={load}
              navigate={navigate}
              pending={<LinePending key="line:employees" kind="employees" ctx={ctx} notify={notify} changed={load} />}
            />
          ) : view === "customers" || view === "suppliers" ? (
            <>
              <LinePending key={"line:" + view} kind={view} ctx={ctx} notify={notify} changed={load} />
              <Directory key={view} kind={view} ctx={ctx} notify={notify} changed={load} navigate={navigate} />
            </>
          ) : (view === "products" || view === "sales_packages") && !listFilter ? (
            // One catalog (สินค้า · บริการ · แพ็กเกจ): คลังสินค้า manages it, ฝ่ายขาย sells from the same list.
            <>
              {view === "products" && <LinePending key="line:products" kind="products" ctx={ctx} notify={notify} changed={load} />}
              <ProductCatalog key={view} ctx={ctx} mode={view === "products" ? "warehouse" : "sales"} notify={notify} changed={load} />
            </>
          ) : catalog[view] ? (
            <>
              <LinePending key={"line:" + view} kind={view} ctx={ctx} notify={notify} changed={load} />
              <Records
                key={fullView}
                kind={view}
                ctx={ctx}
                notify={notify}
                changed={load}
                only={listFilter}
                preset={listFilter && "preset" in listFilter ? listFilter.preset : undefined}
                addLabel={view === "payments" && searchParams.get("direction") === "income" ? "บันทึกรับชำระ" : undefined}
                onAdd={view === "payments" && searchParams.get("direction") === "income" ? () => navigate("income-new") : undefined}
                newSignal={searchParams.get("new") && !(view === "payments" && searchParams.get("direction") === "income") ? 1 : 0}
              />
            </>
          ) : view === "ai-inbox" || view === "templates" ? (
            <AiWorkspace ctx={ctx} view={view} notify={notify} changed={load} />
          ) : view === "company" ? (
            <CompanyProfilePage
              key={fullView}
              home
              ctx={ctx}
              notify={notify}
              navigate={navigate}
              changed={load}
              aboutExtra={<SampleDataCard ctx={ctx} notify={notify} changed={load} />}
            />
          ) : view === "team" ? (
            <>
              <Team ctx={ctx} notify={notify} />
            </>
          ) : view === "integrations" ? (
            <LineIntegrationPage ctx={ctx} notify={notify} />
          ) : view === "chat" ? (
            <ChatHub ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "calendar" ? (
            <Calendar navigate={navigate} />
          ) : view === "reports" ? (
            <Reports notify={notify} />
          ) : view === "store" ? (
            <AppShop ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "ads" ? (
            <AdStudio ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "settings" ? (
            <AppSettings notify={notify} />
          ) : view === "profile" ? (
            <CompanyProfilePage key={fullView} ctx={ctx} notify={notify} navigate={navigate} changed={load} />
          ) : view === "receipts" ? (
            <ReceiptsPage ctx={ctx} notify={notify} navigate={navigate} />
          ) : view === "tax" ? (
            <TaxReport navigate={navigate} />
          ) : view === "expiries" ? (
            <Expiries navigate={navigate} />
          ) : view === "transfers" ? (
            <TransfersPage ctx={ctx} notify={notify} changed={load} />
          ) : view === "departments" ? (
            <DepartmentsPage ctx={ctx} notify={notify} navigate={navigate} unlockAll={!!data.unlockAll} />
          ) : view === "pricing" ? (
            <div className="elite-zone">
              <SubscriptionPanel ctx={ctx} notify={notify} />
            </div>
          ) : view === "slips" ? (
            <div className="elite-zone">
              <SlipChecker />
            </div>
          ) : view === "admin" && data.platformAdmin ? (
            <AdminApp notify={notify} />
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
                    // Only this tab moves to the chosen company; other open tabs keep theirs.
                    setTabCompany(c.id);
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
                  setTabCompany(null); // follow the new company (now the account default)
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
      {/* The owner fills in the required company details before using the workspace. */}
      {companyNeedsSetup(ctx) && <CompanySetupGate key={ctx.company.id} ctx={ctx} changed={load} />}
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
      <UpgradeDialog />
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
                <button key={key} className={locked(key) ? "is-locked" : undefined} onClick={() => navigate(key)}>
                  <Icon name={details(key).icon} />
                  <span>
                    {details(key).label}
                    {locked(key) && <LockMark />}
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
