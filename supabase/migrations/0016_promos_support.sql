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
