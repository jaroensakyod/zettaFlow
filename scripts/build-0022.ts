// Writes supabase/migrations/0022_department_modules.sql: entity schemas for the แผนก menu pages + LINE → page mapping.
import { writeFile } from "node:fs/promises";
import { modules } from "../src/lib/catalog";

const kinds = ["quotations", "sales_orders", "sales_targets", "content", "marketing_budget", "promotions", "stock_issues", "stock_counts", "bills", "recruitment", "attendance", "kpi", "event_guests", "event_budget", "venues", "software", "security", "ip_assets", "policies", "cases", "vehicles", "services"];
const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const clean = (fields: object[]) => fields.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
const schemas = kinds
  .map((k) => {
    const m = modules.find((x) => x.key === k);
    if (!m) throw Error("missing kind " + k);
    return `insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(clean(m.fields)))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;`;
  })
  .join("\n");

const sql = `-- แผนก mega menu: record types for every department shortcut (ใบเสนอราคา, SO, เบิกสินค้า, ใบวางบิล, เวลาเข้า-ออก, KPI, ยานพาหนะ …).
-- LINE groups → any page: a Data Template can name a target page; when its item is approved (web, #approve or keyword) a record is created there.

${schemas}

-- Template → page mapping (field_map: template field key → page field key; empty = same keys).
alter table public.data_templates add column target_kind text references entity_schemas(kind),add column field_map jsonb not null default '{}';
create or replace function public.set_template_target(p_company uuid,p_id uuid,p_kind text,p_map jsonb)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_kind is not null and not exists(select 1 from entity_schemas where kind=p_kind)then raise exception 'ไม่พบหน้าปลายทาง';end if;
 if jsonb_typeof(coalesce(p_map,'{}'))<>'object'or length(coalesce(p_map,'{}')::text)>5000 then raise exception 'การจับคู่ฟิลด์ไม่ถูกต้อง';end if;
 update data_templates set target_kind=p_kind,field_map=coalesce(p_map,'{}')where id=p_id and company_id=p_company;if not found then raise exception 'ไม่พบ Template';end if;
 perform log_action(p_company,'template_target',p_id::text);end$$;
revoke all on function public.set_template_target(uuid,uuid,text,jsonb)from public,anon;grant execute on function public.set_template_target(uuid,uuid,text,jsonb)to authenticated;

-- On approval: map values, fill name/status defaults, validate like a normal save and insert the record.
-- A value that does not fit the page is noted on the ingestion instead of blocking the approval.
create or replace function public.ingestion_to_entity()returns trigger language plpgsql security definer set search_path=public as $$declare t data_templates;spec entity_schemas;d jsonb:='{}';k text;ek text;st jsonb;clean jsonb;begin
 select * into t from data_templates where id=nullif(new.template->>'id','')::uuid and company_id=new.company_id;
 if t.target_kind is null then return new;end if;
 select * into spec from entity_schemas where kind=t.target_kind;
 for k in select f->>'key'from jsonb_array_elements(t.fields)f loop
  ek=coalesce(nullif(t.field_map->>k,''),k);
  if new.values ? k and new.values->k<>'null'::jsonb and exists(select 1 from jsonb_array_elements(spec.fields)s where s->>'key'=ek)then d=d||jsonb_build_object(ek,new.values->k);end if;end loop;
 -- Linked records (ลูกค้า, พนักงาน …) may arrive as a name: resolve it in this company, else drop it.
 for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='relation' loop
  if d ? (st->>'key') and (d->>(st->>'key'))!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   select id::text into k from entities where company_id=new.company_id and kind=st->>'resource' and archived_at is null and lower(data->>'name')=lower(trim(d->>(st->>'key')))limit 1;
   d=case when k is null then d-(st->>'key') else d||jsonb_build_object(st->>'key',k)end;end if;end loop;
 if coalesce(d->>'name','')=''then d=d||jsonb_build_object('name',left(t.name||' '||to_char(new.created_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'),200));end if;
 -- Required dropdowns the group did not send (status, หมวดหมู่ …) get "อื่นๆ" when offered, else the first option.
 for st in select s from jsonb_array_elements(spec.fields)s where s->>'type'='select'and(s->>'required')::boolean loop
  if not coalesce(st->'options' ? (d->>(st->>'key')),false)then d=d||jsonb_build_object(st->>'key',case when st->'options' ? 'อื่นๆ' then 'อื่นๆ' else st->'options'->>0 end);end if;end loop;
 if exists(select 1 from jsonb_array_elements(spec.fields)s where s->>'key'='date'and s->>'type'='date')and coalesce(d->>'date','')=''then d=d||jsonb_build_object('date',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'));end if;
 begin
  clean=validate_payload(t.target_kind,d,new.company_id);
  insert into entities(company_id,kind,department,data,created_by)values(new.company_id,t.target_kind,spec.department,clean||jsonb_build_object('ingestionId',new.id),auth.uid());
 exception when others then
  update ingestions set error=left('ส่งเข้า '||t.target_kind||' ไม่ได้: '||sqlerrm,500)where id=new.id;
 end;
 return new;end$$;
revoke all on function public.ingestion_to_entity()from public,anon,authenticated;
create trigger ingestions_to_entity after update of status on ingestions for each row when(new.status='approved'and old.status is distinct from 'approved')execute function ingestion_to_entity();
`;
await writeFile("supabase/migrations/0022_department_modules.sql", sql);
console.log("wrote", kinds.length, "schemas");
