alter table public.ingestions add column source_user text;
create function public.retry_ingestion(p_company uuid,p_id uuid)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;begin
 select * into i from ingestions where id=p_id and company_id=p_company for update;if not found or not can_write_dept(p_company,i.department)then raise exception 'ไม่มีสิทธิ์รายการนี้';end if;if i.status<>'failed'then raise exception 'ลองใหม่ได้เฉพาะรายการที่ประมวลผลไม่สำเร็จ';end if;
 update ingestions set status='queued',attempts=0,error=null,lease_until=null,lease_id=null where id=p_id;perform log_action(p_company,'ingestion_retried',p_id::text);end$$;
revoke execute on function retry_ingestion(uuid,uuid)from public,anon;
grant execute on function retry_ingestion(uuid,uuid)to authenticated;
