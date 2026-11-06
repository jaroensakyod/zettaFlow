// EliteFlow-branded Supabase Auth emails (Thai). Paste each into Supabase → Authentication → Emails,
// or run `npx tsx scripts/email-templates.ts` to print them. Table layout + inline styles for mail clients.
const LOGO = "https://eliteflow-ai.com/brand/eliteflow-mark.png";

function layout(o: { title: string; intro: string; button?: { label: string; url: string }; code?: boolean; note: string }) {
  const button = o.button
    ? `<tr><td align="center" style="padding:8px 0 24px"><a href="${o.button.url}" style="display:inline-block;background:#7c4dff;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 32px;border-radius:12px">${o.button.label}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6b6585;padding-bottom:20px">ถ้าปุ่มกดไม่ได้ ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์<br><a href="${o.button.url}" style="color:#7c4dff;word-break:break-all">${o.button.url}</a></td></tr>`
    : "";
  const code = o.code
    ? `<tr><td align="center" style="padding:4px 0 24px"><div style="display:inline-block;font-size:30px;letter-spacing:8px;font-weight:700;color:#1f1a35;background:#f4f0ff;border-radius:12px;padding:14px 26px">{{ .Token }}</div></td></tr>`
    : "";
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${o.title}</title></head>
<body style="margin:0;padding:0;background:#f5f3fb;font-family:'Noto Sans Thai','Sarabun',Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3fb;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;padding:32px 28px">
<tr><td style="padding-bottom:20px"><img src="${LOGO}" width="40" height="40" alt="EliteFlow" style="vertical-align:middle;border-radius:10px"> <span style="font-size:20px;font-weight:700;color:#1f1a35;vertical-align:middle;padding-left:6px">Elite<span style="color:#7c4dff">Flow</span></span></td></tr>
<tr><td style="font-size:22px;font-weight:700;color:#1f1a35;padding-bottom:12px">${o.title}</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#3d3756;padding-bottom:20px">${o.intro}</td></tr>
${button}${code}
<tr><td style="font-size:13px;line-height:1.6;color:#8a85a0;border-top:1px solid #eeeaf7;padding-top:16px">${o.note}</td></tr>
</table>
<p style="font-size:12px;color:#a19cb5;margin:16px 0 0">EliteFlow · ระบบบริหารธุรกิจและเครือข่ายบริษัท · <a href="https://eliteflow-ai.com" style="color:#a19cb5">eliteflow-ai.com</a></p>
</td></tr></table>
</body></html>`;
}

const ignore = "ถ้าคุณไม่ได้เป็นผู้ขอ ไม่ต้องทำอะไร อีเมลนี้จะไม่มีผลกับบัญชีของคุณ";

/** Keyed by the Supabase template page slug. */
export const templates: Record<string, { subject: string; body: string }> = {
  "reset-password": {
    subject: "ตั้งรหัสผ่านใหม่ – EliteFlow",
    body: layout({
      title: "ตั้งรหัสผ่านใหม่",
      intro: "เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี {{ .Email }} กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุภายใน 1 ชั่วโมง",
      button: { label: "ตั้งรหัสผ่านใหม่", url: "{{ .ConfirmationURL }}" },
      note: ignore,
    }),
  },
  "confirm-sign-up": {
    subject: "ยืนยันอีเมลเพื่อเริ่มใช้ EliteFlow",
    body: layout({
      title: "ยืนยันอีเมลของคุณ",
      intro: "ขอบคุณที่สมัคร EliteFlow กดปุ่มด้านล่างเพื่อยืนยันอีเมล {{ .Email }} แล้วเข้าสู่ระบบเพื่อเริ่มสร้าง workspace ของบริษัทได้เลย",
      button: { label: "ยืนยันอีเมล", url: "{{ .ConfirmationURL }}" },
      note: "ถ้าคุณไม่ได้สมัคร EliteFlow ไม่ต้องทำอะไร บัญชีจะไม่ถูกเปิดใช้งาน",
    }),
  },
  "invite-user": {
    subject: "คุณได้รับคำเชิญเข้าร่วม EliteFlow",
    body: layout({
      title: "คุณได้รับคำเชิญเข้าทีม",
      intro: "มีผู้เชิญอีเมล {{ .Email }} เข้าร่วม workspace บน EliteFlow กดปุ่มด้านล่างเพื่อตอบรับคำเชิญและตั้งค่าบัญชีของคุณ",
      button: { label: "ตอบรับคำเชิญ", url: "{{ .ConfirmationURL }}" },
      note: "ถ้าคุณไม่รู้จักผู้เชิญ ไม่ต้องทำอะไรกับอีเมลนี้",
    }),
  },
  "magic-link": {
    subject: "ลิงก์เข้าสู่ระบบ EliteFlow",
    body: layout({
      title: "เข้าสู่ระบบ EliteFlow",
      intro: "กดปุ่มด้านล่างเพื่อเข้าสู่ระบบด้วยอีเมล {{ .Email }} หรือใช้รหัสนี้ ลิงก์และรหัสใช้ได้ครั้งเดียว",
      button: { label: "เข้าสู่ระบบ", url: "{{ .ConfirmationURL }}" },
      code: true,
      note: ignore,
    }),
  },
  "change-email-address": {
    subject: "ยืนยันอีเมลใหม่ – EliteFlow",
    body: layout({
      title: "ยืนยันการเปลี่ยนอีเมล",
      intro: "มีคำขอเปลี่ยนอีเมลของบัญชี EliteFlow จาก {{ .Email }} เป็น {{ .NewEmail }} กดปุ่มด้านล่างเพื่อยืนยัน",
      button: { label: "ยืนยันอีเมลใหม่", url: "{{ .ConfirmationURL }}" },
      note: "ถ้าคุณไม่ได้ขอเปลี่ยนอีเมล กรุณาเปลี่ยนรหัสผ่านทันที",
    }),
  },
  reauthentication: {
    subject: "รหัสยืนยันตัวตน – EliteFlow",
    body: layout({
      title: "รหัสยืนยันตัวตน",
      intro: "ใช้รหัสนี้เพื่อยืนยันว่าเป็นคุณก่อนทำรายการสำคัญในบัญชี {{ .Email }}",
      code: true,
      note: ignore,
    }),
  },
};

if (process.argv[1]?.endsWith("email-templates.ts")) console.log(JSON.stringify(templates));
