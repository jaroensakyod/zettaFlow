import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Company,
  Member,
  Entity,
  Template,
  Ingestion,
  Message,
  Attachment,
  Context,
  DesignRevision,
  DesignComment,
  ProjectStage,
  StageHistory,
  StockTransfer,
  ProjectInventory,
} from "./types";
import { AppError, assert, stockDelta, validateValues } from "./domain";
export const demoEnabled = () =>
  process.env.ELITEFLOW_DEMO_MODE === "true" && !process.env.VERCEL;
/** Public read-only showcase (/demo). Same sample data, held in memory, never written. */
export const publicDemoAllowed = () => process.env.PUBLIC_DEMO !== "false";
export const PUBLIC_DEMO_COOKIE = "ef_demo";
let showcase: DemoState | null = null;
function showcaseState(): DemoState {
  if (!showcase) {
    // Deterministic ids so every serverless instance serves identical records.
    let n = 0;
    showcase = seedDemo(
      () => "20000000-0000-4000-8000-" + String(++n).padStart(12, "0"),
    );
  }
  return structuredClone(showcase);
}
export const READ_ONLY_DEMO =
  "นี่คือระบบตัวอย่าง (อ่านอย่างเดียว) — สมัครใช้งานฟรีเพื่อบันทึกข้อมูลจริง";
export type DemoState = {
  transfers?: StockTransfer[];
  projectInventory?: ProjectInventory[];
  stages?: ProjectStage[];
  stageHistory?: StageHistory[];
  designs?: DesignRevision[];
  designComments?: DesignComment[];
  company: Company;
  members: Member[];
  entities: Entity[];
  templates: Template[];
  ingestions: Ingestion[];
  messages: Message[];
  attachments: Attachment[];
  audit: {
    id: string;
    action: string;
    target: string;
    actor: string;
    created_at: string;
  }[];
  movements: {
    id: string;
    product_id: string;
    type: string;
    quantity: number;
    reference: string;
    notes?: string;
    created_at: string;
  }[];
  invites: Record<string, unknown>[];
};
const companyId = "10000000-0000-4000-8000-000000000001",
  userId = "10000000-0000-4000-8000-000000000002";
