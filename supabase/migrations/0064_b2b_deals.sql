-- ห้องดีล (phase 1): inside a B2B conversation the buyer sends a request for quotation (RFQ), the seller answers
-- with a quotation (Rev.1, Rev.2 … each new one replaces the last), and the buyer accepts, asks for changes or
-- rejects — all as cards in the chat that both companies see the same way.
-- A card is a snapshot of what was sent: each company's own records stay private. On acceptance the seller gets a
-- customer, the quotation (ตอบรับ) and a project; the buyer gets the supplier and a follow-up task.
-- Writes go through these functions only (members of the two companies; viewers read only; owners and managers
-- accept or reject).

create table public.b2b_deals(
 id uuid primary key default gen_random_uuid(),
 thread_id uuid not null references b2b_threads(id)on delete cascade,
 buyer uuid not null references companies(id),
 seller uuid not null references companies(id),
 title text not null check(length(title)between 1 and 200),
 stage text not null default 'request' check(stage in('request','quote','accepted','rejected','cancelled')),
 accepted_at timestamptz,accepted_by text,
 seller_quote uuid,seller_project uuid,seller_customer uuid,buyer_supplier uuid,buyer_task uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(buyer<>seller));
create index b2b_deals_thread on b2b_deals(thread_id,created_at desc);
create table public.b2b_cards(
 id uuid primary key default gen_random_uuid(),
 deal_id uuid not null references b2b_deals(id)on delete cascade,
 company_id uuid not null references companies(id),
 author_id uuid,author_name text not null,
 kind text not null check(kind in('request','quote')),
 rev int not null default 1,
 data jsonb not null,
 status text not null default 'open' check(status in('open','accepted','change','rejected','superseded','withdrawn')),
 reason text,decided_by text,decided_at timestamptz,
 created_at timestamptz not null default now());
create index b2b_cards_deal on b2b_cards(deal_id,created_at);
alter table b2b_messages add column card_id uuid references b2b_cards(id)on delete set null;
alter table b2b_deals enable row level security;alter table b2b_cards enable row level security;
revoke all on b2b_deals,b2b_cards from anon,authenticated;
grant all on b2b_deals,b2b_cards to service_role;

-- Internal helpers -------------------------------------------------------------------------------------------
create or replace function public.b2b_bkk_today()returns date language sql stable as $$select(now()at time zone 'Asia/Bangkok')::date$$;

-- What a document shows about a company (from its company page details).
create or replace function public.b2b_party(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',c.id,'name',coalesce(nullif(c.profile->>'name',''),c.name),
  'taxId',coalesce(nullif(c.profile->>'taxId',''),nullif(c.profile->>'registration',''),''),
  'address',coalesce(c.profile->>'address',''),'phone',coalesce(c.profile->>'phone',''))
 from companies c where c.id=p_company$$;

create or replace function public.b2b_writer(p_company uuid)returns void language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์ทำรายการในนามบริษัทนี้';end if;end$$;

-- A chat line pointing at a card, so the inbox, unread counts and LINE-style previews keep working.
create or replace function public.b2b_card_note(p_company uuid,p_thread uuid,p_card uuid,p_body text)returns void language plpgsql security definer set search_path=public as $$declare m b2b_messages;begin
 insert into b2b_messages(thread_id,company_id,author_id,author_name,body,card_id)values(p_thread,p_company,auth.uid(),feed_author(p_company),left(p_body,4000),p_card)returning * into m;
 update b2b_threads set last_at=m.created_at where id=p_thread;
 insert into b2b_reads(thread_id,company_id,read_at)values(p_thread,p_company,m.created_at)on conflict(thread_id,company_id)do update set read_at=excluded.read_at;end$$;

