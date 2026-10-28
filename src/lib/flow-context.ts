// What น้องโฟลว์ knows when it answers a free question: a compact, plain-text snapshot of the company
// built from the records this user may read. Numbers are worked out here, so the model only explains them.
import { allEntities } from "./data";
import { catalog } from "./catalog";
import type { Context, Entity } from "./types";

const baht = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
const num = (v: unknown) => Number(v || 0);
const sum = (rows: Entity[], key = "amount") => rows.reduce((s, r) => s + num(r.data[key]), 0);

/** The snapshot text, plus the open tasks it lists as T1, T2… so a reply can point at one without seeing ids. */
/**
 * The snapshot text, plus the open tasks it lists as T1, T2… so a reply can point at one without seeing ids.
 * `focus` (the question and recent chat) picks which pages are listed row by row; every other page gets a one-line
 * count, which keeps a question to a few thousand tokens instead of the whole company.
 */
export async function businessSnapshot(ctx: Context, focus = "", now = Date.now()): Promise<{ text: string; tasks: Map<string, Entity> }> {
  const day = (n: number) => new Date(now + 7 * 3600000 + n * 864e5).toISOString().slice(0, 10);
  const today = day(0),
    monthStart = today.slice(0, 8) + "01",
    lastMonth = day(-31).slice(0, 7);
  const days = (iso: unknown) => Math.round((Date.parse(String(iso) + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5);
  const kinds = [
    "sales", "expenses", "invoices", "bills", "products", "tasks", "leads", "quotations", "projects", "customers",
    "suppliers", "sales_targets", "campaigns", "attendance", "leaves", "recruitment", "software", "vehicles", "contracts", "tickets",
    "events", "employees",
  ] as const;
  const all = Object.fromEntries(
    await Promise.all(kinds.map(async (k) => [k, await allEntities(ctx, k).catch(() => [] as Entity[])] as const)),
  ) as Record<(typeof kinds)[number], Entity[]>;
  const nameOf = (kind: "customers" | "suppliers" | "projects", id: unknown) =>
    String(all[kind].find((e) => e.id === id)?.data.name || "-");
  const out: string[] = [`วันนี้ ${today} (บริษัท ${ctx.company.name})`];

  const sales = all.sales.filter((r) => r.data.status === "confirmed");
  if (sales.length) {
    const inRange = (a: string, b: string) => sales.filter((r) => String(r.data.date) >= a && String(r.data.date) <= b);
    const byChannel = new Map<string, number>();
    for (const r of inRange(monthStart, today)) byChannel.set(String(r.data.channel || "อื่นๆ"), (byChannel.get(String(r.data.channel || "อื่นๆ")) || 0) + num(r.data.amount));
    out.push(
      `ยอดขายยืนยัน: เดือนนี้ ${baht(sum(inRange(monthStart, today)))} · เดือนก่อน (${lastMonth}) ${baht(sum(sales.filter((r) => String(r.data.date).startsWith(lastMonth))))} · 7 วันล่าสุด ${baht(sum(inRange(day(-6), today)))} เทียบ 7 วันก่อนหน้า ${baht(sum(inRange(day(-13), day(-7))))}`,
      "ยอดขายเดือนนี้ตามช่องทาง: " + [...byChannel].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${baht(v)}`).join(", "),
    );
  }
  if (all.expenses.length) {
    const month = all.expenses.filter((r) => String(r.data.date) >= monthStart && ["approved", "paid"].includes(String(r.data.status)));
    const byCat = new Map<string, number>();
    for (const r of month) byCat.set(String(r.data.category), (byCat.get(String(r.data.category)) || 0) + num(r.data.amount));
    const pending = all.expenses.filter((r) => r.data.status === "pending");
    out.push(
      `ค่าใช้จ่ายอนุมัติเดือนนี้ ${baht(sum(month))}: ` + [...byCat].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${baht(v)}`).join(", "),
      `ค่าใช้จ่ายรออนุมัติ ${pending.length} รายการ รวม ${baht(sum(pending))}`,
    );
  }
  if (all.invoices.length) {
    const open = all.invoices.filter((r) => r.data.status !== "paid");
    const owed = (r: Entity) => num(r.data.total) - num(r.data.paid);
    const late = open.filter((r) => String(r.data.dueDate) < today).sort((a, b) => String(a.data.dueDate).localeCompare(String(b.data.dueDate)));
    out.push(
      `ลูกหนี้ค้างรับทั้งหมด ${open.length} ใบ ${baht(open.reduce((s, r) => s + owed(r), 0))} · เลยกำหนด ${late.length} ใบ ${baht(late.reduce((s, r) => s + owed(r), 0))}`,
      ...late.slice(0, 8).map((r) => `  - ${r.data.name} ${nameOf("customers", r.data.customerId)} ค้าง ${baht(owed(r))} เลยกำหนด ${-days(r.data.dueDate)} วัน`),
    );
  }
  const bills = all.bills.filter((r) => r.data.status !== "จ่ายแล้ว");
  if (bills.length)
    out.push(
      `เจ้าหนี้ (บิลรอจ่าย/รอตรวจ) ${bills.length} ใบ ${baht(sum(bills))}`,
      ...bills.sort((a, b) => String(a.data.dueDate).localeCompare(String(b.data.dueDate))).slice(0, 6).map((r) => `  - ${r.data.name} ${nameOf("suppliers", r.data.supplierId)} ${baht(num(r.data.amount))} ครบกำหนด ${r.data.dueDate} (${r.data.status})`),
    );
  const low = all.products.filter((r) => num(r.data.stock) <= num(r.data.reorderLevel));
  if (all.products.length)
    out.push(
      `สินค้า ${all.products.length} รายการ มูลค่าสต็อกตามทุน ${baht(all.products.reduce((s, r) => s + num(r.data.stock) * num(r.data.cost), 0))} · ถึงจุดสั่งซื้อ ${low.length} รายการ`,
      ...low.map((r) => `  - ${r.data.name} (${r.data.sku}) เหลือ ${num(r.data.stock)} จุดสั่งซื้อ ${num(r.data.reorderLevel)}`),
    );
  const openTasks = all.tasks
    .filter((r) => r.data.status !== "done")
    .sort((a, b) => String(a.data.dueDate || "9999").localeCompare(String(b.data.dueDate || "9999")));
  const tasks = new Map<string, Entity>();
  if (openTasks.length)
    out.push(
      `งาน/นัดหมายที่ยังไม่เสร็จ ${openTasks.length} รายการ · เลยกำหนด ${openTasks.filter((r) => r.data.dueDate && days(r.data.dueDate) < 0).length} (อ้างถึงงานด้วยรหัส T#):`,
      ...openTasks.slice(0, 40).map((r, i) => {
        tasks.set("T" + (i + 1), r);
        const due = r.data.dueDate
          ? days(r.data.dueDate) < 0 ? `เลยกำหนด ${-days(r.data.dueDate)} วัน (${r.data.dueDate})` : `ครบ ${r.data.dueDate}`
          : "ไม่มีกำหนด";
        return `  - T${i + 1} ${r.data.name} | ${r.data.department} | ${r.data.assignee || "ยังไม่มอบหมาย"} | ${due} | ${r.data.priority}/${r.data.status}${r.data.notes ? " | " + String(r.data.notes).slice(0, 80) : ""}`;
      }),
    );
  if (all.leads.length) {
    const stages = new Map<string, { n: number; v: number }>();
    for (const r of all.leads) {
      const s = stages.get(String(r.data.stage)) || { n: 0, v: 0 };
      stages.set(String(r.data.stage), { n: s.n + 1, v: s.v + num(r.data.amount) });
    }
    out.push("Pipeline ขาย: " + [...stages].map(([s, x]) => `${s} ${x.n} ดีล ${baht(x.v)}`).join(", "));
  }
  const sentQt = all.quotations.filter((r) => r.data.status === "ส่งแล้ว");
  if (sentQt.length) out.push(`ใบเสนอราคารอลูกค้าตอบ ${sentQt.length} ใบ: ` + sentQt.map((r) => `${r.data.name} ${nameOf("customers", r.data.customerId)}`).join(", "));
  const targets = all.sales_targets.filter((r) => r.data.month === today.slice(0, 7));
  if (targets.length) out.push("เป้าขายเดือนนี้: " + targets.map((r) => `${r.data.name} ${baht(num(r.data.actual))}/${baht(num(r.data.target))} (${Math.round((num(r.data.actual) / Math.max(1, num(r.data.target))) * 100)}%)`).join(", "));
  const projects = all.projects.filter((r) => ["planning", "active", "review"].includes(String(r.data.status)));
  if (projects.length)
    out.push("โครงการที่ดำเนินการ: " + projects.map((r) => {
      const spent = all.expenses.filter((e) => e.data.projectId === r.id && ["approved", "paid"].includes(String(e.data.status)));
      return `${r.data.name} [${r.data.status}] งบ ${baht(num(r.data.budget))} ใช้ไป ${baht(sum(spent))} สิ้นสุด ${r.data.endDate}`;
    }).join("; "));
  const running = all.campaigns.filter((r) => r.data.status === "running");
  if (running.length) out.push("แคมเปญที่กำลังรัน: " + running.map((r) => `${r.data.name} งบ ${baht(num(r.data.budget))} รายได้ ${baht(num(r.data.revenue))}`).join(", "));
  const att = all.attendance.filter((r) => r.data.date === today);
  if (att.length || all.leaves.length || all.recruitment.length) {
    const names = (status: string) => att.filter((r) => r.data.status === status).map((r) => r.data.name).join(", ") || "-";
    const onLeave = all.leaves.filter(
      (r) => r.data.status === "approved" && String(r.data.startDate) <= today && String(r.data.endDate || r.data.startDate) >= today,
    );
    out.push(
      `HR วันนี้: พนักงานทั้งหมด ${all.employees.filter((r) => r.data.status !== "inactive").length} คน · มาทำงาน ${att.filter((r) => !["ลา", "ขาด"].includes(String(r.data.status))).length} คน · สาย: ${names("สาย")} · ลา: ${names("ลา")}${onLeave.length ? " (" + onLeave.map((r) => r.data.type).join(", ") + ")" : ""} · ขาด: ${names("ขาด")} · นอกสถานที่: ${names("ทำงานนอกสถานที่")}`,
      `ใบลารออนุมัติ: ${all.leaves.filter((r) => r.data.status === "pending").map((r) => `${r.data.name} ${r.data.startDate}–${r.data.endDate}`).join(", ") || "-"} · ผู้สมัครที่กำลังดำเนินการ ${all.recruitment.filter((r) => !["รับเข้าทำงาน", "ไม่ผ่าน"].includes(String(r.data.status))).length} คน`,
    );
  }
  const events = all.events
    .filter((r) => r.data.status !== "cancelled")
    .sort((a, b) => String(a.data.startDate).localeCompare(String(b.data.startDate)));
  if (events.length)
    out.push(
      "อีเวนต์:",
      ...events.map(
        (r) =>
          `  - ${r.data.name} | ${r.data.startDate}${r.data.endDate && r.data.endDate !== r.data.startDate ? "–" + r.data.endDate : ""} | ${r.data.location || "-"} | ${r.data.status} | งบ ${baht(num(r.data.budget))} | ผู้ดูแล ${r.data.owner || "-"}`,
      ),
    );
  // Contact book. allEntities is permission-filtered, so staff details only reach people who may read HR.
  if (all.employees.length)
    out.push(
      "รายชื่อพนักงาน (ชื่อ (ชื่อเล่น) | แผนก | ตำแหน่ง | โทร | อีเมล):",
      ...all.employees
        .slice(0, 60)
        .map((r) => `  - ${r.data.name}${r.data.nickname ? ` (${r.data.nickname})` : ""} | ${r.data.department} | ${r.data.position || "-"} | ${r.data.phone || "-"} | ${r.data.email || "-"}`),
    );
  if (all.customers.length)
    out.push(
      "ผู้ติดต่อลูกค้า (บริษัท | ผู้ติดต่อ | โทร):",
      ...all.customers.slice(0, 40).map((r) => `  - ${r.data.name} | ${r.data.contact || "-"} | ${r.data.phone || "-"}${r.data.segment === "vip" ? " | VIP" : ""}`),
    );
  const expiring = [
    ...all.software.map((r) => [r.data.name, r.data.expiryDate, "ซอฟต์แวร์"]),
    ...all.vehicles.flatMap((r) => [[`ภาษีรถ ${r.data.name}`, r.data.taxExpiry, "รถ"], [`ประกันรถ ${r.data.name}`, r.data.insuranceExpiry, "รถ"]]),
    ...all.contracts.filter((r) => r.data.status === "signed").map((r) => [r.data.name, r.data.endDate, "สัญญา"]),
  ].filter(([, d]) => d && days(d) >= 0 && days(d) <= 30);
  if (expiring.length) out.push("ใกล้หมดอายุใน 30 วัน: " + expiring.map(([n, d]) => `${n} (${d})`).join(", "));
  const tickets = all.tickets.filter((r) => ["open", "progress"].includes(String(r.data.status)));
  if (tickets.length) out.push(`เคส IT/บริการลูกค้าที่เปิดอยู่ ${tickets.length}: ` + tickets.map((r) => `${r.data.name} [${r.data.priority}]`).join(", "));
  // Every other page the user may read, as compact rows, so any department question has data behind it.
  const covered = new Set<string>(["sales", "expenses", "attendance", "tasks", "employees", "customers"]);
  const rest = Object.keys(catalog).filter((k) => !covered.has(k));
  const lists = await Promise.all(rest.map(async (k) => [k, k in all ? all[k as keyof typeof all] : await allEntities(ctx, k, 200).catch(() => [] as Entity[])] as const));
  const names = new Map<string, string>();
  for (const rows of [...Object.values(all), ...lists.map(([, r]) => r)]) for (const e of rows) names.set(e.id, String(e.data.name || e.data.sku || ""));
  const wanted = relevantKinds(focus);
  for (const [kind, rows] of lists) {
    if (!rows.length) continue;
    const m = catalog[kind];
    const statuses = new Map<string, number>();
    for (const r of rows) if (r.data.status) statuses.set(String(r.data.status), (statuses.get(String(r.data.status)) || 0) + 1);
    out.push(
      `หน้า${m.label} (${rows.length} รายการ${statuses.size ? "; " + [...statuses].map(([s, n]) => `${s} ${n}`).join(", ") : ""}):`,
      ...(wanted.has(kind) ? rows.slice(0, 20).map((r) => "  - " + rowText(kind, r.data, names)) : []),
    );
  }
  return { text: out.join("\n"), tasks };
}

// Words people use for each department and page, beyond the page titles themselves.
const deptWords: Record<string, string[]> = {
  Sales: ["ขาย", "ลูกค้า", "ใบเสนอ", "เสนอราคา", "ดีล", "pipeline", "เป้า", "so", "ออเดอร์", "คำสั่งซื้อ"],
  Marketing: ["การตลาด", "แคมเปญ", "คอนเทนต์", "โฆษณา", "โซเชียล", "social", "tiktok", "facebook", "โปรโมชัน", "โปร", "งบการตลาด", "reach"],
  Warehouse: ["คลัง", "สต็อก", "สินค้า", "เบิก", "ตรวจนับ", "ของ"],
  Purchasing: ["จัดซื้อ", "ซื้อ", "po", "ซัพพลายเออร์", "supplier", "ผู้ขาย"],
  Finance: ["บัญชี", "การเงิน", "ใบแจ้งหนี้", "invoice", "ลูกหนี้", "เจ้าหนี้", "บิล", "จ่าย", "ชำระ", "ภาษี", "vat", "เงิน", "รายรับ", "ค่าใช้จ่าย"],
  HR: ["hr", "บุคคล", "พนักงาน", "เงินเดือน", "ค่าจ้าง", "ลา", "สาย", "kpi", "okr", "ประเมิน", "สมัคร", "สัมภาษณ์", "ฟรีแลนซ์", "คน"],
  Event: ["อีเวนต์", "อีเว้น", "event", "งาน expo", "แขก", "ผู้เข้าร่วม", "สถานที่", "บูธ", "เวที"],
  IT: ["it", "ไอที", "คอม", "ซอฟต์แวร์", "software", "ระบบ", "ความปลอดภัย", "security", "license", "ไลเซนส์", "เคส", "แจ้งซ่อม", "ticket"],
  "Customer Service": ["ร้องเรียน", "เคสลูกค้า", "บริการลูกค้า"],
  Legal: ["กฎหมาย", "สัญญา", "นโยบาย", "คดี", "ข้อพิพาท", "เครื่องหมายการค้า", "ลิขสิทธิ์", "pdpa", "ทนาย"],
  Admin: ["ธุรการ", "รถ", "ยานพาหนะ", "ทะเบียน", "ประกัน", "ซ่อม", "แม่บ้าน", "ห้องประชุม", "บริการทั่วไป", "เอกสาร"],
  Operations: ["โครงการ", "project", "ทรัพย์สิน", "asset", "อุปกรณ์", "อีเวนต์"],
  "Business Development": ["ดีล", "พื้นที่", "ห้าง", "สาขา", "dealer", "pop-up", "ค่าเช่า"],
};
/** Pages whose title or department words appear in the question / recent chat. */
function relevantKinds(focus: string) {
  const q = focus.toLowerCase();
  const out = new Set<string>();
  if (!q.trim()) return out;
  for (const [kind, m] of Object.entries(catalog)) {
    const titleWords = m.label.toLowerCase().split(/[s&/()]+/).filter((w) => w.length >= 2);
    if (titleWords.some((w) => q.includes(w)) || (deptWords[m.department] || []).some((w) => q.includes(w))) out.add(kind);
  }
  return out;
}

/** One record as "label: value; …" — short fields only, related records by name, computed columns included. */
function rowText(kind: string, d: Record<string, unknown>, names: Map<string, string>) {
  const m = catalog[kind];
  const parts: string[] = [];
  for (const f of m.fields) {
    const v = d[f.key];
    if (v === undefined || v === null || v === "" || f.type === "image" || f.type === "lines" || f.hidden) continue;
    if (f.type === "relation") {
      const n = names.get(String(v));
      if (n) parts.push(`${f.label}: ${n}`);
    } else if (f.type === "number") parts.push(`${f.label}: ${Number(v).toLocaleString("th-TH")}`);
    else parts.push(`${f.key === "name" ? "" : f.label + ": "}${String(v).replace(/\s+/g, " ").slice(0, f.type === "textarea" ? 80 : 60)}`);
  }
  for (const [k, c] of Object.entries(m.computed || {})) parts.push(`${c.label}: ${c.calc(d).toLocaleString("th-TH")}`);
  if (kind === "invoices" && d.total !== undefined) parts.push(`ยอดรวม: ${num(d.total).toLocaleString("th-TH")}`, `รับแล้ว: ${num(d.paid).toLocaleString("th-TH")}`);
  if (kind === "products" && d.stock !== undefined) parts.push(`คงเหลือ: ${num(d.stock).toLocaleString("th-TH")}`);
  if (kind === "payroll" && d.net !== undefined) parts.push(`สุทธิ: ${num(d.net).toLocaleString("th-TH")}`);
  return parts.join("; ").slice(0, 260);
}
