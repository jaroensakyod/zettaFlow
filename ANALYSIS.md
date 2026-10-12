# วิเคราะห์ repo / Canva / เว็บเดิม

ตรวจเมื่อ 12 ตุลาคม 2026 (Asia/Bangkok)

แหล่งอ้างอิง:

- https://github.com/sirisoaa-Git/dist
- https://www.canva.com/design/DAHKdPxZ7oQ/CeuICvT0VLLL6led5eDFHg/edit — 32 หน้า, ชื่อ ZettaFlow AI Version TH
- https://elitflow-38bc4.web.app/ — หน้า landing EliteFlow Enterprise

## สิ่งที่ repo เดิมมี

หน้า HTML/JS และ Firebase client SDK สำหรับลูกค้า บริษัท พื้นที่ขาย โครงการ ทรัพย์สิน ฟรีแลนซ์ store และ chat หลายโมดูลมี CRUD อยู่แล้ว มี query ของ projects/dealAreas ที่ใช้ `companyId = currentUser.uid`

ไม่มี package/build/deploy configuration, backend, rules หรือ automated tests อยู่ใน checkout เดิม จึงตรวจไม่ได้ว่า Firebase rules ที่ deploy อยู่บังคับสิทธิ์และแยกบริษัทอย่างไร การเห็นปุ่ม Admin เฉพาะบางบัญชีไม่พิสูจน์ว่าฐานข้อมูลปลอดภัย

ไฟล์ที่ว่าง: ai-assistant.html, ai_assistant.glb, dept-accounting.html, dept-cs.html, dept-data.html, dept-it.html, dept-legal.html, dept-marketing.html, employees.html, freelance(1).html, payment.html, pricing.html, stock.html, supplier.html, task.html, theme-store.html

ลิงก์บางหน้าใน index เดิมชี้ `freelance.html` และ `event.html` แต่ source ที่มีใช้ชื่อ `freelance(2..4).html` และ `event(17).html` ต้องเลือกฉบับที่เป็น canonical ก่อนแก้หรือย้ายจริง

มี chat สอง schema: ห้องทีมใช้ `lastMsgAt` ส่วน support chat ใช้ `lastMessageAt` จึงห้ามรวมโดยเปลี่ยน field ทันทีโดยไม่มี migration

## Canva ต้องการอะไร

- หน้า 4–5: LINE → AI → Dynamic Form → Workflow → Dashboard, flexible role mapping และปลายทาง ERP/Sheets
- หน้า 7, 9, 12: อนุมัติพื้นที่ขาย สร้างงานแผนก ติดตามยอดขาย/ค่าใช้จ่ายและโครงการ
- หน้า 19, 21–24: จับคู่ LINE Group ID กับแผนก/Template, OCR/NLP, completeness/deduplication, notify/nudge, multi-tenant และ archive
- หน้า 25–26: Owner/Department Manager/Viewer, share dashboard, แก้ไขฟอร์ม, สร้าง widgets ตาม field, จัด layout และสิทธิ์ widget
- หน้า 29: แพ็กเกจ 1,190 / 3,490 / 8,900 บาท, quota, overage และ onboarding
- หลายหน้าเป็นภาพ screenshot จึงตรวจจากภาพและข้อความที่ Canva เปิดเผยได้ ยังไม่ใช่ functional specification ของ API
- ยังมีข้อความ placeholder, `reallygreatsite.com`, ตัวเลขตัวอย่าง และชื่อ EliteFlow/ZettaFlow ที่ไม่สม่ำเสมอ ห้ามใช้ตัวเลขตัวอย่างเป็นสถิติจริง

## สิ่งที่พัฒนาในครั้งนี้

