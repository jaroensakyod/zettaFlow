-- A LINE item approved by a manager becomes an approved record: ค่าใช้จ่าย and ใบลา are created as
-- "อนุมัติแล้ว" instead of "รอดำเนินการ" (which read as if nobody had approved them yet).
create or replace function public.ingestion_to_entity()returns trigger language plpgsql security definer set search_path=public as $$declare t data_templates;spec entity_schemas;g line_groups;src jsonb:='{}';v_kind text;v_id uuid;fields jsonb;fmap jsonb;tname text;d jsonb:='{}';k text;ek text;st jsonb;clean jsonb;unresolved text:='';begin
 if new.target_kind is not null then
  v_kind=new.target_kind;fields=coalesce(new.template->'fields','[]');fmap='{}';tname=coalesce(nullif(new.template->>'name',''),v_kind);
 else
  select * into t from data_templates where id=nullif(new.template->>'id','')::uuid and company_id=new.company_id;
  if t.target_kind is null then return new;end if;
  v_kind=t.target_kind;fields=t.fields;fmap=t.field_map;tname=t.name;
 end if;
 select * into spec from entity_schemas s where s.kind=v_kind;
 for k in select f->>'key'from jsonb_array_elements(fields)f loop
  ek=coalesce(nullif(fmap->>k,''),k);
  if new.values ? k and new.values->k<>'null'::jsonb and exists(select 1 from jsonb_array_elements(spec.fields)s where s->>'key'=ek)then d=d||jsonb_build_object(ek,new.values->k);end if;end loop;
 for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='relation' loop
  if d ? (st->>'key') and (d->>(st->>'key'))!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   select id::text into k from entities e where e.company_id=new.company_id and e.kind=st->>'resource' and e.archived_at is null and lower(e.data->>'name')=lower(trim(d->>(st->>'key')))limit 1;
   -- Not found by name: a พนักงาน linked to the LINE member who sent it (added from an earlier LINE item).
   if k is null and st->>'resource'='employees' and new.source_user is not null then
    select id::text into k from entities e where e.company_id=new.company_id and e.kind='employees' and e.archived_at is null and e.data->>'lineUserId'=new.source_user limit 1;end if;
   if k is null then unresolved=unresolved||(st->>'label')||' “'||trim(d->>(st->>'key'))||'” ';end if;
   d=case when k is null then d-(st->>'key') else d||jsonb_build_object(st->>'key',k)end;end if;end loop;
 if coalesce(d->>'name','')=''then d=d||jsonb_build_object('name',left(tname||' '||to_char(new.created_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'),200));end if;
 for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='select'and(s->>'required')::boolean loop
  if not coalesce(st->'options' ? (d->>(st->>'key')),false)then d=d||jsonb_build_object(st->>'key',case when st->'options' ? 'อื่นๆ' then 'อื่นๆ' else st->'options'->>0 end);end if;end loop;
 -- Approved in LINE (or in the LINE box on the web) = approved: ค่าใช้จ่าย and ใบลา start as อนุมัติแล้ว, not รอดำเนินการ.
 if v_kind in('expenses','leaves')and coalesce(d->>'status','')not in('approved','paid')then d=d||jsonb_build_object('status','approved');end if;
 if exists(select 1 from jsonb_array_elements(spec.fields)s where s->>'key'='date'and s->>'type'='date')and coalesce(d->>'date','')=''then d=d||jsonb_build_object('date',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'));end if;
 if new.attachment_id is not null then
  for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='image' limit 1 loop
   if coalesce(d->>(st->>'key'),'')=''then d=d||jsonb_build_object(st->>'key',new.attachment_id::text);end if;end loop;end if;
 begin
  clean=validate_payload(v_kind,d,new.company_id);
 exception when others then
  raise exception '%',case when unresolved<>''then 'ไม่พบ '||unresolved||'ในระบบ แก้ให้ตรงกับข้อมูลที่มีก่อนอนุมัติ ('||sqlerrm||')'else 'บันทึกไม่สำเร็จ: '||sqlerrm end;
 end;
 -- Where it came from: LINE group, its department and who sent it (shown on the record as ที่มา).
 if new.group_id is not null then
  select * into g from line_groups where group_id=new.group_id;
  src=jsonb_build_object('sourceVia','LINE','sourceGroup',coalesce(nullif(g.name,''),new.group_name,''),'sourceDepartment',coalesce(g.department,''),'sourceSender',coalesce(new.sender_name,''));
 end if;
 insert into entities(company_id,kind,department,data,created_by)values(new.company_id,v_kind,spec.department,clean||jsonb_build_object('ingestionId',new.id)||src,coalesce(auth.uid(),new.decided_by))returning id into v_id;
 if new.attachment_id is not null then
  update attachments set entity_id=v_id,department=spec.department where id=new.attachment_id and company_id=new.company_id and entity_id is null;end if;
 return new;end$$;
revoke all on function public.ingestion_to_entity()from public,anon,authenticated;

-- Records already made from approved LINE items: same status now.
update entities e set data=e.data||jsonb_build_object('status','approved')
 from ingestions i where e.company_id=i.company_id and e.data->>'ingestionId'=i.id::text and i.status='approved'
 and e.kind in('expenses','leaves')and coalesce(e.data->>'status','pending')='pending';
