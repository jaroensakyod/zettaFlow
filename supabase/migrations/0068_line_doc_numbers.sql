-- Documents from LINE get their number when the bot summarises them (ใบขออนุมัติค่าใช้จ่าย → EXP-69-0001, ใบสั่งซื้อ → PO-…,
-- ใบลา → LV-…, งบการตลาด → MB-…, งบอีเวนต์ → EB-…). The same number is the approval reference and the record's
-- code on the website, so "@บอท ขอเอกสาร EXP-69-0001" finds it. A request to buy (ขอซื้อ / ขอเบิกซื้อ) is an expense
-- approval request whose items keep their own quantity (กระดาษ A4 10 รีม, หมึก 2 กล่อง); purchase orders (PO, goods
-- from a supplier into stock) take item lines too, instead of one product and one summed quantity.

alter table public.ingestions add column if not exists doc_code text;

create or replace function public.code_prefix(p_kind text)returns text language sql immutable as $$select case p_kind
 when 'customers'then 'CUS'when 'suppliers'then 'SUP'when 'quotations'then 'QT'when 'sales_orders'then 'SO'when 'bills'then 'AP'when 'stock_issues'then 'WD'
 when 'purchases'then 'PO'when 'expenses'then 'EXP'when 'leaves'then 'LV'when 'marketing_budget'then 'MB'when 'event_budget'then 'EB' end$$;

-- The next number of a kind for a company (PO-69-0001), reserved.
create or replace function public.take_code(p_company uuid,p_kind text)returns text language plpgsql security definer set search_path=public as $$declare p text;begin
 p=code_prefix(p_kind);if p is null then return null;end if;
 return p||'-'||lpad(thai_year()::text,2,'0')||'-'||lpad(next_number(p_company,p,0)::text,4,'0');end$$;
revoke all on function public.take_code(uuid,text)from public,anon,authenticated;

-- A record made from a LINE item keeps the number shown in LINE; a purchase order's PO number is its code.
create or replace function public.assign_entity_code()returns trigger language plpgsql security definer set search_path=public as $$declare p text;c text;begin
 p=code_prefix(new.kind);
 if p is null then return new;end if;
 if coalesce(new.data->>'code','')='' then
  if tg_op='UPDATE'and coalesce(old.data->>'code','')<>''then new.data=new.data||jsonb_build_object('code',old.data->>'code');
  else
   if tg_op='INSERT'and coalesce(new.data->>'ingestionId','')~'^[0-9a-f-]{36}$'then
    select doc_code into c from ingestions where id=(new.data->>'ingestionId')::uuid and company_id=new.company_id;end if;
   new.data=new.data||jsonb_build_object('code',coalesce(c,take_code(new.company_id,new.kind)));
  end if;end if;
 if new.kind='purchases'and coalesce(new.data->>'poNumber','')=''then new.data=new.data||jsonb_build_object('poNumber',new.data->>'code');end if;
 return new;end$$;

-- Purchase orders: item lines are an alternative to one product + quantity + unit cost.
update entity_schemas set fields=(
  select jsonb_agg(case when f->>'key' in('productId','quantity','unitCost')then f||'{"required":false}'::jsonb else f end order by n)
  from jsonb_array_elements(fields)with ordinality as x(f,n))
 ||case when exists(select 1 from jsonb_array_elements(fields)f where f->>'key'='lines')then '[]'::jsonb
   else '[{"key":"lines","label":"รายการสินค้า","type":"lines","required":false}]'::jsonb end
 where kind='purchases';

-- Total from the lines (or quantity × unit cost); one of the two must be there.
create or replace function public.purchase_figures()returns trigger language plpgsql security definer set search_path=public as $$declare n int;begin
 if new.kind<>'purchases'then return new;end if;
 n=case when jsonb_typeof(new.data->'lines')='array'then jsonb_array_length(new.data->'lines')else 0 end;
 if n>0 then
  new.data=new.data||jsonb_build_object('total',(select coalesce(sum((x->>'qty')::numeric*coalesce((x->>'price')::numeric,0)),0)from jsonb_array_elements(new.data->'lines')x));
 elsif coalesce(new.data->>'productId','')=''or jsonb_typeof(new.data->'quantity')is distinct from 'number'then
  raise exception 'ใส่รายการสินค้า หรือ สินค้า จำนวน และราคาต่อหน่วย';
 end if;
 return new;end$$;
drop trigger if exists entities_purchase_figures on entities;
create trigger entities_purchase_figures before insert or update of data on entities for each row execute function purchase_figures();

