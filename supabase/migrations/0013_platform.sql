-- ZettaFlow platform: dynamic form choices, dashboard layout, subscriptions & quotas, share links, slip verification, LINE keyword approval and auto-nudge.

-- 1) Dynamic Form Designer: allow "choice" fields (with options) for categorical widgets.
create or replace function public.save_template(p_company uuid,p_name text,p_department text,p_fields jsonb,p_steps jsonb,p_id uuid default null)returns data_templates language plpgsql security definer set search_path=public as $$declare t data_templates;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if length(p_name)not between 1 and 200 or jsonb_array_length(p_fields)not between 1 and 30 or jsonb_array_length(p_steps)>20 then raise exception 'Template ไม่ถูกต้อง';end if;
 if exists(select 1 from jsonb_array_elements(p_fields)f where f->>'key'!~ '^[a-z][a-z0-9_]{0,39}$'or f->>'type'not in ('text','number','date','choice')or(f->>'type'='choice'and coalesce(jsonb_typeof(f->'options')<>'array'or jsonb_array_length(f->'options')not between 2 and 20,true)))or (select count(*)from jsonb_array_elements(p_fields))<>(select count(distinct f->>'key')from jsonb_array_elements(p_fields)f)then raise exception 'ฟิลด์ไม่ถูกต้อง';end if;
 if p_id is null then insert into data_templates(company_id,name,department,fields,steps)values(p_company,p_name,p_department,p_fields,p_steps)returning * into t;else update data_templates set name=p_name,department=p_department,fields=p_fields,steps=p_steps,version=version+1 where id=p_id and company_id=p_company returning * into t;if not found then raise exception 'ไม่พบ Template';end if;end if;perform log_action(p_company,'template_saved',t.id::text);return t;end$$;

-- Choice-field breakdowns (auto pie widgets). Department-scoped for members.
create or replace function public.template_breakdowns(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(b)),'[]')from(
 select t.id::text||':'||(f->>'key')as key,t.name,f->>'label'as label,t.department,
  coalesce((select jsonb_object_agg(v,n)from(select i.values->>(f->>'key')v,count(*)n from ingestions i where i.company_id=t.company_id and i.template->>'id'=t.id::text and i.status='approved'and jsonb_typeof(i.values->(f->>'key'))='string'group by 1)x),'{}')as buckets
 from data_templates t cross join lateral jsonb_array_elements(t.fields)f
 where t.company_id=p_company and can_read_dept(t.company_id,t.department)and f->>'type'='choice')b$$;

-- Dashboard layout (order / hidden / per-widget roles) stored in companies.settings.dashboard.
create or replace function public.save_dashboard_layout(p_company uuid,p_layout jsonb)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if jsonb_typeof(p_layout)<>'object'or length(p_layout::text)>20000 then raise exception 'Layout ไม่ถูกต้อง';end if;
 update companies set settings=jsonb_set(settings,'{dashboard}',p_layout,true)where id=p_company;perform log_action(p_company,'dashboard_layout',p_company::text);end$$;

-- 2) Subscriptions, quotas and overage.
create table public.plans(id text primary key,name text not null,monthly numeric not null,yearly numeric not null,workflows int,documents int,line_groups int,users int,ordinal int not null);
insert into plans values('starter','Starter',1190,11900,5,1000,2,2,1),('growth','Growth',3490,34900,20,4000,10,10,2),('enterprise','Enterprise',8900,89000,null,null,null,null,3);
create table public.subscriptions(company_id uuid primary key references companies(id),plan text not null references plans(id) default 'growth',cycle text not null default 'monthly' check(cycle in ('monthly','yearly')),status text not null default 'trial' check(status in ('trial','active','past_due','cancelled')),trial_ends_at timestamptz not null default now()+interval '14 days',current_period_end timestamptz,addons text[] not null default '{}',extra_users int not null default 0 check(extra_users between 0 and 1000),updated_at timestamptz not null default now());
create table public.billing_payments(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),plan text not null references plans(id),cycle text not null check(cycle in ('monthly','yearly')),amount numeric not null check(amount>0),attachment_id uuid references attachments(id),slip jsonb not null default '{}',slip_ref text,status text not null default 'pending' check(status in ('pending','verified','rejected')),note text,created_by uuid,created_at timestamptz not null default now(),decided_at timestamptz,unique(slip_ref));
alter table plans enable row level security;alter table subscriptions enable row level security;alter table billing_payments enable row level security;
create policy plans_read on plans for select to anon,authenticated using(true);
create policy subscription_read on subscriptions for select to authenticated using(member_role(company_id)is not null);
create policy billing_read on billing_payments for select to authenticated using(member_role(company_id)='owner');
insert into subscriptions(company_id)select id from companies on conflict do nothing;
create function public.start_trial()returns trigger language plpgsql security definer set search_path=public as $$begin insert into subscriptions(company_id)values(new.id)on conflict do nothing;return new;end$$;
create trigger companies_trial after insert on companies for each row execute function start_trial();

