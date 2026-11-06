-- Free 14-day trial with a ceiling, and a log of every AI call per company.
--  • Trial: 2 LINE groups, 5 users, 5 forms, 500 LINE/web items, 100 files read by AI, 100 questions to น้องโฟลว์,
--    1,500 AI calls in all. Over the limit the action stops with a message to choose a plan (paid plans are unchanged).
--  • ai_usage keeps tokens and estimated cost of each call, so real cost per company can be read instead of guessed.

create table if not exists public.ai_usage(
 id bigint generated always as identity primary key,company_id uuid not null references companies(id),
 feature text not null default 'other',model text not null default '',input_tokens int not null default 0,output_tokens int not null default 0,cached_tokens int not null default 0,
 has_file boolean not null default false,cost_usd numeric(12,6),created_at timestamptz not null default now());
create index if not exists ai_usage_company on ai_usage(company_id,created_at desc);
alter table ai_usage enable row level security;
revoke all on ai_usage from anon,authenticated;grant all on ai_usage to service_role;

-- Trial ceilings (one row per resource), editable by the platform operator.
create table if not exists public.trial_limits(resource text primary key,amount int not null check(amount>=0),label text not null);
insert into trial_limits values
 ('line_groups',2,'กลุ่ม LINE'),('users',5,'ผู้ใช้'),('workflows',5,'ฟอร์ม/Template'),
 ('documents',500,'รายการจาก LINE และเว็บ'),('ai_files',100,'ไฟล์ที่ AI อ่าน'),('ai_chat',100,'คำถามถึงน้องโฟลว์'),('ai_calls',1500,'การเรียก AI ทั้งหมด')
 on conflict(resource)do update set amount=excluded.amount,label=excluded.label;
alter table trial_limits enable row level security;
drop policy if exists trial_limits_read on trial_limits;create policy trial_limits_read on trial_limits for select to anon,authenticated using(true);
revoke all on trial_limits from anon,authenticated;grant select on trial_limits to anon,authenticated;grant all on trial_limits to service_role;

create or replace function public.on_trial(c uuid)returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select status='trial'from subscriptions where company_id=c),false)$$;
create or replace function public.trial_limit(r text)returns int language sql stable security definer set search_path=public as $$
 select amount from trial_limits where resource=r$$;

-- Plan limits: a trial uses the trial ceiling; a paid plan keeps its own.
create or replace function public.plan_limit(c uuid,r text)returns int language sql stable security definer set search_path=public as $$
 select case when s.status='trial'and trial_limit(r)is not null then trial_limit(r)else
  case r when 'workflows' then p.workflows when 'documents' then p.documents when 'line_groups' then p.line_groups when 'users' then p.users+s.extra_users end end
 from subscriptions s join plans p on p.id=s.plan where s.company_id=c$$;

-- Documents still never block a paid plan (overage is billed), but they do stop a trial at its ceiling.
create or replace function public.enforce_quota()returns trigger language plpgsql security definer set search_path=public as $$declare r text;n bigint;l int;s subscriptions;begin
 r=tg_argv[0];
 if not subscription_active(new.company_id)then raise exception 'แพ็กเกจหมดอายุ กรุณาต่ออายุการใช้งาน';end if;
 select * into s from subscriptions where company_id=new.company_id;
 if r='documents'then
  if s.status<>'trial'then return new;end if;
  l=trial_limit('documents');if l is null then return new;end if;
  select count(*)into n from ingestions where company_id=new.company_id and created_at>=s.trial_ends_at-interval '14 days';
  if n>=l then raise exception 'ช่วงทดลองใช้ครบ % รายการแล้ว กรุณาเลือกแพ็กเกจเพื่อใช้งานต่อ',l;end if;
  return new;end if;
 l=plan_limit(new.company_id,r);if l is null then return new;end if;
 if r='workflows'then select count(*)into n from data_templates where company_id=new.company_id;
 elsif r='line_groups'then if exists(select 1 from line_groups where group_id=new.group_id)then return new;end if;select count(*)into n from line_groups where company_id=new.company_id;
 elsif r='users'then if new.disabled then return new;end if;select count(*)into n from memberships where company_id=new.company_id and not disabled;end if;
 if n>=l then raise exception '%',case when s.status='trial'then 'ช่วงทดลองใช้ได้สูงสุด '||l||' '||coalesce((select label from trial_limits where resource=r),r)||' กรุณาเลือกแพ็กเกจเพื่อเพิ่ม'else 'เกินโควตาแพ็กเกจ ('||r||': '||l||') กรุณาอัปเกรด'end;end if;
 return new;end$$;

