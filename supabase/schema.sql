-- EliteFlow: combined migrations for a NEW Supabase project. Run once.
-- EliteFlow 2: run once in Supabase SQL Editor or `supabase db push`.
create extension if not exists pgcrypto;
create table public.companies(id uuid primary key default gen_random_uuid(),name text not null,profile jsonb not null default '{}',settings jsonb not null default '{}',created_at timestamptz not null default now());
create table public.memberships(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),user_id uuid not null references auth.users(id),name text not null default '',email text not null,role text not null check(role in ('owner','manager','staff','viewer')),departments text[] not null default '{}',disabled boolean not null default false,unique(company_id,user_id));
create table public.invitations(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),email text not null,role text not null check(role in ('manager','staff','viewer')),departments text[] not null,expires_at timestamptz not null default now()+interval '7 days',accepted_at timestamptz,unique(company_id,email));
create table public.entity_schemas(kind text primary key,department text not null,fields jsonb not null);
create table public.entities(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),kind text not null references entity_schemas(kind),department text not null,data jsonb not null,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version int not null default 1,archived_at timestamptz);
create index entities_company_kind on entities(company_id,kind,updated_at desc);
create index entities_department on entities(company_id,department) where archived_at is null;
create unique index product_sku on entities(company_id,(data->>'sku')) where kind='products' and archived_at is null;
create table public.stock_movements(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),product_id uuid not null references entities(id),type text not null check(type in ('in','out')),quantity bigint not null check(quantity>0),reference text not null,notes text,created_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(company_id,product_id,reference));
create table public.audit_events(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),actor uuid,action text not null,target text not null,created_at timestamptz not null default now());
create index audit_company on audit_events(company_id,created_at desc);
create table public.messages(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),department text not null,channel text not null,body text not null check(length(body) between 1 and 4000),user_id uuid not null references auth.users(id),name text not null,created_at timestamptz not null default now());
create index messages_channel on messages(company_id,channel,created_at desc);
create table public.attachments(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),entity_id uuid references entities(id),department text not null,name text not null,mime text not null,size bigint not null check(size<=4000000),path text not null unique,created_at timestamptz not null default now());
create table public.data_templates(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),name text not null,department text not null,fields jsonb not null,steps jsonb not null default '[]',version int not null default 1,created_at timestamptz not null default now());
create table public.ingestions(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),template jsonb not null,department text not null,raw text not null default '',values jsonb not null default '{}',missing jsonb not null default '[]',status text not null default 'queued' check(status in ('queued','processing','review','approved','rejected','failed')),source text not null default 'Web',source_event text,group_id text,attachment_id uuid references attachments(id),engine text,error text,lease_until timestamptz,lease_id uuid,attempts int not null default 0,created_at timestamptz not null default now(),created_by uuid,unique(company_id,source_event));
create index ingestion_queue on ingestions(status,created_at);
create table public.line_pairings(token_hash text primary key,company_id uuid not null references companies(id),template_id uuid references data_templates(id),user_id uuid references auth.users(id),expires_at timestamptz not null,used_at timestamptz);
create table public.line_groups(group_id text primary key,company_id uuid not null references companies(id),template_id uuid not null references data_templates(id));
create table public.line_users(company_id uuid not null references companies(id),line_user_id text not null,user_id uuid not null references auth.users(id),primary key(company_id,line_user_id));
create table public.notification_outbox(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),target text not null,body text not null,status text not null default 'queued',attempts int not null default 0,next_at timestamptz not null default now(),lease_until timestamptz,created_at timestamptz not null default now());

create function public.member_role(c uuid) returns text language sql stable security definer set search_path=public as $$select role from memberships where company_id=c and user_id=auth.uid() and not disabled$$;
create function public.can_read_dept(c uuid,d text) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from memberships where company_id=c and user_id=auth.uid() and not disabled and (role='owner' or d=any(departments)))$$;
create function public.can_write_dept(c uuid,d text) returns boolean language sql stable security definer set search_path=public as $$select can_read_dept(c,d) and coalesce(member_role(c)<>'viewer',false)$$;
create function public.log_action(c uuid,a text,t text) returns void language sql security definer set search_path=public as $$insert into audit_events(company_id,actor,action,target)values(c,auth.uid(),a,t)$$;
revoke all on function public.log_action(uuid,text,text) from public,anon,authenticated;

alter table companies enable row level security;alter table memberships enable row level security;alter table invitations enable row level security;alter table entities enable row level security;alter table entity_schemas enable row level security;alter table stock_movements enable row level security;alter table messages enable row level security;alter table attachments enable row level security;alter table audit_events enable row level security;alter table data_templates enable row level security;alter table ingestions enable row level security;alter table line_pairings enable row level security;alter table line_groups enable row level security;alter table line_users enable row level security;alter table notification_outbox enable row level security;
create policy company_read on companies for select to authenticated using(member_role(id) is not null);
create policy member_read on memberships for select to authenticated using(user_id=auth.uid() or member_role(company_id)='owner');
create policy invite_read on invitations for select to authenticated using(member_role(company_id)='owner' or email=lower(auth.jwt()->>'email'));
create policy schemas_read on entity_schemas for select to authenticated using(true);
create policy entity_read on entities for select to authenticated using(can_read_dept(company_id,department));
create policy stock_read on stock_movements for select to authenticated using(can_read_dept(company_id,'Warehouse'));
create policy message_read on messages for select to authenticated using(can_read_dept(company_id,department));
create policy attachment_read on attachments for select to authenticated using(can_read_dept(company_id,department));
create policy audit_read on audit_events for select to authenticated using(member_role(company_id)='owner');
create policy template_read on data_templates for select to authenticated using(can_read_dept(company_id,department));
create policy ingestion_read on ingestions for select to authenticated using(can_read_dept(company_id,department));
create policy groups_read on line_groups for select to authenticated using(member_role(company_id)='owner');
create policy outbox_read on notification_outbox for select to authenticated using(member_role(company_id)='owner');
revoke all on companies,memberships,invitations,entities,entity_schemas,stock_movements,messages,attachments,audit_events,data_templates,ingestions,line_pairings,line_groups,line_users,notification_outbox from anon;
revoke insert,update,delete on companies,memberships,invitations,entities,entity_schemas,stock_movements,messages,attachments,audit_events,data_templates,ingestions,line_pairings,line_groups,line_users,notification_outbox from authenticated;
grant select on companies,memberships,invitations,entity_schemas,entities,stock_movements,messages,attachments,audit_events,data_templates,ingestions,line_groups,notification_outbox to authenticated;

create function public.create_company(p_name text) returns uuid language plpgsql security definer set search_path=public as $$declare c uuid;begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'ยืนยันอีเมลก่อนสร้างบริษัท';end if;
 if length(trim(p_name)) not between 1 and 200 then raise exception 'ชื่อบริษัทไม่ถูกต้อง';end if;
 insert into companies(name,profile)values(trim(p_name),jsonb_build_object('name',trim(p_name)))returning id into c;
 insert into memberships(company_id,user_id,name,email,role)select c,id,coalesce(raw_user_meta_data->>'name',email),lower(email),'owner' from auth.users where id=auth.uid();
 perform log_action(c,'company_created',c::text);return c;end$$;
create function public.accept_invitations() returns void language plpgsql security definer set search_path=public as $$declare i invitations;begin
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)then return;end if;
 for i in select * from invitations where email=lower(auth.jwt()->>'email')and expires_at>now()and accepted_at is null for update loop
 insert into memberships(company_id,user_id,name,email,role,departments)select i.company_id,id,coalesce(raw_user_meta_data->>'name',email),lower(email),i.role,i.departments from auth.users where id=auth.uid() on conflict(company_id,user_id)do nothing;
 update invitations set accepted_at=now()where id=i.id;end loop;end$$;
create function public.save_company(p_company uuid,p_profile jsonb,p_settings jsonb default null) returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)<>'owner' or member_role(p_company)is null then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if length(trim(p_profile->>'name')) not between 1 and 200 then raise exception 'ชื่อบริษัทไม่ถูกต้อง';end if;
 update companies set name=p_profile->>'name',profile=p_profile,settings=coalesce(p_settings,settings)where id=p_company;perform log_action(p_company,'company_updated',p_company::text);end$$;
create function public.invite_member(p_company uuid,p_email text,p_role text,p_departments text[]) returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company) is distinct from 'owner' then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_role not in ('manager','staff','viewer')or coalesce(cardinality(p_departments),0)=0 or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'then raise exception 'คำเชิญไม่ถูกต้อง';end if;
 insert into invitations(company_id,email,role,departments)values(p_company,lower(trim(p_email)),p_role,p_departments)on conflict(company_id,email)do update set role=excluded.role,departments=excluded.departments,expires_at=now()+interval '7 days',accepted_at=null;
 perform log_action(p_company,'member_invited',p_email);end$$;
create function public.edit_member(p_company uuid,p_id uuid,p_role text,p_departments text[],p_disabled boolean) returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_role not in ('manager','staff','viewer')or coalesce(cardinality(p_departments),0)=0 then raise exception 'บทบาทหรือแผนกไม่ถูกต้อง';end if;
 update memberships set role=p_role,departments=p_departments,disabled=p_disabled where id=p_id and company_id=p_company and role<>'owner';if not found then raise exception 'ไม่พบสมาชิกที่แก้ไขได้';end if;perform log_action(p_company,'member_updated',p_id::text);end$$;

