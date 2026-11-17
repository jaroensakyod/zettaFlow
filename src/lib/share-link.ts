// Signed links for documents sent into LINE (ใบรับรองแทนใบเสร็จ, the expense summary file): whoever has the link
// can open it until it expires, without signing in, like a file shared from cloud storage. The link carries only
// what to show and when it expires; it is signed with a server secret so it cannot be changed or guessed.
import { createHmac, timingSafeEqual } from "node:crypto";

export type ShareTarget =
  | { k: "sub"; id: string }
  | { k: "sum"; c: string; from: string; to: string }
  | { k: "pay"; id: string; d: "inv" | "rc" };
type Signed = ShareTarget & { exp: number };

const DAY = 86_400_000;
function secret() {
  const s = process.env.SHARE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.LINE_CHANNEL_SECRET || "";
  if (!s) throw new Error("ยังไม่ได้ตั้งค่า secret สำหรับลิงก์เอกสาร");
  return s;
}
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (body: string, key = secret()) => createHmac("sha256", key).update("share:" + body).digest().subarray(0, 18);

/** A link token valid for `days` (default 30). */
export function signShare(t: ShareTarget, days = 30, now = Date.now(), key?: string) {
  const body = b64(JSON.stringify({ ...t, exp: now + days * DAY }));
  return body + "." + b64(mac(body, key));
}
/** The target, or null when the token was changed, made with another secret, or has expired. */
export function readShare(token: string, now = Date.now(), key?: string): ShareTarget | null {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || body.length > 600) return null;
  const want = mac(body, key),
    got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString()) as Signed;
    if (!v || typeof v.exp !== "number" || v.exp < now) return null;
    if (v.k === "sub" && /^[0-9a-f-]{36}$/i.test(v.id)) return { k: "sub", id: v.id };
    if (v.k === "pay" && /^[0-9a-f-]{36}$/i.test(v.id) && (v.d === "inv" || v.d === "rc")) return { k: "pay", id: v.id, d: v.d };
    if (v.k === "sum" && /^[0-9a-f-]{36}$/i.test(v.c) && /^\d{4}-\d{2}-\d{2}$/.test(v.from) && /^\d{4}-\d{2}-\d{2}$/.test(v.to))
      return { k: "sum", c: v.c, from: v.from, to: v.to };
  } catch {
    /* not ours */
  }
  return null;
}
/** Full URL of a shared document on this site. */
export function shareUrl(t: ShareTarget, days?: number) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return base ? `${base}/doc/${signShare(t, days)}` : "";
}
