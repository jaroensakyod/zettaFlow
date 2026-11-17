-- 0078: every company that signs up (free too) becomes a customer of EliteFlow at once: a row in the customer list of
-- EliteFlow's own workspace (eliteflowofficials@gmail.com) with the company name, the owner's name and email, when it
-- signed up and its package. platform_customers links each company to its customer record (also used when it pays).
create or replace function public.platform_company()returns uuid language sql immutable as $$select 'c6990704-26d6-4b1e-8c1c-6a5c5dff083d'::uuid$$;
create table if not exists public.platform_customers(
 company_id uuid primary key references companies(id) on delete cascade,
 customer_id uuid not null references entities(id) on delete cascade,
 created_at timestamptz not null default now());
alter table public.platform_customers enable row level security;
revoke all on public.platform_customers from anon,authenticated;

create or replace function public.add_platform_customer(p_company uuid)returns uuid language plpgsql security definer set search_path=public as $$
declare pc uuid:=platform_company();c companies;o memberships;po uuid;cid uuid;plan text;d jsonb;
begin
 if p_company is null or p_company=pc or not exists(select 1 from companies where id=pc)then return null;end if;
 select customer_id into cid from platform_customers where company_id=p_company;
 if cid is not null then return cid;end if;
 select * into c from companies where id=p_company;if not found then return null;end if;
 select * into o from memberships where company_id=p_company and role='owner'order by disabled limit 1;
 select user_id into po from memberships where company_id=pc and role='owner'and not disabled limit 1;
 select s.plan into plan from subscriptions s where s.company_id=p_company;
 d=jsonb_strip_nulls(jsonb_build_object(
  'name',c.name,'type','นิติบุคคล','status','active',
  'contact',nullif(o.name,''),'email',nullif(o.email,''),
  'taxId',nullif(c.profile->>'taxId',''),'phone',nullif(c.profile->>'phone',''),
  'notes','สมัครใช้งาน EliteFlow เมื่อ '||to_char(coalesce(c.created_at,now())at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI')||coalesce(' · แพ็กเกจ '||case plan when 'free' then 'ฟรี' else initcap(plan) end,'')));
 insert into entities(company_id,kind,department,data,created_by)
  values(pc,'customers',coalesce((select department from entity_schemas where kind='customers'),'Sales'),d,po)returning id into cid;
 insert into platform_customers(company_id,customer_id)values(p_company,cid);
 return cid;
end$$;
revoke all on function public.add_platform_customer(uuid)from public,anon,authenticated;
grant execute on function public.add_platform_customer(uuid)to service_role;

-- When a company gets its owner (sign-up), add it. Never blocks the sign-up.
create or replace function public.platform_customer_on_signup()returns trigger language plpgsql security definer set search_path=public as $$
begin
 begin perform add_platform_customer(new.company_id);exception when others then null;end;
 return new;
end$$;
drop trigger if exists memberships_platform_customer on public.memberships;
create trigger memberships_platform_customer after insert on public.memberships for each row when(new.role='owner')execute function platform_customer_on_signup();

-- Companies that signed up before this.
do $$declare r record;begin
 for r in select id from companies where id<>platform_company() order by created_at loop
  begin perform add_platform_customer(r.id);exception when others then null;end;
 end loop;
end$$;
select 'ok 0078' as result,(select count(*)from platform_customers)as customers_added;