create function public.validate_payload(k text,p jsonb,c uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare specs jsonb;f jsonb;v jsonb;output jsonb:='{}';num numeric;rel entities;begin
 select fields into specs from entity_schemas where kind=k;if specs is null then raise exception 'ไม่พบโมดูล';end if;
 for f in select value from jsonb_array_elements(specs)loop v=p->(f->>'key');
 if v is null or v='null'::jsonb or v='""'::jsonb then if (f->>'required')::boolean then raise exception 'ข้อมูลไม่ครบ: %',f->>'label';end if;continue;end if;
 if f->>'type'='number' then if jsonb_typeof(v)<>'number'then raise exception 'รูปแบบตัวเลขไม่ถูกต้อง';end if;num=(v#>>'{}')::numeric;if abs(num)>1e12 or (f ? 'min'and num<(f->>'min')::numeric)then raise exception 'จำนวนไม่ถูกต้อง';end if;
 else if jsonb_typeof(v)<>'string'or length(v#>>'{}')>10000 then raise exception 'รูปแบบข้อความไม่ถูกต้อง';end if;
 if f->>'type'='date' then if (v#>>'{}')!~ '^\d{4}-\d{2}-\d{2}$'or to_char((v#>>'{}')::date,'YYYY-MM-DD')<>(v#>>'{}')then raise exception 'วันที่ไม่ถูกต้อง';end if;end if;
 if f->>'type'='select'and not (f->'options')? (v#>>'{}')then raise exception 'ตัวเลือกไม่ถูกต้อง';end if;
 if f->>'type'='relation' then select * into rel from entities where id=(v#>>'{}')::uuid and company_id=c and kind=f->>'resource'and archived_at is null;if not found then raise exception 'ข้อมูลอ้างอิงไม่อยู่ในบริษัทนี้';end if;end if;end if;
 output=output||jsonb_build_object(f->>'key',v);end loop;
 if output->>'startDate'>output->>'endDate'then raise exception 'ช่วงวันที่ไม่ถูกต้อง';end if;return output;end$$;
revoke all on function public.validate_payload(text,jsonb,uuid) from public,anon,authenticated;
create function public.save_entity(p_company uuid,p_kind text,p_data jsonb,p_id uuid default null,p_version int default null) returns entities language plpgsql security definer set search_path=public as $$declare d text;r entities;old entities;clean jsonb;total numeric;begin
 clean=validate_payload(p_kind,p_data,p_company);select department into d from entity_schemas where kind=p_kind;
 if p_kind in ('tasks','documents')then d=clean->>'department';end if;if p_kind='tickets'and clean->>'type'='IT'then d='IT';end if;
 if not can_write_dept(p_company,d)then raise exception 'ไม่มีสิทธิ์แก้ไขแผนกนี้';end if;
 if p_id is not null then select * into old from entities where id=p_id and company_id=p_company and kind=p_kind for update;if not found or not can_write_dept(p_company,old.department)then raise exception 'ไม่พบรายการ';end if;if old.version is distinct from p_version then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่';end if;if old.archived_at is not null then raise exception 'รายการนี้เก็บเข้าคลังแล้ว';end if;end if;
 if clean->>'status'in ('approved','paid')and p_kind in ('deals','expenses','leaves','payroll')and (p_id is null or old.data->>'status'is distinct from clean->>'status')and member_role(p_company)not in ('owner','manager')then raise exception 'ต้องให้ผู้มีสิทธิ์อนุมัติ';end if;
 if p_kind='deals'and clean->>'status'='approved'and (p_id is null or old.data->>'status'is distinct from 'approved')then raise exception 'ใช้คำสั่งอนุมัติดีลเพื่อสร้าง Workflow';end if;
 if p_kind='products'then clean=clean||jsonb_build_object('stock',coalesce((old.data->>'stock')::numeric,0));end if;
 if p_kind='purchases'then if old.data->>'status'='received'then raise exception 'ใบสั่งซื้อที่รับแล้วแก้ไขไม่ได้';end if;if (clean->>'quantity')::numeric<>trunc((clean->>'quantity')::numeric)then raise exception 'จำนวนต้องเป็นจำนวนเต็ม';end if;clean=clean||jsonb_build_object('total',(clean->>'quantity')::numeric*(clean->>'unitCost')::numeric,'status','draft');end if;
 if p_kind='invoices'then if (clean->>'vat')::numeric>100 then raise exception 'VAT ไม่ถูกต้อง';end if;total=round((clean->>'subtotal')::numeric*(1+(clean->>'vat')::numeric/100),2);if total<coalesce((old.data->>'paid')::numeric,0)then raise exception 'ยอดใบแจ้งหนี้ต่ำกว่ายอดรับชำระ';end if;clean=clean||jsonb_build_object('total',total,'paid',coalesce((old.data->>'paid')::numeric,0),'status',case when coalesce((old.data->>'paid')::numeric,0)>=total then 'paid'when coalesce((old.data->>'paid')::numeric,0)>0 then 'partial'else 'issued'end);end if;
 if p_kind='payroll'then total=(clean->>'base')::numeric+coalesce((clean->>'allowance')::numeric,0)-coalesce((clean->>'deduction')::numeric,0);if total<0 then raise exception 'ค่าจ้างสุทธิติดลบ';end if;clean=clean||jsonb_build_object('net',total);end if;
 if p_kind='payments'and p_id is not null then raise exception 'รายการชำระเงินแก้ไขไม่ได้ ใช้เก็บเข้าคลังเพื่อยกเลิก';end if;
 if p_id is null then insert into entities(company_id,kind,department,data,created_by)values(p_company,p_kind,d,clean,auth.uid())returning * into r;
 else update entities set data=clean,department=d,version=version+1,updated_at=now()where id=p_id returning * into r;end if;
 perform log_action(p_company,case when p_id is null then 'created'else 'updated'end,r.id::text);
 if p_kind='payments'and clean ? 'invoiceId'then perform recalculate_invoice(p_company,(clean->>'invoiceId')::uuid);end if;return r;end$$;
create function public.recalculate_invoice(c uuid,i uuid) returns void language plpgsql security definer set search_path=public as $$declare amount numeric;total numeric;begin
 select (data->>'total')::numeric into total from entities where id=i and company_id=c and kind='invoices'for update;if not found then raise exception 'ไม่พบใบแจ้งหนี้';end if;
 select coalesce(sum((data->>'amount')::numeric),0) into amount from entities where company_id=c and kind='payments'and archived_at is null and data->>'invoiceId'=i::text and data->>'direction'='income';
 if amount>total then raise exception 'รับชำระเกินยอดใบแจ้งหนี้';end if;
 update entities set data=data||jsonb_build_object('paid',amount,'status',case when amount>=total then 'paid'when amount>0 then 'partial'else 'issued'end),version=version+1,updated_at=now()where id=i;end$$;
revoke all on function public.recalculate_invoice(uuid,uuid) from public,anon,authenticated;
create function public.archive_entity(p_company uuid,p_id uuid,p_archive boolean) returns void language plpgsql security definer set search_path=public as $$declare r entities;begin
 select * into r from entities where id=p_id and company_id=p_company for update;if not found or not can_write_dept(p_company,r.department)or member_role(p_company)not in ('owner','manager')then raise exception 'ไม่มีสิทธิ์เก็บเข้าคลัง';end if;
 if r.kind='purchases'and r.data->>'status'='received'then raise exception 'ใบสั่งซื้อรับแล้วเก็บเข้าคลังไม่ได้';end if;
 if r.kind='products'and (r.data->>'stock')::numeric<>0 then raise exception 'ต้องทำยอดสต็อกเป็นศูนย์ก่อนเก็บสินค้า';end if;
 update entities set archived_at=case when p_archive then now()else null end,version=version+1,updated_at=now()where id=p_id;perform log_action(p_company,case when p_archive then 'archived'else 'restored'end,p_id::text);
 if r.kind='payments'and r.data ? 'invoiceId'then perform recalculate_invoice(p_company,(r.data->>'invoiceId')::uuid);end if;end$$;
create function public.post_stock_movement(p_company uuid,p_product uuid,p_type text,p_quantity bigint,p_reference text,p_notes text default '')returns stock_movements language plpgsql security definer set search_path=public as $$declare product entities;next_stock numeric;m stock_movements;begin
 if not can_write_dept(p_company,'Warehouse')then raise exception 'ไม่มีสิทธิ์คลังสินค้า';end if;
 select * into product from entities where id=p_product and company_id=p_company and kind='products'and archived_at is null for update;if not found then raise exception 'ไม่พบสินค้า';end if;
 if p_type not in ('in','out')or p_quantity<=0 or p_quantity>=1e9 or length(trim(p_reference))not between 1 and 200 then raise exception 'รายการรับ–จ่ายไม่ถูกต้อง';end if;
 next_stock=(product.data->>'stock')::numeric+case when p_type='in'then p_quantity else -p_quantity end;if next_stock<0 then raise exception 'สินค้าไม่พอ';end if;
 insert into stock_movements(company_id,product_id,type,quantity,reference,notes,created_by)values(p_company,p_product,p_type,p_quantity,p_reference,p_notes,auth.uid())returning * into m;
 update entities set data=jsonb_set(data,'{stock}',to_jsonb(next_stock)),version=version+1,updated_at=now()where id=p_product;perform log_action(p_company,'stock_'||p_type,p_product::text);return m;end$$;
create function public.purchase_action(p_company uuid,p_id uuid,p_action text)returns void language plpgsql security definer set search_path=public as $$declare r entities;begin
 if not can_write_dept(p_company,'Purchasing')then raise exception 'ไม่มีสิทธิ์จัดซื้อ';end if;select * into r from entities where id=p_id and company_id=p_company and kind='purchases'and archived_at is null for update;if not found then raise exception 'ไม่พบใบสั่งซื้อ';end if;
 if p_action='approve'then if member_role(p_company)not in ('owner','manager')or r.data->>'status'<>'draft'then raise exception 'อนุมัติไม่ได้';end if;
 elsif p_action='receive'then if r.data->>'status'<>'approved'then raise exception 'ต้องอนุมัติก่อนรับสินค้า';end if;perform post_stock_movement(p_company,(r.data->>'productId')::uuid,'in',(r.data->>'quantity')::bigint,'PO:'||p_id::text,'รับใบสั่งซื้อ');
 else raise exception 'คำสั่งไม่ถูกต้อง';end if;
 update entities set data=jsonb_set(data,'{status}',to_jsonb(case when p_action='approve'then 'approved'else 'received'end)),version=version+1,updated_at=now()where id=p_id;perform log_action(p_company,'purchase_'||p_action,p_id::text);end$$;
create function public.send_message(p_company uuid,p_department text,p_body text)returns messages language plpgsql security definer set search_path=public as $$declare m messages;n text;begin
 if not can_write_dept(p_company,p_department)then raise exception 'ไม่มีสิทธิ์ส่งข้อความ';end if;select name into n from memberships where company_id=p_company and user_id=auth.uid();
 insert into messages(company_id,department,channel,body,user_id,name)values(p_company,p_department,p_department,trim(p_body),auth.uid(),n)returning * into m;return m;end$$;
create function public.save_template(p_company uuid,p_name text,p_department text,p_fields jsonb,p_steps jsonb,p_id uuid default null)returns data_templates language plpgsql security definer set search_path=public as $$declare t data_templates;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if length(p_name)not between 1 and 200 or jsonb_array_length(p_fields)not between 1 and 30 or jsonb_array_length(p_steps)>20 then raise exception 'Template ไม่ถูกต้อง';end if;
 if exists(select 1 from jsonb_array_elements(p_fields)f where f->>'key'!~ '^[a-z][a-z0-9_]{0,39}$'or f->>'type'not in ('text','number','date'))or (select count(*)from jsonb_array_elements(p_fields))<>(select count(distinct f->>'key')from jsonb_array_elements(p_fields)f)then raise exception 'ฟิลด์ไม่ถูกต้อง';end if;
 if p_id is null then insert into data_templates(company_id,name,department,fields,steps)values(p_company,p_name,p_department,p_fields,p_steps)returning * into t;else update data_templates set name=p_name,department=p_department,fields=p_fields,steps=p_steps,version=version+1 where id=p_id and company_id=p_company returning * into t;if not found then raise exception 'ไม่พบ Template';end if;end if;perform log_action(p_company,'template_saved',t.id::text);return t;end$$;
create function public.submit_ingestion(p_company uuid,p_template uuid,p_raw text,p_attachment uuid default null)returns ingestions language plpgsql security definer set search_path=public as $$declare t data_templates;i ingestions;begin
 select * into t from data_templates where id=p_template and company_id=p_company;if not found or not can_write_dept(p_company,t.department)then raise exception 'ไม่มีสิทธิ์ส่งข้อมูล';end if;
 if length(p_raw)>15000 or (length(trim(p_raw))=0 and p_attachment is null)then raise exception 'กรอกข้อความหรือแนบเอกสาร';end if;
 if p_attachment is not null and not exists(select 1 from attachments where id=p_attachment and company_id=p_company and department=t.department)then raise exception 'เอกสารไม่ถูกต้อง';end if;
 insert into ingestions(company_id,template,department,raw,attachment_id,created_by)values(p_company,to_jsonb(t),t.department,p_raw,p_attachment,auth.uid())returning * into i;perform log_action(p_company,'ingestion_submitted',i.id::text);return i;end$$;
create function public.decide_ingestion(p_company uuid,p_id uuid,p_status text,p_values jsonb,p_reason text default '')returns void language plpgsql security definer set search_path=public as $$declare i ingestions;f jsonb;v jsonb;s jsonb;begin
 select * into i from ingestions where id=p_id and company_id=p_company for update;if not found or not can_read_dept(p_company,i.department)or member_role(p_company)not in ('owner','manager')then raise exception 'ไม่มีสิทธิ์อนุมัติ';end if;
 if i.status<>'review'or p_status not in ('approved','rejected')then raise exception 'รายการตัดสินแล้วหรือสถานะไม่ถูกต้อง';end if;
 if p_status='approved'then p_values=coalesce((select jsonb_object_agg(field_def->>'key',p_values->(field_def->>'key'))from jsonb_array_elements(i.template->'fields')field_def),'{}'::jsonb);for f in select value from jsonb_array_elements(i.template->'fields')loop v=p_values->(f->>'key');if (f->>'required')::boolean and (v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ: %',f->>'label';end if;if v is not null and v<>'null'::jsonb then if f->>'type'='number'then if jsonb_typeof(v)<>'number'or abs((v#>>'{}')::numeric)>1e12 then raise exception 'ตัวเลขไม่ถูกต้อง';end if;elsif jsonb_typeof(v)<>'string'then raise exception 'ข้อความไม่ถูกต้อง';end if;if f->>'type'='date'and ((v#>>'{}')!~ '^\d{4}-\d{2}-\d{2}$'or to_char((v#>>'{}')::date,'YYYY-MM-DD')<>(v#>>'{}'))then raise exception 'วันที่ไม่ถูกต้อง';end if;end if;end loop;
 for s in select value from jsonb_array_elements(i.template->'steps')loop insert into entities(company_id,kind,department,data,created_by)values(p_company,'tasks',s->>'department',jsonb_build_object('name',s->>'name','department',s->>'department','notes',coalesce(p_values->>'project',i.template->>'name'),'priority','normal','status','pending','ingestionId',i.id),auth.uid());end loop;
 elsif length(trim(p_reason))=0 then raise exception 'ต้องมีเหตุผล';end if;
 update ingestions set status=p_status,values=case when p_status='approved'then p_values else values end,error=nullif(p_reason,''),missing=case when p_status='approved'then '[]'::jsonb else missing end where id=p_id;
 perform log_action(p_company,'ingestion_'||p_status,p_id::text);end$$;
create function public.add_attachment(p_company uuid,p_id uuid,p_entity uuid,p_department text,p_name text,p_mime text,p_size bigint,p_path text)returns void language plpgsql security definer set search_path=public as $$begin
 if not can_write_dept(p_company,p_department)or p_path<>p_company::text||'/'||p_department||'/'||p_id::text then raise exception 'ไม่มีสิทธิ์จัดเก็บเอกสาร';end if;
 if p_entity is not null and not exists(select 1 from entities where id=p_entity and company_id=p_company and department=p_department and archived_at is null)then raise exception 'ข้อมูลอ้างอิงผิด';end if;
 insert into attachments(id,company_id,entity_id,department,name,mime,size,path)values(p_id,p_company,p_entity,p_department,p_name,p_mime,p_size,p_path);end$$;
create function public.claim_ingestion(p_id uuid default null)returns setof ingestions language plpgsql security definer set search_path=public as $$declare i ingestions;begin
 update ingestions set status='failed',error='ประมวลผลหมดเวลาหลายครั้ง กรุณาลองใหม่'where status='processing'and lease_until<now()and attempts>=5;
 for i in select * from ingestions where (p_id is null or id=p_id)and(status='queued'or(status='processing'and lease_until<now()))and attempts<5 order by created_at for update skip locked limit 3 loop update ingestions set status='processing',lease_until=now()+interval '5 minutes',lease_id=gen_random_uuid(),attempts=attempts+1 where id=i.id returning * into i;return next i;end loop;end$$;
revoke all on function public.claim_ingestion(uuid) from public,anon,authenticated;
grant execute on function public.claim_ingestion(uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('eliteflow-files','eliteflow-files',false,4000000,array['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])on conflict(id)do nothing;
create policy eliteflow_files_read on storage.objects for select to authenticated using(bucket_id='eliteflow-files'and can_read_dept(((storage.foldername(name))[1])::uuid,(storage.foldername(name))[2]));
create policy eliteflow_files_insert on storage.objects for insert to authenticated with check(bucket_id='eliteflow-files'and can_write_dept(((storage.foldername(name))[1])::uuid,(storage.foldername(name))[2]));
create policy eliteflow_files_delete on storage.objects for delete to authenticated using(bucket_id='eliteflow-files'and member_role(((storage.foldername(name))[1])::uuid)='owner');

-- Authenticated clients may call these RPCs; all enforce permissions inside SQL.
revoke execute on function member_role(uuid),can_read_dept(uuid,text),can_write_dept(uuid,text),create_company(text),accept_invitations(),save_company(uuid,jsonb,jsonb),invite_member(uuid,text,text,text[]),edit_member(uuid,uuid,text,text[],boolean),save_entity(uuid,text,jsonb,uuid,int),archive_entity(uuid,uuid,boolean),post_stock_movement(uuid,uuid,text,bigint,text,text),purchase_action(uuid,uuid,text),send_message(uuid,text,text),save_template(uuid,text,text,jsonb,jsonb,uuid),submit_ingestion(uuid,uuid,text,uuid),decide_ingestion(uuid,uuid,text,jsonb,text),add_attachment(uuid,uuid,uuid,text,text,text,bigint,text) from public,anon;
grant execute on function member_role(uuid),can_read_dept(uuid,text),can_write_dept(uuid,text),create_company(text),accept_invitations(),save_company(uuid,jsonb,jsonb),invite_member(uuid,text,text,text[]),edit_member(uuid,uuid,text,text[],boolean),save_entity(uuid,text,jsonb,uuid,int),archive_entity(uuid,uuid,boolean),post_stock_movement(uuid,uuid,text,bigint,text,text),purchase_action(uuid,uuid,text),send_message(uuid,text,text),save_template(uuid,text,text,jsonb,jsonb,uuid),submit_ingestion(uuid,uuid,text,uuid),decide_ingestion(uuid,uuid,text,jsonb,text),add_attachment(uuid,uuid,uuid,text,text,text,bigint,text)to authenticated;
grant all on companies,memberships,invitations,entities,entity_schemas,stock_movements,messages,attachments,audit_events,data_templates,ingestions,line_pairings,line_groups,line_users,notification_outbox to service_role;
-- GENERATED MODULE SCHEMAS: scripts/generate-schemas.ts
insert into public.entity_schemas(kind,department,fields)values('customers','Sales','[{"key":"name","label":"ชื่อลูกค้า","type":"text","required":true},{"key":"code","label":"รหัสลูกค้า","type":"text","required":false},{"key":"company","label":"บริษัท","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('dealers','Business Development','[{"key":"name","label":"ชื่อ Dealer / ห้าง","type":"text","required":true},{"key":"code","label":"รหัส Dealer","type":"text","required":false},{"key":"branch","label":"สาขา","type":"text","required":false},{"key":"group","label":"กลุ่ม","type":"text","required":false},{"key":"region","label":"ภูมิภาค","type":"select","required":false,"options":["กรุงเทพฯ","ภาคกลาง","ภาคเหนือ","ภาคอีสาน","ภาคใต้","ภาคตะวันออก","ภาคตะวันตก"]},{"key":"province","label":"จังหวัด","type":"text","required":false},{"key":"maps","label":"ลิงก์แผนที่","type":"url","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('suppliers','Purchasing','[{"key":"name","label":"ชื่อซัพพลายเออร์","type":"text","required":true},{"key":"code","label":"รหัส","type":"text","required":false},{"key":"taxId","label":"เลขประจำตัวผู้เสียภาษี","type":"text","required":false},{"key":"paymentTerms","label":"เงื่อนไขชำระเงิน","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('employees','HR','[{"key":"name","label":"ชื่อ-นามสกุล","type":"text","required":true},{"key":"code","label":"รหัสพนักงาน","type":"text","required":false},{"key":"nickname","label":"ชื่อเล่น","type":"text","required":false},{"key":"department","label":"แผนก","type":"text","required":true},{"key":"position","label":"ตำแหน่ง","type":"text","required":false},{"key":"employmentType","label":"ประเภทการจ้าง","type":"select","required":true,"options":["ประจำ","สัญญาจ้าง","พาร์ตไทม์"]},{"key":"startDate","label":"วันเริ่มงาน","type":"date","required":false},{"key":"salary","label":"เงินเดือน","type":"number","required":false,"min":0},{"key":"birthDate","label":"วันเกิด","type":"date","required":false},{"key":"idCard","label":"เลขบัตรประชาชน","type":"text","required":false},{"key":"bank","label":"ธนาคาร","type":"text","required":false},{"key":"bankAccount","label":"เลขบัญชี","type":"text","required":false},{"key":"emergency","label":"ผู้ติดต่อฉุกเฉิน","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","on_leave","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('freelancers','HR','[{"key":"name","label":"ชื่อ-นามสกุล","type":"text","required":true},{"key":"code","label":"รหัส","type":"text","required":false},{"key":"nickname","label":"ชื่อเล่น","type":"text","required":false},{"key":"role","label":"ประเภทงาน","type":"select","required":true,"options":["SUP","PT","PT_LOCAL","PC","MC","PR"]},{"key":"position","label":"ตำแหน่ง","type":"text","required":false},{"key":"branch","label":"สาขา","type":"text","required":false},{"key":"wage","label":"ค่าจ้างต่อวัน","type":"number","required":false,"min":0},{"key":"startDate","label":"วันเริ่มงาน","type":"date","required":false},{"key":"birthDate","label":"วันเกิด","type":"date","required":false},{"key":"idCard","label":"เลขบัตรประชาชน","type":"text","required":false},{"key":"education","label":"การศึกษา","type":"text","required":false},{"key":"bank","label":"ธนาคาร","type":"text","required":false},{"key":"bankAccount","label":"เลขบัญชี","type":"text","required":false},{"key":"emergency","label":"ผู้ติดต่อฉุกเฉิน","type":"text","required":false},{"key":"workHistory","label":"ประวัติการทำงาน","type":"textarea","required":false},{"key":"evaluation","label":"การประเมิน","type":"textarea","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["available","assigned","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('projects','Operations','[{"key":"name","label":"ชื่อโครงการ","type":"text","required":true},{"key":"code","label":"รหัสโครงการ","type":"text","required":false},{"key":"description","label":"รายละเอียด","type":"textarea","required":false},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"priority","label":"ความสำคัญ","type":"select","required":true,"options":["normal","high","urgent"]},{"key":"startDate","label":"วันเริ่ม","type":"date","required":false},{"key":"endDate","label":"วันสิ้นสุด","type":"date","required":false},{"key":"budget","label":"งบประมาณ","type":"number","required":false,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["planning","active","review","completed","cancelled"]}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('deals','Business Development','[{"key":"name","label":"ชื่อดีล / พื้นที่","type":"text","required":true},{"key":"dealerId","label":"Dealer","type":"relation","required":false,"resource":"dealers"},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"location","label":"สถานที่ / สาขา","type":"text","required":true},{"key":"zone","label":"ชั้น / โซน","type":"text","required":false},{"key":"area","label":"พื้นที่ (ตร.ม.)","type":"number","required":false,"min":0},{"key":"startDate","label":"วันเริ่ม","type":"date","required":false},{"key":"endDate","label":"วันสิ้นสุด","type":"date","required":false},{"key":"rent","label":"ค่าเช่า","type":"number","required":true,"min":0},{"key":"gp","label":"GP (%)","type":"number","required":false,"min":0},{"key":"targetSales","label":"เป้ายอดขาย","type":"number","required":false,"min":0},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"condition","label":"เงื่อนไขค่าเช่า","type":"textarea","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["negotiating","pending","approved","rejected","cancelled"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('events','Operations','[{"key":"name","label":"ชื่ออีเวนต์","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"location","label":"สถานที่","type":"text","required":false},{"key":"startDate","label":"วันเริ่ม","type":"date","required":false},{"key":"endDate","label":"วันสิ้นสุด","type":"date","required":false},{"key":"staff","label":"ทีมหน้างาน","type":"textarea","required":false},{"key":"budget","label":"งบประมาณ","type":"number","required":false,"min":0},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["planning","confirmed","running","completed","cancelled"]},{"key":"notes","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('tasks','Operations','[{"key":"name","label":"ชื่องาน","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"department","label":"แผนก","type":"text","required":true},{"key":"assignee","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"dueDate","label":"วันครบกำหนด","type":"date","required":false},{"key":"priority","label":"ความสำคัญ","type":"select","required":true,"options":["normal","high","urgent"]},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["pending","progress","review","done"]},{"key":"notes","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('assets','Operations','[{"key":"name","label":"ชื่อทรัพย์สิน","type":"text","required":true},{"key":"code","label":"รหัส / Serial","type":"text","required":false},{"key":"category","label":"หมวดหมู่","type":"select","required":true,"options":["IT","อุปกรณ์สำนักงาน","เฟอร์นิเจอร์","อุปกรณ์บูธ","ยานพาหนะ","อื่นๆ"]},{"key":"shop","label":"ร้านที่ซื้อ","type":"text","required":false},{"key":"buyDate","label":"วันที่ซื้อ","type":"date","required":false},{"key":"price","label":"ราคาต่อชิ้น","type":"number","required":true,"min":0},{"key":"quantity","label":"จำนวน","type":"number","required":true,"min":1},{"key":"owner","label":"ผู้ดูแล","type":"text","required":false},{"key":"place","label":"สถานที่จัดเก็บ","type":"text","required":false},{"key":"warranty","label":"ประกันถึง","type":"date","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["in_use","available","repair","retired"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('products','Warehouse','[{"key":"name","label":"ชื่อสินค้า","type":"text","required":true},{"key":"sku","label":"SKU / Barcode","type":"text","required":true},{"key":"category","label":"หมวดหมู่","type":"text","required":false},{"key":"unit","label":"หน่วย","type":"text","required":true},{"key":"cost","label":"ต้นทุนต่อหน่วย","type":"number","required":true,"min":0},{"key":"price","label":"ราคาขาย","type":"number","required":true,"min":0},{"key":"reorderLevel","label":"จุดแจ้งเตือนสต็อก","type":"number","required":true,"min":0},{"key":"location","label":"ตำแหน่งจัดเก็บ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","inactive"]}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('purchases','Purchasing','[{"key":"name","label":"เลขที่ใบสั่งซื้อ","type":"text","required":true},{"key":"supplierId","label":"ซัพพลายเออร์","type":"relation","required":true,"resource":"suppliers"},{"key":"productId","label":"สินค้า","type":"relation","required":true,"resource":"products"},{"key":"quantity","label":"จำนวน","type":"number","required":true,"min":1},{"key":"unitCost","label":"ราคาต่อหน่วย","type":"number","required":true,"min":0},{"key":"orderDate","label":"วันที่สั่งซื้อ","type":"date","required":true},{"key":"dueDate","label":"กำหนดรับ","type":"date","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('sales','Sales','[{"key":"name","label":"รายการยอดขาย","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"customerId","label":"ลูกค้า","type":"relation","required":false,"resource":"customers"},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"amount","label":"ยอดขาย","type":"number","required":true,"min":0},{"key":"channel","label":"ช่องทาง","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["draft","confirmed","cancelled"]},{"key":"notes","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('expenses','Finance','[{"key":"name","label":"รายการค่าใช้จ่าย","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"category","label":"หมวดหมู่","type":"select","required":true,"options":["ค่าเช่า","บุคลากร","จัดซื้อ","ขนส่ง","การตลาด","อื่นๆ"]},{"key":"payee","label":"ผู้รับเงิน","type":"text","required":false},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"amount","label":"จำนวนเงิน","type":"number","required":true,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["pending","approved","paid","rejected"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('invoices','Finance','[{"key":"name","label":"เลขที่ใบแจ้งหนี้","type":"text","required":true},{"key":"customerId","label":"ลูกค้า","type":"relation","required":true,"resource":"customers"},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"date","label":"วันที่เอกสาร","type":"date","required":true},{"key":"dueDate","label":"วันครบกำหนด","type":"date","required":true},{"key":"subtotal","label":"มูลค่าก่อนภาษี","type":"number","required":true,"min":0},{"key":"vat","label":"VAT (%)","type":"number","required":true,"min":0},{"key":"description","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('payments','Finance','[{"key":"name","label":"รายการชำระเงิน","type":"text","required":true},{"key":"invoiceId","label":"ใบแจ้งหนี้","type":"relation","required":false,"resource":"invoices"},{"key":"direction","label":"ประเภท","type":"select","required":true,"options":["income","expense"]},{"key":"date","label":"วันที่ชำระ","type":"date","required":true},{"key":"amount","label":"จำนวนเงิน","type":"number","required":true,"min":0},{"key":"method","label":"วิธีชำระ","type":"select","required":true,"options":["โอนธนาคาร","เงินสด","บัตร","อื่นๆ"]},{"key":"reference","label":"เลขอ้างอิง","type":"text","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('campaigns','Marketing','[{"key":"name","label":"ชื่อแคมเปญ","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"channel","label":"ช่องทาง","type":"text","required":false},{"key":"startDate","label":"วันเริ่ม","type":"date","required":false},{"key":"endDate","label":"วันสิ้นสุด","type":"date","required":false},{"key":"budget","label":"งบประมาณ","type":"number","required":true,"min":0},{"key":"revenue","label":"ยอดขายจากแคมเปญ","type":"number","required":false,"min":0},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["draft","running","completed","paused"]},{"key":"notes","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('tickets','Customer Service','[{"key":"name","label":"หัวข้อปัญหา","type":"text","required":true},{"key":"type","label":"ประเภท","type":"select","required":true,"options":["IT","Customer Service"]},{"key":"customerId","label":"ลูกค้า","type":"relation","required":false,"resource":"customers"},{"key":"assignee","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"priority","label":"ความสำคัญ","type":"select","required":true,"options":["normal","high","urgent"]},{"key":"dueDate","label":"กำหนด SLA","type":"date","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["open","progress","resolved","closed"]},{"key":"notes","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('contracts','Legal','[{"key":"name","label":"ชื่อ / เลขที่สัญญา","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"counterparty","label":"คู่สัญญา","type":"text","required":true},{"key":"value","label":"มูลค่าสัญญา","type":"number","required":false,"min":0},{"key":"startDate","label":"วันเริ่ม","type":"date","required":false},{"key":"endDate","label":"วันสิ้นสุด","type":"date","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["draft","review","signed","expired","terminated"]},{"key":"notes","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('leaves','HR','[{"key":"name","label":"หัวข้อการลา","type":"text","required":true},{"key":"employeeId","label":"พนักงาน","type":"relation","required":true,"resource":"employees"},{"key":"type","label":"ประเภท","type":"select","required":true,"options":["ลาป่วย","ลากิจ","ลาพักร้อน","อื่นๆ"]},{"key":"startDate","label":"วันเริ่ม","type":"date","required":false},{"key":"endDate","label":"วันสิ้นสุด","type":"date","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["pending","approved","rejected"]},{"key":"notes","label":"เหตุผล","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('payroll','HR','[{"key":"name","label":"งวดค่าจ้าง","type":"text","required":true},{"key":"employeeId","label":"พนักงาน","type":"relation","required":true,"resource":"employees"},{"key":"date","label":"วันที่จ่าย","type":"date","required":true},{"key":"base","label":"ค่าจ้างพื้นฐาน","type":"number","required":true,"min":0},{"key":"allowance","label":"รายได้เพิ่ม","type":"number","required":false,"min":0},{"key":"deduction","label":"รายการหัก","type":"number","required":false,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["draft","approved","paid"]},{"key":"notes","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb);
insert into public.entity_schemas(kind,department,fields)values('documents','Operations','[{"key":"name","label":"ชื่อเอกสาร","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"category","label":"หมวดหมู่","type":"select","required":true,"options":["สัญญา","ใบเสร็จ","Layout","Perspective","เอกสารบุคคล","ทั่วไป"]},{"key":"department","label":"แผนก","type":"text","required":true},{"key":"notes","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb);

create function public.dashboard_summary(p_company uuid)returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์บริษัท';end if;
 select jsonb_build_object(
 'sales',coalesce(sum((data->>'amount')::numeric)filter(where kind='sales'and data->>'status'='confirmed'),0),
 'expenses',coalesce(sum((data->>'amount')::numeric)filter(where kind='expenses'and data->>'status'in ('approved','paid')),0),
 'projects',count(*)filter(where kind='projects'and data->>'status'in ('planning','active','review')),
 'tasks',count(*)filter(where kind='tasks'and data->>'status'<>'done'),
 'pendingDeals',count(*)filter(where kind='deals'and data->>'status'='pending'),
 'lowStock',coalesce(jsonb_agg(to_jsonb(entities))filter(where kind='products'and(data->>'stock')::numeric<=(data->>'reorderLevel')::numeric),'[]'::jsonb)
 )into result from entities where company_id=p_company and archived_at is null and can_read_dept(p_company,department);return result;end$$;
create function public.approve_deal(p_company uuid,p_id uuid)returns uuid language plpgsql security definer set search_path=public as $$declare r entities;project uuid;d text;begin
 if member_role(p_company)not in ('owner','manager')or not can_write_dept(p_company,'Business Development')then raise exception 'ไม่มีสิทธิ์อนุมัติ';end if;
 select * into r from entities where id=p_id and company_id=p_company and kind='deals'and archived_at is null for update;if not found or r.data->>'status'<>'pending'then raise exception 'ดีลนี้ไม่ได้รออนุมัติ';end if;
 project=nullif(r.data->>'projectId','')::uuid;
 if project is null then insert into entities(company_id,kind,department,data,created_by)values(p_company,'projects','Operations',jsonb_build_object('name',r.data->>'name','status','active','priority','normal','budget',coalesce((r.data->>'rent')::numeric,0),'startDate',r.data->>'startDate','endDate',r.data->>'endDate'),auth.uid())returning id into project;end if;
 foreach d in array array['Design','Purchasing','Warehouse','Marketing','Sales']loop insert into entities(company_id,kind,department,data,created_by)values(p_company,'tasks',d,jsonb_build_object('name',case d when 'Design'then 'เขียนแบบ / Perspective'when 'Purchasing'then 'ขอใบเสนอราคา'when 'Warehouse'then 'เตรียมสินค้า'when 'Marketing'then 'เตรียมสื่อ'else 'วางแผนการขาย'end,'department',d,'projectId',project,'priority','normal','status','pending','dealId',r.id),auth.uid());end loop;
 update entities set data=data||jsonb_build_object('status','approved','projectId',project),version=version+1,updated_at=now()where id=r.id;perform log_action(p_company,'deal_approved',p_id::text);return project;end$$;
create function public.claim_notifications()returns setof notification_outbox language plpgsql security definer set search_path=public as $$declare n notification_outbox;begin
 for n in select * from notification_outbox where(status='queued'or(status='processing'and lease_until<now()))and attempts<5 and next_at<=now()order by created_at for update skip locked limit 5 loop update notification_outbox set status='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes'where id=n.id returning * into n;return next n;end loop;end$$;
create function public.pair_line_group(p_hash text,p_group text)returns void language plpgsql security definer set search_path=public as $$declare p line_pairings;begin
 select * into p from line_pairings where token_hash=p_hash and used_at is null and expires_at>now()and template_id is not null for update;if not found then raise exception 'รหัสหมดอายุหรือไม่ถูกต้อง';end if;
 if exists(select 1 from line_groups where group_id=p_group and company_id<>p.company_id)then raise exception 'กลุ่มนี้เชื่อมบริษัทอื่น';end if;
 insert into line_groups(group_id,company_id,template_id)values(p_group,p.company_id,p.template_id)on conflict(group_id)do update set template_id=excluded.template_id;update line_pairings set used_at=now()where token_hash=p_hash;end$$;
create function public.pair_line_user(p_hash text,p_group text,p_line_user text)returns void language plpgsql security definer set search_path=public as $$declare p line_pairings;begin
 select * into p from line_pairings where token_hash=p_hash and used_at is null and expires_at>now()and user_id is not null for update;if not found or not exists(select 1 from line_groups where group_id=p_group and company_id=p.company_id)then raise exception 'รหัสหรือกลุ่มไม่ถูกต้อง';end if;
 if exists(select 1 from line_users where company_id=p.company_id and line_user_id=p_line_user and user_id<>p.user_id)then raise exception 'LINE นี้เชื่อมบัญชีอื่น';end if;
 insert into line_users(company_id,line_user_id,user_id)values(p.company_id,p_line_user,p.user_id)on conflict do nothing;update line_pairings set used_at=now()where token_hash=p_hash;end$$;
create function public.line_approve(p_group text,p_user text,p_id uuid)returns void language plpgsql security definer set search_path=public as $$declare g line_groups;u memberships;i ingestions;f jsonb;v jsonb;s jsonb;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select m.* into u from memberships m join line_users l on l.company_id=m.company_id and l.user_id=m.user_id where l.company_id=g.company_id and l.line_user_id=p_user and not m.disabled and m.role in ('owner','manager');
 if not found then raise exception 'LINE นี้ไม่มีสิทธิ์อนุมัติ';end if;
 select * into i from ingestions where id=p_id and company_id=g.company_id and group_id=p_group for update;if not found then raise exception 'ไม่พบรายการ';end if;
 if u.role<>'owner'and not i.department=any(u.departments)then raise exception 'ไม่มีสิทธิ์แผนกนี้';end if;
 if i.status='approved'then return;end if;if i.status<>'review'then raise exception 'รายการนี้อนุมัติไม่ได้';end if;
 for f in select value from jsonb_array_elements(i.template->'fields')loop v=i.values->(f->>'key');if(f->>'required')::boolean and(v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ';end if;end loop;
 for s in select value from jsonb_array_elements(i.template->'steps')loop insert into entities(company_id,kind,department,data,created_by)values(g.company_id,'tasks',s->>'department',jsonb_build_object('name',s->>'name','department',s->>'department','notes',coalesce(i.values->>'project',i.template->>'name'),'priority','normal','status','pending','ingestionId',i.id),u.user_id);end loop;
 update ingestions set status='approved',missing='[]'where id=i.id;insert into audit_events(company_id,actor,action,target)values(g.company_id,u.user_id,'line_approved',i.id::text);end$$;
revoke execute on function dashboard_summary(uuid),approve_deal(uuid,uuid),claim_notifications(),pair_line_group(text,text),pair_line_user(text,text,text),line_approve(text,text,uuid)from public,anon;
grant execute on function dashboard_summary(uuid),approve_deal(uuid,uuid)to authenticated;
revoke execute on function claim_notifications(),pair_line_group(text,text),pair_line_user(text,text,text),line_approve(text,text,uuid)from authenticated;
grant execute on function claim_notifications(),pair_line_group(text,text),pair_line_user(text,text,text),line_approve(text,text,uuid)to service_role;

create function public.calendar_entries(p_company uuid,p_month text)returns setof entities language plpgsql security definer set search_path=public as $$begin
 if p_month!~ '^\d{4}-(0[1-9]|1[0-2])$'or member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์หรือเดือนไม่ถูกต้อง';end if;
 return query select * from entities where company_id=p_company and archived_at is null and kind in ('tasks','events','deals','projects')and can_read_dept(p_company,department)and(left(data->>'startDate',7)=p_month or left(data->>'dueDate',7)=p_month or left(data->>'date',7)=p_month)order by updated_at desc;end$$;
revoke execute on function calendar_entries(uuid,text)from public,anon;
grant execute on function calendar_entries(uuid,text)to authenticated;

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

alter table public.ingestions add column source_user text;
create function public.retry_ingestion(p_company uuid,p_id uuid)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;begin
 select * into i from ingestions where id=p_id and company_id=p_company for update;if not found or not can_write_dept(p_company,i.department)then raise exception 'ไม่มีสิทธิ์รายการนี้';end if;if i.status<>'failed'then raise exception 'ลองใหม่ได้เฉพาะรายการที่ประมวลผลไม่สำเร็จ';end if;
 update ingestions set status='queued',attempts=0,error=null,lease_until=null,lease_id=null where id=p_id;perform log_action(p_company,'ingestion_retried',p_id::text);end$$;
revoke execute on function retry_ingestion(uuid,uuid)from public,anon;
grant execute on function retry_ingestion(uuid,uuid)to authenticated;

create function public.complete_ingestion(p_id uuid,p_lease uuid,p_values jsonb,p_missing jsonb,p_engine text)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;begin
 select * into i from ingestions where id=p_id and lease_id=p_lease and status='processing'for update;if not found then return;end if;
 update ingestions set values=p_values,missing=p_missing,engine=p_engine,status='review',lease_until=null where id=p_id;
 if i.group_id is not null then insert into notification_outbox(id,company_id,target,body)values(i.id,i.company_id,i.group_id,left('EliteFlow: รายการ '||i.id::text||chr(10)||case when jsonb_array_length(p_missing)>0 then 'ข้อมูลที่ขาด: '||(select string_agg(value,', ')from jsonb_array_elements_text(p_missing))else 'พร้อมตรวจทานในเว็บ หรือ #approve '||i.id::text end,4500))on conflict(id)do nothing;end if;end$$;
revoke execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)from public,anon,authenticated;
grant execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)to service_role;

-- Preserve imported Firebase fields separately from the new validated form payload.
alter table public.entities add column legacy_data jsonb;

-- Link approved workflow records to a unique project in the same company.
create function public.create_ingestion_workflow(c uuid,u uuid,t jsonb,v jsonb,i uuid)returns void language plpgsql security definer set search_path=public as $$declare p uuid;n text;matches int;s jsonb;budget numeric:=0;start_date text;end_date text;begin
 if jsonb_array_length(t->'steps')=0 then return;end if;
 if exists(select 1 from jsonb_array_elements(t->'fields')f where f->>'key'='start'and f->>'type'='date')then start_date=v->>'start';end if;
 if exists(select 1 from jsonb_array_elements(t->'fields')f where f->>'key'='end'and f->>'type'='date')then end_date=v->>'end';end if;
 if start_date>end_date then raise exception 'ช่วงวันที่โครงการไม่ถูกต้อง';end if;
 if jsonb_typeof(v->'project_id')='string'and nullif(v->>'project_id','')is not null then select id into p from entities where id=(v->>'project_id')::uuid and company_id=c and kind='projects'and archived_at is null;if not found then raise exception 'โครงการอ้างอิงไม่อยู่ในบริษัทนี้';end if;
 elsif jsonb_typeof(v->'project')='string'and length(trim(v->>'project'))>0 then
 n=trim(v->>'project');if length(n)>500 then raise exception 'ชื่อโครงการยาวเกินไป';end if;
 select count(*)into matches from entities where company_id=c and kind='projects'and archived_at is null and lower(data->>'name')=lower(n);if matches>1 then raise exception 'พบชื่อโครงการซ้ำ กรุณาใช้ฟิลด์ project_id เพื่อระบุโครงการ';end if;
 select id into p from entities where company_id=c and kind='projects'and archived_at is null and lower(data->>'name')=lower(n);
 if p is null then
 if jsonb_typeof(v->'rent')='number'then budget=greatest(0,(v->>'rent')::numeric);end if;
 
 insert into entities(company_id,kind,department,data,created_by)values(c,'projects','Operations',jsonb_build_object('name',n,'status','active','priority','normal','budget',budget,'startDate',start_date,'endDate',end_date,'ingestionId',i),u)returning id into p;
 end if;end if;
 if t->>'department'='Business Development'and jsonb_typeof(v->'rent')='number'and jsonb_typeof(v->'location')='string'then
 if (v->>'rent')::numeric<0 then raise exception 'ค่าเช่าต้องไม่ติดลบ';end if;
 insert into entities(company_id,kind,department,data,created_by)values(c,'deals','Business Development',jsonb_build_object('name',coalesce(v->>'project',t->>'name'),'location',v->>'location','rent',v->'rent','projectId',p,'status','approved','startDate',start_date,'endDate',end_date,'ingestionId',i),u);
 end if;
 for s in select value from jsonb_array_elements(t->'steps')loop insert into entities(company_id,kind,department,data,created_by)values(c,'tasks',s->>'department',jsonb_build_object('name',s->>'name','department',s->>'department','notes',coalesce(v->>'project',t->>'name'),'projectId',p,'priority','normal','status','pending','ingestionId',i),u);end loop;
end$$;
revoke execute on function create_ingestion_workflow(uuid,uuid,jsonb,jsonb,uuid)from public,anon,authenticated;
-- GENERATED APPROVAL FUNCTIONS
create or replace function public.decide_ingestion(p_company uuid,p_id uuid,p_status text,p_values jsonb,p_reason text default '')returns void language plpgsql security definer set search_path=public as $$declare i ingestions;f jsonb;v jsonb;s jsonb;begin
 select * into i from ingestions where id=p_id and company_id=p_company for update;if not found or not can_read_dept(p_company,i.department)or member_role(p_company)not in ('owner','manager')then raise exception 'ไม่มีสิทธิ์อนุมัติ';end if;
 if i.status<>'review'or p_status not in ('approved','rejected')then raise exception 'รายการตัดสินแล้วหรือสถานะไม่ถูกต้อง';end if;
 if p_status='approved'then p_values=coalesce((select jsonb_object_agg(field_def->>'key',p_values->(field_def->>'key'))from jsonb_array_elements(i.template->'fields')field_def),'{}'::jsonb);for f in select value from jsonb_array_elements(i.template->'fields')loop v=p_values->(f->>'key');if (f->>'required')::boolean and (v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ: %',f->>'label';end if;if v is not null and v<>'null'::jsonb then if f->>'type'='number'then if jsonb_typeof(v)<>'number'or abs((v#>>'{}')::numeric)>1e12 then raise exception 'ตัวเลขไม่ถูกต้อง';end if;elsif jsonb_typeof(v)<>'string'then raise exception 'ข้อความไม่ถูกต้อง';end if;if f->>'type'='date'and ((v#>>'{}')!~ '^\d{4}-\d{2}-\d{2}$'or to_char((v#>>'{}')::date,'YYYY-MM-DD')<>(v#>>'{}'))then raise exception 'วันที่ไม่ถูกต้อง';end if;end if;end loop;
 perform create_ingestion_workflow(p_company,auth.uid(),i.template,p_values,i.id);
 elsif length(trim(p_reason))=0 then raise exception 'ต้องมีเหตุผล';end if;
 update ingestions set status=p_status,values=case when p_status='approved'then p_values else values end,error=nullif(p_reason,''),missing=case when p_status='approved'then '[]'::jsonb else missing end where id=p_id;
 perform log_action(p_company,'ingestion_'||p_status,p_id::text);end$$;
create or replace function public.line_approve(p_group text,p_user text,p_id uuid)returns void language plpgsql security definer set search_path=public as $$declare g line_groups;u memberships;i ingestions;f jsonb;v jsonb;s jsonb;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select m.* into u from memberships m join line_users l on l.company_id=m.company_id and l.user_id=m.user_id where l.company_id=g.company_id and l.line_user_id=p_user and not m.disabled and m.role in ('owner','manager');
 if not found then raise exception 'LINE นี้ไม่มีสิทธิ์อนุมัติ';end if;
 select * into i from ingestions where id=p_id and company_id=g.company_id and group_id=p_group for update;if not found then raise exception 'ไม่พบรายการ';end if;
 if u.role<>'owner'and not i.department=any(u.departments)then raise exception 'ไม่มีสิทธิ์แผนกนี้';end if;
 if i.status='approved'then return;end if;if i.status<>'review'then raise exception 'รายการนี้อนุมัติไม่ได้';end if;
 for f in select value from jsonb_array_elements(i.template->'fields')loop v=i.values->(f->>'key');if(f->>'required')::boolean and(v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ';end if;end loop;
 perform create_ingestion_workflow(g.company_id,u.user_id,i.template,i.values,i.id);
 update ingestions set status='approved',missing='[]'where id=i.id;insert into audit_events(company_id,actor,action,target)values(g.company_id,u.user_id,'line_approved',i.id::text);end$$;

-- Canva page 11: immutable versions, review decisions and comments.
create or replace function public.add_attachment(p_company uuid,p_id uuid,p_entity uuid,p_department text,p_name text,p_mime text,p_size bigint,p_path text) returns void language plpgsql security definer set search_path=public as $$begin
 if not can_write_dept(p_company,p_department) or p_path<>p_company::text||'/'||p_department||'/'||p_id::text then raise exception 'ไม่มีสิทธิ์จัดเก็บเอกสาร';end if;
 if p_entity is not null and not exists(select 1 from entities e where e.id=p_entity and e.company_id=p_company and e.archived_at is null and (e.department=p_department or (e.kind='projects' and p_department='Design' and can_read_dept(p_company,e.department)))) then raise exception 'ข้อมูลอ้างอิงผิด';end if;
 insert into attachments(id,company_id,entity_id,department,name,mime,size,path) values(p_id,p_company,p_entity,p_department,p_name,p_mime,p_size,p_path);
end$$;
create table public.design_revisions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
 project_id uuid not null references entities(id), attachment_id uuid not null references attachments(id),
 category text not null check(category in ('layout','perspective','site')),
 version integer not null, status text not null default 'submitted' check(status in ('submitted','revision','approved')),
 notes text not null default '', created_by uuid not null references auth.users(id), created_name text not null,
 created_at timestamptz not null default now(), reviewed_by uuid references auth.users(id), reviewed_name text,
 reviewed_at timestamptz, review_note text, unique(project_id,category,version)
);
create table public.design_comments (
 id uuid primary key default gen_random_uuid(), revision_id uuid not null references design_revisions(id),
 company_id uuid not null references companies(id), user_id uuid not null references auth.users(id),
 name text not null, body text not null check(length(body) between 1 and 4000), created_at timestamptz not null default now()
);
alter table design_revisions enable row level security;
alter table design_comments enable row level security;
create policy revision_read on design_revisions for select to authenticated using(can_read_dept(company_id,'Design') and exists(select 1 from entities e where e.id=project_id and e.company_id=design_revisions.company_id and e.archived_at is null));
create policy design_comment_read on design_comments for select to authenticated using(exists(select 1 from design_revisions r where r.id=revision_id));
grant select on design_revisions,design_comments to authenticated;
grant all on design_revisions,design_comments to service_role;
create function public.create_design_revision(p_company uuid,p_project uuid,p_attachment uuid,p_category text,p_notes text default '') returns design_revisions language plpgsql security definer set search_path=public as $$
declare p entities; a attachments; r design_revisions; v int; n text;
begin
 if not can_write_dept(p_company,'Design') then raise exception 'ไม่มีสิทธิ์ส่งแบบ';end if;
 select * into p from entities where id=p_project and company_id=p_company and kind='projects' and archived_at is null for update;
 if p.id is null or not can_read_dept(p_company,p.department) then raise exception 'ไม่พบโครงการ';end if;
 select * into a from attachments where id=p_attachment and company_id=p_company and entity_id=p_project;
 if a.id is null or not can_read_dept(p_company,a.department) or a.mime not in ('image/png','image/jpeg','image/webp','application/pdf') then raise exception 'ไฟล์ต้องเป็นภาพหรือ PDF ของโครงการนี้';end if;
 if p_category not in ('layout','perspective','site') or length(coalesce(p_notes,''))>4000 then raise exception 'ข้อมูลเวอร์ชันไม่ถูกต้อง';end if;
 if exists(select 1 from design_revisions where attachment_id=p_attachment and project_id=p_project and category=p_category) then raise exception 'ไฟล์นี้ถูกส่งเป็นเวอร์ชันแล้ว';end if;
 select coalesce(max(version),0)+1 into v from design_revisions where project_id=p_project and category=p_category;
 select name into n from memberships where company_id=p_company and user_id=auth.uid() and not disabled;
 insert into design_revisions(company_id,project_id,attachment_id,category,version,notes,created_by,created_name) values(p_company,p_project,p_attachment,p_category,v,coalesce(p_notes,''),auth.uid(),coalesce(n,'')) returning * into r;
 perform log_action(p_company,'design_version_uploaded',p_project::text);
 return r;
end$$;
create function public.review_design_revision(p_company uuid,p_id uuid,p_status text,p_note text default '') returns design_revisions language plpgsql security definer set search_path=public as $$
declare r design_revisions; p entities; n text;
begin
 if member_role(p_company) not in ('owner','manager') or not can_write_dept(p_company,'Design') then raise exception 'ไม่มีสิทธิ์อนุมัติแบบ';end if;
 select * into r from design_revisions where id=p_id and company_id=p_company for update;
 select * into p from entities where id=r.project_id and company_id=p_company and archived_at is null for update;
 if r.id is null or p.id is null or not can_read_dept(p_company,p.department) then raise exception 'ไม่พบเวอร์ชัน';end if;
 if r.status<>'submitted' then raise exception 'เวอร์ชันนี้ตรวจทานแล้ว';end if;
 if exists(select 1 from design_revisions where project_id=r.project_id and category=r.category and version>r.version) then raise exception 'มีเวอร์ชันใหม่กว่า กรุณาตรวจเวอร์ชันล่าสุด';end if;
 if p_status not in ('approved','revision') or length(coalesce(p_note,''))>4000 or (p_status='revision' and length(trim(coalesce(p_note,'')))=0) then raise exception 'กรอกเหตุผลที่ให้แก้ไข';end if;
 select name into n from memberships where company_id=p_company and user_id=auth.uid() and not disabled;
 update design_revisions set status=p_status,review_note=coalesce(p_note,''),reviewed_by=auth.uid(),reviewed_name=n,reviewed_at=now() where id=p_id returning * into r;
 perform log_action(p_company,'design_'||p_status,r.project_id::text);
 return r;
end$$;
create function public.comment_design_revision(p_company uuid,p_revision uuid,p_body text) returns design_comments language plpgsql security definer set search_path=public as $$
declare r design_revisions; p entities; n text; c design_comments;
begin
 if not can_write_dept(p_company,'Design') then raise exception 'ไม่มีสิทธิ์แสดงความคิดเห็น';end if;
 select * into r from design_revisions where id=p_revision and company_id=p_company;
 select * into p from entities where id=r.project_id and company_id=p_company and archived_at is null;
 if r.id is null or p.id is null or not can_read_dept(p_company,p.department) then raise exception 'ไม่พบเวอร์ชัน';end if;
 if length(trim(coalesce(p_body,''))) not between 1 and 4000 then raise exception 'กรอกความคิดเห็น 1–4000 ตัวอักษร';end if;
 select name into n from memberships where company_id=p_company and user_id=auth.uid() and not disabled;
 insert into design_comments(revision_id,company_id,user_id,name,body) values(p_revision,p_company,auth.uid(),coalesce(n,''),trim(p_body)) returning * into c;
 perform log_action(p_company,'design_comment',r.project_id::text);return c;
end$$;
revoke all on function create_design_revision(uuid,uuid,uuid,text,text),review_design_revision(uuid,uuid,text,text),comment_design_revision(uuid,uuid,text) from public,anon;
grant execute on function create_design_revision(uuid,uuid,uuid,text,text),review_design_revision(uuid,uuid,text,text),comment_design_revision(uuid,uuid,text) to authenticated;

-- PPTX pages 10 / 12 / 16 / 17 / 18: rental expenses, CRM and procurement fields.
insert into public.entity_schemas(kind,department,fields)values('leads','Sales','[{"key":"name","label":"ชื่อโอกาสขาย","type":"text","required":true},{"key":"customerId","label":"ลูกค้า","type":"relation","required":false,"resource":"customers"},{"key":"stage","label":"ขั้นตอน","type":"select","required":true,"options":["lead","contact","meeting","proposal","negotiation","won","lost"]},{"key":"amount","label":"มูลค่าโอกาสขาย","type":"number","required":true,"min":0},{"key":"assignee","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"nextDate","label":"นัดติดตามครั้งถัดไป","type":"date","required":false},{"key":"activity","label":"กิจกรรมล่าสุด","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('purchases','Purchasing','[{"key":"name","label":"เลขที่ใบสั่งซื้อ","type":"text","required":true},{"key":"supplierId","label":"ซัพพลายเออร์","type":"relation","required":true,"resource":"suppliers"},{"key":"productId","label":"สินค้า","type":"relation","required":true,"resource":"products"},{"key":"quantity","label":"จำนวน","type":"number","required":true,"min":1},{"key":"unitCost","label":"ราคาต่อหน่วย","type":"number","required":true,"min":0},{"key":"orderDate","label":"วันที่สั่งซื้อ","type":"date","required":true},{"key":"dueDate","label":"กำหนดรับ","type":"date","required":false},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"category","label":"หมวดหมู่สินค้า","type":"text","required":false},{"key":"requestor","label":"ผู้ขอจัดซื้อ","type":"text","required":false},{"key":"usagePurpose","label":"งาน / โปรโมชั่นที่ใช้","type":"text","required":false},{"key":"startDate","label":"วันเริ่ม","type":"date","required":false},{"key":"endDate","label":"วันสิ้นสุด","type":"date","required":false},{"key":"deliveryLocation","label":"สถานที่จัดส่ง","type":"text","required":false},{"key":"poNumber","label":"เลขที่ใบสั่งซื้อ PO","type":"text","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('expenses','Finance','[{"key":"name","label":"รายการค่าใช้จ่าย","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"category","label":"หมวดหมู่","type":"select","required":true,"options":["ค่ามัดจำ","ค่าเช่า","ค่าไฟฟ้า","ค่าบริการ","ค่าพรม","บุคลากร","จัดซื้อ","ขนส่ง","การตลาด","อื่นๆ"]},{"key":"payee","label":"ผู้รับเงิน","type":"text","required":false},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"amount","label":"จำนวนเงิน","type":"number","required":true,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["pending","approved","paid","rejected"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('customers','Sales','[{"key":"name","label":"ชื่อลูกค้า","type":"text","required":true},{"key":"code","label":"รหัสลูกค้า","type":"text","required":false},{"key":"company","label":"บริษัท","type":"text","required":false},{"key":"segment","label":"กลุ่มลูกค้า","type":"select","required":false,"options":["standard","vip"]},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

-- PPTX slide 8: ten project lifecycle stages, independently versioned and tenant scoped.
create table public.project_stages (
 company_id uuid not null references companies(id),project_id uuid not null references entities(id),
 key text not null,ordinal int not null,department text not null,label text not null,english text not null,
 status text not null default 'pending' check(status in ('pending','progress','review','done')),
 version int not null default 1,started_at timestamptz,completed_at timestamptz,
 updated_at timestamptz not null default now(),updated_by uuid references auth.users(id),
 primary key(project_id,key)
);
create table public.project_stage_history (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),project_id uuid not null references entities(id),
 key text not null,department text not null,status text not null,actor uuid,created_at timestamptz not null default now()
);
alter table project_stages enable row level security;alter table project_stage_history enable row level security;
create policy stage_read on project_stages for select to authenticated using(can_read_dept(company_id,department) and exists(select 1 from entities e where e.id=project_id and e.company_id=project_stages.company_id and e.archived_at is null));
create policy stage_history_read on project_stage_history for select to authenticated using(can_read_dept(company_id,department) and exists(select 1 from entities e where e.id=project_id and e.company_id=project_stage_history.company_id and e.archived_at is null));
grant select on project_stages,project_stage_history to authenticated;grant all on project_stages,project_stage_history to service_role;
create function public.init_project_stages(p_project uuid) returns void language plpgsql security definer set search_path=public as $$
declare p entities;
begin
 select * into p from entities where id=p_project and kind='projects';if p.id is null then return;end if;
 insert into project_stages(company_id,project_id,key,ordinal,department,label,english)
 select p.company_id,p.id,v.key,v.ordinal,v.department,v.label,v.english from (values
 ('location',0,'Business Development','หา Location','Location'),('contract',1,'Legal','ทำสัญญา','Contract'),
 ('payment',2,'Finance','ชำระเงิน','Payment'),('layout',3,'Design','เขียนแบบ','Layout'),
 ('procurement',4,'Purchasing','จัดซื้อ','Procurement'),('warehouse',5,'Warehouse','คลังสินค้า','Warehouse'),
 ('setup',6,'Operations','เตรียมงาน','Setup'),('selling',7,'Sales','PC ขายของ','Selling'),
 ('summary',8,'Marketing','สรุปผล','Summary'),('close',9,'Operations','ปิดงาน','Close')
 ) v(key,ordinal,department,label,english) on conflict(project_id,key)do nothing;
end$$;
revoke all on function init_project_stages(uuid) from public,anon,authenticated;
create function public.project_stage_init_trigger() returns trigger language plpgsql security definer set search_path=public as $$begin perform init_project_stages(new.id);return new;end$$;
revoke all on function project_stage_init_trigger() from public,anon,authenticated;
create trigger create_project_stages after insert on entities for each row when(new.kind='projects')execute function project_stage_init_trigger();
do $$declare p uuid;begin for p in select id from entities where kind='projects' loop perform init_project_stages(p);end loop;end$$;
create function public.update_project_stage(p_company uuid,p_project uuid,p_key text,p_status text,p_version int)returns project_stages language plpgsql security definer set search_path=public as $$
declare r project_stages;p entities;
begin
 select * into p from entities where id=p_project and company_id=p_company and kind='projects' and archived_at is null for update;
 if p.id is null or not can_read_dept(p_company,p.department) then raise exception 'ไม่พบโครงการ';end if;
 select * into r from project_stages where company_id=p_company and project_id=p_project and key=p_key for update;
 if r.project_id is null or not can_write_dept(p_company,r.department) then raise exception 'ไม่มีสิทธิ์แก้ไขขั้นตอนนี้';end if;
 if p_version is null or r.version<>p_version then raise exception 'ขั้นตอนนี้เปลี่ยนแล้ว กรุณารีเฟรช';end if;
 if p_status not in ('pending','progress','review','done') then raise exception 'สถานะไม่ถูกต้อง';end if;
 if p_status='done' and p_key in ('contract','payment','layout','close') and member_role(p_company)not in ('owner','manager') then raise exception 'ต้องให้ผู้มีสิทธิ์อนุมัติ';end if;
 if p_key='close' and p_status='done' and exists(select 1 from project_stages where project_id=p_project and key<>'close' and status<>'done')then raise exception 'ทำขั้นตอนก่อนหน้าให้เสร็จก่อนปิดโครงการ';end if;
 if p_key='layout' and p_status='done' and exists(select 1 from design_revisions dv where dv.project_id=p_project and dv.category='layout' and dv.version=(select max(version)from design_revisions where project_id=p_project and category='layout')and dv.status<>'approved')then raise exception 'แบบเวอร์ชันล่าสุดยังไม่ได้อนุมัติ';end if;
 update project_stages set status=p_status,version=version+1,started_at=case when p_status in ('progress','review','done')then coalesce(started_at,now())else started_at end,completed_at=case when p_status='done'then now()else null end,updated_at=now(),updated_by=auth.uid()where project_id=p_project and key=p_key returning * into r;
 insert into project_stage_history(company_id,project_id,key,department,status,actor)values(p_company,p_project,p_key,r.department,p_status,auth.uid());
 if p_key='close' and p_status='done' then update entities set data=jsonb_set(data,'{status}','"completed"'),version=version+1,updated_at=now()where id=p_project;end if;
 perform log_action(p_company,'project_stage_'||p_key||'_'||p_status,p_project::text);return r;
end$$;
revoke all on function update_project_stage(uuid,uuid,text,text,int) from public,anon;
grant execute on function update_project_stage(uuid,uuid,text,text,int) to authenticated;

-- PPTX pages 17-18: purchase lifecycle and stock transfers between warehouse/projects.
create or replace function public.purchase_action(p_company uuid,p_id uuid,p_action text) returns void language plpgsql security definer set search_path=public as $$
declare r entities;next_status text;
begin
 if not can_write_dept(p_company,'Purchasing')then raise exception 'ไม่มีสิทธิ์จัดซื้อ';end if;
 select * into r from entities where id=p_id and company_id=p_company and kind='purchases' and archived_at is null for update;
 if r.id is null then raise exception 'ไม่พบใบขอซื้อ';end if;
 if p_action='approve'then
  if member_role(p_company)not in ('owner','manager')or r.data->>'status'<>'draft'then raise exception 'ไม่มีสิทธิ์ หรือรายการนี้อนุมัติแล้ว';end if;
  next_status:='approved';
  r.data:=jsonb_set(r.data,'{poNumber}',to_jsonb(coalesce(nullif(r.data->>'poNumber',''),'PO-'||upper(left(replace(r.id::text,'-',''),12)))));
 elsif p_action='receive'then
  if not can_write_dept(p_company,'Warehouse')or r.data->>'status'not in ('approved','pending_vendor','in_progress','pending_delivery','delivered')then raise exception 'ต้องอนุมัติก่อนรับ หรือรับสินค้าไปแล้ว';end if;
  perform post_stock_movement(p_company,(r.data->>'productId')::uuid,'in',(r.data->>'quantity')::bigint,'PO:'||p_id::text,'รับตามใบสั่งซื้อ');next_status:='received';
 elsif p_action='request_vendor'and r.data->>'status'='approved'then next_status:='pending_vendor';
 elsif p_action='vendor_confirm'and r.data->>'status'='pending_vendor'then next_status:='in_progress';
 elsif p_action='dispatch'and r.data->>'status'='in_progress'then next_status:='pending_delivery';
 elsif p_action='deliver'and r.data->>'status'='pending_delivery'then next_status:='delivered';
 elsif p_action='cancel'and r.data->>'status'not in ('received','cancelled')then
  if r.data->>'status'<>'draft'and member_role(p_company)not in ('owner','manager')then raise exception 'ให้หัวหน้างานยกเลิกใบสั่งซื้อที่อนุมัติแล้ว';end if;next_status:='cancelled';
 else raise exception 'ขั้นตอนนี้ไม่สอดคล้องกับสถานะปัจจุบัน';end if;
 update entities set data=jsonb_set(r.data,'{status}',to_jsonb(next_status)),version=version+1,updated_at=now()where id=p_id;
 perform log_action(p_company,'purchase_'||p_action,p_id::text);
end$$;
create table public.project_inventory (
 company_id uuid not null references companies(id),product_id uuid not null references entities(id),project_id uuid not null references entities(id),
 quantity bigint not null default 0 check(quantity>=0),updated_at timestamptz not null default now(),primary key(product_id,project_id)
);
create table public.stock_transfers (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),product_id uuid not null references entities(id),
 from_project uuid references entities(id),to_project uuid references entities(id),quantity bigint not null check(quantity>0),
 reason text not null,reference text not null,created_by uuid references auth.users(id),created_name text not null,
 created_at timestamptz not null default now(),unique(company_id,reference),check(from_project is distinct from to_project)
);
alter table project_inventory enable row level security;alter table stock_transfers enable row level security;
create policy inventory_read on project_inventory for select to authenticated using(can_read_dept(company_id,'Warehouse') and exists(select 1 from entities e where e.id=project_id and e.company_id=project_inventory.company_id and e.archived_at is null));
create policy transfer_read on stock_transfers for select to authenticated using(can_read_dept(company_id,'Warehouse') and (from_project is null or exists(select 1 from entities e where e.id=from_project and e.company_id=stock_transfers.company_id)) and (to_project is null or exists(select 1 from entities e where e.id=to_project and e.company_id=stock_transfers.company_id)));
grant select on project_inventory,stock_transfers to authenticated;grant all on project_inventory,stock_transfers to service_role;
create function public.transfer_project_stock(p_company uuid,p_product uuid,p_from uuid,p_to uuid,p_quantity bigint,p_reference text,p_reason text)returns stock_transfers language plpgsql security definer set search_path=public as $$
declare p entities;project entities;current_qty bigint;name text;r stock_transfers;
begin
 if not can_write_dept(p_company,'Warehouse')then raise exception 'ไม่มีสิทธิ์โอนสินค้า';end if;
 if p_quantity is null or p_quantity<=0 or p_from is not distinct from p_to or length(trim(coalesce(p_reference,'')))not between 1 and 200 or length(trim(coalesce(p_reason,'')))not between 1 and 4000 then raise exception 'ข้อมูลการโอนไม่ถูกต้อง';end if;
 select * into p from entities where id=p_product and company_id=p_company and kind='products'and archived_at is null for update;
 if p.id is null then raise exception 'ไม่พบสินค้า';end if;
 if p_from is not null then select * into project from entities where id=p_from and company_id=p_company and kind='projects' and archived_at is null;if project.id is null or not can_read_dept(p_company,project.department)then raise exception 'ไม่มีสิทธิ์โครงการต้นทาง';end if;end if;
 if p_to is not null then select * into project from entities where id=p_to and company_id=p_company and kind='projects' and archived_at is null;if project.id is null or not can_read_dept(p_company,project.department)then raise exception 'ไม่มีสิทธิ์โครงการปลายทาง';end if;end if;
 if exists(select 1 from stock_transfers where company_id=p_company and reference=p_reference)then raise exception 'รายการโอนนี้บันทึกแล้ว';end if;
 if p_from is null then
  current_qty:=coalesce((p.data->>'stock')::bigint,0);if current_qty<p_quantity then raise exception 'สต็อกคลังกลางไม่เพียงพอ';end if;
  perform post_stock_movement(p_company,p_product,'out',p_quantity,'TRANSFER:'||p_reference||':out',p_reason);
 else
  select quantity into current_qty from project_inventory where product_id=p_product and project_id=p_from for update;
  if coalesce(current_qty,0)<p_quantity then raise exception 'สต็อกโครงการไม่เพียงพอ';end if;
  update project_inventory set quantity=quantity-p_quantity,updated_at=now()where product_id=p_product and project_id=p_from;
 end if;
 if p_to is null then perform post_stock_movement(p_company,p_product,'in',p_quantity,'TRANSFER:'||p_reference||':in',p_reason);
 else insert into project_inventory(company_id,product_id,project_id,quantity)values(p_company,p_product,p_to,p_quantity)on conflict(product_id,project_id)do update set quantity=project_inventory.quantity+excluded.quantity,updated_at=now();end if;
 select m.name into name from memberships m where m.company_id=p_company and m.user_id=auth.uid() and not m.disabled;
 insert into stock_transfers(company_id,product_id,from_project,to_project,quantity,reference,reason,created_by,created_name)values(p_company,p_product,p_from,p_to,p_quantity,p_reference,p_reason,auth.uid(),coalesce(name,''))returning * into r;
 perform log_action(p_company,'stock_transfer',r.id::text);return r;
end$$;
revoke all on function transfer_project_stock(uuid,uuid,uuid,uuid,bigint,text,text)from public,anon;
grant execute on function transfer_project_stock(uuid,uuid,uuid,uuid,bigint,text,text)to authenticated;

-- ZettaFlow platform: dynamic form choices, dashboard layout, subscriptions & quotas, share links, slip verification, LINE keyword approval and auto-nudge.

-- 1) Dynamic Form Designer: allow "choice" fields (with options) for categorical widgets.
create or replace function public.save_template(p_company uuid,p_name text,p_department text,p_fields jsonb,p_steps jsonb,p_id uuid default null)returns data_templates language plpgsql security definer set search_path=public as $$declare t data_templates;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if length(p_name)not between 1 and 200 or jsonb_array_length(p_fields)not between 1 and 30 or jsonb_array_length(p_steps)>20 then raise exception 'Template ไม่ถูกต้อง';end if;
 if exists(select 1 from jsonb_array_elements(p_fields)f where f->>'key'!~ '^[a-z][a-z0-9_]{0,39}$'or f->>'type'not in ('text','number','date','choice')or(f->>'type'='choice'and coalesce(jsonb_typeof(f->'options')<>'array'or jsonb_array_length(f->'options')not between 2 and 20,true)))or (select count(*)from jsonb_array_elements(p_fields))<>(select count(distinct f->>'key')from jsonb_array_elements(p_fields)f)then raise exception 'ฟิลด์ไม่ถูกต้อง';end if;
 if p_id is null then insert into data_templates(company_id,name,department,fields,steps)values(p_company,p_name,p_department,p_fields,p_steps)returning * into t;else update data_templates set name=p_name,department=p_department,fields=p_fields,steps=p_steps,version=version+1 where id=p_id and company_id=p_company returning * into t;if not found then raise exception 'ไม่พบ Template';end if;end if;perform log_action(p_company,'template_saved',t.id::text);return t;end$$;

-- Choice-field breakdowns (auto pie widgets). Department-scoped for members.
create or replace function public.template_breakdowns(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(b)),'[]')from(
 select t.id::text||':'||(f->>'key')as key,t.name,f->>'label'as label,t.department,
  coalesce((select jsonb_object_agg(v,n)from(select i.values->>(f->>'key')v,count(*)n from ingestions i where i.company_id=t.company_id and i.template->>'id'=t.id::text and i.status='approved'and jsonb_typeof(i.values->(f->>'key'))='string'group by 1)x),'{}')as buckets
 from data_templates t cross join lateral jsonb_array_elements(t.fields)f
 where t.company_id=p_company and can_read_dept(t.company_id,t.department)and f->>'type'='choice')b$$;

-- Dashboard layout (order / hidden / per-widget roles) stored in companies.settings.dashboard.
create or replace function public.save_dashboard_layout(p_company uuid,p_layout jsonb)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if jsonb_typeof(p_layout)<>'object'or length(p_layout::text)>20000 then raise exception 'Layout ไม่ถูกต้อง';end if;
 update companies set settings=jsonb_set(settings,'{dashboard}',p_layout,true)where id=p_company;perform log_action(p_company,'dashboard_layout',p_company::text);end$$;

-- 2) Subscriptions, quotas and overage.
create table public.plans(id text primary key,name text not null,monthly numeric not null,yearly numeric not null,workflows int,documents int,line_groups int,users int,ordinal int not null);
insert into plans values('starter','Starter',1190,11900,5,1000,2,2,1),('growth','Growth',3490,34900,20,4000,10,10,2),('enterprise','Enterprise',8900,89000,null,null,null,null,3);
create table public.subscriptions(company_id uuid primary key references companies(id),plan text not null references plans(id) default 'growth',cycle text not null default 'monthly' check(cycle in ('monthly','yearly')),status text not null default 'trial' check(status in ('trial','active','past_due','cancelled')),trial_ends_at timestamptz not null default now()+interval '14 days',current_period_end timestamptz,addons text[] not null default '{}',extra_users int not null default 0 check(extra_users between 0 and 1000),updated_at timestamptz not null default now());
create table public.billing_payments(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),plan text not null references plans(id),cycle text not null check(cycle in ('monthly','yearly')),amount numeric not null check(amount>0),attachment_id uuid references attachments(id),slip jsonb not null default '{}',slip_ref text,status text not null default 'pending' check(status in ('pending','verified','rejected')),note text,created_by uuid,created_at timestamptz not null default now(),decided_at timestamptz,unique(slip_ref));
alter table plans enable row level security;alter table subscriptions enable row level security;alter table billing_payments enable row level security;
create policy plans_read on plans for select to anon,authenticated using(true);
create policy subscription_read on subscriptions for select to authenticated using(member_role(company_id)is not null);
create policy billing_read on billing_payments for select to authenticated using(member_role(company_id)='owner');
insert into subscriptions(company_id)select id from companies on conflict do nothing;
create function public.start_trial()returns trigger language plpgsql security definer set search_path=public as $$begin insert into subscriptions(company_id)values(new.id)on conflict do nothing;return new;end$$;
create trigger companies_trial after insert on companies for each row execute function start_trial();

create or replace function public.subscription_active(c uuid)returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select status='active'and(current_period_end is null or current_period_end>now()-interval '3 days')or status='trial'and trial_ends_at>now() from subscriptions where company_id=c),false)$$;
create or replace function public.plan_limit(c uuid,r text)returns int language sql stable security definer set search_path=public as $$
 select case r when 'workflows' then p.workflows when 'documents' then p.documents when 'line_groups' then p.line_groups when 'users' then p.users+s.extra_users end
 from subscriptions s join plans p on p.id=s.plan where s.company_id=c$$;
create or replace function public.usage_summary(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select case when member_role(p_company)is null then null else jsonb_build_object(
  'subscription',(select to_jsonb(s)from subscriptions s where company_id=p_company),
  'plan',(select to_jsonb(p)from plans p join subscriptions s on s.plan=p.id where s.company_id=p_company),
  'active',subscription_active(p_company),
  'usage',jsonb_build_object(
   'workflows',(select count(*)from data_templates where company_id=p_company),
   'documents',(select count(*)from ingestions where company_id=p_company and created_at>=date_trunc('month',now())),
   'ocr',(select count(*)from ingestions where company_id=p_company and attachment_id is not null and created_at>=date_trunc('month',now())),
   'ai_runs',(select count(*)from ingestions where company_id=p_company and engine='ai'and created_at>=date_trunc('month',now())),
   'line_groups',(select count(*)from line_groups where company_id=p_company),
   'users',(select count(*)from memberships where company_id=p_company and not disabled)),
  'limits',jsonb_build_object('workflows',plan_limit(p_company,'workflows'),'documents',plan_limit(p_company,'documents'),'line_groups',plan_limit(p_company,'line_groups'),'users',plan_limit(p_company,'users'))) end$$;

create or replace function public.enforce_quota()returns trigger language plpgsql security definer set search_path=public as $$declare r text;n bigint;l int;begin
 r=tg_argv[0];
 if not subscription_active(new.company_id)then raise exception 'แพ็กเกจหมดอายุ กรุณาต่ออายุการใช้งาน';end if;
 if r='documents'then return new;end if; -- documents never block: overage is billed next cycle
 l=plan_limit(new.company_id,r);if l is null then return new;end if;
 if r='workflows'then select count(*)into n from data_templates where company_id=new.company_id;
 elsif r='line_groups'then if exists(select 1 from line_groups where group_id=new.group_id)then return new;end if;select count(*)into n from line_groups where company_id=new.company_id;
 elsif r='users'then if new.disabled then return new;end if;select count(*)into n from memberships where company_id=new.company_id and not disabled;end if;
 if n>=l then raise exception 'เกินโควตาแพ็กเกจ (%: %) กรุณาอัปเกรด',r,l;end if;return new;end$$;
create trigger quota_workflows before insert on data_templates for each row execute function enforce_quota('workflows');
create trigger quota_line_groups before insert on line_groups for each row execute function enforce_quota('line_groups');
create trigger quota_users before insert on memberships for each row execute function enforce_quota('users');
create trigger quota_documents before insert on ingestions for each row execute function enforce_quota('documents');

create or replace function public.request_payment(p_company uuid,p_plan text,p_cycle text,p_attachment uuid,p_slip jsonb,p_ref text)returns billing_payments language plpgsql security definer set search_path=public as $$declare p plans;b billing_payments;a numeric;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 select * into p from plans where id=p_plan;if not found or p_cycle not in ('monthly','yearly')then raise exception 'แพ็กเกจไม่ถูกต้อง';end if;
 if p_ref is not null and exists(select 1 from billing_payments where slip_ref=p_ref)then raise exception 'สลิปนี้ถูกใช้แล้ว';end if;
 a=round((case when p_cycle='yearly'then p.yearly else p.monthly end)*1.07,2);
 insert into billing_payments(company_id,plan,cycle,amount,attachment_id,slip,slip_ref,created_by)values(p_company,p_plan,p_cycle,a,p_attachment,coalesce(p_slip,'{}'),p_ref,auth.uid())returning * into b;
 perform log_action(p_company,'payment_requested',b.id::text);return b;end$$;
-- Platform operator (service role) confirms the transfer and activates the plan.
create or replace function public.confirm_payment(p_id uuid,p_status text,p_note text default null)returns void language plpgsql security definer set search_path=public as $$declare b billing_payments;begin
 select * into b from billing_payments where id=p_id for update;if not found or b.status<>'pending'or p_status not in ('verified','rejected')then raise exception 'รายการไม่ถูกต้อง';end if;
 update billing_payments set status=p_status,note=p_note,decided_at=now()where id=p_id;
 if p_status='verified'then update subscriptions set plan=b.plan,cycle=b.cycle,status='active',current_period_end=greatest(coalesce(current_period_end,now()),now())+case when b.cycle='yearly'then interval '1 year' else interval '1 month' end,updated_at=now()where company_id=b.company_id;end if;end$$;
revoke all on function public.confirm_payment(uuid,text,text)from public,anon,authenticated;grant execute on function public.confirm_payment(uuid,text,text)to service_role;
create or replace function public.expire_subscriptions()returns int language sql security definer set search_path=public as $$
 with x as(update subscriptions set status='past_due',updated_at=now()where status='active'and current_period_end<now()-interval '3 days' returning 1)select count(*)::int from x$$;
revoke all on function public.expire_subscriptions()from public,anon,authenticated;grant execute on function public.expire_subscriptions()to service_role;

-- 3) Share dashboard links (password + expiry). Resolved only by the server with the service role.
create table public.dashboard_shares(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),token_hash text not null unique,password_hash text,label text not null default '',widget_keys text[] not null default '{}',expires_at timestamptz not null,revoked_at timestamptz,created_by uuid,created_at timestamptz not null default now(),check(expires_at<=created_at+interval '366 days'));
alter table dashboard_shares enable row level security;
create policy share_read on dashboard_shares for select to authenticated using(member_role(company_id)='owner');
create or replace function public.create_share(p_company uuid,p_hash text,p_password text,p_label text,p_keys text[],p_expires timestamptz)returns dashboard_shares language plpgsql security definer set search_path=public as $$declare s dashboard_shares;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if p_expires<=now()or p_expires>now()+interval '365 days'then raise exception 'วันหมดอายุไม่ถูกต้อง';end if;
 if coalesce(array_length(p_keys,1),0)not between 1 and 50 then raise exception 'เลือก Widget อย่างน้อย 1 รายการ';end if;
 insert into dashboard_shares(company_id,token_hash,password_hash,label,widget_keys,expires_at,created_by)values(p_company,p_hash,p_password,left(coalesce(p_label,''),200),p_keys,p_expires,auth.uid())returning * into s;
 perform log_action(p_company,'share_created',s.id::text);return s;end$$;
create or replace function public.revoke_share(p_company uuid,p_id uuid)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 update dashboard_shares set revoked_at=now()where id=p_id and company_id=p_company;perform log_action(p_company,'share_revoked',p_id::text);end$$;
-- Metrics for a share (no member context): only the selected widget keys of that company.
create or replace function public.share_metrics(p_company uuid,p_keys text[])returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(m)),'[]')from(
 select t.id::text||':'||(f->>'key')as key,t.name,f->>'label'as label,f->>'type'as type,
  coalesce((select sum((i.values->>(f->>'key'))::numeric)from ingestions i where i.company_id=t.company_id and i.template->>'id'=t.id::text and i.status='approved'and jsonb_typeof(i.values->(f->>'key'))='number'),0)as total,
  (select count(*)from ingestions i where i.company_id=t.company_id and i.template->>'id'=t.id::text and i.status='approved'and jsonb_typeof(i.values->(f->>'key'))in('number','string'))as count,
  coalesce((select jsonb_object_agg(v,n)from(select i.values->>(f->>'key')v,count(*)n from ingestions i where i.company_id=t.company_id and i.template->>'id'=t.id::text and i.status='approved'and f->>'type'='choice'and jsonb_typeof(i.values->(f->>'key'))='string'group by 1)x),'{}')as buckets
 from data_templates t cross join lateral jsonb_array_elements(t.fields)f
 where t.company_id=p_company and f->>'type'in('number','choice')and t.id::text||':'||(f->>'key')=any(p_keys))m$$;
revoke all on function public.share_metrics(uuid,text[])from public,anon,authenticated;grant execute on function public.share_metrics(uuid,text[])to service_role;

-- 4) Slip verification ledger (prevents re-use of the same transfer reference).
create table public.payment_slips(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),ingestion_id uuid references ingestions(id),attachment_id uuid references attachments(id),trans_ref text not null,sending_bank text,amount numeric,expected_amount numeric,status text not null check(status in ('verified','mismatch','duplicate','unreadable')),created_at timestamptz not null default now(),unique(company_id,trans_ref));
alter table payment_slips enable row level security;
create policy slip_read on payment_slips for select to authenticated using(can_read_dept(company_id,'Finance'));

-- 5) LINE: per-group approval keywords, auto-nudge, quick stats.
alter table public.line_groups add column approve_keywords text[] not null default array['อนุมัติ','อนุมัติปล่อยของ'],add column name text not null default '',add column created_at timestamptz not null default now();
alter table public.ingestions add column nudged_at timestamptz;
create or replace function public.update_line_group(p_company uuid,p_group text,p_template uuid,p_name text,p_keywords text[])returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if not exists(select 1 from data_templates where id=p_template and company_id=p_company)then raise exception 'ไม่พบ Template';end if;
 if coalesce(array_length(p_keywords,1),0)not between 1 and 10 or exists(select 1 from unnest(p_keywords)k where length(trim(k))not between 2 and 50)then raise exception 'คีย์เวิร์ดไม่ถูกต้อง';end if;
 update line_groups set template_id=p_template,name=left(coalesce(p_name,''),100),approve_keywords=p_keywords where group_id=p_group and company_id=p_company;if not found then raise exception 'ไม่พบกลุ่ม';end if;
 perform log_action(p_company,'line_group_updated',p_group);end$$;
create or replace function public.unlink_line_group(p_company uuid,p_group text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 delete from line_groups where group_id=p_group and company_id=p_company;perform log_action(p_company,'line_group_unlinked',p_group);end$$;
-- Keyword approval: a manager types e.g. "อนุมัติปล่อยของ" → approves the latest complete item awaiting review in that group.
create or replace function public.line_keyword_approve(p_group text,p_user text,p_text text)returns uuid language plpgsql security definer set search_path=public as $$declare g line_groups;i uuid;begin
 select * into g from line_groups where group_id=p_group;if not found then return null;end if;
 if not exists(select 1 from unnest(g.approve_keywords)k where trim(p_text)=k)then return null;end if;
 select id into i from ingestions where company_id=g.company_id and group_id=p_group and status='review'and jsonb_array_length(missing)=0 order by created_at desc limit 1;
 if i is null then raise exception 'ไม่มีรายการที่พร้อมอนุมัติ';end if;
 perform line_approve(p_group,p_user,i);return i;end$$;
revoke all on function public.line_keyword_approve(text,text,text)from public,anon,authenticated;grant execute on function public.line_keyword_approve(text,text,text)to service_role;
-- Re-nudge senders whose items are still missing data after 12 hours (runs from cron).
create or replace function public.queue_nudges()returns int language plpgsql security definer set search_path=public as $$declare n int;begin
 with x as(update ingestions set nudged_at=now()where status='review'and group_id is not null and jsonb_array_length(missing)>0 and created_at<now()-interval '12 hours'and(nudged_at is null)returning *)
 insert into notification_outbox(company_id,target,body)select company_id,group_id,left('⏰ ZettaFlow เตือน: รายการ '||left(id::text,8)||' ยังขาดข้อมูล '||(select string_agg(value,', ')from jsonb_array_elements_text(missing))||chr(10)||'กรุณาส่งข้อมูลเพิ่มในกลุ่มนี้',4500)from x;
 get diagnostics n=row_count;return n;end$$;
revoke all on function public.queue_nudges()from public,anon,authenticated;grant execute on function public.queue_nudges()to service_role;
create or replace function public.complete_ingestion(p_id uuid,p_lease uuid,p_values jsonb,p_missing jsonb,p_engine text)returns void language plpgsql security definer set search_path=public as $$declare i ingestions;k text;begin
 select * into i from ingestions where id=p_id and lease_id=p_lease and status='processing'for update;if not found then return;end if;
 update ingestions set values=p_values,missing=p_missing,engine=p_engine,status='review',lease_until=null where id=p_id;
 select approve_keywords[1]into k from line_groups where group_id=i.group_id;
 if i.group_id is not null then insert into notification_outbox(id,company_id,target,body)values(i.id,i.company_id,i.group_id,left(case when jsonb_array_length(p_missing)>0
  then '⚠️ ZettaFlow: ข้อมูลยังไม่ครบ ('||left(i.id::text,8)||')'||chr(10)||'กรุณาส่งเพิ่ม: '||(select string_agg(value,', ')from jsonb_array_elements_text(p_missing))
  else '✅ ZettaFlow: บันทึกรายการ '||left(i.id::text,8)||' แล้ว รอผู้จัดการอนุมัติ'||chr(10)||'ผู้จัดการพิมพ์ "'||coalesce(k,'อนุมัติ')||'" หรือ #approve '||i.id::text end,4500))on conflict(id)do nothing;end if;end$$;
revoke execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)from public,anon,authenticated;grant execute on function complete_ingestion(uuid,uuid,jsonb,jsonb,text)to service_role;
-- Read-only numbers the bot can answer in chat (service role only).
create or replace function public.line_quick_stats(p_group text)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'company',(select name from companies where id=g.company_id),
  'review',(select count(*)from ingestions where company_id=g.company_id and status='review'),
  'missing',(select count(*)from ingestions where company_id=g.company_id and status='review'and jsonb_array_length(missing)>0),
  'pendingDeals',(select count(*)from entities where company_id=g.company_id and kind='deals'and data->>'status'='pending'and archived_at is null),
  'openTasks',(select count(*)from entities where company_id=g.company_id and kind='tasks'and coalesce(data->>'status','')<>'done'and archived_at is null),
  'activeProjects',(select count(*)from entities where company_id=g.company_id and kind='projects'and data->>'status'in('active','planning')and archived_at is null),
  'salesToday',(select coalesce(sum((data->>'amount')::numeric),0)from entities where company_id=g.company_id and kind='sales'and data->>'status'='confirmed'and archived_at is null and data->>'date'=to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD')),
  'salesMonth',(select coalesce(sum((data->>'amount')::numeric),0)from entities where company_id=g.company_id and kind='sales'and data->>'status'='confirmed'and archived_at is null and left(data->>'date',7)=to_char(now() at time zone 'Asia/Bangkok','YYYY-MM')))
 from line_groups g where g.group_id=p_group$$;
revoke all on function public.line_quick_stats(text)from public,anon,authenticated;grant execute on function public.line_quick_stats(text)to service_role;

-- Grants (match 0001 pattern: members read through RLS, writes only via RPCs; service role runs workers).
revoke all on table plans,subscriptions,billing_payments,dashboard_shares,payment_slips from anon,authenticated;
grant select on plans to anon,authenticated;
grant select on subscriptions,billing_payments,dashboard_shares,payment_slips to authenticated;
grant all on plans,subscriptions,billing_payments,dashboard_shares,payment_slips to service_role;
revoke all on function public.save_dashboard_layout(uuid,jsonb),public.request_payment(uuid,text,text,uuid,jsonb,text),public.create_share(uuid,text,text,text,text[],timestamptz),public.revoke_share(uuid,uuid),public.update_line_group(uuid,text,uuid,text,text[]),public.unlink_line_group(uuid,text),public.usage_summary(uuid),public.template_breakdowns(uuid) from public,anon;
grant execute on function public.save_dashboard_layout(uuid,jsonb),public.request_payment(uuid,text,text,uuid,jsonb,text),public.create_share(uuid,text,text,text,text[],timestamptz),public.revoke_share(uuid,uuid),public.update_line_group(uuid,text,uuid,text,text[]),public.unlink_line_group(uuid,text),public.usage_summary(uuid),public.template_breakdowns(uuid) to authenticated;
revoke all on function public.subscription_active(uuid),public.plan_limit(uuid,text),public.enforce_quota(),public.start_trial() from public,anon,authenticated;

-- Rate limit wrong passwords on shared dashboard links (server/service role only).
create table public.share_attempts(id bigint generated always as identity primary key,token_hash text not null,client_hash text not null,created_at timestamptz not null default now());
create index share_attempts_lookup on share_attempts(token_hash,created_at desc);
create index share_attempts_client on share_attempts(client_hash,created_at desc);
alter table share_attempts enable row level security;
revoke all on share_attempts from anon,authenticated;grant all on share_attempts to service_role;
-- Returns seconds to wait (0 = allowed). Limits: 5 failures per link per client / 15 min, 20 per link overall / 15 min, 30 per client across links / hour.
create or replace function public.share_lockout(p_token text,p_client text)returns int language sql stable security definer set search_path=public as $$
 select case when
  (select count(*)from share_attempts where token_hash=p_token and client_hash=p_client and created_at>now()-interval '15 minutes')>=5
  or(select count(*)from share_attempts where token_hash=p_token and created_at>now()-interval '15 minutes')>=20
  or(select count(*)from share_attempts where client_hash=p_client and created_at>now()-interval '1 hour')>=30
 then 900 else 0 end$$;
create or replace function public.share_failed(p_token text,p_client text)returns void language sql security definer set search_path=public as $$
 delete from share_attempts where created_at<now()-interval '1 day';
 insert into share_attempts(token_hash,client_hash)values(p_token,p_client)$$;
revoke all on function public.share_lockout(text,text),public.share_failed(text,text)from public,anon,authenticated;
grant execute on function public.share_lockout(text,text),public.share_failed(text,text)to service_role;

-- Add-ons as purchasable entitlements, Enterprise fair use, AI usage metering, free LINE replies.

-- Enterprise is no longer literally unlimited: 20,000 documents/month fair use, then overage.
update plans set documents=20000 where id='enterprise';

create table public.addons(id text primary key,name text not null,monthly numeric not null check(monthly>=0),per_unit boolean not null default false,ordinal int not null);
insert into addons values
 ('ocr_plus','AI OCR Plus',599,false,1),
 ('exec_dashboard','Executive Dashboard + AI Insight',990,false,2),
 ('extra_user','Additional Dashboard User',150,true,3),
 ('erp','ERP / Accounting Integration',1000,false,4),
 ('custom_workflow','AI Custom Workflow',3000,false,5),
 ('custom_form','AI Custom Form Designer',2500,false,6);
alter table addons enable row level security;
create policy addons_read on addons for select to anon,authenticated using(true);
revoke all on addons from anon,authenticated;grant select on addons to anon,authenticated;grant all on addons to service_role;

alter table billing_payments add column addons text[] not null default '{}',add column extra_users int not null default 0 check(extra_users between 0 and 1000);

drop function if exists public.request_payment(uuid,text,text,uuid,jsonb,text);
create function public.request_payment(p_company uuid,p_plan text,p_cycle text,p_attachment uuid,p_slip jsonb,p_ref text,p_addons text[] default '{}',p_extra_users int default 0)returns billing_payments language plpgsql security definer set search_path=public as $$declare p plans;b billing_payments;base numeric;extra numeric;months int;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 select * into p from plans where id=p_plan;if not found or p_cycle not in ('monthly','yearly')then raise exception 'แพ็กเกจไม่ถูกต้อง';end if;
 if exists(select 1 from unnest(coalesce(p_addons,'{}'))a where a not in(select id from addons where not per_unit))then raise exception 'Add-on ไม่ถูกต้อง';end if;
 if coalesce(p_extra_users,0)not between 0 and 1000 then raise exception 'จำนวนผู้ใช้เพิ่มไม่ถูกต้อง';end if;
 if p_ref is not null and exists(select 1 from billing_payments where slip_ref=p_ref)then raise exception 'สลิปนี้ถูกใช้แล้ว';end if;
 months=case when p_cycle='yearly'then 10 else 1 end; -- yearly = 2 months free, add-ons included
 base=case when p_cycle='yearly'then p.yearly else p.monthly end;
 extra=coalesce((select sum(monthly)from addons where id=any(p_addons)),0)*months+(select monthly from addons where id='extra_user')*coalesce(p_extra_users,0)*months;
 insert into billing_payments(company_id,plan,cycle,amount,attachment_id,slip,slip_ref,created_by,addons,extra_users)values(p_company,p_plan,p_cycle,round((base+extra)*1.07,2),p_attachment,coalesce(p_slip,'{}'),p_ref,auth.uid(),coalesce(p_addons,'{}'),coalesce(p_extra_users,0))returning * into b;
 perform log_action(p_company,'payment_requested',b.id::text);return b;end$$;
revoke all on function public.request_payment(uuid,text,text,uuid,jsonb,text,text[],int)from public,anon;grant execute on function public.request_payment(uuid,text,text,uuid,jsonb,text,text[],int)to authenticated;

create or replace function public.confirm_payment(p_id uuid,p_status text,p_note text default null)returns void language plpgsql security definer set search_path=public as $$declare b billing_payments;begin
 select * into b from billing_payments where id=p_id for update;if not found or b.status<>'pending'or p_status not in ('verified','rejected')then raise exception 'รายการไม่ถูกต้อง';end if;
 update billing_payments set status=p_status,note=p_note,decided_at=now()where id=p_id;
 if p_status='verified'then update subscriptions set plan=b.plan,cycle=b.cycle,status='active',addons=b.addons,extra_users=b.extra_users,current_period_end=greatest(coalesce(current_period_end,now()),now())+case when b.cycle='yearly'then interval '1 year' else interval '1 month' end,updated_at=now()where company_id=b.company_id;end if;end$$;
revoke all on function public.confirm_payment(uuid,text,text)from public,anon,authenticated;grant execute on function public.confirm_payment(uuid,text,text)to service_role;

-- Entitlement check usable from SQL and the server. Trial and Enterprise include the AI add-ons.
create or replace function public.has_addon(c uuid,a text)returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select s.status='trial'or s.plan='enterprise'and a in('ocr_plus','exec_dashboard')or a=any(s.addons)from subscriptions s where s.company_id=c),false)$$;
revoke all on function public.has_addon(uuid,text)from public,anon;grant execute on function public.has_addon(uuid,text)to authenticated,service_role;

-- Metering: images = OCR, PDFs = AI document analysis (pages counted on the server).
alter table public.ingestions add column pages int,add column reply_token text;
create or replace function public.usage_summary(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select case when member_role(p_company)is null then null else jsonb_build_object(
  'subscription',(select to_jsonb(s)from subscriptions s where company_id=p_company),
  'plan',(select to_jsonb(p)from plans p join subscriptions s on s.plan=p.id where s.company_id=p_company),
  'active',subscription_active(p_company),
  'usage',jsonb_build_object(
   'workflows',(select count(*)from data_templates where company_id=p_company),
   'documents',(select count(*)from ingestions where company_id=p_company and created_at>=date_trunc('month',now())),
   'ocr',(select count(*)from ingestions i join attachments a on a.id=i.attachment_id where i.company_id=p_company and a.mime like 'image/%'and i.created_at>=date_trunc('month',now())),
   'ai_runs',(select count(*)from ingestions i join attachments a on a.id=i.attachment_id where i.company_id=p_company and a.mime='application/pdf'and i.created_at>=date_trunc('month',now())),
   'pages',(select coalesce(sum(pages),0)from ingestions where company_id=p_company and created_at>=date_trunc('month',now())),
   'line_groups',(select count(*)from line_groups where company_id=p_company),
   'users',(select count(*)from memberships where company_id=p_company and not disabled)),
  'limits',jsonb_build_object('workflows',plan_limit(p_company,'workflows'),'documents',plan_limit(p_company,'documents'),'line_groups',plan_limit(p_company,'line_groups'),'users',plan_limit(p_company,'users'))) end$$;

-- Platform-level promotions/announcements (managed by ZettaFlow operators) and customer support chat.

create table public.promos(id uuid primary key default gen_random_uuid(),title text not null check(length(title)between 1 and 120),body text not null default '' check(length(body)<=500),cta_label text not null default '' check(length(cta_label)<=40),cta_url text not null default '' check(cta_url='' or cta_url ~ '^(https://|/)'),tone text not null default 'violet' check(tone in('violet','pink','blue','green')),active boolean not null default true,starts_at timestamptz not null default now(),ends_at timestamptz,ordinal int not null default 0,created_at timestamptz not null default now());
create table public.announcements(id uuid primary key default gen_random_uuid(),title text not null check(length(title)between 1 and 120),body text not null check(length(body)between 1 and 2000),level text not null default 'info' check(level in('info','success','warning')),popup boolean not null default true,active boolean not null default true,published_at timestamptz not null default now(),expires_at timestamptz);
alter table promos enable row level security;alter table announcements enable row level security;
create policy promos_read on promos for select to anon,authenticated using(active and starts_at<=now()and(ends_at is null or ends_at>now()));
create policy announcements_read on announcements for select to anon,authenticated using(active and published_at<=now()and(expires_at is null or expires_at>now()));
revoke all on promos,announcements from anon,authenticated;grant select on promos,announcements to anon,authenticated;grant all on promos,announcements to service_role;

create table public.support_threads(company_id uuid primary key references companies(id),unread_admin int not null default 0,unread_customer int not null default 0,status text not null default 'open' check(status in('open','closed')),updated_at timestamptz not null default now());
create table public.support_messages(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),sender text not null check(sender in('customer','admin')),user_id uuid,name text not null,body text not null check(length(body)between 1 and 4000),created_at timestamptz not null default now());
create index support_messages_company on support_messages(company_id,created_at);
alter table support_threads enable row level security;alter table support_messages enable row level security;
create policy support_thread_read on support_threads for select to authenticated using(member_role(company_id)in('owner','manager'));
create policy support_message_read on support_messages for select to authenticated using(member_role(company_id)in('owner','manager'));
revoke all on support_threads,support_messages from anon,authenticated;grant select on support_threads,support_messages to authenticated;grant all on support_threads,support_messages to service_role;

-- Customer side: owners and managers write to their company's thread.
create or replace function public.support_send(p_company uuid,p_body text)returns support_messages language plpgsql security definer set search_path=public as $$declare m support_messages;n text;begin
 if member_role(p_company)not in('owner','manager')then raise exception 'เฉพาะ Owner หรือ Manager';end if;
 if length(trim(p_body))not between 1 and 4000 then raise exception 'ข้อความไม่ถูกต้อง';end if;
 select coalesce(nullif(name,''),email)into n from memberships where company_id=p_company and user_id=auth.uid();
 insert into support_messages(company_id,sender,user_id,name,body)values(p_company,'customer',auth.uid(),n,trim(p_body))returning * into m;
 insert into support_threads(company_id,unread_admin,status,updated_at)values(p_company,1,'open',now())on conflict(company_id)do update set unread_admin=support_threads.unread_admin+1,status='open',updated_at=now();
 return m;end$$;
create or replace function public.support_seen(p_company uuid)returns void language sql security definer set search_path=public as $$
 update support_threads set unread_customer=0 where company_id=p_company and member_role(p_company)in('owner','manager')$$;
revoke all on function public.support_send(uuid,text),public.support_seen(uuid)from public,anon;grant execute on function public.support_send(uuid,text),public.support_seen(uuid)to authenticated;

-- Operator side (service role only).
create or replace function public.support_reply(p_company uuid,p_name text,p_body text)returns support_messages language plpgsql security definer set search_path=public as $$declare m support_messages;begin
 if length(trim(p_body))not between 1 and 4000 then raise exception 'ข้อความไม่ถูกต้อง';end if;
 insert into support_messages(company_id,sender,name,body)values(p_company,'admin',left(coalesce(nullif(p_name,''),'ทีมงาน ZettaFlow'),100),trim(p_body))returning * into m;
 insert into support_threads(company_id,unread_customer,updated_at)values(p_company,1,now())on conflict(company_id)do update set unread_customer=support_threads.unread_customer+1,unread_admin=0,updated_at=now();
 return m;end$$;
revoke all on function public.support_reply(uuid,text,text)from public,anon,authenticated;grant execute on function public.support_reply(uuid,text,text)to service_role;

-- Company feed: a network-wide social timeline where companies post updates, job openings and partner requests.
-- Posts are visible to every signed-in member of any company; writes go through security-definer RPCs.

create table public.company_posts(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),author_id uuid not null,author_name text not null,kind text not null default 'post' check(kind in('post','job','partner')),body text not null check(length(body)between 1 and 5000),meta jsonb not null default '{}',images text[] not null default '{}' check(cardinality(images)<=4),created_at timestamptz not null default now(),archived_at timestamptz);
create index company_posts_feed on company_posts(created_at desc)where archived_at is null;
create index company_posts_company on company_posts(company_id,created_at desc);
create table public.post_likes(post_id uuid not null references company_posts(id)on delete cascade,user_id uuid not null,created_at timestamptz not null default now(),primary key(post_id,user_id));
create table public.post_comments(id uuid primary key default gen_random_uuid(),post_id uuid not null references company_posts(id)on delete cascade,company_id uuid not null references companies(id),author_id uuid not null,author_name text not null,body text not null check(length(body)between 1 and 2000),created_at timestamptz not null default now());
create index post_comments_post on post_comments(post_id,created_at);
create table public.company_follows(follower_id uuid not null references companies(id),company_id uuid not null references companies(id),created_at timestamptz not null default now(),primary key(follower_id,company_id),check(follower_id<>company_id));
alter table company_posts enable row level security;alter table post_likes enable row level security;alter table post_comments enable row level security;alter table company_follows enable row level security;
create policy company_posts_read on company_posts for select to authenticated using(archived_at is null);
create policy post_comments_read on post_comments for select to authenticated using(true);
create policy company_follows_read on company_follows for select to authenticated using(member_role(follower_id)is not null);
revoke all on company_posts,post_likes,post_comments,company_follows from anon,authenticated;
grant select on company_posts,post_comments,company_follows to authenticated;
grant all on company_posts,post_likes,post_comments,company_follows to service_role;

-- Post images: <company>/<post>/<n>.webp, written by that company's members, readable by any signed-in user.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('eliteflow-posts','eliteflow-posts',false,1600000,array['image/png','image/jpeg','image/webp'])on conflict(id)do nothing;
create policy eliteflow_posts_read on storage.objects for select to authenticated using(bucket_id='eliteflow-posts');
create policy eliteflow_posts_insert on storage.objects for insert to authenticated with check(bucket_id='eliteflow-posts'and member_role(((storage.foldername(name))[1])::uuid)in('owner','manager','staff'));
create policy eliteflow_posts_delete on storage.objects for delete to authenticated using(bucket_id='eliteflow-posts'and member_role(((storage.foldername(name))[1])::uuid)in('owner','manager','staff'));

create or replace function public.feed_author(p_company uuid)returns text language sql stable security definer set search_path=public as $$
 select coalesce(nullif(name,''),email)from memberships where company_id=p_company and user_id=auth.uid()and not disabled$$;
revoke all on function public.feed_author(uuid)from public,anon,authenticated;

create or replace function public.feed_post(p_company uuid,p_id uuid,p_kind text,p_body text,p_meta jsonb,p_images text[])returns company_posts language plpgsql security definer set search_path=public as $$declare p company_posts;i text;begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์โพสต์ในนามบริษัทนี้';end if;
 if p_kind not in('post','job','partner')then raise exception 'ประเภทโพสต์ไม่ถูกต้อง';end if;
 if length(trim(coalesce(p_body,'')))not between 1 and 5000 then raise exception 'เขียนข้อความโพสต์ 1–5000 ตัวอักษร';end if;
 if p_kind<>'post' and length(trim(coalesce(p_meta->>'title','')))not between 1 and 120 then raise exception 'ใส่หัวข้อประกาศ';end if;
 if jsonb_typeof(coalesce(p_meta,'{}'))<>'object' or length(coalesce(p_meta,'{}')::text)>1000 then raise exception 'ข้อมูลประกาศไม่ถูกต้อง';end if;
 if cardinality(coalesce(p_images,'{}'))>4 then raise exception 'แนบรูปได้สูงสุด 4 รูป';end if;
 foreach i in array coalesce(p_images,'{}')loop
  if i !~ ('^'||p_company::text||'/'||p_id::text||'/[0-9]\.(webp|png|jpg)$')then raise exception 'รูปภาพไม่ถูกต้อง';end if;
 end loop;
 insert into company_posts(id,company_id,author_id,author_name,kind,body,meta,images)values(p_id,p_company,auth.uid(),feed_author(p_company),p_kind,trim(p_body),coalesce(p_meta,'{}'),coalesce(p_images,'{}'))returning * into p;
 return p;end$$;

create or replace function public.feed_delete(p_post uuid)returns void language plpgsql security definer set search_path=public as $$declare p company_posts;begin
 select * into p from company_posts where id=p_post and archived_at is null;
 if not found then raise exception 'ไม่พบโพสต์';end if;
 if p.author_id is distinct from auth.uid() and member_role(p.company_id)is distinct from 'owner' then raise exception 'ลบได้เฉพาะผู้โพสต์หรือเจ้าของบริษัท';end if;
 update company_posts set archived_at=now()where id=p_post;end$$;

create or replace function public.feed_like(p_post uuid)returns jsonb language plpgsql security definer set search_path=public as $$declare liked boolean;begin
 if auth.uid()is null or not exists(select 1 from memberships where user_id=auth.uid()and not disabled)then raise exception 'เข้าสู่ระบบก่อน';end if;
 if not exists(select 1 from company_posts where id=p_post and archived_at is null)then raise exception 'ไม่พบโพสต์';end if;
 delete from post_likes where post_id=p_post and user_id=auth.uid();
 liked=not found;
 if liked then insert into post_likes(post_id,user_id)values(p_post,auth.uid());end if;
 return jsonb_build_object('liked',liked,'likes',(select count(*)from post_likes where post_id=p_post));end$$;

create or replace function public.feed_comment(p_company uuid,p_post uuid,p_body text)returns post_comments language plpgsql security definer set search_path=public as $$declare c post_comments;begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์แสดงความคิดเห็น';end if;
 if length(trim(coalesce(p_body,'')))not between 1 and 2000 then raise exception 'ความคิดเห็นยาว 1–2000 ตัวอักษร';end if;
 if not exists(select 1 from company_posts where id=p_post and archived_at is null)then raise exception 'ไม่พบโพสต์';end if;
 insert into post_comments(post_id,company_id,author_id,author_name,body)values(p_post,p_company,auth.uid(),feed_author(p_company),trim(p_body))returning * into c;
 return c;end$$;

create or replace function public.feed_follow(p_company uuid,p_target uuid)returns boolean language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์';end if;
 if p_company=p_target or not exists(select 1 from companies where id=p_target)then raise exception 'ติดตามบริษัทนี้ไม่ได้';end if;
 delete from company_follows where follower_id=p_company and company_id=p_target;
 if found then return false;end if;
 insert into company_follows(follower_id,company_id)values(p_company,p_target);return true;end$$;

-- Public card of a company: only what a feed shows, never the full profile.
create or replace function public.company_card(p_id uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'name',name,'industry',coalesce(profile->>'industry',''),'province',coalesce(profile->>'province',''),'about',left(coalesce(profile->>'description',''),300),'logo',coalesce(profile->>'logo',''))
 from companies where id=p_id and auth.uid()is not null$$;

create or replace function public.feed_list(p_company uuid,p_filter text default 'all',p_before timestamptz default null,p_limit int default 20)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(item order by (item->>'created_at')desc)from(
  select jsonb_build_object(
   'id',p.id,'company_id',p.company_id,'author_name',p.author_name,'kind',p.kind,'body',p.body,'meta',p.meta,'images',to_jsonb(p.images),'created_at',p.created_at,
   'company',jsonb_build_object('name',c.name,'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),'has_logo',coalesce(c.profile->>'logo','')<>''),
   'likes',(select count(*)from post_likes l where l.post_id=p.id),
   'liked',exists(select 1 from post_likes l where l.post_id=p.id and l.user_id=auth.uid()),
   'comment_count',(select count(*)from post_comments m where m.post_id=p.id),
   'comments',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_name',m.author_name,'company_name',mc.name,'body',m.body,'created_at',m.created_at)order by m.created_at)from(select * from post_comments where post_id=p.id order by created_at desc limit 3)m join companies mc on mc.id=m.company_id),'[]'),
   'following',exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=p.company_id),
   'mine',p.company_id=p_company,
   'can_delete',p.author_id=auth.uid()or member_role(p.company_id)='owner') as item
  from company_posts p join companies c on c.id=p.company_id
  where p.archived_at is null and(p_before is null or p.created_at<p_before)
   and case p_filter when 'following' then p.company_id=p_company or exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=p.company_id)
    when 'post' then p.kind='post' when 'job' then p.kind='job' when 'partner' then p.kind='partner' when 'mine' then p.company_id=p_company else true end
  order by p.created_at desc limit least(greatest(coalesce(p_limit,20),1),50))q),'[]');end$$;

create or replace function public.feed_suggest(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'industry',s.industry,'has_logo',s.has_logo)),'[]')from(
  select c.id,c.name,coalesce(c.profile->>'industry','')industry,coalesce(c.profile->>'logo','')<>'' has_logo,max(p.created_at)last_post
  from companies c join company_posts p on p.company_id=c.id and p.archived_at is null
  where member_role(p_company)is not null and c.id<>p_company and not exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=c.id)
  group by c.id order by last_post desc limit 5)s$$;

revoke all on function public.feed_post(uuid,uuid,text,text,jsonb,text[]),public.feed_delete(uuid),public.feed_like(uuid),public.feed_comment(uuid,uuid,text),public.feed_follow(uuid,uuid),public.company_card(uuid),public.feed_list(uuid,text,timestamptz,int),public.feed_suggest(uuid)from public,anon;
grant execute on function public.feed_post(uuid,uuid,text,text,jsonb,text[]),public.feed_delete(uuid),public.feed_like(uuid),public.feed_comment(uuid,uuid,text),public.feed_follow(uuid,uuid),public.company_card(uuid),public.feed_list(uuid,text,timestamptz,int),public.feed_suggest(uuid)to authenticated;

-- Job & partner matching: a company sends a proposal to a job or partner post; the posting company reviews it.

create table public.post_proposals(id uuid primary key default gen_random_uuid(),post_id uuid not null references company_posts(id)on delete cascade,company_id uuid not null references companies(id),author_id uuid not null,author_name text not null,message text not null check(length(message)between 1 and 3000),contact text not null default '' check(length(contact)<=200),status text not null default 'sent' check(status in('sent','shortlisted','declined')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(post_id,company_id));
create index post_proposals_company on post_proposals(company_id,created_at desc);
alter table post_proposals enable row level security;
-- Visible to the proposing company and to the company that owns the post.
create policy post_proposals_read on post_proposals for select to authenticated using(member_role(company_id)is not null or exists(select 1 from company_posts p where p.id=post_id and member_role(p.company_id)is not null));
revoke all on post_proposals from anon,authenticated;grant select on post_proposals to authenticated;grant all on post_proposals to service_role;

create or replace function public.feed_propose(p_company uuid,p_post uuid,p_message text,p_contact text)returns post_proposals language plpgsql security definer set search_path=public as $$declare p company_posts;r post_proposals;begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์ส่งข้อเสนอในนามบริษัทนี้';end if;
 select * into p from company_posts where id=p_post and archived_at is null;
 if not found or p.kind not in('job','partner')then raise exception 'ไม่พบประกาศ';end if;
 if p.company_id=p_company then raise exception 'เสนอให้ประกาศของบริษัทตัวเองไม่ได้';end if;
 if length(trim(coalesce(p_message,'')))not between 1 and 3000 then raise exception 'เขียนข้อเสนอ 1–3000 ตัวอักษร';end if;
 if length(coalesce(p_contact,''))>200 then raise exception 'ช่องทางติดต่อยาวเกินไป';end if;
 if exists(select 1 from post_proposals where post_id=p_post and company_id=p_company)then raise exception 'บริษัทของคุณส่งข้อเสนอให้ประกาศนี้แล้ว';end if;
 insert into post_proposals(post_id,company_id,author_id,author_name,message,contact)values(p_post,p_company,auth.uid(),feed_author(p_company),trim(p_message),trim(coalesce(p_contact,'')))returning * into r;
 return r;end$$;

-- The post's company sees every proposal; a proposing company sees only its own.
create or replace function public.feed_proposals(p_company uuid,p_post uuid default null)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'post_id',r.post_id,'company_id',r.company_id,'company_name',c.name,'company_industry',coalesce(c.profile->>'industry',''),'author_name',r.author_name,'message',r.message,'contact',r.contact,'status',r.status,'created_at',r.created_at,
   'post_title',coalesce(p.meta->>'title',left(p.body,90)),'post_kind',p.kind,'post_company',pc.name,'incoming',p.company_id=p_company)order by r.created_at desc)
  from post_proposals r join company_posts p on p.id=r.post_id join companies c on c.id=r.company_id join companies pc on pc.id=p.company_id
  where (p.company_id=p_company or r.company_id=p_company)and(p_post is null or r.post_id=p_post)),'[]');end$$;

create or replace function public.feed_proposal_status(p_company uuid,p_id uuid,p_status text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)not in('owner','manager')then raise exception 'เฉพาะ Owner หรือ Manager';end if;
 if p_status not in('sent','shortlisted','declined')then raise exception 'สถานะไม่ถูกต้อง';end if;
 update post_proposals r set status=p_status,updated_at=now()from company_posts p where r.id=p_id and p.id=r.post_id and p.company_id=p_company;
 if not found then raise exception 'ไม่พบข้อเสนอ';end if;end$$;

-- feed_list gains proposal info: how many a post of ours received, and whether we already proposed.
create or replace function public.feed_list(p_company uuid,p_filter text default 'all',p_before timestamptz default null,p_limit int default 20)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(item order by (item->>'created_at')desc)from(
  select jsonb_build_object(
   'id',p.id,'company_id',p.company_id,'author_name',p.author_name,'kind',p.kind,'body',p.body,'meta',p.meta,'images',to_jsonb(p.images),'created_at',p.created_at,
   'company',jsonb_build_object('name',c.name,'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),'has_logo',coalesce(c.profile->>'logo','')<>''),
   'likes',(select count(*)from post_likes l where l.post_id=p.id),
   'liked',exists(select 1 from post_likes l where l.post_id=p.id and l.user_id=auth.uid()),
   'comment_count',(select count(*)from post_comments m where m.post_id=p.id),
   'comments',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_name',m.author_name,'company_name',mc.name,'body',m.body,'created_at',m.created_at)order by m.created_at)from(select * from post_comments where post_id=p.id order by created_at desc limit 3)m join companies mc on mc.id=m.company_id),'[]'),
   'following',exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=p.company_id),
   'mine',p.company_id=p_company,
   'can_delete',p.author_id=auth.uid()or member_role(p.company_id)='owner',
   'proposal_count',case when p.company_id=p_company then(select count(*)from post_proposals r where r.post_id=p.id)else 0 end,
   'proposed',exists(select 1 from post_proposals r where r.post_id=p.id and r.company_id=p_company)) as item
  from company_posts p join companies c on c.id=p.company_id
  where p.archived_at is null and(p_before is null or p.created_at<p_before)
   and case p_filter when 'following' then p.company_id=p_company or exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=p.company_id)
    when 'post' then p.kind='post' when 'job' then p.kind='job' when 'partner' then p.kind='partner' when 'mine' then p.company_id=p_company
    when 'offers' then p.kind in('job','partner') else true end
  order by p.created_at desc limit least(greatest(coalesce(p_limit,20),1),50))q),'[]');end$$;

revoke all on function public.feed_propose(uuid,uuid,text,text),public.feed_proposals(uuid,uuid),public.feed_proposal_status(uuid,uuid,text)from public,anon;
grant execute on function public.feed_propose(uuid,uuid,text,text),public.feed_proposals(uuid,uuid),public.feed_proposal_status(uuid,uuid,text)to authenticated;

-- Employees get a photo (image field stored as an attachment id).
insert into public.entity_schemas(kind,department,fields)values('employees','HR','[{"key":"photo","label":"รูปพนักงาน","type":"image","required":false},{"key":"name","label":"ชื่อ-นามสกุล","type":"text","required":true},{"key":"code","label":"รหัสพนักงาน","type":"text","required":false},{"key":"nickname","label":"ชื่อเล่น","type":"text","required":false},{"key":"department","label":"แผนก","type":"text","required":true},{"key":"position","label":"ตำแหน่ง","type":"text","required":false},{"key":"employmentType","label":"ประเภทการจ้าง","type":"select","required":true,"options":["ประจำ","สัญญาจ้าง","พาร์ตไทม์"]},{"key":"startDate","label":"วันเริ่มงาน","type":"date","required":false},{"key":"salary","label":"เงินเดือน","type":"number","required":false,"min":0},{"key":"birthDate","label":"วันเกิด","type":"date","required":false},{"key":"idCard","label":"เลขบัตรประชาชน","type":"text","required":false},{"key":"bank","label":"ธนาคาร","type":"text","required":false},{"key":"bankAccount","label":"เลขบัญชี","type":"text","required":false},{"key":"emergency","label":"ผู้ติดต่อฉุกเฉิน","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","on_leave","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

-- Coins (เหรียญ): owners top up by transfer slip, a platform operator confirms, coins buy department modules once (no monthly fee).
-- Expenses gain tax-document fields for AI receipt capture (supplier, document no., VAT mode, withholding).

create table public.coin_packs(coins int primary key check(coins>0),price numeric not null check(price>0),ordinal int not null);
insert into coin_packs values(50,500,1),(100,900,2),(200,1700,3),(500,4000,4);
create table public.coin_wallets(company_id uuid primary key references companies(id),balance int not null default 0 check(balance>=0),updated_at timestamptz not null default now());
create table public.coin_ledger(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),delta int not null,reason text not null check(reason in('topup','purchase','adjust')),ref text,created_by uuid,created_at timestamptz not null default now());
create index coin_ledger_company on coin_ledger(company_id,created_at);
create table public.coin_topups(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),coins int not null references coin_packs(coins),amount numeric not null,attachment_id uuid references attachments(id),slip jsonb not null default '{}',slip_ref text unique,status text not null default 'pending' check(status in('pending','verified','rejected')),note text,created_by uuid,created_at timestamptz not null default now(),decided_at timestamptz);
create table public.modules(id text primary key,department text not null,name text not null,description text not null default '',price_coins int not null check(price_coins>=0),features text[] not null default '{}',active boolean not null default true,ordinal int not null default 0);
insert into modules values
 ('accounting','Finance','ระบบบัญชี','บันทึกค่าใช้จ่ายด้วย AI อ่านใบเสร็จ ภาษีซื้อ และหัก ณ ที่จ่าย',100,array['บันทึกรายรับ-รายจ่าย','AI อ่านใบเสร็จ','รายงานภาษี'],true,1),
 ('marketing','Marketing','ระบบ Marketing','วางแผนแคมเปญ งบประมาณ ROI และกลุ่มลูกค้า',100,array['จัดการแคมเปญ','วิเคราะห์ ROI','Customer Segment'],true,2),
 ('hr','HR','ระบบ HR','ข้อมูลพนักงาน วันลา และเงินเดือน',100,array['ข้อมูลพนักงาน','ระบบการลา','คำนวณเงินเดือน'],true,3),
 ('it','IT','ระบบ IT','ทรัพย์สินไอทีและแจ้งปัญหา',100,array['ทะเบียนอุปกรณ์','Ticket แจ้งซ่อม'],true,4),
 ('customer_service','Customer Service','ระบบบริการลูกค้า','รับเรื่องและติดตามการแก้ไขให้ลูกค้า',100,array['Ticket ลูกค้า','ติดตามการแก้ไข'],true,5),
 ('data','Data','ระบบ DATA','วิเคราะห์ข้อมูลและรายงานข้ามแผนก',100,array['Dashboard','Export รายงาน'],true,6),
 ('legal','Legal','ระบบกฎหมาย','นิติกรรม สัญญา และวันครบกำหนด',100,array['ทะเบียนสัญญา','แจ้งเตือนวันหมดอายุ'],true,7),
 ('inventory','Warehouse','ระบบสต็อกสินค้า','จัดการคลัง รับ-จ่าย และจุดสั่งซื้อ',100,array['สต็อกสินค้า','โอนย้ายคลัง','แจ้งเตือนของใกล้หมด'],true,8),
 ('event','Event','ระบบ Event','บันทึกอีเวนต์ พื้นที่จัดงาน และ Freelance',100,array['ตารางอีเวนต์','พื้นที่จัดงาน','Freelance'],true,9);
