import { z } from "zod";
import { catalog, type Field } from "./catalog";
import type { Context, Entity, Template } from "./types";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assert(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new AppError(message, status);
}
export function canRead(ctx: Context, department: string) {
  return (
    ctx.member.role === "owner" || ctx.member.departments.includes(department)
  );
}
export function canWrite(ctx: Context, department: string) {
  return ctx.member.role !== "viewer" && canRead(ctx, department);
}
export function requireOwner(ctx: Context) {
  assert(ctx.member.role === "owner", "เฉพาะเจ้าของบริษัท", 403);
}
export function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
function fieldSchema(f: Field) {
  if (f.type === "number")
    return (
      f.min !== undefined ? z.number().finite().min(f.min) : z.number().finite()
    ).max(1e12);
  if (f.type === "select")
    return z
      .string()
      .refine((s) => !!f.options?.includes(s), "เลือกข้อมูลจากรายการ");
  if (f.type === "date")
    return z.string().refine(validDate, "วันที่ไม่ถูกต้อง");
  if (f.type === "email") return z.email();
  if (f.type === "url")
    return z
      .url()
      .refine((s) => /^https?:\/\//.test(s), "ใช้ URL แบบ http/https");
  if (f.type === "relation") return z.uuid();
  // An uploaded image is stored as its attachment id.
  if (f.type === "image") return z.uuid();
  if (f.type === "lines")
    return z
      .array(
        z.object({
          name: z.string().trim().min(1).max(500),
          qty: z.number().finite().min(0).max(1e9),
          price: z.number().finite().min(-1e12).max(1e12),
        }),
      )
      .max(100);
  return z
    .string()
    .trim()
    .min(1)
    .max(f.type === "textarea" ? 10000 : 500);
}
export function validateEntity(kind: string, input: unknown) {
  const module = catalog[kind];
  assert(module, "ไม่พบโมดูล", 404);
  const shape: Record<string, z.ZodType> = {};
  for (const f of module.fields) {
    const base = fieldSchema(f);
    shape[f.key] = f.required
      ? base
      : z.union([base, z.literal(""), z.null()]).optional();
  }
  const result = z.object(shape).safeParse(input);
  if (!result.success)
    throw new AppError(
      result.error.issues
        .map(
          (i) =>
            `${module.fields.find((f) => f.key === i.path[0])?.label || String(i.path[0])}: ${i.message}`,
        )
        .join(" · "),
    );
  const data = result.data as Record<string, unknown>;
  if (data.startDate && data.endDate)
    assert(
      String(data.endDate) >= String(data.startDate),
      "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
    );
  if (kind === "purchases") {
    assert(Number.isInteger(data.quantity), "จำนวนสินค้าต้องเป็นจำนวนเต็ม");
    data.total = Number(data.quantity) * Number(data.unitCost);
    data.status = "draft";
  }
  if (kind === "invoices") {
    assert(Number(data.vat) <= 100, "VAT ไม่เกิน 100%");
    data.total =
      Math.round(Number(data.subtotal) * (1 + Number(data.vat) / 100) * 100) /
      100;
    data.status = "issued";
    data.paid = 0;
  }
  if (kind === "payroll") {
    data.net =
      Number(data.base) +
      Number(data.allowance || 0) -
      Number(data.deduction || 0);
    assert(Number(data.net) >= 0, "ค่าจ้างสุทธิต้องไม่ติดลบ");
  }
  if (kind === "products") {
    data.stock = 0;
  }
  if (kind === "deals") assert(Number(data.gp || 0) <= 100, "GP ไม่เกิน 100%");
  return data;
}
/** Running codes for customers / suppliers: CUS-67-0001 = Thai year added (2 digits) + a number that never resets. Mirrors assign_entity_code(). */
export const codePrefixes: Record<string, string> = { customers: "CUS", suppliers: "SUP" };
export const thaiYear = (now = Date.now()) => (new Date(now + 7 * 3600000).getUTCFullYear() + 543) % 100;
export const formatCode = (prefix: string, year: number, n: number) =>
  `${prefix}-${String(year).padStart(2, "0")}-${String(n).padStart(4, "0")}`;
export function entityDepartment(kind: string, data: Record<string, unknown>) {
  return ["tasks", "documents"].includes(kind)
    ? String(data.department || "Operations")
    : kind === "tickets" && data.type === "IT"
      ? "IT"
      : catalog[kind]?.department || "Operations";
}
export function safeCsv(rows: unknown[][]) {
  return (
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v ?? "")
                .replace(/^[\s]*[=+@\-]/, "'$&")
                .replace(/"/g, '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n")
  );
}
export const templateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    department: z.string().min(1).max(100),
    fields: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
          label: z.string().min(1).max(200),
          type: z.enum(["text", "number", "date", "choice"]),
          required: z.boolean(),
          options: z
            .array(z.string().trim().min(1).max(100))
            .min(2)
            .max(20)
            .optional(),
        }),
      )
      .min(1)
      .max(30),
    steps: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          department: z.string().min(1).max(100),
        }),
      )
      .max(20),
  })
  .refine(
    (t) => new Set(t.fields.map((f) => f.key)).size === t.fields.length,
    "รหัสฟิลด์ซ้ำกัน",
  )
  .refine(
    (t) =>
      t.fields.every(
        (f) =>
          f.type !== "choice" ||
          (f.options && new Set(f.options).size === f.options.length),
      ),
    "ฟิลด์ตัวเลือกต้องมีอย่างน้อย 2 ตัวเลือกที่ไม่ซ้ำ",
  )
  .transform((t) => ({
    ...t,
    fields: t.fields.map(({ options, ...f }) =>
      f.type === "choice" ? { ...f, options } : f,
    ),
  }));
