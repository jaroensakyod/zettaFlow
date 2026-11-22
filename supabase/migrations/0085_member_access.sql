-- 0085: Per-employee access per system (สิทธิ์การใช้งาน), set by the owner from the employee page.
--   Three levels per department: ล็อก (in neither list), ดู (read_departments: read only), ใช้งาน (departments: read + write).
--   Approval stays the role (manager = อนุมัติได้). read_departments never grants writes.
alter table public.memberships add column if not exists read_departments text[] not null default '{}';

-- The departments the app knows (src/lib/catalog.ts departmentNames).
create or replace function public.department_names()returns text[] language sql immutable set search_path=public as $$
 select array['Operations','Business Development','Design','Purchasing','Warehouse','Sales','Finance','Marketing','HR','IT',
  'Customer Service','Legal','Data','Event','Admin']$$;

-- A list without blanks or repeats, first-seen order kept (departments[1] is a member's own department elsewhere).
create or replace function public.dept_list(a text[])returns text[] language sql immutable set search_path=public as $$
 select coalesce(array(select x from unnest(coalesce(a,'{}'))with ordinality t(x,i) where nullif(trim(x),'')is not null group by x order by min(i)),'{}')$$;

-- Read: the owner, a department in either list, or an open support view.
create or replace function public.can_read_dept(c uuid,d text)returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from memberships where company_id=c and user_id=auth.uid() and not disabled
   and(role='owner'or d=any(departments)or d=any(read_departments)))
  or support_viewer(c)$$;
-- Write: the owner or a ใช้งาน department, never a viewer (read_departments do not count).
create or replace function public.can_write_dept(c uuid,d text)returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from memberships where company_id=c and user_id=auth.uid() and not disabled
   and role<>'viewer' and(role='owner'or d=any(departments)))$$;

-- The owner sets a member's role and per-department level in one go.
create or replace function public.set_member_access(p_company uuid,p_member uuid,p_role text,p_departments text[],p_read_departments text[])
returns memberships language plpgsql security definer set search_path=public as $$
declare w text[];r text[];m memberships;
begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_role is null or p_role not in('manager','staff','viewer')then raise exception 'บทบาทไม่ถูกต้อง';end if;
 w:=dept_list(p_departments);
 -- A department in both lists gets the higher level (ใช้งาน).
 r:=array(select x from unnest(dept_list(p_read_departments))with ordinality t(x,i) where not x=any(w) order by i);
 if exists(select 1 from unnest(w||r)x where not x=any(department_names()))then raise exception 'ไม่รู้จักแผนกนี้';end if;
 if cardinality(w)+cardinality(r)=0 then raise exception 'เลือกอย่างน้อย 1 ระบบที่ดูหรือใช้งานได้';end if;
 select * into m from memberships where id=p_member and company_id=p_company for update;
 if not found then raise exception 'ไม่พบสมาชิก';end if;
 if m.role='owner'then raise exception 'เจ้าของบริษัทใช้ได้ทุกระบบ แก้ไขสิทธิ์ไม่ได้';end if;
 update memberships set role=p_role,departments=w,read_departments=r where id=m.id returning * into m;
 perform log_action(p_company,'member_access_updated',p_member::text);
 return m;
end$$;
revoke all on function public.set_member_access(uuid,uuid,text,text[],text[])from public,anon;
grant execute on function public.set_member_access(uuid,uuid,text,text[],text[])to authenticated;

-- edit_member (ตั้งค่า → ทีม) gains p_read_departments; left out (null) it keeps the member's ดู departments.
drop function if exists public.edit_member(uuid,uuid,text,text[],boolean);
create function public.edit_member(p_company uuid,p_id uuid,p_role text,p_departments text[],p_disabled boolean,p_read_departments text[] default null)
returns void language plpgsql security definer set search_path=public as $$
declare w text[];r text[];m memberships;
begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_role is null or p_role not in('manager','staff','viewer')then raise exception 'บทบาทหรือแผนกไม่ถูกต้อง';end if;
 select * into m from memberships where id=p_id and company_id=p_company and role<>'owner'for update;
 if not found then raise exception 'ไม่พบสมาชิกที่แก้ไขได้';end if;
 w:=dept_list(p_departments);
 r:=array(select x from unnest(dept_list(coalesce(p_read_departments,m.read_departments)))with ordinality t(x,i) where not x=any(w) order by i);
 if cardinality(w)+cardinality(r)=0 then raise exception 'บทบาทหรือแผนกไม่ถูกต้อง';end if;
 if exists(select 1 from unnest(w||r)x where not x=any(department_names()))then raise exception 'ไม่รู้จักแผนกนี้';end if;
 update memberships set role=p_role,departments=w,read_departments=r,disabled=coalesce(p_disabled,false)where id=m.id;
 perform log_action(p_company,'member_updated',p_id::text);
end$$;
revoke all on function public.edit_member(uuid,uuid,text,text[],boolean,text[])from public,anon;
grant execute on function public.edit_member(uuid,uuid,text,text[],boolean,text[])to authenticated;

select 'ok 0085' as result;
