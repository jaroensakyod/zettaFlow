# Deploy EliteFlow บน Vercel + Supabase

## 1. เตรียม Supabase

สร้าง **project ใหม่** สำหรับ EliteFlow / ZettaFlow เลือก region ใกล้ Vercel sin1 (Singapore) แล้วเปิด SQL Editor รัน **supabase/schema.sql** ครั้งเดียว ไฟล์นี้รวม migrations 0001–0012 แล้ว หากใช้ Supabase CLI ให้ใช้ migrations แทน ห้ามรัน SQL รวมซ้ำหลัง migration ไปแล้ว

หากรันถึง 0008 ให้รัน 0009–0012 ตามลำดับ. หากถึง 0009 แล้วให้รันเฉพาะ 0010–0012: fields/CRM, project stages, procurement/stock transfers. อย่ารัน SQL รวมซ้ำ

ZettaFlow เข้าได้ที่ `/zetta/dashboard` มีทางเข้าใน sidebar ของ EliteFlow ผู้ใช้ Design ต้องมีสิทธิ์ Design และสิทธิ์อ่าน Operations เพื่อเปิดโครงการ; ผู้อนุมัติต้องเป็น Owner หรือ Manager ที่มีสิทธิ์ Design ไฟล์ Design ผูกกับโครงการโดยยังเก็บสิทธิ์แผนก Design

Schema สร้างบริษัท สมาชิก คำเชิญ records สต็อก chat เอกสาร Templates jobs LINE mapping และ audit พร้อม RLS และ RPC สำหรับ transaction

SQL tests ใน repo ใช้ PostgreSQL ผ่าน PGlite โดยจำลอง auth/storage schemas ของ Supabase ไม่ใช่การทดสอบบน project Cloud ของคุณ

## 2. ตั้งค่า Authentication

- เปิด Email/Password และ Email confirmation
- Site URL = https://YOUR_DOMAIN
- Redirect URL = https://YOUR_DOMAIN/auth/callback
- Recovery redirect = https://YOUR_DOMAIN/auth/callback?next=/reset-password
- สำหรับ local เพิ่ม http://127.0.0.1:3000/auth/callback
- ตั้ง SMTP ถ้าต้องการส่งอีเมล production ในปริมาณที่เกินข้อจำกัดผู้ให้บริการ

ผู้ใช้สมัคร → ยืนยันอีเมล → เข้าสู่ระบบ → สร้างบริษัท Owner จากนั้นเชิญ Manager / Staff / Viewer ตามแผนก ให้ผู้รับสมัครหรือเข้าสู่ระบบด้วย email เดียวกัน ระบบจะรับคำเชิญที่ยังไม่หมดอายุ เลือกบริษัทได้จากด้านซ้าย

บริษัทใหม่เริ่มด้วยข้อมูลว่าง ไม่ใช้ sample data โหมด Demo

## 3. Import repo บน Vercel

- Repository: sirisoaa-Git/dist
- Branch ที่มีงาน: codex/zettaflow-core (หรือ main หลัง merge PR)
- Framework Preset: Next.js
- Root Directory: root ของ repo
- Build Command: npm run build
- Install Command: npm ci
- Node.js: 24 (รองรับ 22 ขึ้นไป)
- ไม่กำหนด Output Directory เป็น public หรือ dist

ใช้ Environment Variables จากตาราง ไม่ส่ง secret เข้า Git หรือช่องแชท

| Variable                             | ใช้ทำอะไร                                                        | ต้องมี                      |
| ------------------------------------ | ---------------------------------------------------------------- | --------------------------- |
| NEXT_PUBLIC_SUPABASE_URL             | Project URL                                                      | ต้องมี                      |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Publishable key (หรือ anon key ของ project เดิม)                 | ต้องมี                      |
| SUPABASE_SERVICE_ROLE_KEY            | Worker, LINE webhook และ service operations ฝั่ง server เท่านั้น | ต้องมีสำหรับ ZettaFlow/LINE |
| NEXT_PUBLIC_APP_URL                  | URL หลัก เช่น https://eliteflow.vercel.app                       | ต้องมี                      |
| ELITEFLOW_DEMO_MODE                  | false                                                            | ปิดบน Cloud                 |
| OPENAI_API_KEY                       | AI extraction และ assistant                                      | ถ้าใช้ AI                   |
| OPENAI_MODEL                         | ค่าเริ่มต้น gpt-4.1-mini                                         | เลือกตาม provider account   |
| LINE_CHANNEL_SECRET                  | ตรวจ webhook signature                                           | ถ้าใช้ LINE                 |
| LINE_CHANNEL_ACCESS_TOKEN            | ดาวน์โหลดไฟล์และส่ง notification                                 | ถ้าใช้ LINE                 |
| CRON_SECRET                          | สุ่ม secret สำหรับ /api/cron                                     | ถ้าเปิด cron recovery       |