| งาน                                                          | สถานะ                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| Portal ภาษาไทย responsive / ZettaFlow branding               | ทำแล้วและทดสอบ browser                                 |
| Workspace, สมาชิก, role และสิทธิ์แผนก                        | ทำแล้ว ทดสอบ tenant isolation และ viewer restrictions  |
| Template create/edit / text-number-date / required fields    | ทำแล้ว เก็บ schema snapshot ของข้อมูลเก่า              |
| รับข้อความ / ตรวจทาน / อนุมัติ / ไม่อนุมัติ                  | ทำแล้ว ทดสอบ end-to-end                                |
| งานหลังอนุมัติ / Kanban / Calendar                           | ทำแล้ว ทดสอบสร้าง 5 งานจากพื้นที่ขาย                   |
| Dashboard ข้อมูลจริง / dynamic numeric cards / CSV           | ทำแล้ว ไม่ใช้ยอดขายสมมติ                               |
| Durable queue / idempotency / audit                          | ทำแล้ว ทดสอบไม่เกิดงานซ้ำ                              |
| AI + image/PDF extraction                                    | โค้ดพร้อมตั้งค่า ยังไม่ทดสอบด้วย AI key จริง           |
| Cloud Storage / secure original-file download                | โค้ดพร้อมตั้งค่า ยังไม่ทดสอบกับ bucket จริง            |
| LINE raw signature / group pairing / user linking / approval | โค้ดแล้ว ทดสอบ signed synthetic webhook และ redelivery |
| LINE notifications / retries                                 | โค้ดแล้ว ต้องทดสอบกับ OA จริงและโควตาข้อความ           |
| Firebase cloud auth/store และ Cloud Run hosting config       | เตรียมแล้ว ยังไม่ deploy หรือทดสอบ credential จริง     |

## งานที่ยังต้องทำเพื่อให้ตรง Canva ครบและพร้อมขาย

1. ตั้งค่า Cloud และบัญชี LINE/AI จริง พร้อม end-to-end acceptance test โดยผู้ใช้แต่ละ role
2. แยก Firestore state เป็น collections เพื่อรองรับข้อมูลจำนวนมาก, pagination, bounded queries, distributed notification leases, rate limit กลาง และ cleanup ของ sessions/jobs/tokens
3. ตรวจ rules ที่ deploy อยู่จริง และวางแผนย้ายข้อมูล EliteFlow: Firebase UID เดิม → สมาชิก → บริษัทจริง; ห้ามถือว่าแต่ละ UID คือบริษัทเดียวเสมอ
4. เชื่อม ERP/Sheets/POS ที่ผู้ใช้เลือก; จัดซื้อ/สต็อกแบบ ledger จริง, ใบสั่งซื้อ, movement และ reconciliation; Template/Workflow ที่มีไม่ใช่ stock accounting engine
5. กำหนด billing provider, สมัครแพ็กเกจ, quota/usage ledger, overage, invoice และ webhook ยืนยันการชำระเงินจริง
6. Dashboard widget layout/visibility permissions, shared link แบบหมดอายุและกำหนดรหัส, custom field charts เพิ่มเติม
7. Project matching ข้ามข้อความด้วยบริบทที่ตรวจสอบได้, เอกสาร revision/approval history, human confidence review และ OCR acceptance dataset
8. QR/slip verification ต้องใช้ผู้ให้บริการตรวจธุรกรรมจริง ไม่ถือว่าอ่านข้อความด้วย OCR คือยืนยันการโอน
9. Backup/restore drill, retention, monitoring, alerting และตรวจ PDPA ตามการใช้งานจริง; ไม่มีการรับรอง ISO/SOC2 หรือ SLA ในโค้ดนี้
10. Email invitations/reset-password ใน portal ใหม่, subscription onboarding, dashboard AI chat และรายการ legacy CRUD ที่ตัดสินใจจะเก็บ

## เกณฑ์รับงานจริง

ข้อมูลจากกลุ่ม LINE ที่เชื่อมเข้าบริษัทที่ถูกต้องเพียงครั้งเดียว, AI ไม่เติมข้อมูลที่ไม่มีหลักฐาน, รายการไม่ครบไม่อนุมัติ, Staff/Viewer เปลี่ยนสิทธิ์ไม่ได้, Manager เห็นเฉพาะแผนก, อนุมัติครั้งเดียวสร้างงานครั้งเดียว, เอกสารดาวน์โหลดโดยผู้มีสิทธิ์เท่านั้น, dashboard ตรงกับข้อมูลที่อนุมัติ และกู้คืนข้อมูลหลัง server restart ได้

เกณฑ์ core ส่วนที่ทดสอบ local ผ่านแล้ว เกณฑ์ cloud, integrations และ recovery บนบริการจริงยังไม่ได้ตรวจ
