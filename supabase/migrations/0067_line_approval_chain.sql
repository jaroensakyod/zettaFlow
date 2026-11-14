-- Approval chain for items from LINE: "ส่งขออนุมัติ" is not an approval. The item waits for each approver in turn
-- (e.g. พนักงาน → ผู้จัดการการตลาด → ผู้จัดการฝ่ายการเงิน); only the last approver's "อนุมัติ" makes the record.
-- Approvers decide with buttons on a card (identified by their linked LINE account) or on the website; nobody but
-- the owner approves their own request; every step is kept with who, when and the note.
--
-- ingestions.approval = {"steps":[{"dept":"Marketing"},{"dept":"Finance"}], "at":0, "round":1, "ref":"EF-1A2B3C4D",
--   "history":[{"step":1,"of":2,"dept":"Marketing","action":"approve","by":"<uuid>","name":"คุณบอส","at":"…","note":null,"via":"line","round":1}]}
-- null = an item from before this change (or typed on the website): it keeps the one-step approval.

alter table public.ingestions add column if not exists approval jsonb;
alter table public.line_listen drop constraint if exists line_listen_mode_check;
alter table public.line_listen add constraint line_listen_mode_check check(mode in('any','files','edit','reject','fix'));

-- Money on the item, for the threshold below (amount, budget, total …, or quantity × unit cost).
create or replace function public.approval_amount(v jsonb)returns numeric language sql immutable set search_path=public as $$
 select coalesce(
  case when jsonb_typeof(v->'amount')='number' then (v->>'amount')::numeric end,
  case when jsonb_typeof(v->'budget')='number' then (v->>'budget')::numeric end,
  case when jsonb_typeof(v->'total')='number' then (v->>'total')::numeric end,
  case when jsonb_typeof(v->'subtotal')='number' then (v->>'subtotal')::numeric end,
  case when jsonb_typeof(v->'quantity')='number' and jsonb_typeof(v->'unitCost')='number' then (v->>'quantity')::numeric*(v->>'unitCost')::numeric end)$$;

-- Who must approve, in order:
--  1. a manager of the requester's department (the LINE group's department, else the requester's own);
--  2. the department that owns the page (expenses → Finance, leaves → HR …); budgets (งบการตลาด / งบอีเวนต์) → Finance.
--  Step 2 is skipped when it is the same department, or for money under 5,000 baht (leaves always go to HR).
create or replace function public.approval_plan(i ingestions)returns jsonb language plpgsql stable security definer set search_path=public as $$
declare req text;second text;amt numeric;kind text:=coalesce(i.target_kind,i.template->>'target_kind');steps jsonb;begin
 select department into req from line_groups where group_id=i.group_id;
 if req is null then
  select m.departments[1] into req from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id
   where u.company_id=i.company_id and u.line_user_id=i.source_user;end if;
 req=coalesce(req,i.department);
 second=case when kind in('marketing_budget','event_budget') then 'Finance' when kind='leaves' then 'HR' else i.department end;
 amt=approval_amount(i.values);
 if kind is distinct from 'leaves' and amt is not null and amt<5000 then second=null;end if;
 steps=jsonb_build_array(jsonb_build_object('dept',req));
 if second is not null and second is distinct from req then steps=steps||jsonb_build_object('dept',second);end if;
 return jsonb_build_object('steps',steps,'at',0,'round',coalesce((i.approval->>'round')::int,1),
  'ref','EF-'||upper(left(replace(i.id::text,'-',''),8)),'history',coalesce(i.approval->'history','[]'::jsonb));end$$;
revoke all on function public.approval_plan(ingestions)from public,anon,authenticated;

-- The app user who asked: their linked LINE account, else who typed it on the website.
create or replace function public.approval_requester(i ingestions)returns uuid language sql stable security definer set search_path=public as $$
 select coalesce((select user_id from line_users where company_id=i.company_id and line_user_id=i.source_user),i.created_by)$$;
revoke all on function public.approval_requester(ingestions)from public,anon,authenticated;

