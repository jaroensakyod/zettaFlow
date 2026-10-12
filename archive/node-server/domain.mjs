import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function text(value, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail("ข้อมูลข้อความไม่ถูกต้อง");
  return value.trim();
}
export function validateTemplate(input) {
  const name = text(input.name),
    department = text(input.department);
  if (
    !Array.isArray(input.fields) ||
    !input.fields.length ||
    input.fields.length > 20
  )
    fail("กำหนดฟิลด์ 1–20 รายการ");
  const keys = new Set();
  const fields = input.fields.map((f) => {
    const key = text(f.key, 40);
    if (!/^[a-z][a-z0-9_]*$/.test(key) || keys.has(key))
      fail("รหัสฟิลด์ต้องไม่ซ้ำ และใช้ a-z, 0-9, _");
    keys.add(key);
    if (!["text", "number", "date"].includes(f.type))
      fail("ประเภทฟิลด์ไม่ถูกต้อง");
    return { key, label: text(f.label), type: f.type, required: !!f.required };
  });
  const steps = (input.steps || []).map((s) => ({
    name: text(s.name),
    department: text(s.department),
  }));
  if (steps.length > 10) fail("Workflow ไม่เกิน 10 ขั้นตอน");
  return { name, department, fields, steps };
}
export function validateValues(template, input, requireAll = false) {
  const result = {},
    missing = [];
  for (const f of template.fields) {
    const value = input?.[f.key];
    if (value == null || value === "") {
      result[f.key] = null;
      if (f.required) missing.push(f.label);
      continue;
    }
    if (f.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e12
      )
        fail(`${f.label}: ต้องเป็นตัวเลข`);
      result[f.key] = value;
    } else if (f.type === "date") {
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      )
        fail(`${f.label}: วันที่ไม่ถูกต้อง`);
      result[f.key] = value;
    } else result[f.key] = text(value, 2000);
  }
  if (requireAll && missing.length)
    fail(`กรอกข้อมูลให้ครบ: ${missing.join(", ")}`);
  return { values: result, missing };
}
export function localExtract(template, raw) {
  // Deliberately conservative fallback: only explicit key/value lines, never invented data.
  const values = {};
  for (const f of template.fields) {
    const labels = [f.key, f.label]
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const match = raw.match(
      new RegExp(`(?:^|\\n)(?:${labels})\\s*[:=]\\s*([^\\n]+)`, "i"),
    );
    values[f.key] = match
      ? f.type === "number"
        ? Number(match[1].replace(/,/g, ""))
        : match[1].trim()
      : null;
    if (f.type === "number" && !Number.isFinite(values[f.key]))
      values[f.key] = null;
    if (
      f.type === "date" &&
      values[f.key] &&
      !/^\d{4}-\d{2}-\d{2}$/.test(values[f.key])
    )
      values[f.key] = null;
  }
  return validateValues(template, values);
}
export function verifyLine(raw, signature, secret) {
  if (!secret || typeof signature !== "string") return false;
  const expected = createHmac("sha256", secret).update(raw).digest("base64");
  const a = Buffer.from(signature),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function initialState(name = "บริษัทของฉัน") {
  const createdAt = now();
  return {
    name,
    templates: [
      {
        id: "space",
        name: "อนุมัติพื้นที่ขาย",
        department: "Business Development",
        fields: [
          { key: "project", label: "โครงการ", type: "text", required: true },
          { key: "location", label: "สถานที่", type: "text", required: true },
          { key: "area", label: "พื้นที่", type: "number", required: false },
          { key: "rent", label: "ค่าเช่า", type: "number", required: true },
          { key: "start", label: "วันเริ่ม", type: "date", required: true },
          { key: "end", label: "วันสิ้นสุด", type: "date", required: true },
        ],
        steps: [
          { name: "เขียนแบบ / Perspective", department: "Design" },
          { name: "ขอใบเสนอราคา / Spec", department: "Purchasing" },
          { name: "เตรียมสินค้า / สต็อก", department: "Warehouse" },
          { name: "เตรียมสื่อ / โปรโมชั่น", department: "Marketing" },
          { name: "วางแผนการขาย", department: "Sales" },
        ],
        createdAt,
      },
      {
        id: "sales",
        name: "รายงานยอดขาย",
        department: "Sales",
        fields: [
          { key: "project", label: "โครงการ", type: "text", required: true },
          { key: "date", label: "วันที่", type: "date", required: true },
          { key: "sales", label: "ยอดขาย", type: "number", required: true },
          {
            key: "expense",
            label: "ค่าใช้จ่าย",
            type: "number",
            required: false,
          },
        ],
        steps: [],
        createdAt,
      },
    ],
    records: [],
    tasks: [],
    audit: [],
  };
}
export const canSee = (user, department) =>
  user.role === "owner" || (user.departments || []).includes(department);
export function visibleState(state, user) {
  const templates = state.templates.filter((t) => canSee(user, t.department));
  const records = state.records.filter((r) => canSee(user, r.department));
  const tasks = state.tasks.filter((t) => canSee(user, t.department));
  return {
    ...state,
    templates,
    records,
    tasks,
    audit: user.role === "owner" ? state.audit : [],
  };
}
export function audit(state, actor, action, target) {
  state.audit.unshift({ id: id(), at: now(), actor, action, target });
  state.audit = state.audit.slice(0, 300);
}
export function decide(state, user, recordId, input) {
  const r = state.records.find((r) => r.id === recordId);
  if (!r || !canSee(user, r.department)) fail("ไม่พบรายการ", 404);
  if (!["owner", "manager"].includes(user.role))
    fail("ไม่มีสิทธิ์อนุมัติ", 403);
  if (r.status !== "review") fail("รายการนี้ตัดสินแล้ว", 409);
  if (!["approved", "rejected"].includes(input.status)) fail("สถานะไม่ถูกต้อง");
  if (input.status === "approved") {
    const checked = validateValues(r.template, input.values, true);
    r.values = checked.values;
    r.missing = [];
    state.tasks.push(
      ...r.template.steps.map((step, i) => ({
        id: id(),
        recordId: r.id,
        project: r.values.project || r.template.name,
        ...step,
        order: i,
        status: "pending",
        createdAt: now(),
        dueAt: input.dueAt || null,
      })),
    );
  } else r.reason = text(input.reason, 1000);
  r.status = input.status;
  r.decidedBy = user.uid;
  r.decidedAt = now();
  audit(state, user.uid, input.status, r.id);
  return r;
}
