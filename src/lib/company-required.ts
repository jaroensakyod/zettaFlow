/**
 * The company details every workspace must fill in (documents, invoices and the company page need them).
 * Everything else on the company form stays optional.
 */
export type RequiredItem = {
  key: string;
  label: string;
  /** Tab of the company form that holds the field(s). */
  tab: "main" | "address" | "social" | "docs";
  done: (p: Record<string, unknown>) => boolean;
};
const has = (p: Record<string, unknown>, k: string) => String(p[k] ?? "").trim() !== "";
export const companyRequired: RequiredItem[] = [
  { key: "name", label: "ชื่อบริษัท / ชื่อกิจการ", tab: "main", done: (p) => has(p, "name") },
  {
    key: "taxId",
    label: "เลขบัตรประชาชน / เลขผู้เสียภาษี หรือ เลขทะเบียนบริษัท",
    tab: "main",
    done: (p) => has(p, "taxId") || has(p, "registration"),
  },
  { key: "address", label: "ที่อยู่", tab: "address", done: (p) => has(p, "address") },
  { key: "phone", label: "เบอร์ติดต่อ", tab: "social", done: (p) => has(p, "phone") },
];
/** Field keys that show a required mark on the company form. */
export const requiredFieldKeys = ["name", "taxId", "registration", "address", "phone"];
export const companyMissing = (p: Record<string, unknown>) => companyRequired.filter((r) => !r.done(p));
