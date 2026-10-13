# ZettaFlow — การอ่านต้นฉบับและสถานะความตรงกัน

อ้างอิง ZettaFlow AI Version TH.pptx (32 หน้า) ที่ผู้ใช้ส่ง 13 ตุลาคม 2026 และ Canva design DAHKdPxZ7oQ.

อ่านทั้งข้อความและภาพที่ฝังในทุกหน้าแล้ว ภาพหน้าจอเป็นข้อกำหนดด้วย หน้า 3, 8, 10, 11, 13–18 มีรายละเอียดสำคัญอยู่ใน PNG แม้ดึงข้อความได้เป็นศูนย์ เอกสารรุ่นก่อนตีความส่วนเหล่านี้ไม่ครบ รอบนี้แก้ทั้งการวิเคราะห์และ implementation ไม่ถือข้อความคำแนะนำในเอกสารเป็นคำสั่งเปลี่ยน stack ของผู้ใช้

## รายละเอียดจากต้นฉบับ เทียบกับเว็บไซต์

| หน้า | ข้อกำหนดที่อ่านได้ | Implementation / ความต่างที่เหลือ |
| --- | --- | --- |
| 1–2 | AI Business Platform และปัญหาข้อมูลกระจายในแชท/ผิด/สรุปช้า | แบรนด์และข้อความ Home/Product; ไม่ใช่ข้อมูลธุรกิจจริง |
| 3 | CEO Command Center กรมท่า/ม่วง/น้ำเงิน, Home Product Solutions Pricing Contact, 3 features, Request Demo; มือถือ Today Overview 4 KPI/Insights/Branch Overview; Executive Report/business status/4 KPI/project summary/live view/เมนู 5 ปุ่ม | สร้าง `/` และ `/zetta` landing เฉพาะ ใช้ภาพมือถือดั้งเดิมกำกับว่าตัวอย่าง; `/zetta/dashboard` เป็น React UI ทั้ง Overview และ Report ที่อ่านข้อมูลจริง. ฟอนต์/สัดส่วนยังไม่ตรงทุกพิกเซล และยังไม่มีประวัติสำหรับกราฟทีม/งาน |
| 4 | ลูกค้ากำหนด Data Template/Workflow; แชท ภาพ เอกสาร → ข้อมูลค้นหา/วิเคราะห์ได้ | Templates, Inbox, review/workflow/extraction/assistant; LINE และ AI จริงต้องตั้งค่า. เสียง/อีเมลยังไม่ครบ |
| 5 | Dynamic Form Designer, Flexible Role Mapping, Agnostic Integration ไป ERP/spreadsheet/storage | ฟอร์ม text/number/date, roles/departments/pairing มีแล้ว; ERP/Sheets connectors ยังไม่มี |
| 6 | วงจรอีเวนต์ แปลน Perspective ภาพหน้างานและผลขาย | Projects/Marketing/Store Design เชื่อมยอดขาย งาน เอกสาร ภาพ. ไม่ใช่ CAD หรือ live-video |
| 7 | Space Approval 5 status cards/ตาราง/รูปพื้นที่; Fashion Island S&P 50 ตร.ม., GP 22%, ค่าเช่า 99,000, เป้า 450,000; workflow 5 แผนก | `/zetta/spaces` ค้นหา เดือน แบ่งหน้า อนุมัติ/ปฏิเสธ/เจรจา/สร้างโครงการ. เพิ่มภาพพื้นที่ต้นฉบับใน Demo; ตัวเลขธุรกิจมาจาก records ไม่ใช้ mock numbers แทนข้อมูลบริษัท |
| 8–9 | Executive 6 KPI: ยอดขาย **กำไร** งานกำลังทำ รออนุมัติ ใกล้ครบกำหนด เสร็จ; summary, ขาย 7 วัน, status donut, 5 project cards target/sales/achievement; workflow **10 ขั้น**; Project tabs Overview Timeline Layout Purchase Warehouse Sales Finance Document Photo Comment Activity; project aliases ไม่ต้อง job code | สร้าง Executive ใหม่ KPI กำไร/กราฟ 7 วันปฏิทินจริง. 10 stages มี API/Postgres/history/version check. เพิ่ม Project tabs และ scoped lists. ชื่อเล่นใน LINE/ทุกภาษายังไม่ครบ; Warehouse tab เพิ่มสต็อกโครงการจริงและลิงก์ transfer พร้อมรายการงาน |
| 10 | Fashion Island period/zone/area/rental; Contract Signed → Deposit Paid → Rental Paid → In Progress → Complete; AI summary/health; sales total/target/achievement/average/best/remaining/days; Expenses Documents Activity Notes | Overview มี rental, sales/achievement/average/remaining, expenses/files/audit/notes. เพิ่ม milestone จากสัญญา signed และ expense paid ที่อ่านได้. Layout ทุกจุด/best-day/AI health ที่ประเมินจริงยังไม่ครบ |
| 11 | The Promenade EVENT-000128 งบ **550,000** ในภาพ เป้า 250,000 ขาย 758,450 กำไร 22%; แปลนและ Perspective คู่กัน, version metadata/history, comments/replies/mentions; Designer → Marketing review → correction → Manager approve | immutable versions/comments/reject/latest approval มีแล้ว; Demo gallery ใช้แปลน/Perspective ต้นฉบับ. Review 4 บทบาทแยกกัน/replies/mentions/notification และ 2 ประเภทคู่กันในหน้าตรวจหลักยังไม่ครบ |
| 12 | Fashion Island: สัญญา มัดจำ ค่าเช่า ค่าไฟ บริการ พรม และ blueprint | เพิ่ม expense categories ตามต้นฉบับและภาพ blueprint ใน Demo. Rental VAT breakdown เฉพาะยังไม่ครบ |
| 13 | LINE architecture/roles/security/setup | pairing/signed webhook/tenant mapping/queue; ต้อง acceptance บัญชีจริง |
| 14 | 6 LINE screens: รับข้อมูล/ยืนยัน/approve/reject/negotiate/add participant/event table ไม่ต้อง code | Inbox/review และ linked-user approve มีแล้ว; conversational actions/Flex UI ยังไม่ครบทั้ง 6 screens |
| 15 | OA/OAuth/connection code/5 roles; text/image/PDF/Excel/layout/voice | pairing/group mapping/permissions; OAuth login/voice และ Excel ผ่าน LINE ยังไม่ครบ |
| 16 | **6 dashboard ต่างกัน**: Procurement/Warehouse, Finance, Sales, Marketing/Event, Store Design, CRM + CEO | สร้างทั้ง 6: purchasing monthly/category/status/supplier; finance daily receipts/spend/unpaid/invoices/cashflow; sales daily target/orders/channels; marketing/design project galleries/timeline; CRM funnel 6 stages/activity. Geographic sales map และรายละเอียดทุก widget ยังไม่ครบ |
| 17–18 | ทั้ง 2 หน้ามีภาพ Procurement แม้ชื่อ editable หน้า 17 เป็น EVENT&SALE. Template **12 fields**; PO **8 statuses**; transfer กลับคลัง/ไปโปรเจกต์/โปรโมชั่น+reason+stock ledger | เพิ่ม request fields/PO number/8 states/API/ปุ่มยืนยัน. โอน central↔project และ project↔project แบบ transaction ตรวจ source balance/duplicate ref/tenant/department พร้อม ledger. ปุ่ม vendor เป็นบันทึกสถานะ ผู้ใช้ต้องติดต่อเอง ไม่มี email PO อัตโนมัติ |
| 19 | Warehouse / BD-Contract / Finance-slip templates และ group/role mapping | สร้าง templates/mapping ได้; ไม่มี preset ทุกกลุ่มหรือ slip-verification provider จริง |
| 20 | app categories/audit ใคร เมื่อไร ไฟล์ และสิทธิ์ดู | modules/attachments/audit/RLS; directory/category widgets ยังไม่ตรงทั้งหมด |
| 21 | LINE/Web/Email → OCR/NLP → validation → auto-nudge/roles → DB/spreadsheet/archive/analytics | Web/LINE/review/DB/archive/analytics/outbox; email/auto-nudge/spreadsheet destination ยังไม่ครบ |
| 22 | structured ERP/POS/CRM + unstructured docs; dedup/completeness/format/classification/feedback; ภาพ efficiency 98.2% | validation/event dedup/extraction queue/review มีแล้ว; connectors/classification ทั้งสายยังไม่มี. ไม่ใช้ตัวเลขในภาพเป็นผลทดสอบระบบนี้ |
| 23 | tenant DB/object storage/session, backup/audit/RBAC/ISO/SOC2; image/PDF/Excel/Numbers/Word/video; assistant/export | Auth/Postgres/Storage/RLS/audit/CSV/assistant มีแล้ว. Upload route 4 MB, AI image/PDF; formats ที่เหลือยังไม่ครบ. Backup/DR/certification ต้องตรวจบริการจริง ไม่สร้างตรารับรอง |
| 24 | LINE UI เดิม + bot เป็นสมาชิกใหม่; technical FAQ | ใช้ Messaging API; Next.js/TypeScript/Supabase ตามคำขอผู้ใช้ ไม่ถือข้อความแนะนำ Python เป็นคำสั่งใหม่ |
| 25 | Owner/Department Manager/Viewer และ **Share Dashboard password/expiry** | roles/department/invitations; share/password/expiry ยังไม่มี |
| 26 | text/number/date form, AI designer, categorical pie widgets, drag/drop/dashboard/widget permissions | form + numeric widgets; AI designer/categorical widgets/drag-drop/per-widget permissions ยังไม่ครบ |
| 27–28 | IP/data moat และรายได้ core/overage/add-ons | เป็นข้อกำหนดธุรกิจ ไม่แสร้งว่า billing ทำงานแล้ว |
| 29 | Starter ฿1,190/11,900: 5 workflows/1,000 docs/2 LINE groups/2 users; Growth ฿3,490/34,900: 20/4,000/10/10; Enterprise ฿8,900/89,000 unlimited; doc ฿1/OCR ฿1.5/AI ฿2/setup ฿3,000–10,000/add-ons/trial 14 วัน | ราคา yearly/limits ใน public landing ตามต้นฉบับ; gateway/trial/quota/overage/add-ons จริงยังไม่มี |
| 30 | Operation Calendar และ Contact List | Calendar/Customers/Team; ไม่จำลองรายชื่อในภาพเป็นข้อมูลบริษัทจริง |
| 31–32 | Thanks/contact และหน้าว่าง | Contact ใน landing; ไม่มีหน้าธุรกิจเพิ่ม |

