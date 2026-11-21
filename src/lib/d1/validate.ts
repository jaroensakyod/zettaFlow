// validate_payload(k, p, c) for D1, the one copy every write path uses (save_entity, ingestion_to_entity,
// load_sample_data): only the fields of the kind's entity_schemas row are kept, each checked by its type with the
// exact Postgres errors. Item lines follow Postgres's three-valued logic: a check on a missing key is unknown, not
// false, so a line without name / qty / price passes, while a key that is present must be right (a JSON null there is
// rejected). The relation check is injected: callers that plan several rows in one batch also see the rows planned
// so far.
import { fail, jsonType, pgLen, pgText, pgUuid, type Data } from "./common";
import type { Tenant } from "./tenant";

/** One field of entity_schemas.fields. */
export type SchemaField = { key?: unknown; label?: unknown; type?: unknown; required?: unknown; options?: unknown; resource?: unknown; min?: unknown } & Data;
/** Does a record with this id exist in the company, of this kind and not archived? */
export type RelationCheck = (id: string, kind: string) => Promise<boolean>;

const LINE_KEYS = ["name", "qty", "price", "category", "unit", "currency", "discount", "discountType"];
/** SQL OR over true / false / null (unknown). */
const or = (...xs: (boolean | null)[]) => (xs.includes(true) ? true : xs.includes(null) ? null : false);

/** One item line is bad (true), fine (false) or unknown (null) — only true rejects, like Postgres's IF. */
function badLine(x: unknown): boolean | null {
  if (jsonType(x) !== "object") return true;
  const o = x as Data,
    name = pgText(o.name),
    qty = o.qty,
    price = o.price;
  return or(
    o.name === undefined ? null : jsonType(o.name) !== "string",
    name === null ? null : pgLen(name) < 1 || pgLen(name) > 500,
    qty === undefined ? null : jsonType(qty) !== "number",
    price === undefined ? null : jsonType(price) !== "number",
    typeof qty !== "number" ? null : qty < 0 || qty > 1e9,
    typeof price !== "number" ? null : Math.abs(price) > 1e12,
    "category" in o && (jsonType(o.category) !== "string" || pgLen(o.category as string) > 100),
    "unit" in o && (jsonType(o.unit) !== "string" || pgLen(o.unit as string) > 30),
    "currency" in o && (jsonType(o.currency) !== "string" || pgLen(o.currency as string) > 3),
    "discount" in o && (jsonType(o.discount) !== "number" || (o.discount as number) < 0 || (o.discount as number) > 1e12),
    "discountType" in o && !["percent", "amount"].includes(pgText(o.discountType) ?? ""),
  );
}

/**
 * validate_payload(): `spec` is entity_schemas.fields of the kind (null / undefined: no such kind). Returns the clean
 * payload: the known fields only, item lines reduced to their known keys without nulls.
 */
export async function validatePayload(spec: SchemaField[] | null | undefined, p: unknown, relationExists: RelationCheck): Promise<Data> {
  if (!spec) return fail("ไม่พบโมดูล", 404);
  const input = p && typeof p === "object" && !Array.isArray(p) ? (p as Data) : {};
  const out: Data = {};
  for (const f of spec) {
    const key = pgText(f.key) as string;
    let v = input[key];
    if (v === undefined || v === null || v === "") {
      if (f.required === true || f.required === "true") fail(`ข้อมูลไม่ครบ: ${pgText(f.label) ?? ""}`);
      continue;
    }
    if (f.type === "lines") {
      if (!Array.isArray(v) || v.length > 100 || v.some((x) => badLine(x) === true)) fail("รายการสินค้าไม่ถูกต้อง");
      v = (v as Data[]).map((x) => Object.fromEntries(LINE_KEYS.filter((k) => x[k] !== undefined && x[k] !== null).map((k) => [k, x[k]])));
    } else if (f.type === "number") {
      if (typeof v !== "number") fail("รูปแบบตัวเลขไม่ถูกต้อง");
      const min = f.min === undefined || f.min === null ? null : Number(f.min);
      if (Math.abs(v as number) > 1e12 || (min !== null && (v as number) < min)) fail("จำนวนไม่ถูกต้อง");
    } else {
      if (typeof v !== "string" || pgLen(v) > 10000) fail("รูปแบบข้อความไม่ถูกต้อง");
      const s = v as string;
      if (f.type === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail("วันที่ไม่ถูกต้อง");
        const d = new Date(s + "T00:00:00Z");
        // (v)::date raises for a day that does not exist.
        if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) fail(`date/time field value out of range: "${s}"`);
      }
      // not (options ? v): unknown (no raise) when the field has no options.
      if (f.type === "select" && Array.isArray(f.options) && !f.options.includes(s)) fail("ตัวเลือกไม่ถูกต้อง");
      if (f.type === "relation" && !(await relationExists(pgUuid(s)!, pgText(f.resource) ?? ""))) fail("ข้อมูลอ้างอิงไม่อยู่ในบริษัทนี้");
    }
    out[key] = v;
  }
  const sd = pgText(out.startDate),
    ed = pgText(out.endDate);
  if (sd !== null && ed !== null && sd > ed) fail("ช่วงวันที่ไม่ถูกต้อง");
  return out;
}

/** The entity_schemas row of a kind (fields and department), or null. */
export async function entitySchema(t: Tenant, kind: string): Promise<{ department: string; fields: SchemaField[] } | null> {
  const [s] = await t.selectGlobal<{ kind: string; department: string; fields: SchemaField[] }>("entity_schemas", { where: { kind } });
  return s ? { department: s.department, fields: Array.isArray(s.fields) ? s.fields : [] } : null;
}
