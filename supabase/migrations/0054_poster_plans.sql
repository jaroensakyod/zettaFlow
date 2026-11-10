-- 0054: the four packages from the Nov 2026 poster (prices exclude VAT 7%; yearly = 10 months).
--   Starter 2,590 · Growth 3,590 · Business 5,990 (new) · Enterprise 9,990
--   LINE groups 3 / 5 / 10 / unlimited · AI items 2,500 / 5,000 / 10,000 / 25,000 · voice 60 / 150 / 300 / 900 min
--   storage 5 / 15 / 40 / 100 GB · users 5 / 10 / 25 / unlimited. Mirrors `plans` in src/lib/billing.ts.
alter table public.plans add column if not exists voice_minutes int;
alter table public.plans add column if not exists storage_gb int;
insert into public.plans(id,name,monthly,yearly,workflows,documents,line_groups,users,ordinal,voice_minutes,storage_gb)values
 ('starter','Starter',2590,25900,5,2500,3,5,1,60,5),
 ('growth','Growth',3590,35900,20,5000,5,10,2,150,15),
 ('business','Business',5990,59900,50,10000,10,25,3,300,40),
 ('enterprise','Enterprise',9990,99900,null,25000,null,null,4,900,100)
on conflict(id)do update set name=excluded.name,monthly=excluded.monthly,yearly=excluded.yearly,workflows=excluded.workflows,
 documents=excluded.documents,line_groups=excluded.line_groups,users=excluded.users,ordinal=excluded.ordinal,
 voice_minutes=excluded.voice_minutes,storage_gb=excluded.storage_gb;
select 'ok 0054' as result,(select count(*)from public.plans)as plans,(select monthly from public.plans where id='business')as business;