หลัง Deploy ครั้งแรก ให้นำ URL ที่ได้ใส่ APP_URL และ Auth redirect settings แล้ว redeploy

Service-role key **ไม่มี NEXT*PUBLIC* prefix** ไม่อยู่ใน browser bundle คำขอผู้ใช้ปกติใช้ publishable key และ session ของผู้ใช้งานเพื่อให้ RLS ทำงาน ไม่ใช้ service-role bypass ใน CRUD ของผู้ใช้

## 4. Storage

Migration สร้าง private bucket eliteflow-files และ policies ที่ตรวจบริษัท/แผนก path ใช้ company UUID / department / file UUID

อัปโหลดผ่าน API สูงสุด 4 MB เพื่ออยู่ภายใน request limit ของ Vercel ดาวน์โหลดต้องผ่าน API ที่ตรวจ session/RLS เอกสารไม่เปิด public URL

ชนิดไฟล์ที่รองรับในรุ่นนี้: PNG, JPEG, WebP, PDF, TXT, CSV, XLSX; AI รับเฉพาะภาพ/PDF ไม่ควรนำข้อมูลจริงส่ง provider จนองค์กรตั้งค่าการใช้ provider นั้นแล้ว

## 5. Queue และ Cron

Web submission บันทึก job ใน Postgres แล้วใช้ Next after() ประมวลผลใน invocation เดิม งานมี lease, attempts และ stale-result checks ไม่มี timer/server process ที่ต้องเปิดค้าง

OCR result และ notification outbox ถูกบันทึกใน transaction เดียวกัน Cron เรียก /api/cron โดยใช้ Authorization: Bearer CRON_SECRET เพื่อกู้ queue และ retry notification

vercel.json ตั้งวันละครั้งเพื่อรองรับ Hobby งานปกติไม่ต้องรอ cron ถ้า instance หยุดก่อน after() เสร็จ งานที่ค้างจะกู้คืนด้วย lease/cron หรือเมื่อเปิด Data Inbox อีกครั้ง สำหรับการใช้งานที่ต้อง recovery เร็ว ตั้ง cron ให้ถี่ขึ้นตาม Vercel plan หรือใช้ scheduler ของ Supabase

Routes กำหนด maxDuration 300 วินาที ใช้ Fluid compute jobs เป็นชุดเล็ก และ AI timeout 45 วินาที มี retry button สำหรับงาน failed

## 6. เชื่อม LINE

1. สร้าง/ใช้ LINE Messaging API Channel และให้บอทเข้ากลุ่มได้
2. ตั้ง webhook https://YOUR_DOMAIN/api/line/webhook แล้วใช้ Verify และ Use webhook
3. Owner สร้าง Data Template ในเว็บ
4. เข้า LINE & Integrations เลือก Template และสร้างรหัสเชื่อมกลุ่ม
5. ส่ง #connect TOKEN ในกลุ่ม LINE ที่มีบอทภายใน 10 นาที
6. Owner/Manager/Staff สร้างรหัสเชื่อมบัญชี แล้วส่ง #user TOKEN จาก LINE ของตัวเองในกลุ่มที่เชื่อมแล้ว
7. ส่งข้อความ หรือภาพ/PDF ระบบสกัดข้อมูลแล้วแจ้งข้อมูลที่ขาด/รายการรอตรวจทาน
8. อนุมัติในเว็บ หรือ #approve RECORD_UUID จากบัญชีที่เชื่อมและมีสิทธิ์ Owner/Manager ในแผนกนั้น

กลุ่มที่เชื่อมบริษัทอื่นไม่สามารถถูกยึดด้วย token ของบริษัทใหม่ได้ Approval ตรวจ group, linked user, membership, disabled และ department ในฐานข้อมูล ไม่ใช้ AI ตัดสินสิทธิ์

## 7. ย้ายข้อมูล Firebase

Source HTML เดิมยังเก็บใน repo และ implementation รุ่นแรกอยู่ใน archive ไม่ได้ลบหรือแก้ Firebase data เดิม

เตรียม JSON export จากผู้ดูแลในรูป:

```json
{
  "customers": [
    {
      "id": "OLD_ID",
      "data": { "companyId": "FIREBASE_UID", "cust_name": "ลูกค้าทดสอบ" }
    }
  ]
}
```

