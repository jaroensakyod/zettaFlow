-- LINE: the bot works only when a member @mentions it (default for every group). Messages that do not mention it
-- are not stored at all. A mention is read into a draft (ร่าง): the bot answers with a summary card and buttons
-- "บันทึกได้เลย / แก้ไข / ยกเลิก". A correction is read again into a new summary; only "บันทึกได้เลย" sends the item
-- to the website (status review, the usual approval). Owners can switch a group back to reading every message.

alter table public.line_groups add column if not exists listen text not null default 'mention';
alter table public.line_groups drop constraint if exists line_groups_listen_check;
alter table public.line_groups add constraint line_groups_listen_check check(listen in ('mention','all'));

-- confirm = read into a draft first; status 'draft' = summary shown in LINE, waiting for "บันทึกได้เลย".
alter table public.ingestions add column if not exists confirm boolean not null default false;
alter table public.ingestions drop constraint if exists ingestions_status_check;
alter table public.ingestions add constraint ingestions_status_check check(status in ('queued','processing','draft','review','approved','rejected','failed','skipped'));

-- A notice can carry a full LINE message (the summary card with buttons) instead of plain text.
alter table public.notification_outbox add column if not exists payload jsonb;

-- Who the bot is listening to right now (never what they said): after an empty mention ("any": the next message or
-- file), after a mention with text ("files": a photo or file that follows joins that draft) and after "แก้ไข"
-- ("edit": the next message corrects the draft). Short-lived; service role only.
create table if not exists public.line_listen(
 group_id text not null,
 line_user text not null,
 company_id uuid not null references companies(id) on delete cascade,
 mode text not null check(mode in('any','files','edit')),
 ingestion_id uuid references ingestions(id) on delete cascade,
 until timestamptz not null,
 primary key(group_id,line_user));
alter table public.line_listen enable row level security;
revoke all on public.line_listen from anon,authenticated;

-- Same as before, except an item read with confirm becomes a draft (not yet in the review box).
create or replace function public.complete_ingestion(p_id uuid,p_lease uuid,p_values jsonb,p_missing jsonb,p_engine text)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;k text;begin
 select * into i from ingestions where id=p_id and lease_id=p_lease and status='processing'for update;if not found then return;end if;
 update ingestions set values=p_values,missing=p_missing,engine=p_engine,status=case when i.confirm then 'draft' else 'review' end,lease_until=null where id=p_id;
 select approve_keywords[1]into k from line_groups where group_id=i.group_id;
 if i.group_id is not null then insert into notification_outbox(id,company_id,target,body)values(i.id,i.company_id,i.group_id,left(case when i.confirm
  then '📝 สรุปก่อนบันทึก ('||left(i.id::text,8)||')'
  when jsonb_array_length(p_missing)>0
  then '⚠️ ZettaFlow: ข้อมูลยังไม่ครบ ('||left(i.id::text,8)||')'||chr(10)||'กรุณาส่งเพิ่ม: '||(select string_agg(value,', ')from jsonb_array_elements_text(p_missing))
  else '✅ ZettaFlow: บันทึกรายการ '||left(i.id::text,8)||' แล้ว รอผู้จัดการอนุมัติ'||chr(10)||'ผู้จัดการพิมพ์ "'||coalesce(k,'อนุมัติ')||'" หรือ #approve '||i.id::text end,4500))on conflict(id)do nothing;end if;end$$;
revoke execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)from public,anon,authenticated;grant execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)to service_role;

-- "บันทึกได้เลย" / "ยกเลิก" on a draft: the member who asked, or a linked owner/manager of the company.
create or replace function public.line_draft_decide(p_group text,p_user text,p_id uuid,p_save boolean)returns text language plpgsql security definer set search_path=public as $$declare i ingestions;r text;begin
 select * into i from ingestions where id=p_id and group_id=p_group for update;
 if not found then raise exception 'ไม่พบรายการนี้';end if;
 if i.status<>'draft' then
  if i.status in('review','approved')then raise exception 'รายการนี้ส่งเข้าเว็บแล้ว';end if;
  if i.status in('queued','processing')then raise exception 'กำลังอ่านข้อมูลใหม่ รอสรุปล่าสุดก่อนนะคะ';end if;
  raise exception 'รายการนี้ยกเลิกไปแล้ว';end if;
 if coalesce(i.source_user,'')<>coalesce(p_user,'')then
  select m.role into r from line_users u join memberships m on m.company_id=u.company_id and m.user_id=u.user_id and not m.disabled
   where u.company_id=i.company_id and u.line_user_id=p_user;
  if r is null or r not in('owner','manager')then raise exception 'เฉพาะคนที่ส่งรายการนี้ หรือผู้จัดการ';end if;end if;
 if p_save then update ingestions set status='review'where id=p_id;
 else update ingestions set status='skipped',error='ยกเลิกใน LINE'where id=p_id;end if;
 delete from line_listen where ingestion_id=p_id;
 return case when p_save then 'review' else 'skipped' end;end$$;
revoke all on function public.line_draft_decide(text,text,uuid,boolean)from public,anon,authenticated;grant execute on function public.line_draft_decide(text,text,uuid,boolean)to service_role;

-- Owner switches how a group is read: only when mentioned (default) or every message.
create or replace function public.set_line_group_listen(p_company uuid,p_group text,p_listen text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_listen not in('mention','all')then raise exception 'โหมดไม่ถูกต้อง';end if;
 update line_groups set listen=p_listen where group_id=p_group and company_id=p_company;if not found then raise exception 'ไม่พบกลุ่ม';end if;
 perform log_action(p_company,'line_group_listen',p_group||':'||p_listen);end$$;
revoke all on function public.set_line_group_listen(uuid,text,text)from public,anon;grant execute on function public.set_line_group_listen(uuid,text,text)to authenticated;
