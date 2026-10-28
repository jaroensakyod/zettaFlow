// LINE group / Data Template → workspace page. Mirrors ingestion_to_entity() in 0022_department_modules.sql
// (used directly in demo mode): map template keys to page keys, then fill name, required dropdowns and date.
import { catalog } from "./catalog";
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
    if (["lines", "image"].includes(f.type || "text") || f.key === "status" || fields.length >= 20) continue;
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