-- One decision on the current step: approve (next step, or the record when it is the last), reject (with a reason)
-- or fix (send back to the requester with what to change; the chain starts again when they send it again).
create or replace function public.approval_act(p_company uuid,p_actor uuid,p_id uuid,p_action text,p_note text,p_via text,p_group text,p_step int default null)returns jsonb language plpgsql security definer set search_path=public as $$
declare i ingestions;u memberships;a jsonb;n int;cur int;dept text;who text;note text:=nullif(trim(coalesce(p_note,'')),'');rnd int;f jsonb;v jsonb;begin
 select * into i from ingestions where id=p_id and company_id=p_company for update;
 if not found then raise exception 'ไม่พบรายการ';end if;
 if i.status in('approved','rejected')then raise exception 'รายการนี้ตัดสินไปแล้ว';end if;
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
   perform create_ingestion_workflow(p_company,p_actor,i.template,i.values,i.id);
   update ingestions set status='approved',missing='[]',decided_by=p_actor,decided_name=who,decided_via=p_via,decided_group=p_group where id=p_id;
  end if;
 elsif p_action='reject'then
  update ingestions set approval=a,status='rejected',error=note,decided_by=p_actor,decided_name=who,decided_via=p_via,decided_group=p_group where id=p_id;
 elsif p_action='fix'then
  -- Back to the requester as a draft; "ส่งขออนุมัติ" again starts the chain over (round + 1).
  update ingestions set approval=jsonb_set(jsonb_set(a,'{at}','0'::jsonb),'{round}',to_jsonb(rnd+1)),status='draft',confirm=true where id=p_id;
 else raise exception 'คำสั่งไม่ถูกต้อง';end if;
 insert into audit_events(company_id,actor,action,target)values(p_company,p_actor,'approval_'||p_action,p_id::text);
 select * into i from ingestions where id=p_id;
 return jsonb_build_object('id',i.id,'status',i.status,'approval',i.approval,'action',p_action,'step',cur+1,'of',n,'dept',dept,'name',who,'note',note);end$$;
revoke all on function public.approval_act(uuid,uuid,uuid,text,text,text,text,int)from public,anon,authenticated;

-- A button on a LINE card: the presser is identified by their linked LINE account.
create or replace function public.line_approval_act(p_group text,p_user text,p_id uuid,p_action text,p_note text default null,p_step int default null)returns jsonb language plpgsql security definer set search_path=public as $$
declare g line_groups;u memberships;src text;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select m.* into u from memberships m join line_users l on l.company_id=m.company_id and l.user_id=m.user_id
  where l.company_id=g.company_id and l.line_user_id=p_user and not m.disabled;
 if not found then raise exception 'บัญชี LINE นี้ยังไม่ได้เชื่อมกับผู้ใช้ในระบบ (หน้า LINE → เชื่อมบัญชี LINE ของฉัน)';end if;
 select source_user into src from ingestions where id=p_id and company_id=g.company_id;
 if not found then raise exception 'ไม่พบรายการ';end if;
 if src=p_user and u.role<>'owner'then raise exception 'อนุมัติคำขอของตัวเองไม่ได้ค่ะ';end if;
 return approval_act(g.company_id,u.user_id,p_id,p_action,p_note,'line',p_group,p_step);end$$;
revoke all on function public.line_approval_act(text,text,uuid,text,text,int)from public,anon,authenticated;grant execute on function public.line_approval_act(text,text,uuid,text,text,int)to service_role;

-- The website's approve / reject on a chained item: the signed-in member acts on the current step.
create or replace function public.web_approval_act(p_company uuid,p_id uuid,p_action text,p_values jsonb,p_note text default null)returns jsonb language plpgsql security definer set search_path=public as $$
declare i ingestions;begin
 select * into i from ingestions where id=p_id and company_id=p_company;
 if not found or member_role(p_company)is null then raise exception 'ไม่พบรายการ';end if; -- the step's own checks are in approval_act
 if p_action='approve'and p_values is not null and i.status='review'then
  update ingestions set values=coalesce((select jsonb_object_agg(fd->>'key',p_values->(fd->>'key'))from jsonb_array_elements(i.template->'fields')fd where p_values ? (fd->>'key')),values)where id=p_id;end if;
 return approval_act(p_company,auth.uid(),p_id,p_action,p_note,'web',null,null);end$$;