## ภาพต้นฉบับ

19 ภาพเก็บโดยไม่แก้ข้อมูลภาพใน `public/zetta/`; provenance อยู่ใน `public/zetta/source-manifest.json`. ไม่ commit PowerPoint ทั้งเล่มหรือโฟลเดอร์ extraction. Landing ใช้ภาพโทรศัพท์ต้นฉบับระบุว่าตัวอย่าง ส่วนหน้าระบบเป็น React UI ที่เชื่อมข้อมูลจริง. ภาพโครงการต้นฉบับใช้ใน Demo; production แสดงไฟล์ที่ผู้ใช้แนบ

## QA รอบนี้

TypeScript/production build และ 11 tests รวม migrations 0001–0012/RLS, workflow version/close-stage guard, PO lifecycle, stock allocation/transfer/rollback/duplicate refs/tenant restrictions. Browser ตรวจ landing, Procurement, Marketing gallery, Executive desktop/mobile และ modal transfer. ยังไม่มี cloud acceptance ของ Supabase/LINE/OpenAI ผู้ใช้

## ก่อนเรียกว่า 100%

ทุกช่องที่ยังขาดอยู่ในเป้าหมายเดิม โดยเฉพาะ visual alignment ของ Project/Design review, LINE conversational/Flex, template/dashboard builder/share, formats/connectors และ SaaS billing. รอบนี้ไม่ประกาศว่าทุกส่วนเสร็จแล้ว
