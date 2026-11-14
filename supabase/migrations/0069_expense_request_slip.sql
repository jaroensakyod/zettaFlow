-- ใบขออนุมัติค่าใช้จ่าย is a request, not the expense. When its last approver approves it, it waits for the slip
-- (status awaiting_slip, "อนุมัติแล้ว รอสลิป"); nothing is recorded as an expense yet. The requester (or a manager)
-- presses "ยืนยันจ่ายแล้ว · ส่งสลิป" and sends the slip / receipt photo; only then is the expense recorded, with the
-- slip attached. A request that already came with its receipt is recorded on approval, as before.

alter table public.ingestions drop constraint if exists ingestions_status_check;
alter table public.ingestions add constraint ingestions_status_check
 check(status in ('queued','processing','draft','review','awaiting_slip','approved','rejected','failed','skipped'));
alter table public.line_listen drop constraint if exists line_listen_mode_check;
alter table public.line_listen add constraint line_listen_mode_check check(mode in('any','files','edit','reject','fix','slip'));

create or replace function public.approval_act(p_company uuid,p_actor uuid,p_id uuid,p_action text,p_note text,p_via text,p_group text,p_step int default null)returns jsonb language plpgsql security definer set search_path=public as $$
declare i ingestions;u memberships;a jsonb;n int;cur int;dept text;who text;note text:=nullif(trim(coalesce(p_note,'')),'');rnd int;f jsonb;v jsonb;begin
 select * into i from ingestions where id=p_id and company_id=p_company for update;
 if not found then raise exception 'ไม่พบรายการ';end if;
 if i.status in('approved','rejected','awaiting_slip')then raise exception 'รายการนี้ตัดสินไปแล้ว';end if;
 if i.status<>'review'then raise exception 'รายการนี้ยังไม่ได้ส่งขออนุมัติ (หรือส่งกลับไปแก้ไขแล้ว)';end if;
 a=coalesce(i.approval,approval_plan(i));n=jsonb_array_length(a->'steps');cur=coalesce((a->>'at')::int,0);rnd=coalesce((a->>'round')::int,1);
 if p_step is not null and p_step<>cur then raise exception 'ขั้นนี้มีผู้ดำเนินการไปแล้ว ดูการ์ดล่าสุดนะคะ';end if;
 dept=a->'steps'->cur->>'dept';
 select * into u from memberships where company_id=p_company and user_id=p_actor and not disabled;
 if not found or u.role not in('owner','manager')then raise exception 'เฉพาะผู้จัดการหรือเจ้าของบริษัทที่อนุมัติได้';end if;
 if u.role<>'owner'and not(dept=any(u.departments))then raise exception 'ขั้นนี้ต้องให้ผู้จัดการ%เป็นผู้อนุมัติ',dept_th(dept);end if;
 if u.role<>'owner'and approval_requester(i)=p_actor then raise exception 'อนุมัติคำขอของตัวเองไม่ได้ค่ะ';end if;
 if u.role<>'owner'and p_action='approve'and exists(select 1 from jsonb_array_elements(a->'history')h where h->>'by'=p_actor::text and h->>'action'='approve'and coalesce((h->>'round')::int,1)=rnd)then
  raise exception 'คุณอนุมัติขั้นก่อนหน้าแล้ว ขั้นนี้ต้องเป็นผู้อนุมัติอีกคน';end if;
 if p_action in('reject','fix')and coalesce(length(note),0)<2 then raise exception 'กรุณาใส่เหตุผลหรือสิ่งที่ต้องแก้';end if;
 who=coalesce(nullif(u.name,''),u.email);
 a=jsonb_set(a,'{history}',coalesce(a->'history','[]'::jsonb)||jsonb_build_object('step',cur+1,'of',n,'dept',dept,'action',p_action,'by',p_actor,'name',who,
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
    -- An approved expense request: not an expense until the slip is sent.
    update ingestions set status='awaiting_slip',decided_at=now(),decided_by=p_actor,decided_name=who,decided_via=p_via,decided_group=p_group where id=p_id;
   else
    perform create_ingestion_workflow(p_company,p_actor,i.template,i.values,i.id);
    update ingestions set status='approved',missing='[]',decided_by=p_actor,decided_name=who,decided_via=p_via,decided_group=p_group where id=p_id;
   end if;
  end if;
 elsif p_action='reject'then
  update ingestions set approval=a,status='rejected',error=note,decided_by=p_actor,decided_name=who,decided_via=p_via,decided_group=p_group where id=p_id;
 elsif p_action='fix'then
  update ingestions set approval=jsonb_set(jsonb_set(a,'{at}','0'::jsonb),'{round}',to_jsonb(rnd+1)),status='draft',confirm=true where id=p_id;
 else raise exception 'คำสั่งไม่ถูกต้อง';end if;
 insert into audit_events(company_id,actor,action,target)values(p_company,p_actor,'approval_'||p_action,p_id::text);
 select * into i from ingestions where id=p_id;
 return jsonb_build_object('id',i.id,'status',i.status,'approval',i.approval,'action',p_action,'step',cur+1,'of',n,'dept',dept,'name',who,'note',note);end$$;
revoke all on function public.approval_act(uuid,uuid,uuid,text,text,text,text,int)from public,anon,authenticated;

-- "ยืนยันจ่ายแล้ว · ส่งสลิป": who may, and is it waiting? (the button opens the window for the photo)
create or replace function public.line_slip_check(p_group text,p_user text,p_id uuid)returns uuid language plpgsql security definer set search_path=public as $$
declare g line_groups;i ingestions;r text;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select * into i from ingestions where id=p_id and company_id=g.company_id;
 if not found then raise exception 'ไม่พบรายการ';end if;
 if i.status='approved'then raise exception 'รายการนี้บันทึกเป็นค่าใช้จ่ายแล้ว';end if;
 if i.status<>'awaiting_slip'then raise exception 'รายการนี้ยังไม่ได้รับอนุมัติ ส่งสลิปได้หลังอนุมัติแล้วค่ะ';end if;
 if coalesce(i.source_user,'')<>coalesce(p_user,'')then
  select m.role into r from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id and not m.disabled
   where u.company_id=i.company_id and u.line_user_id=p_user;
  if r is null or r not in('owner','manager')then raise exception 'เฉพาะคนที่ขอ หรือผู้จัดการ ที่ส่งสลิปของรายการนี้ได้';end if;end if;
 return i.company_id;end$$;
revoke all on function public.line_slip_check(text,text,uuid)from public,anon,authenticated;grant execute on function public.line_slip_check(text,text,uuid)to service_role;

-- The slip arrived: attach it and record the expense (paid), with who sent it.
create or replace function public.line_expense_paid(p_group text,p_user text,p_id uuid,p_attachment uuid)returns jsonb language plpgsql security definer set search_path=public as $$
declare c uuid;i ingestions;begin
 c=line_slip_check(p_group,p_user,p_id);
 select * into i from ingestions where id=p_id for update;
 if not exists(select 1 from attachments where id=p_attachment and company_id=c)then raise exception 'ไม่พบไฟล์สลิป';end if;
 update ingestions set attachment_id=p_attachment,
  values=values||jsonb_build_object('payStatus','โอนแล้ว'),
  approval=jsonb_set(approval,'{history}',coalesce(approval->'history','[]'::jsonb)||jsonb_build_object('action','slip','at',now(),'by',p_user,'via','line'))
  where id=p_id;
 perform create_ingestion_workflow(c,i.decided_by,i.template,i.values,i.id);
 update ingestions set status='approved',missing='[]' where id=p_id;
 insert into audit_events(company_id,actor,action,target)values(c,i.decided_by,'expense_slip',p_id::text);
 select * into i from ingestions where id=p_id;
 return jsonb_build_object('id',i.id,'status',i.status,'code',i.doc_code);end$$;
revoke all on function public.line_expense_paid(text,text,uuid,uuid)from public,anon,authenticated;grant execute on function public.line_expense_paid(text,text,uuid,uuid)to service_role;