-- Items of a request or quotation: name, quantity, unit (and price on a quotation); blank rows dropped.
create or replace function public.b2b_items(p_items jsonb,p_priced boolean)returns jsonb language plpgsql immutable as $$declare out jsonb='[]';x jsonb;q numeric;p numeric;begin
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'ใส่รายการอย่างน้อย 1 รายการ';end if;
 for x in select value from jsonb_array_elements(p_items)loop
  continue when trim(coalesce(x->>'name',''))='';
  q=coalesce(nullif(x->>'qty','')::numeric,1);
  if q<=0 or q>1e9 then raise exception 'จำนวนต้องมากกว่า 0';end if;
  if p_priced then p=coalesce(nullif(x->>'price','')::numeric,0);if p<0 or p>1e12 then raise exception 'ราคาไม่ถูกต้อง';end if;end if;
  out=out||jsonb_build_array(jsonb_build_object('name',left(trim(x->>'name'),300),'qty',q,'unit',left(trim(coalesce(x->>'unit','')),30))
        ||case when p_priced then jsonb_build_object('price',p,'amount',round(q*p,2))else '{}'::jsonb end);
 end loop;
 if jsonb_array_length(out)=0 then raise exception 'ใส่รายการอย่างน้อย 1 รายการ';end if;
 if jsonb_array_length(out)>100 then raise exception 'ไม่เกิน 100 รายการ';end if;
 return out;end$$;

create or replace function public.b2b_card_json(c b2b_cards,p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',c.id,'deal_id',c.deal_id,'kind',c.kind,'rev',c.rev,'data',c.data,'status',c.status,'reason',c.reason,
  'decided_by',c.decided_by,'decided_at',c.decided_at,'author_name',c.author_name,'created_at',c.created_at,
  'mine',c.company_id=p_company,'company_id',c.company_id)$$;

-- Read ------------------------------------------------------------------------------------------------------
-- The deals of a conversation with all their cards (oldest card first) and which side we are on.
create or replace function public.b2b_deals_of(p_company uuid,p_thread uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$declare t b2b_threads;begin
 t=b2b_thread_of(p_company,p_thread);
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'stage',d.stage,'role',case when d.buyer=p_company then 'buyer' else 'seller' end,
   'accepted_at',d.accepted_at,'accepted_by',d.accepted_by,'created_at',d.created_at,'updated_at',d.updated_at,
   'project_id',case when d.seller=p_company then d.seller_project end,'quote_id',case when d.seller=p_company then d.seller_quote end,
   'task_id',case when d.buyer=p_company then d.buyer_task end,
   'cards',(select coalesce(jsonb_agg(b2b_card_json(c,p_company)order by c.created_at),'[]')from b2b_cards c where c.deal_id=d.id))
  order by d.created_at)from b2b_deals d where d.thread_id=t.id),'[]');end$$;

-- Messages now also say which card they point at.
create or replace function public.b2b_read(p_company uuid,p_thread uuid,p_before timestamptz default null)returns jsonb language plpgsql security definer set search_path=public as $$declare t b2b_threads;begin
 t=b2b_thread_of(p_company,p_thread);
 insert into b2b_reads(thread_id,company_id,read_at)values(t.id,p_company,now())on conflict(thread_id,company_id)do update set read_at=now();
 return coalesce((select jsonb_agg(x order by x->>'created_at')from(
  select jsonb_build_object('id',m.id,'company_id',m.company_id,'company_name',c.name,'author_name',m.author_name,'body',m.body,'created_at',m.created_at,'mine',m.company_id=p_company,
   'post',b2b_post_card(m.post_id,true),'card_id',m.card_id)x
  from b2b_messages m join companies c on c.id=m.company_id
  where m.thread_id=t.id and(p_before is null or m.created_at<p_before)order by m.created_at desc limit 200)q),'[]');end$$;

