-- ห้องดีล phase 2: after the quotation is accepted, the work runs in the same chat until it is paid.
--   seller: progress updates → delivery → invoices per instalment (deposit / final …)
--   buyer : accepts the delivered work (ตรวจรับ) or asks for fixes → reports each payment (slip ref, withholding tax)
--   seller: confirms the money arrived → receipt
--   either side may ask to cancel; it happens only when the other side agrees.
-- Each step is a card both companies see; each company's own books get the records (seller: invoice, payment,
-- project status; buyer: expense with supplier / WHT, follow-up task).
-- Instalments are set on the quotation (default: one payment of 100%).

alter table b2b_deals drop constraint if exists b2b_deals_stage_check;
alter table b2b_deals add constraint b2b_deals_stage_check check(stage in('request','quote','accepted','work','delivered','checked','closed','rejected','cancelled'));
alter table b2b_cards drop constraint if exists b2b_cards_kind_check;
alter table b2b_cards add constraint b2b_cards_kind_check check(kind in('request','quote','progress','delivery','invoice','payment','cancel'));
alter table b2b_cards add column if not exists seller_ref uuid,add column if not exists buyer_ref uuid;

-- Helpers -----------------------------------------------------------------------------------------------------
-- Instalments of a quotation: [{label, percent}] adding up to 100 (default: one payment).
create or replace function public.b2b_installments(p jsonb)returns jsonb language plpgsql immutable as $$declare out jsonb='[]';x jsonb;pc numeric;s numeric=0;begin
 if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p)=0 then return '[{"label":"ชำระเต็มจำนวน","percent":100}]';end if;
 for x in select value from jsonb_array_elements(p)loop
  pc=nullif(x->>'percent','')::numeric;
  if pc is null or pc<=0 or pc>100 then raise exception 'เปอร์เซ็นต์งวดชำระต้องอยู่ระหว่าง 1–100';end if;
  s=s+pc;out=out||jsonb_build_array(jsonb_build_object('label',left(coalesce(nullif(trim(x->>'label'),''),'งวดที่ '||(jsonb_array_length(out)+1)),60),'percent',pc));
 end loop;
 if jsonb_array_length(out)>6 then raise exception 'แบ่งได้ไม่เกิน 6 งวด';end if;
 if s<>100 then raise exception 'งวดชำระรวมกันต้องได้ 100%%';end if;
 return out;end$$;

-- The deal (locked), checked: the company is in the conversation and may act.
create or replace function public.b2b_deal_for(p_company uuid,p_deal uuid)returns b2b_deals language plpgsql security definer set search_path=public as $$declare d b2b_deals;begin
 perform b2b_writer(p_company);
 select * into d from b2b_deals where id=p_deal for update;
 if not found then raise exception 'ไม่พบดีลนี้';end if;
 perform b2b_thread_of(p_company,d.thread_id);
 if p_company not in(d.buyer,d.seller)then raise exception 'ไม่มีสิทธิ์ในดีลนี้';end if;
 return d;end$$;

-- The accepted quotation of a deal.
create or replace function public.b2b_accepted_quote(p_deal uuid)returns b2b_cards language sql stable security definer set search_path=public as $$
 select * from b2b_cards where deal_id=p_deal and kind='quote' and status='accepted' order by created_at desc limit 1$$;

-- Amounts of instalment i (0-based): the last one takes the rounding remainder so the instalments add up exactly.
create or replace function public.b2b_installment_amount(q jsonb,i int)returns jsonb language plpgsql immutable as $$declare inst jsonb=b2b_installments(q->'installments');n int=jsonb_array_length(inst);
 total numeric=(q->>'total')::numeric;vat numeric=coalesce((q->>'vat')::numeric,0);base numeric=total-vat;pc numeric;net numeric;v numeric;k int;begin
 if i<0 or i>=n then raise exception 'ไม่พบงวดชำระนี้';end if;
 if i<n-1 then pc=(inst->i->>'percent')::numeric;net=round(base*pc/100,2);v=round(vat*pc/100,2);
 else net=base;v=vat;for k in 0..n-2 loop pc=(inst->k->>'percent')::numeric;net=net-round(base*pc/100,2);v=v-round(vat*pc/100,2);end loop;end if;
 return jsonb_build_object('index',i,'count',n,'label',inst->i->>'label','percent',(inst->i->>'percent')::numeric,'net',net,'vat',v,'amount',net+v);end$$;

