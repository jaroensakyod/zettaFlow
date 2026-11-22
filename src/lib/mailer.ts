// The app's own emails (not Supabase Auth's): sent through Resend's HTTP API, no SDK.
// Env: RESEND_API_KEY (from resend.com → API Keys) and MAIL_FROM, e.g. "EliteFlow <noreply@eliteflow-ai.com>"
// (the domain must be verified in Resend). Without a key, mailConfigured() is false and callers fall back to LINE/copy.
import { assert } from "./domain";

export const mailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;

export async function sendMail(m: { to: string; subject: string; html: string; text: string; replyTo?: string }) {
  assert(mailConfigured(), "ยังไม่ได้ตั้งค่าระบบส่งอีเมล (RESEND_API_KEY / MAIL_FROM) · ส่งทาง LINE แทนได้", 503);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error("sendMail", r.status, detail.slice(0, 300));
    assert(false, "ส่งอีเมลไม่สำเร็จ ลองใหม่อีกครั้ง หรือส่งทาง LINE แทน", 502);
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const SITE = () => process.env.NEXT_PUBLIC_APP_URL || "https://eliteflow-ai.com";

/** "คุณได้รับเชิญเข้าใช้งาน …": company, position, a button to the workspace; they sign in with their own email and password. */
export function joinEmail(o: { company: string; email: string; name?: string; position?: string; from?: string }) {
  const url = SITE() + "/workspace/dashboard";
  const hello = o.name ? "สวัสดีค่ะ คุณ" + o.name : "สวัสดีค่ะ";
  const lines = [
    `<b>${esc(o.company)}</b> เปิดสิทธิ์ให้คุณใช้งานระบบ EliteFlow แล้ว`,
    o.position ? `ตำแหน่ง: <b>${esc(o.position)}</b>` : "",
    `เข้าสู่ระบบด้วยอีเมล <b>${esc(o.email)}</b> และรหัสผ่านของคุณ`,
  ].filter(Boolean);
  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>เชิญเข้าใช้งาน EliteFlow</title></head>
<body style="margin:0;padding:0;background:#f5f3fb;font-family:'Noto Sans Thai','Sarabun',Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3fb;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;padding:32px 28px">
<tr><td style="padding-bottom:20px"><img src="${SITE()}/brand/eliteflow-mark.png" width="40" height="40" alt="EliteFlow" style="vertical-align:middle;border-radius:10px"> <span style="font-size:20px;font-weight:700;color:#1f1a35;vertical-align:middle;padding-left:6px">Elite<span style="color:#7c4dff">Flow</span></span></td></tr>
<tr><td style="font-size:22px;font-weight:700;color:#1f1a35;padding-bottom:12px">${esc(hello)}</td></tr>
<tr><td style="font-size:15px;line-height:1.8;color:#3d3756;padding-bottom:22px">${lines.join("<br>")}</td></tr>
<tr><td align="center" style="padding:4px 0 24px"><a href="${url}" style="display:inline-block;background:#7c4dff;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 32px;border-radius:12px">เข้าใช้งานระบบ</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6b6585;padding-bottom:18px">ลืมรหัสผ่าน? กด “ลืมรหัสผ่าน” ที่หน้าเข้าสู่ระบบ · ถ้ามีหลายบริษัท สลับเป็น ${esc(o.company)} ได้ที่เมนูบัญชีมุมขวาบน</td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#8a85a0;border-top:1px solid #eeeaf7;padding-top:16px">อีเมลนี้ส่งจาก EliteFlow ในนาม ${esc(o.company)}${o.from ? " โดย " + esc(o.from) : ""}</td></tr>
</table>
<p style="font-size:12px;color:#a19cb5;margin:16px 0 0">EliteFlow · ระบบบริหารธุรกิจและเครือข่ายบริษัท · <a href="${SITE()}" style="color:#a19cb5">eliteflow-ai.com</a></p>
</td></tr></table></body></html>`;
  const text = [hello, `${o.company} เปิดสิทธิ์ให้คุณใช้งานระบบ EliteFlow แล้ว`, o.position ? "ตำแหน่ง: " + o.position : "", "เข้าใช้งาน: " + url, `เข้าสู่ระบบด้วยอีเมล ${o.email} และรหัสผ่านของคุณ`].filter(Boolean).join("\n");
  return { subject: `${o.company} เชิญคุณเข้าใช้งาน EliteFlow`, html, text };
}
