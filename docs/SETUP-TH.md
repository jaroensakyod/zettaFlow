# ZettaFlow AI — คู่มือตั้งค่าและขึ้นระบบจริง

## 1. รันบนเครื่อง (Demo mode ไม่ต้องมีคีย์)
```bash
npm ci
echo ELITEFLOW_DEMO_MODE=true > .env.local
npm run dev
```
เปิด http://127.0.0.1:3000/zetta/dashboard — ข้อมูลตัวอย่างเก็บใน `.data/` (ลบโฟลเดอร์นี้เพื่อรีเซ็ต)

## 2. Supabase (ฐานข้อมูล + ล็อกอิน + ไฟล์)
1. สร้างโปรเจกต์ที่ supabase.com (Region: Singapore)
2. SQL Editor → รันไฟล์ใน `supabase/migrations/` ตามลำดับ 0001 → 0013 (หรือ `supabase db push`)
3. Authentication → URL Configuration: Site URL = โดเมนจริง, Redirect URL = `https://<โดเมน>/auth/callback`
4. คัดลอก Project URL, Publishable key, Service role key ไปใส่ใน env (ข้อ 5)

> หลังรัน 0013 ทุกบริษัทที่มีอยู่จะได้ทดลองใช้แพ็กเกจ Growth 14 วัน ถ้าต้องการให้ลูกค้าเดิมใช้งานต่อ ให้รันใน SQL Editor:
> `update subscriptions set status='active', current_period_end=now()+interval '1 year';`

## 3. LINE Official Account
1. developers.line.biz → สร้าง Messaging API channel
2. เปิด "Allow bot to join group chats", ปิด Auto-reply
3. Webhook URL = `https://<โดเมน>/api/line/webhook` แล้วกด Use webhook
4. คัดลอก Channel secret และ Channel access token (long-lived)
5. ในเว็บ: Connect LINE → เลือกฟอร์ม → สร้างรหัส → พิมพ์ `#connect …` ในกลุ่ม แล้วผู้จัดการแต่ละคนพิมพ์ `#user …` เพื่อผูกบัญชี
6. ตั้งชื่อกลุ่ม ฟอร์ม และคีย์เวิร์ดอนุมัติ (เช่น `อนุมัติปล่อยของ`) ได้ในหน้า Connect LINE

คำสั่งในกลุ่ม:
- ส่งข้อความ/รูป/PDF → AI สกัดข้อมูลตามฟอร์ม; ถ้าข้อมูลไม่ครบบอทจะทวงถาม (Auto-Nudge) และเตือนซ้ำหลัง 12 ชม.
- ผู้จัดการพิมพ์คีย์เวิร์ด → อนุมัติรายการล่าสุดที่ข้อมูลครบ
- ถามบอท เช่น "มีงานรออนุมัติกี่งาน?", "ยอดขายวันนี้เท่าไร"
- ฟอร์มที่มีฟิลด์รหัส `slip_ref` = ฟอร์มตรวจสลิป: บอทอ่าน QR สลิป ตรวจ checksum และกันสลิปซ้ำ

## 4. AI (ไม่บังคับ)
ใส่ `OPENAI_API_KEY` เพื่ออ่านรูป/PDF, ร่างฟอร์มจากคำอธิบาย และตอบคำถามอิสระ
ถ้าไม่ใส่ ระบบยังใช้งานได้ด้วยรูปแบบ `ชื่อฟิลด์: ค่า` และแม่แบบฟอร์มสำเร็จรูป

## 5. Deploy บน Vercel
ตั้ง Environment Variables:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=https://<โดเมน>
OPENAI_API_KEY=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
CRON_SECRET=<สุ่มยาวๆ>
PLATFORM_ADMIN_EMAILS=<อีเมลผู้ดูแลที่ยืนยันยอดโอน>
```
ห้ามตั้ง `ELITEFLOW_DEMO_MODE` บน production. Cron `/api/cron` รันวันละครั้ง (ประมวลผลคิว, เตือนข้อมูลไม่ครบ, ปิดแพ็กเกจที่หมดอายุ)

## 6. ย้ายจากเว็บเดิม elitflow-38bc4.web.app
- ข้อมูลเดิม: `npx tsx scripts/import-firebase.ts` (dry-run) แล้วเพิ่ม `--apply` เมื่อพร้อม — รหัสผ่านผู้ใช้ย้ายไม่ได้ ผู้ใช้ต้องสมัคร/รีเซ็ตใหม่
- โดเมนเดิม: แก้ Firebase Hosting ให้ redirect ทุก path ไปโดเมน Vercel ใหม่ (`firebase.json` → `"redirects": [{"source":"**","destination":"https://<โดเมน>","type":301}]`)
- ระหว่างย้าย ควรปิดสิทธิ์เขียนใน Firestore rules ของเว็บเดิม (เว็บเดิมให้ผู้ใช้แก้ coins/role ตัวเองจากฝั่ง browser ได้ถ้า rules ไม่กัน)

## 7. แพ็กเกจและการชำระเงิน
- บริษัทใหม่ได้ทดลอง Growth 14 วันอัตโนมัติ; หมดแล้วระบบหยุดรับเอกสารใหม่ (ข้อมูลเดิมยังดูได้)
- โควตา Template / กลุ่ม LINE / ผู้ใช้ บังคับในฐานข้อมูล; เอกสารเกินโควตาไม่ถูกบล็อก แต่คิดส่วนเกินรอบถัดไป
- เจ้าของบริษัทโอนเงินแล้วอัปโหลดสลิปในหน้า Subscription → ผู้ดูแลแพลตฟอร์ม (`PLATFORM_ADMIN_EMAILS`) กด "ยืนยันยอดเข้า" → แพ็กเกจเปิดใช้งาน
- ยังไม่มี payment gateway อัตโนมัติ (บัตร/PromptPay QR) — เพิ่มได้ภายหลังเมื่อมีบัญชี Omise/2C2P/Stripe
