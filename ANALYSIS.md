# สถานะ EliteFlow 2 / ZettaFlow

13 ตุลาคม 2026: เพิ่มหน้าจอ ZettaFlow แยกจาก EliteFlow ตามโครงหน้า Canva 7/10/11 และเพิ่ม design revision/review/comment หลังบ้าน (migration 0009) ดู `CANVA-PARITY.md` สำหรับข้อแตกต่างและฟีเจอร์ที่ยังไม่ครบตามคำขอ 100%

อัปเดต 12 ตุลาคม 2026 หลังเปลี่ยน stack ตามผู้ใช้เป็น Next.js + Supabase สำหรับ Vercel

## ผลวิเคราะห์ source เดิม

Repo เดิมเป็น HTML + Firebase client SDK หลายโมดูลมี CRUD แล้ว แต่พนักงาน สต็อก Supplier Task แผนกต่างๆ Payment Pricing และ AI Assistant เป็นไฟล์ว่าง ไม่มี backend หรือ database rules ใน checkout ที่ตรวจได้ ลิงก์ freelance.html/event.html ไม่ตรงชื่อไฟล์จริง และ chat มีสอง schemas

Canva ZettaFlow AI ต้องการ Dynamic Templates, LINE ingestion, AI/OCR, review/approval, department workflow, dashboard, multi-tenant roles, integrations และแผนรายเดือน เว็บจริงยังเป็น EliteFlow Firebase

## สิ่งที่เปลี่ยน

เปลี่ยน entry point เป็น Next.js App Router + TypeScript และใช้ Supabase Auth/Postgres/Storage ใน production การติดตั้ง Firebase/Node server รุ่นแรกถูกถอดออกจาก runtime และเก็บ reference ใน archive

Data model ใช้ company/memberships/entities/stock ledger/messages/attachments/audit/templates/ingestions/outbox แยกรายการ แทน state บริษัททั้งก้อน ไม่ใช้ข้อจำกัดเดิม 500 records ต่อบริษัท

## ฟังก์ชัน EliteFlow ที่มี

22 โมดูลข้อมูลธุรกิจ พร้อม schema validation, CRUD, search, pagination, archive/restore และไฟล์แนบตามสิทธิ์: ลูกค้า, Dealer, Supplier, พนักงาน, ฟรีแลนซ์, โครงการ, ดีล, อีเวนต์, งาน, ทรัพย์สิน, สินค้า, จัดซื้อ, ยอดขาย, ค่าใช้จ่าย, ใบแจ้งหนี้, รับ–จ่าย, Marketing, IT/CS Ticket, สัญญา, การลา, ค่าจ้าง และคลังเอกสาร

มี Dashboard, Calendar, Project/Task board, แชทแผนก, CSV reports, บริษัท/ธีม/ชื่อแบรนด์, invitation/access control, company switcher และ Module Library

Stock และการรับ PO เป็น transaction ไม่สามารถจ่ายเกินคงเหลือหรือรับซ้ำ Invoice/VAT/รับชำระคำนวณยอดใน SQL โดยรวมจาก payment ledger และ rollback ถ้าเกินยอด ดีลที่อนุมัติสร้างโครงการและงาน Design/Purchasing/Warehouse/Marketing/Sales ครั้งเดียว

## ZettaFlow

มี Template create/edit และ schema snapshot, Web/LINE text-image-PDF ingestion, queue leases, review/approve/reject, task generation ที่ผูกโครงการ/ดีล, dynamic numeric widgets, read-only assistant, group/user pairing, LINE explicit approval และ notification outbox

ถ้าไม่ได้ตั้งค่า AI key จะใช้ explicit field parsing และ database summary โดยแสดงโหมดจริงบน UI

## การทดสอบ

- TypeScript / production build
- Domain tests: ครบทุก module create schema, date/number validation, role/dept, stock, missing fields และ CSV formula protection
- PostgreSQL tests ผ่าน PGlite: รัน migrations, tenant/RLS, raw writes denied, stock ledger, duplicate movement, PO receive once, invoice partial/full/overpay, deal workflow once, calendar และ ingestion approval และ workflow linking
- Browser local Demo: เพิ่มลูกค้า/เก็บเข้าคลัง/คืน, PO approve/receive และตรวจ stock 80 → 180, navigation และ responsive QA

PGlite จำลอง auth/storage infrastructure เพื่อทดสอบ SQL ไม่ได้ทดสอบ session/email/storage/network บน Supabase Cloud จริง ยังต้องตรวจหลัง deploy

## สิ่งที่ยังขึ้นกับบริการจริงหรืออยู่นอกการจัดการธุรกิจรุ่นนี้

- Supabase project/env, Auth redirect/SMTP, LINE channel, AI provider keys และ Vercel deployment — ผู้ใช้จะ deploy เอง
- Firebase user/data/file migration ต้อง export และตรวจยอดก่อน ยังไม่ได้อ่านหรือย้ายข้อมูล private บน Firebase
- Payment gateway สำหรับ SaaS/coins/subscription, quota enforcement, ERP/Sheets/POS outbound, bank-slip transaction verification, dashboard shared links และ ISO/SOC2 certification ไม่ได้เปิดใช้งาน
- แชทใช้ polling; ไฟล์ API จำกัด 4 MB; export 10,000 records; relation dropdown 1,000 records; board แสดง page ของรายการที่โหลด
- HR/payroll เป็นทะเบียนและค่าจ้างสุทธิ ไม่คำนวณภาษี/ประกันสังคมอัตโนมัติ

ฟอร์มใหม่ครอบคลุมข้อมูลการทำงานหลัก ไม่ใช่สำเนาทุก field ใน freelance เวอร์ชันเก่า ฟิลด์ที่ไม่ได้แสดงยังเก็บใน legacy_data เมื่อนำเข้าผ่าน script จึงไม่หายเมื่อแก้ข้อมูลผ่านฟอร์มใหม่

## ไฟล์สำหรับส่งมอบ

- README.md: เริ่มใช้งานและขอบเขต
- DEPLOYMENT.md: Supabase/Vercel/LINE และ migration
- supabase/schema.sql: SQL รวมสำหรับ project ใหม่
- .env.example: ชื่อ environment variables โดยไม่มี secrets
- scripts/import-firebase.ts: dry-run / import ที่เลือกบริษัทชัดเจน

Source และข้อมูลเดิมบน Firebase ยังไม่ได้เปลี่ยน เว็บไซต์ Vercel จะใช้เส้นทางใหม่ มี redirects สำหรับ URL HTML เดิมที่สำคัญ
