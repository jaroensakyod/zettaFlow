-- 0077: a paid package is booked automatically. When a package payment is verified, the platform company records
-- the sale (customer, invoice, payment received) and the buying company gets the expense, each saved as that
-- company's owner so every normal rule (validation, codes, invoice paid status) applies. Server (service role) only.
create or replace function public.save_entity_as(p_user uuid,p_company uuid,p_kind text,p_data jsonb)returns entities language plpgsql security definer set search_path=public as $$
declare r entities;
begin
 if not exists(select 1 from memberships where user_id=p_user and company_id=p_company)then raise exception 'ผู้ใช้ไม่ได้อยู่ในบริษัทนี้';end if;
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',p_user,'role','authenticated')::text,true);
 r=save_entity(p_company,p_kind,p_data,null,null);
 return r;
end$$;
revoke all on function public.save_entity_as(uuid,uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.save_entity_as(uuid,uuid,text,jsonb)to service_role;
-- What was booked for a payment (ids and numbers of the records and documents), so it is done once.
alter table public.billing_payments add column if not exists records jsonb;
select 'ok 0077' as result,(select count(*)from pg_proc where proname='save_entity_as')as fn,(select count(*)from information_schema.columns where table_schema='public'and table_name='billing_payments'and column_name='records')as records_column;