create table public.company_modules(company_id uuid not null references companies(id),module_id text not null references modules(id),price_coins int not null,purchased_at timestamptz not null default now(),primary key(company_id,module_id));

alter table coin_packs enable row level security;alter table coin_wallets enable row level security;alter table coin_ledger enable row level security;alter table coin_topups enable row level security;alter table modules enable row level security;alter table company_modules enable row level security;
create policy coin_packs_read on coin_packs for select to anon,authenticated using(true);
create policy modules_read on modules for select to anon,authenticated using(active);
create policy coin_wallet_read on coin_wallets for select to authenticated using(member_role(company_id)is not null);
create policy coin_ledger_read on coin_ledger for select to authenticated using(member_role(company_id)in('owner','manager'));
create policy coin_topup_read on coin_topups for select to authenticated using(member_role(company_id)='owner');
create policy company_modules_read on company_modules for select to authenticated using(member_role(company_id)is not null);
revoke all on coin_packs,coin_wallets,coin_ledger,coin_topups,modules,company_modules from anon,authenticated;
grant select on coin_packs,modules to anon,authenticated;grant select on coin_wallets,coin_ledger,coin_topups,company_modules to authenticated;
grant all on coin_packs,coin_wallets,coin_ledger,coin_topups,modules,company_modules to service_role;

