-- Pick the department when creating a LINE group code: the group is paired straight into that department
-- (requests for other departments' pages are then routed from/to it without a second setup step).
alter table public.line_pairings add column if not exists department text check(department is null or length(department)<=60);

create or replace function public.pair_line_group(p_hash text,p_group text)returns void language plpgsql security definer set search_path=public as $$declare p line_pairings;begin
 select * into p from line_pairings where token_hash=p_hash and used_at is null and expires_at>now()and user_id is null for update;if not found then raise exception 'รหัสหมดอายุหรือไม่ถูกต้อง';end if;
 if exists(select 1 from line_groups where group_id=p_group and company_id<>p.company_id)then raise exception 'กลุ่มนี้เชื่อมบริษัทอื่น';end if;
 insert into line_groups(group_id,company_id,template_id,department)values(p_group,p.company_id,p.template_id,p.department)
  on conflict(group_id)do update set template_id=excluded.template_id,department=coalesce(excluded.department,line_groups.department);
 update line_pairings set used_at=now()where token_hash=p_hash;end$$;
revoke all on function public.pair_line_group(text,text)from public,anon,authenticated;grant execute on function public.pair_line_group(text,text)to service_role;

-- ที่มา of every record that came from LINE: which group, which department, who sent it.
alter table public.ingestions add column if not exists sender_name text;
alter table public.ingestions add column if not exists group_name text;
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

-- Records already made from LINE get their ที่มา now (sender names arrive with new messages).
update entities e set data=e.data||jsonb_build_object('sourceVia','LINE','sourceGroup',coalesce(nullif(g.name,''),i.group_name,''),'sourceDepartment',coalesce(g.department,''),'sourceSender',coalesce(i.sender_name,''))
 from ingestions i left join line_groups g on g.group_id=i.group_id
 where e.company_id=i.company_id and e.data->>'ingestionId'=i.id::text and i.group_id is not null and not e.data ? 'sourceVia';

-- Editing a record on the web re-validates its data against the page fields, which would drop these
-- system keys; keep them from the stored record whenever the new data does not carry them.
create or replace function public.keep_source_keys()returns trigger language plpgsql set search_path=public as $$begin
 new.data=coalesce((select jsonb_object_agg(k,old.data->k)from unnest(array['ingestionId','sourceVia','sourceGroup','sourceDepartment','sourceSender'])k where old.data ? k and not new.data ? k),'{}')||new.data;
 return new;end$$;
drop trigger if exists entities_keep_source on entities;
create trigger entities_keep_source before update of data on entities for each row execute function keep_source_keys();
