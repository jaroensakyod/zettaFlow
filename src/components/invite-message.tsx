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

/** Joined members who can't get in: how to sign in (copy for LINE) and a button to email a password link. */
export const loginText = (company: string, email: string) =>
  `วิธีเข้าใช้ระบบ EliteFlow ของ ${company}
` +
  `1. เข้า https://eliteflow-ai.com แล้วเข้าสู่ระบบด้วยอีเมล ${email}
` +
  `2. ลืมรหัสผ่าน: กด "ลืมรหัสผ่าน" ที่หน้าเข้าสู่ระบบ หรือเปิดอีเมลลิงก์ตั้งรหัสผ่านที่ส่งไป แล้วตั้งรหัสใหม่
` +
  `3. ถ้ามีหลายบริษัท สลับเป็น ${company} ได้ที่เมนูบัญชีมุมขวาบน`;

export function LoginHelp({ company, email, memberId, onSent }: { company: string; email: string; memberId: string; onSent?: (r: InviteResult) => void }) {
  const [copied, setCopied] = useState(false),
    [result, setResult] = useState<InviteResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const text = loginText(company, email);
  return (
    <div className="invite-msg login-help">
      <b className="login-help-title">ช่วยพนักงานเข้าระบบ</b>
      <small>พนักงานลืมรหัสผ่านหรือเข้าระบบไม่ถูก ส่งลิงก์ทางอีเมลหรือคัดลอกข้อความส่ง LINE ได้ทุกเมื่อ</small>
      {result && (
        <p className={"invite-msg-status" + (result.emailed ? " ok" : "")}>
          {result.emailed ? <MailCheck size={15} /> : <MailWarning size={15} />}
          {result.emailed
            ? `ส่งลิงก์ตั้งรหัสผ่านและเข้าสู่ระบบไปที่ ${email} แล้ว`
            : result.demo
              ? "โหมดตัวอย่างไม่ส่งอีเมลจริง · ส่งข้อความด้านล่างให้พนักงานแทน"
              : "ส่งอีเมลไม่สำเร็จ ส่งข้อความด้านล่างให้พนักงานแทน"}
        </p>
      )}
      <pre>{text}</pre>
      <div className="invite-msg-actions">
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
        <button
          type="button"
          className="secondary"
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
          <Send size={15} /> {busy ? "กำลังส่ง…" : "ส่งลิงก์เข้าสู่ระบบทางอีเมล"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
