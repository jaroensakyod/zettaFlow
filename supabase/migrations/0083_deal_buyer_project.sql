-- Deal room: when a quotation is accepted, the hiring company gets a project for the work (โปรเจกต์ page) instead of a
-- follow-up task in งาน & Workflow. b2b_deals.buyer_task keeps the id (now a project; older deals still point at a task,
-- which checking or cancelling keeps handling as before).

create or replace function public.b2b_deal_decide(p_company uuid,p_card uuid,p_decision text,p_reason text default null)returns jsonb language plpgsql security definer set search_path=public as $$declare
 c b2b_cards;d b2b_deals;who text;q jsonb;req jsonb;cust uuid;sup uuid;proj uuid;quote uuid;task uuid;today date=b2b_bkk_today();buyer_name text;seller_name text;begin
 perform b2b_writer(p_company);
 select * into c from b2b_cards where id=p_card for update;
 if not found then raise exception 'ไม่พบใบเสนอราคา';end if;
 select * into d from b2b_deals where id=c.deal_id for update;
 perform b2b_thread_of(p_company,d.thread_id);
 if d.buyer<>p_company then raise exception 'เฉพาะผู้ซื้อตัดสินใจได้';end if;
 if c.kind<>'quote' then raise exception 'ตัดสินใจได้เฉพาะใบเสนอราคา';end if;
 if c.status<>'open' or d.stage<>'quote' then raise exception 'ใบเสนอราคานี้ไม่ใช่ฉบับล่าสุดที่รอตัดสินใจแล้ว';end if;
 if p_decision not in('accept','change','reject')then raise exception 'ตัวเลือกไม่ถูกต้อง';end if;
 if p_decision in('accept','reject')and member_role(p_company)not in('owner','manager')then raise exception 'เฉพาะเจ้าของหรือผู้จัดการตอบรับหรือปฏิเสธใบเสนอราคาได้';end if;
 if p_decision='change' and length(trim(coalesce(p_reason,'')))<3 then raise exception 'บอกสิ่งที่อยากให้แก้ไขด้วยนะคะ';end if;
 if p_decision='accept' and(c.data->>'validUntil')::date<today then raise exception 'ใบเสนอราคาหมดอายุแล้ว ขอให้ผู้ขายส่งฉบับใหม่';end if;
 who=feed_author(p_company);
 update b2b_cards set status=case p_decision when 'accept' then 'accepted' when 'change' then 'change' else 'rejected' end,
  reason=nullif(left(trim(coalesce(p_reason,'')),1000),''),decided_by=who,decided_at=now()where id=c.id returning * into c;
 if p_decision='change' then
  update b2b_deals set updated_at=now()where id=d.id;
  perform b2b_card_note(p_company,d.thread_id,c.id,'✏️ ขอแก้ไขใบเสนอราคา Rev.'||c.rev||': '||trim(p_reason));
  return b2b_card_json(c,p_company);
 end if;
 if p_decision='reject' then
  update b2b_deals set stage='rejected',updated_at=now()where id=d.id;
  perform b2b_card_note(p_company,d.thread_id,c.id,'❌ ปฏิเสธใบเสนอราคา'||coalesce(': '||nullif(trim(coalesce(p_reason,'')),''),''));
  return b2b_card_json(c,p_company);
 end if;
 -- accepted: each company gets its own records (snapshots of the parties and the quotation)
 q=c.data;
 req=(select data from b2b_cards where deal_id=d.id and kind='request' order by created_at limit 1);
 buyer_name=q->'buyer'->>'name';seller_name=q->'seller'->>'name';
 -- seller: customer (found by network company or name), project, quotation (ตอบรับ)
 select id into cust from entities where company_id=d.seller and kind='customers' and archived_at is null
  and(data->>'networkCompanyId'=d.buyer::text or lower(trim(data->>'name'))=lower(trim(buyer_name)))order by(data->>'networkCompanyId'=d.buyer::text)desc nulls last limit 1;
 if cust is null then
  insert into entities(company_id,kind,department,data)values(d.seller,'customers','Sales',jsonb_strip_nulls(jsonb_build_object('name',buyer_name,'type','นิติบุคคล','status','active',
   'taxId',nullif(q->'buyer'->>'taxId',''),'address',nullif(q->'buyer'->>'address',''),'phone',nullif(q->'buyer'->>'phone',''),'networkCompanyId',d.buyer,'notes','สร้างจากห้องดีล EliteFlow')))returning id into cust;
 end if;
 insert into entities(company_id,kind,department,data)values(d.seller,'projects','Operations',jsonb_strip_nulls(jsonb_build_object('name',q->>'title','priority','normal','status','active',
  'startDate',today,'endDate',q->>'deliverBy','budget',(q->>'total')::numeric,'customerTarget',buyer_name,
  'description','งานจาก '||buyer_name||' ตามใบเสนอราคา '||(q->>'docNo')||' ที่ตอบรับผ่านห้องดีล EliteFlow','b2bDealId',d.id)))returning id into proj;
 insert into entities(company_id,kind,department,data)values(d.seller,'quotations','Sales',jsonb_strip_nulls(jsonb_build_object('name',q->>'title','customerId',cust,'projectId',proj,'date',today,
  'validUntil',q->>'validUntil','lines',(select jsonb_agg(jsonb_build_object('name',x->>'name','qty',(x->>'qty')::numeric,'price',(x->>'price')::numeric))from jsonb_array_elements(q->'items')x),
  'subtotal',(q->>'subtotal')::numeric,'discount',nullif((q->>'discount')::numeric,0),'vatMode',q->>'vatMode','status','ตอบรับ',
  'notes','ใบเสนอราคา '||(q->>'docNo')||' ตอบรับโดย '||who||' ('||buyer_name||') ผ่านห้องดีล EliteFlow','b2bDealId',d.id)))returning id into quote;
 -- buyer: supplier (found by network company or name) and a project for the work (its โปรเจกต์ page; was a task in งาน & Workflow)
 select id into sup from entities where company_id=d.buyer and kind='suppliers' and archived_at is null
  and(data->>'networkCompanyId'=d.seller::text or lower(trim(data->>'name'))=lower(trim(seller_name)))order by(data->>'networkCompanyId'=d.seller::text)desc nulls last limit 1;
 if sup is null then
  insert into entities(company_id,kind,department,data)values(d.buyer,'suppliers','Purchasing',jsonb_strip_nulls(jsonb_build_object('name',seller_name,'type','นิติบุคคล','category','บริการ','status','active',
   'taxId',nullif(q->'seller'->>'taxId',''),'address',nullif(q->'seller'->>'address',''),'phone',nullif(q->'seller'->>'phone',''),'networkCompanyId',d.seller,'notes','สร้างจากห้องดีล EliteFlow')))returning id into sup;
 end if;
 insert into entities(company_id,kind,department,data,created_by)values(d.buyer,'projects','Operations',jsonb_strip_nulls(jsonb_build_object('name',q->>'title','priority','normal','status','active',
  'startDate',today,'endDate',coalesce(q->>'deliverBy',req->>'needBy'),'budget',(q->>'total')::numeric,'owner',seller_name,
  'description','จ้าง '||seller_name||' ยอด ฿'||to_char((q->>'total')::numeric,'FM999,999,999,990.00')||' ตามใบเสนอราคา '||(q->>'docNo')||' (ตอบรับโดย '||who||') ผ่านห้องดีล EliteFlow','b2bDealId',d.id)),auth.uid())returning id into task;
 update b2b_deals set stage='accepted',accepted_at=now(),accepted_by=who,seller_customer=cust,seller_project=proj,seller_quote=quote,buyer_supplier=sup,buyer_task=task,updated_at=now()where id=d.id;
 perform b2b_card_note(p_company,d.thread_id,c.id,'✅ ตอบรับใบเสนอราคา '||(q->>'docNo')||' · ฿'||to_char((q->>'total')::numeric,'FM999,999,999,990.00')||' — ตกลงจ้างงานแล้ว');
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
  if d.buyer_task is not null then perform b2b_set_entity(d.buyer_task,case when(select kind from entities where id=d.buyer_task)='projects'then '{"status":"completed","progress":100}'::jsonb else '{"status":"done"}'::jsonb end);end if;
  perform b2b_card_note(p_company,d.thread_id,c.id,'✅ ตรวจรับงานแล้ว'||case when paid then ' — ปิดงานเรียบร้อย' else '' end);
 else
  update b2b_deals set stage='work',updated_at=now()where id=d.id;
  if d.seller_project is not null then perform b2b_set_entity(d.seller_project,'{"status":"active"}');end if;
  perform b2b_card_note(p_company,d.thread_id,c.id,'🔁 ขอแก้งาน: '||left(trim(p_reason),300));
 end if;
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
 if d.buyer_task is not null then perform b2b_set_entity(d.buyer_task,case when(select kind from entities where id=d.buyer_task)='projects'
  then jsonb_build_object('status','cancelled','description','ยกเลิกงานตามที่ทั้งสองฝ่ายตกลง: '||(c.data->>'notes'))
  else jsonb_build_object('status','done','notes','ยกเลิกงานตามที่ทั้งสองฝ่ายตกลง: '||(c.data->>'notes'))end);end if;
 perform b2b_card_note(p_company,d.thread_id,c.id,'🛑 ยกเลิกงานแล้ว (ทั้งสองฝ่ายยืนยัน)'||case when (c.data->>'paid')::numeric>0 then ' · มีเงินที่ชำระแล้ว ฿'||to_char((c.data->>'paid')::numeric,'FM999,999,999,990.00')||' ให้ตกลงคืนกันโดยตรง' else '' end);
 return b2b_card_json(c,p_company);end$$;
