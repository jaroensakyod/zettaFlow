// ผู้ลงนามบนเอกสาร: the people who sign the company's documents (name, position, signature image, optional photo), kept in the
// company profile as JSON (`signers`), with the company stamp (`stamp`). The default issuer / approver are still
// written to signerName / approverName (+ position) so everything that reads those keeps working.
export type Signer = { id: string; name: string; position: string; sign: string; /** Small round photo of the person (optional). */ photo?: string };

export const MAX_SIGNERS = 8;
export const MAX_SIGN = 40000;
export const MAX_PHOTO = 30000;
export const MAX_STAMP = 60000;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const isImage = (v: unknown, max: number) => typeof v === "string" && v.length <= max && IMAGE.test(v);

/** The signer list from the profile; anything malformed is dropped (never throws). */
export function parseSigners(v: unknown): Signer[] {
  let list: unknown = v;
  if (typeof v === "string") {
    try {
      list = v ? JSON.parse(v) : [];
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: String(x.id || "").slice(0, 40),
      name: String(x.name || "").trim().slice(0, 100),
      position: String(x.position || "").trim().slice(0, 100),
      sign: isImage(x.sign, MAX_SIGN) ? String(x.sign) : "",
      photo: isImage(x.photo, MAX_PHOTO) ? String(x.photo) : "",
    }))
    .filter((x) => x.id && x.name)
    .slice(0, MAX_SIGNERS);
}

/** Server check for a submitted `signers` value: a message when it is not acceptable, else null. */
export function signersProblem(v: string): string | null {
  let list: unknown;
  try {
    list = JSON.parse(v);
  } catch {
    return "รายชื่อผู้ลงนามไม่ถูกต้อง";
  }
  if (!Array.isArray(list) || list.length > MAX_SIGNERS) return `ผู้ลงนามได้ไม่เกิน ${MAX_SIGNERS} คน`;
  for (const x of list as Record<string, unknown>[]) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || typeof x.name !== "string" || !x.name.trim()) return "ใส่ชื่อผู้ลงนามให้ครบทุกคน";
    if (String(x.name).length > 100 || String(x.position || "").length > 100) return "ชื่อหรือตำแหน่งผู้ลงนามยาวเกินไป";
    if (x.sign && !isImage(x.sign, MAX_SIGN)) return "รูปลายเซ็นไม่ถูกต้องหรือใหญ่เกินไป";
    if (x.photo && !isImage(x.photo, MAX_PHOTO)) return "รูปผู้ลงนามไม่ถูกต้องหรือใหญ่เกินไป";
  }
  return null;
}

/** Signature and stamp go on documents unless the owner turned it off (autoSign "0"). */
export const autoSignOn = (p: Record<string, unknown>) => String(p.autoSign ?? "") !== "0";

/** The signature image for the person printed on a document (matched by name), when auto-signing is on. */
export function signatureFor(p: Record<string, unknown>, name: string): string {
  if (!autoSignOn(p) || !name.trim()) return "";
  const key = name.replace(/\s+/g, "").toLowerCase();
  return parseSigners(p.signers).find((x) => x.name.replace(/\s+/g, "").toLowerCase() === key)?.sign || "";
}
export const stampFor = (p: Record<string, unknown>) => (autoSignOn(p) && isImage(p.stamp, MAX_STAMP) ? String(p.stamp) : "");