-- Owner submits a transfer slip for a coin pack; the price comes from coin_packs and a slip reference is single-use across all payments.
create or replace function public.request_topup(p_company uuid,p_coins int,p_attachment uuid,p_slip jsonb,p_ref text)returns coin_topups language plpgsql security definer set search_path=public as $$declare k coin_packs;t coin_topups;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 select * into k from coin_packs where coins=p_coins;if not found then raise exception 'แพ็กเหรียญไม่ถูกต้อง';end if;
 if p_ref is null or exists(select 1 from coin_topups where slip_ref=p_ref)or exists(select 1 from billing_payments where slip_ref=p_ref)then raise exception 'สลิปนี้ถูกใช้แล้ว';end if;
 insert into coin_topups(company_id,coins,amount,attachment_id,slip,slip_ref,created_by)values(p_company,k.coins,k.price,p_attachment,coalesce(p_slip,'{}'),p_ref,auth.uid())returning * into t;
 perform log_action(p_company,'coin_topup_requested',t.id::text);return t;end$$;
-- Platform operator (service role) confirms the transfer; coins land in the wallet with a ledger row.
create or replace function public.confirm_topup(p_id uuid,p_status text,p_note text default null)returns void language plpgsql security definer set search_path=public as $$declare t coin_topups;begin
 select * into t from coin_topups where id=p_id for update;if not found or t.status<>'pending'or p_status not in('verified','rejected')then raise exception 'รายการไม่ถูกต้อง';end if;
 update coin_topups set status=p_status,note=p_note,decided_at=now()where id=p_id;
 if p_status='verified'then
  insert into coin_wallets(company_id,balance)values(t.company_id,t.coins)on conflict(company_id)do update set balance=coin_wallets.balance+t.coins,updated_at=now();
  insert into coin_ledger(company_id,delta,reason,ref)values(t.company_id,t.coins,'topup',t.id::text);end if;end$$;
