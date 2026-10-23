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
