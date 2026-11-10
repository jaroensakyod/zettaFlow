// Which company facts other companies may see (globe = public, lock = private), stored as profile.visibility:
// a comma list of public field keys plus "products"; "none" = all private. Mirrors feed_company_profile (0059).

/** Fields the owner can switch between public and private. */
export const toggleableFields = [
  "nameEn", "taxId", "registration", "legal", "employees", "founded", "description",
  "address", "zip", "shipAddress", "phone", "email", "website", "line", "facebook",
] as const;
/** Shown on network cards anyway, so always public. */
export const alwaysPublicFields = ["name", "bio", "industry", "province"];
/** What was public before per-field switches existed. */
export const defaultPublic = "nameEn,description,website,facebook,line";
const allowed = new Set<string>([...toggleableFields, "products"]);

export function publicSet(value: unknown): Set<string> {
  const v = String(value || "") || defaultPublic;
  return new Set(v === "none" ? [] : v.split(",").filter((k) => allowed.has(k)));
}
export function visibilityValue(set: Set<string>): string {
  const list = [...toggleableFields, "products"].filter((k) => set.has(k));
  return list.length ? list.join(",") : "none";
}
export function validVisibility(value: string) {
  return value === "none" || value.split(",").every((k) => allowed.has(k));
}
