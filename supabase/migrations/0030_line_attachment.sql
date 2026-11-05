-- A file sent from LINE (receipt photo, slip, PDF) now follows the item when it is approved: it is linked to the new
-- record and fills the page's image field, so e.g. the expense shows its receipt instead of "ไม่มีไฟล์ใบเสร็จ".
create or replace function public.ingestion_to_entity()returns trigger language plpgsql security definer set search_path=public as $$declare t data_templates;spec entity_schemas;v_kind text;v_id uuid;fields jsonb;fmap jsonb;tname text;d jsonb:='{}';k text;ek text;st jsonb;clean jsonb;begin
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
 -- Linked records (ลูกค้า, พนักงาน …) may arrive as a name: resolve it in this company, else drop it.
 for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='relation' loop
  if d ? (st->>'key') and (d->>(st->>'key'))!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   select id::text into k from entities e where e.company_id=new.company_id and e.kind=st->>'resource' and e.archived_at is null and lower(e.data->>'name')=lower(trim(d->>(st->>'key')))limit 1;
   d=case when k is null then d-(st->>'key') else d||jsonb_build_object(st->>'key',k)end;end if;end loop;
 if coalesce(d->>'name','')=''then d=d||jsonb_build_object('name',left(tname||' '||to_char(new.created_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'),200));end if;
 -- Required dropdowns the group did not send (status, หมวดหมู่ …) get "อื่นๆ" when offered, else the first option.
 for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='select'and(s->>'required')::boolean loop
  if not coalesce(st->'options' ? (d->>(st->>'key')),false)then d=d||jsonb_build_object(st->>'key',case when st->'options' ? 'อื่นๆ' then 'อื่นๆ' else st->'options'->>0 end);end if;end loop;
 if exists(select 1 from jsonb_array_elements(spec.fields)s where s->>'key'='date'and s->>'type'='date')and coalesce(d->>'date','')=''then d=d||jsonb_build_object('date',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'));end if;
 -- A photo or PDF sent with the message becomes the record's file (e.g. ไฟล์ใบเสร็จ on ค่าใช้จ่าย).
 if new.attachment_id is not null then
  for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='image' limit 1 loop
   if coalesce(d->>(st->>'key'),'')=''then d=d||jsonb_build_object(st->>'key',new.attachment_id::text);end if;end loop;end if;
 begin
  clean=validate_payload(v_kind,d,new.company_id);
  insert into entities(company_id,kind,department,data,created_by)values(new.company_id,v_kind,spec.department,clean||jsonb_build_object('ingestionId',new.id),auth.uid())returning id into v_id;
  -- The page lists files by record and the reader's department, so the file follows the record there.
  if new.attachment_id is not null then
   update attachments set entity_id=v_id,department=spec.department where id=new.attachment_id and company_id=new.company_id and entity_id is null;end if;
 exception when others then
  update ingestions set error=left('ส่งเข้า '||v_kind||' ไม่ได้: '||sqlerrm,500)where id=new.id;
 end;
 return new;end$$;
revoke all on function public.ingestion_to_entity()from public,anon,authenticated;
-- Items approved before this fix: attach their file now.
update attachments a set entity_id=e.id,department=e.department
 from ingestions i join entities e on e.company_id=i.company_id and e.data->>'ingestionId'=i.id::text
 where a.id=i.attachment_id and a.company_id=i.company_id and a.entity_id is null and i.status='approved';
update entities e set data=e.data||jsonb_build_object('receiptId',i.attachment_id::text)
 from ingestions i where e.company_id=i.company_id and e.kind='expenses' and e.data->>'ingestionId'=i.id::text and i.attachment_id is not null and coalesce(e.data->>'receiptId','')='';
