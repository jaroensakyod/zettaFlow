-- 0060: Free plan, forever. Every company can use EliteFlow free with 1 LINE group and บัญชีและการเงิน.
--   • New companies start on plan 'free' (status active, no end date) instead of a 14-day Growth trial.
--   • A trial that ends, or a paid plan that lapses (3 days after its period), falls back to Free instead of stopping.
--   • Free limits: 1 LINE group, 3 users, 3 forms, 300 LINE/web items a month, and a monthly AI allowance
--     (free_limits). Paid plans and trials still running are unchanged. Other departments stay locked (app side).
insert into public.plans(id,name,monthly,yearly,workflows,documents,line_groups,users,ordinal,voice_minutes,storage_gb)
 values('free','Free',0,0,3,300,1,3,0,0,1)
 on conflict(id)do update set name=excluded.name,monthly=0,yearly=0,workflows=excluded.workflows,documents=excluded.documents,
  line_groups=excluded.line_groups,users=excluded.users,ordinal=0,voice_minutes=excluded.voice_minutes,storage_gb=excluded.storage_gb;
alter table public.subscriptions alter column plan set default 'free';
alter table public.subscriptions alter column status set default 'active';

create or replace function public.start_trial()returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into subscriptions(company_id,plan,status)values(new.id,'free','active')on conflict do nothing;return new;end$$;

-- Monthly AI allowance on Free (editable by the platform operator).
create table if not exists public.free_limits(resource text primary key,amount int not null check(amount>=0),label text not null);
insert into free_limits values('ai_files',30,'ไฟล์ที่ AI อ่าน'),('ai_chat',30,'คำถามถึงน้องโฟลว์'),('ai_calls',300,'การเรียก AI ทั้งหมด')
 on conflict(resource)do update set amount=excluded.amount,label=excluded.label;
alter table free_limits enable row level security;
drop policy if exists free_limits_read on free_limits;create policy free_limits_read on free_limits for select to anon,authenticated using(true);
revoke all on free_limits from anon,authenticated;grant select on free_limits to anon,authenticated;grant all on free_limits to service_role;

-- A trial still running.
create or replace function public.trial_valid(c uuid)returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select status='trial'and trial_ends_at>now()from subscriptions where company_id=c),false)$$;
-- The plan in force: a running trial or a paid plan within its period (+3 days), otherwise Free.
create or replace function public.effective_plan(c uuid)returns text language sql stable security definer set search_path=public as $$
 select case when s.status='trial'and s.trial_ends_at>now()then s.plan
  when s.status='active'and(s.current_period_end is null or s.current_period_end>now()-interval '3 days')then s.plan
  else 'free' end from subscriptions s where s.company_id=c$$;
-- Every company may work (Free never expires); limits decide the rest.
create or replace function public.subscription_active(c uuid)returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from subscriptions where company_id=c)$$;
create or replace function public.on_trial(c uuid)returns boolean language sql stable security definer set search_path=public as $$
 select trial_valid(c)$$;

create or replace function public.plan_limit(c uuid,r text)returns int language sql stable security definer set search_path=public as $$
 select case when trial_valid(c)and trial_limit(r)is not null then trial_limit(r)else
  case r when 'workflows' then p.workflows when 'documents' then p.documents when 'line_groups' then p.line_groups
   when 'users' then p.users+case when p.id='free'then 0 else s.extra_users end end end
 from subscriptions s join plans p on p.id=effective_plan(c) where s.company_id=c$$;

create or replace function public.has_addon(c uuid,a text)returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select trial_valid(c)or effective_plan(c)='enterprise'and a in('ocr_plus','exec_dashboard')
  or effective_plan(c)<>'free'and a=any(s.addons)from subscriptions s where s.company_id=c),false)$$;

