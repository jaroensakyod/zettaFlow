import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
export const shareToken = () => randomBytes(24).toString("base64url");
export const shareHash = (token: string) =>
  createHash("sha256").update("share:" + token).digest("hex");
export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export function verifyPassword(password: string, stored: string | null) {
  if (!stored) return true;
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}
export type Share = {
  id: string;
  company_id: string;
  token_hash: string;
  password_hash: string | null;
  label: string;
  widget_keys: string[];
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};
export function shareState(s: Pick<Share, "expires_at" | "revoked_at"> | null | undefined, now = Date.now()) {
  if (!s) return "missing" as const;
  if (s.revoked_at) return "revoked" as const;
  if (Date.parse(s.expires_at) <= now) return "expired" as const;
  return "ok" as const;
}