-- Owner buys a module once with coins (wallet row locked so two purchases cannot overspend).
create or replace function public.buy_module(p_company uuid,p_module text)returns company_modules language plpgsql security definer set search_path=public as $$declare m modules;w coin_wallets;r company_modules;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 select * into m from modules where id=p_module and active;if not found then raise exception 'ไม่พบโมดูล';end if;
 if exists(select 1 from company_modules where company_id=p_company and module_id=p_module)then raise exception 'ซื้อระบบนี้แล้ว';end if;
 select * into w from coin_wallets where company_id=p_company for update;
 if coalesce(w.balance,0)<m.price_coins then raise exception 'เหรียญไม่พอ กรุณาเติมเหรียญ';end if;
 if m.price_coins>0 then update coin_wallets set balance=balance-m.price_coins,updated_at=now()where company_id=p_company;
  insert into coin_ledger(company_id,delta,reason,ref,created_by)values(p_company,-m.price_coins,'purchase',m.id,auth.uid());end if;
 insert into company_modules(company_id,module_id,price_coins)values(p_company,m.id,m.price_coins)returning * into r;
 perform log_action(p_company,'module_purchased',m.id);return r;end$$;
revoke all on function public.request_topup(uuid,int,uuid,jsonb,text),public.buy_module(uuid,text)from public,anon;
grant execute on function public.request_topup(uuid,int,uuid,jsonb,text),public.buy_module(uuid,text)to authenticated;
revoke all on function public.confirm_topup(uuid,text,text)from public,anon,authenticated;grant execute on function public.confirm_topup(uuid,text,text)to service_role;

