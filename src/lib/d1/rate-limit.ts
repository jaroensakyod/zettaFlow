// Rate limits of the D1 sign-in, sign-up and password-reset calls (Supabase Auth had its own; Better Auth's limiter
// only guards its HTTP handler, which is not mounted). Counted per email address and per client IP in the
// auth_rate_limits table (cloudflare/d1/0005_rate_limits.sql), so every Worker isolate sees the same counts. Over the
// limit the call answers Supabase's 429 "Too many requests, try again later" without reaching Better Auth (no
// password check, no email sent). Used by d1AuthBridge (src/lib/d1/auth.ts).
import type { Sql } from "./driver";
import type { AuthError } from "./postgrest";

export type RateAction = "sign_in_failed" | "sign_up" | "reset";
/** max events per window, per email and per IP. sign_in_failed counts failures only (a good sign-in clears the email's). */
export const RATE_LIMITS: Record<RateAction, { windowMs: number; email: number; ip: number }> = {
  sign_in_failed: { windowMs: 15 * 60_000, email: 5, ip: 20 },
  sign_up: { windowMs: 60 * 60_000, email: 3, ip: 10 },
  reset: { windowMs: 60 * 60_000, email: 3, ip: 10 },
};
const KEEP_MS = 24 * 60 * 60_000;

export const tooManyRequests = (): AuthError => ({ message: "Too many requests, try again later", name: "AuthApiError", status: 429, code: "over_request_rate_limit" });

/** The client IP of a request: cf-connecting-ip (Cloudflare), else the first x-forwarded-for, else x-real-ip. */
export function clientIp(h: Headers | undefined | null): string | null {
  if (!h) return null;
  const ip = h.get("cf-connecting-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || h.get("x-real-ip") || "";
  return ip.trim() || null;
}
async function subject(kind: "email" | "ip", value: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${value.trim().toLowerCase()}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function rateLimiter(sql: Sql, now: () => number = Date.now) {
  const subjects = async (email: string | null, ip: string | null) => ({
    email: email ? await subject("email", email) : null,
    ip: ip ? await subject("ip", ip) : null,
  });
  const count = async (action: RateAction, s: string, since: string) =>
    Number((await sql.all<{ n: number }>("SELECT count(*) AS n FROM auth_rate_limits WHERE action = ? AND subject = ? AND created_at >= ?", [action, s, since]))[0]?.n ?? 0);
  return {
    /** True when this email or IP already reached the limit of `action` in its window. */
    async blocked(action: RateAction, email: string | null, ip: string | null): Promise<boolean> {
      const l = RATE_LIMITS[action],
        since = new Date(now() - l.windowMs).toISOString(),
        s = await subjects(email, ip);
      if (s.email && (await count(action, s.email, since)) >= l.email) return true;
      if (s.ip && (await count(action, s.ip, since)) >= l.ip) return true;
      return false;
    },
    /** Counts one event for the email and the IP (and drops rows older than a day). */
    async hit(action: RateAction, email: string | null, ip: string | null) {
      const s = await subjects(email, ip),
        at = new Date(now()).toISOString();
      for (const v of [s.email, s.ip]) if (v) await sql.run("INSERT INTO auth_rate_limits (action, subject, created_at) VALUES (?, ?, ?)", [action, v, at]);
      await sql.run("DELETE FROM auth_rate_limits WHERE created_at < ?", [new Date(now() - KEEP_MS).toISOString()]);
    },
    /** A good sign-in: the email's failed attempts no longer count (the IP's still do). */
    async clear(action: RateAction, email: string) {
      await sql.run("DELETE FROM auth_rate_limits WHERE action = ? AND subject = ?", [action, await subject("email", email)]);
    },
  };
}
export type RateLimiter = ReturnType<typeof rateLimiter>;
