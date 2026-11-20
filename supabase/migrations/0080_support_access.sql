-- 0080: หลังบ้าน › ดูในมุมมองลูกค้า (read-only). A platform admin who must help a customer opens that company for a
-- short time, with a written reason. While it lasts the admin reads the company like a member with the "viewer" role
-- in every department (member_role / can_read_dept below); the web server refuses every change during the view.
-- Every view is kept with who, why and when; the company's owners and managers see the list and can end a view.
-- Rows are written by the server (service role) after it checks the admin.
create table if not exists public.support_access(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references companies(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 admin_email text not null,
 reason text not null check(length(reason) between 5 and 300),
 started_at timestamptz not null default now(),
 expires_at timestamptz not null,
 ended_at timestamptz,
 ended_by text);
create index if not exists support_access_open on support_access(user_id,company_id) where ended_at is null;
create index if not exists support_access_company on support_access(company_id,started_at desc);
alter table public.support_access enable row level security;
revoke all on public.support_access from anon,authenticated;
grant select on public.support_access to authenticated;
grant all on public.support_access to service_role;
drop policy if exists support_access_read on public.support_access;
create policy support_access_read on public.support_access for select to authenticated using(
 exists(select 1 from memberships m where m.company_id=support_access.company_id and m.user_id=auth.uid() and not m.disabled and m.role in('owner','manager')));

-- An open view for the signed-in user on this company.
create or replace function public.support_viewer(c uuid)returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from support_access where company_id=c and user_id=auth.uid() and ended_at is null and expires_at>now())$$;
-- A member's own role wins; otherwise an open view reads as "viewer".
create or replace function public.member_role(c uuid)returns text language sql stable security definer set search_path=public as $$
 select coalesce((select role from memberships where company_id=c and user_id=auth.uid() and not disabled),
  case when support_viewer(c) then 'viewer' end)$$;
-- A view reads every department (can_write_dept stays false: member_role is 'viewer').
create or replace function public.can_read_dept(c uuid,d text)returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from memberships where company_id=c and user_id=auth.uid() and not disabled and(role='owner'or d=any(departments)))
  or support_viewer(c)$$;

-- The company's owner or a manager ends a view.
create or replace function public.end_support_access(p_id uuid)returns support_access language plpgsql security definer set search_path=public as $$
declare a support_access;
begin
 select * into a from support_access where id=p_id;
 if not found or not exists(select 1 from memberships where company_id=a.company_id and user_id=auth.uid() and not disabled and role in('owner','manager'))
  then raise exception 'เฉพาะเจ้าของหรือผู้จัดการ';end if;
 update support_access set ended_at=coalesce(ended_at,now()),ended_by=coalesce(ended_by,'ลูกค้า: '||coalesce((select email from auth.users where id=auth.uid()),''))
  where id=p_id returning * into a;
 perform log_action(a.company_id,'support_access_ended',a.admin_email);
 return a;
end$$;
revoke all on function public.end_support_access(uuid)from public,anon;
grant execute on function public.end_support_access(uuid)to authenticated;

select 'ok 0080' as result;