-- What the trial has used so far (null when the company is not on trial).
create or replace function public.trial_usage(c uuid)returns jsonb language sql stable security definer set search_path=public as $$
 with s as(select * from subscriptions where company_id=c and status='trial'),
 since as(select trial_ends_at-interval '14 days' t from s)
 select case when not exists(select 1 from s)then null else jsonb_build_object(
  'ends_at',(select trial_ends_at from s),
  'documents',jsonb_build_object('used',(select count(*)from ingestions,since where company_id=c and created_at>=since.t),'limit',trial_limit('documents')),
  'ai_files',jsonb_build_object('used',(select count(*)from ai_usage,since where company_id=c and has_file and created_at>=since.t),'limit',trial_limit('ai_files')),
  'ai_chat',jsonb_build_object('used',(select count(*)from ai_usage,since where company_id=c and feature='chat'and created_at>=since.t),'limit',trial_limit('ai_chat')),
  'ai_calls',jsonb_build_object('used',(select count(*)from ai_usage,since where company_id=c and created_at>=since.t),'limit',trial_limit('ai_calls')),
  'line_groups',jsonb_build_object('used',(select count(*)from line_groups where company_id=c),'limit',trial_limit('line_groups')),
  'users',jsonb_build_object('used',(select count(*)from memberships where company_id=c and not disabled),'limit',trial_limit('users')))end$$;
revoke all on function public.on_trial(uuid),public.trial_limit(text),public.trial_usage(uuid)from public,anon;
grant execute on function public.trial_usage(uuid)to authenticated,service_role;
grant execute on function public.on_trial(uuid),public.trial_limit(text)to service_role;

