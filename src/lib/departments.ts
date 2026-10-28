// แผนก mega menu: 9 colour-coded departments, 6 shortcuts each. Every `view` is a real workspace page
// (catalog kind or extra view); `?kind=` opens the report page on that department's data.
export type MenuItem = { label: string; view: string; icon: string };
/** A left-sidebar entry; a group shows its children indented under it. */
export type SideItem = MenuItem & { children?: MenuItem[] };
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
      { label: "ใบแจ้งหนี้ (AR)", view: "invoices", icon: "FileText" },
      { label: "ใบรับวางบิล (AP)", view: "bills", icon: "ReceiptText" },
      { label: "ค่าใช้จ่าย", view: "expenses", icon: "Receipt" },
      { label: "การชำระเงิน", view: "payments", icon: "CreditCard" },
      { label: "ภาษี & ภ.ง.ด.", view: "tax", icon: "Landmark" },
      { label: "งบการเงิน & รายงาน", view: "reports?kind=expenses", icon: "ChartNoAxesCombined" },
    ],
    sidebar: [
      {
        label: "ค่าใช้จ่าย", view: "expenses", icon: "FileSpreadsheet",
        children: [
          { label: "บันทึกค่าใช้จ่าย", view: "expense-new", icon: "FilePen" },
          { label: "รายการค่าใช้จ่าย", view: "expenses", icon: "FileText" },
          { label: "รออนุมัติ", view: "expenses?filter=pending", icon: "FileClock" },
          { label: "รายงาน", view: "reports?kind=expenses", icon: "FileChartColumn" },
        ],
      },
      { label: "ใบแจ้งหนี้", view: "invoices", icon: "FileDigit" },
      { label: "การชำระเงิน", view: "payments", icon: "CalendarDays" },
      { label: "ใบเสร็จรับเงิน", view: "bills", icon: "ScrollText" },
      { label: "ภาษี & ภ.ง.ด.", view: "tax", icon: "BadgeDollarSign" },
      { label: "งบการเงิน", view: "reports?kind=payments", icon: "ChartColumn" },
      { label: "ตั้งค่า", view: "company", icon: "Settings" },
    ],
    tagline: ["จัดการการเงิน", "ได้อย่างเป็นระบบ โปร่งใส ตรวจสอบได้"],
  },
  {
    id: "hr", title: "บุคคล", en: "HR", subtitle: "บริหารบุคลากรและองค์กร", icon: "Users", tone: "amber", overview: "employees",
    items: [
      { label: "ข้อมูลพนักงาน", view: "employees", icon: "UserRound" },
      { label: "สรรหา & รับพนักงาน", view: "recruitment", icon: "UserPlus" },
      { label: "เงินเดือน & สวัสดิการ", view: "payroll", icon: "Wallet" },
      { label: "เวลาเข้า-ออกงาน", view: "attendance", icon: "Clock" },
      { label: "การลา & อนุมัติ", view: "leaves", icon: "CalendarOff" },
      { label: "ประเมินผลงาน (KPI/OKR)", view: "kpi", icon: "Gauge" },
    ],
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
];

/** Workspace views that are not catalog kinds but are opened from this menu. */
export const menuViews = ["tax", "transfers", "expiries"];
export const baseView = (view: string) => view.split("?")[0];
export const sidebarOf = (d: DepartmentMenu): SideItem[] => d.sidebar || d.items;
const entries = (d: DepartmentMenu) => sidebarOf(d).flatMap((i) => [i, ...(i.children || [])]);
// App-wide pages: they only show a department sidebar when the user came from that department.
const shared = new Set(["feed", "jobs", "dashboard", "calendar", "chat", "company", "team", "store", "departments", "pricing", "assistant", "admin", "integrations", "templates", "ai-inbox", "tasks", "documents", "reports"]);
/** The department whose sidebar a page shows: an exact match (with ?query) wins, the last-used department is preferred. */
export function departmentOf(view: string, preferred?: string | null) {
  const ordered = [...departmentMenu].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  const exact = ordered.find((d) => entries(d).some((i) => i.view === view));
  if (exact && (!shared.has(baseView(view)) || exact.id === preferred || view.includes("?"))) return exact;
  const base = baseView(view);
  const loose = ordered.find((d) => d.overview === base || entries(d).some((i) => baseView(i.view) === base));
  return loose && (!shared.has(base) || loose.id === preferred) ? loose : undefined;
}
/** The sidebar entry for this page: the exact view (with ?query) if listed, else the first entry with the same base view. */
export function activeEntry(d: DepartmentMenu, view: string) {
  // Sub-pages first, so a group and its child with the same view highlight the child.
  const all = sidebarOf(d).flatMap((i) => [...(i.children || []), i]);
  return all.find((i) => i.view === view) || all.find((i) => baseView(i.view) === baseView(view));
}