export function validateValues(
  t: Template,
  input: Record<string, unknown>,
  complete = false,
) {
  const values: Record<string, unknown> = {},
    missing: string[] = [];
  for (const f of t.fields) {
    const v = input[f.key];
    if (v === null || v === undefined || v === "") {
      values[f.key] = null;
      if (f.required) missing.push(f.label);
      continue;
    }
    assert(
      f.type === "number"
        ? typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e12
        : f.type === "date"
          ? typeof v === "string" && validDate(v)
          : f.type === "choice"
            ? typeof v === "string" && !!f.options?.includes(v)
            : typeof v === "string" && v.length <= 10000,
      `รูปแบบ ${f.label} ไม่ถูกต้อง`,
    );
    values[f.key] = v;
  }
  if (complete) assert(!missing.length, `ข้อมูลไม่ครบ: ${missing.join(", ")}`);
  return { values, missing };
}
export function explicitExtract(t: Template, raw: string) {
  const values: Record<string, unknown> = {};
  for (const f of t.fields) {
    const keys = [f.key, f.label]
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const match = raw.match(
      new RegExp(`(?:^|\\n)(?:${keys})\\s*[:=]\\s*([^\\n]+)`, "i"),
    );
    values[f.key] = match
      ? f.type === "number"
        ? Number(match[1].replace(/,/g, ""))
        : match[1].trim()
      : null;
    if (
      f.type === "number" &&
      values[f.key] !== null &&
      !Number.isFinite(values[f.key])
    )
      values[f.key] = null;
    if (f.type === "choice" && values[f.key] !== null)
      values[f.key] =
        f.options?.find(
          (o) => o.toLowerCase() === String(values[f.key]).toLowerCase(),
        ) ?? null;
  }
  return validateValues(t, values);
}
export function stockDelta(stock: number, type: string, quantity: number) {
  assert(["in", "out"].includes(type), "ประเภทรับ–จ่ายไม่ถูกต้อง");
  assert(
    Number.isInteger(quantity) && quantity > 0 && quantity < 1e9,
    "จำนวนต้องเป็นจำนวนเต็มบวก",
  );
  const next = stock + (type === "in" ? quantity : -quantity);
  assert(next >= 0, "สินค้าไม่พอจ่ายออก", 409);
  return next;
}
export function dashboardSummary(entities: Entity[]) {
  const rows = entities.filter((e) => !e.archived_at);
  const seriesMap = new Map<
    string,
    { date: string; sales: number; expenses: number }
  >();
  for (const e of rows) {
    if (
      (e.kind === "sales" && e.data.status === "confirmed") ||
      (e.kind === "expenses" &&
        ["approved", "paid"].includes(String(e.data.status)))
    ) {
      const date = String(e.data.date),
        day = seriesMap.get(date) || { date, sales: 0, expenses: 0 };
      day[e.kind === "sales" ? "sales" : "expenses"] += Number(
        e.data.amount || 0,
      );
      seriesMap.set(date, day);
    }
  }
  return {
    series: [...seriesMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14),
    sales: rows
      .filter((e) => e.kind === "sales" && e.data.status === "confirmed")
      .reduce((s, e) => s + Number(e.data.amount || 0), 0),
    expenses: rows
      .filter(
        (e) =>
          e.kind === "expenses" &&
          ["approved", "paid"].includes(String(e.data.status)),
      )
      .reduce((s, e) => s + Number(e.data.amount || 0), 0),
    projects: rows.filter(
      (e) =>
        e.kind === "projects" &&
        ["planning", "active", "review"].includes(String(e.data.status)),
    ).length,
    tasks: rows.filter((e) => e.kind === "tasks" && e.data.status !== "done")
      .length,
    lowStock: rows.filter(
      (e) =>
        e.kind === "products" &&
        Number(e.data.stock) <= Number(e.data.reorderLevel),
    ),
    pendingDeals: rows.filter(
      (e) => e.kind === "deals" && e.data.status === "pending",
    ).length,
  };
}
