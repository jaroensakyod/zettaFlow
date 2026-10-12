create function public.analytics_series(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(day)order by day.date),'[]')from(
 select data->>'date'as date,coalesce(sum((data->>'amount')::numeric)filter(where kind='sales'),0)as sales,coalesce(sum((data->>'amount')::numeric)filter(where kind='expenses'),0)as expenses
 from entities where company_id=p_company and archived_at is null and can_read_dept(p_company,department)and ((kind='sales'and data->>'status'='confirmed')or(kind='expenses'and data->>'status'in('approved','paid')))group by data->>'date'order by data->>'date'desc limit 14
 )day$$;
create function public.template_metrics(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(metric)),'[]')from(
 select t.id::text||':'||(f->>'key')as key,t.name,f->>'label'as label,t.department,coalesce(sum((i.values->>(f->>'key'))::numeric)filter(where jsonb_typeof(i.values->(f->>'key'))='number'),0)as total,count(i.id)filter(where jsonb_typeof(i.values->(f->>'key'))='number')as count
 from data_templates t cross join lateral jsonb_array_elements(t.fields)f left join ingestions i on i.company_id=t.company_id and i.template->>'id'=t.id::text and i.status='approved'and can_read_dept(i.company_id,i.department)
 where t.company_id=p_company and can_read_dept(t.company_id,t.department)and f->>'type'='number'group by t.id,t.name,t.department,f
 )metric$$;
revoke execute on function analytics_series(uuid),template_metrics(uuid)from public,anon;
grant execute on function analytics_series(uuid),template_metrics(uuid)to authenticated;