create or replace function public.subscription_active(c uuid)returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select status='active'and(current_period_end is null or current_period_end>now()-interval '3 days')or status='trial'and trial_ends_at>now() from subscriptions where company_id=c),false)$$;
create or replace function public.plan_limit(c uuid,r text)returns int language sql stable security definer set search_path=public as $$
 select case r when 'workflows' then p.workflows when 'documents' then p.documents when 'line_groups' then p.line_groups when 'users' then p.users+s.extra_users end
 from subscriptions s join plans p on p.id=s.plan where s.company_id=c$$;
create or replace function public.usage_summary(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select case when member_role(p_company)is null then null else jsonb_build_object(
  'subscription',(select to_jsonb(s)from subscriptions s where company_id=p_company),
  'plan',(select to_jsonb(p)from plans p join subscriptions s on s.plan=p.id where s.company_id=p_company),
  'active',subscription_active(p_company),
  'usage',jsonb_build_object(
   'workflows',(select count(*)from data_templates where company_id=p_company),
   'documents',(select count(*)from ingestions where company_id=p_company and created_at>=date_trunc('month',now())),
   'ocr',(select count(*)from ingestions where company_id=p_company and attachment_id is not null and created_at>=date_trunc('month',now())),
   'ai_runs',(select count(*)from ingestions where company_id=p_company and engine='ai'and created_at>=date_trunc('month',now())),
   'line_groups',(select count(*)from line_groups where company_id=p_company),
   'users',(select count(*)from memberships where company_id=p_company and not disabled)),
  'limits',jsonb_build_object('workflows',plan_limit(p_company,'workflows'),'documents',plan_limit(p_company,'documents'),'line_groups',plan_limit(p_company,'line_groups'),'users',plan_limit(p_company,'users'))) end$$;

create or replace function public.enforce_quota()returns trigger language plpgsql security definer set search_path=public as $$declare r text;n bigint;l int;begin
 r=tg_argv[0];
 if not subscription_active(new.company_id)then raise exception 'แพ็กเกจหมดอายุ กรุณาต่ออายุการใช้งาน';end if;
 if r='documents'then return new;end if; -- documents never block: overage is billed next cycle
 l=plan_limit(new.company_id,r);if l is null then return new;end if;
 if r='workflows'then select count(*)into n from data_templates where company_id=new.company_id;
 elsif r='line_groups'then if exists(select 1 from line_groups where group_id=new.group_id)then return new;end if;select count(*)into n from line_groups where company_id=new.company_id;
 elsif r='users'then if new.disabled then return new;end if;select count(*)into n from memberships where company_id=new.company_id and not disabled;end if;
 if n>=l then raise exception 'เกินโควตาแพ็กเกจ (%: %) กรุณาอัปเกรด',r,l;end if;return new;end$$;
create trigger quota_workflows before insert on data_templates for each row execute function enforce_quota('workflows');
create trigger quota_line_groups before insert on line_groups for each row execute function enforce_quota('line_groups');
create trigger quota_users before insert on memberships for each row execute function enforce_quota('users');
create trigger quota_documents before insert on ingestions for each row execute function enforce_quota('documents');

create or replace function public.request_payment(p_company uuid,p_plan text,p_cycle text,p_attachment uuid,p_slip jsonb,p_ref text)returns billing_payments language plpgsql security definer set search_path=public as $$declare p plans;b billing_payments;a numeric;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 select * into p from plans where id=p_plan;if not found or p_cycle not in ('monthly','yearly')then raise exception 'แพ็กเกจไม่ถูกต้อง';end if;
 if p_ref is not null and exists(select 1 from billing_payments where slip_ref=p_ref)then raise exception 'สลิปนี้ถูกใช้แล้ว';end if;
 a=round((case when p_cycle='yearly'then p.yearly else p.monthly end)*1.07,2);
 insert into billing_payments(company_id,plan,cycle,amount,attachment_id,slip,slip_ref,created_by)values(p_company,p_plan,p_cycle,a,p_attachment,coalesce(p_slip,'{}'),p_ref,auth.uid())returning * into b;
 perform log_action(p_company,'payment_requested',b.id::text);return b;end$$;
-- Platform operator (service role) confirms the transfer and activates the plan.
create or replace function public.confirm_payment(p_id uuid,p_status text,p_note text default null)returns void language plpgsql security definer set search_path=public as $$declare b billing_payments;begin
 select * into b from billing_payments where id=p_id for update;if not found or b.status<>'pending'or p_status not in ('verified','rejected')then raise exception 'รายการไม่ถูกต้อง';end if;
 update billing_payments set status=p_status,note=p_note,decided_at=now()where id=p_id;
 if p_status='verified'then update subscriptions set plan=b.plan,cycle=b.cycle,status='active',current_period_end=greatest(coalesce(current_period_end,now()),now())+case when b.cycle='yearly'then interval '1 year' else interval '1 month' end,updated_at=now()where company_id=b.company_id;end if;end$$;
revoke all on function public.confirm_payment(uuid,text,text)from public,anon,authenticated;grant execute on function public.confirm_payment(uuid,text,text)to service_role;
create or replace function public.expire_subscriptions()returns int language sql security definer set search_path=public as $$
 with x as(update subscriptions set status='past_due',updated_at=now()where status='active'and current_period_end<now()-interval '3 days' returning 1)select count(*)::int from x$$;
revoke all on function public.expire_subscriptions()from public,anon,authenticated;grant execute on function public.expire_subscriptions()to service_role;

-- 3) Share dashboard links (password + expiry). Resolved only by the server with the service role.
create table public.dashboard_shares(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),token_hash text not null unique,password_hash text,label text not null default '',widget_keys text[] not null default '{}',expires_at timestamptz not null,revoked_at timestamptz,created_by uuid,created_at timestamptz not null default now(),check(expires_at<=created_at+interval '366 days'));
alter table dashboard_shares enable row level security;
create policy share_read on dashboard_shares for select to authenticated using(member_role(company_id)='owner');
create or replace function public.create_share(p_company uuid,p_hash text,p_password text,p_label text,p_keys text[],p_expires timestamptz)returns dashboard_shares language plpgsql security definer set search_path=public as $$declare s dashboard_shares;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_expires<=now()or p_expires>now()+interval '365 days'then raise exception 'วันหมดอายุไม่ถูกต้อง';end if;
 if coalesce(array_length(p_keys,1),0)not between 1 and 50 then raise exception 'เลือก Widget อย่างน้อย 1 รายการ';end if;
 insert into dashboard_shares(company_id,token_hash,password_hash,label,widget_keys,expires_at,created_by)values(p_company,p_hash,p_password,left(coalesce(p_label,''),200),p_keys,p_expires,auth.uid())returning * into s;
 perform log_action(p_company,'share_created',s.id::text);return s;end$$;