-- Receiving a PO of item lines (no product in stock) moves no stock; one product still does.
create or replace function public.purchase_action(p_company uuid,p_id uuid,p_action text) returns void language plpgsql security definer set search_path=public as $$
declare r entities;next_status text;
begin
 if not can_write_dept(p_company,'Purchasing')then raise exception 'ไม่มีสิทธิ์จัดซื้อ';end if;
 select * into r from entities where id=p_id and company_id=p_company and kind='purchases' and archived_at is null for update;
 if r.id is null then raise exception 'ไม่พบใบขอซื้อ';end if;
 if p_action='approve'then
  if member_role(p_company)not in ('owner','manager')or r.data->>'status'<>'draft'then raise exception 'ไม่มีสิทธิ์ หรือรายการนี้อนุมัติแล้ว';end if;
  next_status:='approved';
  r.data:=jsonb_set(r.data,'{poNumber}',to_jsonb(coalesce(nullif(r.data->>'poNumber',''),nullif(r.data->>'code',''),'PO-'||upper(left(replace(r.id::text,'-',''),12)))));
 elsif p_action='receive'then
  if not can_write_dept(p_company,'Warehouse')or r.data->>'status'not in ('approved','pending_vendor','in_progress','pending_delivery','delivered')then raise exception 'ต้องอนุมัติก่อนรับ หรือรับสินค้าไปแล้ว';end if;
  if coalesce(r.data->>'productId','')<>''and jsonb_typeof(r.data->'quantity')='number'then
   perform post_stock_movement(p_company,(r.data->>'productId')::uuid,'in',(r.data->>'quantity')::bigint,'PO:'||p_id::text,'รับตามใบสั่งซื้อ');end if;
  next_status:='received';
 elsif p_action='request_vendor'and r.data->>'status'='approved'then next_status:='pending_vendor';
 elsif p_action='vendor_confirm'and r.data->>'status'='pending_vendor'then next_status:='in_progress';
 elsif p_action='dispatch'and r.data->>'status'='in_progress'then next_status:='pending_delivery';
 elsif p_action='deliver'and r.data->>'status'='pending_delivery'then next_status:='delivered';
 elsif p_action='cancel'and r.data->>'status'not in ('received','cancelled')then
  if r.data->>'status'<>'draft'and member_role(p_company)not in ('owner','manager')then raise exception 'ให้หัวหน้างานยกเลิกใบสั่งซื้อที่อนุมัติแล้ว';end if;next_status:='cancelled';
 else raise exception 'ขั้นตอนนี้ไม่สอดคล้องกับสถานะปัจจุบัน';end if;
 update entities set data=jsonb_set(r.data,'{status}',to_jsonb(next_status)),version=version+1,updated_at=now()where id=p_id;
 perform log_action(p_company,'purchase_'||p_action,p_id::text);
end$$;

