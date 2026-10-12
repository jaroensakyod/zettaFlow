# ZettaFlow / Canva parity checklist

อ้างอิง https://www.canva.com/design/DAHKdPxZ7oQ/CeuICvT0VLLL6led5eDFHg/edit — ZettaFlow AI Version TH, 32 หน้า

เอกสารนี้ติดตามความต่าง ไม่ใช่ใบรับรองว่าเหมือน Canva 100% เล่ม Canva มีทั้งหน้าจอ สไลด์อธิบายธุรกิจ ภาพ mockup และ placeholder ที่ยังไม่เป็นข้อกำหนดละเอียดของระบบ

## หน้าจอที่นำมาปรับโค้ดแล้ว

| หน้า Canva | หน้าเว็บ | งานที่ทำ | สิ่งที่ยังต่าง |
| --- | --- | --- | --- |
| 7 | /zetta/spaces | เมนูชื่อเดิม, สีม่วง/กรมท่า, status cards 5 กลุ่ม, รายการพื้นที่ 5 แถว/หน้า, เดือน/ค้นหา, รายละเอียดค่าเช่า, Workflow 5 แผนก | ภาพพื้นที่จากต้นฉบับยังไม่ได้เป็น assets ใน repo; ใช้ไฟล์ของข้อมูลจริง ข้อความ/ระยะ/ฟอนต์ยังต้องเทียบภาพละเอียด |
| 8–9 | /zetta/dashboard | 6 KPI, summary, sales chart, status chart, active projects, workflow และ template numeric widgets | ยังไม่มี dashboard builder ลากวาง/กำหนดสิทธิ์ต่อ widget และกราฟหมวดหมู่จากฟิลด์ข้อความ |
| 10 | /zetta/projects?project=ID → Overview | สรุปโครงการ, ค่าเช่า/เป้า, ความคืบหน้า, ยอดขายรายวัน, ค่าใช้จ่าย, เอกสาร, audit และหมายเหตุ | milestone สัญญา/มัดจำ/ค่าเช่ายังไม่เป็น workflow เฉพาะ; ไม่มี AI Health Score ที่ได้รับการประเมินจริง |
| 11 | Project → Layout Plan / Perspective 3D / ภาพหน้างานจริง | immutable versions, เปรียบเทียบภาพหรือเปิด PDF, comments, ขอแก้ไข, อนุมัติ latest version, reviewer/timestamp, version history | ไม่ใช่ 3D renderer; PDF เปิดผ่านลิงก์ ไม่เป็นภาพ blueprint แบบใน mockup; ไม่มี mention notification หรือ public page |
| 12 | Project Overview / Finance | เชื่อมยอดขายและค่าใช้จ่ายของโครงการจาก records | การจัดหน้าตารางและชาร์ตยังไม่ได้ทำสำเนาหน้านี้เฉพาะ |
| 13–15,19,21 | Connect LINE / Templates / Inbox | LINE pairing, template mapping, extraction/review/approval, durable queue/outbox มีจากรุ่นก่อน | ข้อความภาษาธรรมชาติแก้สถานะ/จับคู่โครงการแบบไม่ต้องใส่รหัสยังไม่ครบ; ไม่มี voice transcription / email ingestion |
| 16 | Design / Purchasing / Warehouse / Sales / Finance | แยกหน้าและ KPI ตามแผนก, CRUD และธุรกรรมหลังบ้านเดิม | ยังไม่เหมือนหน้าจอย่อยทั้ง 6 ใน mockup; CRM/Marketing/CEO scorecards ยังใช้ EliteFlow |
| 23,25 | Team / Setting / storage / RLS | tenant isolation, roles/department permissions, files, audit | ไม่มี dashboard share link / password/expiry; certification/backup ต้องอิงบริการที่ deploy จริง ไม่ใส่ตรารับรองสมมุติ |
| 26 | Dynamic Form Designer | เพิ่มฟิลด์ข้อความ/ตัวเลข/วันที่และ workflow steps; schema version snapshots | ยังไม่มี drag/drop dashboard, AI สร้าง template ด้วยภาษาธรรมชาติ, widgets สำหรับข้อความ/วันที่ |
| 29 | Subscription | ราคาและข้อมูลแพ็กเกจ | ยังไม่มี trial entitlements, billing gateway, quotas, overage invoice และ premium add-ons จริง |

## ฟีเจอร์ที่ยังไม่ครบตามสไลด์

- หน้า 3: CEO Command Center landing/mobile layout แบบเฉพาะ หน้าเว็บปัจจุบันรองรับ responsive แต่ยังไม่ใช่สำเนา mobile mockup
- หน้า 5,22: connectors ERP/POS/Google Sheets และ pipeline document classification / transaction slip verification
- หน้า 23: ไฟล์ Word/Numbers/video และขนาดไฟล์ใน mockup เกิน limit 4 MB ของ upload API ปัจจุบัน
- หน้า 25–26: share/dashboard builder และการกำหนดสิทธิ์เป็นราย widget
- หน้า 29: SaaS subscription/payment/overage ไม่ใช่ ledger รับ–จ่ายของธุรกิจ
- ราคาแผน Starter/Growth/Enterprise มีต้นฉบับชัด แต่ API ของระบบบัญชี/ERP/POS, payment/slip provider และต้นฉบับภาพที่ใช้ประกอบยังไม่ได้ระบุ

## การเลือกรูปแบบที่ยังรอคำตอบ

หน้า 7,10,11 ใช้เมนูและชื่อแบรนด์ต่างกัน จึงใช้หน้า 7 เป็นเมนูหลักชั่วคราว และรวมรายละเอียดหน้า 10–11 เป็น tabs ในโครงการ ไม่อ้างว่าเป็นรูปแบบที่เจ้าของแบบยืนยันแล้ว

## QA ของส่วนที่เพิ่ม

- PostgreSQL: version number, ป้องกันไฟล์ซ้ำ, ห้ามอนุมัติ stale version, ต้องมีเหตุผลเมื่อขอแก้ไข, immutable decision, comments และ RLS tenant/role
- Domain: project totals ไม่รวมโครงการอื่นหรือรายการ draft, progress ใช้ tasks จริง, inclusive date periods
- Browser demo: PDF v1 → comment → ขอแก้ไข → PDF v2 → อนุมัติ เก็บ v1/v2 และ reviewer จริง
- Cloud integrations และ pixel-level comparison กับ assets ต้นฉบับยังไม่ได้ผ่าน acceptance
