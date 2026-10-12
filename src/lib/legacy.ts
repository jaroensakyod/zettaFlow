import { createHash } from "node:crypto";
import { catalog } from "./catalog";
import { validateEntity } from "./domain";
export const legacyKinds: Record<string, string> = {
  customers: "customers",
  dealers: "dealers",
  employees: "employees",
  freelancers: "freelancers",
  projects: "projects",
  dealAreas: "deals",
  companyAssets: "assets",
};
export function legacyId(company: string, collection: string, id: string) {
  const bytes = createHash("sha256")
    .update(`${company}:${collection}:${id}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function mapLegacy(
  collection: string,
  raw: Record<string, unknown>,
  company: string,
) {
  const kind = legacyKinds[collection];
  if (!kind) throw Error("Unsupported collection");
  const data: Record<string, unknown> = {
    ...raw,
    name:
      raw.name ||
      raw.cust_name ||
      raw.fullName ||
      raw.title ||
      [raw.firstName, raw.lastName].filter(Boolean).join(" ") ||
      raw.dealerName ||
      "รายการนำเข้า",
    code: raw.code || raw.empCode || raw.cust_id || "",
    notes: raw.note || raw.notes || raw.comment || "",
    phone: raw.phone || raw.cust_phone || "",
    status: raw.status || raw.workStatus || "active",
  };
  if (kind === "freelancers") {
    data.role = raw.empType || "PC";
    data.status = ["available", "assigned", "inactive"].includes(
      String(raw.workStatus),
    )
      ? raw.workStatus
      : "available";
  }
  if (kind === "employees") {
    data.employmentType = "ประจำ";
    data.department = raw.department || "Operations";
    data.status = "active";
  }
  if (kind === "projects") {
    data.priority = ["normal", "high", "urgent"].includes(String(raw.priority))
      ? raw.priority
      : "normal";
    data.endDate = raw.deadline || raw.endDate;
    data.status =
      (
        {
          pending: "planning",
          progress: "active",
          review: "review",
          done: "completed",
        } as Record<string, string>
      )[String(raw.status)] || "planning";
  }
  if (kind === "deals") {
    data.location = raw.dealerName || raw.areaZone || "พื้นที่นำเข้า";
    data.area = raw.areaSize || 0;
    data.rent = raw.rc_fixed || raw.rc_min || raw.breakevenRent || 0;
    data.gp = raw.rc_gp || 0;
    data.targetSales = raw.forCash || 0;
    data.status = "pending";
    if (raw.dealerId)
      data.dealerId = legacyId(company, "dealers", String(raw.dealerId));
  }
  if (kind === "assets") {
    data.quantity = raw.qty || 1;
    data.category = [
      "IT",
      "อุปกรณ์สำนักงาน",
      "เฟอร์นิเจอร์",
      "อุปกรณ์บูธ",
      "ยานพาหนะ",
      "อื่นๆ",
    ].includes(String(raw.category))
      ? raw.category
      : "อื่นๆ";
    data.status = ["in_use", "available", "repair", "retired"].includes(
      String(raw.status),
    )
      ? raw.status
      : "in_use";
    data.price = Number(raw.price || 0);
  }
  for (const f of catalog[kind].fields) {
    if (data[f.key] == null || data[f.key] === "") {
      if (f.required)
        data[f.key] =
          f.type === "number"
            ? f.min || 0
            : f.type === "select"
              ? f.options![0]
              : f.type === "date"
                ? "1970-01-01"
                : "นำเข้า";
      else delete data[f.key];
    } else if (f.type === "number") data[f.key] = Number(data[f.key]);
  }
  return { kind, data: validateEntity(kind, data) };
}
