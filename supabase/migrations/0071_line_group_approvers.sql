-- Approvers chosen in the LINE group by tagging them (no EliteFlow account needed):
--   "#ผู้อนุมัติ <code> @คุณเอ @ตัวเอง"  — the first time, with a one-time code the owner makes on the website;
--   "@บอท เพิ่มผู้อนุมัติ @…" / "@บอท ลบผู้อนุมัติ @…" / "@บอท ผู้อนุมัติ" — later, by an approver of that group or
--   a linked owner/manager.
-- A group approver may decide the approval step of the group's department (or, when no group has that department,
-- the step of items asked in this group). Nobody approves their own request (except the owner); every decision
-- is kept with the LINE name and time.

create table if not exists public.line_group_approvers(
 group_id text not null references line_groups(group_id) on delete cascade,
 line_user text not null,
 name text not null default '',
 added_by text,
 created_at timestamptz not null default now(),
 primary key(group_id,line_user));
alter table public.line_group_approvers enable row level security;
revoke all on public.line_group_approvers from anon,authenticated;
grant select on public.line_group_approvers to authenticated;
drop policy if exists line_group_approvers_read on public.line_group_approvers;
create policy line_group_approvers_read on public.line_group_approvers for select to authenticated
 using(exists(select 1 from line_groups g where g.group_id=line_group_approvers.group_id and member_role(g.company_id)is not null));

create table if not exists public.line_approver_codes(
 token_hash text primary key,
 company_id uuid not null references companies(id) on delete cascade,
 created_by uuid,
 expires_at timestamptz not null,
 used_at timestamptz);
alter table public.line_approver_codes enable row level security;
revoke all on public.line_approver_codes from anon,authenticated;