create or replace function public.revoke_share(p_company uuid,p_id uuid)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 update dashboard_shares set revoked_at=now()where id=p_id and company_id=p_company;perform log_action(p_company,'share_revoked',p_id::text);end$$;
-- Metrics for a share (no member context): only the selected widget keys of that company.
create or replace function public.share_metrics(p_company uuid,p_keys text[])returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(m)),'[]')from(
 select t.id::text||':'||(f->>'key')as key,t.name,f->>'label'as label,f->>'type'as type,
  coalesce((select sum((i.values->>(f->>'key'))::numeric)from ingestions i where i.company_id=t.company_id and i.template->>'id'=t.id::text and i.status='approved'and jsonb_typeof(i.values->(f->>'key'))='number'),0)as total,
  (select count(*)from ingestions i where i.company_id=t.company_id and i.template->>'id'=t.id::text and i.status='approved'and jsonb_typeof(i.values->(f->>'key'))in('number','string'))as count,
  coalesce((select jsonb_object_agg(v,n)from(select i.values->>(f->>'key')v,count(*)n from ingestions i where i.company_id=t.company_id and i.template->>'id'=t.id::text and i.status='approved'and f->>'type'='choice'and jsonb_typeof(i.values->(f->>'key'))='string'group by 1)x),'{}')as buckets
 from data_templates t cross join lateral jsonb_array_elements(t.fields)f
 where t.company_id=p_company and f->>'type'in('number','choice')and t.id::text||':'||(f->>'key')=any(p_keys))m$$;
