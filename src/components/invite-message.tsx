"use client";
// After inviting someone: whether an email went out, and a ready message to send them on LINE (copy button).
import { useState } from "react";
import { Check, Copy, MailCheck, MailWarning } from "lucide-react";

export type InviteResult = { emailed?: boolean; existing?: boolean; demo?: boolean };

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

export function InviteMessage({ company, email, result }: { company: string; email: string; result?: InviteResult | null }) {
  const [copied, setCopied] = useState(false);
  const text = inviteText(company, email, result?.existing);
  return (
    <div className="invite-msg">
      {result && (
        <p className={"invite-msg-status" + (result.emailed ? " ok" : "")}>
          {result.emailed ? <MailCheck size={15} /> : <MailWarning size={15} />}
          {result.emailed
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
    </div>
  );
}
