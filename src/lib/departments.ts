// แผนก mega menu: 15 colour-coded departments, 6 shortcuts each. Every `view` is a real workspace page
// (catalog kind or extra view); `?kind=` opens the report page on that department's data.
import { catalog } from "./catalog";
export type MenuItem = { label: string; view: string; icon: string };
/** A left-sidebar entry; a group shows its children indented under it. */
/** step: numbered stage of a flow (ใบเสนอราคา ① → ใบแจ้งหนี้ ③ …), drawn as a numbered dot on a line. */
export type SideChild = MenuItem & { step?: number };
export type SideItem = MenuItem & {
  children?: SideChild[];
  /** Small second line under the label. */
  sub?: string;
  /** A big heading (รายรับ / ค่าใช้จ่าย) with its pages always listed under it, coloured by tone. */
  section?: { tone: "green" | "pink" | "violet"; caption: string };
};
export type DepartmentMenu = {
  id: string;
  title: string;
  en: string;
  subtitle: string;
  icon: string;
  tone: string;
  overview: string;
  items: MenuItem[];
  /** Left sidebar on this department's pages; defaults to `items`. */
  sidebar?: SideItem[];
  /** Two-line message on the sidebar's illustration card. */
  tagline?: [string, string];
};

export const departmentMenu: DepartmentMenu[] = [
  {
    id: "sales", title: "ฝ่ายขาย", en: "SALE", subtitle: "บริหารลูกค้าและโอกาสทางธุรกิจ", icon: "ChartNoAxesCombined", tone: "violet", overview: "sales",
    items: [
      { label: "CRM & ลูกค้า", view: "customers", icon: "Users" },
      { label: "โอกาสทางการขาย", view: "leads", icon: "FileText" },
      { label: "ใบเสนอราคา", view: "quotations", icon: "FileText" },
      { label: "คำสั่งซื้อ (SO)", view: "sales_orders", icon: "ShoppingCart" },
      { label: "งานขาย & เป้าหมาย", view: "sales_targets", icon: "Target" },
      { label: "รายงานยอดขาย", view: "reports?kind=sales", icon: "ChartNoAxesCombined" },
    ],
    // The menu above, plus what is sold and where (set once, picked on orders and quotations).
    sidebar: [
      { label: "CRM & ลูกค้า", view: "customers", icon: "Users" },
      { label: "โอกาสทางการขาย", view: "leads", icon: "FileText" },
      { label: "ใบเสนอราคา", view: "quotations", icon: "FileText" },
      { label: "คำสั่งซื้อ (SO)", view: "sales_orders", icon: "ShoppingCart" },
      { label: "สินค้า & แพ็กเกจ", view: "sales_packages", icon: "Package" },
      { label: "แพลตฟอร์มการขาย", view: "sales_platforms", icon: "Store" },
      { label: "งานขาย & เป้าหมาย", view: "sales_targets", icon: "Target" },
      { label: "รายงานยอดขาย", view: "reports?kind=sales", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    id: "marketing", title: "การตลาด", en: "Marketing", subtitle: "สร้างแบรนด์และเพิ่มยอดขาย", icon: "Megaphone", tone: "pink", overview: "campaigns",
    items: [
      { label: "แผนแคมเปญการตลาด", view: "campaigns", icon: "Megaphone" },
      { label: "สื่อโฆษณา & คอนเทนต์", view: "content", icon: "Files" },
      { label: "Social Media", view: "content?channel=social", icon: "MessageCircle" },
      { label: "งบการตลาด", view: "marketing_budget", icon: "Wallet" },
      { label: "กิจกรรมส่งเสริมการขาย", view: "promotions", icon: "BadgePercent" },
      { label: "วิเคราะห์ผลการตลาด", view: "reports?kind=content", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    id: "warehouse", title: "คลังสินค้า", en: "Warehouse", subtitle: "จัดการสินค้าและสต็อก", icon: "Package", tone: "blue", overview: "products",
    items: [
      { label: "สินค้า & สต็อก", view: "products", icon: "Package" },
      { label: "รับสินค้าเข้า", view: "purchases", icon: "PackagePlus" },
      { label: "เบิกสินค้าออก", view: "stock_issues", icon: "PackageMinus" },
      { label: "โอนย้ายสินค้า", view: "transfers", icon: "ArrowLeftRight" },
      { label: "ตรวจนับสต็อก", view: "stock_counts", icon: "ClipboardCheck" },
      { label: "รายงานคลังสินค้า", view: "reports?kind=products", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    id: "accounting", title: "บัญชีและการเงิน", en: "Accounting", subtitle: "ดูแลการเงินครบวงจร", icon: "Calculator", tone: "green", overview: "expenses",
    items: [
      { label: "Financial Center", view: "finance", icon: "ChartNoAxesCombined" },
      { label: "รายรับ", view: "income", icon: "TrendingUp" },
      { label: "ใบแจ้งหนี้ (AR)", view: "invoices", icon: "FileText" },
      { label: "ใบเสร็จรับเงิน", view: "receipts", icon: "ScrollText" },
      { label: "ค่าใช้จ่าย", view: "expenses", icon: "Receipt" },
      { label: "ใบรับวางบิล (AP)", view: "bills", icon: "ReceiptText" },
    ],
    sidebar: [
      // Three places only: the summary dashboard, money in, money out. Tax sits on each page (ภาษีขาย on รายรับ,
      // ภาษีซื้อ / หัก ณ ที่จ่าย on ค่าใช้จ่าย, the full picture on Financial Center), not in a menu of its own.
      { label: "Financial Center", sub: "ภาพรวม · กำไรขาดทุน · ภาษี", view: "finance", icon: "Landmark" },
      {
        label: "รายรับ", view: "income", icon: "TrendingUp", section: { tone: "green", caption: "ขาย · ออกเอกสาร · รับเงิน" },
        children: [
          { label: "ภาพรวมรายรับ", view: "income", icon: "ChartColumn" },
          // The sales flow, in order: quote → order (which package, which platform, paid?) → invoice → money in → receipt.
          { label: "ใบเสนอราคา", view: "quotations", icon: "FileText", step: 1 },
          { label: "คำสั่งซื้อ", view: "sales_orders", icon: "ShoppingCart", step: 2 },
          { label: "ใบแจ้งหนี้", view: "invoices", icon: "FileDigit", step: 3 },
          { label: "รับชำระเงิน", view: "payments?direction=income", icon: "Wallet", step: 4 },
          { label: "ใบเสร็จรับเงิน", view: "receipts", icon: "ScrollText", step: 5 },
        ],
      },
      {
        label: "ค่าใช้จ่าย", view: "expenses", icon: "Receipt", section: { tone: "pink", caption: "บันทึก · อนุมัติ · จ่ายเงิน" },
        children: [
          { label: "รายการค่าใช้จ่าย", view: "expenses", icon: "ChartColumn" },
          { label: "บันทึกค่าใช้จ่าย", view: "expense-new", icon: "FilePen", step: 1 },
          { label: "รออนุมัติ", view: "expenses?filter=pending", icon: "FileClock", step: 2 },
          { label: "ใบรับวางบิล", view: "bills", icon: "ReceiptText", step: 3 },
        ],
      },
      { label: "ตั้งค่า", view: "company", icon: "Settings" },
    ],
    tagline: ["จัดการการเงิน", "ได้อย่างเป็นระบบ โปร่งใส ตรวจสอบได้"],
  },
  {
    id: "hr", title: "บุคคล", en: "HR", subtitle: "บริหารบุคลากรและองค์กร", icon: "Users", tone: "amber", overview: "employees?dept=hr",
    items: [
      { label: "ข้อมูลพนักงาน", view: "employees?dept=hr", icon: "UserRound" },
      { label: "สรรหา & รับพนักงาน", view: "recruitment", icon: "UserPlus" },
      { label: "เงินเดือน & สวัสดิการ", view: "payroll", icon: "Wallet" },
      { label: "เวลาเข้า-ออกงาน", view: "attendance", icon: "Clock" },
      { label: "การลา & อนุมัติ", view: "leaves", icon: "CalendarOff" },
      { label: "ประเมินผลงาน (KPI/OKR)", view: "kpi", icon: "Gauge" },
    ],
    sidebar: [
      { label: "ข้อมูลพนักงาน", view: "employees?dept=hr", icon: "UserRound" },
      { label: "สรรหา & รับพนักงาน", view: "recruitment", icon: "UserPlus" },
      { label: "เติบโต & สวัสดิการ", view: "payroll", icon: "Wallet" },
      { label: "เวลาเข้า-ออกงาน", view: "attendance", icon: "Clock" },
      { label: "การลา & อนุมัติ", view: "leaves", icon: "CalendarOff" },
      { label: "ประเมินผลงาน (KPI/OKR)", view: "kpi", icon: "Gauge" },
    ],
    tagline: ["บุคคล", "บริหารบุคลากรและองค์กร"],
  },
  {
    id: "event", title: "Event", en: "อีเวนต์", subtitle: "วางแผนและจัดการงานอีเวนต์", icon: "CalendarDays", tone: "purple", overview: "events",
    items: [
      { label: "งานอีเวนต์", view: "events", icon: "CalendarDays" },
      { label: "ผู้เข้าร่วมงาน", view: "event_guests", icon: "Users" },
      { label: "งบประมาณ", view: "event_budget", icon: "Wallet" },
      { label: "สถานที่ & อุปกรณ์", view: "venues", icon: "MapPin" },
      { label: "ทีมงาน & งานย่อย", view: "tasks", icon: "ListTodo" },
      { label: "รายงานผลอีเวนต์", view: "reports?kind=events", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    id: "it", title: "IT", en: "เทคโนโลยีสารสนเทศ", subtitle: "ดูแลระบบและอุปกรณ์", icon: "Monitor", tone: "orange", overview: "assets",
    items: [
      { label: "จัดการอุปกรณ์ (Asset)", view: "assets", icon: "Monitor" },
      { label: "ซ่อมบำรุง & แจ้งปัญหา", view: "tickets", icon: "Wrench" },
      { label: "ระบบและซอฟต์แวร์", view: "software", icon: "AppWindow" },
      { label: "บัญชีผู้ใช้ & สิทธิ์การใช้งาน", view: "team", icon: "ShieldCheck" },
      { label: "ความปลอดภัย (Security)", view: "security", icon: "ShieldAlert" },
      { label: "รายงาน IT", view: "reports?kind=tickets", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    id: "legal", title: "กฎหมาย", en: "Legal", subtitle: "ดูแลสัญญาและข้อกฎหมาย", icon: "Scale", tone: "indigo", overview: "contracts",
    items: [
      { label: "สัญญา & เอกสารกฎหมาย", view: "contracts", icon: "FileText" },
      { label: "ตรวจสอบเอกสาร", view: "documents", icon: "Files" },
      { label: "สิทธิบัตร & ทรัพย์สินทางปัญญา", view: "ip_assets", icon: "Award" },
      { label: "ข้อกำหนดและนโยบาย", view: "policies", icon: "BookOpen" },
      { label: "คดีความ & ข้อพิพาท", view: "cases", icon: "Gavel" },
      { label: "ติดตามวันหมดอายุ", view: "expiries", icon: "CalendarClock" },
    ],
  },
  {
    id: "admin", title: "งานทั่วไป / บริหารองค์กร", en: "Admin", subtitle: "สนับสนุนการดำเนินงาน", icon: "Building2", tone: "slate", overview: "services",
    items: [
      { label: "งานสารบรรณ", view: "documents", icon: "Files" },
      { label: "จัดซื้อ (Procurement)", view: "purchases", icon: "ShoppingCart" },
      { label: "ผู้จำหน่าย (Supplier)", view: "suppliers", icon: "Truck" },
      { label: "ทรัพย์สิน (Asset)", view: "assets", icon: "Monitor" },
      { label: "ยานพาหนะ", view: "vehicles", icon: "Car" },
      { label: "งานบริการทั่วไป", view: "services", icon: "Wrench" },
    ],
  },
  // Sold one by one in App Shop (SHOP_DEPARTMENTS): locked until the company buys the department's system.
  {
    id: "operations", title: "ปฏิบัติการ", en: "Operations", subtitle: "สั่งงาน ติดตาม และตรวจคุณภาพ", icon: "Wrench", tone: "teal", overview: "work_orders",
    items: [
      { label: "ใบสั่งงาน", view: "work_orders", icon: "ClipboardList" },
      { label: "โครงการ", view: "projects", icon: "FolderKanban" },
      { label: "งาน & Workflow", view: "tasks", icon: "ListTodo" },
      { label: "ตรวจคุณภาพ (QC)", view: "quality_checks", icon: "ClipboardCheck" },
      { label: "ทรัพย์สิน & เครื่องมือ", view: "assets", icon: "Monitor" },
      { label: "รายงานปฏิบัติการ", view: "reports?kind=work_orders", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    id: "purchasing", title: "จัดซื้อ", en: "Purchasing", subtitle: "ขอซื้อ เทียบราคา และสั่งซื้อ", icon: "ShoppingCart", tone: "cyan", overview: "purchase_requests",
    items: [
      { label: "ใบขอซื้อ (PR)", view: "purchase_requests", icon: "FilePen" },
      { label: "เปรียบเทียบราคา", view: "supplier_quotes", icon: "Scale" },
      { label: "ใบสั่งซื้อ & รับของ", view: "purchases", icon: "ShoppingCart" },
      { label: "ผู้จำหน่าย (Supplier)", view: "suppliers", icon: "Truck" },
      { label: "ใบรับวางบิล", view: "bills", icon: "ReceiptText" },
      { label: "รายงานจัดซื้อ", view: "reports?kind=purchases", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    id: "design", title: "ออกแบบ", en: "Design", subtitle: "รับบรีฟ ออกแบบ และเก็บไฟล์งาน", icon: "Palette", tone: "rose", overview: "design_requests",
    items: [
      { label: "บรีฟงานออกแบบ", view: "design_requests", icon: "Palette" },
      { label: "คลังงานออกแบบ", view: "design_assets", icon: "Images" },
      { label: "งานในทีม", view: "tasks", icon: "ListTodo" },
      { label: "โครงการลูกค้า", view: "projects", icon: "FolderKanban" },
      { label: "คอนเทนต์ & สื่อ", view: "content", icon: "Files" },
      { label: "รายงานงานออกแบบ", view: "reports?kind=design_requests", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    id: "customer_service", title: "บริการลูกค้า", en: "Customer Service", subtitle: "รับเรื่อง เคลม และดูแลความพึงพอใจ", icon: "Headset", tone: "sky", overview: "tickets",
    items: [
      { label: "เรื่องแจ้ง & ร้องเรียน", view: "tickets", icon: "MessageCircle" },
      { label: "เคลม & คืนสินค้า", view: "claims", icon: "PackageX" },
      { label: "ความพึงพอใจลูกค้า", view: "cs_feedback", icon: "Smile" },
      { label: "คลังคำตอบ", view: "knowledge_base", icon: "BookOpen" },
      { label: "ข้อมูลลูกค้า", view: "customers", icon: "Users" },
      { label: "รายงานบริการลูกค้า", view: "reports?kind=tickets", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    id: "data", title: "ข้อมูล", en: "Data", subtitle: "ตัวชี้วัด รายงาน และแหล่งข้อมูล", icon: "Database", tone: "emerald", overview: "metrics",
    items: [
      { label: "ตัวชี้วัดองค์กร", view: "metrics", icon: "Gauge" },
      { label: "คำขอข้อมูล & รายงาน", view: "data_requests", icon: "FileChartColumn" },
      { label: "แหล่งข้อมูล", view: "data_sources", icon: "Database" },
      { label: "รายงานข้ามแผนก", view: "reports", icon: "ChartNoAxesCombined" },
      { label: "Dashboard ผู้บริหาร", view: "dashboard", icon: "Landmark" },
      { label: "เป้าหมาย KPI", view: "kpi", icon: "Target" },
    ],
  },
  {
    id: "business_development", title: "พัฒนาธุรกิจ", en: "Business Development", subtitle: "พันธมิตร ดีล และโอกาสใหม่", icon: "Briefcase", tone: "lime", overview: "partnerships",
    items: [
      { label: "พันธมิตรธุรกิจ", view: "partnerships", icon: "Handshake" },
      { label: "โอกาส & วิจัยตลาด", view: "market_research", icon: "Telescope" },
      { label: "พื้นที่ขาย & ดีล", view: "deals", icon: "Store" },
      { label: "Dealer & สาขา", view: "dealers", icon: "Building2" },
      { label: "โอกาสทางการขาย", view: "leads", icon: "Target" },
      { label: "รายงานพัฒนาธุรกิจ", view: "reports?kind=partnerships", icon: "ChartNoAxesCombined" },
    ],
  },
];
/** Departments bought one by one in App Shop (the module with the same id); locked until the company owns it. */
export const SHOP_DEPARTMENTS = ["operations", "purchasing", "design", "customer_service", "data", "business_development"];
/**
 * Record types that belong to one of those departments alone: saved only once the company owns its system, whatever
 * the package (pages they share with other departments, like โครงการ or Ticket, keep the package rule).
 */
export const SHOP_KINDS: Record<string, string> = {
  work_orders: "operations", quality_checks: "operations",
  purchase_requests: "purchasing", supplier_quotes: "purchasing",
  design_requests: "design", design_assets: "design",
  cs_feedback: "customer_service", claims: "customer_service", knowledge_base: "customer_service",
  metrics: "data", data_requests: "data", data_sources: "data",
  partnerships: "business_development", market_research: "business_development",
};
/** "ซื้อระบบออกแบบในหน้าแผนก …": what a shop department's record needs before it can be saved. */
export const shopLockText = (kind: string, label: string) => {
  const d = departmentMenu.find((x) => x.id === SHOP_KINDS[kind]);
  return `“${label}” อยู่ในแผนก${d?.title || ""} ซึ่งต้องซื้อระบบก่อนใช้งาน · ซื้อได้ที่หน้าแผนก (App Shop) แล้วใช้ได้ทันที`;
};

/** Workspace views that are not catalog kinds but are opened from this menu. */
export const menuViews = ["tax", "transfers", "expiries"];
export const baseView = (view: string) => view.split("?")[0];
export const sidebarOf = (d: DepartmentMenu): SideItem[] => d.sidebar || d.items;
const entries = (d: DepartmentMenu) => sidebarOf(d).flatMap((i) => [i, ...(i.children || [])]);
/**
 * แผนกของฉัน: บัญชีและการเงิน is free for every company. A paid package (Starter and up, active — not a trial) unlocks
 * การตลาด, เซลล์, จัดซื้อ (under งานทั่วไป / บริหารองค์กร), คลัง and HR. Event, IT and กฎหมาย stay locked.
 */
export const FREE_DEPARTMENT = "accounting";
export const PACKAGE_DEPARTMENTS = ["sales", "marketing", "warehouse", "hr", "admin"];
export const departmentLocked = (id: string, paid: boolean, owned: string[] = []) =>
  id === FREE_DEPARTMENT ? false : PACKAGE_DEPARTMENTS.includes(id) ? !paid : SHOP_DEPARTMENTS.includes(id) ? !owned.includes(id) : true;
/** Without a paid package only บัญชีและการเงิน's pages may be recorded (ค่าใช้จ่าย, รับชำระ …), from the web or LINE. */
export function freeKind(kind: string) {
  const free = departmentMenu.find((d) => d.id === FREE_DEPARTMENT);
  return !!free && entries(free).some((i) => baseView(i.view) === kind);
}
// App-wide pages: they only show a department sidebar when the user came from that department.
const shared = new Set(["feed", "jobs", "dashboard", "calendar", "chat", "company", "team", "store", "ads", "departments", "pricing", "assistant", "admin", "integrations", "templates", "ai-inbox", "tasks", "documents", "reports", "profile"]);
/** Full pages opened from a list sit under that list's menu entry (บันทึกรายรับ → รับชำระเงิน). */
const menuAlias: Record<string, string> = { "income-new": "payments?direction=income" };
const alias = (view: string) => menuAlias[baseView(view)] || view;
/** The department whose sidebar a page shows: an exact match (with ?query) wins, the last-used department is preferred. */
export function departmentOf(view: string, preferred?: string | null) {
  view = alias(view);
  const ordered = [...departmentMenu].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  const exact = ordered.find((d) => entries(d).some((i) => i.view === view));
  if (exact && (!shared.has(baseView(view)) || exact.id === preferred || view.includes("?"))) return exact;
  const base = baseView(view);
  const loose = ordered.find((d) => d.overview === base || entries(d).some((i) => baseView(i.view) === base));
  return loose && (!shared.has(base) || loose.id === preferred) ? loose : undefined;
}
/** The sidebar entry for this page: the exact view (with ?query) if listed, else the first entry with the same base view. */
export function activeEntry(d: DepartmentMenu, view: string) {
  view = alias(view);
  // Sub-pages first, so a group and its child with the same view highlight the child.
  const all = sidebarOf(d).flatMap((i) => [...(i.children || []), i]);
  return all.find((i) => i.view === view) || all.find((i) => baseView(i.view) === baseView(view));
}
/** The coloured section (รายรับ green, ค่าใช้จ่าย pink) a page belongs to, for the tint at the top of the page. */
export function sectionTone(d: DepartmentMenu | undefined, view: string) {
  if (!d) return undefined;
  const entry = activeEntry(d, view);
  if (!entry) return undefined;
  return sidebarOf(d).find((i) => i.section && (i === entry || i.children?.includes(entry)))?.section?.tone;
}
/** แผนกของฉัน card for each department name (catalog), where one exists. */
const menuOfDepartment: Record<string, string> = {
  Finance: "accounting", Sales: "sales", Marketing: "marketing", Warehouse: "warehouse", HR: "hr",
  Purchasing: "admin", Admin: "admin", Event: "event", IT: "it", Legal: "legal",
};
/** The company's package doesn't open this department (departments without a menu card are never package-locked). */
export const departmentPlanLocked = (department: string, paid: boolean) =>
  !!menuOfDepartment[department] && departmentLocked(menuOfDepartment[department], paid);

/**
 * The department a page belongs to for สิทธิ์การใช้งาน: a member without ดู / ใช้งาน on it sees a lock screen.
 * งาน, เอกสาร and Ticket are shared by every department; pages outside a department return null.
 */
export function systemDepartment(key: string): string | null {
  if (["tax", "receipts", "income", "finance", "income-new", "expense-new"].includes(key)) return "Finance";
  if (key === "transfers") return "Warehouse";
  if (catalog[key] && !["tasks", "documents", "tickets"].includes(key)) return catalog[key].department;
  return null;
}
