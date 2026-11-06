-- B2B chat: one conversation per pair of companies (opened from a feed post, a suggestion or the chat page).
-- Every active member of either company sees the conversation; viewers read only. Writes go through RPCs.

create table public.b2b_threads(id uuid primary key default gen_random_uuid(),company_a uuid not null references companies(id),company_b uuid not null references companies(id),post_id uuid references company_posts(id)on delete set null,created_at timestamptz not null default now(),last_at timestamptz not null default now(),check(company_a<company_b),unique(company_a,company_b));
create index b2b_threads_a on b2b_threads(company_a,last_at desc);
create index b2b_threads_b on b2b_threads(company_b,last_at desc);
create table public.b2b_messages(id uuid primary key default gen_random_uuid(),thread_id uuid not null references b2b_threads(id)on delete cascade,company_id uuid not null references companies(id),author_id uuid not null,author_name text not null,body text not null check(length(body)between 1 and 4000),post_id uuid references company_posts(id)on delete set null,created_at timestamptz not null default now());
create index b2b_messages_thread on b2b_messages(thread_id,created_at desc);
-- Read position per company (what anyone in that company has seen).
create table public.b2b_reads(thread_id uuid not null references b2b_threads(id)on delete cascade,company_id uuid not null references companies(id),read_at timestamptz not null default now(),primary key(thread_id,company_id));
alter table b2b_threads enable row level security;alter table b2b_messages enable row level security;alter table b2b_reads enable row level security;
revoke all on b2b_threads,b2b_messages,b2b_reads from anon,authenticated;
grant all on b2b_threads,b2b_messages,b2b_reads to service_role;

-- Find or start the conversation between our company and another one; a post gives it context.
create or replace function public.b2b_open(p_company uuid,p_target uuid,p_post uuid default null)returns uuid language plpgsql security definer set search_path=public as $$declare t uuid;lo uuid=least(p_company,p_target);hi uuid=greatest(p_company,p_target);begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 if p_company=p_target or not exists(select 1 from companies where id=p_target)then raise exception 'เปิดแชทกับบริษัทนี้ไม่ได้';end if;
 if p_post is not null and not exists(select 1 from company_posts where id=p_post and archived_at is null)then p_post=null;end if;
 select id into t from b2b_threads where company_a=lo and company_b=hi;
 if t is null then
  if member_role(p_company)='viewer' then raise exception 'ผู้ชมเริ่มแชทใหม่ไม่ได้';end if;
  insert into b2b_threads(company_a,company_b,post_id)values(lo,hi,p_post)returning id into t;
 elsif p_post is not null then update b2b_threads set post_id=p_post where id=t;
 end if;
 return t;end$$;

create or replace function public.b2b_thread_of(p_company uuid,p_thread uuid)returns b2b_threads language plpgsql stable security definer set search_path=public as $$declare t b2b_threads;begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 select * into t from b2b_threads where id=p_thread and p_company in(company_a,company_b);
 if not found then raise exception 'ไม่พบห้องแชท';end if;
 return t;end$$;
revoke all on function public.b2b_thread_of(uuid,uuid)from public,anon,authenticated;

-- Our conversations, newest first, with the other company, the last message and how many we have not read.
create or replace function public.b2b_inbox(p_company uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id',t.id,'last_at',t.last_at,
   'company',jsonb_build_object('id',c.id,'name',c.name,'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),'has_logo',coalesce(c.profile->>'logo','')<>''),
   'post',(select jsonb_build_object('id',p.id,'title',coalesce(nullif(p.meta->>'title',''),left(p.body,90)),'kind',p.kind)from company_posts p where p.id=t.post_id and p.archived_at is null),
   'last',(select jsonb_build_object('body',left(m.body,140),'mine',m.company_id=p_company,'at',m.created_at)from b2b_messages m where m.thread_id=t.id order by m.created_at desc limit 1),
   'unread',(select count(*)from b2b_messages m where m.thread_id=t.id and m.company_id<>p_company and m.created_at>coalesce((select read_at from b2b_reads r where r.thread_id=t.id and r.company_id=p_company),'-infinity')))
  order by t.last_at desc)
  from b2b_threads t join companies c on c.id=case when t.company_a=p_company then t.company_b else t.company_a end
  where p_company in(t.company_a,t.company_b)),'[]');end$$;

-- Messages of one conversation (oldest first, up to 200 before a point); reading marks it read for our company.
create or replace function public.b2b_read(p_company uuid,p_thread uuid,p_before timestamptz default null)returns jsonb language plpgsql security definer set search_path=public as $$declare t b2b_threads;begin
 t=b2b_thread_of(p_company,p_thread);
 insert into b2b_reads(thread_id,company_id,read_at)values(t.id,p_company,now())on conflict(thread_id,company_id)do update set read_at=now();
 return coalesce((select jsonb_agg(x order by x->>'created_at')from(
  select jsonb_build_object('id',m.id,'company_id',m.company_id,'company_name',c.name,'author_name',m.author_name,'body',m.body,'created_at',m.created_at,'mine',m.company_id=p_company,
   'post',(select jsonb_build_object('id',p.id,'title',coalesce(nullif(p.meta->>'title',''),left(p.body,90)),'kind',p.kind)from company_posts p where p.id=m.post_id))x
  from b2b_messages m join companies c on c.id=m.company_id
  where m.thread_id=t.id and(p_before is null or m.created_at<p_before)order by m.created_at desc limit 200)q),'[]');end$$;

