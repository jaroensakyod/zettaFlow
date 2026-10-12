create function public.calendar_entries(p_company uuid,p_month text)returns setof entities language plpgsql security definer set search_path=public as $$begin
 if p_month!~ '^\d{4}-(0[1-9]|1[0-2])$'or member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์หรือเดือนไม่ถูกต้อง';end if;
 return query select * from entities where company_id=p_company and archived_at is null and kind in ('tasks','events','deals','projects')and can_read_dept(p_company,department)and(left(data->>'startDate',7)=p_month or left(data->>'dueDate',7)=p_month or left(data->>'date',7)=p_month)order by updated_at desc;end$$;
revoke execute on function calendar_entries(uuid,text)from public,anon;
grant execute on function calendar_entries(uuid,text)to authenticated;
