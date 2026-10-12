# EliteFlow 2 — Next.js + Supabase

ระบบ EliteFlow และ ZettaFlow AI ในโปรเจกต์เดียว พร้อมนำไป deploy บน Vercel

ZettaFlow มีหน้าจอแยกที่ `/zetta/dashboard` และ `/zetta/spaces` พร้อมหน้ารายละเอียดโครงการ ระบบเวอร์ชัน Layout/Perspective, comments และ approval อ่าน [รายการเทียบกับ Canva](CANVA-PARITY.md) สำหรับส่วนที่ทำแล้วและยังต้องทำต่อ ไม่อ้างว่าครบหรือเหมือนต้นฉบับ 100% ในรุ่นนี้

## เริ่มบนเครื่อง

ต้องใช้ Node.js 22 ขึ้นไป

```powershell
npm ci
$env:ELITEFLOW_DEMO_MODE='true'
npm run dev
```

เปิด http://127.0.0.1:3000 โหมด Demo มีข้อมูลทดสอบที่ระบุชัดในหน้าเว็บ และบันทึกการทดสอบใน .data/eliteflow-demo.json ไม่ใช่ข้อมูล Firebase เดิม Demo ถูกปิดเสมอเมื่อรันบน Vercel

สำหรับ Supabase จริง คัดลอก .env.example เป็น .env.local เติมค่าแล้วปิด ELITEFLOW_DEMO_MODE

```powershell
npm run typecheck
npm test
npm run build
npm start
```

## โมดูลธุรกิจ

- ลูกค้า, Dealer/สาขา, ซัพพลายเออร์ และโปรไฟล์บริษัท
- พนักงาน, ฟรีแลนซ์, การลา และค่าจ้างสุทธิ
- ดีลพื้นที่ขาย, โครงการ, อีเวนต์, งาน และบอร์ด Workflow
- ทรัพย์สิน, ไฟล์แนบ และคลังเอกสาร
- สินค้า, SKU, จุดแจ้งเตือนสต็อก และรายการรับ–จ่าย
- ใบสั่งซื้อ: อนุมัติ → รับสินค้า → เพิ่มสต็อกได้ครั้งเดียว
- ยอดขาย, ค่าใช้จ่าย, ใบแจ้งหนี้ และการบันทึกรับ–จ่าย
- ใบแจ้งหนี้คำนวณ VAT และยอดค้างจากรายการรับชำระ; ป้องกันยอดรับเกิน
- แผนก Marketing, IT/Customer Service และทะเบียนสัญญา
- Dashboard, Calendar, แชทแผนก, รายงาน CSV, Module Library และการเลือกธีม

รายการทั่วไปเพิ่ม แก้ไข ค้นหา แบ่งหน้า เก็บเข้าคลัง และคืนจากคลังได้ตามสิทธิ์ ข้อมูลที่เป็น ledger เช่นการรับสินค้าและรายการชำระเงินมีข้อจำกัดเพิ่มเติมเพื่อรักษายอด

## ZettaFlow AI

สร้าง/แก้ไข Data Template, รับข้อความหรือภาพ/PDF, ตรวจทาน, อนุมัติและสร้างงานแผนก, แสดงการ์ดตัวเลขตาม Template, LINE group/user pairing, อนุมัติผ่านคำสั่งจากบัญชีที่เชื่อมแล้ว, notification outbox และ AI Assistant แบบอ่านข้อมูล

ถ้าไม่มี AI key ระบบจะอ่านเฉพาะข้อความ **ชื่อฟิลด์: ค่า** และแสดงว่าเป็นโหมดพื้นฐาน ผู้ช่วยจะสรุปจากฐานข้อมูล ไม่แสร้งว่าเรียก AI แล้ว

## Supabase / Vercel

1. สร้าง Supabase project ใหม่
2. รัน [supabase/schema.sql](supabase/schema.sql) ครั้งเดียวใน SQL Editor
3. ตั้ง Supabase URL, publishable key และ service-role key เป็น environment variables
4. ตั้ง Auth Site URL / Redirect URLs ให้ตรงโดเมน Vercel และ /auth/callback
5. Import repo บน Vercel เลือก Next.js และ deploy จาก root ของ repo

รายละเอียดทั้งหมดอยู่ใน [DEPLOYMENT.md](DEPLOYMENT.md)

## สิทธิ์และฐานข้อมูล