revoke all on function public.web_approval_act(uuid,uuid,text,jsonb,text)from public,anon;grant execute on function public.web_approval_act(uuid,uuid,text,jsonb,text)to authenticated;

-- "ส่งขออนุมัติ" on a draft: needs complete data, then the chain is planned and the item waits for step 1.
create or replace function public.line_draft_decide(p_group text,p_user text,p_id uuid,p_save boolean)returns text language plpgsql security definer set search_path=public as $$declare i ingestions;r text;begin
 select * into i from ingestions where id=p_id and group_id=p_group for update;
 if not found then raise exception 'ไม่พบรายการนี้';end if;
 if i.status<>'draft' then
  if i.status in('review','approved')then raise exception 'รายการนี้ส่งขออนุมัติแล้ว';end if;
  if i.status in('queued','processing')then raise exception 'กำลังอ่านข้อมูลใหม่ รอสรุปล่าสุดก่อนนะคะ';end if;
  raise exception 'รายการนี้ยกเลิกไปแล้ว';end if;
 if coalesce(i.source_user,'')<>coalesce(p_user,'')then
  select m.role into r from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id and not m.disabled
   where u.company_id=i.company_id and u.line_user_id=p_user;
  if r is null or r not in('owner','manager')then raise exception 'เฉพาะคนที่ส่งรายการนี้ หรือผู้จัดการ';end if;end if;
 if p_save then
  if jsonb_array_length(i.missing)>0 then
   raise exception 'ยังขาด: % — กด “แก้ไข” แล้วพิมพ์ข้อมูลที่ขาดก่อนส่งนะคะ',(select string_agg(value,', ')from jsonb_array_elements_text(i.missing));end if;
  update ingestions set status='review',approval=approval_plan(i)where id=p_id;
 else update ingestions set status='skipped',error='ยกเลิกใน LINE'where id=p_id;end if;
 delete from line_listen where ingestion_id=p_id;
 return case when p_save then 'review' else 'skipped' end;end$$;
revoke all on function public.line_draft_decide(text,text,uuid,boolean)from public,anon,authenticated;grant execute on function public.line_draft_decide(text,text,uuid,boolean)to service_role;

-- Items read in groups that read every message also go through the chain (planned when the read finishes).
create or replace function public.complete_ingestion(p_id uuid,p_lease uuid,p_values jsonb,p_missing jsonb,p_engine text)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;k text;begin
 select * into i from ingestions where id=p_id and lease_id=p_lease and status='processing'for update;if not found then return;end if;
 update ingestions set values=p_values,missing=p_missing,engine=p_engine,status=case when i.confirm then 'draft' else 'review' end,lease_until=null where id=p_id;
 if i.group_id is not null and not i.confirm then select * into i from ingestions where id=p_id;update ingestions set approval=approval_plan(i)where id=p_id;end if;
 select approve_keywords[1]into k from line_groups where group_id=i.group_id;
 if i.group_id is not null then insert into notification_outbox(id,company_id,target,body)values(i.id,i.company_id,i.group_id,left(case when i.confirm
  then '📝 สรุปก่อนบันทึก ('||left(i.id::text,8)||')'
  when jsonb_array_length(p_missing)>0
  then '⚠️ ZettaFlow: ข้อมูลยังไม่ครบ ('||left(i.id::text,8)||')'||chr(10)||'กรุณาส่งเพิ่ม: '||(select string_agg(value,', ')from jsonb_array_elements_text(p_missing))
  else '📨 ส่งขออนุมัติรายการ '||left(i.id::text,8)||' แล้ว (ยังไม่ถือว่าอนุมัติ)' end,4500))on conflict(id)do nothing;end if;end$$;
revoke execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)from public,anon,authenticated;grant execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)to service_role;