insert into public.entity_schemas(kind,department,fields)values('expenses','Finance','[{"key":"name","label":"รายการค่าใช้จ่าย","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"category","label":"หมวดหมู่","type":"select","required":true,"options":["ค่ามัดจำ","ค่าเช่า","ค่าไฟฟ้า","ค่าบริการ","ค่าพรม","บุคลากร","จัดซื้อ","ขนส่ง","การตลาด","อื่นๆ"]},{"key":"payee","label":"ผู้รับเงิน","type":"text","required":false},{"key":"supplierId","label":"Supplier","type":"relation","required":false,"resource":"suppliers"},{"key":"docType","label":"ประเภทเอกสาร","type":"select","required":false,"options":["ใบกำกับภาษี","บิลเงินสด","ใบเสร็จ","ใบแจ้งหนี้"]},{"key":"docNo","label":"เลขที่เอกสาร","type":"text","required":false},{"key":"taxId","label":"เลขผู้เสียภาษีผู้ขาย","type":"text","required":false},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"amount","label":"ยอดตามเอกสาร","type":"number","required":true,"min":0},{"key":"vatMode","label":"VAT","type":"select","required":false,"options":["included","excluded","none"]},{"key":"whtRate","label":"หัก ณ ที่จ่าย (%)","type":"select","required":false,"options":["0","1","2","3","5"]},{"key":"payStatus","label":"การชำระ","type":"select","required":false,"options":["จ่ายแล้ว","รอจ่าย","จ่ายบางส่วน"]},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["pending","approved","paid","rejected"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

-- Accounting (ระบบบัญชี): chart of accounts, cost centers, journal entries posted from reviewed expenses, 50 ทวิ numbering.
-- Customers / suppliers get running codes CUS-67-0001 / SUP-67-0001 (Thai year), plus directory and employee profile fields.

create table public.accounts(company_id uuid not null references companies(id),code text not null check(code ~ '^\d{4,6}$'),name text not null,type text not null check(type in('asset','liability','equity','income','expense')),category text,primary key(company_id,code));
create table public.cost_centers(company_id uuid not null references companies(id),code text not null,name text not null,kind text not null default 'department' check(kind in('department','branch')),primary key(company_id,code));
create table public.journal_entries(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),entity_id uuid references entities(id),date date not null,memo text not null default '',posted_by uuid,created_at timestamptz not null default now(),unique(company_id,entity_id));
create table public.journal_lines(id bigint generated always as identity primary key,entry_id uuid not null references journal_entries(id)on delete cascade,account_code text not null,debit numeric not null default 0 check(debit>=0),credit numeric not null default 0 check(credit>=0),project_id uuid references entities(id),cost_center text,check((debit=0)<>(credit=0)));
create index journal_lines_entry on journal_lines(entry_id);
create table public.wht_certificates(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),entity_id uuid not null unique references entities(id),year int not null,seq int not null,form text not null check(form in('ภ.ง.ด.3','ภ.ง.ด.53')),payee text not null,tax_id text,base numeric not null,rate numeric not null,amount numeric not null,paid_on date not null,created_at timestamptz not null default now(),unique(company_id,year,seq));
create table public.doc_counters(company_id uuid not null references companies(id),prefix text not null,year int not null,last int not null default 0,primary key(company_id,prefix,year));

alter table accounts enable row level security;alter table cost_centers enable row level security;alter table journal_entries enable row level security;alter table journal_lines enable row level security;alter table wht_certificates enable row level security;alter table doc_counters enable row level security;
create policy accounts_read on accounts for select to authenticated using(can_read_dept(company_id,'Finance'));
create policy cost_centers_read on cost_centers for select to authenticated using(member_role(company_id)is not null);
create policy journal_read on journal_entries for select to authenticated using(can_read_dept(company_id,'Finance'));
create policy journal_lines_read on journal_lines for select to authenticated using(exists(select 1 from journal_entries j where j.id=entry_id and can_read_dept(j.company_id,'Finance')));
create policy wht_read on wht_certificates for select to authenticated using(can_read_dept(company_id,'Finance'));
revoke all on accounts,cost_centers,journal_entries,journal_lines,wht_certificates,doc_counters from anon,authenticated;
grant select on accounts,cost_centers,journal_entries,journal_lines,wht_certificates to authenticated;
grant all on accounts,cost_centers,journal_entries,journal_lines,wht_certificates,doc_counters to service_role;

-- Default Thai chart of accounts; expense accounts carry the expense category they book (see expenseCategories in catalog.ts).
create function public.seed_accounts(c uuid)returns void language sql security definer set search_path=public as $$
 insert into accounts(company_id,code,name,type,category)values
  (c,'1111','เงินสด','asset',null),(c,'1112','เงินฝากธนาคาร','asset',null),(c,'1113','เงินสดย่อย','asset',null),
  (c,'1154','ภาษีซื้อ','asset',null),(c,'1160','เงินมัดจำจ่าย','asset','ค่ามัดจำ'),
  (c,'2111','เจ้าหนี้การค้า','liability',null),(c,'2132','ภาษีหัก ณ ที่จ่ายค้างจ่าย','liability',null),
  (c,'5010','ซื้อสินค้าและวัตถุดิบ','expense','จัดซื้อ'),(c,'5110','ค่าแรงและค่าจ้าง','expense','บุคลากร'),
  (c,'5210','ค่าเช่า','expense','ค่าเช่า'),(c,'5220','ค่าไฟฟ้าและสาธารณูปโภค','expense','ค่าไฟฟ้า'),
  (c,'5230','ค่าบริการ','expense','ค่าบริการ'),(c,'5240','ค่าพรมและวัสดุตกแต่ง','expense','ค่าพรม'),
  (c,'5250','ค่าขนส่ง','expense','ขนส่ง'),(c,'5310','ค่าโฆษณาและการตลาด','expense','การตลาด'),
  (c,'5900','ค่าใช้จ่ายอื่น','expense','อื่นๆ')
 on conflict do nothing;
 insert into cost_centers(company_id,code,name,kind)values(c,'HQ','สำนักงานใหญ่','branch')on conflict do nothing$$;
revoke all on function public.seed_accounts(uuid)from public,anon,authenticated;
create function public.companies_seed_accounts()returns trigger language plpgsql security definer set search_path=public as $$begin perform seed_accounts(new.id);return new;end$$;
create trigger companies_seed_accounts after insert on companies for each row execute function companies_seed_accounts();
select seed_accounts(id)from companies;

-- Running numbers per company and prefix (year 0 = never resets: CUS / SUP codes) or per year (50 ทวิ book numbers).
create function public.next_number(c uuid,p text,y int)returns int language sql security definer set search_path=public as $$
 insert into doc_counters(company_id,prefix,year,last)values(c,p,y,1)on conflict(company_id,prefix,year)do update set last=doc_counters.last+1 returning last$$;
revoke all on function public.next_number(uuid,text,int)from public,anon,authenticated;
create function public.thai_year()returns int language sql stable as $$select (extract(year from now() at time zone 'Asia/Bangkok')::int+543)%100$$;
-- What the next customer / supplier code will be (for the "รหัสถัดไป" card); does not consume a number.
create function public.peek_code(p_company uuid,p_kind text)returns text language plpgsql stable security definer set search_path=public as $$declare p text;n int;begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 p=case p_kind when 'customers'then 'CUS'when 'suppliers'then 'SUP'end;if p is null then return null;end if;
 select last+1 into n from doc_counters where company_id=p_company and prefix=p and year=0;
 return p||'-'||lpad(thai_year()::text,2,'0')||'-'||lpad(coalesce(n,1)::text,4,'0');end$$;
