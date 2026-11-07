-- ใบเสร็จรับเงิน page: every tax invoice / receipt number a company has issued, in one call (instead of one
-- document_number call per record). Finance readers only; others get no rows.
create function public.issued_documents_list(p_company uuid)returns table(kind text,entity_id uuid,number text,date text)
language sql stable security definer set search_path=public as $$
 select d.kind,d.entity_id,d.number,to_char(d.issued_at at time zone 'Asia/Bangkok','YYYY-MM-DD')
 from issued_documents d where d.company_id=p_company and can_read_dept(p_company,'Finance')
 order by d.issued_at desc$$;
revoke all on function public.issued_documents_list(uuid)from public,anon;
grant execute on function public.issued_documents_list(uuid)to authenticated;
