// LINE group / Data Template → workspace page. Mirrors ingestion_to_entity() in 0022_department_modules.sql
// (used directly in demo mode): map template keys to page keys, then fill name, required dropdowns and date.
import { catalog, departmentNames } from "./catalog";

// Department names as people type them in a chat (Thai or English) → the department keys records use.
const deptWords: [RegExp, string][] = [
  [/บริการลูกค้า|customers*service|cs/i, "Customer Service"],
  [/พัฒนาธุรกิจ|businesss*dev/i, "Business Development"],
  [/บัญชี|การเงิน|finance|account/i, "Finance"],
  [/บุคคล|บุคลากร|hr/i, "HR"],
  [/คลัง|สต็อก|สต๊อก|warehouse/i, "Warehouse"],
  [/การตลาด|marketing/i, "Marketing"],
  [/ขาย|เซลส์|sales/i, "Sales"],
  [/ไอที|it/i, "IT"],
  [/จัดซื้อ|purchas/i, "Purchasing"],
  [/กฎหมาย|legal/i, "Legal"],
  [/ออกแบบ|ดีไซน์|design/i, "Design"],
  [/ข้อมูล|data/i, "Data"],
  [/อีเวนต์|อีเว้นท์|event/i, "Event"],
  [/บริหาร|ธุรการ|admin/i, "Admin"],
  [/ปฏิบัติการ|operation/i, "Operations"],
];
/** "การตลาด", "ฝ่ายบัญชี", "marketing" → Marketing / Finance …; anything unknown → fallback. */
export function normalizeDepartment(value: unknown, fallback: string) {
  const s = String(value ?? "").trim();
  if (!s) return fallback;
  const exact = departmentNames.find((d) => d.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const hit = deptWords.find(([re, key]) => departmentNames.includes(key) && re.test(s));
  return hit ? hit[1] : fallback;
}
import type { Template } from "./types";

export function mapToTarget(
  t: Pick<Template, "name" | "fields"> & { target_kind?: string | null; field_map?: Record<string, string> },
  values: Record<string, unknown>,
  createdAt: string,
  /** Looks up a linked record (customer, employee …) by the name sent from LINE. */
  resolve: (resource: string, name: string) => string | undefined = () => undefined,
) {
  const page = t.target_kind ? catalog[t.target_kind] : undefined;
  if (!page) return null;
  const keys = new Set(page.fields.map((f) => f.key));
  const d: Record<string, unknown> = {};
  for (const f of t.fields) {
    const to = t.field_map?.[f.key] || f.key;
    const v = values[f.key];
    if (v !== null && v !== undefined && keys.has(to)) d[to] = v;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const f of page.fields)
    if (f.type === "relation" && typeof d[f.key] === "string" && !uuid.test(String(d[f.key]))) {
      const id = resolve(f.resource!, String(d[f.key]).trim());
      if (id) d[f.key] = id;
      else delete d[f.key];
    }
  // A department typed in Thai (การตลาด) is stored as its key (Marketing).
  if (keys.has("department") && d.department !== undefined) d.department = normalizeDepartment(d.department, page.department);
  const local = new Date(Date.parse(createdAt) + 7 * 3600000).toISOString();
  if (!d.name) d.name = `${t.name} ${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}`.slice(0, 200);
  for (const f of page.fields)
    if (f.type === "select" && f.required && !f.options?.includes(String(d[f.key])))
      d[f.key] = f.options?.includes("อื่นๆ") ? "อื่นๆ" : f.options?.[0];
  if (page.fields.some((f) => f.key === "date" && f.type === "date") && !d.date)
    d.date = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  return { kind: page.key, department: page.department, data: d };
}

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).replace(/[^a-z0-9_]/g, "").replace(/^[^a-z]+/, "f_").slice(0, 40);
/** Template whose fields mirror a page (relations, item lists and photos are left for the web form). */
export function templateForPage(kind: string) {
  const page = catalog[kind];
  const fields: Template["fields"] = [];
  const map: Record<string, string> = {};
  for (const f of page.fields) {
    // status is set by the approval; color is picked on the calendar, never typed into a chat.
    if (["lines", "image"].includes(f.type || "text") || f.key === "status" || f.key === "color" || fields.length >= 20) continue;
    const key = snake(f.key);
    const choice = f.type === "select" && (f.options?.length || 0) >= 2 && (f.options?.length || 0) <= 20;
    fields.push({
      key,
      label: f.type === "relation" ? f.label + " (ชื่อ)" : f.label,
      type: f.type === "number" ? "number" : f.type === "date" ? "date" : choice ? "choice" : "text",
      required: !!f.required && f.type !== "select",
      ...(choice ? { options: f.options } : {}),
    });
    map[key] = f.key;
  }
  return { template: { name: page.label + " (จาก LINE)", department: page.department, fields, steps: [] }, map };
}

