"use client";
// After inviting someone: whether an email went out, and a ready message to send them on LINE (copy button).
import { useState } from "react";
import { Check, Copy, MailCheck, MailWarning, Send } from "lucide-react";
import { api } from "./shared";

export type InviteResult = { emailed?: boolean; existing?: boolean; reset?: boolean; demo?: boolean };

export const inviteText = (company: string, email: string, existing?: boolean) =>
  existing
    ? `${company} เชิญคุณเข้าใช้ระบบ EliteFlow ของบริษัท\n` +
      `คุณมีบัญชี EliteFlow ด้วยอีเมล ${email} อยู่แล้ว เข้า https://eliteflow-ai.com แล้วเข้าสู่ระบบใหม่ บริษัทจะขึ้นให้อัตโนมัติ\n` +
      `(ถ้ามีหลายบริษัท สลับบริษัทได้ที่เมนูบัญชีมุมขวาบน · คำเชิญใช้ได้ 7 วัน)`
    : `${company} เชิญคุณเข้าใช้ระบบ EliteFlow ของบริษัท\n` +
      `1. เปิดอีเมล ${email} แล้วกด "ตอบรับคำเชิญ" (ถ้าไม่เห็น ดูใน Spam / Promotions)\n` +
      `   หรือเข้า https://eliteflow-ai.com กด "สร้างบัญชีใหม่" ด้วยอีเมลนี้\n` +
      `2. ตั้งรหัสผ่าน แล้วจะเข้าบริษัทให้อัตโนมัติ\n` +
      `(คำเชิญใช้ได้ 7 วัน)`;

/** Renews an invitation for 7 days and emails it again (owner). */
export const resendInvite = (email: string): Promise<InviteResult> => api("/team/invites/resend", { method: "POST", body: { email } });

