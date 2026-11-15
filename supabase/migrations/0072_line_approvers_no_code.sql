-- 0072: Approvers are set in the LINE chat with no code at all.
--   • line_set_approvers: anyone in a linked group may name its first approvers; after that an approver of the group
--     or a linked owner/manager. p_hash is kept in the signature for old callers and ignored (no more website codes).
--   • The bot is called @EliteFlow in the "not an approver yet" message.
--   • Free plan AI allowance matches the website: 300 AI items a month (was 30 files).

create or replace function public.line_set_approvers(p_group text,p_user text,p_hash text,p_add jsonb,p_remove text[])returns jsonb language plpgsql security definer set search_path=public as $$
declare g line_groups;ok boolean;x jsonb;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มนี้ยังไม่ได้เชื่อมกับ EliteFlow';end if;
 ok=not exists(select 1 from line_group_approvers where group_id=p_group)
  or exists(select 1 from line_group_approvers where group_id=p_group and line_user=p_user)
  or exists(select 1 from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id and not m.disabled
   where u.company_id=g.company_id and u.line_user_id=p_user and m.role in('owner','manager'));
 if not ok then raise exception 'กลุ่มนี้มีผู้อนุมัติแล้ว ให้ผู้อนุมัติคนใดคนหนึ่งในกลุ่มกด “บันทึก” แทน (หรือเจ้าของเอาผู้อนุมัติออกได้ที่หน้า LINE ในเว็บ)';end if;
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

-- Website codes for approvers are no longer made.
drop function if exists public.create_approver_code(uuid,text);

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
 if who is null then raise exception 'คุณยังไม่ได้เป็นผู้อนุมัติของขั้นนี้ ให้ผู้อนุมัติหรือเจ้าของพิมพ์ “@EliteFlow ให้ @ชื่อคุณ อนุมัติได้” ในกลุ่ม';end if;
 return approval_apply(g.company_id,p_id,null,p_user,coalesce(nullif(who,''),'ผู้อนุมัติใน LINE'),p_action,p_note,'line',p_group,p_step);end$$;
revoke all on function public.line_approval_act(text,text,uuid,text,text,int)from public,anon,authenticated;grant execute on function public.line_approval_act(text,text,uuid,text,text,int)to service_role;

-- Free plan: 300 AI items a month, as the website says (a file read and its summary may take a few calls each).
update public.free_limits set amount=300 where resource='ai_files';
update public.free_limits set amount=1500 where resource='ai_calls';
