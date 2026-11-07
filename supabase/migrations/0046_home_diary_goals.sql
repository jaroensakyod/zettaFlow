-- Home dashboard (design update, page 16): a private diary note per person per day (text + checklist), and the
-- company's sales goal for each month (ยอดขายเป้าหมาย) that the "เป้าหมายเดือนนี้" card measures this month's sales against.

create table if not exists public.user_notes(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references companies(id),
 user_id uuid not null references auth.users(id),
 day date not null,
 body text not null default '' check(length(body)<=4000),
 items jsonb not null default '[]' check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=30),
 updated_at timestamptz not null default now(),
 unique(company_id,user_id,day));
create index if not exists user_notes_owner on user_notes(company_id,user_id,day desc);

create table if not exists public.monthly_goals(
 company_id uuid not null references companies(id),
 month date not null check(extract(day from month)=1),
 sales_target numeric not null check(sales_target>=0 and sales_target<=1e12),
 updated_by uuid,
 updated_at timestamptz not null default now(),
 primary key(company_id,month));

alter table user_notes enable row level security;alter table monthly_goals enable row level security;
revoke all on user_notes,monthly_goals from anon;
revoke insert,update,delete on user_notes,monthly_goals from authenticated;
grant select on user_notes,monthly_goals to authenticated;
grant all on user_notes,monthly_goals to service_role;
-- Notes are visible only to the person who wrote them (not even the owner); goals to every member of the company.
drop policy if exists user_notes_read on user_notes;
create policy user_notes_read on user_notes for select to authenticated using(user_id=auth.uid()and member_role(company_id)is not null);
drop policy if exists monthly_goals_read on monthly_goals;
create policy monthly_goals_read on monthly_goals for select to authenticated using(member_role(company_id)is not null);

-- Save (upsert) my note for a day. An empty body with no checklist items removes the note. Items: [{text, done}].
create or replace function public.note_save(p_company uuid,p_day date,p_body text,p_items jsonb)returns jsonb language plpgsql security definer set search_path=public as $$declare it jsonb;clean jsonb:='[]';r user_notes;begin
 if auth.uid()is null or member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 if p_day is null or p_day<date '2000-01-01' or p_day>current_date+366 then raise exception 'วันที่ไม่ถูกต้อง';end if;
 if length(coalesce(p_body,''))>4000 then raise exception 'บันทึกยาวเกิน 4,000 ตัวอักษร';end if;
 if p_items is not null and jsonb_typeof(p_items)<>'array' then raise exception 'รายการไม่ถูกต้อง';end if;
 if jsonb_array_length(coalesce(p_items,'[]'))>30 then raise exception 'รายการสูงสุด 30 ข้อ';end if;
 for it in select value from jsonb_array_elements(coalesce(p_items,'[]'))loop
  if jsonb_typeof(it)<>'object' or jsonb_typeof(it->'text')<>'string' then raise exception 'รายการไม่ถูกต้อง';end if;
  if length(trim(it->>'text'))=0 then continue;end if;
  if length(it->>'text')>200 then raise exception 'แต่ละรายการไม่เกิน 200 ตัวอักษร';end if;
  clean=clean||jsonb_build_array(jsonb_build_object('text',trim(it->>'text'),'done',coalesce(it->'done'='true'::jsonb,false)));
 end loop;
 if length(trim(coalesce(p_body,'')))=0 and jsonb_array_length(clean)=0 then
  delete from user_notes where company_id=p_company and user_id=auth.uid()and day=p_day;return null;end if;
 insert into user_notes(company_id,user_id,day,body,items,updated_at)values(p_company,auth.uid(),p_day,trim(coalesce(p_body,'')),clean,now())
 on conflict(company_id,user_id,day)do update set body=excluded.body,items=excluded.items,updated_at=now()returning * into r;
 return to_jsonb(r);end$$;

create or replace function public.note_delete(p_company uuid,p_day date)returns void language plpgsql security definer set search_path=public as $$begin
 if auth.uid()is null or member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 delete from user_notes where company_id=p_company and user_id=auth.uid()and day=p_day;end$$;

-- Owner or manager sets the month's sales goal (0 clears it).
create or replace function public.goal_set(p_company uuid,p_month date,p_target numeric)returns void language plpgsql security definer set search_path=public as $$begin
 if coalesce(member_role(p_company),'')not in('owner','manager')then raise exception 'เฉพาะเจ้าของหรือผู้จัดการตั้งเป้าหมายได้';end if;
 if p_month is null or p_target is null or p_target<0 or p_target>1e12 then raise exception 'เป้าหมายไม่ถูกต้อง';end if;
 if p_target=0 then delete from monthly_goals where company_id=p_company and month=date_trunc('month',p_month)::date;
 else insert into monthly_goals(company_id,month,sales_target,updated_by,updated_at)values(p_company,date_trunc('month',p_month)::date,p_target,auth.uid(),now())
  on conflict(company_id,month)do update set sales_target=excluded.sales_target,updated_by=excluded.updated_by,updated_at=now();end if;
 perform log_action(p_company,'monthly_goal_set',to_char(p_month,'YYYY-MM'));end$$;

revoke all on function public.note_save(uuid,date,text,jsonb),public.note_delete(uuid,date),public.goal_set(uuid,date,numeric)from public,anon;
grant execute on function public.note_save(uuid,date,text,jsonb),public.note_delete(uuid,date),public.goal_set(uuid,date,numeric)to authenticated;