-- Owner makes a one-time code (valid 10 minutes) to name the approvers of a group from LINE.
create or replace function public.create_approver_code(p_company uuid,p_hash text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if length(coalesce(p_hash,''))<32 then raise exception 'รหัสไม่ถูกต้อง';end if;
 insert into line_approver_codes(token_hash,company_id,created_by,expires_at)values(p_hash,p_company,auth.uid(),now()+interval '10 minutes');end$$;
revoke all on function public.create_approver_code(uuid,text)from public,anon;grant execute on function public.create_approver_code(uuid,text)to authenticated;

-- Who may change a group's approvers: a valid code, an approver of that group, or a linked owner/manager.
create or replace function public.line_set_approvers(p_group text,p_user text,p_hash text,p_add jsonb,p_remove text[])returns jsonb language plpgsql security definer set search_path=public as $$
declare g line_groups;ok boolean:=false;x jsonb;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มนี้ยังไม่ได้เชื่อมกับ EliteFlow';end if;
 if p_hash is not null then
  update line_approver_codes set used_at=now()where token_hash=p_hash and company_id=g.company_id and used_at is null and expires_at>now();
  ok=found;
  if not ok then raise exception 'รหัสหมดอายุหรือไม่ถูกต้อง สร้างรหัสใหม่ที่หน้า LINE ในเว็บ';end if;
 end if;
 if not ok then ok=exists(select 1 from line_group_approvers where group_id=p_group and line_user=p_user)
  or exists(select 1 from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id and not m.disabled
   where u.company_id=g.company_id and u.line_user_id=p_user and m.role in('owner','manager'));end if;
 if not ok then raise exception 'เฉพาะผู้อนุมัติของกลุ่มนี้ หรือเจ้าของบริษัท ที่ตั้งผู้อนุมัติได้ (สร้างรหัสได้ที่หน้า LINE ในเว็บ)';end if;
 if jsonb_typeof(p_add)='array'then
  if jsonb_array_length(p_add)>20 then raise exception 'ตั้งได้ครั้งละไม่เกิน 20 คน';end if;
  for x in select value from jsonb_array_elements(p_add)loop
   if coalesce(x->>'id','')!~'^U[0-9a-f]{32}$'then continue;end if;
   insert into line_group_approvers(group_id,line_user,name,added_by)values(p_group,x->>'id',left(coalesce(x->>'name',''),100),p_user)
    on conflict(group_id,line_user)do update set name=case when excluded.name<>''then excluded.name else line_group_approvers.name end;
  end loop;end if;
 if p_remove is not null then delete from line_group_approvers where group_id=p_group and line_user=any(p_remove);end if;
 if (select count(*)from line_group_approvers where group_id=p_group)>20 then raise exception 'ผู้อนุมัติต่อกลุ่มไม่เกิน 20 คน';end if;
 insert into audit_events(company_id,actor,action,target)values(g.company_id,null,'line_approvers_set',p_group);
 return coalesce((select jsonb_agg(jsonb_build_object('id',line_user,'name',name)order by created_at)from line_group_approvers where group_id=p_group),'[]');end$$;
revoke all on function public.line_set_approvers(text,text,text,jsonb,text[])from public,anon,authenticated;grant execute on function public.line_set_approvers(text,text,text,jsonb,text[])to service_role;

-- Owner removes a group approver on the website.
create or replace function public.remove_line_approver(p_company uuid,p_group text,p_line_user text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 delete from line_group_approvers a using line_groups g where a.group_id=g.group_id and g.company_id=p_company and a.group_id=p_group and a.line_user=p_line_user;
 perform log_action(p_company,'line_approver_removed',p_group);end$$;
revoke all on function public.remove_line_approver(uuid,text,text)from public,anon;grant execute on function public.remove_line_approver(uuid,text,text)to authenticated;

-- The decision itself (no permission checks here): history, next step / record / waiting for the slip.
create or replace function public.approval_apply(p_company uuid,p_id uuid,p_actor uuid,p_line_user text,p_name text,p_action text,p_note text,p_via text,p_group text,p_step int)returns jsonb language plpgsql security definer set search_path=public as $$
declare i ingestions;a jsonb;n int;cur int;dept text;note text:=nullif(trim(coalesce(p_note,'')),'');rnd int;f jsonb;v jsonb;begin
 select * into i from ingestions where id=p_id and company_id=p_company for update;
 if not found then raise exception 'ไม่พบรายการ';end if;
 if i.status in('approved','rejected','awaiting_slip')then raise exception 'รายการนี้ตัดสินไปแล้ว';end if;
 if i.status<>'review'then raise exception 'รายการนี้ยังไม่ได้ส่งขออนุมัติ (หรือส่งกลับไปแก้ไขแล้ว)';end if;
 a=coalesce(i.approval,approval_plan(i));n=jsonb_array_length(a->'steps');cur=coalesce((a->>'at')::int,0);rnd=coalesce((a->>'round')::int,1);
 if p_step is not null and p_step<>cur then raise exception 'ขั้นนี้มีผู้ดำเนินการไปแล้ว ดูการ์ดล่าสุดนะคะ';end if;
 dept=a->'steps'->cur->>'dept';
 if p_action='approve'and exists(select 1 from jsonb_array_elements(a->'history')h where h->>'action'='approve'and coalesce((h->>'round')::int,1)=rnd
   and((p_actor is not null and h->>'by'=p_actor::text)or(p_line_user is not null and h->>'line'=p_line_user)))
   and not exists(select 1 from memberships where company_id=p_company and user_id=p_actor and role='owner')then
  raise exception 'คุณอนุมัติขั้นก่อนหน้าแล้ว ขั้นนี้ต้องเป็นผู้อนุมัติอีกคน';end if;
 if p_action in('reject','fix')and coalesce(length(note),0)<2 then raise exception 'กรุณาใส่เหตุผลหรือสิ่งที่ต้องแก้';end if;
 a=jsonb_set(a,'{history}',coalesce(a->'history','[]'::jsonb)||jsonb_build_object('step',cur+1,'of',n,'dept',dept,'action',p_action,'by',p_actor,'line',p_line_user,'name',p_name,
  'at',now(),'note',note,'via',p_via,'round',rnd));
 if p_action='approve'then
  if cur+1<n then
   update ingestions set approval=jsonb_set(a,'{at}',to_jsonb(cur+1))where id=p_id;
  else
   if jsonb_array_length(i.missing)>0 then raise exception 'ข้อมูลยังไม่ครบ: %',(select string_agg(value,', ')from jsonb_array_elements_text(i.missing));end if;
   for f in select value from jsonb_array_elements(i.template->'fields')loop v=i.values->(f->>'key');
    if(f->>'required')::boolean and(v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ: %',f->>'label';end if;end loop;
   update ingestions set approval=jsonb_set(a,'{at}',to_jsonb(n))where id=p_id;
   if i.target_kind='expenses'and i.attachment_id is null then
    update ingestions set status='awaiting_slip',decided_at=now(),decided_by=p_actor,decided_name=p_name,decided_via=p_via,decided_group=p_group where id=p_id;
   else
    perform create_ingestion_workflow(p_company,p_actor,i.template,i.values,i.id);
    update ingestions set status='approved',missing='[]',decided_by=p_actor,decided_name=p_name,decided_via=p_via,decided_group=p_group where id=p_id;
   end if;
  end if;
 elsif p_action='reject'then
  update ingestions set approval=a,status='rejected',error=note,decided_by=p_actor,decided_name=p_name,decided_via=p_via,decided_group=p_group where id=p_id;
 elsif p_action='fix'then
  update ingestions set approval=jsonb_set(jsonb_set(a,'{at}','0'::jsonb),'{round}',to_jsonb(rnd+1)),status='draft',confirm=true where id=p_id;
 else raise exception 'คำสั่งไม่ถูกต้อง';end if;
 insert into audit_events(company_id,actor,action,target)values(p_company,p_actor,'approval_'||p_action,p_id::text);
 select * into i from ingestions where id=p_id;
 return jsonb_build_object('id',i.id,'status',i.status,'approval',i.approval,'action',p_action,'step',cur+1,'of',n,'dept',dept,'name',p_name,'note',note);end$$;
revoke all on function public.approval_apply(uuid,uuid,uuid,text,text,text,text,text,text,int)from public,anon,authenticated;

-- An EliteFlow member deciding (website, or LINE when their account is linked): role and department checks.
create or replace function public.approval_act(p_company uuid,p_actor uuid,p_id uuid,p_action text,p_note text,p_via text,p_group text,p_step int default null)returns jsonb language plpgsql security definer set search_path=public as $$
declare i ingestions;u memberships;a jsonb;dept text;begin
 select * into i from ingestions where id=p_id and company_id=p_company;
 if not found then raise exception 'ไม่พบรายการ';end if;
 if i.status in('approved','rejected','awaiting_slip')then raise exception 'รายการนี้ตัดสินไปแล้ว';end if;
 if i.status<>'review'then raise exception 'รายการนี้ยังไม่ได้ส่งขออนุมัติ (หรือส่งกลับไปแก้ไขแล้ว)';end if;
 a=coalesce(i.approval,approval_plan(i));dept=a->'steps'->coalesce((a->>'at')::int,0)->>'dept';
 if p_step is not null and p_step<>coalesce((a->>'at')::int,0)and i.status='review'then raise exception 'ขั้นนี้มีผู้ดำเนินการไปแล้ว ดูการ์ดล่าสุดนะคะ';end if;
 select * into u from memberships where company_id=p_company and user_id=p_actor and not disabled;
 if not found or u.role not in('owner','manager')then raise exception 'เฉพาะผู้จัดการหรือเจ้าของบริษัทที่อนุมัติได้';end if;
 if u.role<>'owner'and not(dept=any(u.departments))then raise exception 'ขั้นนี้ต้องให้ผู้จัดการ%เป็นผู้อนุมัติ',dept_th(dept);end if;
 if u.role<>'owner'and approval_requester(i)=p_actor then raise exception 'อนุมัติคำขอของตัวเองไม่ได้ค่ะ';end if;
 return approval_apply(p_company,p_id,p_actor,null,coalesce(nullif(u.name,''),u.email),p_action,p_note,p_via,p_group,p_step);end$$;
revoke all on function public.approval_act(uuid,uuid,uuid,text,text,text,text,int)from public,anon,authenticated;

-- May this LINE user (a group approver) decide the current step of this item?
create or replace function public.line_group_approver_for(p_user text,i ingestions)returns text language plpgsql stable security definer set search_path=public as $$
declare a jsonb;dept text;who text;begin
 a=coalesce(i.approval,approval_plan(i));dept=a->'steps'->coalesce((a->>'at')::int,0)->>'dept';
 select x.name into who from line_group_approvers x join line_groups g on g.group_id=x.group_id
  where x.line_user=p_user and g.company_id=i.company_id
   and(g.department=dept or(g.group_id=i.group_id and not exists(select 1 from line_groups d where d.company_id=i.company_id and d.department=dept)))
  limit 1;
 return who;end$$;
revoke all on function public.line_group_approver_for(text,ingestions)from public,anon,authenticated;

-- A button on a LINE card: a linked EliteFlow member, or an approver named in the group.
create or replace function public.line_approval_act(p_group text,p_user text,p_id uuid,p_action text,p_note text default null,p_step int default null)returns jsonb language plpgsql security definer set search_path=public as $$
declare g line_groups;u memberships;i ingestions;who text;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select * into i from ingestions where id=p_id and company_id=g.company_id;
 if not found then raise exception 'ไม่พบรายการ';end if;
 select m.* into u from memberships m join line_users l on l.company_id=m.company_id and l.user_id=m.user_id
  where l.company_id=g.company_id and l.line_user_id=p_user and not m.disabled;
 if i.source_user=p_user and u.role is distinct from 'owner'then raise exception 'อนุมัติคำขอของตัวเองไม่ได้ค่ะ ให้ผู้อนุมัติคนอื่นในกลุ่มกดแทนนะคะ';end if;
 if u.role in('owner','manager')then
  return approval_act(g.company_id,u.user_id,p_id,p_action,p_note,'line',p_group,p_step);end if;
 if i.status in('approved','rejected','awaiting_slip')then raise exception 'รายการนี้ตัดสินไปแล้ว';end if;
 if i.status<>'review'then raise exception 'รายการนี้ยังไม่ได้ส่งขออนุมัติ (หรือส่งกลับไปแก้ไขแล้ว)';end if;
 if p_step is not null and i.status='review'and p_step<>coalesce((i.approval->>'at')::int,0)then raise exception 'ขั้นนี้มีผู้ดำเนินการไปแล้ว ดูการ์ดล่าสุดนะคะ';end if;
 who=line_group_approver_for(p_user,i);
 if who is null then raise exception 'คุณยังไม่ได้เป็นผู้อนุมัติของขั้นนี้ ให้ผู้อนุมัติหรือเจ้าของพิมพ์ “@บอท เพิ่มผู้อนุมัติ @ชื่อคุณ” ในกลุ่ม';end if;
 return approval_apply(g.company_id,p_id,null,p_user,coalesce(nullif(who,''),'ผู้อนุมัติใน LINE'),p_action,p_note,'line',p_group,p_step);end$$;
revoke all on function public.line_approval_act(text,text,uuid,text,text,int)from public,anon,authenticated;grant execute on function public.line_approval_act(text,text,uuid,text,text,int)to service_role;
