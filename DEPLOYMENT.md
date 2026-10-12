# Deploy ZettaFlow บน Firebase + Cloud Run

ยังไม่ได้ deploy เว็บเดิม การตั้งค่าด้านล่างต้องทำด้วยบัญชีที่มีสิทธิ์ project และพิจารณาค่าใช้จ่าย Cloud Run / Storage / AI / LINE ก่อนใช้งานจริง

## 1. ทดสอบ local

คัดลอก `.env.example` เป็น `.env` และเติม secret เฉพาะในไฟล์นี้หรือ secret manager ไม่ใส่ใน frontend, Git หรือข้อความแชท `npm start` ใช้ local mode โดยค่าเริ่มต้นและ bind เฉพาะ 127.0.0.1

## 2. บริการ Cloud

- เปิด Firebase Authentication Email/Password และตั้งค่าอีเมลยืนยัน
- เปิด Firestore และ Firebase Storage ใน region ที่เหมาะสม
- สร้าง service account ให้ Cloud Run ใช้ Admin SDK แบบ Application Default Credentials ไม่ใช้ service-account JSON ใน browser
- ให้สิทธิ์ Firestore read/write และ object access เฉพาะที่ backend ต้องใช้; ตัว app ตรวจ tenant/role
- เก็บ `OPENAI_API_KEY`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` ใน Google Secret Manager
- ตั้ง env `AUTH_MODE=firebase`, `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_STORAGE_BUCKET`, `PUBLIC_ORIGIN=https://elitflow-38bc4.web.app` และ `OPENAI_MODEL` ตามบัญชีจริง

Dockerfile รองรับ Node 24 backend ชื่อ service ที่ firebase.json คาดไว้คือ `zettaflow-api` region `asia-southeast1` เปลี่ยนให้ตรง service จริงก่อน deploy

Queue รุ่นนี้ใช้ polling ใน process ดังนั้น Cloud Run ต้องมี instance ทำงานและ CPU ตลอดเวลา (minimum instance 1 และไม่ throttle CPU) ถ้า scale to zero งานจะค้างจนมี request ใหม่ การตั้งค่านี้มีค่าใช้จ่าย ก่อนขยาย production ควรย้าย processing ไป Cloud Tasks/PubSub และเปลี่ยน global list queries เป็น queries ตามสถานะ

ตัวอย่างคำสั่งหลังติดตั้ง Google Cloud CLI และเข้าสู่ระบบ (อ่านและตั้งค่า secrets ก่อนรัน):

```powershell
gcloud run deploy zettaflow-api --source . --region asia-southeast1 --project elitflow-38bc4 --allow-unauthenticated --min-instances 1 --no-cpu-throttling
firebase deploy --only hosting --project elitflow-38bc4
```

`allow-unauthenticated` เปิด HTTP endpoint สำหรับ Firebase Hosting และ LINE webhook แต่ business API ยังตรวจ Firebase token ทุกคำขอ ตั้ง env/secrets ให้ครบก่อนนำ service รับ traffic

## 3. Rules และเว็บเก่า

ไฟล์ rules ใน repo เป็นแนวทางปิด direct client access ของ ZettaFlow ให้ backend เป็นผู้ตรวจสิทธิ์ `firebase.json` **ไม่ deploy rules อัตโนมัติ** เนื่องจากไม่รู้ rules เดิม การแทนที่ rules เดิมแบบ blanket deny จะทำให้ EliteFlow client CRUD ใช้ไม่ได้ ต้องตรวจและรวมอย่างเจาะจงก่อน

อย่านำ root ของ repo ทั้งหมดไป Hosting; public directory ต้องเป็น `public/` เพื่อไม่เผยแพร่ server, .env, tests และ legacy pages โดยไม่ตั้งใจ

ข้อมูลใหม่ใช้ collections ชื่อ `zf_*` ไม่แก้ไข customers/projects/users เดิม การย้ายข้อมูลเดิมต้องมี backup, dry run, mapping และ verification ก่อน

## 4. LINE

1. ใน LINE Developers ตั้ง webhook URL เป็น `https://<host>/api/line/webhook`
2. ใช้ Verify และเปิด Use webhook; เปิดการเข้าร่วมกลุ่มของ OA
3. Owner เข้า Integrations เลือก Template แล้วสร้าง token สำหรับกลุ่ม
4. เพิ่มบอทในกลุ่ม และพิมพ์ `#connect <token>` ภายใน 10 นาที
5. Owner เชื่อมบัญชี LINE ด้วย token `#user <token>` จากบัญชี LINE ของตนเองในกลุ่มที่เชื่อมแล้ว
6. ส่งข้อความ/ภาพ/PDF ระบบสร้างรายการ review และ notification
7. อนุมัติผ่านเว็บ หรือ `#approve <recordId>` จาก LINE ที่เชื่อมกับบัญชี Owner/Manager ซึ่งมีสิทธิ์ในแผนกนั้น

สมาชิก Owner/Manager/Staff เข้า Integrations เพื่อเชื่อมบัญชี LINE ของตัวเองได้ Viewer ไม่สามารถส่งข้อมูลหรืออนุมัติ

ใช้ signature ตาม [LINE verification documentation](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/) จาก request bytes เดิม และตรวจ Firebase token ตาม [Firebase Admin documentation](https://firebase.google.com/docs/auth/admin/verify-id-tokens) ทุกคำขอ การส่งรูป/PDF ให้ AI ต้องเป็นข้อมูลที่ธุรกิจอนุญาตให้ประมวลผลกับ provider นั้น

## 5. ก่อนรับผู้ใช้จริง

- ทดสอบบัญชีสองบริษัทและทุก role กับ Firebase จริง รวมบัญชี revoked/disabled
- ทดสอบ LINE text/image/PDF, invalid signature, repeated delivery และ failed notifications
- ทดสอบ AI/OCR ด้วยตัวอย่างข้อมูลจริงที่อนุญาตให้ใช้ ตรวจยอดเงิน วันที่ และ missing fields
- ทดสอบ Cloud Storage อัปโหลด/ดาวน์โหลด ข้าม tenant ไม่ได้
- Restart instance ระหว่าง processing และตรวจ recovery/ไม่สร้างรายการซ้ำ
- ตั้ง backup/retention/monitoring และทำ restore drill
- ตรวจ limits ใน README และย้าย state ไป collections ก่อนเกินขอบเขต
- ยังไม่มี payment provider, ERP/Sheets outbound และระบบ stock ledger; ห้ามเปิดแพ็กเกจขายโดยสื่อสารว่าครบตาม Canva แล้ว