revoke all on function public.share_metrics(uuid,text[])from public,anon,authenticated;grant execute on function public.share_metrics(uuid,text[])to service_role;

-- 4) Slip verification ledger (prevents re-use of the same transfer reference).
create table public.payment_slips(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),ingestion_id uuid references ingestions(id),attachment_id uuid references attachments(id),trans_ref text not null,sending_bank text,amount numeric,expected_amount numeric,status text not null check(status in ('verified','mismatch','duplicate','unreadable')),created_at timestamptz not null default now(),unique(company_id,trans_ref));
alter table payment_slips enable row level security;
create policy slip_read on payment_slips for select to authenticated using(can_read_dept(company_id,'Finance'));

-- 5) LINE: per-group approval keywords, auto-nudge, quick stats.
alter table public.line_groups add column approve_keywords text[] not null default array['อนุมัติ','อนุมัติปล่อยของ'],add column name text not null default '',add column created_at timestamptz not null default now();
alter table public.ingestions add column nudged_at timestamptz;
create or replace function public.update_line_group(p_company uuid,p_group text,p_template uuid,p_name text,p_keywords text[])returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if not exists(select 1 from data_templates where id=p_template and company_id=p_company)then raise exception 'ไม่พบ Template';end if;
 if coalesce(array_length(p_keywords,1),0)not between 1 and 10 or exists(select 1 from unnest(p_keywords)k where length(trim(k))not between 2 and 50)then raise exception 'คีย์เวิร์ดไม่ถูกต้อง';end if;
 update line_groups set template_id=p_template,name=left(coalesce(p_name,''),100),approve_keywords=p_keywords where group_id=p_group and company_id=p_company;if not found then raise exception 'ไม่พบกลุ่ม';end if;
 perform log_action(p_company,'line_group_updated',p_group);end$$;
