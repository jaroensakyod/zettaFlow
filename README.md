# ZettaFlow AI

พัฒนาแกนกลาง ZettaFlow จาก repo EliteFlow เดิม และแนวคิดใน Canva **ZettaFlow AI Version TH**

## เริ่มใช้งานบนเครื่อง

ต้องใช้ Node.js 24 ขึ้นไป

```powershell
npm ci
npm start
```

เปิด http://127.0.0.1:3000 แล้วสร้างบัญชี โหมด local บันทึกบัญชีและข้อมูลใน `.data/zettaflow.sqlite` และเก็บไฟล์ใน `.data/files` ฐานข้อมูลนี้ไม่ใช่ข้อมูล Firebase เดิมและไม่ถูกส่งเข้า Git

```powershell
npm test
```

## ทดลองเส้นทางหลัก

1. สร้างบัญชีและ workspace
2. กด **รับข้อมูลใหม่** เลือก **อนุมัติพื้นที่ขาย**
3. ส่งข้อความด้านล่าง (ไม่ใช้ AI ก็อ่านฟิลด์ตรงได้)
4. เข้า Data Inbox เปิดรายละเอียด ตรวจทาน และอนุมัติ
5. Workflow สร้างงาน Design, Purchasing, Warehouse, Marketing และ Sales
6. เปลี่ยนสถานะงาน ดู Calendar, Dashboard และ Export CSV

```text
โครงการ: The Promenade
สถานที่: เดอะพรอมานาด
พื้นที่: 33
ค่าเช่า: 55000
วันเริ่ม: 2026-10-16
วันสิ้นสุด: 2026-10-28
```

Templates กำหนดฟิลด์ข้อความ ตัวเลข วันที่ ข้อมูลบังคับ และรายการงานหลังอนุมัติได้เอง แก้ไข Template ได้โดยข้อมูลเก่าคง schema ณ เวลาส่ง ข้อมูลตัวเลขที่อนุมัติแล้วสร้างการ์ด Dashboard ตาม Template

## Backend ที่มีให้

- SQLite สำหรับ local / Firestore สำหรับ Cloud; Firebase Authentication ใน production
- Server ตรวจ tenant และแผนกทุกคำขอ ไม่เชื่อ role หรือ tenant ที่ส่งจาก browser
- Owner จัดการบริษัท, Template และสมาชิก; Manager อนุมัติแผนกที่ได้รับสิทธิ์; Staff ส่งข้อมูลและอัปเดตงาน; Viewer ดูและส่งออก
- คำเชิญมีอายุ 7 วัน สมาชิกต้องสมัครด้วยอีเมลที่ตรงกัน; ยังไม่ส่งอีเมลคำเชิญ
- Queue รับข้อมูลก่อนประมวลผล; บันทึกงานและ lease เพื่อกู้คืนหลัง process หยุด
- AI อ่านข้อความ รูปภาพ และ PDF ผ่าน server; ปิด AI แล้วใช้เฉพาะ key-value extraction ไม่แสร้งเป็น AI
- เก็บเอกสารต้นฉบับในไฟล์ local หรือ Cloud Storage; ดาวน์โหลดผ่าน API ที่ตรวจสิทธิ์
- LINE ตรวจ HMAC จาก raw request, รับข้อความ/ภาพ/PDF, ป้องกัน redelivery ซ้ำ, จับคู่กลุ่มและบัญชีด้วย token อายุสั้น
- อนุมัติผ่าน LINE ด้วยคำสั่งชัดเจนจากบัญชีที่เชื่อมและมีสิทธิ์; ไม่อนุมัติจากการตีความ AI
- Notification outbox ส่งผลรับข้อมูลและแจ้งข้อมูลที่ขาดกลับกลุ่ม LINE เมื่อมี access token
- Audit log, CSV export ป้องกันสูตรที่ฝังใน spreadsheet, Origin checking, HttpOnly local sessions

รายละเอียด deploy และสิ่งที่ต้องตั้งค่าจริงอยู่ใน [DEPLOYMENT.md](DEPLOYMENT.md)
การเทียบ Canva กับสถานะ repo อยู่ใน [ANALYSIS.md](ANALYSIS.md)

## โครงสร้าง

```text
public/            หน้า ZettaFlow ใหม่ (Firebase Hosting deploy เฉพาะโฟลเดอร์นี้)
server/            API, สิทธิ์, queue, AI และฐานข้อมูล
tests/             integration / domain tests
*.html เดิม         source EliteFlow เก็บไว้ ไม่มีการย้ายหรือลบข้อมูลเดิม
```

## ขอบเขตที่ต้องทราบ

นี่เป็นแกนระบบรุ่นแรกที่ทดสอบบน local แล้ว ไม่ใช่การรับรองว่าฟีเจอร์ทุกหน้าใน Canva พร้อม production ทั้งหมด ยังต้องตั้งค่า cloud, ทดสอบ LINE/AI ด้วยบัญชีจริง, ย้ายข้อมูล legacy อย่างตรวจสอบได้ และทำงานต่อในส่วน billing, ERP/Sheets, dashboard share, widget permissions/layout และระบบ stock/POS ที่เชื่อมรายการจริงตาม [ANALYSIS.md](ANALYSIS.md)

Cloud store รุ่นแรกเก็บ state บริษัทในเอกสาร Firestore หนึ่งฉบับ จำกัด 500 records และ serialized state 700 KB; audit ล่าสุด 300 รายการ ก่อนใช้กับบริษัทขนาดใหญ่ต้องแยก records/tasks/audit เป็น collections, ทำ pagination และ retention jobs ก่อน ห้ามสื่อสารว่า Unlimited หรือมี SLA/มาตรฐานรับรองที่ยังไม่ได้ตรวจจริง
