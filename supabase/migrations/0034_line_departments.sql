-- LINE groups by department, cross-department approval and a decision history.
--  • Every decided LINE item keeps who decided, when and how (web / LINE) — shown as history on each page.
--  • Approving an item whose record cannot be created now fails with the reason instead of "approved" with no record.
--  • A LINE group can belong to a department. An item filed to another department's page (e.g. แผนกซ่อม asks for
--    budget → ค่าใช้จ่าย, Finance) is announced in that department's groups; a manager there replies on that notice to
--    approve, reject or correct it, and the outcome is announced back in the group that asked.

alter table public.ingestions add column if not exists decided_at timestamptz;
alter table public.ingestions add column if not exists decided_by uuid;
alter table public.ingestions add column if not exists decided_name text;
alter table public.ingestions add column if not exists decided_via text;
alter table public.ingestions add column if not exists decided_group text;
alter table public.line_groups add column if not exists department text;
alter table public.notification_outbox add column if not exists ingestion_id uuid;
alter table public.notification_outbox add column if not exists role text;

-- Which bot message in which group speaks about which item: 'source' = the notice in the group that asked,
-- 'approver' = the request posted in the approving department's group.
create table if not exists public.line_bot_messages(
 message_id text not null, group_id text not null, company_id uuid not null references companies(id),
 ingestion_id uuid not null references ingestions(id) on delete cascade, role text not null check(role in('source','approver')),
 created_at timestamptz not null default now(), primary key(group_id,message_id));
alter table public.line_bot_messages enable row level security;
revoke all on public.line_bot_messages from anon,authenticated;

-- Thai name of a department for LINE messages.
create or replace function public.dept_th(d text)returns text language sql immutable as $$
 select case d when 'Finance' then 'ฝ่ายบัญชีและการเงิน' when 'HR' then 'ฝ่ายบุคคล' when 'Warehouse' then 'คลังสินค้า' when 'Sales' then 'ฝ่ายขาย'
  when 'Marketing' then 'การตลาด' when 'IT' then 'ฝ่าย IT' when 'Operations' then 'ฝ่ายปฏิบัติการ' when 'Purchasing' then 'จัดซื้อ'
  when 'Legal' then 'กฎหมาย' when 'Event' then 'อีเวนต์' when 'Admin' then 'บริหารองค์กร' when 'Design' then 'ออกแบบ'
  when 'Customer Service' then 'บริการลูกค้า' when 'Data' then 'ข้อมูล' when 'Business Development' then 'พัฒนาธุรกิจ' else coalesce(d,'') end$$;

-- Stamp every decision (web or LINE) on the item.
create or replace function public.ingestion_decision_stamp()returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.status in('approved','rejected')and old.status is distinct from new.status then
  new.decided_at=now();
  new.decided_by=coalesce(new.decided_by,auth.uid());
  new.decided_via=coalesce(new.decided_via,case when auth.uid() is null then 'line' else 'web' end);
  new.decided_name=coalesce(new.decided_name,(select nullif(name,'')from memberships where company_id=new.company_id and user_id=new.decided_by),(select email from memberships where company_id=new.company_id and user_id=new.decided_by));
 end if;return new;end$$;
drop trigger if exists ingestions_decision_stamp on ingestions;
create trigger ingestions_decision_stamp before update of status on ingestions for each row execute function ingestion_decision_stamp();

-- Tell the group that asked how it was decided — unless it was approved right there by keyword (the bot already answered).
create or replace function public.ingestion_decision_notify()returns trigger language plpgsql security definer set search_path=public as $$declare who text;what text;edited boolean;begin
 if new.group_id is null or not(new.status in('approved','rejected')and old.status is distinct from new.status)then return new;end if;
 if new.decided_via='line'and new.decided_group=new.group_id then return new;end if;
 who=coalesce(new.decided_name,'ผู้อนุมัติ')||case when new.department is not null then ' ('||dept_th(new.department)||')'else ''end;
 what=coalesce(nullif(new.values->>'name',''),'รายการที่ส่งมา');
 edited=new.status='approved'and old.values is distinct from new.values;
 insert into notification_outbox(company_id,target,body,ingestion_id,role)values(new.company_id,new.group_id,left(
  case when new.status='approved'then(case when edited then '✏️ แก้ไขแล้วอนุมัติ: 'else '✅ อนุมัติแล้ว: 'end)||what
   else '❌ ไม่อนุมัติ: '||what||chr(10)||'เหตุผล: '||coalesce(nullif(new.error,''),'ไม่ระบุ')end
  ||chr(10)||'👤 โดย '||who,4500),new.id,'source');
 return new;end$$;
