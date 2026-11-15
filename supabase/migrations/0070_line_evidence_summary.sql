-- More evidence per item (สลิป ใบเสร็จ รูปสินค้า …, up to 5 files) added from LINE with "📎 เพิ่มรูป/หลักฐาน",
-- kept with the item and moved onto its record when it is made; and the monthly expense summary asked for in chat.

alter table public.attachments add column if not exists ingestion_id uuid references ingestions(id) on delete set null;
create index if not exists attachments_ingestion on attachments(ingestion_id) where ingestion_id is not null;
alter table public.line_listen drop constraint if exists line_listen_mode_check;
alter table public.line_listen add constraint line_listen_mode_check check(mode in('any','files','edit','reject','fix','slip','evidence'));

-- A record made from a LINE item takes all of the item's files.
create or replace function public.entity_takes_item_files()returns trigger language plpgsql security definer set search_path=public as $$begin
 if coalesce(new.data->>'ingestionId','')~'^[0-9a-f-]{36}$'then
  update attachments set entity_id=new.id where ingestion_id=(new.data->>'ingestionId')::uuid and company_id=new.company_id and entity_id is null;end if;
 return new;end$$;
drop trigger if exists entities_take_item_files on entities;
create trigger entities_take_item_files after insert on entities for each row execute function entity_takes_item_files();

-- How many files an item has (its main file + the added ones).
create or replace function public.item_file_count(p_id uuid)returns int language sql stable security definer set search_path=public as $$
 select (select count(*)from attachments a where a.ingestion_id=p_id)::int
  +(select case when i.attachment_id is not null and not exists(select 1 from attachments a where a.id=i.attachment_id and a.ingestion_id=p_id)then 1 else 0 end from ingestions i where i.id=p_id)$$;
revoke all on function public.item_file_count(uuid)from public,anon,authenticated;grant execute on function public.item_file_count(uuid)to service_role;

-- "📎 เพิ่มรูป/หลักฐาน": the requester or a linked owner/manager, at most 5 files, not on cancelled / rejected items.
create or replace function public.line_evidence_check(p_group text,p_user text,p_id uuid)returns jsonb language plpgsql security definer set search_path=public as $$
declare g line_groups;i ingestions;r text;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select * into i from ingestions where id=p_id and company_id=g.company_id;
 if not found then raise exception 'ไม่พบรายการ';end if;
 if i.status in('skipped','rejected','failed')then raise exception 'รายการนี้ยกเลิกหรือไม่อนุมัติแล้ว แนบหลักฐานไม่ได้';end if;
 if coalesce(i.source_user,'')<>coalesce(p_user,'')then
  select m.role into r from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id and not m.disabled
   where u.company_id=i.company_id and u.line_user_id=p_user;
  if r is null or r not in('owner','manager')then raise exception 'เฉพาะคนที่ขอ หรือผู้จัดการ ที่แนบหลักฐานของรายการนี้ได้';end if;end if;
 return jsonb_build_object('company',i.company_id,'count',item_file_count(p_id),'left',greatest(0,5-item_file_count(p_id)));end$$;
revoke all on function public.line_evidence_check(text,text,uuid)from public,anon,authenticated;grant execute on function public.line_evidence_check(text,text,uuid)to service_role;

create or replace function public.line_add_evidence(p_group text,p_user text,p_id uuid,p_attachment uuid)returns jsonb language plpgsql security definer set search_path=public as $$
declare c jsonb;e uuid;n int;begin
 c=line_evidence_check(p_group,p_user,p_id);
 if (c->>'left')::int<1 then raise exception 'แนบได้สูงสุด 5 ไฟล์ต่อรายการค่ะ';end if;
 select id into e from entities where company_id=(c->>'company')::uuid and data->>'ingestionId'=p_id::text and archived_at is null limit 1;
 update attachments set ingestion_id=p_id,entity_id=coalesce(entity_id,e)where id=p_attachment and company_id=(c->>'company')::uuid;
 if not found then raise exception 'ไม่พบไฟล์';end if;
 n=item_file_count(p_id);
 return jsonb_build_object('count',n,'left',greatest(0,5-n));end$$;
revoke all on function public.line_add_evidence(text,text,uuid,uuid)from public,anon,authenticated;grant execute on function public.line_add_evidence(text,text,uuid,uuid)to service_role;

-- "@บอท สรุปค่าใช้จ่ายเดือนนี้": expenses of the company in a period, for linked owners and managers only.
create or replace function public.line_expense_summary(p_group text,p_user text,p_from date,p_to date)returns jsonb language plpgsql security definer set search_path=public as $$
declare g line_groups;r text;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select m.role into r from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id and not m.disabled
  where u.company_id=g.company_id and u.line_user_id=p_user;
 if r is null or r not in('owner','manager')then raise exception 'สรุปค่าใช้จ่ายดูได้เฉพาะเจ้าของหรือผู้จัดการที่เชื่อมบัญชี LINE แล้วค่ะ';end if;
 return(with x as(
   select e.data->>'name' as name,coalesce(nullif(e.data->>'category',''),'อื่นๆ')as category,
    coalesce(nullif(e.data->>'sourceSender',''),nullif(e.data->>'requestor',''),nullif(e.data->>'payee',''),'ไม่ระบุ')as who,
    coalesce(case when jsonb_typeof(e.data->'amount')='number'then(e.data->>'amount')::numeric end,0)as amount,e.data->>'code' as code,e.data->>'date' as day
   from entities e where e.company_id=g.company_id and e.kind='expenses'and e.archived_at is null
    and coalesce(e.data->>'status','')<>'rejected'
    and coalesce(nullif(e.data->>'date','')::date,(e.created_at at time zone 'Asia/Bangkok')::date)between p_from and p_to)
  select jsonb_build_object(
   'company',(select name from companies where id=g.company_id),'from',p_from,'to',p_to,
   'count',(select count(*)from x),'total',(select coalesce(sum(amount),0)from x),
   'byCategory',coalesce((select jsonb_agg(jsonb_build_object('name',category,'amount',s,'count',n)order by s desc)from(select category,sum(amount)s,count(*)n from x group by 1)q),'[]'),
   'byPerson',coalesce((select jsonb_agg(jsonb_build_object('name',who,'amount',s,'count',n)order by s desc)from(select who,sum(amount)s,count(*)n from x group by 1)q),'[]'),
   'top',coalesce((select jsonb_agg(jsonb_build_object('name',name,'amount',amount,'code',code,'day',day)order by amount desc)from(select * from x order by amount desc limit 5)q),'[]'),
   'waitingSlip',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(approval_amount(values)),0))from ingestions where company_id=g.company_id and status='awaiting_slip'),
   'inReview',(select count(*)from ingestions where company_id=g.company_id and status='review'and target_kind='expenses')));end$$;
revoke all on function public.line_expense_summary(text,text,date,date)from public,anon,authenticated;grant execute on function public.line_expense_summary(text,text,date,date)to service_role;
