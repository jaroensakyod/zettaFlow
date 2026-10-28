// Writes supabase/migrations/0023_department_rules.sql (mirrors src/lib/dept-rules.ts).
import { writeFile } from "node:fs/promises";
import { modules } from "../src/lib/catalog";
import { approvalStatuses } from "../src/lib/dept-rules";
import { codePrefixes } from "../src/lib/domain";

const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const clean = (fields: object[]) => fields.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
const schemas = ["quotations", "sales_orders", "bills", "stock_issues"]
  .map((k) => {
    const m = modules.find((x) => x.key === k)!;
    return `insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(clean(m.fields)))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;`;
  })
  .join("\n");
const prefixCase = "case p_kind " + Object.entries(codePrefixes).map(([k, p]) => `when '${k}'then '${p}'`).join("") + " end";

const sql = `-- แผนก page rules: running numbers (QT/SO/AP/WD), stored totals, Owner/Manager approval, and real stock moves
-- for เบิกสินค้า ("จ่ายของแล้ว") and ตรวจนับ ("ปรับยอดแล้ว"). Mirrors src/lib/dept-rules.ts.

${schemas}

-- Running numbers for the new documents (same counter table as customers / suppliers).
create or replace function public.code_prefix(p_kind text)returns text language sql immutable as $$select ${prefixCase}$$;
create or replace function public.assign_entity_code()returns trigger language plpgsql security definer set search_path=public as $$declare p text;y int;begin
 p=code_prefix(new.kind);
 if p is null or coalesce(new.data->>'code','')<>''then return new;end if;
 if tg_op='UPDATE'and coalesce(old.data->>'code','')<>''then new.data=new.data||jsonb_build_object('code',old.data->>'code');return new;end if;
 y=thai_year();new.data=new.data||jsonb_build_object('code',p||'-'||lpad(y::text,2,'0')||'-'||lpad(next_number(new.company_id,p,0)::text,4,'0'));return new;end$$;
create or replace function public.peek_code(p_company uuid,p_kind text)returns text language plpgsql stable security definer set search_path=public as $$declare p text;n int;begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 p=code_prefix(p_kind);if p is null then return null;end if;
 select last+1 into n from doc_counters where company_id=p_company and prefix=p and year=0;
 return p||'-'||lpad(thai_year()::text,2,'0')||'-'||lpad(coalesce(n,1)::text,4,'0');end$$;

-- Stored figures (same formulas as the table columns).
create or replace function public.hhmm(t text)returns int language sql immutable as $$select case when t ~ '^\\d{1,2}:\\d{2}$' then split_part(t,':',1)::int*60+split_part(t,':',2)::int end$$;
create or replace function public.dept_derive(k text,d jsonb)returns jsonb language plpgsql immutable set search_path=public as $$declare sub numeric;n numeric;a numeric;begin
 n=coalesce((d->>'target')::numeric,0);
 case k
 when 'quotations','sales_orders' then
  sub=case when jsonb_typeof(d->'lines')='array'and jsonb_array_length(d->'lines')>0 then(select coalesce(sum((x->>'qty')::numeric*(x->>'price')::numeric),0)from jsonb_array_elements(d->'lines')x)else coalesce((d->>'subtotal')::numeric,0)end;
  sub=greatest(0,sub-coalesce((d->>'discount')::numeric,0));
  return jsonb_build_object('total',round(case when d->>'vatMode'='excluded'then sub*1.07 else sub end,2));
 when 'sales_targets' then return jsonb_build_object('percent',case when n=0 then 0 else round(coalesce((d->>'actual')::numeric,0)/n*100,2)end);
 when 'kpi' then return jsonb_build_object('progress',case when n=0 then 0 else round(coalesce((d->>'actual')::numeric,0)/n*100,2)end);
 when 'content' then return jsonb_build_object('rate',case when coalesce((d->>'reach')::numeric,0)=0 then 0 else round(coalesce((d->>'engagement')::numeric,0)/(d->>'reach')::numeric*100,2)end);
 when 'marketing_budget','event_budget' then return jsonb_build_object('remaining',round(coalesce((d->>'budget')::numeric,0)-coalesce((d->>'spent')::numeric,0),2));
 when 'stock_counts' then return jsonb_build_object('diff',coalesce((d->>'countedQty')::numeric,0)-coalesce((d->>'systemQty')::numeric,0));
 when 'bills' then a=coalesce((d->>'amount')::numeric,0);return jsonb_build_object('net',round(a-a/1.07*coalesce((d->>'whtRate')::numeric,0)/100,2));
 when 'attendance' then return jsonb_build_object(
  'hours',coalesce(case when hhmm(d->>'checkOut')>hhmm(d->>'checkIn')then round((hhmm(d->>'checkOut')-hhmm(d->>'checkIn'))/60.0,2)end,0),
  'late',coalesce(greatest(0,hhmm(d->>'checkIn')-coalesce(hhmm(d->>'shiftStart'),540)),0));
 else return '{}';end case;end$$;

-- Statuses only an Owner / Manager may set (checked when a signed-in member saves).
create or replace function public.approval_statuses()returns jsonb language sql immutable as $$select ${quote(JSON.stringify(approvalStatuses))}::jsonb$$;
create or replace function public.entity_dept_rules()returns trigger language plpgsql security definer set search_path=public as $$declare s text;begin
 s=new.data->>'status';
 if auth.uid()is not null and coalesce(approval_statuses()->new.kind ? s,false)and(tg_op='INSERT'or old.data->>'status'is distinct from s)and member_role(new.company_id)not in('owner','manager')then
  raise exception 'ต้องให้ Owner หรือ Manager เป็นผู้อนุมัติสถานะนี้';end if;
 if tg_op='UPDATE'and((new.kind='stock_issues'and old.data->>'status'='จ่ายของแล้ว')or(new.kind='stock_counts'and old.data->>'status'='ปรับยอดแล้ว'))
  and(new.data->'productId',new.data->'quantity',new.data->'countedQty')is distinct from(old.data->'productId',old.data->'quantity',old.data->'countedQty')then
  raise exception 'ปรับสต็อกไปแล้ว แก้จำนวนไม่ได้';end if;
 new.data=new.data||dept_derive(new.kind,new.data);return new;end$$;
create trigger entities_dept_rules before insert or update of data on entities for each row execute function entity_dept_rules();

-- Real stock moves, once per record (the reference is unique per product).
create or replace function public.entity_stock_effect()returns trigger language plpgsql security definer set search_path=public as $$declare s text;os text;q numeric;cur numeric;begin
 s=new.data->>'status';os=case when tg_op='UPDATE'then old.data->>'status'end;
 if new.kind='stock_issues'and s='จ่ายของแล้ว'and os is distinct from s then
  q=round(coalesce((new.data->>'quantity')::numeric,0));
  if q>0 then perform post_stock_movement(new.company_id,(new.data->>'productId')::uuid,'out',q::bigint,'stock_issues:'||new.id,coalesce(new.data->>'name',''));end if;
 elsif new.kind='stock_counts'and s='ปรับยอดแล้ว'and os is distinct from s then
  select coalesce((data->>'stock')::numeric,0)into cur from entities where id=(new.data->>'productId')::uuid and company_id=new.company_id and kind='products';
  q=round(coalesce((new.data->>'countedQty')::numeric,0)-coalesce(cur,0));
  if q<>0 then perform post_stock_movement(new.company_id,(new.data->>'productId')::uuid,case when q>0 then 'in'else 'out'end,abs(q)::bigint,'stock_counts:'||new.id,'ปรับยอดจากการตรวจนับ');end if;
 end if;return new;end$$;
create trigger entities_stock_effect after insert or update of data on entities for each row when(new.kind in('stock_issues','stock_counts'))execute function entity_stock_effect();
revoke all on function public.entity_dept_rules(),public.entity_stock_effect()from public,anon,authenticated;

-- Back-fill stored figures on existing rows.
update entities set data=data||dept_derive(kind,data)where kind in('quotations','sales_orders','sales_targets','kpi','content','marketing_budget','event_budget','stock_counts','bills','attendance');
`;
await writeFile("supabase/migrations/0023_department_rules.sql", sql);
console.log("ok");