const timestamp = () => new Date().toISOString();
const uid = () => randomUUID();
export function seedDemo(makeId: () => string = uid): DemoState {
  const entities: Entity[] = [];
  const add = (
    kind: string,
    department: string,
    data: Record<string, unknown>,
  ) => {
    const id = makeId();
    entities.push({
      id,
      kind,
      department,
      data,
      company_id: companyId,
      created_by: userId,
      created_at: timestamp(),
      updated_at: timestamp(),
      version: 1,
      archived_at: null,
    });
    return id;
  };
  const supplier = add("suppliers", "Purchasing", {
    name: "Siri Supplies (ตัวอย่าง)",
    contact: "ทีมจัดซื้อ",
    phone: "02-000-0000",
    status: "active",
  });
  const customer = add("customers", "Sales", {
    name: "บริษัทตัวอย่าง",
    code: "CUS-001",
    contact: "ผู้ประสานงาน",
    phone: "02-000-0000",
    status: "active",
  });
  const project = add("projects", "Operations", {
    name: "The Promenade",
    code: "PRJ-001",
    owner: "Siri",
    priority: "high",
    startDate: "2026-10-16",
    endDate: "2026-10-28",
    budget: 150000,
    status: "active",
  });
  add("dealers", "Business Development", {
    name: "The Promenade",
    branch: "เดอะพรอมานาด",
    province: "กรุงเทพฯ",
    status: "active",
  });
  add("deals", "Business Development", {
    name: "The Promenade / Pop-up",
    projectId: project,
    location: "G Floor",
    area: 33,
    rent: 55000,
    gp: 22,
    startDate: "2026-10-16",
    endDate: "2026-10-28",
    status: "pending",
  });
  const product = add("products", "Warehouse", {
    name: "เสื้อรุ่น A",
    sku: "SHIRT-A",
    unit: "ตัว",
    cost: 190,
    price: 590,
    stock: 80,
    reorderLevel: 20,
    status: "active",
  });
  add("products", "Warehouse", {
    name: "กางเกงรุ่น 01",
    sku: "PANTS-01",
    unit: "ตัว",
    cost: 290,
    price: 890,
    stock: 8,
    reorderLevel: 15,
    status: "active",
  });
  add("purchases", "Purchasing", {
    name: "PO-001",
    supplierId: supplier,
    productId: product,
    quantity: 100,
    unitCost: 190,
    total: 19000,
    orderDate: "2026-10-12",
    status: "draft",
  });
  add("sales", "Sales", {
    name: "ยอดขายหน้าร้าน",
    projectId: project,
    customerId: customer,
    date: "2026-10-12",
    amount: 58420,
    status: "confirmed",
  });
  add("expenses", "Finance", {
    name: "ค่าเช่าพื้นที่",
    projectId: project,
    date: "2026-10-12",
    category: "ค่าเช่า",
    amount: 55000,
    status: "approved",
  });
  add("tasks", "Design", {
    name: "เขียนแบบ / Perspective",
    projectId: project,
    department: "Design",
    assignee: "ทีม Design",
    dueDate: "2026-10-15",
    priority: "high",
    status: "progress",
  });
  add("employees", "HR", {
    name: "พนักงานตัวอย่าง",
    code: "EMP-001",
    department: "Sales",
    position: "Sales Coordinator",
    employmentType: "ประจำ",
    salary: 25000,
    status: "active",
  });
  const template: Template = {
    id: makeId(),
    company_id: companyId,
    name: "อนุมัติพื้นที่ขาย",
    department: "Business Development",
    version: 1,
    fields: [
      { key: "project", label: "โครงการ", type: "text", required: true },
      { key: "location", label: "สถานที่", type: "text", required: true },
      { key: "rent", label: "ค่าเช่า", type: "number", required: true },
      { key: "start", label: "วันเริ่ม", type: "date", required: true },
      { key: "end", label: "วันสิ้นสุด", type: "date", required: true },
    ],
    steps: [
      { name: "เขียนแบบ / Perspective", department: "Design" },
      { name: "ขอใบเสนอราคา", department: "Purchasing" },
      { name: "เตรียมสินค้า", department: "Warehouse" },
      { name: "เตรียมสื่อ", department: "Marketing" },
      { name: "วางแผนการขาย", department: "Sales" },
    ],
  };
  const delivery: Template = {
    id: makeId(),
    company_id: companyId,
    name: "ฟอร์มตรวจคลัง",
    department: "Warehouse",
    version: 1,
    fields: [
      { key: "supplier", label: "ซัพพลายเออร์", type: "text", required: true },
      { key: "total", label: "ยอดรวม", type: "number", required: true },
      { key: "vehicle", label: "ประเภทรถ", type: "choice", required: false, options: ["6 ล้อ", "กระบะ", "มอเตอร์ไซค์"] },
    ],
    steps: [],
  };
  const deliveries: Ingestion[] = [
    ["Siam Display", 18500, "6 ล้อ"],
    ["Hanger Pro", 4200, "กระบะ"],
    ["Mannequin TH", 9600, "กระบะ"],
    ["Label Co.", 1200, "มอเตอร์ไซค์"],
  ].map(([supplier, total, vehicle]) => ({
    id: makeId(),
    company_id: companyId,
    template: delivery,
    raw: `ซัพพลายเออร์: ${supplier}
ยอดรวม: ${total}
ประเภทรถ: ${vehicle}`,
    values: { supplier, total, vehicle },
    missing: [],
    status: "approved",
    source: "LINE",
    engine: "explicit-fields",
    created_at: timestamp(),
  }));
  return {
    company: {
      id: companyId,
      name: "Siri Studio · Demo",
      profile: { name: "Siri Studio · Demo", industry: "Retail & Events" },
      settings: { theme: "violet" },
    },
    members: [
      {
        id: makeId(),
        company_id: companyId,
        user_id: userId,
        name: "Siri (Demo)",
        email: "demo@eliteflow.test",
        role: "owner",
        departments: [],
        disabled: false,
      },
    ],
    entities,
    templates: [template, delivery],
    ingestions: deliveries,
    messages: [],
    attachments: [],
    audit: [],
    movements: [],
    invites: [],
  };
}
const file = () =>
  join(
    process.cwd(),
    ".data",
    (process.env.DEMO_DATA_FILE || "eliteflow-demo.json").replace(
      /[^a-zA-Z0-9_.-]/g,
      "_",
    ),
  );