create or replace function public.b2b_send(p_company uuid,p_thread uuid,p_body text,p_post uuid default null)returns jsonb language plpgsql security definer set search_path=public as $$declare t b2b_threads;m b2b_messages;begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์ส่งข้อความในนามบริษัทนี้';end if;
 t=b2b_thread_of(p_company,p_thread);
 if length(trim(coalesce(p_body,'')))not between 1 and 4000 then raise exception 'ข้อความยาว 1–4000 ตัวอักษร';end if;
 if p_post is not null and not exists(select 1 from company_posts where id=p_post and archived_at is null)then p_post=null;end if;
 insert into b2b_messages(thread_id,company_id,author_id,author_name,body,post_id)values(t.id,p_company,auth.uid(),feed_author(p_company),trim(p_body),p_post)returning * into m;
 update b2b_threads set last_at=m.created_at where id=t.id;
 insert into b2b_reads(thread_id,company_id,read_at)values(t.id,p_company,m.created_at)on conflict(thread_id,company_id)do update set read_at=excluded.read_at;
 return jsonb_build_object('id',m.id,'company_id',m.company_id,'author_name',m.author_name,'body',m.body,'created_at',m.created_at,'mine',true);end$$;

-- Unread chat for the top bar / feed badge.
create or replace function public.b2b_unread(p_company uuid)returns bigint language sql stable security definer set search_path=public as $$
 select count(*)from b2b_messages m join b2b_threads t on t.id=m.thread_id
 where member_role(p_company)is not null and p_company in(t.company_a,t.company_b)and m.company_id<>p_company
  and m.created_at>coalesce((select read_at from b2b_reads r where r.thread_id=t.id and r.company_id=p_company),'-infinity')$$;

revoke all on function public.b2b_open(uuid,uuid,uuid),public.b2b_inbox(uuid),public.b2b_read(uuid,uuid,timestamptz),public.b2b_send(uuid,uuid,text,uuid),public.b2b_unread(uuid)from public,anon;
grant execute on function public.b2b_open(uuid,uuid,uuid),public.b2b_inbox(uuid),public.b2b_read(uuid,uuid,timestamptz),public.b2b_send(uuid,uuid,text,uuid),public.b2b_unread(uuid)to authenticated;

-- The feed notifications (ข้อความใหม่) also list chat messages from other companies.
create or replace function public.feed_alerts(p_company uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(e order by e->>'at' desc)from(select e from(
  select jsonb_build_object('kind','interest','id',r.id,'at',r.created_at,'who',c.name,'title',coalesce(nullif(p.meta->>'title',''),left(p.body,90)),'post_id',p.id)e,r.created_at at
   from post_proposals r join company_posts p on p.id=r.post_id join companies c on c.id=r.company_id
   where p.company_id=p_company and r.created_at>now()-interval '60 days'
  union all
  select jsonb_build_object('kind','reply','id',r.id,'at',r.updated_at,'who',pc.name,'title',coalesce(nullif(p.meta->>'title',''),left(p.body,90)),'post_id',p.id,'status',r.status),r.updated_at
   from post_proposals r join company_posts p on p.id=r.post_id join companies pc on pc.id=p.company_id
   where r.company_id=p_company and r.status<>'sent' and r.updated_at>now()-interval '60 days'
  union all
  select jsonb_build_object('kind','message','id',m.id,'at',m.created_at,'who',mc.name,'title',left(m.body,90),'post_id',p.id),m.created_at
   from post_comments m join company_posts p on p.id=m.post_id join companies mc on mc.id=m.company_id
   where p.company_id=p_company and m.company_id<>p_company and p.archived_at is null and m.created_at>now()-interval '60 days'
  union all
  select jsonb_build_object('kind','message','id',m.id,'at',m.created_at,'who',mc.name,'title',left(m.body,90),'thread_id',t.id),m.created_at
   from b2b_messages m join b2b_threads t on t.id=m.thread_id join companies mc on mc.id=m.company_id
   where p_company in(t.company_a,t.company_b)and m.company_id<>p_company and m.created_at>now()-interval '60 days'
  union all
  select jsonb_build_object('kind','network','id',f.follower_id,'at',f.created_at,'who',fc.name,'title','เริ่มติดตามบริษัทของคุณ'),f.created_at
   from company_follows f join companies fc on fc.id=f.follower_id
   where f.company_id=p_company and f.created_at>now()-interval '60 days'
  )x order by at desc limit 60)y),'[]');end$$;