create or replace function public.b2b_set_entity(p_id uuid,p_patch jsonb)returns void language sql security definer set search_path=public as $$
 update entities set data=data||p_patch,updated_at=now(),version=version+1 where id=p_id$$;

-- A quotation may carry instalments (otherwise as 0064) ----------------------------------------------------------
create or replace function public.b2b_deal_quote(p_company uuid,p_thread uuid,p_deal uuid,p_title text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=public as $$declare
 t b2b_threads;d b2b_deals;c b2b_cards;items jsonb;sub numeric;disc numeric;net numeric;vat numeric;total numeric;mode text;valid date;r int;doc text;inst jsonb;begin
 perform b2b_writer(p_company);t=b2b_thread_of(p_company,p_thread);
 if length(trim(coalesce(p_title,'')))not between 1 and 200 then raise exception 'ใส่หัวข้อใบเสนอราคา';end if;
 inst=b2b_installments(p_data->'installments');
 if p_deal is null then
  insert into b2b_deals(thread_id,buyer,seller,title,stage)values(t.id,case when t.company_a=p_company then t.company_b else t.company_a end,p_company,trim(p_title),'quote')returning * into d;
 else
  select * into d from b2b_deals where id=p_deal and thread_id=t.id for update;
  if not found then raise exception 'ไม่พบดีลนี้';end if;
  if d.seller<>p_company then raise exception 'เฉพาะผู้ขายส่งใบเสนอราคาได้';end if;
  if d.stage not in('request','quote')then raise exception 'ดีลนี้ปิดไปแล้ว';end if;
 end if;
 items=b2b_items(p_data->'items',true);
 sub=(select coalesce(sum((x->>'amount')::numeric),0)from jsonb_array_elements(items)x);
 disc=coalesce(nullif(p_data->>'discount','')::numeric,0);
 if disc<0 or disc>sub then raise exception 'ส่วนลดต้องไม่เกินยอดรวม';end if;
 net=sub-disc;mode=coalesce(nullif(p_data->>'vatMode',''),'excluded');
 if mode not in('excluded','included','none')then raise exception 'รูปแบบ VAT ไม่ถูกต้อง';end if;
 vat=case mode when 'excluded' then round(net*0.07,2) when 'included' then round(net*7/107,2) else 0 end;
 total=case mode when 'excluded' then net+vat else net end;
 valid=coalesce(nullif(p_data->>'validUntil','')::date,b2b_bkk_today()+30);
 if valid<b2b_bkk_today()then raise exception 'วันยืนราคาต้องไม่ใช่วันที่ผ่านมาแล้ว';end if;
 update b2b_cards set status='superseded' where deal_id=d.id and kind='quote' and status in('open','change');
 r=coalesce((select max(rev)from b2b_cards where deal_id=d.id and kind='quote'),0)+1;
 doc='QT'||to_char(now()at time zone 'Asia/Bangkok','YYMM')||'-'||upper(left(replace(d.id::text,'-',''),5))||case when r>1 then '-R'||r else '' end;
 insert into b2b_cards(deal_id,company_id,author_id,author_name,kind,rev,data)values(d.id,p_company,auth.uid(),feed_author(p_company),'quote',r,
  jsonb_build_object('title',trim(p_title),'docNo',doc,'items',items,'subtotal',sub,'discount',disc,'vatMode',mode,'vat',vat,'total',total,
   'validUntil',valid,'deliverBy',nullif(p_data->>'deliverBy','')::date,'payTerms',left(coalesce(p_data->>'payTerms',''),300),'installments',inst,
   'notes',left(coalesce(p_data->>'notes',''),2000),'seller',b2b_party(d.seller),'buyer',b2b_party(d.buyer)))returning * into c;
 update b2b_deals set stage='quote',title=trim(p_title),updated_at=now()where id=d.id;
 perform b2b_card_note(p_company,t.id,c.id,'💰 ใบเสนอราคา'||case when r>1 then ' Rev.'||r else '' end||': '||trim(p_title)||' · ฿'||to_char(total,'FM999,999,999,990.00'));
 return b2b_card_json(c,p_company);end$$;

-- 5. Seller: progress update --------------------------------------------------------------------------------
create or replace function public.b2b_deal_progress(p_company uuid,p_deal uuid,p_percent int,p_note text)returns jsonb language plpgsql security definer set search_path=public as $$declare d b2b_deals;c b2b_cards;begin
 d=b2b_deal_for(p_company,p_deal);
 if d.seller<>p_company then raise exception 'เฉพาะผู้รับจ้างอัปเดตงานได้';end if;
 if d.stage not in('accepted','work')then raise exception 'อัปเดตงานได้ระหว่างทำงาน (ก่อนส่งมอบ)';end if;
 if p_percent is null or p_percent<0 or p_percent>100 then raise exception 'ความคืบหน้า 0–100%%';end if;
 if length(trim(coalesce(p_note,'')))not between 1 and 2000 then raise exception 'เล่าความคืบหน้าสั้น ๆ ด้วยนะคะ';end if;
 insert into b2b_cards(deal_id,company_id,author_id,author_name,kind,status,data)values(d.id,p_company,auth.uid(),feed_author(p_company),'progress','accepted',
  jsonb_build_object('title',d.title,'items','[]'::jsonb,'percent',p_percent,'notes',trim(p_note)))returning * into c;
 update b2b_deals set stage='work',updated_at=now()where id=d.id;
 if d.seller_project is not null then perform b2b_set_entity(d.seller_project,jsonb_build_object('progress',p_percent));end if;
 perform b2b_card_note(p_company,d.thread_id,c.id,'📸 อัปเดตงาน '||p_percent||'%: '||left(trim(p_note),200));
 return b2b_card_json(c,p_company);end$$;

-- 6. Seller: delivers the work; buyer: accepts it (ตรวจรับ) or asks for fixes -----------------------------------
create or replace function public.b2b_deal_deliver(p_company uuid,p_deal uuid,p_note text)returns jsonb language plpgsql security definer set search_path=public as $$declare d b2b_deals;c b2b_cards;begin
 d=b2b_deal_for(p_company,p_deal);
 if d.seller<>p_company then raise exception 'เฉพาะผู้รับจ้างส่งมอบงานได้';end if;
 if d.stage not in('accepted','work')then raise exception 'ส่งมอบได้ระหว่างทำงานเท่านั้น';end if;
 insert into b2b_cards(deal_id,company_id,author_id,author_name,kind,data)values(d.id,p_company,auth.uid(),feed_author(p_company),'delivery',
  jsonb_build_object('title',d.title,'items','[]'::jsonb,'notes',left(trim(coalesce(p_note,'')),2000),'round',(select count(*)+1 from b2b_cards where deal_id=d.id and kind='delivery')))returning * into c;
 update b2b_deals set stage='delivered',updated_at=now()where id=d.id;
 if d.seller_project is not null then perform b2b_set_entity(d.seller_project,'{"status":"review","progress":100}');end if;
 perform b2b_card_note(p_company,d.thread_id,c.id,'📦 ส่งมอบงานแล้ว — รอผู้จ้างตรวจรับ'||coalesce(': '||nullif(left(trim(coalesce(p_note,'')),200),''),''));
 return b2b_card_json(c,p_company);end$$;

create or replace function public.b2b_deal_check(p_company uuid,p_card uuid,p_ok boolean,p_reason text default null)returns jsonb language plpgsql security definer set search_path=public as $$declare c b2b_cards;d b2b_deals;paid boolean;begin
 select * into c from b2b_cards where id=p_card for update;
 if not found or c.kind<>'delivery' then raise exception 'ไม่พบการส่งมอบงานนี้';end if;
 d=b2b_deal_for(p_company,c.deal_id);
 if d.buyer<>p_company then raise exception 'เฉพาะผู้จ้างตรวจรับงานได้';end if;
 if c.status<>'open' or d.stage<>'delivered' then raise exception 'การส่งมอบนี้ตรวจไปแล้ว';end if;
 if not p_ok and length(trim(coalesce(p_reason,'')))<3 then raise exception 'บอกสิ่งที่ต้องแก้ด้วยนะคะ';end if;
 update b2b_cards set status=case when p_ok then 'accepted' else 'change' end,reason=nullif(left(trim(coalesce(p_reason,'')),1000),''),decided_by=feed_author(p_company),decided_at=now()where id=c.id returning * into c;
 if p_ok then
  paid=b2b_deal_fully_paid(d.id);
  update b2b_deals set stage=case when paid then 'closed' else 'checked' end,updated_at=now()where id=d.id;
  if d.seller_project is not null then perform b2b_set_entity(d.seller_project,'{"status":"completed","progress":100}');end if;
  if d.buyer_task is not null then perform b2b_set_entity(d.buyer_task,'{"status":"done"}');end if;
  perform b2b_card_note(p_company,d.thread_id,c.id,'✅ ตรวจรับงานแล้ว'||case when paid then ' — ปิดงานเรียบร้อย' else '' end);
 else
  update b2b_deals set stage='work',updated_at=now()where id=d.id;
  if d.seller_project is not null then perform b2b_set_entity(d.seller_project,'{"status":"active"}');end if;
  perform b2b_card_note(p_company,d.thread_id,c.id,'🔁 ขอแก้งาน: '||left(trim(p_reason),300));
 end if;
 return b2b_card_json(c,p_company);end$$;

-- 7. Money ---------------------------------------------------------------------------------------------------
-- Every instalment has a confirmed payment.
create or replace function public.b2b_deal_fully_paid(p_deal uuid)returns boolean language plpgsql stable security definer set search_path=public as $$declare q b2b_cards;n int;begin
 q=b2b_accepted_quote(p_deal);
 if q.id is null then return false;end if;
 n=jsonb_array_length(b2b_installments(q.data->'installments'));
 return(select count(distinct(data->>'index')::int)from b2b_cards where deal_id=p_deal and kind='invoice' and status='accepted')>=n;end$$;

-- Seller bills one instalment. The last one only after the work is accepted.
create or replace function public.b2b_deal_invoice(p_company uuid,p_deal uuid,p_index int,p_due date default null)returns jsonb language plpgsql security definer set search_path=public as $$declare
 d b2b_deals;q b2b_cards;a jsonb;c b2b_cards;due date;doc text;inv uuid;today date=b2b_bkk_today();begin
 d=b2b_deal_for(p_company,p_deal);
 if d.seller<>p_company then raise exception 'เฉพาะผู้รับจ้างออกใบแจ้งหนี้ได้';end if;
 if d.stage not in('accepted','work','delivered','checked')then raise exception 'ออกใบแจ้งหนี้ได้หลังตกลงจ้างงานเท่านั้น';end if;
 q=b2b_accepted_quote(d.id);
 a=b2b_installment_amount(q.data,p_index);
 if p_index=(a->>'count')::int-1 and d.stage<>'checked' then raise exception 'งวดสุดท้ายออกได้หลังผู้จ้างตรวจรับงานแล้ว';end if;
 if exists(select 1 from b2b_cards where deal_id=d.id and kind='invoice' and(data->>'index')::int=p_index and status in('open','accepted'))then raise exception 'งวดนี้ออกใบแจ้งหนี้ไปแล้ว';end if;
 due=coalesce(p_due,today+30);
 if due<today then raise exception 'วันครบกำหนดต้องไม่ใช่วันที่ผ่านมาแล้ว';end if;
 doc='IV'||to_char(now()at time zone 'Asia/Bangkok','YYMM')||'-'||upper(left(replace(d.id::text,'-',''),5))||'-'||(p_index+1);
 insert into entities(company_id,kind,department,data)values(d.seller,'invoices','Finance',jsonb_strip_nulls(jsonb_build_object('name',doc,'customerId',d.seller_customer,'date',today,'dueDate',due,
  'subtotal',(a->>'net')::numeric,'vat',case when (a->>'vat')::numeric>0 then 7 else 0 end,'total',(a->>'amount')::numeric,'status','issued',
  'description',d.title||' — '||(a->>'label')||' ('||(a->>'percent')||'%) ตามใบเสนอราคา '||(q.data->>'docNo'),'b2bDealId',d.id)))returning id into inv;
 insert into b2b_cards(deal_id,company_id,author_id,author_name,kind,data,seller_ref)values(d.id,p_company,auth.uid(),feed_author(p_company),'invoice',
  a||jsonb_build_object('title',d.title,'items','[]'::jsonb,'docNo',doc,'due',due,'quoteNo',q.data->>'docNo','vatMode',q.data->>'vatMode','seller',q.data->'seller','buyer',q.data->'buyer'),inv)returning * into c;
 perform b2b_card_note(p_company,d.thread_id,c.id,'🧾 ใบแจ้งหนี้ '||(a->>'label')||': ฿'||to_char((a->>'amount')::numeric,'FM999,999,999,990.00')||' ครบกำหนด '||to_char(due,'DD/MM/YYYY'));
 return b2b_card_json(c,p_company);end$$;

-- Buyer reports a payment for an invoice (transfer = amount − withholding tax on the pre-VAT part).
create or replace function public.b2b_deal_pay(p_company uuid,p_card uuid,p_data jsonb)returns jsonb language plpgsql security definer set search_path=public as $$declare
 i b2b_cards;d b2b_deals;c b2b_cards;rate numeric;wht numeric;paid_on date;method text;begin
 select * into i from b2b_cards where id=p_card for update;
 if not found or i.kind<>'invoice' then raise exception 'ไม่พบใบแจ้งหนี้นี้';end if;
 d=b2b_deal_for(p_company,i.deal_id);
 if d.buyer<>p_company then raise exception 'เฉพาะผู้จ้างแจ้งชำระได้';end if;
 if i.status<>'open' or d.stage='cancelled' then raise exception 'ใบแจ้งหนี้นี้ชำระแล้วหรือถูกยกเลิก';end if;
 if exists(select 1 from b2b_cards where deal_id=d.id and kind='payment' and status='open' and data->>'invoice'=i.id::text)then raise exception 'แจ้งชำระงวดนี้แล้ว รอผู้รับจ้างยืนยัน';end if;
 rate=coalesce(nullif(p_data->>'whtRate','')::numeric,0);
 if rate not in(0,1,2,3,5)then raise exception 'อัตราหัก ณ ที่จ่ายต้องเป็น 0, 1, 2, 3 หรือ 5%%';end if;
 wht=round((i.data->>'net')::numeric*rate/100,2);
 paid_on=coalesce(nullif(p_data->>'date','')::date,b2b_bkk_today());
 if paid_on>b2b_bkk_today()then raise exception 'วันที่โอนต้องไม่เป็นวันในอนาคต';end if;
 method=coalesce(nullif(p_data->>'method',''),'โอนธนาคาร');
 if method not in('โอนธนาคาร','เงินสด','บัตร','อื่นๆ')then raise exception 'ช่องทางชำระไม่ถูกต้อง';end if;
 insert into b2b_cards(deal_id,company_id,author_id,author_name,kind,data)values(d.id,p_company,auth.uid(),feed_author(p_company),'payment',
  jsonb_build_object('title',d.title,'items','[]'::jsonb,'invoice',i.id,'invoiceNo',i.data->>'docNo','label',i.data->>'label','index',(i.data->>'index')::int,
   'amount',(i.data->>'amount')::numeric,'net',(i.data->>'net')::numeric,'vat',(i.data->>'vat')::numeric,'whtRate',rate,'wht',wht,'transfer',(i.data->>'amount')::numeric-wht,
   'date',paid_on,'method',method,'reference',left(coalesce(p_data->>'reference',''),100),'notes',left(coalesce(p_data->>'notes',''),1000)))returning * into c;
 perform b2b_card_note(p_company,d.thread_id,c.id,'💳 แจ้งชำระ '||(i.data->>'label')||': โอน ฿'||to_char((i.data->>'amount')::numeric-wht,'FM999,999,999,990.00')
  ||case when wht>0 then ' (หัก ณ ที่จ่าย '||rate||'% ฿'||to_char(wht,'FM999,999,990.00')||')' else '' end||' — รอผู้รับจ้างยืนยัน');
 return b2b_card_json(c,p_company);end$$;

-- Seller confirms the money arrived (→ receipt, records on both sides) or says it has not.
create or replace function public.b2b_deal_receive(p_company uuid,p_card uuid,p_ok boolean,p_reason text default null)returns jsonb language plpgsql security definer set search_path=public as $$declare
 p b2b_cards;i b2b_cards;d b2b_deals;rc text;pay uuid;exp uuid;closed boolean;begin
 select * into p from b2b_cards where id=p_card for update;
 if not found or p.kind<>'payment' then raise exception 'ไม่พบการแจ้งชำระนี้';end if;
 d=b2b_deal_for(p_company,p.deal_id);
 if d.seller<>p_company then raise exception 'เฉพาะผู้รับจ้างยืนยันรับเงินได้';end if;
 if p.status<>'open' then raise exception 'ยืนยันรายการนี้ไปแล้ว';end if;
 if not p_ok then
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'บอกเหตุผลด้วยนะคะ เช่น ยอดยังไม่เข้าบัญชี';end if;
  update b2b_cards set status='rejected',reason=left(trim(p_reason),1000),decided_by=feed_author(p_company),decided_at=now()where id=p.id returning * into p;
  perform b2b_card_note(p_company,d.thread_id,p.id,'⚠️ ยังไม่ได้รับเงิน '||(p.data->>'label')||': '||left(trim(p_reason),300));
  return b2b_card_json(p,p_company);
 end if;
 select * into i from b2b_cards where id=(p.data->>'invoice')::uuid for update;
 rc='RC'||to_char(now()at time zone 'Asia/Bangkok','YYMM')||'-'||upper(left(replace(d.id::text,'-',''),5))||'-'||((p.data->>'index')::int+1);
 -- seller: the invoice is paid, the money is recorded
 if i.seller_ref is not null then perform b2b_set_entity(i.seller_ref,jsonb_build_object('status','paid','paidAt',p.data->>'date','receiptNo',rc));end if;
 insert into entities(company_id,kind,department,data)values(d.seller,'payments','Finance',jsonb_strip_nulls(jsonb_build_object('name',rc,'invoiceId',i.seller_ref,'direction','income',
  'date',p.data->>'date','amount',(p.data->>'amount')::numeric,'method',p.data->>'method','reference',nullif(p.data->>'reference',''),
  'notes','รับชำระ '||(p.data->>'label')||' จาก '||(i.data->'buyer'->>'name')||case when (p.data->>'wht')::numeric>0 then ' · ถูกหัก ณ ที่จ่าย ฿'||(p.data->>'wht') else '' end,'b2bDealId',d.id)))returning id into pay;
 -- buyer: the expense (approved, paid by transfer) with the supplier and withholding tax
 insert into entities(company_id,kind,department,data)values(d.buyer,'expenses','Finance',jsonb_strip_nulls(jsonb_build_object('name',d.title||' — '||(p.data->>'label'),
  'category','บริการทั่วไป/ฟรีแลนซ์','supplierId',d.buyer_supplier,'payee',i.data->'seller'->>'name','payeeType','บริษัท / Supplier','taxId',nullif(i.data->'seller'->>'taxId',''),
  'docType',case when (p.data->>'vat')::numeric>0 then 'ใบกำกับภาษีเต็มรูป' else 'ใบเสร็จ' end,'docNo',rc,'date',p.data->>'date','amount',(p.data->>'amount')::numeric,
  'vatMode',case when (p.data->>'vat')::numeric>0 then 'included' else 'none' end,'whtRate',(p.data->>'whtRate')::numeric::int::text,'payStatus','โอนแล้ว','status','approved',
  'notes','ห้องดีล EliteFlow: ใบแจ้งหนี้ '||(i.data->>'docNo')||' ใบเสร็จ '||rc,'b2bDealId',d.id)))returning id into exp;
 update b2b_cards set status='accepted',decided_by=feed_author(p_company),decided_at=now(),seller_ref=pay,buyer_ref=exp,data=data||jsonb_build_object('receiptNo',rc)where id=p.id returning * into p;
 update b2b_cards set status='accepted',decided_at=now()where id=i.id;
 closed=d.stage='checked' and b2b_deal_fully_paid(d.id);
 if closed then update b2b_deals set stage='closed',updated_at=now()where id=d.id;else update b2b_deals set updated_at=now()where id=d.id;end if;
 perform b2b_card_note(p_company,d.thread_id,p.id,'🧾 ได้รับเงินแล้ว ออกใบเสร็จ '||rc||' ฿'||to_char((p.data->>'amount')::numeric,'FM999,999,999,990.00')||case when closed then ' — ปิดงานเรียบร้อย 🎉' else '' end);
 return b2b_card_json(p,p_company);end$$;

-- 8. Cancel after agreement: one side asks, the other agrees or not --------------------------------------------
create or replace function public.b2b_deal_cancel(p_company uuid,p_deal uuid,p_reason text)returns jsonb language plpgsql security definer set search_path=public as $$declare d b2b_deals;c b2b_cards;begin
 d=b2b_deal_for(p_company,p_deal);
 if d.stage not in('accepted','work','delivered','checked')then raise exception 'ขอยกเลิกได้เฉพาะงานที่ตกลงจ้างแล้วและยังไม่ปิด';end if;
 if length(trim(coalesce(p_reason,'')))<3 then raise exception 'บอกเหตุผลที่ขอยกเลิกด้วยนะคะ';end if;
 if exists(select 1 from b2b_cards where deal_id=d.id and kind='cancel' and status='open')then raise exception 'มีคำขอยกเลิกที่รออีกฝ่ายตอบอยู่แล้ว';end if;
 insert into b2b_cards(deal_id,company_id,author_id,author_name,kind,data)values(d.id,p_company,auth.uid(),feed_author(p_company),'cancel',
  jsonb_build_object('title',d.title,'items','[]'::jsonb,'notes',left(trim(p_reason),1000),
   'paid',(select coalesce(sum((data->>'amount')::numeric),0)from b2b_cards where deal_id=d.id and kind='invoice' and status='accepted')))returning * into c;
 perform b2b_card_note(p_company,d.thread_id,c.id,'🛑 ขอยกเลิกงาน: '||left(trim(p_reason),300)||' — รออีกฝ่ายยืนยัน');
 return b2b_card_json(c,p_company);end$$;

create or replace function public.b2b_deal_cancel_answer(p_company uuid,p_card uuid,p_agree boolean,p_reason text default null)returns jsonb language plpgsql security definer set search_path=public as $$declare c b2b_cards;d b2b_deals;r record;begin
 select * into c from b2b_cards where id=p_card for update;
 if not found or c.kind<>'cancel' then raise exception 'ไม่พบคำขอยกเลิกนี้';end if;
 d=b2b_deal_for(p_company,c.deal_id);
 if c.company_id=p_company then raise exception 'อีกฝ่ายต้องเป็นผู้ยืนยันการยกเลิก';end if;
 if c.status<>'open' then raise exception 'ตอบคำขอนี้ไปแล้ว';end if;
 if p_agree and member_role(p_company)not in('owner','manager')then raise exception 'เฉพาะเจ้าของหรือผู้จัดการยืนยันการยกเลิกได้';end if;
 update b2b_cards set status=case when p_agree then 'accepted' else 'rejected' end,reason=nullif(left(trim(coalesce(p_reason,'')),1000),''),decided_by=feed_author(p_company),decided_at=now()where id=c.id returning * into c;
 if not p_agree then
  perform b2b_card_note(p_company,d.thread_id,c.id,'▶️ ไม่ยินยอมยกเลิก ทำงานต่อ'||coalesce(': '||nullif(left(trim(coalesce(p_reason,'')),300),''),''));
  return b2b_card_json(c,p_company);
 end if;
 -- unpaid invoices and pending payment reports are void; the seller's open invoices are cancelled
 for r in select id,seller_ref from b2b_cards where deal_id=d.id and kind='invoice' and status='open' loop
  if r.seller_ref is not null then perform b2b_set_entity(r.seller_ref,'{"status":"cancelled"}');end if;
 end loop;
 update b2b_cards set status='withdrawn' where deal_id=d.id and kind in('invoice','payment','delivery') and status='open';
 update b2b_deals set stage='cancelled',updated_at=now()where id=d.id;
 if d.seller_project is not null then perform b2b_set_entity(d.seller_project,'{"status":"cancelled"}');end if;
 if d.buyer_task is not null then perform b2b_set_entity(d.buyer_task,jsonb_build_object('status','done','notes','ยกเลิกงานตามที่ทั้งสองฝ่ายตกลง: '||(c.data->>'notes')));end if;
 perform b2b_card_note(p_company,d.thread_id,c.id,'🛑 ยกเลิกงานแล้ว (ทั้งสองฝ่ายยืนยัน)'||case when (c.data->>'paid')::numeric>0 then ' · มีเงินที่ชำระแล้ว ฿'||to_char((c.data->>'paid')::numeric,'FM999,999,999,990.00')||' ให้ตกลงคืนกันโดยตรง' else '' end);
 return b2b_card_json(c,p_company);end$$;

revoke all on function public.b2b_installments(jsonb),public.b2b_deal_for(uuid,uuid),public.b2b_accepted_quote(uuid),public.b2b_installment_amount(jsonb,int),public.b2b_set_entity(uuid,jsonb),public.b2b_deal_fully_paid(uuid)from public,anon,authenticated;
revoke all on function public.b2b_deal_progress(uuid,uuid,int,text),public.b2b_deal_deliver(uuid,uuid,text),public.b2b_deal_check(uuid,uuid,boolean,text),public.b2b_deal_invoice(uuid,uuid,int,date),public.b2b_deal_pay(uuid,uuid,jsonb),public.b2b_deal_receive(uuid,uuid,boolean,text),public.b2b_deal_cancel(uuid,uuid,text),public.b2b_deal_cancel_answer(uuid,uuid,boolean,text)from public,anon;
grant execute on function public.b2b_deal_progress(uuid,uuid,int,text),public.b2b_deal_deliver(uuid,uuid,text),public.b2b_deal_check(uuid,uuid,boolean,text),public.b2b_deal_invoice(uuid,uuid,int,date),public.b2b_deal_pay(uuid,uuid,jsonb),public.b2b_deal_receive(uuid,uuid,boolean,text),public.b2b_deal_cancel(uuid,uuid,text),public.b2b_deal_cancel_answer(uuid,uuid,boolean,text)to authenticated;
