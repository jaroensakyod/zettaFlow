import { currentExpenseCategories, legacyExpenseCategories } from "./expense-categories";
export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "tel"
    | "number"
    | "date"
    | "textarea"
    | "select"
    | "url"
    | "relation"
    | "image"
    | "lines";
  required?: boolean;
  options?: string[];
  resource?: string;
  min?: number;
  group?: string;
  /** Kept in the record but edited on a dedicated page, not in the generic form. */
  hidden?: boolean;
  /** Shown with a dedicated picker instead of a flat list (grouped expense categories with emoji). */
  picker?: "expenseCategory";
};
/** One row of a document's item list (`lines` field). Expense rows may also carry a category, unit, currency and discount. */
export type Line = {
  name: string;
  qty: number;
  price: number;
  category?: string;
  unit?: string;
  currency?: string;
  discount?: number;
  discountType?: "percent" | "amount";
};
/** qty × price less the row's discount (a percentage or a baht amount), never below zero. */
export const lineAmount = (l: Line) => {
  const gross = (Number(l.qty) || 0) * (Number(l.price) || 0),
    off = l.discountType === "percent" ? (gross * (Number(l.discount) || 0)) / 100 : Number(l.discount) || 0;
  return Math.max(0, Math.round((gross - off) * 100) / 100);
};
export const lineCategories = ["ค่าเดินทาง", "ค่าเลี้ยงรับรอง", "ค่าที่พัก", "ค่าน้ำมัน", "ค่าขนส่ง", "วัสดุสิ้นเปลือง", "อุปกรณ์", "ค่าบริการ", "ค่าโฆษณา", "อื่นๆ"] as const;
export const payeeTypes = ["บริษัท / Supplier", "บุคคลธรรมดา", "พนักงานในบริษัท"] as const;
// หมวดหมู่หลัก: the grouped list (expense-categories.ts) plus the older names that existing records still use.
export const expenseCategories = [...currentExpenseCategories, ...legacyExpenseCategories.filter((x) => !currentExpenseCategories.includes(x))];
export const docTypes = ["ใบกำกับภาษีเต็มรูป", "ใบกำกับภาษีอย่างย่อ", "ใบเสร็จ", "ใบแจ้งหนี้"] as const;
export const payStatuses = ["โอนแล้ว", "เงินสดย่อย", "ยังไม่จ่าย"] as const;
export const partyTypes = ["นิติบุคคล", "บุคคลธรรมดา"] as const;
export const supplierCategories = ["สินค้า / วัตถุดิบ", "บริการ"] as const;
/** Documents HR keeps for each employee (ticked off in `checklist`, comma separated). */
export const employeeDocuments = ["สัญญาจ้างงาน", "สำเนาบัตรประชาชน", "สำเนาทะเบียนบ้าน", "วุฒิการศึกษา", "หน้าสมุดบัญชีธนาคาร", "ใบรับรองแพทย์"] as const;
/** Approval rights HR records per employee (shown as switches; the role on the team page is what the system enforces). */
export const approvalRights = [
  ["leave", "อนุมัติใบลา", "ลาป่วย ลากิจ ลาพักร้อนของทีม"],
  ["expense", "อนุมัติเบิกค่าใช้จ่าย", "วงเงินตามที่บริษัทกำหนดต่อครั้ง"],
  ["purchase", "อนุมัติใบสั่งซื้อ", "สั่งซื้อสินค้าและบริการจาก Supplier"],
  ["project", "อนุมัติงานโปรเจกต์", "ปิดงาน และส่งงานต่อให้แผนกอื่น"],
  ["contract", "อนุมัติสัญญา", "สัญญาลูกค้าและสัญญา Supplier"],
  ["staff", "จัดการข้อมูลพนักงาน", "เพิ่ม แก้ไข และกำหนดสิทธิ์ให้คนอื่น"],
] as const;
export type Module = {
  key: string;
  label: string;
  description: string;
  department: string;
  icon: string;
  fields: Field[];
  columns: string[];
  statusOptions?: string[];
  /** Read-only columns worked out from the saved fields (shown in the table, never stored). */
  computed?: Record<string, { label: string; calc: (d: Record<string, unknown>) => number }>;
};
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  required = false,
  extra: Partial<Field> = {},
): Field => ({ key, label, type, required, ...extra });
const status = (options: string[]) =>
  f("status", "สถานะ", "select", true, { options });