export function InviteMessage({
  company,
  email,
  result: first,
  canResend,
  onResent,
}: {
  company: string;
  email: string;
  result?: InviteResult | null;
  /** Show "ส่งอีเมลเชิญอีกครั้ง" (a pending invitation the owner may send again). */
  canResend?: boolean;
  onResent?: (r: InviteResult) => void;
}) {
  const [copied, setCopied] = useState(false),
    [resent, setResent] = useState<InviteResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const result = resent || first;
  const text = inviteText(company, email, result?.existing);
  return (
    <div className="invite-msg">
      {result && (
        <p className={"invite-msg-status" + (result.emailed ? " ok" : "")}>
          {result.emailed ? <MailCheck size={15} /> : <MailWarning size={15} />}
          {result.emailed && result.reset
            ? `อีเมลนี้มีบัญชีอยู่แล้ว ส่งลิงก์ตั้งรหัสผ่านและเข้าสู่ระบบไปที่ ${email} แล้ว`
            : result.emailed
            ? `ส่งอีเมลคำเชิญไปที่ ${email} แล้ว`
            : result.demo
              ? "โหมดตัวอย่างไม่ส่งอีเมลจริง · ส่งข้อความด้านล่างให้พนักงานแทน"
              : result.existing
              ? "อีเมลนี้มีบัญชี EliteFlow อยู่แล้ว ระบบจึงไม่ส่งอีเมล ส่งข้อความด้านล่างให้พนักงานแทน"
              : "ส่งอีเมลไม่สำเร็จ ส่งข้อความด้านล่างให้พนักงานแทน (คำเชิญบันทึกไว้แล้ว)"}
        </p>
      )}
      <small>ส่งต่อทาง LINE ได้เลย</small>
      <pre>{text}</pre>
      <div className="invite-msg-actions">
      <a className="secondary as-button" href={lineShare(text)} target="_blank" rel="noreferrer">
        <Send size={15} /> ส่งทาง LINE
      </a>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            const t = document.createElement("textarea");
            t.value = text;
            document.body.appendChild(t);
            t.select();
            document.execCommand("copy");
            t.remove();
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
      </button>
      {canResend && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await resendInvite(email);
              setResent(r);
              onResent?.(r);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Send size={15} /> {busy ? "กำลังส่ง…" : "ส่งอีเมลเชิญอีกครั้ง"}
        </button>
      )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** Joined members: an invitation to start using the system — company, position, the link; they sign in with their own
 * email and password. Setting a new password is a separate, smaller option for someone who forgot it. */
const SITE = "https://eliteflow-ai.com";
export const joinText = (company: string, email: string, name?: string, position?: string) =>
  [
    `สวัสดีค่ะ${name ? " คุณ" + name : ""}`,
    `${company} เปิดสิทธิ์ให้คุณใช้งานระบบ EliteFlow แล้ว`,
    position ? `ตำแหน่ง: ${position}` : "",
    `กดเข้าใช้งานได้เลย 👉 ${SITE}/workspace/dashboard`,
    `เข้าสู่ระบบด้วยอีเมล ${email} และรหัสผ่านของคุณ`,
  ]
    .filter(Boolean)
    .join("\n");
/** Opens LINE with the message ready to send (phone app or LINE for PC). */
export const lineShare = (text: string) => "https://line.me/R/msg/text/?" + encodeURIComponent(text);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

export function LoginHelp({
  company,
  email,
  memberId,
  name,
  position,
  onSent,
}: {
  company: string;
  email: string;
  memberId: string;
  name?: string;
  position?: string;
  onSent?: (r: InviteResult) => void;
}) {
  const [copied, setCopied] = useState(false),
    [result, setResult] = useState<InviteResult | null>(null),
    [mailed, setMailed] = useState<"" | "sent" | "demo">(""),
    [busy, setBusy] = useState(false),
    [mailing, setMailing] = useState(false),
    [error, setError] = useState("");
  const text = joinText(company, email, name, position);
  return (
    <div className="invite-msg login-help">
      <b className="login-help-title">คำเชิญเข้าใช้งานระบบ</b>
      <small>ส่งให้พนักงานกดเข้าใช้งานได้ทันที ใช้อีเมลและรหัสผ่านของพนักงานเอง ส่งซ้ำได้ทุกเมื่อ</small>
      <pre>{text}</pre>
      <div className="invite-msg-actions">
        <a className="primary as-button" href={lineShare(text)} target="_blank" rel="noreferrer">
          <Send size={15} /> ส่งทาง LINE
        </a>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            await copyText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "คัดลอกแล้ว" : "คัดลอกคำเชิญ"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={mailing}
          onClick={async () => {
            setMailing(true);
            setError("");
            try {
              const r: InviteResult = await api("/team/" + memberId + "/invite-email", { method: "POST", body: { name, position } });
              setMailed(r.demo ? "demo" : "sent");
              onSent?.({ ...r, reset: false });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setMailing(false);
            }
          }}
        >
          <MailCheck size={15} /> {mailing ? "กำลังส่ง…" : "ส่งคำเชิญทางอีเมล"}
        </button>
      </div>
      {mailed && (
        <p className="invite-msg-status ok">
          <MailCheck size={15} /> {mailed === "demo" ? "โหมดตัวอย่างไม่ส่งอีเมลจริง" : `ส่งคำเชิญไปที่ ${email} แล้ว`}
        </p>
      )}
      <p className="login-help-forgot">
        พนักงานลืมรหัสผ่าน?{" "}
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r: InviteResult = await api("/team/" + memberId + "/login-link", { method: "POST" });
              setResult(r);
              onSent?.(r);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "กำลังส่ง…" : "ส่งลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล"}
        </button>
      </p>
      {result && (
        <p className={"invite-msg-status" + (result.emailed ? " ok" : "")}>
          {result.emailed ? <MailCheck size={15} /> : <MailWarning size={15} />}
          {result.emailed
            ? `ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${email} แล้ว`
            : result.demo
              ? "โหมดตัวอย่างไม่ส่งอีเมลจริง"
              : "ส่งอีเมลไม่สำเร็จ ให้พนักงานกด “ลืมรหัสผ่าน” ที่หน้าเข้าสู่ระบบแทน"}
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
