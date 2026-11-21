// Email of the D1 build (Supabase Auth sent these before): sign-up confirmation and password reset links.
// Pluggable: `send({ to, subject, html, text })`.
// - MAIL_PROVIDER=resend + MAIL_API_KEY + MAIL_FROM: Resend's HTTP API (fetch, no SDK; works on Workers).
// - nothing configured, outside production: the message and its link go to the server console, and on node the last
//   message per address is written to .data/mail/<email>.json (MAIL_DIR overrides) so tests and local checks can
//   open the link.
// - nothing configured in production: nothing is sent and an error is logged (without the link).
// The wording reuses the app's Thai Supabase templates (scripts/email-templates.ts).
import { templates } from "../../../scripts/email-templates";

export type Mail = { to: string; subject: string; html: string; text: string; /** The action link, for dev logs. */ link?: string };
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Resend-style provider: POST https://api.resend.com/emails { from, to, subject, html, text }. */
export function resendMailer(o: { apiKey: string; from: string; endpoint?: string; fetch?: typeof fetch }): Mailer {
  return {
    async send(m) {
      const res = await (o.fetch ?? fetch)(o.endpoint ?? "https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: o.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      });
      if (!res.ok) throw new Error(`ส่งอีเมลไม่สำเร็จ (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
    },
  };
}

type Fs = { mkdirSync(p: string, o: { recursive: true }): void; writeFileSync(p: string, d: string): void };
const nodeFs = (): Fs | null => {
  try {
    return (process.getBuiltinModule?.("node:fs") as Fs | undefined) ?? null;
  } catch {
    return null;
  }
};
export const mailFile = (dir: string, to: string) => `${dir}/${to.toLowerCase().replace(/[^a-z0-9@._+-]/g, "_")}.json`;

/** Dev: console + .data/mail/<email>.json (the last message per address). */
export function devMailer(dir = process.env.MAIL_DIR || ".data/mail"): Mailer {
  return {
    async send(m) {
      console.info(`[mail] to ${m.to}: ${m.subject}${m.link ? `\n[mail] link: ${m.link}` : ""}`);
      const fs = nodeFs();
      if (!fs) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(mailFile(dir, m.to), JSON.stringify({ ...m, at: new Date().toISOString() }, null, 2));
      } catch (e) {
        console.warn("[mail] could not write", (e as Error).message);
      }
    },
  };
}

/** Tests: keeps every message in memory. */
export function memoryMailer() {
  const sent: Mail[] = [];
  return {
    sent,
    last: (to: string) => [...sent].reverse().find((m) => m.to.toLowerCase() === to.toLowerCase()),
    async send(m: Mail) {
      sent.push(m);
    },
  } satisfies Mailer & Record<string, unknown>;
}

/** The mailer chosen by env (see the top of this file). */
export function envMailer(): Mailer {
  const provider = (process.env.MAIL_PROVIDER || "").toLowerCase();
  if (provider) {
    const apiKey = process.env.MAIL_API_KEY,
      from = process.env.MAIL_FROM;
    if (!apiKey || !from) throw new Error("ตั้งค่า MAIL_API_KEY และ MAIL_FROM ให้ MAIL_PROVIDER ก่อน");
    if (provider === "resend") return resendMailer({ apiKey, from, endpoint: process.env.MAIL_ENDPOINT || undefined });
    throw new Error(`MAIL_PROVIDER ไม่รองรับ: ${provider} (ใช้ได้: resend)`);
  }
  if (process.env.NODE_ENV === "production")
    return {
      async send(m) {
        console.error(`[mail] MAIL_PROVIDER is not set: "${m.subject}" to ${m.to} was not sent`);
      },
    };
  return devMailer();
}

// ---------- messages ----------
const fill = (s: string, v: Record<string, string>) => s.replace(/\{\{ \.(\w+) \}\}/g, (all, k: string) => v[k] ?? all);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** One of the app's templates with its button pointed at `link`. */
function render(slug: "confirm-sign-up" | "reset-password", email: string, link: string, text: string): Omit<Mail, "to"> {
  const t = templates[slug];
  // The templates link to {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…; the D1 build makes the whole link.
  const body = t.body.replace(/\{\{ \.SiteURL \}\}\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}&type=\w+/g, esc(link));
  return { subject: t.subject, html: fill(body, { Email: esc(email) }), text: `${text}\n\n${link}`, link };
}
export const confirmSignUpMail = (email: string, link: string) =>
  render("confirm-sign-up", email, link, `ยืนยันอีเมล ${email} เพื่อเริ่มใช้ EliteFlow โดยเปิดลิงก์นี้`);
export const resetPasswordMail = (email: string, link: string) =>
  render("reset-password", email, link, `ตั้งรหัสผ่านใหม่สำหรับบัญชี ${email} โดยเปิดลิงก์นี้ (ใช้ได้ครั้งเดียว หมดอายุภายใน 1 ชั่วโมง)`);
