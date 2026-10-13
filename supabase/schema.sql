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
