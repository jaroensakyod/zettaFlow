-- ลงโฆษณา: a company buys a sponsored card in เครือข่ายธุรกิจ (/feed) with coins (เหรียญ).
-- The ad is shown to other companies (never to the buyer's own feed), matching business type first.
-- Views and clicks are counted once per viewing company per day.

create table if not exists public.ad_packages(id text primary key,name text not null,days int not null check(days>0),coins int not null check(coins>0),ordinal int not null default 0);
insert into ad_packages values('d3','3 วัน',3,30,1),('d7','7 วัน',7,60,2),('d30','30 วัน',30,200,3)
 on conflict(id)do update set name=excluded.name,days=excluded.days,coins=excluded.coins,ordinal=excluded.ordinal;

create table if not exists public.feed_ads(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),
 post_id uuid references company_posts(id)on delete set null,
 title text not null check(length(title)between 1 and 120),body text not null default '' check(length(body)<=500),
 cta_label text not null default '' check(length(cta_label)<=40),cta_url text not null default '' check(cta_url='' or cta_url ~ '^(https://|/)'),
 tone text not null default 'violet' check(tone in('violet','pink','blue','green')),target_industry text not null default '' check(length(target_industry)<=100),
 package_id text not null references ad_packages(id),coins int not null,
 status text not null default 'active' check(status in('active','paused','removed')),
 starts_at timestamptz not null default now(),ends_at timestamptz not null,created_by uuid,created_at timestamptz not null default now());
create index if not exists feed_ads_live on feed_ads(ends_at)where status='active';
create table if not exists public.feed_ad_events(ad_id uuid not null references feed_ads(id)on delete cascade,viewer_company uuid not null,kind text not null check(kind in('view','click')),day date not null default current_date,primary key(ad_id,viewer_company,kind,day));

alter table ad_packages enable row level security;alter table feed_ads enable row level security;alter table feed_ad_events enable row level security;
drop policy if exists ad_packages_read on ad_packages;create policy ad_packages_read on ad_packages for select to anon,authenticated using(true);
drop policy if exists feed_ads_own on feed_ads;create policy feed_ads_own on feed_ads for select to authenticated using(member_role(company_id)is not null);
revoke all on ad_packages,feed_ads,feed_ad_events from anon,authenticated;
grant select on ad_packages to anon,authenticated;grant select on feed_ads to authenticated;
grant all on ad_packages,feed_ads,feed_ad_events to service_role;
alter table coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table coin_ledger add constraint coin_ledger_reason_check check(reason in('topup','purchase','adjust','ad'));

-- Owner buys an ad: coins are taken and the ad goes live at once for the package's days.
create or replace function public.buy_feed_ad(p_company uuid,p_package text,p_ad jsonb)returns feed_ads language plpgsql security definer set search_path=public as $$declare pk ad_packages;w coin_wallets;r feed_ads;v_post uuid;begin
 if member_role(p_company)is distinct from 'owner'then raise exception 'เฉพาะเจ้าของบริษัทซื้อโฆษณาได้';end if;
 select * into pk from ad_packages where id=p_package;if not found then raise exception 'ไม่พบแพ็กเกจโฆษณา';end if;
 v_post=nullif(p_ad->>'post_id','')::uuid;
 if v_post is not null and not exists(select 1 from company_posts where id=v_post and company_id=p_company and archived_at is null)then raise exception 'เลือกได้เฉพาะโพสต์ของบริษัทตัวเอง';end if;
 select * into w from coin_wallets where company_id=p_company for update;
 if coalesce(w.balance,0)<pk.coins then raise exception 'เหรียญไม่พอ ต้องใช้ % เหรียญ กรุณาเติมเหรียญ',pk.coins;end if;
 insert into feed_ads(company_id,post_id,title,body,cta_label,cta_url,tone,target_industry,package_id,coins,ends_at,created_by)
  values(p_company,v_post,trim(p_ad->>'title'),coalesce(trim(p_ad->>'body'),''),coalesce(trim(p_ad->>'cta_label'),''),coalesce(trim(p_ad->>'cta_url'),''),
   coalesce(nullif(p_ad->>'tone',''),'violet'),coalesce(trim(p_ad->>'target_industry'),''),pk.id,pk.coins,now()+make_interval(days=>pk.days),auth.uid())returning * into r;
 update coin_wallets set balance=balance-pk.coins,updated_at=now()where company_id=p_company;
 insert into coin_ledger(company_id,delta,reason,ref,created_by)values(p_company,-pk.coins,'ad',r.id::text,auth.uid());
 perform log_action(p_company,'feed_ad_bought',r.id::text);
 return r;end$$;

-- Pause / resume (owner or manager). Days keep running while paused; a finished ad cannot be resumed.
create or replace function public.set_feed_ad_status(p_company uuid,p_id uuid,p_status text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)not in('owner','manager')then raise exception 'ไม่มีสิทธิ์';end if;
 if p_status not in('active','paused')then raise exception 'สถานะไม่ถูกต้อง';end if;
 update feed_ads set status=p_status where id=p_id and company_id=p_company and status<>'removed'and(p_status='paused'or ends_at>now());
 if not found then raise exception 'ไม่พบโฆษณา หรือหมดเวลาแล้ว';end if;end$$;

-- Ads a viewing company sees: live, from other companies; same business type first, then random.
create or replace function public.feed_ads_live(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 with me as(select coalesce(profile->>'industry','')industry from companies where id=p_company)
 select coalesce(jsonb_agg(x),'[]')from(
  select jsonb_build_object('id',a.id,'company_id',a.company_id,'company',c.name,'industry',coalesce(c.profile->>'industry',''),'has_logo',coalesce(c.profile->>'logo','')<>'',
   'title',a.title,'body',a.body,'cta_label',a.cta_label,'cta_url',a.cta_url,'tone',a.tone,'post_id',a.post_id)x
  from feed_ads a join companies c on c.id=a.company_id cross join me
  where member_role(p_company)is not null and a.status='active'and a.starts_at<=now()and a.ends_at>now()and a.company_id<>p_company
  order by(a.target_industry<>''and a.target_industry=me.industry)desc,random()limit 4)s$$;

create or replace function public.feed_ad_track(p_company uuid,p_ad uuid,p_kind text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is null or p_kind not in('view','click')then return;end if;
 insert into feed_ad_events(ad_id,viewer_company,kind)select p_ad,p_company,p_kind where exists(select 1 from feed_ads where id=p_ad and company_id<>p_company)on conflict do nothing;end$$;

-- The buyer's own ads with their numbers.
create or replace function public.my_feed_ads(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object(
  'views',(select count(*)from feed_ad_events e where e.ad_id=a.id and e.kind='view'),
  'clicks',(select count(*)from feed_ad_events e where e.ad_id=a.id and e.kind='click'),
  'package',(select name from ad_packages p where p.id=a.package_id))order by a.created_at desc),'[]')
 from feed_ads a where a.company_id=p_company and member_role(p_company)is not null and a.status<>'removed'$$;

revoke all on function public.buy_feed_ad(uuid,text,jsonb),public.set_feed_ad_status(uuid,uuid,text),public.feed_ads_live(uuid),public.feed_ad_track(uuid,uuid,text),public.my_feed_ads(uuid)from public,anon;
grant execute on function public.buy_feed_ad(uuid,text,jsonb),public.set_feed_ad_status(uuid,uuid,text),public.feed_ads_live(uuid),public.feed_ad_track(uuid,uuid,text),public.my_feed_ads(uuid)to authenticated;