-- usage_summary also returns the trial meters.
create or replace function public.usage_summary(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select case when member_role(p_company)is null then null else jsonb_build_object(
  'subscription',(select to_jsonb(s)from subscriptions s where company_id=p_company),
  'plan',(select to_jsonb(p)from plans p join subscriptions s on s.plan=p.id where s.company_id=p_company),
  'active',subscription_active(p_company),
  'trial',trial_usage(p_company),
  'usage',jsonb_build_object(
   'workflows',(select count(*)from data_templates where company_id=p_company),
   'documents',(select count(*)from ingestions where company_id=p_company and created_at>=date_trunc('month',now())),
   'ocr',(select count(*)from ingestions i join attachments a on a.id=i.attachment_id where i.company_id=p_company and a.mime like 'image/%'and i.created_at>=date_trunc('month',now())),
   'ai_runs',(select count(*)from ingestions i join attachments a on a.id=i.attachment_id where i.company_id=p_company and a.mime='application/pdf'and i.created_at>=date_trunc('month',now())),
   'pages',(select coalesce(sum(pages),0)from ingestions where company_id=p_company and created_at>=date_trunc('month',now())),
   'line_groups',(select count(*)from line_groups where company_id=p_company),
   'users',(select count(*)from memberships where company_id=p_company and not disabled)),
  'limits',jsonb_build_object('workflows',plan_limit(p_company,'workflows'),'documents',plan_limit(p_company,'documents'),'line_groups',plan_limit(p_company,'line_groups'),'users',plan_limit(p_company,'users'))) end$$;

-- พนักงาน gains lineUserId (hidden) so a LINE member added from a LINE item is matched next time.
insert into public.entity_schemas(kind,department,fields)values('employees','HR','[{"key":"photo","label":"รูปพนักงาน","type":"image","required":false},{"key":"name","label":"ชื่อ-นามสกุล","type":"text","required":true},{"key":"code","label":"รหัสพนักงาน","type":"text","required":false},{"key":"nickname","label":"ชื่อเล่น","type":"text","required":false},{"key":"department","label":"แผนก","type":"text","required":true},{"key":"position","label":"ตำแหน่ง","type":"text","required":false},{"key":"employmentType","label":"ประเภทการจ้าง","type":"select","required":true,"options":["ประจำ","สัญญาจ้าง","พาร์ตไทม์"]},{"key":"startDate","label":"วันเริ่มงาน","type":"date","required":false},{"key":"salary","label":"เงินเดือน","type":"number","required":false,"min":0},{"key":"birthDate","label":"วันเกิด","type":"date","required":false},{"key":"idCard","label":"เลขบัตรประชาชน","type":"text","required":false},{"key":"bank","label":"ธนาคาร","type":"text","required":false},{"key":"bankAccount","label":"เลขบัญชี","type":"text","required":false},{"key":"emergency","label":"ผู้ติดต่อฉุกเฉิน","type":"text","required":false},{"key":"level","label":"ระดับ","type":"select","required":false,"options":["พนักงาน","หัวหน้างาน","ผู้จัดการ","ผู้บริหาร"]},{"key":"managerId","label":"หัวหน้างาน","type":"relation","required":false,"resource":"employees"},{"key":"branch","label":"สาขา","type":"text","required":false},{"key":"workHours","label":"เวลาทำงาน","type":"text","required":false},{"key":"about","label":"เกี่ยวกับ","type":"textarea","required":false},{"key":"skills","label":"ทักษะ (คั่นด้วย ,)","type":"text","required":false},{"key":"score","label":"คะแนนประเมิน (0–100)","type":"number","required":false,"min":0},{"key":"leaveQuota","label":"วันลาต่อปี","type":"number","required":false,"min":0},{"key":"checklist","label":"เอกสารที่ส่งแล้ว","type":"text","required":false,"hidden":true},{"key":"approvals","label":"สิทธิ์การอนุมัติ","type":"text","required":false,"hidden":true},{"key":"history","label":"ประวัติการทำงาน","type":"textarea","required":false,"hidden":true},{"key":"cover","label":"รูปปก","type":"image","required":false,"hidden":true},{"key":"lineUserId","label":"LINE ของพนักงาน","type":"text","required":false,"hidden":true},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","probation","on_leave","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

-- Approval: an employee field that matches no name falls back to the employee linked to the sender's LINE.
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
   -- Not found by name: a พนักงาน linked to the LINE member who sent it (added from an earlier LINE item).
   if k is null and st->>'resource'='employees' and new.source_user is not null then
    select id::text into k from entities e where e.company_id=new.company_id and e.kind='employees' and e.archived_at is null and e.data->>'lineUserId'=new.source_user limit 1;end if;
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

-- Fewer paid LINE pushes: items still missing data after 12 hours are reminded once, as one message per group.
create or replace function public.queue_nudges()returns int language plpgsql security definer set search_path=public as $$declare n int;begin
 with x as(update ingestions set nudged_at=now()where status='review'and group_id is not null and jsonb_array_length(missing)>0 and created_at<now()-interval '12 hours'and nudged_at is null returning *),
 g as(select company_id,group_id,count(*)c,string_agg('• '||coalesce(nullif(values->>'name',''),'รายการที่ส่งมา')||' — ขาด '||(select string_agg(value,', ')from jsonb_array_elements_text(missing)),chr(10)order by created_at)lines from x group by company_id,group_id)
 insert into notification_outbox(company_id,target,body)select company_id,group_id,left('⏰ มี '||c||' รายการยังขาดข้อมูล'||chr(10)||lines||chr(10)||'กด Reply ที่ข้อความแจ้งบันทึกเดิมของแต่ละรายการ แล้วพิมพ์ข้อมูลที่ขาด',4500)from g;
 get diagnostics n=row_count;return n;end$$;
revoke all on function public.queue_nudges()from public,anon,authenticated;grant execute on function public.queue_nudges()to service_role;