รองรับ customers, dealers, employees, freelancers, projects, dealAreas, companyAssets เลือก source companyId ก่อน createdBy เสมอ เพื่อไม่ดึงข้อมูลบริษัทอื่นที่ใช้ creator เดียวกัน

```powershell
npx tsx scripts/import-firebase.ts --input export.json --company TARGET_COMPANY_UUID --source-owner FIREBASE_UID
# อ่านจำนวนและแก้ validation errors ก่อนเพิ่ม --apply
npx tsx --env-file=.env.local scripts/import-firebase.ts --input export.json --company TARGET_COMPANY_UUID --source-owner FIREBASE_UID --apply
```

ID นำเข้าสร้างแบบ deterministic rerun ไม่ทับ records ที่แก้ไขแล้ว ฟิลด์ดิบเดิมอยู่ใน legacy_data แยกจากฟอร์มใหม่ deptStatus ของโครงการเดิมสร้าง tasks ตามแผนกได้

ต้องตรวจสัมพันธ์ Dealer/Projects และจัดการ JSON validation errors ก่อน apply บัญชีผู้ใช้ รหัสผ่าน coins/store entitlement และไฟล์ binary/subcollections ไม่ถูกย้ายอัตโนมัติ ให้สมัคร Supabase ใหม่และย้ายไฟล์ผ่าน Storage ตามสิทธิ์

เก็บ backup ของ export เดิม ตรวจ counts/ตัวอย่าง/ยอดธุรกิจบน staging แล้วค่อยเปลี่ยนโดเมนจริง

## 8. ตรวจหลัง deploy

- บัญชีสองบริษัท: ไม่เห็นหรือแก้ข้อมูลกัน
- Manager/Staff/Viewer: ทำได้เฉพาะแผนกและบทบาท
- PO approve → receive: stock เพิ่มครั้งเดียว; out มากกว่าคงเหลือต้องถูกปฏิเสธ
- Invoice รับชำระบางส่วน/ครบ/เกิน: ยอดและสถานะตรง; เกินยอด rollback
- ดีลอนุมัติครั้งเดียวสร้างงาน 5 แผนกครั้งเดียว
- ภาพ/PDF และต้นฉบับดาวน์โหลดได้เฉพาะผู้มีสิทธิ์
- LINE webhook signature/redelivery, OCR missing fields และ linked-user approval
- งานที่ค้างและ notification retry กลับมาทำงานหลัง lease หมด

ยังไม่ได้รันทดสอบกับ Supabase, LINE หรือ AI account จริงในงานนี้ ต้องทำ acceptance checks เหล่านี้หลังตั้งค่า project

อ้างอิง: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Next after()](https://nextjs.org/docs/app/api-reference/functions/after), [Vercel limits](https://vercel.com/docs/functions/limitations), [LINE signatures](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)

## Workflow และคลังสินค้าเพิ่มเติม

หน้า public `/` และ `/zetta`; ระบบ `/zetta/dashboard`; EliteFlow `/eliteflow`. Dashboard แผนก: purchasing, warehouse, finance, sales, marketing, design, crm.

โครงการอยู่ในแผนก Operations. ผู้ใช้ที่ดู/แก้ stages หรือโอนสินค้าให้โครงการต้องมีสิทธิ์อ่าน Operations และสิทธิ์แผนกของ stage / Warehouse ด้วย. Owner อ่านและเขียนทุกแผนก; Viewer เปลี่ยนสถานะไม่ได้. Contract/payment/layout/close ที่เสร็จแล้วต้องยืนยันโดย Owner/Manager. Layout ต้องมีเวอร์ชันล่าสุด approved ก่อนจบ; Close ต้องจบอีก 9 ขั้นก่อน.

`products.data.stock` เป็นยอดคลังกลาง. `project_inventory` เป็นยอดที่จัดไปโครงการ. ยอดบริษัท = คลังกลาง + ยอดโครงการ; transfer เปลี่ยนตำแหน่งสินค้าโดยไม่เปลี่ยนยอดรวม. การขายเดิมยังออกจากคลังกลาง ไม่หัก project allocation อัตโนมัติ. ทดสอบ workflow ของการขายจริงก่อนใช้งานร่วมกันใน production.

ตรวจหลัง upgrade: สร้างโครงการได้ 10 stages, stale version ถูกปฏิเสธ, รับ PO ไม่ได้ซ้ำ, โอนไม่เกินต้นทาง, reference ซ้ำถูกปฏิเสธ และบัญชีต่างบริษัทไม่อ่าน stock ledger/allocations/stages ได้.