-- Old one-step paths (typed "อนุมัติ", #approve, Reply, the website's decide) refuse chained items.
create or replace function public.line_decide(p_group text,p_user text,p_id uuid,p_status text,p_reason text default '')returns void language plpgsql security definer set search_path=public as $$declare g line_groups;u memberships;i ingestions;f jsonb;v jsonb;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select m.* into u from memberships m join line_users l on l.company_id=m.company_id and l.user_id=m.user_id where l.company_id=g.company_id and l.line_user_id=p_user and not m.disabled and m.role in ('owner','manager');
 if not found then raise exception 'LINE นี้ยังไม่ได้เชื่อมกับผู้จัดการในระบบ (หน้า LINE → เชื่อมบัญชี LINE ของฉัน)';end if;
 select * into i from ingestions where id=p_id and company_id=g.company_id for update;if not found then raise exception 'ไม่พบรายการ';end if;
 if i.approval is not null then raise exception 'รายการนี้อนุมัติด้วยปุ่มในการ์ดขออนุมัติเท่านั้น';end if;
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

create or replace function public.decide_ingestion(p_company uuid,p_id uuid,p_status text,p_values jsonb,p_reason text default '')returns void language plpgsql security definer set search_path=public as $$declare i ingestions;f jsonb;v jsonb;s jsonb;begin
 select * into i from ingestions where id=p_id and company_id=p_company for update;if not found or not can_read_dept(p_company,i.department)or member_role(p_company)not in ('owner','manager')then raise exception 'ไม่มีสิทธิ์อนุมัติ';end if;
 if i.approval is not null then raise exception 'รายการนี้มีขั้นตอนอนุมัติ ใช้ปุ่มอนุมัติตามขั้นตอน';end if;
 if i.status<>'review'or p_status not in ('approved','rejected')then raise exception 'รายการตัดสินแล้วหรือสถานะไม่ถูกต้อง';end if;
 if p_status='approved'then p_values=coalesce((select jsonb_object_agg(field_def->>'key',p_values->(field_def->>'key'))from jsonb_array_elements(i.template->'fields')field_def),'{}'::jsonb);for f in select value from jsonb_array_elements(i.template->'fields')loop v=p_values->(f->>'key');if (f->>'required')::boolean and (v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ: %',f->>'label';end if;if v is not null and v<>'null'::jsonb then if f->>'type'='number'then if jsonb_typeof(v)<>'number'or abs((v#>>'{}')::numeric)>1e12 then raise exception 'ตัวเลขไม่ถูกต้อง';end if;elsif jsonb_typeof(v)<>'string'then raise exception 'ข้อความไม่ถูกต้อง';end if;if f->>'type'='date'and ((v#>>'{}')!~ '^\d{4}-\d{2}-\d{2}$'or to_char((v#>>'{}')::date,'YYYY-MM-DD')<>(v#>>'{}'))then raise exception 'วันที่ไม่ถูกต้อง';end if;end if;end loop;
 perform create_ingestion_workflow(p_company,auth.uid(),i.template,p_values,i.id);
 elsif length(trim(p_reason))=0 then raise exception 'ต้องมีเหตุผล';end if;
 update ingestions set status=p_status,values=case when p_status='approved'then p_values else values end,error=nullif(p_reason,''),missing=case when p_status='approved'then '[]'::jsonb else missing end where id=p_id;
 perform log_action(p_company,'ingestion_'||p_status,p_id::text);end$$;

-- Chained items send their own cards (approver, name, time, reference) — skip the plain decision notice for them.
create or replace function public.ingestion_decision_notify()returns trigger language plpgsql security definer set search_path=public as $$declare who text;what text;edited boolean;begin
 if new.group_id is null or not(new.status in('approved','rejected')and old.status is distinct from new.status)then return new;end if;
 if new.approval is not null then return new;end if;
 if new.decided_via='line'and new.decided_group=new.group_id then return new;end if;
 who=coalesce(new.decided_name,'ผู้อนุมัติ')||case when new.department is not null then ' ('||dept_th(new.department)||')'else ''end;
 what=coalesce(nullif(new.values->>'name',''),'รายการที่ส่งมา');
 edited=new.status='approved'and old.values is distinct from new.values;
 insert into notification_outbox(company_id,target,body,ingestion_id,role)values(new.company_id,new.group_id,left(
  case when new.status='approved'then(case when edited then '✏️ แก้ไขแล้วอนุมัติ: 'else '✅ อนุมัติแล้ว: 'end)||what
   else '❌ ไม่อนุมัติ: '||what||chr(10)||'เหตุผล: '||coalesce(nullif(new.error,''),'ไม่ระบุ')end
  ||chr(10)||'👤 โดย '||who,4500),new.id,'source');
 return new;end$$;