-- When the bot finishes reading: the number is reserved once (kept through corrections). A purchase order's
-- เลขที่ใบสั่งซื้อ is that number; what the member wrote as its name moves to หมายเหตุ.
create or replace function public.complete_ingestion(p_id uuid,p_lease uuid,p_values jsonb,p_missing jsonb,p_engine text)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;k text;code text;begin
 select * into i from ingestions where id=p_id and lease_id=p_lease and status='processing'for update;if not found then return;end if;
 if i.group_id is not null and i.target_kind is not null then
  code=coalesce(i.doc_code,take_code(i.company_id,i.target_kind));
  if code is not null and i.target_kind='purchases'then
   if coalesce(p_values->>'name','')not in('',code)then
    p_values=p_values||jsonb_build_object('notes',trim(both ' ·' from (p_values->>'name')||' · '||coalesce(p_values->>'notes','')));end if;
   p_values=p_values||jsonb_build_object('name',code,'poNumber',code);
   -- The order date is the day it was asked for, unless the message says otherwise.
   if coalesce(p_values->>'orderDate','')='' then p_values=p_values||jsonb_build_object('orderDate',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'));
    p_missing=coalesce((select jsonb_agg(m)from jsonb_array_elements(p_missing)m where m#>>'{}'not like 'วันที่สั่งซื้อ%'),'[]'::jsonb);end if;
   p_missing=coalesce((select jsonb_agg(m)from jsonb_array_elements(p_missing)m where m#>>'{}'not like 'เลขที่ใบสั่งซื้อ%'),'[]'::jsonb);
   -- Item lines stand in for one product / quantity / unit cost.
   if jsonb_typeof(p_values->'lines')='array'and jsonb_array_length(p_values->'lines')>0 then
    p_missing=coalesce((select jsonb_agg(m)from jsonb_array_elements(p_missing)m where m#>>'{}'not like 'สินค้า%'and m#>>'{}'not like 'จำนวน%'and m#>>'{}'not like 'ราคาต่อหน่วย%'),'[]'::jsonb);end if;
  end if;
  -- An expense request priced per item: its amount is the items' total when none was written.
  if i.target_kind='expenses'and jsonb_typeof(p_values->'amount')is distinct from 'number'and jsonb_typeof(p_values->'lines')='array'then
   p_values=p_values||jsonb_build_object('amount',(select coalesce(sum((x->>'qty')::numeric*(x->>'price')::numeric),0)from jsonb_array_elements(p_values->'lines')x
    where jsonb_typeof(x->'qty')='number'and jsonb_typeof(x->'price')='number'));
   if (p_values->>'amount')::numeric>0 then p_missing=coalesce((select jsonb_agg(x)from jsonb_array_elements(p_missing)x where x#>>'{}'not like 'ยอด%'),'[]'::jsonb);
   else p_values=p_values-'amount';end if;
  end if;
  update ingestions set doc_code=code where id=p_id;
 end if;
 update ingestions set values=p_values,missing=p_missing,engine=p_engine,status=case when i.confirm then 'draft' else 'review' end,lease_until=null where id=p_id;
 if i.group_id is not null and not i.confirm then select * into i from ingestions where id=p_id;update ingestions set approval=approval_plan(i)where id=p_id;end if;
 select approve_keywords[1]into k from line_groups where group_id=i.group_id;
 if i.group_id is not null then insert into notification_outbox(id,company_id,target,body)values(i.id,i.company_id,i.group_id,left(case when i.confirm
  then '📝 สรุปก่อนบันทึก ('||coalesce(code,left(i.id::text,8))||')'
  when jsonb_array_length(p_missing)>0
  then '⚠️ ZettaFlow: ข้อมูลยังไม่ครบ ('||coalesce(code,left(i.id::text,8))||')'||chr(10)||'กรุณาส่งเพิ่ม: '||(select string_agg(value,', ')from jsonb_array_elements_text(p_missing))
  else '📨 ส่งขออนุมัติรายการ '||coalesce(code,left(i.id::text,8))||' แล้ว (ยังไม่ถือว่าอนุมัติ)' end,4500))on conflict(id)do nothing;end if;end$$;
revoke execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)from public,anon,authenticated;grant execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)to service_role;

-- The approval reference is the document number when there is one.
create or replace function public.approval_plan(i ingestions)returns jsonb language plpgsql stable security definer set search_path=public as $$
declare req text;second text;amt numeric;kind text:=coalesce(i.target_kind,i.template->>'target_kind');steps jsonb;begin
 select department into req from line_groups where group_id=i.group_id;
 if req is null then
  select m.departments[1] into req from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id
   where u.company_id=i.company_id and u.line_user_id=i.source_user;end if;
 req=coalesce(req,i.department);
 second=case when kind in('marketing_budget','event_budget') then 'Finance' when kind='leaves' then 'HR' else i.department end;
 amt=coalesce(approval_amount(i.values),
  (select sum((x->>'qty')::numeric*(x->>'price')::numeric)from jsonb_array_elements(case when jsonb_typeof(i.values->'lines')='array'then i.values->'lines'else '[]'::jsonb end)x
   where jsonb_typeof(x->'qty')='number'and jsonb_typeof(x->'price')='number'));
 if kind is distinct from 'leaves' and amt is not null and amt<5000 then second=null;end if;
 steps=jsonb_build_array(jsonb_build_object('dept',req));
 if second is not null and second is distinct from req then steps=steps||jsonb_build_object('dept',second);end if;
 return jsonb_build_object('steps',steps,'at',0,'round',coalesce((i.approval->>'round')::int,1),
  'ref',coalesce(i.doc_code,'EF-'||upper(left(replace(i.id::text,'-',''),8))),'history',coalesce(i.approval->'history','[]'::jsonb));end$$;
revoke all on function public.approval_plan(ingestions)from public,anon,authenticated;

-- "@บอท ขอเอกสาร": the documents of the company this group belongs to, newest first, or the one with this number.
-- Only members linked to the company, or the person who asked for it, get it.
create or replace function public.line_documents(p_group text,p_user text,p_code text default null,p_id uuid default null)returns jsonb language plpgsql security definer set search_path=public as $$
declare g line_groups;linked boolean;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 linked=exists(select 1 from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id and not m.disabled
  where u.company_id=g.company_id and u.line_user_id=p_user);
 return coalesce((select jsonb_agg(x order by x->>'at' desc)from(
  select jsonb_build_object('id',e.id,'kind',e.kind,'code',e.data->>'code','name',coalesce(e.data->>'notes',e.data->>'name',''),
   'total',case when jsonb_typeof(e.data->'total')='number'then e.data->'total' when jsonb_typeof(e.data->'amount')='number'then e.data->'amount'
    when jsonb_typeof(e.data->'budget')='number'then e.data->'budget' end,
   'status',e.data->>'status','at',e.created_at,'lines',coalesce(case when jsonb_typeof(e.data->'lines')='array'then e.data->'lines' end,'[]'::jsonb))x
  from entities e left join ingestions i on i.id::text=e.data->>'ingestionId'
  where e.company_id=g.company_id and e.archived_at is null and coalesce(e.data->>'code','')<>''
   and (p_code is null or upper(e.data->>'code')=upper(p_code)) and (p_id is null or e.id=p_id)
   and (linked or i.source_user=p_user)
   and (p_code is not null or p_id is not null or e.data->>'sourceGroup' is not null and i.group_id=p_group)
  order by e.created_at desc limit 6)s),'[]'::jsonb);end$$;
revoke all on function public.line_documents(text,text,text,uuid)from public,anon,authenticated;grant execute on function public.line_documents(text,text,text,uuid)to service_role;