-- Documents: a paid plan never blocks (overage is billed); a trial stops at its ceiling; Free stops at its monthly limit.
create or replace function public.enforce_quota()returns trigger language plpgsql security definer set search_path=public as $$declare r text;n bigint;l int;s subscriptions;ep text;begin
 r=tg_argv[0];
 select * into s from subscriptions where company_id=new.company_id;
 ep=effective_plan(new.company_id);
 if r='documents'then
  if trial_valid(new.company_id)then
   l=trial_limit('documents');if l is null then return new;end if;
   select count(*)into n from ingestions where company_id=new.company_id and created_at>=s.trial_ends_at-interval '14 days';
   if n>=l then raise exception 'ช่วงทดลองใช้ครบ % รายการแล้ว กรุณาเลือกแพ็กเกจเพื่อใช้งานต่อ',l;end if;
  elsif ep='free'then
   l=plan_limit(new.company_id,'documents');if l is null then return new;end if;
   select count(*)into n from ingestions where company_id=new.company_id and created_at>=date_trunc('month',now());
   if n>=l then raise exception 'แพ็กเกจฟรีใช้ได้ % รายการต่อเดือน ครบแล้ว อัปเกรดแพ็กเกจเพื่อใช้งานต่อ',l;end if;
  end if;
  return new;end if;
 l=plan_limit(new.company_id,r);if l is null then return new;end if;
 if r='workflows'then select count(*)into n from data_templates where company_id=new.company_id;
 elsif r='line_groups'then if exists(select 1 from line_groups where group_id=new.group_id)then return new;end if;select count(*)into n from line_groups where company_id=new.company_id;
 elsif r='users'then if new.disabled then return new;end if;select count(*)into n from memberships where company_id=new.company_id and not disabled;end if;
 if n>=l then raise exception '%',case when trial_valid(new.company_id)then 'ช่วงทดลองใช้ได้สูงสุด '||l||' '||coalesce((select label from trial_limits where resource=r),r)||' กรุณาเลือกแพ็กเกจเพื่อเพิ่ม'
  when ep='free'then 'แพ็กเกจฟรีใช้ได้ '||l||' '||case r when 'line_groups'then 'กลุ่ม LINE'when 'users'then 'ผู้ใช้'when 'workflows'then 'ฟอร์ม'else r end||' อัปเกรดแพ็กเกจเพื่อเพิ่ม'
  else 'เกินโควตาแพ็กเกจ ('||r||': '||l||') กรุณาอัปเกรด'end;end if;
 return new;end$$;

-- Allowance meters: the running trial (14-day window) or Free (this calendar month); null on a paid plan.
create or replace function public.trial_usage(c uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s subscriptions;t timestamptz;fl boolean;
begin
 select * into s from subscriptions where company_id=c;
 if s.company_id is null then return null;end if;
 if trial_valid(c)then t:=s.trial_ends_at-interval '14 days';fl:=false;
 elsif effective_plan(c)='free'then t:=date_trunc('month',now());fl:=true;
 else return null;end if;
 return jsonb_build_object(
  'kind',case when fl then 'free'else 'trial'end,
  'ends_at',case when fl then null else s.trial_ends_at end,
  'documents',jsonb_build_object('used',(select count(*)from ingestions where company_id=c and created_at>=t),'limit',case when fl then plan_limit(c,'documents')else trial_limit('documents')end),
  'ai_files',jsonb_build_object('used',(select count(*)from ai_usage where company_id=c and has_file and created_at>=t),'limit',case when fl then(select amount from free_limits where resource='ai_files')else trial_limit('ai_files')end),
  'ai_chat',jsonb_build_object('used',(select count(*)from ai_usage where company_id=c and feature='chat'and created_at>=t),'limit',case when fl then(select amount from free_limits where resource='ai_chat')else trial_limit('ai_chat')end),
  'ai_calls',jsonb_build_object('used',(select count(*)from ai_usage where company_id=c and created_at>=t),'limit',case when fl then(select amount from free_limits where resource='ai_calls')else trial_limit('ai_calls')end),
  'line_groups',jsonb_build_object('used',(select count(*)from line_groups where company_id=c),'limit',plan_limit(c,'line_groups')),
  'users',jsonb_build_object('used',(select count(*)from memberships where company_id=c and not disabled),'limit',plan_limit(c,'users')));
end$$;

-- usage_summary reports the plan in force: a finished trial or lapsed plan shows as Free (active).
create or replace function public.usage_summary(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select case when member_role(p_company)is null then null else jsonb_build_object(
  'subscription',(select to_jsonb(s)||case when effective_plan(p_company)='free'and s.plan<>'free'and not trial_valid(p_company)
     then jsonb_build_object('plan','free','status','active','current_period_end',null,'lapsed_plan',s.plan)else '{}'::jsonb end
   from subscriptions s where company_id=p_company),
  'plan',(select to_jsonb(p)from plans p where p.id=effective_plan(p_company)),
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

revoke all on function public.trial_valid(uuid),public.effective_plan(uuid)from public,anon;
grant execute on function public.trial_valid(uuid),public.effective_plan(uuid)to authenticated,service_role;
revoke all on function public.subscription_active(uuid),public.plan_limit(uuid,text),public.enforce_quota(),public.start_trial()from public,anon,authenticated;
revoke all on function public.on_trial(uuid),public.trial_usage(uuid)from public,anon;
grant execute on function public.trial_usage(uuid),public.usage_summary(uuid),public.has_addon(uuid,text)to authenticated,service_role;
grant execute on function public.on_trial(uuid)to service_role;
select 'ok 0060' as result,(select monthly from public.plans where id='free')as free_price,
 (select count(*)from public.subscriptions s where public.effective_plan(s.company_id)='free')as on_free;