revoke all on function public.peek_code(uuid,text)from public,anon;grant execute on function public.peek_code(uuid,text)to authenticated;
-- A blank code on a new customer / supplier gets the next running code (the year part is the year it was added); an edit that blanks it keeps the old one.
create function public.assign_entity_code()returns trigger language plpgsql security definer set search_path=public as $$declare p text;y int;begin
 p=case new.kind when 'customers'then 'CUS'when 'suppliers'then 'SUP'end;
 if p is null or coalesce(new.data->>'code','')<>''then return new;end if;
 if tg_op='UPDATE'and coalesce(old.data->>'code','')<>''then new.data=new.data||jsonb_build_object('code',old.data->>'code');return new;end if;
 y=thai_year();new.data=new.data||jsonb_build_object('code',p||'-'||lpad(y::text,2,'0')||'-'||lpad(next_number(new.company_id,p,0)::text,4,'0'));return new;end$$;
create trigger entities_code before insert or update of data on entities for each row execute function assign_entity_code();
do $$declare r record;begin for r in select id from entities where kind in('customers','suppliers')and coalesce(data->>'code','')=''order by created_at loop update entities set data=data where id=r.id;end loop;end$$;

-- Item lists (`lines` fields) are arrays of {name,qty,price}; everything else is unchanged from 0001_core.
create or replace function public.validate_payload(k text,p jsonb,c uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare specs jsonb;f jsonb;v jsonb;output jsonb:='{}';num numeric;rel entities;begin
 select fields into specs from entity_schemas where kind=k;if specs is null then raise exception 'ไม่พบโมดูล';end if;
 for f in select value from jsonb_array_elements(specs)loop v=p->(f->>'key');
 if v is null or v='null'::jsonb or v='""'::jsonb then if (f->>'required')::boolean then raise exception 'ข้อมูลไม่ครบ: %',f->>'label';end if;continue;end if;
 if f->>'type'='lines' then if jsonb_typeof(v)<>'array'or jsonb_array_length(v)>100 or exists(select 1 from jsonb_array_elements(v)x where jsonb_typeof(x)<>'object'or jsonb_typeof(x->'name')<>'string'or length(x->>'name')not between 1 and 500 or jsonb_typeof(x->'qty')<>'number'or jsonb_typeof(x->'price')<>'number'or (x->>'qty')::numeric not between 0 and 1e9 or abs((x->>'price')::numeric)>1e12)then raise exception 'รายการสินค้าไม่ถูกต้อง';end if;
  v=(select coalesce(jsonb_agg(jsonb_build_object('name',x->'name','qty',x->'qty','price',x->'price')),'[]'::jsonb)from jsonb_array_elements(v)x);
 elsif f->>'type'='number' then if jsonb_typeof(v)<>'number'then raise exception 'รูปแบบตัวเลขไม่ถูกต้อง';end if;num=(v#>>'{}')::numeric;if abs(num)>1e12 or (f ? 'min'and num<(f->>'min')::numeric)then raise exception 'จำนวนไม่ถูกต้อง';end if;
 else if jsonb_typeof(v)<>'string'or length(v#>>'{}')>10000 then raise exception 'รูปแบบข้อความไม่ถูกต้อง';end if;
 if f->>'type'='date' then if (v#>>'{}')!~ '^\d{4}-\d{2}-\d{2}$'or to_char((v#>>'{}')::date,'YYYY-MM-DD')<>(v#>>'{}')then raise exception 'วันที่ไม่ถูกต้อง';end if;end if;
 if f->>'type'='select'and not (f->'options')? (v#>>'{}')then raise exception 'ตัวเลือกไม่ถูกต้อง';end if;
 if f->>'type'='relation' then select * into rel from entities where id=(v#>>'{}')::uuid and company_id=c and kind=f->>'resource'and archived_at is null;if not found then raise exception 'ข้อมูลอ้างอิงไม่อยู่ในบริษัทนี้';end if;end if;end if;
 output=output||jsonb_build_object(f->>'key',v);end loop;
 if output->>'startDate'>output->>'endDate'then raise exception 'ช่วงวันที่ไม่ถูกต้อง';end if;return output;end$$;
revoke all on function public.validate_payload(text,jsonb,uuid) from public,anon,authenticated;

-- Posts (or re-posts) the journal of a reviewed expense. The server builds the lines (src/lib/accounting.ts buildJournal);
-- here they must balance, use this company's accounts and projects, and a withholding certificate gets its 50 ทวิ number.
create function public.post_expense(p_company uuid,p_entity uuid,p_lines jsonb,p_wht jsonb default null)returns journal_entries language plpgsql security definer set search_path=public as $$declare e entities;j journal_entries;dr numeric;cr numeric;y int;begin
 if not can_write_dept(p_company,'Finance')then raise exception 'ไม่มีสิทธิ์ฝ่ายการเงิน';end if;
 select * into e from entities where id=p_entity and company_id=p_company and kind='expenses'and archived_at is null for update;if not found then raise exception 'ไม่พบรายการค่าใช้จ่าย';end if;
 if jsonb_typeof(p_lines)<>'array'or jsonb_array_length(p_lines)not between 2 and 200 then raise exception 'รายการบัญชีไม่ถูกต้อง';end if;
 if exists(select 1 from jsonb_array_elements(p_lines)l where not exists(select 1 from accounts a where a.company_id=p_company and a.code=l->>'account')
   or (coalesce(l->>'projectId','')<>''and not exists(select 1 from entities x where x.id=(l->>'projectId')::uuid and x.company_id=p_company and x.kind='projects')))then raise exception 'รหัสบัญชีหรือโปรเจกต์ไม่ถูกต้อง';end if;
 select coalesce(sum(coalesce((l->>'debit')::numeric,0)),0),coalesce(sum(coalesce((l->>'credit')::numeric,0)),0)into dr,cr from jsonb_array_elements(p_lines)l;
 if dr<>cr or dr<=0 then raise exception 'เดบิตและเครดิตไม่เท่ากัน';end if;
 delete from journal_entries where company_id=p_company and entity_id=p_entity;
 insert into journal_entries(company_id,entity_id,date,memo,posted_by)values(p_company,p_entity,(e.data->>'date')::date,coalesce(e.data->>'name',''),auth.uid())returning * into j;
 insert into journal_lines(entry_id,account_code,debit,credit,project_id,cost_center)select j.id,l->>'account',coalesce((l->>'debit')::numeric,0),coalesce((l->>'credit')::numeric,0),nullif(l->>'projectId','')::uuid,nullif(l->>'costCenter','')from jsonb_array_elements(p_lines)l;
 if p_wht is null then delete from wht_certificates where entity_id=p_entity;
 elsif exists(select 1 from wht_certificates where entity_id=p_entity)then
  update wht_certificates set form=p_wht->>'form',payee=coalesce(nullif(p_wht->>'payee',''),'-'),tax_id=p_wht->>'taxId',base=(p_wht->>'base')::numeric,rate=(p_wht->>'rate')::numeric,amount=(p_wht->>'amount')::numeric,paid_on=(e.data->>'date')::date where entity_id=p_entity;
 else y=extract(year from (e.data->>'date')::date)::int+543;
  insert into wht_certificates(company_id,entity_id,year,seq,form,payee,tax_id,base,rate,amount,paid_on)values(p_company,p_entity,y,next_number(p_company,'WHT',y),p_wht->>'form',coalesce(nullif(p_wht->>'payee',''),'-'),p_wht->>'taxId',(p_wht->>'base')::numeric,(p_wht->>'rate')::numeric,(p_wht->>'amount')::numeric,(e.data->>'date')::date);end if;
 update entities set data=data||'{"reviewStatus":"บันทึกแล้ว"}'::jsonb,version=version+1,updated_at=now()where id=p_entity;
 perform log_action(p_company,'expense_posted',p_entity::text);return j;end$$;
revoke all on function public.post_expense(uuid,uuid,jsonb,jsonb)from public,anon;grant execute on function public.post_expense(uuid,uuid,jsonb,jsonb)to authenticated;

-- A receipt uploaded before its expense existed gets attached to that expense (no second upload).
create function public.link_attachment(p_company uuid,p_attachment uuid,p_entity uuid)returns void language plpgsql security definer set search_path=public as $$declare a attachments;e entities;begin
 select * into a from attachments where id=p_attachment and company_id=p_company for update;select * into e from entities where id=p_entity and company_id=p_company;
 if a.id is null or e.id is null or not can_write_dept(p_company,a.department)or not can_write_dept(p_company,e.department)then raise exception 'ไม่พบเอกสาร';end if;
 if a.entity_id is not null and a.entity_id<>p_entity then raise exception 'เอกสารนี้ผูกกับรายการอื่นแล้ว';end if;
 update attachments set entity_id=p_entity where id=p_attachment;end$$;
revoke all on function public.link_attachment(uuid,uuid,uuid)from public,anon;grant execute on function public.link_attachment(uuid,uuid,uuid)to authenticated;

-- Old expense option values move to the new lists; rows already approved or paid count as reviewed.
update entities set data=data||jsonb_build_object('docType',case data->>'docType'when 'ใบกำกับภาษี'then 'ใบกำกับภาษีเต็มรูป'else 'ใบเสร็จ'end)where kind='expenses'and data->>'docType'in('ใบกำกับภาษี','บิลเงินสด');
update entities set data=data||jsonb_build_object('payStatus',case data->>'payStatus'when 'จ่ายแล้ว'then 'โอนแล้ว'else 'ยังไม่จ่าย'end)where kind='expenses'and data->>'payStatus'in('จ่ายแล้ว','รอจ่าย','จ่ายบางส่วน');
update entities set data=data||jsonb_build_object('reviewStatus',case when data->>'status'='pending'then 'รอตรวจ'else 'บันทึกแล้ว'end)where kind='expenses'and not data ? 'reviewStatus';

-- GENERATED from src/lib/catalog.ts
insert into public.entity_schemas(kind,department,fields)values('expenses','Finance','[{"key":"name","label":"รายการค่าใช้จ่าย","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"category","label":"หมวดหมู่","type":"select","required":true,"options":["ค่ามัดจำ","ค่าเช่า","ค่าไฟฟ้า","ค่าบริการ","ค่าพรม","บุคลากร","จัดซื้อ","ขนส่ง","การตลาด","อื่นๆ"]},{"key":"accountCode","label":"รหัสผังบัญชี","type":"text","required":false},{"key":"costCenter","label":"ศูนย์ต้นทุน","type":"text","required":false},{"key":"payee","label":"ผู้รับเงิน","type":"text","required":false},{"key":"supplierId","label":"Supplier","type":"relation","required":false,"resource":"suppliers"},{"key":"docType","label":"ประเภทเอกสาร","type":"select","required":false,"options":["ใบกำกับภาษีเต็มรูป","ใบกำกับภาษีอย่างย่อ","ใบเสร็จ","ใบแจ้งหนี้"]},{"key":"docNo","label":"เลขที่เอกสาร","type":"text","required":false},{"key":"taxId","label":"เลขผู้เสียภาษีผู้ขาย","type":"text","required":false},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"receiptId","label":"ไฟล์ใบเสร็จ","type":"image","required":false,"hidden":true},{"key":"lines","label":"รายการสินค้า","type":"lines","required":false,"hidden":true},{"key":"amount","label":"ยอดตามเอกสาร","type":"number","required":true,"min":0},{"key":"vatMode","label":"VAT","type":"select","required":false,"options":["included","excluded","none"]},{"key":"whtRate","label":"หัก ณ ที่จ่าย (%)","type":"select","required":false,"options":["0","1","2","3","5"]},{"key":"payStatus","label":"การชำระ","type":"select","required":false,"options":["โอนแล้ว","เงินสดย่อย","ยังไม่จ่าย"]},{"key":"reviewStatus","label":"การตรวจ","type":"select","required":false,"options":["รอตรวจ","บันทึกแล้ว"],"hidden":true},{"key":"aiNotes","label":"เหตุผลจาก AI","type":"textarea","required":false,"hidden":true},{"key":"aiUncertain","label":"ช่องที่ AI ไม่แน่ใจ","type":"text","required":false,"hidden":true},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["pending","approved","paid","rejected"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('customers','Sales','[{"key":"name","label":"ชื่อลูกค้า","type":"text","required":true},{"key":"code","label":"รหัสลูกค้า (เว้นว่างเพื่อออกรหัสอัตโนมัติ)","type":"text","required":false},{"key":"type","label":"ประเภท","type":"select","required":false,"options":["นิติบุคคล","บุคคลธรรมดา"]},{"key":"company","label":"บริษัท","type":"text","required":false},{"key":"taxId","label":"เลขประจำตัวผู้เสียภาษี","type":"text","required":false},{"key":"branch","label":"สำนักงาน / สาขา","type":"text","required":false},{"key":"businessType","label":"ประเภทธุรกิจ","type":"text","required":false},{"key":"segment","label":"กลุ่มลูกค้า","type":"select","required":false,"options":["standard","regular","vip"]},{"key":"creditDays","label":"เครดิต (วัน)","type":"number","required":false,"min":0},{"key":"creditLimit","label":"วงเงินเครดิต","type":"number","required":false,"min":0},{"key":"ownerId","label":"ผู้ดูแล","type":"relation","required":false,"resource":"employees"},{"key":"shippingAddress","label":"ที่อยู่จัดส่ง","type":"textarea","required":false},{"key":"contact2","label":"ผู้ติดต่อคนที่ 2","type":"text","required":false},{"key":"contact2Phone","label":"โทรศัพท์ผู้ติดต่อคนที่ 2","type":"tel","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('suppliers','Purchasing','[{"key":"name","label":"ชื่อซัพพลายเออร์","type":"text","required":true},{"key":"code","label":"รหัส (เว้นว่างเพื่อออกรหัสอัตโนมัติ)","type":"text","required":false},{"key":"type","label":"ประเภท","type":"select","required":false,"options":["นิติบุคคล","บุคคลธรรมดา"]},{"key":"category","label":"สินค้า / บริการ","type":"select","required":false,"options":["สินค้า / วัตถุดิบ","บริการ"]},{"key":"tier","label":"ระดับ Supplier","type":"select","required":false,"options":["หลัก","สำรอง"]},{"key":"taxId","label":"เลขประจำตัวผู้เสียภาษี","type":"text","required":false},{"key":"branch","label":"สำนักงาน / สาขา","type":"text","required":false},{"key":"businessType","label":"ประเภทธุรกิจ","type":"text","required":false},{"key":"rating","label":"คะแนน (0–5)","type":"number","required":false,"min":0},{"key":"leadTime","label":"ระยะเวลาส่งของ","type":"text","required":false},{"key":"creditDays","label":"เครดิต (วัน)","type":"number","required":false,"min":0},{"key":"paymentTerms","label":"เงื่อนไขชำระเงิน","type":"text","required":false},{"key":"bankName","label":"ธนาคาร","type":"text","required":false},{"key":"bankAccount","label":"เลขบัญชี","type":"text","required":false},{"key":"bankAccountName","label":"ชื่อบัญชี","type":"text","required":false},{"key":"products","label":"สินค้า / บริการที่ซื้อ","type":"textarea","required":false},{"key":"docExpiry","label":"เอกสารหมดอายุ","type":"date","required":false},{"key":"shippingAddress","label":"ที่อยู่จัดส่ง","type":"textarea","required":false},{"key":"contact2","label":"ผู้ติดต่อคนที่ 2","type":"text","required":false},{"key":"contact2Phone","label":"โทรศัพท์ผู้ติดต่อคนที่ 2","type":"tel","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('employees','HR','[{"key":"photo","label":"รูปพนักงาน","type":"image","required":false},{"key":"name","label":"ชื่อ-นามสกุล","type":"text","required":true},{"key":"code","label":"รหัสพนักงาน","type":"text","required":false},{"key":"nickname","label":"ชื่อเล่น","type":"text","required":false},{"key":"department","label":"แผนก","type":"text","required":true},{"key":"position","label":"ตำแหน่ง","type":"text","required":false},{"key":"employmentType","label":"ประเภทการจ้าง","type":"select","required":true,"options":["ประจำ","สัญญาจ้าง","พาร์ตไทม์"]},{"key":"startDate","label":"วันเริ่มงาน","type":"date","required":false},{"key":"salary","label":"เงินเดือน","type":"number","required":false,"min":0},{"key":"birthDate","label":"วันเกิด","type":"date","required":false},{"key":"idCard","label":"เลขบัตรประชาชน","type":"text","required":false},{"key":"bank","label":"ธนาคาร","type":"text","required":false},{"key":"bankAccount","label":"เลขบัญชี","type":"text","required":false},{"key":"emergency","label":"ผู้ติดต่อฉุกเฉิน","type":"text","required":false},{"key":"level","label":"ระดับ","type":"select","required":false,"options":["พนักงาน","หัวหน้างาน","ผู้จัดการ","ผู้บริหาร"]},{"key":"managerId","label":"หัวหน้างาน","type":"relation","required":false,"resource":"employees"},{"key":"branch","label":"สาขา","type":"text","required":false},{"key":"workHours","label":"เวลาทำงาน","type":"text","required":false},{"key":"about","label":"เกี่ยวกับ","type":"textarea","required":false},{"key":"skills","label":"ทักษะ (คั่นด้วย ,)","type":"text","required":false},{"key":"score","label":"คะแนนประเมิน (0–100)","type":"number","required":false,"min":0},{"key":"leaveQuota","label":"วันลาต่อปี","type":"number","required":false,"min":0},{"key":"checklist","label":"เอกสารที่ส่งแล้ว","type":"text","required":false,"hidden":true},{"key":"approvals","label":"สิทธิ์การอนุมัติ","type":"text","required":false,"hidden":true},{"key":"history","label":"ประวัติการทำงาน","type":"textarea","required":false,"hidden":true},{"key":"cover","label":"รูปปก","type":"image","required":false,"hidden":true},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["active","probation","on_leave","inactive"]},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"line","label":"LINE ID","type":"text","required":false},{"key":"address","label":"ที่อยู่","type":"textarea","required":false},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

-- แผนก mega menu: record types for every department shortcut (ใบเสนอราคา, SO, เบิกสินค้า, ใบวางบิล, เวลาเข้า-ออก, KPI, ยานพาหนะ …).
-- LINE groups → any page: a Data Template can name a target page; when its item is approved (web, #approve or keyword) a record is created there.

insert into public.entity_schemas(kind,department,fields)values('quotations','Sales','[{"key":"name","label":"เลขที่ใบเสนอราคา","type":"text","required":true},{"key":"customerId","label":"ลูกค้า","type":"relation","required":true,"resource":"customers"},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"validUntil","label":"ยืนราคาถึง","type":"date","required":false},{"key":"lines","label":"รายการสินค้า/บริการ","type":"lines","required":false},{"key":"subtotal","label":"มูลค่า (ถ้าไม่ใส่รายการ)","type":"number","required":false,"min":0},{"key":"discount","label":"ส่วนลด (บาท)","type":"number","required":false,"min":0},{"key":"vatMode","label":"VAT","type":"select","required":false,"options":["excluded","included","none"]},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["ร่าง","ส่งแล้ว","ตอบรับ","ปฏิเสธ"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('sales_orders','Sales','[{"key":"name","label":"เลขที่ SO","type":"text","required":true},{"key":"customerId","label":"ลูกค้า","type":"relation","required":true,"resource":"customers"},{"key":"quotationId","label":"อ้างอิงใบเสนอราคา","type":"relation","required":false,"resource":"quotations"},{"key":"date","label":"วันที่สั่ง","type":"date","required":true},{"key":"deliveryDate","label":"กำหนดส่ง","type":"date","required":false},{"key":"lines","label":"รายการสินค้า/บริการ","type":"lines","required":false},{"key":"subtotal","label":"มูลค่า (ถ้าไม่ใส่รายการ)","type":"number","required":false,"min":0},{"key":"discount","label":"ส่วนลด (บาท)","type":"number","required":false,"min":0},{"key":"vatMode","label":"VAT","type":"select","required":false,"options":["excluded","included","none"]},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["รอดำเนินการ","กำลังจัดส่ง","ส่งแล้ว","ออกใบแจ้งหนี้แล้ว","ยกเลิก"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('sales_targets','Sales','[{"key":"name","label":"พนักงาน / ทีม","type":"text","required":true},{"key":"month","label":"เดือน (YYYY-MM)","type":"text","required":true},{"key":"target","label":"เป้ายอดขาย","type":"number","required":true,"min":0},{"key":"actual","label":"ยอดทำได้","type":"number","required":false,"min":0},{"key":"visits","label":"จำนวนเข้าพบลูกค้า","type":"number","required":false,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["กำลังดำเนินการ","ถึงเป้า","ไม่ถึงเป้า"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('content','Marketing','[{"key":"name","label":"หัวข้อคอนเทนต์","type":"text","required":true},{"key":"channel","label":"ช่องทาง","type":"select","required":true,"options":["Facebook","Instagram","TikTok","LINE OA","YouTube","เว็บไซต์","สื่อสิ่งพิมพ์","อื่นๆ"]},{"key":"type","label":"รูปแบบ","type":"select","required":false,"options":["โพสต์","วิดีโอ","โฆษณา","บทความ","ไลฟ์"]},{"key":"campaignId","label":"แคมเปญ","type":"relation","required":false,"resource":"campaigns"},{"key":"publishDate","label":"วันเผยแพร่","type":"date","required":false},{"key":"url","label":"ลิงก์","type":"url","required":false},{"key":"spend","label":"ค่าโฆษณา","type":"number","required":false,"min":0},{"key":"reach","label":"Reach","type":"number","required":false,"min":0},{"key":"engagement","label":"Engagement","type":"number","required":false,"min":0},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["ไอเดีย","กำลังทำ","รออนุมัติ","เผยแพร่แล้ว"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('marketing_budget','Marketing','[{"key":"name","label":"รายการงบ","type":"text","required":true},{"key":"campaignId","label":"แคมเปญ","type":"relation","required":false,"resource":"campaigns"},{"key":"period","label":"ช่วงเวลา (เช่น 2026-Q4)","type":"text","required":true},{"key":"budget","label":"งบที่ตั้ง","type":"number","required":true,"min":0},{"key":"spent","label":"ใช้จริง","type":"number","required":false,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["วางแผน","อนุมัติ","ปิดงบ"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('promotions','Marketing','[{"key":"name","label":"ชื่อกิจกรรม","type":"text","required":true},{"key":"mechanic","label":"รูปแบบโปร (ลด/แถม/สะสมแต้ม)","type":"text","required":false},{"key":"startDate","label":"วันเริ่ม","type":"date","required":false},{"key":"endDate","label":"วันสิ้นสุด","type":"date","required":false},{"key":"discount","label":"ส่วนลด (%)","type":"number","required":false,"min":0},{"key":"budget","label":"งบ","type":"number","required":false,"min":0},{"key":"target","label":"เป้ายอดขาย","type":"number","required":false,"min":0},{"key":"result","label":"ยอดขายที่ได้","type":"number","required":false,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["วางแผน","กำลังจัด","จบแล้ว"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('stock_issues','Warehouse','[{"key":"name","label":"เลขที่ใบเบิก","type":"text","required":true},{"key":"productId","label":"สินค้า","type":"relation","required":true,"resource":"products"},{"key":"quantity","label":"จำนวน","type":"number","required":true,"min":0},{"key":"requester","label":"ผู้เบิก","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"date","label":"วันที่เบิก","type":"date","required":true},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["รออนุมัติ","อนุมัติแล้ว","จ่ายของแล้ว","ไม่อนุมัติ"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('stock_counts','Warehouse','[{"key":"name","label":"รอบนับ","type":"text","required":true},{"key":"productId","label":"สินค้า","type":"relation","required":true,"resource":"products"},{"key":"date","label":"วันที่นับ","type":"date","required":true},{"key":"systemQty","label":"ยอดในระบบ","type":"number","required":true},{"key":"countedQty","label":"นับได้จริง","type":"number","required":true,"min":0},{"key":"counter","label":"ผู้นับ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["นับแล้ว","ตรวจแล้ว","ปรับยอดแล้ว"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('bills','Finance','[{"key":"name","label":"เลขที่ใบวางบิล","type":"text","required":true},{"key":"supplierId","label":"Supplier","type":"relation","required":true,"resource":"suppliers"},{"key":"invoiceNo","label":"เลขที่ใบแจ้งหนี้ของ Supplier","type":"text","required":false},{"key":"date","label":"วันที่รับวางบิล","type":"date","required":true},{"key":"dueDate","label":"ครบกำหนดจ่าย","type":"date","required":true},{"key":"amount","label":"ยอดเงิน","type":"number","required":true,"min":0},{"key":"whtRate","label":"หัก ณ ที่จ่าย (%)","type":"select","required":false,"options":["0","1","2","3","5"]},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["รอตรวจ","รอจ่าย","จ่ายแล้ว","โต้แย้ง"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('recruitment','HR','[{"key":"name","label":"ชื่อผู้สมัคร","type":"text","required":true},{"key":"position","label":"ตำแหน่งที่สมัคร","type":"text","required":true},{"key":"source","label":"ช่องทาง","type":"select","required":false,"options":["JobThai","JobsDB","LinkedIn","เครือข่าย EliteFlow","แนะนำ","อื่นๆ"]},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"interviewDate","label":"วันสัมภาษณ์","type":"date","required":false},{"key":"expectedSalary","label":"เงินเดือนที่คาดหวัง","type":"number","required":false,"min":0},{"key":"score","label":"คะแนนสัมภาษณ์ (0-10)","type":"number","required":false,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["สมัคร","คัดกรอง","สัมภาษณ์","เสนองาน","รับเข้าทำงาน","ไม่ผ่าน"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('attendance','HR','[{"key":"name","label":"พนักงาน","type":"text","required":true},{"key":"employeeId","label":"เชื่อมข้อมูลพนักงาน","type":"relation","required":false,"resource":"employees"},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"shiftStart","label":"เวลาเข้างาน (กะ) HH:MM","type":"text","required":false},{"key":"checkIn","label":"เข้างาน HH:MM","type":"text","required":true},{"key":"checkOut","label":"ออกงาน HH:MM","type":"text","required":false},{"key":"location","label":"สถานที่","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["ปกติ","สาย","ขาด","ลา","ทำงานนอกสถานที่"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('kpi','HR','[{"key":"name","label":"พนักงาน","type":"text","required":true},{"key":"employeeId","label":"เชื่อมข้อมูลพนักงาน","type":"relation","required":false,"resource":"employees"},{"key":"period","label":"รอบประเมิน","type":"text","required":true},{"key":"objective","label":"เป้าหมาย / KPI","type":"text","required":true},{"key":"target","label":"ค่าเป้าหมาย","type":"number","required":false},{"key":"actual","label":"ผลที่ได้","type":"number","required":false},{"key":"score","label":"คะแนน (1-5)","type":"number","required":false,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["ตั้งเป้า","ระหว่างรอบ","ประเมินแล้ว"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('event_guests','Event','[{"key":"name","label":"ชื่อผู้เข้าร่วม","type":"text","required":true},{"key":"eventId","label":"อีเวนต์","type":"relation","required":true,"resource":"events"},{"key":"guestType","label":"ประเภท","type":"select","required":false,"options":["ทั่วไป","VIP","สื่อ","พาร์ทเนอร์","วิทยากร"]},{"key":"company","label":"บริษัท","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"email","label":"อีเมล","type":"email","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["ลงทะเบียน","ยืนยัน","เช็กอินแล้ว","ไม่มา"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('event_budget','Event','[{"key":"name","label":"หมวดงบ","type":"text","required":true},{"key":"eventId","label":"อีเวนต์","type":"relation","required":true,"resource":"events"},{"key":"budget","label":"งบ","type":"number","required":true,"min":0},{"key":"spent","label":"ใช้จริง","type":"number","required":false,"min":0},{"key":"vendor","label":"ผู้รับจ้าง","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["วางแผน","อนุมัติ","จ่ายแล้ว"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('venues','Event','[{"key":"name","label":"ชื่อสถานที่ / อุปกรณ์","type":"text","required":true},{"key":"type","label":"ประเภท","type":"select","required":true,"options":["สถานที่","เวที & แสงเสียง","บูธ","เฟอร์นิเจอร์","อุปกรณ์ไอที","อื่นๆ"]},{"key":"eventId","label":"อีเวนต์","type":"relation","required":false,"resource":"events"},{"key":"bookingDate","label":"วันที่จอง/ใช้","type":"date","required":false},{"key":"capacity","label":"ความจุ / จำนวน","type":"number","required":false,"min":0},{"key":"cost","label":"ค่าใช้จ่าย","type":"number","required":false,"min":0},{"key":"contact","label":"ผู้ติดต่อ","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"tel","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["สอบถาม","จองแล้ว","ยืนยัน","ยกเลิก"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('software','IT','[{"key":"name","label":"ชื่อระบบ / ซอฟต์แวร์","type":"text","required":true},{"key":"vendor","label":"ผู้ให้บริการ","type":"text","required":false},{"key":"seats","label":"จำนวนไลเซนส์","type":"number","required":false,"min":0},{"key":"cost","label":"ค่าใช้จ่ายต่อปี","type":"number","required":false,"min":0},{"key":"expiryDate","label":"วันหมดอายุ","type":"date","required":false},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"url","label":"ลิงก์ระบบ","type":"url","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["ใช้งาน","ทดลองใช้","รอต่ออายุ","ยกเลิก"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('security','IT','[{"key":"name","label":"หัวข้อ","type":"text","required":true},{"key":"category","label":"ประเภท","type":"select","required":true,"options":["เหตุการณ์","ช่องโหว่","รหัสผ่าน/สิทธิ์","สำรองข้อมูล","อบรม","อื่นๆ"]},{"key":"severity","label":"ความรุนแรง","type":"select","required":true,"options":["ต่ำ","กลาง","สูง","วิกฤต"]},{"key":"date","label":"วันที่พบ","type":"date","required":true},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["เปิด","กำลังแก้","แก้แล้ว","ปิด"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('ip_assets','Legal','[{"key":"name","label":"ชื่อ","type":"text","required":true},{"key":"type","label":"ประเภท","type":"select","required":true,"options":["เครื่องหมายการค้า","สิทธิบัตร","อนุสิทธิบัตร","ลิขสิทธิ์","ความลับทางการค้า"]},{"key":"registrationNo","label":"เลขทะเบียน","type":"text","required":false},{"key":"filingDate","label":"วันยื่น","type":"date","required":false},{"key":"expiryDate","label":"วันหมดอายุ","type":"date","required":false},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["ยื่นคำขอ","จดทะเบียนแล้ว","รอต่ออายุ","หมดอายุ"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('policies','Legal','[{"key":"name","label":"ชื่อนโยบาย / ข้อกำหนด","type":"text","required":true},{"key":"category","label":"หมวด","type":"select","required":false,"options":["บุคคล","ข้อมูลส่วนบุคคล (PDPA)","การเงิน","ความปลอดภัย","สิ่งแวดล้อม","อื่นๆ"]},{"key":"effectiveDate","label":"มีผลตั้งแต่","type":"date","required":false},{"key":"expiryDate","label":"ทบทวน/หมดอายุ","type":"date","required":false},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"url","label":"ลิงก์เอกสาร","type":"url","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["ร่าง","ประกาศใช้","รอทบทวน","ยกเลิก"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('cases','Legal','[{"key":"name","label":"เรื่อง","type":"text","required":true},{"key":"caseNo","label":"เลขคดี","type":"text","required":false},{"key":"counterparty","label":"คู่กรณี","type":"text","required":true},{"key":"court","label":"ศาล / หน่วยงาน","type":"text","required":false},{"key":"lawyer","label":"ทนาย","type":"text","required":false},{"key":"nextHearing","label":"นัดถัดไป","type":"date","required":false},{"key":"amount","label":"ทุนทรัพย์","type":"number","required":false,"min":0},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["เจรจา","ฟ้องร้อง","พิจารณา","ยุติ"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('vehicles','Admin','[{"key":"name","label":"รถ (ยี่ห้อ/รุ่น)","type":"text","required":true},{"key":"plate","label":"ทะเบียน","type":"text","required":true},{"key":"driver","label":"ผู้รับผิดชอบ / คนขับ","type":"text","required":false},{"key":"mileage","label":"เลขไมล์","type":"number","required":false,"min":0},{"key":"taxExpiry","label":"ภาษีหมดอายุ","type":"date","required":false},{"key":"insuranceExpiry","label":"ประกันหมดอายุ","type":"date","required":false},{"key":"nextService","label":"เข้าศูนย์ครั้งถัดไป","type":"date","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["พร้อมใช้","ใช้งานอยู่","ซ่อมบำรุง","จำหน่ายแล้ว"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('services','Admin','[{"key":"name","label":"เรื่อง","type":"text","required":true},{"key":"category","label":"ประเภท","type":"select","required":true,"options":["ซ่อมอาคาร","แม่บ้าน/ทำความสะอาด","จองห้องประชุม","รับ-ส่งเอกสาร","อุปกรณ์สำนักงาน","อื่นๆ"]},{"key":"requester","label":"ผู้แจ้ง","type":"text","required":true},{"key":"location","label":"สถานที่","type":"text","required":false},{"key":"date","label":"วันที่ต้องการ","type":"date","required":false},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["แจ้งแล้ว","กำลังดำเนินการ","เสร็จแล้ว","ยกเลิก"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

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

-- แผนก page rules: running numbers (QT/SO/AP/WD), stored totals, Owner/Manager approval, and real stock moves
-- for เบิกสินค้า ("จ่ายของแล้ว") and ตรวจนับ ("ปรับยอดแล้ว"). Mirrors src/lib/dept-rules.ts.

insert into public.entity_schemas(kind,department,fields)values('quotations','Sales','[{"key":"name","label":"หัวข้องาน","type":"text","required":true},{"key":"customerId","label":"ลูกค้า","type":"relation","required":true,"resource":"customers"},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"validUntil","label":"ยืนราคาถึง","type":"date","required":false},{"key":"lines","label":"รายการสินค้า/บริการ","type":"lines","required":false},{"key":"subtotal","label":"มูลค่า (ถ้าไม่ใส่รายการ)","type":"number","required":false,"min":0},{"key":"discount","label":"ส่วนลด (บาท)","type":"number","required":false,"min":0},{"key":"vatMode","label":"VAT","type":"select","required":false,"options":["excluded","included","none"]},{"key":"owner","label":"ผู้รับผิดชอบ","type":"text","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["ร่าง","ส่งแล้ว","ตอบรับ","ปฏิเสธ"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('sales_orders','Sales','[{"key":"name","label":"หัวข้อคำสั่งซื้อ","type":"text","required":true},{"key":"customerId","label":"ลูกค้า","type":"relation","required":true,"resource":"customers"},{"key":"quotationId","label":"อ้างอิงใบเสนอราคา","type":"relation","required":false,"resource":"quotations"},{"key":"date","label":"วันที่สั่ง","type":"date","required":true},{"key":"deliveryDate","label":"กำหนดส่ง","type":"date","required":false},{"key":"lines","label":"รายการสินค้า/บริการ","type":"lines","required":false},{"key":"subtotal","label":"มูลค่า (ถ้าไม่ใส่รายการ)","type":"number","required":false,"min":0},{"key":"discount","label":"ส่วนลด (บาท)","type":"number","required":false,"min":0},{"key":"vatMode","label":"VAT","type":"select","required":false,"options":["excluded","included","none"]},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["รอดำเนินการ","กำลังจัดส่ง","ส่งแล้ว","ออกใบแจ้งหนี้แล้ว","ยกเลิก"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('bills','Finance','[{"key":"name","label":"รายการ","type":"text","required":true},{"key":"supplierId","label":"Supplier","type":"relation","required":true,"resource":"suppliers"},{"key":"invoiceNo","label":"เลขที่ใบแจ้งหนี้ของ Supplier","type":"text","required":false},{"key":"date","label":"วันที่รับวางบิล","type":"date","required":true},{"key":"dueDate","label":"ครบกำหนดจ่าย","type":"date","required":true},{"key":"amount","label":"ยอดเงิน","type":"number","required":true,"min":0},{"key":"whtRate","label":"หัก ณ ที่จ่าย (%)","type":"select","required":false,"options":["0","1","2","3","5"]},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["รอตรวจ","รอจ่าย","จ่ายแล้ว","โต้แย้ง"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
insert into public.entity_schemas(kind,department,fields)values('stock_issues','Warehouse','[{"key":"name","label":"รายการเบิก","type":"text","required":true},{"key":"productId","label":"สินค้า","type":"relation","required":true,"resource":"products"},{"key":"quantity","label":"จำนวน","type":"number","required":true,"min":0},{"key":"requester","label":"ผู้เบิก","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"date","label":"วันที่เบิก","type":"date","required":true},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["รออนุมัติ","อนุมัติแล้ว","จ่ายของแล้ว","ไม่อนุมัติ"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

-- Running numbers for the new documents (same counter table as customers / suppliers).
create or replace function public.code_prefix(p_kind text)returns text language sql immutable as $$select case p_kind when 'customers'then 'CUS'when 'suppliers'then 'SUP'when 'quotations'then 'QT'when 'sales_orders'then 'SO'when 'bills'then 'AP'when 'stock_issues'then 'WD' end$$;
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
create or replace function public.hhmm(t text)returns int language sql immutable as $$select case when t ~ '^\d{1,2}:\d{2}$' then split_part(t,':',1)::int*60+split_part(t,':',2)::int end$$;
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
create or replace function public.approval_statuses()returns jsonb language sql immutable as $$select '{"stock_issues":["อนุมัติแล้ว","จ่ายของแล้ว","ไม่อนุมัติ"],"stock_counts":["ปรับยอดแล้ว"],"bills":["รอจ่าย","จ่ายแล้ว"],"marketing_budget":["อนุมัติ","ปิดงบ"],"event_budget":["อนุมัติ","จ่ายแล้ว"],"recruitment":["เสนองาน","รับเข้าทำงาน"],"kpi":["ประเมินแล้ว"],"promotions":["กำลังจัด"],"policies":["ประกาศใช้"],"quotations":["ตอบรับ"]}'::jsonb$$;
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

-- บันทึกค่าใช้จ่าย form: item rows keep category, unit, currency and a per-row discount (percent or baht);
-- expenses gain an EXP document number, payee type / employee / phone, a bill discount and the chosen approver.

insert into public.entity_schemas(kind,department,fields)values('expenses','Finance','[{"key":"name","label":"รายการค่าใช้จ่าย","type":"text","required":true},{"key":"projectId","label":"โครงการ","type":"relation","required":false,"resource":"projects"},{"key":"category","label":"หมวดหมู่","type":"select","required":true,"options":["ค่ามัดจำ","ค่าเช่า","ค่าไฟฟ้า","ค่าบริการ","ค่าพรม","บุคลากร","จัดซื้อ","ขนส่ง","การตลาด","อื่นๆ"]},{"key":"accountCode","label":"รหัสผังบัญชี","type":"text","required":false},{"key":"costCenter","label":"ศูนย์ต้นทุน","type":"text","required":false},{"key":"payee","label":"ผู้รับเงิน","type":"text","required":false},{"key":"supplierId","label":"Supplier","type":"relation","required":false,"resource":"suppliers"},{"key":"docType","label":"ประเภทเอกสาร","type":"select","required":false,"options":["ใบกำกับภาษีเต็มรูป","ใบกำกับภาษีอย่างย่อ","ใบเสร็จ","ใบแจ้งหนี้"]},{"key":"docNo","label":"เลขที่เอกสาร","type":"text","required":false},{"key":"taxId","label":"เลขผู้เสียภาษีผู้ขาย","type":"text","required":false},{"key":"date","label":"วันที่","type":"date","required":true},{"key":"receiptId","label":"ไฟล์ใบเสร็จ","type":"image","required":false,"hidden":true},{"key":"lines","label":"รายการสินค้า","type":"lines","required":false,"hidden":true},{"key":"amount","label":"ยอดตามเอกสาร","type":"number","required":true,"min":0},{"key":"vatMode","label":"VAT","type":"select","required":false,"options":["included","excluded","none"]},{"key":"whtRate","label":"หัก ณ ที่จ่าย (%)","type":"select","required":false,"options":["0","1","2","3","5"]},{"key":"payStatus","label":"การชำระ","type":"select","required":false,"options":["โอนแล้ว","เงินสดย่อย","ยังไม่จ่าย"]},{"key":"reviewStatus","label":"การตรวจ","type":"select","required":false,"options":["รอตรวจ","บันทึกแล้ว"],"hidden":true},{"key":"aiNotes","label":"เหตุผลจาก AI","type":"textarea","required":false,"hidden":true},{"key":"aiUncertain","label":"ช่องที่ AI ไม่แน่ใจ","type":"text","required":false,"hidden":true},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["pending","approved","paid","rejected"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false},{"key":"code","label":"เลขที่เอกสาร (EXP)","type":"text","required":false,"hidden":true},{"key":"payeeType","label":"ประเภทผู้รับเงิน","type":"select","required":false,"options":["บริษัท / Supplier","บุคคลธรรมดา","พนักงานในบริษัท"],"hidden":true},{"key":"employeeId","label":"พนักงานผู้รับเงิน","type":"relation","required":false,"resource":"employees","hidden":true},{"key":"payeePhone","label":"เบอร์โทรผู้รับเงิน","type":"tel","required":false,"hidden":true},{"key":"discount","label":"ส่วนลดท้ายบิล","type":"number","required":false,"min":0,"hidden":true},{"key":"discountType","label":"ประเภทส่วนลด","type":"select","required":false,"options":["amount","percent"],"hidden":true},{"key":"approver","label":"ผู้อนุมัติ","type":"text","required":false,"hidden":true}]'::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

-- Same as 0021, except item rows may carry the optional expense details above (still validated, unknown keys dropped).
create or replace function public.validate_payload(k text,p jsonb,c uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare specs jsonb;f jsonb;v jsonb;output jsonb:='{}';num numeric;rel entities;begin
 select fields into specs from entity_schemas where kind=k;if specs is null then raise exception 'ไม่พบโมดูล';end if;
 for f in select value from jsonb_array_elements(specs)loop v=p->(f->>'key');
 if v is null or v='null'::jsonb or v='""'::jsonb then if (f->>'required')::boolean then raise exception 'ข้อมูลไม่ครบ: %',f->>'label';end if;continue;end if;
 if f->>'type'='lines' then if jsonb_typeof(v)<>'array'or jsonb_array_length(v)>100 or exists(select 1 from jsonb_array_elements(v)x where jsonb_typeof(x)<>'object'or jsonb_typeof(x->'name')<>'string'or length(x->>'name')not between 1 and 500 or jsonb_typeof(x->'qty')<>'number'or jsonb_typeof(x->'price')<>'number'or (x->>'qty')::numeric not between 0 and 1e9 or abs((x->>'price')::numeric)>1e12
   or (x ? 'category' and(jsonb_typeof(x->'category')<>'string'or length(x->>'category')>100))or (x ? 'unit' and(jsonb_typeof(x->'unit')<>'string'or length(x->>'unit')>30))or (x ? 'currency' and(jsonb_typeof(x->'currency')<>'string'or length(x->>'currency')>3))or (x ? 'discount' and(jsonb_typeof(x->'discount')<>'number'or (x->>'discount')::numeric not between 0 and 1e12))or (x ? 'discountType' and(coalesce(x->>'discountType','')not in('percent','amount'))))then raise exception 'รายการสินค้าไม่ถูกต้อง';end if;
  v=(select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name',x->'name','qty',x->'qty','price',x->'price','category',x->'category','unit',x->'unit','currency',x->'currency','discount',x->'discount','discountType',x->'discountType'))),'[]'::jsonb)from jsonb_array_elements(v)x);
 elsif f->>'type'='number' then if jsonb_typeof(v)<>'number'then raise exception 'รูปแบบตัวเลขไม่ถูกต้อง';end if;num=(v#>>'{}')::numeric;if abs(num)>1e12 or (f ? 'min'and num<(f->>'min')::numeric)then raise exception 'จำนวนไม่ถูกต้อง';end if;
 else if jsonb_typeof(v)<>'string'or length(v#>>'{}')>10000 then raise exception 'รูปแบบข้อความไม่ถูกต้อง';end if;
 if f->>'type'='date' then if (v#>>'{}')!~ '^\d{4}-\d{2}-\d{2}$'or to_char((v#>>'{}')::date,'YYYY-MM-DD')<>(v#>>'{}')then raise exception 'วันที่ไม่ถูกต้อง';end if;end if;
 if f->>'type'='select'and not (f->'options')? (v#>>'{}')then raise exception 'ตัวเลือกไม่ถูกต้อง';end if;
 if f->>'type'='relation' then select * into rel from entities where id=(v#>>'{}')::uuid and company_id=c and kind=f->>'resource'and archived_at is null;if not found then raise exception 'ข้อมูลอ้างอิงไม่อยู่ในบริษัทนี้';end if;end if;end if;
 output=output||jsonb_build_object(f->>'key',v);end loop;
 if output->>'startDate'>output->>'endDate'then raise exception 'ช่วงวันที่ไม่ถูกต้อง';end if;return output;end$$;
revoke all on function public.validate_payload(text,jsonb,uuid) from public,anon,authenticated;

-- ข้อมูลตัวอย่าง: an owner can fill a real company with the demo company (src/lib/demo-company.ts) to try every page
-- and น้องโฟลว์, then archive it all in one click. Rows go through validate_payload and the normal entity triggers
-- (running numbers, stored totals, stock moves); their ids are kept in companies.settings.sample_ids.

create or replace function public.load_sample_data(p_company uuid,p_rows jsonb)returns int language plpgsql security definer set search_path=public as $$
declare r jsonb;clean jsonb;d text;n int:=0;ids jsonb:='[]';begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 if jsonb_typeof(p_rows)<>'array'or jsonb_array_length(p_rows)not between 1 and 2000 then raise exception 'ข้อมูลตัวอย่างไม่ถูกต้อง';end if;
 if jsonb_array_length(coalesce((select settings->'sample_ids'from companies where id=p_company),'[]'))>0 then raise exception 'ใส่ข้อมูลตัวอย่างไว้แล้ว ลบของเดิมก่อน';end if;
 -- Rows are ordered so a record only points at records inserted before it.
 for r in select value from jsonb_array_elements(p_rows)loop
  clean=validate_payload(r->>'kind',r->'data',p_company);
  select department into d from entity_schemas where kind=r->>'kind';
  if r->>'kind'in('tasks','documents')then d=coalesce(clean->>'department','Operations');end if;
  if r->>'kind'='tickets'and clean->>'type'='IT'then d='IT';end if;
  if r->>'kind'='products'then clean=clean||jsonb_build_object('stock',greatest(0,coalesce((r->>'stock')::numeric,0)));end if;
  if r->>'kind'='invoices'then clean=clean||jsonb_build_object('total',round((clean->>'subtotal')::numeric*(1+coalesce((clean->>'vat')::numeric,0)/100),2),'paid',greatest(0,coalesce((r->>'paid')::numeric,0)),'status',coalesce(r->>'status','issued'));end if;
  if r->>'kind'='payroll'then clean=clean||jsonb_build_object('net',(clean->>'base')::numeric+coalesce((clean->>'allowance')::numeric,0)-coalesce((clean->>'deduction')::numeric,0));end if;
  if r->>'kind'='purchases'then clean=clean||jsonb_build_object('total',(clean->>'quantity')::numeric*(clean->>'unitCost')::numeric,'status',coalesce(r->>'status','draft'));end if;
  insert into entities(id,company_id,kind,department,data,created_by)values((r->>'id')::uuid,p_company,r->>'kind',d,clean,auth.uid());
  ids=ids||to_jsonb(r->>'id');n=n+1;end loop;
 update companies set settings=settings||jsonb_build_object('sample_ids',ids)where id=p_company;
 perform log_action(p_company,'sample_data_loaded',n::text);return n;end$$;

create or replace function public.clear_sample_data(p_company uuid)returns int language plpgsql security definer set search_path=public as $$
declare n int;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัท';end if;
 update entities set archived_at=now(),updated_at=now()where company_id=p_company and archived_at is null
  and id in(select (value#>>'{}')::uuid from jsonb_array_elements(coalesce((select settings->'sample_ids'from companies where id=p_company),'[]')));
 get diagnostics n=row_count;
 update companies set settings=settings-'sample_ids'where id=p_company;
 perform log_action(p_company,'sample_data_cleared',n::text);return n;end$$;

revoke all on function public.load_sample_data(uuid,jsonb),public.clear_sample_data(uuid)from public,anon;
grant execute on function public.load_sample_data(uuid,jsonb),public.clear_sample_data(uuid)to authenticated;

-- Files are uploaded straight from the browser to storage (signed upload URL, src/lib/files.ts), so the 4 MB cap that
-- matched the hosting request limit can rise to 15 MB.
update storage.buckets set file_size_limit=15000000 where id='eliteflow-files';