-- 1. The buyer asks for a quotation ---------------------------------------------------------------------------
create or replace function public.b2b_deal_request(p_company uuid,p_thread uuid,p_title text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=public as $$declare t b2b_threads;d b2b_deals;c b2b_cards;data jsonb;need date;budget numeric;begin
 perform b2b_writer(p_company);t=b2b_thread_of(p_company,p_thread);
 if length(trim(coalesce(p_title,'')))not between 1 and 200 then raise exception 'ใส่หัวข้องานที่ต้องการ';end if;
 need=nullif(p_data->>'needBy','')::date;budget=nullif(p_data->>'budget','')::numeric;
 if budget is not null and(budget<0 or budget>1e12)then raise exception 'งบประมาณไม่ถูกต้อง';end if;
 data=jsonb_build_object('title',trim(p_title),'items',b2b_items(p_data->'items',false),'needBy',need,'budget',budget,
  'notes',left(coalesce(p_data->>'notes',''),2000),'buyer',b2b_party(p_company));
 insert into b2b_deals(thread_id,buyer,seller,title)values(t.id,p_company,case when t.company_a=p_company then t.company_b else t.company_a end,trim(p_title))returning * into d;
 insert into b2b_cards(deal_id,company_id,author_id,author_name,kind,data)values(d.id,p_company,auth.uid(),feed_author(p_company),'request',data)returning * into c;
 perform b2b_card_note(p_company,t.id,c.id,'📝 ขอใบเสนอราคา: '||trim(p_title));
 return b2b_card_json(c,p_company);end$$;

-- 2. The seller sends a quotation (for a request, or on its own); a new one replaces the open one -------------
create or replace function public.b2b_deal_quote(p_company uuid,p_thread uuid,p_deal uuid,p_title text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=public as $$declare
 t b2b_threads;d b2b_deals;c b2b_cards;items jsonb;sub numeric;disc numeric;net numeric;vat numeric;total numeric;mode text;valid date;r int;doc text;begin
 perform b2b_writer(p_company);t=b2b_thread_of(p_company,p_thread);
 if length(trim(coalesce(p_title,'')))not between 1 and 200 then raise exception 'ใส่หัวข้อใบเสนอราคา';end if;
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
 -- the open quotation (if any) is replaced by this one
 update b2b_cards set status='superseded' where deal_id=d.id and kind='quote' and status in('open','change');
 r=coalesce((select max(rev)from b2b_cards where deal_id=d.id and kind='quote'),0)+1;
 doc='QT'||to_char(now()at time zone 'Asia/Bangkok','YYMM')||'-'||upper(left(replace(d.id::text,'-',''),5))||case when r>1 then '-R'||r else '' end;
 insert into b2b_cards(deal_id,company_id,author_id,author_name,kind,rev,data)values(d.id,p_company,auth.uid(),feed_author(p_company),'quote',r,
  jsonb_build_object('title',trim(p_title),'docNo',doc,'items',items,'subtotal',sub,'discount',disc,'vatMode',mode,'vat',vat,'total',total,
   'validUntil',valid,'deliverBy',nullif(p_data->>'deliverBy','')::date,'payTerms',left(coalesce(p_data->>'payTerms',''),300),
   'notes',left(coalesce(p_data->>'notes',''),2000),'seller',b2b_party(d.seller),'buyer',b2b_party(d.buyer)))returning * into c;
 update b2b_deals set stage='quote',title=trim(p_title),updated_at=now()where id=d.id;
 perform b2b_card_note(p_company,t.id,c.id,'💰 ใบเสนอราคา'||case when r>1 then ' Rev.'||r else '' end||': '||trim(p_title)||' · ฿'||to_char(total,'FM999,999,999,990.00'));
 return b2b_card_json(c,p_company);end$$;

-- 3. The buyer decides on the latest quotation: accept / change / reject --------------------------------------
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
 -- buyer: supplier (found by network company or name) and a follow-up task
 select id into sup from entities where company_id=d.buyer and kind='suppliers' and archived_at is null
  and(data->>'networkCompanyId'=d.seller::text or lower(trim(data->>'name'))=lower(trim(seller_name)))order by(data->>'networkCompanyId'=d.seller::text)desc nulls last limit 1;
 if sup is null then
  insert into entities(company_id,kind,department,data)values(d.buyer,'suppliers','Purchasing',jsonb_strip_nulls(jsonb_build_object('name',seller_name,'type','นิติบุคคล','category','บริการ','status','active',
   'taxId',nullif(q->'seller'->>'taxId',''),'address',nullif(q->'seller'->>'address',''),'phone',nullif(q->'seller'->>'phone',''),'networkCompanyId',d.seller,'notes','สร้างจากห้องดีล EliteFlow')))returning id into sup;
 end if;
 insert into entities(company_id,kind,department,data,created_by)values(d.buyer,'tasks','Purchasing',jsonb_strip_nulls(jsonb_build_object('name','ติดตามงาน: '||(q->>'title'),'department','Purchasing',
  'priority','normal','status','pending','dueDate',coalesce(q->>'deliverBy',req->>'needBy'),
  'notes','จ้าง '||seller_name||' ยอด ฿'||to_char((q->>'total')::numeric,'FM999,999,999,990.00')||' ตามใบเสนอราคา '||(q->>'docNo')||' (ตอบรับโดย '||who||')','b2bDealId',d.id)),auth.uid())returning id into task;
 update b2b_deals set stage='accepted',accepted_at=now(),accepted_by=who,seller_customer=cust,seller_project=proj,seller_quote=quote,buyer_supplier=sup,buyer_task=task,updated_at=now()where id=d.id;
 perform b2b_card_note(p_company,d.thread_id,c.id,'✅ ตอบรับใบเสนอราคา '||(q->>'docNo')||' · ฿'||to_char((q->>'total')::numeric,'FM999,999,999,990.00')||' — ตกลงจ้างงานแล้ว');
 return b2b_card_json(c,p_company);end$$;

-- 4. Take back a card before anything is agreed: the seller withdraws a quotation, the buyer cancels a request -
create or replace function public.b2b_deal_withdraw(p_company uuid,p_card uuid,p_reason text default null)returns jsonb language plpgsql security definer set search_path=public as $$declare c b2b_cards;d b2b_deals;begin
 perform b2b_writer(p_company);
 select * into c from b2b_cards where id=p_card for update;
 if not found then raise exception 'ไม่พบรายการ';end if;
 select * into d from b2b_deals where id=c.deal_id for update;
 perform b2b_thread_of(p_company,d.thread_id);
 if c.company_id<>p_company then raise exception 'ถอนได้เฉพาะรายการที่บริษัทคุณส่ง';end if;
 if d.stage not in('request','quote')then raise exception 'ดีลนี้ตกลงหรือปิดไปแล้ว';end if;
 if c.kind='quote' then
  if c.status not in('open','change')then raise exception 'ใบเสนอราคานี้ถอนไม่ได้แล้ว';end if;
  update b2b_cards set status='withdrawn',reason=nullif(left(trim(coalesce(p_reason,'')),1000),''),decided_by=feed_author(p_company),decided_at=now()where id=c.id returning * into c;
  update b2b_deals set stage=case when exists(select 1 from b2b_cards where deal_id=d.id and kind='request')then 'request' else 'cancelled' end,updated_at=now()where id=d.id;
  perform b2b_card_note(p_company,d.thread_id,c.id,'↩️ ถอนใบเสนอราคา Rev.'||c.rev||coalesce(': '||nullif(trim(coalesce(p_reason,'')),''),''));
 else
  update b2b_cards set status='withdrawn',reason=nullif(left(trim(coalesce(p_reason,'')),1000),''),decided_by=feed_author(p_company),decided_at=now()where id=c.id returning * into c;
  update b2b_cards set status='withdrawn' where deal_id=d.id and kind='quote' and status in('open','change');
  update b2b_deals set stage='cancelled',updated_at=now()where id=d.id;
  perform b2b_card_note(p_company,d.thread_id,c.id,'🚫 ยกเลิกคำขอใบเสนอราคา: '||d.title);
 end if;
 return b2b_card_json(c,p_company);end$$;

revoke all on function public.b2b_party(uuid),public.b2b_writer(uuid),public.b2b_card_note(uuid,uuid,uuid,text),public.b2b_card_json(b2b_cards,uuid),public.b2b_items(jsonb,boolean)from public,anon,authenticated;
revoke all on function public.b2b_deals_of(uuid,uuid),public.b2b_read(uuid,uuid,timestamptz),public.b2b_deal_request(uuid,uuid,text,jsonb),public.b2b_deal_quote(uuid,uuid,uuid,text,jsonb),public.b2b_deal_decide(uuid,uuid,text,text),public.b2b_deal_withdraw(uuid,uuid,text)from public,anon;
grant execute on function public.b2b_deals_of(uuid,uuid),public.b2b_read(uuid,uuid,timestamptz),public.b2b_deal_request(uuid,uuid,text,jsonb),public.b2b_deal_quote(uuid,uuid,uuid,text,jsonb),public.b2b_deal_decide(uuid,uuid,text,text),public.b2b_deal_withdraw(uuid,uuid,text)to authenticated;