const contact = [
  f("contact", "ผู้ติดต่อ"),
  f("phone", "โทรศัพท์", "tel"),
  f("email", "อีเมล", "email"),
  f("line", "LINE ID"),
  f("address", "ที่อยู่", "textarea"),
  f("notes", "หมายเหตุ", "textarea"),
];
// Second address and contact person (directory tabs ที่อยู่ / ผู้ติดต่อ).
const secondary = [
  f("shippingAddress", "ที่อยู่จัดส่ง", "textarea"),
  f("contact2", "ผู้ติดต่อคนที่ 2"),
  f("contact2Phone", "โทรศัพท์ผู้ติดต่อคนที่ 2", "tel"),
];
const project = f("projectId", "โครงการ", "relation", false, {
  resource: "projects",
});
const dates = [
  f("startDate", "วันเริ่ม", "date"),
  f("endDate", "วันสิ้นสุด", "date"),
];
export const modules: Module[] = [
  {
    key: "customers",
    label: "ลูกค้า",
    description: "รายชื่อลูกค้า ผู้ติดต่อ และประวัติที่ทีมใช้ร่วมกัน",
    department: "Sales",
    icon: "Users",
    columns: ["name", "phone", "email", "status"],
    fields: [
      f("name", "ชื่อลูกค้า", "text", true),
      f("code", "รหัสลูกค้า (เว้นว่างเพื่อออกรหัสอัตโนมัติ)"),
      f("type", "ประเภท", "select", false, { options: [...partyTypes] }),
      f("company", "บริษัท"),
      f("taxId", "เลขประจำตัวผู้เสียภาษี"),
      f("branch", "สำนักงาน / สาขา"),
      f("businessType", "ประเภทธุรกิจ"),
      f("segment", "กลุ่มลูกค้า", "select", false, {
        options: ["standard", "regular", "vip"],
      }),
      f("creditDays", "เครดิต (วัน)", "number", false, { min: 0 }),
      f("creditLimit", "วงเงินเครดิต", "number", false, { min: 0 }),
      f("ownerId", "ผู้ดูแล", "relation", false, { resource: "employees" }),
      ...secondary,
      status(["active", "inactive"]),
      ...contact,
    ],
  },
  {
    key: "dealers",
    label: "Dealer & สาขา",
    description: "ข้อมูลห้าง พื้นที่ขาย และผู้ติดต่อของแต่ละสาขา",
    department: "Business Development",
    icon: "Store",
    columns: ["name", "branch", "province", "status"],
    fields: [
      f("name", "ชื่อ Dealer / ห้าง", "text", true),
      f("code", "รหัส Dealer"),
      f("branch", "สาขา"),
      f("group", "กลุ่ม"),
      f("region", "ภูมิภาค", "select", false, {
        options: [
          "กรุงเทพฯ",
          "ภาคกลาง",
          "ภาคเหนือ",
          "ภาคอีสาน",
          "ภาคใต้",
          "ภาคตะวันออก",
          "ภาคตะวันตก",
        ],
      }),
      f("province", "จังหวัด"),
      f("maps", "ลิงก์แผนที่", "url"),
      status(["active", "inactive"]),
      ...contact,
    ],
  },
  {
    key: "suppliers",
    label: "ซัพพลายเออร์",
    description: "ผู้ขายสินค้าและบริการ พร้อมข้อมูลสำหรับการจัดซื้อ",
    department: "Purchasing",
    icon: "Truck",
    columns: ["name", "contact", "phone", "status"],
    fields: [
      f("name", "ชื่อซัพพลายเออร์", "text", true),
      f("code", "รหัส (เว้นว่างเพื่อออกรหัสอัตโนมัติ)"),
      f("type", "ประเภท", "select", false, { options: [...partyTypes] }),
      f("category", "สินค้า / บริการ", "select", false, { options: [...supplierCategories] }),
      f("tier", "ระดับ Supplier", "select", false, { options: ["หลัก", "สำรอง"] }),
      f("taxId", "เลขประจำตัวผู้เสียภาษี"),
      f("branch", "สำนักงาน / สาขา"),
      f("businessType", "ประเภทธุรกิจ"),
      f("rating", "คะแนน (0–5)", "number", false, { min: 0 }),
      f("leadTime", "ระยะเวลาส่งของ"),
      f("creditDays", "เครดิต (วัน)", "number", false, { min: 0 }),
      f("paymentTerms", "เงื่อนไขชำระเงิน"),
      f("bankName", "ธนาคาร"),
      f("bankAccount", "เลขบัญชี"),
      f("bankAccountName", "ชื่อบัญชี"),
      f("products", "สินค้า / บริการที่ซื้อ", "textarea"),
      f("docExpiry", "เอกสารหมดอายุ", "date"),
      ...secondary,
      status(["active", "inactive"]),
      ...contact,
    ],
  },
  {
    key: "employees",
    label: "พนักงาน",
    description: "ทะเบียนพนักงาน ตำแหน่ง แผนก และข้อมูลการจ้างงาน",
    department: "HR",
    icon: "UserRound",
    columns: ["name", "code", "department", "status"],
    fields: [
      f("photo", "รูปพนักงาน", "image"),
      f("name", "ชื่อ-นามสกุล", "text", true),
      f("code", "รหัสพนักงาน"),
      f("nickname", "ชื่อเล่น"),
      f("department", "แผนก", "text", true),
      f("position", "ตำแหน่ง"),
      f("employmentType", "ประเภทการจ้าง", "select", true, {
        options: ["ประจำ", "สัญญาจ้าง", "พาร์ตไทม์"],
      }),
      f("startDate", "วันเริ่มงาน", "date"),
      f("salary", "เงินเดือน", "number", false, { min: 0 }),
      f("birthDate", "วันเกิด", "date"),
      f("idCard", "เลขบัตรประชาชน"),
      f("bank", "ธนาคาร"),
      f("bankAccount", "เลขบัญชี"),
      f("emergency", "ผู้ติดต่อฉุกเฉิน"),
      f("level", "ระดับ", "select", false, { options: ["พนักงาน", "หัวหน้างาน", "ผู้จัดการ", "ผู้บริหาร"] }),
      f("managerId", "หัวหน้างาน", "relation", false, { resource: "employees" }),
      f("branch", "สาขา"),
      f("workHours", "เวลาทำงาน"),
      f("about", "เกี่ยวกับ", "textarea"),
      f("skills", "ทักษะ (คั่นด้วย ,)"),
      f("score", "คะแนนประเมิน (0–100)", "number", false, { min: 0 }),
      f("leaveQuota", "วันลาต่อปี", "number", false, { min: 0 }),
      f("checklist", "เอกสารที่ส่งแล้ว", "text", false, { hidden: true }),
      f("approvals", "สิทธิ์การอนุมัติ", "text", false, { hidden: true }),
      f("history", "ประวัติการทำงาน", "textarea", false, { hidden: true }),
      f("cover", "รูปปก", "image", false, { hidden: true }),
      status(["active", "probation", "on_leave", "inactive"]),
      ...contact,
    ],
  },
  {
    key: "freelancers",
    label: "ฟรีแลนซ์",
    description: "ทีม PC / MC / PR / Supervisor และอัตราค่าจ้างหน้างาน",
    department: "HR",
    icon: "ContactRound",
    columns: ["name", "role", "phone", "wage", "status"],
    fields: [
      f("name", "ชื่อ-นามสกุล", "text", true),
      f("code", "รหัส"),
      f("nickname", "ชื่อเล่น"),
      f("role", "ประเภทงาน", "select", true, {
        options: ["SUP", "PT", "PT_LOCAL", "PC", "MC", "PR"],
      }),
      f("position", "ตำแหน่ง"),
      f("branch", "สาขา"),
      f("wage", "ค่าจ้างต่อวัน", "number", false, { min: 0 }),
      f("startDate", "วันเริ่มงาน", "date"),
      f("birthDate", "วันเกิด", "date"),
      f("idCard", "เลขบัตรประชาชน"),
      f("education", "การศึกษา"),
      f("bank", "ธนาคาร"),
      f("bankAccount", "เลขบัญชี"),
      f("emergency", "ผู้ติดต่อฉุกเฉิน"),
      f("workHistory", "ประวัติการทำงาน", "textarea"),
      f("evaluation", "การประเมิน", "textarea"),
      status(["available", "assigned", "inactive"]),
      ...contact,
    ],
  },
  {
    key: "projects",
    label: "โครงการ",
    description: "แผนงาน เป้าหมาย งบประมาณ และความคืบหน้าของทีม",
    department: "Operations",
    icon: "Folders",
    columns: ["name", "owner", "budget", "endDate", "status"],
    fields: [
      f("name", "ชื่อโครงการ", "text", true),
      f("code", "รหัสโครงการ"),
      f("description", "รายละเอียด", "textarea"),
      f("owner", "ผู้รับผิดชอบ"),
      f("priority", "ความสำคัญ", "select", true, {
        options: ["normal", "high", "urgent"],
      }),
      ...dates,
      f("budget", "งบประมาณ", "number", false, { min: 0 }),
      status(["planning", "active", "review", "completed", "cancelled"]),
    ],
  },
  {
    key: "deals",
    label: "พื้นที่ขาย & ดีล",
    description: "พื้นที่ ระยะเวลา ค่าเช่า GP และการอนุมัติดีล",
    department: "Business Development",
    icon: "MapPin",
    columns: ["name", "location", "rent", "endDate", "status"],
    fields: [
      f("name", "ชื่อดีล / พื้นที่", "text", true),
      f("dealerId", "Dealer", "relation", false, { resource: "dealers" }),
      project,
      f("location", "สถานที่ / สาขา", "text", true),
      f("zone", "ชั้น / โซน"),
      f("area", "พื้นที่ (ตร.ม.)", "number", false, { min: 0 }),
      ...dates,
      f("rent", "ค่าเช่า", "number", true, { min: 0 }),
      f("gp", "GP (%)", "number", false, { min: 0 }),
      f("targetSales", "เป้ายอดขาย", "number", false, { min: 0 }),
      f("owner", "ผู้รับผิดชอบ"),
      f("condition", "เงื่อนไขค่าเช่า", "textarea"),
      status(["negotiating", "pending", "approved", "rejected", "cancelled"]),
      f("notes", "หมายเหตุ", "textarea"),
    ],
  },
  {
    key: "events",
    label: "อีเวนต์",
    description: "วางแผนอีเวนต์ สถานที่ ทีมหน้างาน และกำหนดการ",
    department: "Operations",
    icon: "CalendarDays",
    columns: ["name", "location", "startDate", "endDate", "status"],
    fields: [
      f("name", "ชื่ออีเวนต์", "text", true),
      project,
      f("location", "สถานที่"),
      ...dates,
      f("staff", "ทีมหน้างาน", "textarea"),
      f("budget", "งบประมาณ", "number", false, { min: 0 }),
      f("owner", "ผู้รับผิดชอบ"),
      status(["planning", "confirmed", "running", "completed", "cancelled"]),
      f("notes", "รายละเอียด", "textarea"),
    ],
  },
  {
    key: "tasks",
    label: "งาน & Workflow",
    description: "มอบหมายงาน ติดตามสถานะ และวันครบกำหนด",
    department: "Operations",
    icon: "ListTodo",
    columns: ["name", "department", "assignee", "dueDate", "status"],
    fields: [
      f("name", "ชื่องาน", "text", true),
      project,
      f("department", "แผนก", "text", true),
      f("assignee", "ผู้รับผิดชอบ"),
      f("dueDate", "วันครบกำหนด", "date"),
      f("priority", "ความสำคัญ", "select", true, {
        options: ["normal", "high", "urgent"],
      }),
      status(["pending", "progress", "review", "done"]),
      f("notes", "รายละเอียด", "textarea"),
    ],
  },
  {
    key: "assets",
    label: "ทรัพย์สิน",
    description: "ทะเบียนทรัพย์สิน ผู้ดูแล สถานที่ และมูลค่า",
    department: "Operations",
    icon: "Monitor",
    columns: ["name", "category", "owner", "price", "status"],
    fields: [
      f("name", "ชื่อทรัพย์สิน", "text", true),
      f("code", "รหัส / Serial"),
      f("category", "หมวดหมู่", "select", true, {
        options: [
          "IT",
          "อุปกรณ์สำนักงาน",
          "เฟอร์นิเจอร์",
          "อุปกรณ์บูธ",
          "ยานพาหนะ",
          "อื่นๆ",
        ],
      }),
      f("shop", "ร้านที่ซื้อ"),
      f("buyDate", "วันที่ซื้อ", "date"),
      f("price", "ราคาต่อชิ้น", "number", true, { min: 0 }),
      f("quantity", "จำนวน", "number", true, { min: 1 }),
      f("owner", "ผู้ดูแล"),
      f("place", "สถานที่จัดเก็บ"),
      f("warranty", "ประกันถึง", "date"),
      status(["in_use", "available", "repair", "retired"]),
      f("notes", "หมายเหตุ", "textarea"),
    ],
  },
  {
    key: "products",
    label: "สต็อกสินค้า",
    description: "สินค้า SKU จุดสั่งซื้อ และยอดคงเหลือจากรายการรับ–จ่าย",
    department: "Warehouse",
    icon: "Package",
    columns: ["name", "sku", "stock", "reorderLevel", "price"],
    fields: [
      f("name", "ชื่อสินค้า", "text", true),
      f("sku", "SKU / Barcode", "text", true),
      f("category", "หมวดหมู่"),
      f("unit", "หน่วย", "text", true),
      f("cost", "ต้นทุนต่อหน่วย", "number", true, { min: 0 }),
      f("price", "ราคาขาย", "number", true, { min: 0 }),
      f("reorderLevel", "จุดแจ้งเตือนสต็อก", "number", true, { min: 0 }),
      f("location", "ตำแหน่งจัดเก็บ"),
      status(["active", "inactive"]),
    ],
  },
  {
    key: "purchases",
    label: "จัดซื้อ",
    description: "ใบสั่งซื้อสินค้า ตรวจยอด และรับสินค้าเข้าคลัง",
    department: "Purchasing",
    icon: "ShoppingCart",
    columns: ["name", "supplierId", "quantity", "total", "status"],
    fields: [
      f("name", "เลขที่ใบสั่งซื้อ", "text", true),
      f("supplierId", "ซัพพลายเออร์", "relation", true, {
        resource: "suppliers",
      }),
      f("productId", "สินค้า", "relation", true, { resource: "products" }),
      f("quantity", "จำนวน", "number", true, { min: 1 }),
      f("unitCost", "ราคาต่อหน่วย", "number", true, { min: 0 }),
      f("orderDate", "วันที่สั่งซื้อ", "date", true),
      f("dueDate", "กำหนดรับ", "date"),
      project,
      f("category", "หมวดหมู่สินค้า"),
      f("requestor", "ผู้ขอจัดซื้อ"),
      f("usagePurpose", "งาน / โปรโมชั่นที่ใช้"),
      ...dates,
      f("deliveryLocation", "สถานที่จัดส่ง"),
      f("poNumber", "เลขที่ใบสั่งซื้อ PO"),
      f("notes", "หมายเหตุ", "textarea"),
    ],
  },
  {
    key: "sales",
    label: "ยอดขาย",
    description: "ยอดขายรายวัน แยกโครงการ สาขา และสินค้า",
    department: "Sales",
    icon: "ChartNoAxesCombined",
    columns: ["name", "date", "amount", "status"],
    fields: [
      f("name", "รายการยอดขาย", "text", true),
      project,
      f("customerId", "ลูกค้า", "relation", false, { resource: "customers" }),
      f("date", "วันที่", "date", true),
      f("amount", "ยอดขาย", "number", true, { min: 0 }),
      f("channel", "ช่องทาง"),
      status(["draft", "confirmed", "cancelled"]),
      f("notes", "รายละเอียด", "textarea"),
    ],
  },
  {
    key: "expenses",
    label: "ค่าใช้จ่าย",
    description: "บันทึกค่าใช้จ่ายและผู้รับเงินสำหรับแต่ละโครงการ",
    department: "Finance",
    icon: "Receipt",
    columns: ["name", "category", "date", "amount", "status"],
    fields: [
      f("name", "รายการค่าใช้จ่าย", "text", true),
      project,
      f("category", "หมวดหมู่", "select", true, { options: [...expenseCategories], picker: "expenseCategory" }),
      f("accountCode", "รหัสผังบัญชี"),
      f("costCenter", "ศูนย์ต้นทุน"),
      f("payee", "ผู้รับเงิน"),
      f("supplierId", "Supplier", "relation", false, { resource: "suppliers" }),
      f("docType", "ประเภทเอกสาร", "select", false, { options: [...docTypes] }),
      f("docNo", "เลขที่เอกสาร"),
      f("taxId", "เลขผู้เสียภาษีผู้ขาย"),
      f("date", "วันที่", "date", true),
      f("receiptId", "ไฟล์ใบเสร็จ", "image", false, { hidden: true }),
      f("lines", "รายการสินค้า", "lines", false, { hidden: true }),
      f("amount", "ยอดตามเอกสาร", "number", true, { min: 0 }),
      f("vatMode", "VAT", "select", false, { options: ["included", "excluded", "none"] }),
      f("whtRate", "หัก ณ ที่จ่าย (%)", "select", false, { options: ["0", "1", "2", "3", "5"] }),
      f("payStatus", "การชำระ", "select", false, { options: [...payStatuses] }),
      f("reviewStatus", "การตรวจ", "select", false, { options: ["รอตรวจ", "บันทึกแล้ว"], hidden: true }),
      f("aiNotes", "เหตุผลจาก AI", "textarea", false, { hidden: true }),
      f("aiUncertain", "ช่องที่ AI ไม่แน่ใจ", "text", false, { hidden: true }),
      status(["pending", "approved", "paid", "rejected"]),
      f("notes", "หมายเหตุ", "textarea"),
      // Filled by the บันทึกค่าใช้จ่าย form (expense-form.tsx).
      f("code", "เลขที่เอกสาร (EXP)", "text", false, { hidden: true }),
      f("payeeType", "ประเภทผู้รับเงิน", "select", false, { options: [...payeeTypes], hidden: true }),
      f("employeeId", "พนักงานผู้รับเงิน", "relation", false, { resource: "employees", hidden: true }),
      f("payeePhone", "เบอร์โทรผู้รับเงิน", "tel", false, { hidden: true }),
      f("discount", "ส่วนลดท้ายบิล", "number", false, { min: 0, hidden: true }),
      f("discountType", "ประเภทส่วนลด", "select", false, { options: ["amount", "percent"], hidden: true }),
      f("approver", "ผู้อนุมัติ", "text", false, { hidden: true }),
    ],
  },
  {
    key: "invoices",
    label: "ใบแจ้งหนี้",
    description: "บันทึกใบแจ้งหนี้ ยอดภาษี วันครบกำหนด และรับชำระ",
    department: "Finance",
    icon: "FileText",
    columns: ["name", "customerId", "total", "dueDate", "status"],
    fields: [
      f("name", "เลขที่ใบแจ้งหนี้", "text", true),
      f("customerId", "ลูกค้า", "relation", true, { resource: "customers" }),
      project,
      f("date", "วันที่เอกสาร", "date", true),
      f("dueDate", "วันครบกำหนด", "date", true),
      f("subtotal", "มูลค่าก่อนภาษี", "number", true, { min: 0 }),
      f("vat", "VAT (%)", "number", true, { min: 0 }),
      f("description", "รายละเอียด", "textarea"),
    ],
  },
  {
    key: "payments",
    label: "การชำระเงิน",
    description: "หลักฐานการรับ–จ่ายและการกระทบยอดใบแจ้งหนี้",
    department: "Finance",
    icon: "CreditCard",
    columns: ["name", "direction", "date", "amount", "method"],
    fields: [
      f("name", "รายการชำระเงิน", "text", true),
      f("invoiceId", "ใบแจ้งหนี้", "relation", false, { resource: "invoices" }),
      f("direction", "ประเภท", "select", true, {
        options: ["income", "expense"],
      }),
      f("date", "วันที่ชำระ", "date", true),
      f("amount", "จำนวนเงิน", "number", true, { min: 0 }),
      f("method", "วิธีชำระ", "select", true, {
        options: ["โอนธนาคาร", "เงินสด", "บัตร", "อื่นๆ"],
      }),
      f("reference", "เลขอ้างอิง"),
      f("notes", "หมายเหตุ", "textarea"),
    ],
  },
  {
    key: "campaigns",
    label: "Marketing",
    description: "แคมเปญ งบประมาณ ช่องทาง และผลลัพธ์การตลาด",
    department: "Marketing",
    icon: "Megaphone",
    columns: ["name", "channel", "budget", "revenue", "status"],
    fields: [
      f("name", "ชื่อแคมเปญ", "text", true),
      project,
      f("channel", "ช่องทาง"),
      ...dates,
      f("budget", "งบประมาณ", "number", true, { min: 0 }),
      f("revenue", "ยอดขายจากแคมเปญ", "number", false, { min: 0 }),
      f("owner", "ผู้รับผิดชอบ"),
      status(["draft", "running", "completed", "paused"]),
      f("notes", "รายละเอียด", "textarea"),
    ],
  },
  {
    key: "tickets",
    label: "IT & Customer Service",
    description: "รับเรื่อง ติดตาม SLA และแก้ปัญหาของทีมและลูกค้า",
    department: "Customer Service",
    icon: "Headset",
    columns: ["name", "type", "assignee", "dueDate", "status"],
    fields: [
      f("name", "หัวข้อปัญหา", "text", true),
      f("type", "ประเภท", "select", true, {
        options: ["IT", "Customer Service"],
      }),
      f("customerId", "ลูกค้า", "relation", false, { resource: "customers" }),
      f("assignee", "ผู้รับผิดชอบ"),
      f("priority", "ความสำคัญ", "select", true, {
        options: ["normal", "high", "urgent"],
      }),
      f("dueDate", "กำหนด SLA", "date"),
      status(["open", "progress", "resolved", "closed"]),
      f("notes", "รายละเอียด", "textarea"),
    ],
  },
  {
    key: "contracts",
    label: "สัญญา & กฎหมาย",
    description: "ทะเบียนสัญญา คู่สัญญา มูลค่า และวันหมดอายุ",
    department: "Legal",
    icon: "Scale",
    columns: ["name", "counterparty", "value", "endDate", "status"],
    fields: [
      f("name", "ชื่อ / เลขที่สัญญา", "text", true),
      project,
      f("counterparty", "คู่สัญญา", "text", true),
      f("value", "มูลค่าสัญญา", "number", false, { min: 0 }),
      ...dates,
      status(["draft", "review", "signed", "expired", "terminated"]),
      f("notes", "รายละเอียด", "textarea"),
    ],
  },
  {
    key: "leaves",
    label: "การลา",
    description: "คำขอลาและการอนุมัติของบุคลากร",
    department: "HR",
    icon: "CalendarOff",
    columns: ["name", "employeeId", "startDate", "endDate", "status"],
    fields: [
      f("name", "หัวข้อการลา", "text", true),
      f("employeeId", "พนักงาน", "relation", true, { resource: "employees" }),
      f("type", "ประเภท", "select", true, {
        options: ["ลาป่วย", "ลากิจ", "ลาพักร้อน", "อื่นๆ"],
      }),
      ...dates,
      status(["pending", "approved", "rejected"]),
      f("notes", "เหตุผล", "textarea"),
    ],
  },
  {
    key: "payroll",
    label: "บัญชีค่าจ้าง",
    description: "คำนวณค่าจ้างสุทธิและติดตามการจ่ายรายงวด",
    department: "HR",
    icon: "Wallet",
    columns: ["name", "employeeId", "net", "date", "status"],
    fields: [
      f("name", "งวดค่าจ้าง", "text", true),
      f("employeeId", "พนักงาน", "relation", true, { resource: "employees" }),
      f("date", "วันที่จ่าย", "date", true),
      f("base", "ค่าจ้างพื้นฐาน", "number", true, { min: 0 }),
      f("allowance", "รายได้เพิ่ม", "number", false, { min: 0 }),
      f("deduction", "รายการหัก", "number", false, { min: 0 }),
      status(["draft", "approved", "paid"]),
      f("notes", "รายละเอียด", "textarea"),
    ],
  },
  {
    key: "documents",
    label: "คลังเอกสาร",
    description: "เอกสารธุรกิจและไฟล์แนบที่แยกตามสิทธิ์แผนก",
    department: "Operations",
    icon: "Files",
    columns: ["name", "category", "department", "updated_at"],
    fields: [
      f("name", "ชื่อเอกสาร", "text", true),
      project,
      f("category", "หมวดหมู่", "select", true, {
        options: [
          "สัญญา",
          "ใบเสร็จ",
          "Layout",
          "Perspective",
          "เอกสารบุคคล",
          "ทั่วไป",
        ],
      }),
      f("department", "แผนก", "text", true),
      f("notes", "รายละเอียด", "textarea"),
    ],
  },
];
modules.push({
  key: "leads",
  label: "CRM / Sales Pipeline",
  description: "ติดตาม Lead, Contact, Meeting, Proposal, Negotiation และ Won",
  department: "Sales",
  icon: "Users",
  columns: ["name", "customerId", "stage", "amount", "assignee"],
  fields: [
    f("name", "ชื่อโอกาสขาย", "text", true),
    f("customerId", "ลูกค้า", "relation", false, { resource: "customers" }),
    f("stage", "ขั้นตอน", "select", true, {
      options: [
        "lead",
        "contact",
        "meeting",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ],
    }),
    f("amount", "มูลค่าโอกาสขาย", "number", true, { min: 0 }),
    f("assignee", "ผู้รับผิดชอบ"),
    f("nextDate", "นัดติดตามครั้งถัดไป", "date"),
    f("activity", "กิจกรรมล่าสุด", "textarea"),
    f("notes", "หมายเหตุ", "textarea"),
  ],
});
// ---------- Department menu pages (แผนก mega menu) ----------
const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Item list total after discount, plus VAT when the document adds it. */
export const docTotal = (d: Record<string, unknown>) => {
  const lines = Array.isArray(d.lines) ? (d.lines as Line[]) : [];
  const sub = lines.length ? lines.reduce((s, l) => s + lineAmount(l), 0) : num(d.subtotal);
  const after = Math.max(0, sub - num(d.discount));
  return r2(d.vatMode === "excluded" ? after * 1.07 : after);
};
const hoursBetween = (a: unknown, b: unknown) => {
  const t = (s: unknown) => /^\d{1,2}:\d{2}$/.test(String(s)) ? Number(String(s).split(":")[0]) * 60 + Number(String(s).split(":")[1]) : NaN;
  const m = t(b) - t(a);
  return Number.isFinite(m) && m > 0 ? r2(m / 60) : 0;
};
export const computeAttendance = (d: Record<string, unknown>) => ({
  hours: hoursBetween(d.checkIn, d.checkOut),
  late: Math.max(0, (() => { const [h, m] = String(d.checkIn || "").split(":").map(Number); const s = String(d.shiftStart || "09:00").split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) - (s[0] * 60 + (s[1] || 0)) : 0; })()),
});
const vatMode = f("vatMode", "VAT", "select", false, { options: ["excluded", "included", "none"] });
const lines = f("lines", "รายการสินค้า/บริการ", "lines");
const owner = f("owner", "ผู้รับผิดชอบ");
const notes = f("notes", "หมายเหตุ", "textarea");
const expiry = f("expiryDate", "วันหมดอายุ", "date");
modules.push(
  {
    key: "quotations", label: "ใบเสนอราคา", description: "ออกใบเสนอราคา คิดส่วนลดและ VAT แล้วติดตามผลจนลูกค้าตอบรับ",
    department: "Sales", icon: "FileText", columns: ["name", "code", "customerId", "date", "total", "status"],
    fields: [f("name", "หัวข้องาน", "text", true), f("customerId", "ลูกค้า", "relation", true, { resource: "customers" }), f("date", "วันที่", "date", true), f("validUntil", "ยืนราคาถึง", "date"), lines, f("subtotal", "มูลค่า (ถ้าไม่ใส่รายการ)", "number", false, { min: 0 }), f("discount", "ส่วนลด (บาท)", "number", false, { min: 0 }), vatMode, owner, status(["ร่าง", "ส่งแล้ว", "ตอบรับ", "ปฏิเสธ"]), notes],
    computed: { total: { label: "ยอดสุทธิ", calc: docTotal } },
  },
  {
    key: "sales_orders", label: "คำสั่งซื้อ (SO)", description: "คำสั่งซื้อจากลูกค้า กำหนดส่ง และสถานะจัดส่ง/ออกใบแจ้งหนี้",
    department: "Sales", icon: "ShoppingCart", columns: ["name", "code", "customerId", "deliveryDate", "total", "status"],
    fields: [f("name", "หัวข้อคำสั่งซื้อ", "text", true), f("customerId", "ลูกค้า", "relation", true, { resource: "customers" }), f("quotationId", "อ้างอิงใบเสนอราคา", "relation", false, { resource: "quotations" }), f("date", "วันที่สั่ง", "date", true), f("deliveryDate", "กำหนดส่ง", "date"), lines, f("subtotal", "มูลค่า (ถ้าไม่ใส่รายการ)", "number", false, { min: 0 }), f("discount", "ส่วนลด (บาท)", "number", false, { min: 0 }), vatMode, project, status(["รอดำเนินการ", "กำลังจัดส่ง", "ส่งแล้ว", "ออกใบแจ้งหนี้แล้ว", "ยกเลิก"]), notes],
    computed: { total: { label: "ยอดสุทธิ", calc: docTotal } },
  },
  {
    key: "sales_targets", label: "งานขาย & เป้าหมาย", description: "เป้ายอดขายรายเดือนต่อคน/ทีม เทียบยอดทำได้จริง",
    department: "Sales", icon: "Target", columns: ["name", "month", "target", "actual", "percent"],
    fields: [f("name", "พนักงาน / ทีม", "text", true), f("month", "เดือน (YYYY-MM)", "text", true), f("target", "เป้ายอดขาย", "number", true, { min: 0 }), f("actual", "ยอดทำได้", "number", false, { min: 0 }), f("visits", "จำนวนเข้าพบลูกค้า", "number", false, { min: 0 }), status(["กำลังดำเนินการ", "ถึงเป้า", "ไม่ถึงเป้า"]), notes],
    computed: { percent: { label: "% ของเป้า", calc: (d) => (num(d.target) ? r2((num(d.actual) / num(d.target)) * 100) : 0) } },
  },
  {
    key: "content", label: "สื่อโฆษณา & คอนเทนต์", description: "ปฏิทินคอนเทนต์และโฆษณาทุกช่องทาง รวม Social Media พร้อมผลลัพธ์",
    department: "Marketing", icon: "Megaphone", columns: ["name", "channel", "publishDate", "reach", "status"],
    fields: [f("name", "หัวข้อคอนเทนต์", "text", true), f("channel", "ช่องทาง", "select", true, { options: ["Facebook", "Instagram", "TikTok", "LINE OA", "YouTube", "เว็บไซต์", "สื่อสิ่งพิมพ์", "อื่นๆ"] }), f("type", "รูปแบบ", "select", false, { options: ["โพสต์", "วิดีโอ", "โฆษณา", "บทความ", "ไลฟ์"] }), f("campaignId", "แคมเปญ", "relation", false, { resource: "campaigns" }), f("publishDate", "วันเผยแพร่", "date"), f("url", "ลิงก์", "url"), f("spend", "ค่าโฆษณา", "number", false, { min: 0 }), f("reach", "Reach", "number", false, { min: 0 }), f("engagement", "Engagement", "number", false, { min: 0 }), owner, status(["ไอเดีย", "กำลังทำ", "รออนุมัติ", "เผยแพร่แล้ว"]), notes],
    computed: { rate: { label: "Engagement %", calc: (d) => (num(d.reach) ? r2((num(d.engagement) / num(d.reach)) * 100) : 0) } },
  },
  {
    key: "marketing_budget", label: "งบการตลาด", description: "ตั้งงบต่อแคมเปญ/ไตรมาส เทียบใช้จริงและงบคงเหลือ",
    department: "Marketing", icon: "Wallet", columns: ["name", "period", "budget", "spent", "remaining"],
    fields: [f("name", "รายการงบ", "text", true), f("campaignId", "แคมเปญ", "relation", false, { resource: "campaigns" }), f("period", "ช่วงเวลา (เช่น 2026-Q4)", "text", true), f("budget", "งบที่ตั้ง", "number", true, { min: 0 }), f("spent", "ใช้จริง", "number", false, { min: 0 }), status(["วางแผน", "อนุมัติ", "ปิดงบ"]), notes],
    computed: { remaining: { label: "คงเหลือ", calc: (d) => r2(num(d.budget) - num(d.spent)) } },
  },
  {
    key: "promotions", label: "กิจกรรมส่งเสริมการขาย", description: "โปรโมชัน ส่วนลด และกิจกรรมหน้าร้าน พร้อมผลยอดขาย",
    department: "Marketing", icon: "BadgePercent", columns: ["name", "startDate", "endDate", "result", "status"],
    fields: [f("name", "ชื่อกิจกรรม", "text", true), f("mechanic", "รูปแบบโปร (ลด/แถม/สะสมแต้ม)"), ...dates, f("discount", "ส่วนลด (%)", "number", false, { min: 0 }), f("budget", "งบ", "number", false, { min: 0 }), f("target", "เป้ายอดขาย", "number", false, { min: 0 }), f("result", "ยอดขายที่ได้", "number", false, { min: 0 }), status(["วางแผน", "กำลังจัด", "จบแล้ว"]), notes],
  },
  {
    key: "stock_issues", label: "เบิกสินค้าออก", description: "ใบเบิกสินค้าออกจากคลังให้โปรเจกต์/แผนก พร้อมผู้อนุมัติ",
    department: "Warehouse", icon: "PackageMinus", columns: ["name", "code", "productId", "quantity", "requester", "status"],
    fields: [f("name", "รายการเบิก", "text", true), f("productId", "สินค้า", "relation", true, { resource: "products" }), f("quantity", "จำนวน", "number", true, { min: 0 }), f("requester", "ผู้เบิก", "text", true), project, f("date", "วันที่เบิก", "date", true), status(["รออนุมัติ", "อนุมัติแล้ว", "จ่ายของแล้ว", "ไม่อนุมัติ"]), notes],
  },
  {
    key: "stock_counts", label: "ตรวจนับสต็อก", description: "นับสต็อกจริงเทียบยอดในระบบ เห็นส่วนต่างทันที",
    department: "Warehouse", icon: "ClipboardCheck", columns: ["name", "productId", "systemQty", "countedQty", "diff"],
    fields: [f("name", "รอบนับ", "text", true), f("productId", "สินค้า", "relation", true, { resource: "products" }), f("date", "วันที่นับ", "date", true), f("systemQty", "ยอดในระบบ", "number", true), f("countedQty", "นับได้จริง", "number", true, { min: 0 }), f("counter", "ผู้นับ"), status(["นับแล้ว", "ตรวจแล้ว", "ปรับยอดแล้ว"]), notes],
    computed: { diff: { label: "ส่วนต่าง", calc: (d) => num(d.countedQty) - num(d.systemQty) } },
  },
  {
    key: "bills", label: "ใบรับวางบิล (AP)", description: "รับวางบิลจาก Supplier ติดตามวันครบกำหนดและการจ่าย",
    department: "Finance", icon: "ReceiptText", columns: ["name", "code", "supplierId", "dueDate", "net", "status"],
    fields: [f("name", "รายการ", "text", true), f("supplierId", "Supplier", "relation", true, { resource: "suppliers" }), f("invoiceNo", "เลขที่ใบแจ้งหนี้ของ Supplier"), f("date", "วันที่รับวางบิล", "date", true), f("dueDate", "ครบกำหนดจ่าย", "date", true), f("amount", "ยอดเงิน", "number", true, { min: 0 }), f("whtRate", "หัก ณ ที่จ่าย (%)", "select", false, { options: ["0", "1", "2", "3", "5"] }), project, status(["รอตรวจ", "รอจ่าย", "จ่ายแล้ว", "โต้แย้ง"]), notes],
    computed: { net: { label: "ยอดจ่ายสุทธิ", calc: (d) => r2(num(d.amount) - (num(d.amount) / 1.07) * (num(d.whtRate) / 100)) } },
  },
  {
    key: "recruitment", label: "สรรหา & รับพนักงาน", description: "ผู้สมัครแต่ละตำแหน่ง ตั้งแต่สมัคร สัมภาษณ์ จนรับเข้าทำงาน",
    department: "HR", icon: "UserPlus", columns: ["name", "position", "interviewDate", "expectedSalary", "status"],
    fields: [f("name", "ชื่อผู้สมัคร", "text", true), f("position", "ตำแหน่งที่สมัคร", "text", true), f("source", "ช่องทาง", "select", false, { options: ["JobThai", "JobsDB", "LinkedIn", "เครือข่าย EliteFlow", "แนะนำ", "อื่นๆ"] }), f("phone", "โทรศัพท์", "tel"), f("email", "อีเมล", "email"), f("interviewDate", "วันสัมภาษณ์", "date"), f("expectedSalary", "เงินเดือนที่คาดหวัง", "number", false, { min: 0 }), f("score", "คะแนนสัมภาษณ์ (0-10)", "number", false, { min: 0 }), status(["สมัคร", "คัดกรอง", "สัมภาษณ์", "เสนองาน", "รับเข้าทำงาน", "ไม่ผ่าน"]), notes],
  },
  {
    key: "attendance", label: "เวลาเข้า-ออกงาน", description: "บันทึกเวลาเข้า-ออก ชั่วโมงทำงาน และนาทีที่สาย",
    department: "HR", icon: "Clock", columns: ["name", "date", "checkIn", "checkOut", "hours"],
    fields: [f("name", "พนักงาน", "text", true), f("employeeId", "เชื่อมข้อมูลพนักงาน", "relation", false, { resource: "employees" }), f("date", "วันที่", "date", true), f("shiftStart", "เวลาเข้างาน (กะ) HH:MM"), f("checkIn", "เข้างาน HH:MM", "text", true), f("checkOut", "ออกงาน HH:MM"), f("location", "สถานที่"), status(["ปกติ", "สาย", "ขาด", "ลา", "ทำงานนอกสถานที่"]), notes],
    computed: { hours: { label: "ชั่วโมง", calc: (d) => computeAttendance(d).hours }, late: { label: "สาย (นาที)", calc: (d) => computeAttendance(d).late } },
  },
  {
    key: "kpi", label: "ประเมินผลงาน (KPI/OKR)", description: "ตั้งเป้าหมายรายรอบ ให้คะแนน และติดตามความคืบหน้า",
    department: "HR", icon: "Gauge", columns: ["name", "period", "objective", "progress", "status"],
    fields: [f("name", "พนักงาน", "text", true), f("employeeId", "เชื่อมข้อมูลพนักงาน", "relation", false, { resource: "employees" }), f("period", "รอบประเมิน", "text", true), f("objective", "เป้าหมาย / KPI", "text", true), f("target", "ค่าเป้าหมาย", "number", false), f("actual", "ผลที่ได้", "number", false), f("score", "คะแนน (1-5)", "number", false, { min: 0 }), status(["ตั้งเป้า", "ระหว่างรอบ", "ประเมินแล้ว"]), notes],
    computed: { progress: { label: "ความคืบหน้า %", calc: (d) => (num(d.target) ? r2((num(d.actual) / num(d.target)) * 100) : 0) } },
  },
  {
    key: "event_guests", label: "ผู้เข้าร่วมงาน", description: "รายชื่อผู้ลงทะเบียน เช็กอิน และประเภทแขก",
    department: "Event", icon: "Users", columns: ["name", "eventId", "guestType", "company", "status"],
    fields: [f("name", "ชื่อผู้เข้าร่วม", "text", true), f("eventId", "อีเวนต์", "relation", true, { resource: "events" }), f("guestType", "ประเภท", "select", false, { options: ["ทั่วไป", "VIP", "สื่อ", "พาร์ทเนอร์", "วิทยากร"] }), f("company", "บริษัท"), f("phone", "โทรศัพท์", "tel"), f("email", "อีเมล", "email"), status(["ลงทะเบียน", "ยืนยัน", "เช็กอินแล้ว", "ไม่มา"]), notes],
  },
  {
    key: "event_budget", label: "งบประมาณอีเวนต์", description: "งบแต่ละหมวดของอีเวนต์ เทียบใช้จริง",
    department: "Event", icon: "Wallet", columns: ["name", "eventId", "budget", "spent", "remaining"],
    fields: [f("name", "หมวดงบ", "text", true), f("eventId", "อีเวนต์", "relation", true, { resource: "events" }), f("budget", "งบ", "number", true, { min: 0 }), f("spent", "ใช้จริง", "number", false, { min: 0 }), f("vendor", "ผู้รับจ้าง"), status(["วางแผน", "อนุมัติ", "จ่ายแล้ว"]), notes],
    computed: { remaining: { label: "คงเหลือ", calc: (d) => r2(num(d.budget) - num(d.spent)) } },
  },
  {
    key: "venues", label: "สถานที่ & อุปกรณ์", description: "สถานที่จัดงาน อุปกรณ์ที่ต้องใช้ วันจอง และค่าใช้จ่าย",
    department: "Event", icon: "MapPin", columns: ["name", "type", "bookingDate", "cost", "status"],
    fields: [f("name", "ชื่อสถานที่ / อุปกรณ์", "text", true), f("type", "ประเภท", "select", true, { options: ["สถานที่", "เวที & แสงเสียง", "บูธ", "เฟอร์นิเจอร์", "อุปกรณ์ไอที", "อื่นๆ"] }), f("eventId", "อีเวนต์", "relation", false, { resource: "events" }), f("bookingDate", "วันที่จอง/ใช้", "date"), f("capacity", "ความจุ / จำนวน", "number", false, { min: 0 }), f("cost", "ค่าใช้จ่าย", "number", false, { min: 0 }), f("contact", "ผู้ติดต่อ"), f("phone", "โทรศัพท์", "tel"), status(["สอบถาม", "จองแล้ว", "ยืนยัน", "ยกเลิก"]), notes],
  },
  {
    key: "software", label: "ระบบและซอฟต์แวร์", description: "ไลเซนส์ ซอฟต์แวร์ และระบบที่ใช้ พร้อมวันต่ออายุ",
    department: "IT", icon: "AppWindow", columns: ["name", "vendor", "seats", "expiryDate", "status"],
    fields: [f("name", "ชื่อระบบ / ซอฟต์แวร์", "text", true), f("vendor", "ผู้ให้บริการ"), f("seats", "จำนวนไลเซนส์", "number", false, { min: 0 }), f("cost", "ค่าใช้จ่ายต่อปี", "number", false, { min: 0 }), expiry, owner, f("url", "ลิงก์ระบบ", "url"), status(["ใช้งาน", "ทดลองใช้", "รอต่ออายุ", "ยกเลิก"]), notes],
  },
  {
    key: "security", label: "ความปลอดภัย", description: "เหตุการณ์ความปลอดภัย ช่องโหว่ และงานป้องกัน",
    department: "IT", icon: "ShieldAlert", columns: ["name", "severity", "date", "owner", "status"],
    fields: [f("name", "หัวข้อ", "text", true), f("category", "ประเภท", "select", true, { options: ["เหตุการณ์", "ช่องโหว่", "รหัสผ่าน/สิทธิ์", "สำรองข้อมูล", "อบรม", "อื่นๆ"] }), f("severity", "ความรุนแรง", "select", true, { options: ["ต่ำ", "กลาง", "สูง", "วิกฤต"] }), f("date", "วันที่พบ", "date", true), owner, status(["เปิด", "กำลังแก้", "แก้แล้ว", "ปิด"]), notes],
  },
  {
    key: "ip_assets", label: "สิทธิบัตร & ทรัพย์สินทางปัญญา", description: "เครื่องหมายการค้า สิทธิบัตร ลิขสิทธิ์ และวันต่ออายุ",
    department: "Legal", icon: "Award", columns: ["name", "type", "registrationNo", "expiryDate", "status"],
    fields: [f("name", "ชื่อ", "text", true), f("type", "ประเภท", "select", true, { options: ["เครื่องหมายการค้า", "สิทธิบัตร", "อนุสิทธิบัตร", "ลิขสิทธิ์", "ความลับทางการค้า"] }), f("registrationNo", "เลขทะเบียน"), f("filingDate", "วันยื่น", "date"), expiry, owner, status(["ยื่นคำขอ", "จดทะเบียนแล้ว", "รอต่ออายุ", "หมดอายุ"]), notes],
  },
  {
    key: "policies", label: "ข้อกำหนด & นโยบาย", description: "นโยบายบริษัท ระเบียบ และข้อกำหนดที่ต้องปฏิบัติ",
    department: "Legal", icon: "BookOpen", columns: ["name", "category", "effectiveDate", "expiryDate", "status"],
    fields: [f("name", "ชื่อนโยบาย / ข้อกำหนด", "text", true), f("category", "หมวด", "select", false, { options: ["บุคคล", "ข้อมูลส่วนบุคคล (PDPA)", "การเงิน", "ความปลอดภัย", "สิ่งแวดล้อม", "อื่นๆ"] }), f("effectiveDate", "มีผลตั้งแต่", "date"), f("expiryDate", "ทบทวน/หมดอายุ", "date"), owner, f("url", "ลิงก์เอกสาร", "url"), status(["ร่าง", "ประกาศใช้", "รอทบทวน", "ยกเลิก"]), notes],
  },
  {
    key: "cases", label: "คดีความ & ข้อพิพาท", description: "คดีและข้อพิพาท คู่กรณี นัดศาล และทุนทรัพย์",
    department: "Legal", icon: "Gavel", columns: ["name", "counterparty", "nextHearing", "amount", "status"],
    fields: [f("name", "เรื่อง", "text", true), f("caseNo", "เลขคดี"), f("counterparty", "คู่กรณี", "text", true), f("court", "ศาล / หน่วยงาน"), f("lawyer", "ทนาย"), f("nextHearing", "นัดถัดไป", "date"), f("amount", "ทุนทรัพย์", "number", false, { min: 0 }), status(["เจรจา", "ฟ้องร้อง", "พิจารณา", "ยุติ"]), notes],
  },
  {
    key: "vehicles", label: "ยานพาหนะ", description: "รถบริษัท ภาษี ประกัน ไมล์ และผู้ใช้รถ",
    department: "Admin", icon: "Car", columns: ["name", "plate", "driver", "insuranceExpiry", "status"],
    fields: [f("name", "รถ (ยี่ห้อ/รุ่น)", "text", true), f("plate", "ทะเบียน", "text", true), f("driver", "ผู้รับผิดชอบ / คนขับ"), f("mileage", "เลขไมล์", "number", false, { min: 0 }), f("taxExpiry", "ภาษีหมดอายุ", "date"), f("insuranceExpiry", "ประกันหมดอายุ", "date"), f("nextService", "เข้าศูนย์ครั้งถัดไป", "date"), status(["พร้อมใช้", "ใช้งานอยู่", "ซ่อมบำรุง", "จำหน่ายแล้ว"]), notes],
  },
  {
    key: "services", label: "งานบริการทั่วไป", description: "แม่บ้าน ซ่อมอาคาร จองห้องประชุม และงานธุรการอื่นๆ",
    department: "Admin", icon: "Wrench", columns: ["name", "category", "requester", "date", "status"],
    fields: [f("name", "เรื่อง", "text", true), f("category", "ประเภท", "select", true, { options: ["ซ่อมอาคาร", "แม่บ้าน/ทำความสะอาด", "จองห้องประชุม", "รับ-ส่งเอกสาร", "อุปกรณ์สำนักงาน", "อื่นๆ"] }), f("requester", "ผู้แจ้ง", "text", true), f("location", "สถานที่"), f("date", "วันที่ต้องการ", "date"), owner, status(["แจ้งแล้ว", "กำลังดำเนินการ", "เสร็จแล้ว", "ยกเลิก"]), notes],
  },
);
export const catalog = Object.fromEntries(modules.map((m) => [m.key, m]));
export const departmentNames = [
  "Operations",
  "Business Development",
  "Design",
  "Purchasing",
  "Warehouse",
  "Sales",
  "Finance",
  "Marketing",
  "HR",
  "IT",
  "Customer Service",
  "Legal",
  "Data",
  "Event",
  "Admin",
];
export const statusLabels: Record<string, string> = {
  active: "ใช้งาน",
  inactive: "หยุดใช้งาน",
  available: "พร้อมใช้งาน",
  assigned: "มอบหมายแล้ว",
  on_leave: "ลาพัก",
  probation: "ทดลองงาน",
  planning: "วางแผน",
  review: "รอตรวจทาน",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
  negotiating: "เจรจา",
  pending: "รอดำเนินการ",
  approved: "อนุมัติ",
  rejected: "ไม่อนุมัติ",
  confirmed: "ยืนยันแล้ว",
  running: "กำลังดำเนินการ",
  progress: "กำลังดำเนินการ",
  done: "เสร็จแล้ว",
  in_use: "กำลังใช้",
  repair: "ซ่อมแซม",
  retired: "ปลดระวาง",
  draft: "ร่าง",
  paid: "ชำระแล้ว",
  received: "รับสินค้าแล้ว",
  issued: "ออกเอกสารแล้ว",
  partial: "ชำระบางส่วน",
  paused: "พัก",
  open: "เปิดเรื่อง",
  resolved: "แก้ไขแล้ว",
  closed: "ปิดเรื่อง",
  signed: "ลงนามแล้ว",
  expired: "หมดอายุ",
  terminated: "สิ้นสุด",
  normal: "ปกติ",
  high: "สูง",
  urgent: "ด่วน",
  income: "รับเงิน",
  expense: "จ่ายเงิน",
  standard: "ทั่วไป",
  regular: "ลูกค้าประจำ",
  vip: "VIP",
};
// Business types common in Thailand, grouped (loosely following TSIC sections). The first item of
// several groups is a broad type kept from the original short list so existing profiles stay valid.
export const businessTypeGroups: [string, string[]][] = [
  ["เกษตร ประมง และปศุสัตว์", ["เกษตรกรรม / ฟาร์มพืช", "สวนผลไม้", "ปศุสัตว์ / ฟาร์มสัตว์", "ประมง / เพาะเลี้ยงสัตว์น้ำ", "สวนยาง / ปาล์ม / ป่าไม้", "เกษตรแปรรูป", "ปุ๋ย / เคมีเกษตร / เมล็ดพันธุ์", "เครื่องจักรกลการเกษตร"]],
  ["อาหารและเครื่องดื่ม", ["ร้านอาหาร / คาเฟ่", "ร้านอาหาร", "คาเฟ่ / ร้านกาแฟ", "เบเกอรี่ / ขนม", "ฟู้ดทรัค / สตรีทฟู้ด", "อาหารจัดเลี้ยง / แคเทอริ่ง", "คลาวด์คิทเช่น / เดลิเวอรี", "บาร์ / ผับ / ร้านเครื่องดื่ม", "ผลิตอาหารแปรรูป", "ผลิตเครื่องดื่ม / น้ำดื่ม", "แฟรนไชส์อาหาร"]],
  ["ค้าปลีกและค้าส่ง", ["ค้าปลีก", "ค้าส่ง / จัดจำหน่าย", "ร้านสะดวกซื้อ / มินิมาร์ท", "ซูเปอร์มาร์เก็ต / ห้างสรรพสินค้า", "ร้านขายของชำ / โชห่วย", "อีคอมเมิร์ซ / ขายออนไลน์", "ไลฟ์สด / โซเชียลคอมเมิร์ซ", "นำเข้า–ส่งออก", "ตัวแทนจำหน่าย / ดีลเลอร์", "แฟรนไชส์ค้าปลีก", "ร้านวัสดุก่อสร้าง / ฮาร์ดแวร์", "ร้านเครื่องใช้ไฟฟ้า / มือถือ", "ร้านเสื้อผ้า / แฟชั่น", "ร้านทอง / เครื่องประดับ", "ร้านหนังสือ / เครื่องเขียน", "ร้านสัตว์เลี้ยง", "ร้านดอกไม้ / ของขวัญ", "ร้านของเล่น / ของสะสม", "ร้านเฟอร์นิเจอร์ / ของแต่งบ้าน"]],
  ["การผลิตและอุตสาหกรรม", ["ผลิต", "เฟอร์นิเจอร์ / งานไม้", "สิ่งทอ / เครื่องนุ่งห่ม", "เครื่องหนัง / รองเท้า", "พลาสติก / ยาง", "โลหะ / งานเหล็ก / CNC", "ชิ้นส่วนยานยนต์", "อิเล็กทรอนิกส์ / เครื่องใช้ไฟฟ้า", "เคมีภัณฑ์", "เครื่องสำอาง / รับผลิต OEM", "ยาและเวชภัณฑ์", "บรรจุภัณฑ์ / โรงพิมพ์", "เครื่องจักร / อุปกรณ์อุตสาหกรรม", "กระดาษ / เยื่อกระดาษ", "แก้ว / เซรามิก", "อัญมณีและเครื่องประดับ"]],
  ["ก่อสร้าง อสังหาฯ และตกแต่ง", ["ก่อสร้าง / ตกแต่ง", "รับเหมาก่อสร้าง", "ออกแบบสถาปัตยกรรม", "ออกแบบตกแต่งภายใน", "งานระบบ ไฟฟ้า / ประปา / แอร์", "ผลิตวัสดุก่อสร้าง", "พัฒนาอสังหาริมทรัพย์", "นายหน้าอสังหาริมทรัพย์", "บริหารอาคาร / นิติบุคคล", "รีโนเวท / ซ่อมแซมบ้าน", "จัดสวน / ภูมิทัศน์", "งานป้าย / บูธ / ดิสเพลย์"]],
  ["บริการทั่วไป", ["บริการ", "ทำความสะอาด / แม่บ้าน", "รักษาความปลอดภัย", "ซ่อมบำรุง / ช่างทั่วไป", "ซักรีด", "กำจัดปลวก / แมลง", "จัดหางาน / Outsource", "ถ่ายเอกสาร / งานพิมพ์ด่วน", "ให้เช่าอุปกรณ์ / เครื่องมือ"]],
  ["อีเวนต์ การตลาด และสื่อ", ["อีเวนต์ / ออแกไนซ์", "รับจัดงานแต่งงาน", "จัดนิทรรศการ / แสดงสินค้า", "เอเจนซี่โฆษณา / การตลาด", "ดิจิทัลมาร์เก็ตติ้ง", "อินฟลูเอนเซอร์ / ครีเอเตอร์", "โปรดักชันเฮาส์ / วิดีโอ", "ถ่ายภาพ / สตูดิโอ", "ประชาสัมพันธ์ (PR)", "สื่อสิ่งพิมพ์ / สำนักพิมพ์", "วิทยุ / โทรทัศน์ / สื่อออนไลน์", "ดนตรี / ความบันเทิง", "กราฟิกดีไซน์ / แบรนดิ้ง"]],
  ["เทคโนโลยีและดิจิทัล", ["เทคโนโลยี", "พัฒนาซอฟต์แวร์ / แอป", "ออกแบบเว็บไซต์ / UX/UI", "IT Support / ระบบเครือข่าย", "Cloud / Data Center", "AI / Data Analytics", "ไซเบอร์ซีเคียวริตี", "เกม / อีสปอร์ต", "ฟินเทค", "แพลตฟอร์มออนไลน์", "ฮาร์ดแวร์ / IoT", "สตาร์ทอัพ"]],
  ["การเงิน ประกัน และวิชาชีพ", ["ธนาคาร / สถาบันการเงิน", "สินเชื่อ / ลีสซิ่ง", "ประกันภัย / นายหน้าประกัน", "หลักทรัพย์ / การลงทุน", "บัญชี / ตรวจสอบบัญชี", "กฎหมาย / ทนายความ", "ที่ปรึกษาธุรกิจ", "ที่ปรึกษาภาษี", "ทรัพยากรบุคคล / สรรหาบุคลากร", "แปลภาษา", "วิศวกรรม / ที่ปรึกษาโครงการ"]],
  ["สุขภาพและความงาม", ["สุขภาพ / ความงาม", "โรงพยาบาล / คลินิก", "คลินิกทันตกรรม", "คลินิกเสริมความงาม", "ร้านเสริมสวย / ทำผม", "ร้านทำเล็บ", "สปา / นวดแผนไทย", "ฟิตเนส / ยิม / โยคะ", "ร้านขายยา / เวชภัณฑ์", "ดูแลผู้สูงอายุ / ศูนย์ฟื้นฟู", "อาหารเสริม / ผลิตภัณฑ์สุขภาพ", "สัตวแพทย์ / โรงพยาบาลสัตว์", "ห้องแล็บ / ตรวจสุขภาพ"]],
  ["การศึกษาและฝึกอบรม", ["การศึกษา", "โรงเรียน / สถาบันการศึกษา", "กวดวิชา / ติวเตอร์", "สอนภาษา", "อบรม / สัมมนา", "คอร์สออนไลน์", "เนอสเซอรี / อนุบาล", "สอนดนตรี / ศิลปะ / กีฬา", "สถาบันวิชาชีพ / สอนขับรถ"]],
  ["ท่องเที่ยวและที่พัก", ["โรงแรม / รีสอร์ต", "โฮสเทล / เกสต์เฮาส์", "โฮมสเตย์ / ที่พักรายวัน", "บริษัททัวร์ / ตัวแทนท่องเที่ยว", "รถเช่า / รถตู้นำเที่ยว", "สถานที่ท่องเที่ยว / สวนสนุก", "ดำน้ำ / กิจกรรมผจญภัย", "ไกด์ / ล่าม"]],
  ["ขนส่งและโลจิสติกส์", ["ขนส่งสินค้า / รถบรรทุก", "ขนส่งพัสดุ / เมสเซนเจอร์", "คลังสินค้า / Fulfillment", "ชิปปิ้ง / ตัวแทนออกของ", "ขนส่งทางเรือ / ทางอากาศ", "ขนย้ายบ้าน / สำนักงาน", "รถรับส่ง / รถโดยสาร", "เดลิเวอรี / ไรเดอร์"]],
  ["ยานยนต์", ["โชว์รูม / ตัวแทนขายรถ", "รถมือสอง", "อู่ซ่อมรถ / ศูนย์บริการ", "คาร์แคร์ / ล้างรถ", "อะไหล่ / ประดับยนต์", "ยาง / แบตเตอรี่", "รถจักรยานยนต์", "รถยนต์ไฟฟ้า / สถานีชาร์จ"]],
  ["พลังงานและสิ่งแวดล้อม", ["ปั๊มน้ำมัน / ก๊าซ", "โซลาร์เซลล์ / พลังงานแสงอาทิตย์", "พลังงานทดแทน", "ไฟฟ้า / ประปา", "จัดการขยะ / รีไซเคิล", "สิ่งแวดล้อม / บำบัดน้ำ"]],
  ["องค์กรและอื่นๆ", ["หน่วยงานรัฐ / รัฐวิสาหกิจ", "มูลนิธิ / องค์กรไม่แสวงกำไร", "สมาคม / ชมรม", "วิสาหกิจชุมชน / OTOP", "ฟรีแลนซ์ / ธุรกิจส่วนตัว", "อื่นๆ"]],
];
export const businessTypes = businessTypeGroups.flatMap(([, items]) => items);
/** The group a business type belongs to ("" when unknown). */
export const businessGroupOf = (type: string) =>
  businessTypeGroups.find(([, items]) => items.includes(type))?.[0] || "";
