-- LINE groups without a template: AI reads each message, skips small talk and files the rest on the right page
-- (งาน, ค่าใช้จ่าย, การลา, เบิกสินค้า …). A group with a template keeps working exactly as before.

alter table public.line_groups alter column template_id drop not null;
-- The page an AI-sorted item goes to; null means "use the template's target page" (older behaviour).
alter table public.ingestions add column if not exists target_kind text references entity_schemas(kind);
alter table public.ingestions drop constraint if exists ingestions_status_check;
alter table public.ingestions add constraint ingestions_status_check check(status in ('queued','processing','review','approved','rejected','failed','skipped'));

-- Group codes are the pairings without a user; the template is optional now.
create or replace function public.pair_line_group(p_hash text,p_group text)returns void language plpgsql security definer set search_path=public as $$declare p line_pairings;begin
 select * into p from line_pairings where token_hash=p_hash and used_at is null and expires_at>now()and user_id is null for update;if not found then raise exception 'รหัสหมดอายุหรือไม่ถูกต้อง';end if;
 if exists(select 1 from line_groups where group_id=p_group and company_id<>p.company_id)then raise exception 'กลุ่มนี้เชื่อมบริษัทอื่น';end if;
 insert into line_groups(group_id,company_id,template_id)values(p_group,p.company_id,p.template_id)on conflict(group_id)do update set template_id=excluded.template_id;update line_pairings set used_at=now()where token_hash=p_hash;end$$;

create or replace function public.update_line_group(p_company uuid,p_group text,p_template uuid,p_name text,p_keywords text[])returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_template is not null and not exists(select 1 from data_templates where id=p_template and company_id=p_company)then raise exception 'ไม่พบ Template';end if;
 if coalesce(array_length(p_keywords,1),0)not between 1 and 10 or exists(select 1 from unnest(p_keywords)k where length(trim(k))not between 2 and 50)then raise exception 'คีย์เวิร์ดไม่ถูกต้อง';end if;
 update line_groups set template_id=p_template,name=left(coalesce(p_name,''),100),approve_keywords=p_keywords where group_id=p_group and company_id=p_company;if not found then raise exception 'ไม่พบกลุ่ม';end if;
 perform log_action(p_company,'line_group_updated',p_group);end$$;

-- Worker result for a sorted message. No page = small talk: kept as "skipped", nothing to review, nothing pushed to the group.
create or replace function public.complete_sorted_ingestion(p_id uuid,p_lease uuid,p_kind text,p_template jsonb,p_values jsonb,p_missing jsonb,p_engine text)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;spec entity_schemas;begin
 select * into i from ingestions where id=p_id and lease_id=p_lease and status='processing'for update;if not found then return;end if;
 if p_kind is null then
  update ingestions set status='skipped',values=coalesce(p_values,'{}'),missing='[]',engine=p_engine,lease_until=null where id=p_id;return;end if;
 select * into spec from entity_schemas where kind=p_kind;if not found then raise exception 'ไม่พบหน้าปลายทาง';end if;
 if jsonb_typeof(p_template->'fields')<>'array'then raise exception 'ฟอร์มไม่ถูกต้อง';end if;
 update ingestions set target_kind=p_kind,department=spec.department,template=p_template where id=p_id;
 perform complete_ingestion(p_id,p_lease,p_values,p_missing,p_engine);end$$;
revoke all on function public.complete_sorted_ingestion(uuid,uuid,text,jsonb,jsonb,jsonb,text)from public,anon,authenticated;
grant execute on function public.complete_sorted_ingestion(uuid,uuid,text,jsonb,jsonb,jsonb,text)to service_role;

-- On approval: the item's own page wins (AI-sorted, keys already match the page); otherwise the template's target page.
create or replace function public.ingestion_to_entity()returns trigger language plpgsql security definer set search_path=public as $$declare t data_templates;spec entity_schemas;v_kind text;fields jsonb;fmap jsonb;tname text;d jsonb:='{}';k text;ek text;st jsonb;clean jsonb;begin
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
 begin
  clean=validate_payload(v_kind,d,new.company_id);
  insert into entities(company_id,kind,department,data,created_by)values(new.company_id,v_kind,spec.department,clean||jsonb_build_object('ingestionId',new.id),auth.uid());
 exception when others then
  update ingestions set error=left('ส่งเข้า '||v_kind||' ไม่ได้: '||sqlerrm,500)where id=new.id;
 end;
 return new;end$$;
revoke all on function public.ingestion_to_entity()from public,anon,authenticated;