create or replace function public.unlink_line_group(p_company uuid,p_group text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 delete from line_groups where group_id=p_group and company_id=p_company;perform log_action(p_company,'line_group_unlinked',p_group);end$$;
-- Keyword approval: a manager types e.g. "อนุมัติปล่อยของ" → approves the latest complete item awaiting review in that group.
create or replace function public.line_keyword_approve(p_group text,p_user text,p_text text)returns uuid language plpgsql security definer set search_path=public as $$declare g line_groups;i uuid;begin
 select * into g from line_groups where group_id=p_group;if not found then return null;end if;
 if not exists(select 1 from unnest(g.approve_keywords)k where trim(p_text)=k)then return null;end if;
 select id into i from ingestions where company_id=g.company_id and group_id=p_group and status='review'and jsonb_array_length(missing)=0 order by created_at desc limit 1;
 if i is null then raise exception 'ไม่มีรายการที่พร้อมอนุมัติ';end if;
 perform line_approve(p_group,p_user,i);return i;end$$;
revoke all on function public.line_keyword_approve(text,text,text)from public,anon,authenticated;grant execute on function public.line_keyword_approve(text,text,text)to service_role;
-- Re-nudge senders whose items are still missing data after 12 hours (runs from cron).
create or replace function public.queue_nudges()returns int language plpgsql security definer set search_path=public as $$declare n int;begin
 with x as(update ingestions set nudged_at=now()where status='review'and group_id is not null and jsonb_array_length(missing)>0 and created_at<now()-interval '12 hours'and(nudged_at is null)returning *)
 insert into notification_outbox(company_id,target,body)select company_id,group_id,left('⏰ ZettaFlow เตือน: รายการ '||left(id::text,8)||' ยังขาดข้อมูล '||(select string_agg(value,', ')from jsonb_array_elements_text(missing))||chr(10)||'กรุณาส่งข้อมูลเพิ่มในกลุ่มนี้',4500)from x;
 get diagnostics n=row_count;return n;end$$;
revoke all on function public.queue_nudges()from public,anon,authenticated;grant execute on function public.queue_nudges()to service_role;
create or replace function public.complete_ingestion(p_id uuid,p_lease uuid,p_values jsonb,p_missing jsonb,p_engine text)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;k text;begin
 select * into i from ingestions where id=p_id and lease_id=p_lease and status='processing'for update;if not found then return;end if;
 update ingestions set values=p_values,missing=p_missing,engine=p_engine,status='review',lease_until=null where id=p_id;
 select approve_keywords[1]into k from line_groups where group_id=i.group_id;
 if i.group_id is not null then insert into notification_outbox(id,company_id,target,body)values(i.id,i.company_id,i.group_id,left(case when jsonb_array_length(p_missing)>0
  then '⚠️ ZettaFlow: ข้อมูลยังไม่ครบ ('||left(i.id::text,8)||')'||chr(10)||'กรุณาส่งเพิ่ม: '||(select string_agg(value,', ')from jsonb_array_elements_text(p_missing))
  else '✅ ZettaFlow: บันทึกรายการ '||left(i.id::text,8)||' แล้ว รอผู้จัดการอนุมัติ'||chr(10)||'ผู้จัดการพิมพ์ "'||coalesce(k,'อนุมัติ')||'" หรือ #approve '||i.id::text end,4500))on conflict(id)do nothing;end if;end$$;
revoke execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)from public,anon,authenticated;grant execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)to service_role;
-- Read-only numbers the bot can answer in chat (service role only).
create or replace function public.line_quick_stats(p_group text)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'company',(select name from companies where id=g.company_id),
  'review',(select count(*)from ingestions where company_id=g.company_id and status='review'),
  'missing',(select count(*)from ingestions where company_id=g.company_id and status='review'and jsonb_array_length(missing)>0),
  'pendingDeals',(select count(*)from entities where company_id=g.company_id and kind='deals'and data->>'status'='pending'and archived_at is null),
  'openTasks',(select count(*)from entities where company_id=g.company_id and kind='tasks'and coalesce(data->>'status','')<>'done'and archived_at is null),
  'activeProjects',(select count(*)from entities where company_id=g.company_id and kind='projects'and data->>'status'in('active','planning')and archived_at is null),
  'salesToday',(select coalesce(sum((data->>'amount')::numeric),0)from entities where company_id=g.company_id and kind='sales'and data->>'status'='confirmed'and archived_at is null and data->>'date'=to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD')),
  'salesMonth',(select coalesce(sum((data->>'amount')::numeric),0)from entities where company_id=g.company_id and kind='sales'and data->>'status'='confirmed'and archived_at is null and left(data->>'date',7)=to_char(now() at time zone 'Asia/Bangkok','YYYY-MM')))
 from line_groups g where g.group_id=p_group$$;
revoke all on function public.line_quick_stats(text)from public,anon,authenticated;grant execute on function public.line_quick_stats(text)to service_role;

-- Grants (match 0001 pattern: members read through RLS, writes only via RPCs; service role runs workers).
revoke all on table plans,subscriptions,billing_payments,dashboard_shares,payment_slips from anon,authenticated;
grant select on plans to anon,authenticated;
grant select on subscriptions,billing_payments,dashboard_shares,payment_slips to authenticated;
grant all on plans,subscriptions,billing_payments,dashboard_shares,payment_slips to service_role;
revoke all on function public.save_dashboard_layout(uuid,jsonb),public.request_payment(uuid,text,text,uuid,jsonb,text),public.create_share(uuid,text,text,text,text[],timestamptz),public.revoke_share(uuid,uuid),public.update_line_group(uuid,text,uuid,text,text[]),public.unlink_line_group(uuid,text),public.usage_summary(uuid),public.template_breakdowns(uuid) from public,anon;
grant execute on function public.save_dashboard_layout(uuid,jsonb),public.request_payment(uuid,text,text,uuid,jsonb,text),public.create_share(uuid,text,text,text,text[],timestamptz),public.revoke_share(uuid,uuid),public.update_line_group(uuid,text,uuid,text,text[]),public.unlink_line_group(uuid,text),public.usage_summary(uuid),public.template_breakdowns(uuid) to authenticated;
revoke all on function public.subscription_active(uuid),public.plan_limit(uuid,text),public.enforce_quota(),public.start_trial() from public,anon,authenticated;
