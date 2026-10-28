-- หมวดหมู่หลักของค่าใช้จ่าย: the grouped list with emoji in the app; older categories stay valid for existing records.
-- New accounts (asset purchases, travel, fuel, phone & internet, software, fees, insurance, drawings …) are added to
-- every company; existing accounts and their names are left as they are.

insert into public.entity_schemas(kind,department,fields)values('expenses','Finance','[{"key":"name","label":"รายการค่าใช้จ่าย","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"category","label":"หมวดหมู่","type":"select","required":true,"options":["ส่งเสริมการขาย","รับรอง/เลี้ยงลูกค้า","ค่าเดินทางและที่พัก","ค่าน้ำมัน/แก๊ส/รถยนต์","ค่าขนส่งลูกค้า/ลอจิสติกส์","ค่าเช่า","เงินมัดจำ/ประกัน","เบี้ยประกัน","ค่าธรรมเนียมธนาคาร","ภาษีและทะเบียน","ซื้อสินค้าไว้ขาย","ซื้อของ/วัสดุไว้ให้บริการ","สินค้าตัวอย่าง/ของแจกแถม","คอมพิวเตอร์/อุปกรณ์ไอที","เฟอร์นิเจอร์/อุปกรณ์สำนักงาน","เฟอร์นิเจอร์และตกแต่งสำนักงาน","ยานพาหนะ","ซอฟท์แวร์คอมพิวเตอร์","ค่าส่งเอกสาร/เมสเซนเจอร์/ไปรษณีย์","โปรแกรม/ซอฟท์แวร์/แอพลิเคชั่น","วัสดุสำนักงาน/เครื่องเขียน","ค่าเช่าออฟฟิศ","โทรศัพท์","ค่าไฟ","อินเตอร์เน็ต","ค่าน้ำ","บริการทั่วไป/ฟรีแลนซ์","บริการด้านบัญชี","เงินเดือน/ค่าจ้าง","เบี้ยเลี้ยง","ประกันสังคม","สวัสดิการพนักงาน","ค่าล่วงเวลา","ค่าคอมมิชชั่นพนักงานขาย","ส่วนตัว","ค่านายหน้าและส่วนแบ่งการขาย","ซ่อมแซมบำรุงรักษา","ดอกเบี้ยเงินกู้ยืม","ค่าใช้จ่ายทั่วไป","ค่ามัดจำ","ค่าไฟฟ้า","ค่าบริการ","ค่าพรม","บุคลากร","จัดซื้อ","ขนส่ง","การตลาด","อื่นๆ"],"picker":"expenseCategory"},{"key":"accountCode","label":"รหัสผังบัญชี","type":"text","required":false},{"key":"costCenter","label":"ศูนย์ต้นทุน","type":"text","required":false},{"key":"payee","label":"ผู้รับเงิน","type":"text","required":false},{"key":"supplierId","label":"Supplier","type":"relation","required":false,"resource":"suppliers"},{"key":"docType","label":"ประเภทเอกสาร","type":"select","required":false,"options":["ใบกำกับภาษีเต็มรูป","ใบกำกับภาษีอย่างย่อ","ใบเสร็จ","ใบแจ้งหนี้"]},{"key":"docNo","label":"เลขที่เอกสาร","type":"text","required":false},{"key":"taxId","label":"เลขผู้เสียภาษีผู้ขาย","type":"text","required":false},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"receiptId","label":"ไฟล์ใบเสร็จ","type":"image","required":false,"hidden":true},{"key":"lines","label":"รายการสินค้า","type":"lines","required":false,"hidden":true},{"key":"amount","label":"ยอดตามเอกสาร","type":"number","required":true,"min":0},{"key":"vatMode","label":"VAT","type":"select","required":false,"options":["included","excluded","none"]},{"key":"whtRate","label":"หัก ณ ที่จ่าย (%)","type":"select","required":false,"options":["0","1","2","3","5"]},{"key":"payStatus","label":"การชำระ","type":"select","required":false,"options":["โอนแล้ว","เงินสดย่อย","ยังไม่จ่าย"]},{"key":"reviewStatus","label":"การตรวจ","type":"select","required":false,"options":["รอตรวจ","บันทึกแล้ว"],"hidden":true},{"key":"aiNotes","label":"เหตุผลจาก AI","type":"textarea","required":false,"hidden":true},{"key":"aiUncertain","label":"ช่องที่ AI ไม่แน่ใจ","type":"text","required":false,"hidden":true},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["pending","approved","paid","rejected"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false},{"key":"code","label":"เลขที่เอกสาร (EXP)","type":"text","required":false,"hidden":true},{"key":"payeeType","label":"ประเภทผู้รับเงิน","type":"select","required":false,"options":["บริษัท / Supplier","บุคคลธรรมดา","พนักงานในบริษัท"],"hidden":true},{"key":"employeeId","label":"พนักงานผู้รับเงิน","type":"relation","required":false,"resource":"employees","hidden":true},{"key":"payeePhone","label":"เบอร์โทรผู้รับเงิน","type":"tel","required":false,"hidden":true},{"key":"discount","label":"ส่วนลดท้ายบิล","type":"number","required":false,"min":0,"hidden":true},{"key":"discountType","label":"ประเภทส่วนลด","type":"select","required":false,"options":["amount","percent"],"hidden":true},{"key":"approver","label":"ผู้อนุมัติ","type":"text","required":false,"hidden":true}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

create or replace function public.seed_accounts(c uuid)returns void language sql security definer set search_path=public as $$
 insert into accounts(company_id,code,name,type,category)values
  (c,'1111','เงินสด','asset',null),
  (c,'1112','เงินฝากธนาคาร','asset',null),
  (c,'1113','เงินสดย่อย','asset',null),
  (c,'1154','ภาษีซื้อ','asset',null),
  (c,'1160','เงินมัดจำจ่าย','asset','ค่ามัดจำ'),
  (c,'1240','อุปกรณ์สำนักงานและคอมพิวเตอร์','asset',null),
  (c,'1250','เฟอร์นิเจอร์และเครื่องตกแต่ง','asset',null),
  (c,'1260','ยานพาหนะ','asset',null),
  (c,'1270','โปรแกรมคอมพิวเตอร์','asset',null),
  (c,'2111','เจ้าหนี้การค้า','liability',null),
  (c,'2132','ภาษีหัก ณ ที่จ่ายค้างจ่าย','liability',null),
  (c,'3120','เงินถอนส่วนตัว','equity',null),
  (c,'5010','ซื้อสินค้าและวัตถุดิบ','expense','จัดซื้อ'),
  (c,'5020','สินค้าตัวอย่างและของแจก','expense',null),
  (c,'5110','ค่าแรงและค่าจ้าง','expense','บุคลากร'),
  (c,'5120','เบี้ยเลี้ยงและสวัสดิการพนักงาน','expense',null),
  (c,'5130','เงินสมทบประกันสังคม','expense',null),
  (c,'5140','ค่านายหน้าและค่าคอมมิชชั่น','expense',null),
  (c,'5210','ค่าเช่า','expense','ค่าเช่า'),
  (c,'5220','ค่าไฟฟ้าและสาธารณูปโภค','expense','ค่าไฟฟ้า'),
  (c,'5221','ค่าโทรศัพท์และอินเทอร์เน็ต','expense',null),
  (c,'5230','ค่าบริการ','expense','ค่าบริการ'),
  (c,'5240','ค่าพรมและวัสดุตกแต่ง','expense','ค่าพรม'),
  (c,'5250','ค่าขนส่ง','expense','ขนส่ง'),
  (c,'5270','ค่าเดินทางและที่พัก','expense',null),
  (c,'5271','ค่าน้ำมันและค่าใช้จ่ายยานพาหนะ','expense',null),
  (c,'5280','ค่าซอฟต์แวร์และโปรแกรม','expense',null),
  (c,'5290','วัสดุสำนักงานและเครื่องเขียน','expense',null),
  (c,'5310','ค่าโฆษณาและการตลาด','expense','การตลาด'),
  (c,'5320','ค่ารับรอง','expense',null),
  (c,'5410','เบี้ยประกันภัย','expense',null),
  (c,'5420','ค่าธรรมเนียมธนาคาร','expense',null),
  (c,'5430','ภาษีและค่าธรรมเนียมราชการ','expense',null),
  (c,'5440','ค่าซ่อมแซมและบำรุงรักษา','expense',null),
  (c,'5450','ดอกเบี้ยจ่าย','expense',null),
  (c,'5900','ค่าใช้จ่ายอื่น','expense','อื่นๆ')
 on conflict do nothing;
 insert into cost_centers(company_id,code,name,kind)values(c,'HQ','สำนักงานใหญ่','branch')on conflict do nothing$$;
revoke all on function public.seed_accounts(uuid)from public,anon,authenticated;
select seed_accounts(id)from companies;