Owner / Manager / Staff / Viewer แยกสิทธิ์ตามบริษัทและแผนก มีทั้งการตรวจใน API และ Postgres RLS สมาชิกไม่สามารถแก้ role, company หรือยอดสต็อกด้วยการยิง update เข้า table โดยตรง การเขียนใช้ RPC ที่ตรวจสิทธิ์และบันทึก audit

Stock movement, การรับสินค้า, การรับชำระ และการอนุมัติใช้ transaction ใน Postgres มี optimistic version checking และป้องกันเลขอ้างอิงซ้ำ

บัญชีสร้างบริษัทเพิ่มหรือรับคำเชิญหลายบริษัทได้ ผ่านตัวเลือกบริษัทด้านซ้าย คำเชิญอายุ 7 วัน ผู้รับต้องใช้ email เดียวกัน **ยังไม่ส่งอีเมลคำเชิญอัตโนมัติ**

## โครงสร้าง

```text
src/app/               Next.js pages / API routes / auth callback
src/components/        EliteFlow และ ZettaFlow UI
src/lib/               validation, permissions, Supabase, queue, file handling
supabase/migrations/   schema, RLS และ transaction functions
supabase/schema.sql    SQL รวมสำหรับ project ใหม่
scripts/               schema generation / Firebase JSON import
 tests/                domain และ Postgres/RLS tests
archive/               implementation Node/Firebase จากรุ่นแรก เก็บอ้างอิง
*.html เดิม             source EliteFlow เดิม ไม่ได้เผยแพร่โดย Next.js
```

## การย้ายข้อมูลเดิม

มี [scripts/import-firebase.ts](scripts/import-firebase.ts) สำหรับ JSON export ที่ผู้ดูแลเตรียมเอง ค่าเริ่มต้นเป็น dry-run ต้องระบุ Firebase owner UID และ Supabase company UUID ใช้ --apply เพื่อเขียนจริง ไม่มีการย้ายหรือลบข้อมูล Firebase โดยอัตโนมัติ

ฟิลด์เดิมเก็บใน legacy_data เพื่อไม่หายเมื่อแก้ข้อมูลผ่านฟอร์มใหม่ ยังต้อง export บัญชี/ข้อมูล/ไฟล์จากบริการเดิมและตรวจยอดจริงก่อนย้าย ผู้ใช้ Firebase ต้องสมัครหรือ reset บัญชี Supabase ไม่ได้นำรหัสผ่านเข้าระบบนี้

## ข้อจำกัดที่ต้องตั้งค่าหรือเชื่อมเพิ่มเติม

- ยังไม่ได้ deploy หรือทดสอบกับ Supabase/LINE/AI ของบัญชีจริง ไม่มี credentials เหล่านี้ใน repo
- ไฟล์ผ่าน Vercel route สูงสุด 4 MB; AI อ่านเฉพาะภาพ/PDF
- แชท polling 5 วินาที, ภาพรวม polling 30 วินาที, queue ใช้ Next after() พร้อม lease และ cron recovery
- Cron ที่แนบใช้วันละครั้งเพื่อรองรับ Vercel Hobby; งานปกติเริ่มทันทีหลังส่งข้อมูล หากต้องการ recovery ถี่ให้ปรับ cron ตาม plan
- CSV ส่งออกสูงสุด 10,000 รายการต่อครั้ง และ dropdown อ้างอิงโหลดสูงสุด 1,000 รายการ
- หน้าแพ็กเกจเป็นแผนราคา ยังไม่เชื่อม billing gateway/automatic subscription; การชำระเงินใน EliteFlow คือบันทึกบัญชีรับ–จ่าย
- ยังไม่เชื่อม ERP/Sheets/POS ภายนอก, ตรวจสลิปธนาคาร, dashboard shared links หรือรับรองมาตรฐาน ISO/SOC2
- ค่าจ้างเป็น base + allowance - deduction; ไม่ใช่เครื่องยนต์คำนวณภาษีและประกันสังคมอัตโนมัติ

อ่านสถานะการย้ายและการทดสอบใน [ANALYSIS.md](ANALYSIS.md)

### การเชื่อมข้อมูลที่อนุมัติ

Template ที่มีขั้นตอน Workflow และฟิลด์ project จะจับคู่ชื่อโครงการที่ตรงกันแบบไม่สนตัวพิมพ์ หรือสร้างโครงการใหม่ ชื่อซ้ำจะถูกปฏิเสธจนระบุ project_id ใน Template ฟิลด์ project/location/rent ในแผนก Business Development สร้างดีลพื้นที่ที่อนุมัติแล้วและเชื่อมกับโครงการ งานทุกแผนกผูก projectId และ ingestionId เพื่อย้อนดูต้นทางได้