let chain: Promise<unknown> = Promise.resolve();
let initializing: Promise<void> | null = null;
async function saveFile(s: DemoState) {
  const target = file(),
    temporary = target + "." + uid() + ".tmp";
  await writeFile(temporary, JSON.stringify(s));
  await rename(temporary, target);
}
export async function demoRead(): Promise<DemoState> {
  if (!demoEnabled()) {
    assert(publicDemoAllowed(), "โหมด demo ใช้ได้เฉพาะเครื่อง local", 403);
    return showcaseState();
  }
  try {
    return JSON.parse(await readFile(file(), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    if (!initializing)
      initializing = (async () => {
        await mkdir(resolve(".data"), { recursive: true });
        await saveFile(seedDemo());
      })().finally(() => {
        initializing = null;
      });
    await initializing;
    return JSON.parse(await readFile(file(), "utf8"));
  }
}
export function demoMutate<T>(fn: (s: DemoState) => T): Promise<T> {
  if (!demoEnabled()) return Promise.reject(new AppError(READ_ONLY_DEMO, 403));
  const task = chain.then(async () => {
    const s = await demoRead();
    const result = fn(s);
    await saveFile(s);
    return result;
  });
  chain = task.catch(() => {});
  return task;
}
export async function demoContext(): Promise<Context> {
  const s = await demoRead(),
    m = s.members[0];
  return {
    user: { id: m.user_id, email: m.email, name: m.name },
    member: m,
    company: s.company,
    demo: true,
  };
}
export function demoAudit(s: DemoState, action: string, target: string) {
  s.audit.unshift({
    id: uid(),
    action,
    target,
    actor: userId,
    created_at: timestamp(),
  });
}
export function demoMovement(
  s: DemoState,
  productId: string,
  type: string,
  quantity: number,
  reference: string,
  notes = "",
) {
  const product = s.entities.find(
    (e) => e.id === productId && e.kind === "products" && !e.archived_at,
  );
  assert(product, "ไม่พบสินค้า", 404);
  if (
    s.movements.some(
      (m) => m.reference === reference && m.product_id === productId,
    )
  )
    throw new AppError("รายการนี้บันทึกแล้ว", 409);
  product.data.stock = stockDelta(
    Number(product.data.stock || 0),
    type,
    quantity,
  );
  product.version++;
  product.updated_at = timestamp();
  s.movements.unshift({
    id: uid(),
    product_id: productId,
    type,
    quantity,
    reference,
    notes,
    created_at: timestamp(),
  });
  demoAudit(s, "stock_" + type, productId);
}
export function demoApprove(
  s: DemoState,
  id: string,
  values: Record<string, unknown>,
  status: string,
  reason: string,
) {
  const item = s.ingestions.find((i) => i.id === id);
  assert(item, "ไม่พบรายการ", 404);
  assert(item.status === "review", "รายการนี้ตัดสินแล้ว", 409);
  assert(["approved", "rejected"].includes(status), "สถานะไม่ถูกต้อง");
  if (status === "approved") {
    const checked = validateValues(item.template, values, true);
    item.values = checked.values;
    item.missing = [];
    let projectId: string | null = null;
    const v = checked.values;
    const start = item.template.fields.some(
        (f) => f.key === "start" && f.type === "date",
      )
        ? v.start
        : null,
      end = item.template.fields.some(
        (f) => f.key === "end" && f.type === "date",
      )
        ? v.end
        : null;
    if (start && end)
      assert(String(end) >= String(start), "ช่วงวันที่โครงการไม่ถูกต้อง");
    if (
      item.template.steps.length &&
      typeof v.project_id === "string" &&
      v.project_id
    ) {
      const project = s.entities.find(
        (e) => e.id === v.project_id && e.kind === "projects" && !e.archived_at,
      );
      assert(project, "โครงการอ้างอิงไม่อยู่ในบริษัทนี้");
      projectId = project.id;
    } else if (
      item.template.steps.length &&
      typeof v.project === "string" &&
      v.project.trim()
    ) {
      assert(v.project.trim().length <= 500, "ชื่อโครงการยาวเกินไป");
      const matches = s.entities.filter(
        (e) =>
          e.kind === "projects" &&
          !e.archived_at &&
          String(e.data.name).toLowerCase() ===
            String(v.project).trim().toLowerCase(),
      );
      assert(matches.length <= 1, "พบชื่อโครงการซ้ำ กรุณาระบุ project_id");
      projectId = matches[0]?.id || uid();
      if (!matches.length)
        s.entities.unshift({
          id: projectId,
          kind: "projects",
          department: "Operations",
          company_id: companyId,
          data: {
            name: v.project,
            status: "active",
            priority: "normal",
            budget: typeof v.rent === "number" ? Math.max(0, v.rent) : 0,
            startDate: start || null,
            endDate: end || null,
            ingestionId: item.id,
          },
          created_by: userId,
          created_at: timestamp(),
          updated_at: timestamp(),
          version: 1,
          archived_at: null,
        });
    }
    if (
      item.template.steps.length &&
      item.template.department === "Business Development" &&
      typeof v.rent === "number" &&
      typeof v.location === "string"
    ) {
      assert(v.rent >= 0, "ค่าเช่าต้องไม่ติดลบ");
      s.entities.unshift({
        id: uid(),
        kind: "deals",
        department: "Business Development",
        company_id: companyId,
        data: {
          name: v.project || item.template.name,
          location: v.location,
          rent: v.rent,
          projectId,
          startDate: start || null,
          endDate: end || null,
          status: "approved",
          ingestionId: item.id,
        },
        created_by: userId,
        created_at: timestamp(),
        updated_at: timestamp(),
        version: 1,
        archived_at: null,
      });
    }
    for (const step of item.template.steps)
      s.entities.unshift({
        id: uid(),
        kind: "tasks",
        company_id: companyId,
        department: step.department,
        data: {
          name: step.name,
          department: step.department,
          notes: String(item.values.project || item.template.name),
          projectId,
          status: "pending",
          priority: "normal",
        },
        created_by: userId,
        created_at: timestamp(),
        updated_at: timestamp(),
        version: 1,
        archived_at: null,
      });
  } else assert(reason?.trim(), "กรอกเหตุผลที่ไม่อนุมัติ");
  item.status = status as Ingestion["status"];
  item.error = reason || undefined;
  demoAudit(s, status, item.id);
}