drop trigger if exists ingestions_decision_notify on ingestions;
create trigger ingestions_decision_notify after update of status on ingestions for each row execute function ingestion_decision_notify();

-- Record creation on approval: a failure stops the approval with the reason (it used to mark the item approved and
-- leave no record). A linked name that matches nothing (พนักงาน “M”) is named in the message.
create or replace function public.ingestion_to_entity()returns trigger language plpgsql security definer set search_path=public as $$declare t data_templates;spec entity_schemas;v_kind text;v_id uuid;fields jsonb;fmap jsonb;tname text;d jsonb:='{}';k text;ek text;st jsonb;clean jsonb;unresolved text:='';begin
 if new.target_kind is not null then
  v_kind=new.target_kind;fields=coalesce(new.template->'fields','[]');fmap='{}';tname=coalesce(nullif(new.template->>'name',''),v_kind);
 else
  select * into t from data_templates where id=nullif(new.template->>'id','')::uuid and company_id=new.company_id;
  if t.target_kind is null then return new;end if;
  v_kind=t.target_kind;fields=t.fields;fmap=t.field_map;tname=t.name;
 end if;
 select * into spec from entity_schemas s where s.kind=v_kind;
 for k in select f->>'key'from jsonb_array_elements(fields)f loop
  ek=coalesce(nullif(fmap->>k,''),k);
  if new.values ? k and new.values->k<>'null'::jsonb and exists(select 1 from jsonb_array_elements(spec.fields)s where s->>'key'=ek)then d=d||jsonb_build_object(ek,new.values->k);end if;end loop;
 for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='relation' loop
  if d ? (st->>'key') and (d->>(st->>'key'))!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   select id::text into k from entities e where e.company_id=new.company_id and e.kind=st->>'resource' and e.archived_at is null and lower(e.data->>'name')=lower(trim(d->>(st->>'key')))limit 1;
   if k is null then unresolved=unresolved||(st->>'label')||' “'||trim(d->>(st->>'key'))||'” ';end if;
   d=case when k is null then d-(st->>'key') else d||jsonb_build_object(st->>'key',k)end;end if;end loop;
 if coalesce(d->>'name','')=''then d=d||jsonb_build_object('name',left(tname||' '||to_char(new.created_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'),200));end if;
 for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='select'and(s->>'required')::boolean loop
  if not coalesce(st->'options' ? (d->>(st->>'key')),false)then d=d||jsonb_build_object(st->>'key',case when st->'options' ? 'อื่นๆ' then 'อื่นๆ' else st->'options'->>0 end);end if;end loop;
 if exists(select 1 from jsonb_array_elements(spec.fields)s where s->>'key'='date'and s->>'type'='date')and coalesce(d->>'date','')=''then d=d||jsonb_build_object('date',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'));end if;
 if new.attachment_id is not null then
  for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='image' limit 1 loop
   if coalesce(d->>(st->>'key'),'')=''then d=d||jsonb_build_object(st->>'key',new.attachment_id::text);end if;end loop;end if;
 begin
  clean=validate_payload(v_kind,d,new.company_id);
 exception when others then
  raise exception '%',case when unresolved<>''then 'ไม่พบ '||unresolved||'ในระบบ แก้ให้ตรงกับข้อมูลที่มีก่อนอนุมัติ ('||sqlerrm||')'else 'บันทึกไม่สำเร็จ: '||sqlerrm end;
 end;
 insert into entities(company_id,kind,department,data,created_by)values(new.company_id,v_kind,spec.department,clean||jsonb_build_object('ingestionId',new.id),coalesce(auth.uid(),new.decided_by))returning id into v_id;
 if new.attachment_id is not null then
  update attachments set entity_id=v_id,department=spec.department where id=new.attachment_id and company_id=new.company_id and entity_id is null;end if;
 return new;end$$;
revoke all on function public.ingestion_to_entity()from public,anon,authenticated;

-- Decide from LINE: in the group that asked, or in a group of the department the item belongs to.
create or replace function public.line_decide(p_group text,p_user text,p_id uuid,p_status text,p_reason text default '')returns void language plpgsql security definer set search_path=public as $$declare g line_groups;u memberships;i ingestions;f jsonb;v jsonb;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select m.* into u from memberships m join line_users l on l.company_id=m.company_id and l.user_id=m.user_id where l.company_id=g.company_id and l.line_user_id=p_user and not m.disabled and m.role in ('owner','manager');
 if not found then raise exception 'LINE นี้ยังไม่ได้เชื่อมกับผู้จัดการในระบบ (หน้า LINE → เชื่อมบัญชี LINE ของฉัน)';end if;
 select * into i from ingestions where id=p_id and company_id=g.company_id for update;if not found then raise exception 'ไม่พบรายการ';end if;
 if i.group_id is distinct from p_group and g.department is distinct from i.department then raise exception 'กลุ่มนี้ไม่ใช่แผนกที่ดูแลรายการนี้';end if;
 if u.role<>'owner'and not i.department=any(u.departments)then raise exception 'คุณไม่มีสิทธิ์อนุมัติของ%',dept_th(i.department);end if;
 if i.status in('approved','rejected')then raise exception 'รายการนี้ตัดสินไปแล้ว';end if;
 if i.status<>'review'then raise exception 'รายการนี้ยังอ่านไม่เสร็จ';end if;
 if p_status='approved'then
  for f in select value from jsonb_array_elements(i.template->'fields')loop v=i.values->(f->>'key');if(f->>'required')::boolean and(v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ: %',f->>'label';end if;end loop;
  perform create_ingestion_workflow(g.company_id,u.user_id,i.template,i.values,i.id);
  update ingestions set status='approved',missing='[]',decided_by=u.user_id,decided_via='line',decided_group=p_group where id=i.id;
 elsif p_status='rejected'then
  update ingestions set status='rejected',error=coalesce(nullif(trim(p_reason),''),'ไม่ระบุเหตุผล'),decided_by=u.user_id,decided_via='line',decided_group=p_group where id=i.id;
 else raise exception 'สถานะไม่ถูกต้อง';end if;
 insert into audit_events(company_id,actor,action,target)values(g.company_id,u.user_id,'line_'||p_status,i.id::text);end$$;
revoke all on function public.line_decide(text,text,uuid,text,text)from public,anon,authenticated;grant execute on function public.line_decide(text,text,uuid,text,text)to service_role;

create or replace function public.line_approve(p_group text,p_user text,p_id uuid)returns void language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from ingestions where id=p_id and status='approved')then return;end if;
 perform line_decide(p_group,p_user,p_id,'approved','');end$$;
revoke all on function public.line_approve(text,text,uuid)from public,anon,authenticated;grant execute on function public.line_approve(text,text,uuid)to service_role;

-- Group settings now include the department the group belongs to.
create or replace function public.update_line_group(p_company uuid,p_group text,p_template uuid,p_name text,p_keywords text[],p_department text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_template is not null and not exists(select 1 from data_templates where id=p_template and company_id=p_company)then raise exception 'ไม่พบ Template';end if;
 if coalesce(array_length(p_keywords,1),0)not between 1 and 10 or exists(select 1 from unnest(p_keywords)k where length(trim(k))not between 2 and 50)then raise exception 'คีย์เวิร์ดไม่ถูกต้อง';end if;
 if p_department is not null and length(p_department)>60 then raise exception 'แผนกไม่ถูกต้อง';end if;
 update line_groups set template_id=p_template,name=left(coalesce(p_name,''),100),approve_keywords=p_keywords,department=nullif(p_department,'')where group_id=p_group and company_id=p_company;if not found then raise exception 'ไม่พบกลุ่ม';end if;
 perform log_action(p_company,'line_group_updated',p_group);end$$;
revoke all on function public.update_line_group(uuid,text,uuid,text,text[],text)from public,anon;grant execute on function public.update_line_group(uuid,text,uuid,text,text[],text)to authenticated;

-- Items marked approved earlier although no record was made (e.g. ใบลา with an unknown employee) go back to review.
update ingestions i set status='review',error=left('อนุมัติแล้วแต่บันทึกไม่สำเร็จ: '||coalesce(i.error,''),500)
 where i.status='approved'and i.error like 'ส่งเข้า % ไม่ได้:%'
 and not exists(select 1 from entities e where e.company_id=i.company_id and e.data->>'ingestionId'=i.id::text);
