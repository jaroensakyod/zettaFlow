import { test } from "node:test";
import assert from "node:assert/strict";
import { joinEmail, mailConfigured, sendMail } from "../src/lib/mailer";

test("invitation email: company, position, button, escaped; sent through Resend", async () => {
  const m = joinEmail({ company: "บริษัท <ทดสอบ>", email: "a@b.co", name: "สมชาย", position: "ฝ่ายขาย" });
  assert.match(m.subject, /บริษัท <ทดสอบ> เชิญคุณเข้าใช้งาน EliteFlow/);
  assert.ok(m.html.includes("บริษัท &lt;ทดสอบ&gt;") && !m.html.includes("<ทดสอบ>"));
  assert.ok(m.html.includes("ตำแหน่ง: <b>ฝ่ายขาย</b>") && m.html.includes("/workspace/dashboard") && m.html.includes("เข้าใช้งานระบบ"));
  assert.match(m.text, /สวัสดีค่ะ คุณสมชาย/);

  delete process.env.RESEND_API_KEY;
  assert.equal(mailConfigured(), false);
  await assert.rejects(sendMail({ to: "a@b.co", ...m }), /ยังไม่ได้ตั้งค่าระบบส่งอีเมล/);

  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM = "EliteFlow <noreply@eliteflow-ai.com>";
  const calls: { url: string; init: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await sendMail({ to: "a@b.co", replyTo: "owner@b.co", ...m });
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual([body.from, body.to, body.subject, body.reply_to], ["EliteFlow <noreply@eliteflow-ai.com>", ["a@b.co"], m.subject, "owner@b.co"]);
    globalThis.fetch = (async () => new Response("bad", { status: 422 })) as typeof fetch;
    await assert.rejects(sendMail({ to: "a@b.co", ...m }), /ส่งอีเมลไม่สำเร็จ/);
  } finally {
    globalThis.fetch = real;
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
  }
});
