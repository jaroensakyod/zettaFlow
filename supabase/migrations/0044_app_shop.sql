-- EliteFlow App Shop: AI characters and themes (buy once) and business-type systems (monthly, 30 days per purchase),
-- paid with company coins exactly like department modules (0020). The active theme/character is one row per company.

create table public.shop_items(id text primary key,kind text not null check(kind in('character','theme','system')),name text not null,price_coins int not null check(price_coins>=0),period text not null default 'once' check(period in('once','month')),active boolean not null default true,ordinal int not null default 0);
-- Mirrors shopCatalog in src/lib/app-shop.ts (prices are read from here, never from the client).
insert into shop_items values
 ('nong_flow','character','น้องโฟลว์',0,'once',true,0),
 ('siri_style','character','Siri Style',300,'once',true,1),
 ('elite_style','character','Elite Style',300,'once',true,2),
 ('neo_anime','character','Neo Anime',250,'once',true,3),
 ('nova_anime','character','Nova Anime',250,'once',true,4),
 ('flow_dog','character','Flow Dog',200,'once',true,5),
 ('mochi_cat','character','Mochi Cat',200,'once',true,6),
 ('elitebot','character','EliteBot',150,'once',true,7),
 ('flow_dragon','character','Flow Dragon',250,'once',true,8),
 ('modern_purple','theme','Modern Purple',0,'once',true,10),
 ('luxury_black_gold','theme','Luxury Black Gold',199,'once',true,11),
 ('clean_minimal','theme','Clean Minimal',199,'once',true,12),
 ('soft_pink','theme','Soft Pink',199,'once',true,13),
 ('clinic_medical','theme','Clinic Medical',199,'once',true,14),
 ('real_estate_theme','theme','Real Estate',199,'once',true,15),
 ('condo_rental','system','ระบบบริหารคอนโด / ปล่อยเช่า',1200,'month',true,20),
 ('beauty_clinic','system','ระบบบริหารคลินิกความงาม',1500,'month',true,21),
 ('restaurant_cafe','system','ระบบบริหารร้านอาหารและคาเฟ่',900,'month',true,22),
 ('medical_clinic','system','ระบบบริหารคลินิกการแพทย์',1800,'month',true,23),
 ('real_estate','system','ระบบอสังหาริมทรัพย์ (โครงการ)',2000,'month',true,24);

create table public.company_shop_items(company_id uuid not null references companies(id),item_id text not null references shop_items(id),kind text not null,price_coins int not null,bought_at timestamptz not null default now(),expires_at timestamptz,primary key(company_id,item_id));
-- Active look per company; null = the free default (Modern Purple / น้องโฟลว์).
create table public.company_shop_settings(company_id uuid primary key references companies(id),theme text references shop_items(id),character text references shop_items(id),updated_by uuid,updated_at timestamptz not null default now());

alter table shop_items enable row level security;alter table company_shop_items enable row level security;alter table company_shop_settings enable row level security;
create policy shop_items_read on shop_items for select to anon,authenticated using(active);
create policy company_shop_items_read on company_shop_items for select to authenticated using(member_role(company_id)is not null);
create policy company_shop_settings_read on company_shop_settings for select to authenticated using(member_role(company_id)is not null);
revoke all on shop_items,company_shop_items,company_shop_settings from anon,authenticated;
grant select on shop_items to anon,authenticated;grant select on company_shop_items,company_shop_settings to authenticated;
grant all on shop_items,company_shop_items,company_shop_settings to service_role;

-- Owner/manager buys an item with coins (wallet row locked so two purchases cannot overspend).
-- Once-items can be bought once; a monthly system can be renewed: 30 days added from now or from its current expiry.
create or replace function public.shop_buy(p_company uuid,p_item text)returns company_shop_items language plpgsql security definer set search_path=public as $$declare i shop_items;w coin_wallets;o company_shop_items;r company_shop_items;begin
 if member_role(p_company)is null or member_role(p_company)not in('owner','manager')then raise exception 'เฉพาะเจ้าของหรือผู้จัดการ';end if;
 select * into i from shop_items where id=p_item and active;if not found then raise exception 'ไม่พบสินค้า';end if;
 if i.price_coins=0 then raise exception 'รายการนี้ใช้ได้ฟรีอยู่แล้ว';end if;
 select * into o from company_shop_items where company_id=p_company and item_id=p_item for update;
 if found and i.period='once' then raise exception 'ซื้อรายการนี้แล้ว';end if;
 select * into w from coin_wallets where company_id=p_company for update;
 if coalesce(w.balance,0)<i.price_coins then raise exception 'เหรียญไม่พอ กรุณาเติมเหรียญ';end if;
 update coin_wallets set balance=balance-i.price_coins,updated_at=now()where company_id=p_company;
 insert into coin_ledger(company_id,delta,reason,ref,created_by)values(p_company,-i.price_coins,'purchase','shop:'||i.id,auth.uid());
 insert into company_shop_items(company_id,item_id,kind,price_coins,expires_at)
  values(p_company,i.id,i.kind,i.price_coins,case when i.period='month' then now()+interval '30 days' end)
  on conflict(company_id,item_id)do update set price_coins=excluded.price_coins,bought_at=now(),
   expires_at=greatest(coalesce(company_shop_items.expires_at,now()),now())+interval '30 days'
  returning * into r;
 perform log_action(p_company,'shop_purchased',i.id);return r;end$$;

-- Owner/manager switches the active theme or character; only free defaults or owned items qualify.
create or replace function public.shop_activate(p_company uuid,p_kind text,p_item text)returns company_shop_settings language plpgsql security definer set search_path=public as $$declare i shop_items;r company_shop_settings;begin
 if member_role(p_company)is null or member_role(p_company)not in('owner','manager')then raise exception 'เฉพาะเจ้าของหรือผู้จัดการ';end if;
 if p_kind not in('theme','character')then raise exception 'ประเภทไม่ถูกต้อง';end if;
 select * into i from shop_items where id=p_item and kind=p_kind and active;if not found then raise exception 'ไม่พบสินค้า';end if;
 if i.price_coins>0 and not exists(select 1 from company_shop_items where company_id=p_company and item_id=p_item)then raise exception 'ยังไม่ได้ซื้อรายการนี้';end if;
 insert into company_shop_settings(company_id,theme,character,updated_by)
  values(p_company,case when p_kind='theme'then p_item end,case when p_kind='character'then p_item end,auth.uid())
  on conflict(company_id)do update set theme=case when p_kind='theme'then p_item else company_shop_settings.theme end,
   character=case when p_kind='character'then p_item else company_shop_settings.character end,updated_by=auth.uid(),updated_at=now()
  returning * into r;
 perform log_action(p_company,'shop_activated',p_kind||':'||p_item);return r;end$$;
revoke all on function public.shop_buy(uuid,text),public.shop_activate(uuid,text,text)from public,anon;
grant execute on function public.shop_buy(uuid,text),public.shop_activate(uuid,text,text)to authenticated;
