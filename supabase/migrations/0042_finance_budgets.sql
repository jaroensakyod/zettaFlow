-- Financial Center (การเงินองค์กร): yearly budget per department (+ 'Reserve' = เงินสำรององค์กร), yearly targets,
-- and the 5-step year-end closing checklist. Finance readers see them; owners / managers with Finance access change them via RPCs.

create table public.finance_budgets(company_id uuid not null references companies(id),fiscal_year int not null check(fiscal_year between 2000 and 2200),department text not null check(length(department)between 1 and 60),amount numeric not null check(amount>=0 and amount<=1e12),updated_by uuid,updated_at timestamptz not null default now(),primary key(company_id,fiscal_year,department));
create table public.finance_targets(company_id uuid not null references companies(id),fiscal_year int not null check(fiscal_year between 2000 and 2200),revenue numeric check(revenue between 0 and 1e12),profit numeric check(abs(profit)<=1e12),expense_cap numeric check(expense_cap between 0 and 1e12),updated_by uuid,updated_at timestamptz not null default now(),primary key(company_id,fiscal_year));
create table public.finance_closing(company_id uuid not null references companies(id),fiscal_year int not null check(fiscal_year between 2000 and 2200),step int not null check(step between 1 and 5),done_at timestamptz not null default now(),done_by uuid,primary key(company_id,fiscal_year,step));

alter table finance_budgets enable row level security;alter table finance_targets enable row level security;alter table finance_closing enable row level security;
create policy finance_budgets_read on finance_budgets for select to authenticated using(can_read_dept(company_id,'Finance'));
create policy finance_targets_read on finance_targets for select to authenticated using(can_read_dept(company_id,'Finance'));
create policy finance_closing_read on finance_closing for select to authenticated using(can_read_dept(company_id,'Finance'));
revoke all on finance_budgets,finance_targets,finance_closing from anon,authenticated;
grant select on finance_budgets,finance_targets,finance_closing to authenticated;
grant all on finance_budgets,finance_targets,finance_closing to service_role;

-- Who may plan budgets and close the year: owner, or a manager who has the Finance department.
create function public.finance_manager(c uuid)returns boolean language sql stable security definer set search_path=public as $$select coalesce(member_role(c)in('owner','manager'),false)and can_read_dept(c,'Finance')$$;
revoke all on function public.finance_manager(uuid)from public,anon;grant execute on function public.finance_manager(uuid)to authenticated;

-- Replaces the year's budget: p_budgets = {"Sales":200000,"Reserve":100000,...}; departments left out are removed.
create function public.finance_save_budgets(p_company uuid,p_year int,p_budgets jsonb)returns void language plpgsql security definer set search_path=public as $$begin
 if not finance_manager(p_company)then raise exception 'ไม่มีสิทธิ์วางแผนงบประมาณ';end if;
 if p_year not between 2000 and 2200 then raise exception 'ปีบัญชีไม่ถูกต้อง';end if;
 if jsonb_typeof(p_budgets)<>'object'or (select count(*)from jsonb_object_keys(p_budgets))>40
  or exists(select 1 from jsonb_each(p_budgets)x where length(x.key)not between 1 and 60 or jsonb_typeof(x.value)<>'number'or (x.value#>>'{}')::numeric not between 0 and 1e12)then raise exception 'งบประมาณไม่ถูกต้อง';end if;
 delete from finance_budgets where company_id=p_company and fiscal_year=p_year and not p_budgets ? department;
 insert into finance_budgets(company_id,fiscal_year,department,amount,updated_by)select p_company,p_year,x.key,(x.value#>>'{}')::numeric,auth.uid()from jsonb_each(p_budgets)x
  on conflict(company_id,fiscal_year,department)do update set amount=excluded.amount,updated_by=excluded.updated_by,updated_at=now();
 perform log_action(p_company,'finance_budgets_saved',p_year::text);end$$;
revoke all on function public.finance_save_budgets(uuid,int,jsonb)from public,anon;grant execute on function public.finance_save_budgets(uuid,int,jsonb)to authenticated;

-- Yearly targets; a null clears that target.
create function public.finance_save_targets(p_company uuid,p_year int,p_revenue numeric,p_profit numeric,p_expense_cap numeric)returns void language plpgsql security definer set search_path=public as $$begin
 if not finance_manager(p_company)then raise exception 'ไม่มีสิทธิ์วางแผนงบประมาณ';end if;
 if p_year not between 2000 and 2200 then raise exception 'ปีบัญชีไม่ถูกต้อง';end if;
 insert into finance_targets(company_id,fiscal_year,revenue,profit,expense_cap,updated_by)values(p_company,p_year,p_revenue,p_profit,p_expense_cap,auth.uid())
  on conflict(company_id,fiscal_year)do update set revenue=excluded.revenue,profit=excluded.profit,expense_cap=excluded.expense_cap,updated_by=excluded.updated_by,updated_at=now();
 perform log_action(p_company,'finance_targets_saved',p_year::text);end$$;
revoke all on function public.finance_save_targets(uuid,int,numeric,numeric,numeric)from public,anon;grant execute on function public.finance_save_targets(uuid,int,numeric,numeric,numeric)to authenticated;

-- Marks a closing step done (in order: the previous step must be done) or reopens it (only while the next step is still open).
create function public.finance_close_step(p_company uuid,p_year int,p_step int,p_done boolean)returns void language plpgsql security definer set search_path=public as $$begin
 if not finance_manager(p_company)then raise exception 'ไม่มีสิทธิ์ปิดงบประจำปี';end if;
 if p_year not between 2000 and 2200 or p_step not between 1 and 5 then raise exception 'ขั้นตอนไม่ถูกต้อง';end if;
 if p_done then
  if p_step>1 and not exists(select 1 from finance_closing where company_id=p_company and fiscal_year=p_year and step=p_step-1)then raise exception 'ต้องทำขั้นตอนก่อนหน้าให้เสร็จก่อน';end if;
  insert into finance_closing(company_id,fiscal_year,step,done_by)values(p_company,p_year,p_step,auth.uid())on conflict do nothing;
 else
  if exists(select 1 from finance_closing where company_id=p_company and fiscal_year=p_year and step=p_step+1)then raise exception 'ต้องเปิดขั้นตอนถัดไปก่อน';end if;
  delete from finance_closing where company_id=p_company and fiscal_year=p_year and step=p_step;end if;
 perform log_action(p_company,case when p_done then 'finance_step_done'else 'finance_step_reopened'end,p_year||'/'||p_step);end$$;
revoke all on function public.finance_close_step(uuid,int,int,boolean)from public,anon;grant execute on function public.finance_close_step(uuid,int,int,boolean)to authenticated;