/** Filter value from IndustryOptions: "" = all, "group:<name>" = a whole group, else one exact type. */
export const industryMatches = (filter: string, type: string) =>
  !filter || (filter.startsWith("group:") ? businessGroupOf(type) === filter.slice(6) : type === filter);
export const employeeRanges = [
  "1–5 คน",
  "6–20 คน",
  "21–50 คน",
  "51–200 คน",
  "มากกว่า 200 คน",
];
export const companyFields: Field[] = [
  f("logo", "โลโก้บริษัท"),
  f("cover", "รูปปก"),
  f("name", "ชื่อบริษัท (ภาษาไทย)", "text", true),
  f("nameEn", "ชื่อบริษัท (ภาษาอังกฤษ)"),
  f("taxId", "เลขประจำตัวผู้เสียภาษี"),
  f("registration", "เลขทะเบียนบริษัท"),
  f("legal", "ประเภทนิติบุคคล"),
  f("industry", "ประเภทธุรกิจ", "select", false, { options: businessTypes }),
  f("employees", "จำนวนพนักงาน", "select", false, {
    options: employeeRanges,
  }),
  f("founded", "วันที่ก่อตั้ง", "date"),
  f("phone", "โทรศัพท์", "tel"),
  f("email", "อีเมล", "email"),
  f("website", "เว็บไซต์", "url"),
  f("address", "ที่อยู่", "textarea"),
  f("province", "จังหวัด"),
  f("zip", "รหัสไปรษณีย์"),
  f("shipAddress", "ที่อยู่จัดส่ง", "textarea"),
  f("line", "LINE"),
  f("facebook", "Facebook"),
  f("bank", "ธนาคาร"),
  f("bankAccount", "บัญชีบริษัท"),
  f("description", "เกี่ยวกับบริษัท", "textarea"),
];
