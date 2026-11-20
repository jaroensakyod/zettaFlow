-- 0079: Admin console › แพ็กเกจและสิทธิ์. A platform admin can give a company a package for a set time (trial, gift,
-- partner, compensation, paid outside the system). Every grant is kept with who gave it, why, and the subscription it
-- replaced, so it can be revoked (the company goes back to what it had) and audited later. Service role only.
create table if not exists public.plan_grants(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references companies(id) on delete cascade,
 plan text not null references plans(id),
 kind text not null check(kind in('trial','gift','partner','compensation','offline')),
 days int not null check(days between 1 and 3660),
 extra_users int not null default 0 check(extra_users between 0 and 1000),
 reason text not null check(length(reason) between 1 and 500),
 starts_at timestamptz not null default now(),
 ends_at timestamptz not null,
 prev jsonb not null default '{}',
 granted_by text not null,
 revoked_at timestamptz,
 revoked_by text,
 created_at timestamptz not null default now());
create index if not exists plan_grants_company on plan_grants(company_id,created_at desc);
create index if not exists plan_grants_recent on plan_grants(created_at desc);
alter table public.plan_grants enable row level security;
revoke all on public.plan_grants from anon,authenticated;
grant all on public.plan_grants to service_role;

-- Give a package: the subscription becomes that plan, active until now + days (or extended from the current end when
-- it is the same plan still running). The replaced subscription is stored on the grant.
create or replace function public.admin_grant_plan(p_company uuid,p_plan text,p_kind text,p_days int,p_extra_users int,p_reason text,p_by text)
returns plan_grants language plpgsql security definer set search_path=public as $$
declare s subscriptions;g plan_grants;base timestamptz:=now();ends timestamptz;
begin
 if not exists(select 1 from companies where id=p_company)then raise exception 'ไม่พบบริษัท';end if;
 if p_plan='free' or not exists(select 1 from plans where id=p_plan)then raise exception 'แพ็กเกจไม่ถูกต้อง';end if;
 insert into subscriptions(company_id)values(p_company)on conflict(company_id)do nothing;
 select * into s from subscriptions where company_id=p_company for update;
 if s.plan=p_plan and s.status='active' and s.current_period_end>now() then base:=s.current_period_end;end if;
 ends:=base+make_interval(days=>p_days);
 insert into plan_grants(company_id,plan,kind,days,extra_users,reason,starts_at,ends_at,prev,granted_by)
  values(p_company,p_plan,p_kind,p_days,coalesce(p_extra_users,0),p_reason,now(),ends,to_jsonb(s),p_by)returning * into g;
 update subscriptions set plan=p_plan,status='active',current_period_end=ends,
  extra_users=greatest(extra_users,coalesce(p_extra_users,0)),updated_at=now() where company_id=p_company;
 insert into audit_events(company_id,action,target)values(p_company,'admin_grant_plan',p_plan||' '||p_days||'d by '||p_by);
 return g;
end$$;

-- Take a grant back: the company returns to the subscription it had before (if nothing newer replaced it since).
create or replace function public.admin_revoke_grant(p_id uuid,p_by text)returns plan_grants language plpgsql security definer set search_path=public as $$
declare g plan_grants;p jsonb;
begin
 select * into g from plan_grants where id=p_id for update;
 if not found or g.revoked_at is not null then raise exception 'สิทธิ์นี้ถูกยกเลิกไปแล้ว';end if;
 if exists(select 1 from plan_grants where company_id=g.company_id and created_at>g.created_at and revoked_at is null)then
  raise exception 'มีการมอบแพ็กเกจที่ใหม่กว่านี้ ยกเลิกรายการล่าสุดก่อน';end if;
 p:=g.prev;
 update subscriptions set plan=coalesce(p->>'plan','free'),status=coalesce(p->>'status','active'),
  current_period_end=nullif(p->>'current_period_end','')::timestamptz,extra_users=coalesce((p->>'extra_users')::int,0),updated_at=now()
  where company_id=g.company_id;
 update plan_grants set revoked_at=now(),revoked_by=p_by where id=p_id returning * into g;
 insert into audit_events(company_id,action,target)values(g.company_id,'admin_revoke_grant',g.plan||' by '||p_by);
 return g;
end$$;
revoke all on function public.admin_grant_plan(uuid,text,text,int,int,text,text)from public,anon,authenticated;
revoke all on function public.admin_revoke_grant(uuid,text)from public,anon,authenticated;
grant execute on function public.admin_grant_plan(uuid,text,text,int,int,text,text)to service_role;
grant execute on function public.admin_revoke_grant(uuid,text)to service_role;
