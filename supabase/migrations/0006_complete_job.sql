create function public.complete_ingestion(p_id uuid,p_lease uuid,p_values jsonb,p_missing jsonb,p_engine text)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;begin
 select * into i from ingestions where id=p_id and lease_id=p_lease and status='processing'for update;if not found then return;end if;
 update ingestions set values=p_values,missing=p_missing,engine=p_engine,status='review',lease_until=null where id=p_id;
 if i.group_id is not null then insert into notification_outbox(id,company_id,target,body)values(i.id,i.company_id,i.group_id,left('EliteFlow: รายการ '||i.id::text||chr(10)||case when jsonb_array_length(p_missing)>0 then 'ข้อมูลที่ขาด: '||(select string_agg(value,', ')from jsonb_array_elements_text(p_missing))else 'พร้อมตรวจทานในเว็บ หรือ #approve '||i.id::text end,4500))on conflict(id)do nothing;end if;end$$;
revoke execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)from public,anon,authenticated;
grant execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)to service_role;
