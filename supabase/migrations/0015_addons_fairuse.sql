-- Add-ons as purchasable entitlements, Enterprise fair use, AI usage metering, free LINE replies.

-- Enterprise is no longer literally unlimited: 20,000 documents/month fair use, then overage.
update plans set documents=20000 where id='enterprise';

create table public.addons(id text primary key,name text not null,monthly numeric not null check(monthly>=0),per_unit boolean not null default false,ordinal int not null);
insert into addons values
 ('ocr_plus','AI OCR Plus',599,false,1),
 ('exec_dashboard','Executive Dashboard + AI Insight',990,false,2),
 ('extra_user','Additional Dashboard User',150,true,3),
 ('erp','ERP / Accounting Integration',1000,false,4),
 ('custom_workflow','AI Custom Workflow',3000,false,5),
 ('custom_form','AI Custom Form Designer',2500,false,6);
alter table addons enable row level security;
create policy addons_read on addons for select to anon,authenticated using(true);
revoke all on addons from anon,authenticated;grant select on addons to anon,authenticated;grant all on addons to service_role;

alter table billing_payments add column addons text[] not null default '{}',add column extra_users int not null default 0 check(extra_users between 0 and 1000);

drop function if exists public.request_payment(uuid,text,text,uuid,jsonb,text);
create function public.request_payment(p_company uuid,p_plan text,p_cycle text,p_attachment uuid,p_slip jsonb,p_ref text,p_addons text[] default '{}',p_extra_users int default 0)returns billing_payments language plpgsql security definer set search_path=public as $$declare p plans;b billing_payments;base numeric;extra numeric;months int;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 select * into p from plans where id=p_plan;if not found or p_cycle not in ('monthly','yearly')then raise exception 'แพ็กเกจไม่ถูกต้อง';end if;
 if exists(select 1 from unnest(coalesce(p_addons,'{}'))a where a not in(select id from addons where not per_unit))then raise exception 'Add-on ไม่ถูกต้อง';end if;
 if coalesce(p_extra_users,0)not between 0 and 1000 then raise exception 'จำนวนผู้ใช้เพิ่มไม่ถูกต้อง';end if;
 if p_ref is not null and exists(select 1 from billing_payments where slip_ref=p_ref)then raise exception 'สลิปนี้ถูกใช้แล้ว';end if;
 months=case when p_cycle='yearly'then 10 else 1 end; -- yearly = 2 months free, add-ons included
 base=case when p_cycle='yearly'then p.yearly else p.monthly end;
 extra=coalesce((select sum(monthly)from addons where id=any(p_addons)),0)*months+(select monthly from addons where id='extra_user')*coalesce(p_extra_users,0)*months;
 insert into billing_payments(company_id,plan,cycle,amount,attachment_id,slip,slip_ref,created_by,addons,extra_users)values(p_company,p_plan,p_cycle,round((base+extra)*1.07,2),p_attachment,coalesce(p_slip,'{}'),p_ref,auth.uid(),coalesce(p_addons,'{}'),coalesce(p_extra_users,0))returning * into b;
 perform log_action(p_company,'payment_requested',b.id::text);return b;end$$;
revoke all on function public.request_payment(uuid,text,text,uuid,jsonb,text,text[],int)from public,anon;grant execute on function public.request_payment(uuid,text,text,uuid,jsonb,text,text[],int)to authenticated;

create or replace function public.confirm_payment(p_id uuid,p_status text,p_note text default null)returns void language plpgsql security definer set search_path=public as $$declare b billing_payments;begin
 select * into b from billing_payments where id=p_id for update;if not found or b.status<>'pending'or p_status not in ('verified','rejected')then raise exception 'รายการไม่ถูกต้อง';end if;
 update billing_payments set status=p_status,note=p_note,decided_at=now()where id=p_id;
 if p_status='verified'then update subscriptions set plan=b.plan,cycle=b.cycle,status='active',addons=b.addons,extra_users=b.extra_users,current_period_end=greatest(coalesce(current_period_end,now()),now())+case when b.cycle='yearly'then interval '1 year' else interval '1 month' end,updated_at=now()where company_id=b.company_id;end if;end$$;
revoke all on function public.confirm_payment(uuid,text,text)from public,anon,authenticated;grant execute on function public.confirm_payment(uuid,text,text)to service_role;

-- Entitlement check usable from SQL and the server. Trial and Enterprise include the AI add-ons.
create or replace function public.has_addon(c uuid,a text)returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select s.status='trial'or s.plan='enterprise'and a in('ocr_plus','exec_dashboard')or a=any(s.addons)from subscriptions s where s.company_id=c),false)$$;
revoke all on function public.has_addon(uuid,text)from public,anon;grant execute on function public.has_addon(uuid,text)to authenticated,service_role;

-- Metering: images = OCR, PDFs = AI document analysis (pages counted on the server).
alter table public.ingestions add column pages int,add column reply_token text;
create or replace function public.usage_summary(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select case when member_role(p_company)is null then null else jsonb_build_object(
  'subscription',(select to_jsonb(s)from subscriptions s where company_id=p_company),
  'plan',(select to_jsonb(p)from plans p join subscriptions s on s.plan=p.id where s.company_id=p_company),
  'active',subscription_active(p_company),
  'usage',jsonb_build_object(
   'workflows',(select count(*)from data_templates where company_id=p_company),
   'documents',(select count(*)from ingestions where company_id=p_company and created_at>=date_trunc('month',now())),
   'ocr',(select count(*)from ingestions i join attachments a on a.id=i.attachment_id where i.company_id=p_company and a.mime like 'image/%'and i.created_at>=date_trunc('month',now())),
   'ai_runs',(select count(*)from ingestions i join attachments a on a.id=i.attachment_id where i.company_id=p_company and a.mime='application/pdf'and i.created_at>=date_trunc('month',now())),
   'pages',(select coalesce(sum(pages),0)from ingestions where company_id=p_company and created_at>=date_trunc('month',now())),
   'line_groups',(select count(*)from line_groups where company_id=p_company),
   'users',(select count(*)from memberships where company_id=p_company and not disabled)),
  'limits',jsonb_build_object('workflows',plan_limit(p_company,'workflows'),'documents',plan_limit(p_company,'documents'),'line_groups',plan_limit(p_company,'line_groups'),'users',plan_limit(p_company,'users'))) end$$;
