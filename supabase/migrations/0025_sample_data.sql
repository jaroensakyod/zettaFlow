-- ข้อมูลตัวอย่าง: an owner can fill a real company with the demo company (src/lib/demo-company.ts) to try every page
-- and น้องโฟลว์, then archive it all in one click. Rows go through validate_payload and the normal entity triggers
-- (running numbers, stored totals, stock moves); their ids are kept in companies.settings.sample_ids.

create or replace function public.load_sample_data(p_company uuid,p_rows jsonb)returns int language plpgsql security definer set search_path=public as $$
declare r jsonb;clean jsonb;d text;n int:=0;ids jsonb:='[]';begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if jsonb_typeof(p_rows)<>'array'or jsonb_array_length(p_rows)not between 1 and 2000 then raise exception 'ข้อมูลตัวอย่างไม่ถูกต้อง';end if;
 if jsonb_array_length(coalesce((select settings->'sample_ids'from companies where id=p_company),'[]'))>0 then raise exception 'ใส่ข้อมูลตัวอย่างไว้แล้ว ลบของเดิมก่อน';end if;
 -- Rows are ordered so a record only points at records inserted before it.
 for r in select value from jsonb_array_elements(p_rows)loop
  clean=validate_payload(r->>'kind',r->'data',p_company);
  select department into d from entity_schemas where kind=r->>'kind';
  if r->>'kind'in('tasks','documents')then d=coalesce(clean->>'department','Operations');end if;
  if r->>'kind'='tickets'and clean->>'type'='IT'then d='IT';end if;
  if r->>'kind'='products'then clean=clean||jsonb_build_object('stock',greatest(0,coalesce((r->>'stock')::numeric,0)));end if;
  if r->>'kind'='invoices'then clean=clean||jsonb_build_object('total',round((clean->>'subtotal')::numeric*(1+coalesce((clean->>'vat')::numeric,0)/100),2),'paid',greatest(0,coalesce((r->>'paid')::numeric,0)),'status',coalesce(r->>'status','issued'));end if;
  if r->>'kind'='payroll'then clean=clean||jsonb_build_object('net',(clean->>'base')::numeric+coalesce((clean->>'allowance')::numeric,0)-coalesce((clean->>'deduction')::numeric,0));end if;
  if r->>'kind'='purchases'then clean=clean||jsonb_build_object('total',(clean->>'quantity')::numeric*(clean->>'unitCost')::numeric,'status',coalesce(r->>'status','draft'));end if;
  insert into entities(id,company_id,kind,department,data,created_by)values((r->>'id')::uuid,p_company,r->>'kind',d,clean,auth.uid());
  ids=ids||to_jsonb(r->>'id');n=n+1;end loop;
 update companies set settings=settings||jsonb_build_object('sample_ids',ids)where id=p_company;
 perform log_action(p_company,'sample_data_loaded',n::text);return n;end$$;

create or replace function public.clear_sample_data(p_company uuid)returns int language plpgsql security definer set search_path=public as $$
declare n int;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 update entities set archived_at=now(),updated_at=now()where company_id=p_company and archived_at is null
  and id in(select (value#>>'{}')::uuid from jsonb_array_elements(coalesce((select settings->'sample_ids'from companies where id=p_company),'[]')));
 get diagnostics n=row_count;
 update companies set settings=settings-'sample_ids'where id=p_company;
 perform log_action(p_company,'sample_data_cleared',n::text);return n;end$$;

revoke all on function public.load_sample_data(uuid,jsonb),public.clear_sample_data(uuid)from public,anon;
grant execute on function public.load_sample_data(uuid,jsonb),public.clear_sample_data(uuid)to authenticated;
