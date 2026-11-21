-- Deal room: who handles each deal, on both sides. Set when a quotation is accepted (the person who sent it for the
-- contractor, the person who accepted it for the hiring company), shown in the chat and written as each side's project
-- ผู้รับผิดชอบ; a member can take over their own side (b2b_deal_take). Before acceptance the chat shows whoever last
-- wrote a card on each side.
alter table b2b_deals add column if not exists buyer_contact_id uuid,add column if not exists buyer_contact text,
 add column if not exists seller_contact_id uuid,add column if not exists seller_contact text;
-- deals accepted before this: the contractor's side from the accepted quotation, the hiring side from who accepted it
update b2b_deals d set seller_contact_id=c.author_id,seller_contact=c.author_name
 from(select distinct on(deal_id)deal_id,author_id,author_name from b2b_cards where kind='quote' and status='accepted' order by deal_id,created_at desc)c
 where c.deal_id=d.id and d.seller_contact is null;
update b2b_deals set buyer_contact=accepted_by where buyer_contact is null and accepted_by is not null;

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
  'startDate',today,'endDate',q->>'deliverBy','budget',(q->>'total')::numeric,'customerTarget',buyer_name,'owner',c.author_name,
  'description','งานจาก '||buyer_name||' ตามใบเสนอราคา '||(q->>'docNo')||' ที่ตอบรับผ่านห้องดีล EliteFlow · ผู้ดูแลดีล: '||c.author_name||' (เรา) · '||who||' ('||buyer_name||')','b2bDealId',d.id)))returning id into proj;
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
  'startDate',today,'endDate',coalesce(q->>'deliverBy',req->>'needBy'),'budget',(q->>'total')::numeric,'owner',who,'customerTarget',seller_name,
  'description','จ้าง '||seller_name||' ยอด ฿'||to_char((q->>'total')::numeric,'FM999,999,999,990.00')||' ตามใบเสนอราคา '||(q->>'docNo')||' ผ่านห้องดีล EliteFlow · ผู้ดูแลดีล: '||who||' (เรา) · '||c.author_name||' ('||seller_name||')','b2bDealId',d.id)),auth.uid())returning id into task;
 update b2b_deals set stage='accepted',accepted_at=now(),accepted_by=who,seller_customer=cust,seller_project=proj,seller_quote=quote,buyer_supplier=sup,buyer_task=task,
  buyer_contact_id=auth.uid(),buyer_contact=who,seller_contact_id=c.author_id,seller_contact=c.author_name,updated_at=now()where id=d.id;
 perform b2b_card_note(p_company,d.thread_id,c.id,'✅ ตอบรับใบเสนอราคา '||(q->>'docNo')||' · ฿'||to_char((q->>'total')::numeric,'FM999,999,999,990.00')||' — ตกลงจ้างงานแล้ว');
 return b2b_card_json(c,p_company);end$$;

create or replace function public.b2b_deals_of(p_company uuid,p_thread uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$declare t b2b_threads;begin
 t=b2b_thread_of(p_company,p_thread);
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'stage',d.stage,'role',case when d.buyer=p_company then 'buyer' else 'seller' end,
   'accepted_at',d.accepted_at,'accepted_by',d.accepted_by,'created_at',d.created_at,'updated_at',d.updated_at,
   'project_id',case when d.seller=p_company then d.seller_project end,'quote_id',case when d.seller=p_company then d.seller_quote end,
   'task_id',case when d.buyer=p_company then d.buyer_task end,
   -- who handles the deal on each side: set on acceptance (or taken over), before that whoever last wrote a card there
   'contact_mine',coalesce(case when d.buyer=p_company then d.buyer_contact else d.seller_contact end,
     (select x.author_name from b2b_cards x where x.deal_id=d.id and x.company_id=p_company order by x.created_at desc limit 1)),
   'contact_theirs',coalesce(case when d.buyer=p_company then d.seller_contact else d.buyer_contact end,
     (select x.author_name from b2b_cards x where x.deal_id=d.id and x.company_id<>p_company order by x.created_at desc limit 1)),
   'contact_is_me',coalesce(case when d.buyer=p_company then d.buyer_contact_id else d.seller_contact_id end=auth.uid(),false),
   'cards',(select coalesce(jsonb_agg(b2b_card_json(c,p_company)order by c.created_at),'[]')from b2b_cards c where c.deal_id=d.id))
  order by d.created_at)from b2b_deals d where d.thread_id=t.id),'[]');end$$;

-- A member takes over their own side of the deal: the chat says so and their project names them as ผู้รับผิดชอบ.
create or replace function public.b2b_deal_take(p_company uuid,p_deal uuid)returns jsonb language plpgsql security definer set search_path=public as $$declare d b2b_deals;who text;c uuid;ent uuid;begin
 perform b2b_writer(p_company);
 select * into d from b2b_deals where id=p_deal for update;
 if not found or p_company not in(d.buyer,d.seller)then raise exception 'ไม่พบดีลนี้';end if;
 perform b2b_thread_of(p_company,d.thread_id);
 if d.stage in('rejected','cancelled')then raise exception 'ดีลนี้ปิดไปแล้ว';end if;
 who=feed_author(p_company);
 if d.buyer=p_company then update b2b_deals set buyer_contact_id=auth.uid(),buyer_contact=who,updated_at=now()where id=d.id;ent=d.buyer_task;
 else update b2b_deals set seller_contact_id=auth.uid(),seller_contact=who,updated_at=now()where id=d.id;ent=d.seller_project;end if;
 if ent is not null and(select kind from entities where id=ent)='projects' then perform b2b_set_entity(ent,jsonb_build_object('owner',who));end if;
 select id into c from b2b_cards where deal_id=d.id order by created_at desc limit 1;
 perform b2b_card_note(p_company,d.thread_id,c,'👤 '||who||' ดูแลดีล “'||d.title||'” ฝั่ง '||(select name from companies where id=p_company));
 return jsonb_build_object('contact',who);end$$;
revoke all on function b2b_deal_take(uuid,uuid)from public,anon;
grant execute on function b2b_deal_take(uuid,uuid)to authenticated;
