-- Feed engagement (design update, page 5): views, shares and saved posts on every post, a LINE contact button from
-- the posting company's profile, a "saved" filter, and the notification list in the feed's left column.

create table public.post_views(post_id uuid not null references company_posts(id)on delete cascade,user_id uuid not null,created_at timestamptz not null default now(),primary key(post_id,user_id));
create table public.post_shares(post_id uuid not null references company_posts(id)on delete cascade,user_id uuid not null,created_at timestamptz not null default now(),primary key(post_id,user_id));
create table public.post_saves(post_id uuid not null references company_posts(id)on delete cascade,user_id uuid not null,created_at timestamptz not null default now(),primary key(post_id,user_id));
create index post_saves_user on post_saves(user_id,created_at desc);
alter table post_views enable row level security;alter table post_shares enable row level security;alter table post_saves enable row level security;
revoke all on post_views,post_shares,post_saves from anon,authenticated;
grant all on post_views,post_shares,post_saves to service_role;

create or replace function public.feed_signed_in()returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid()is not null and exists(select 1 from memberships where user_id=auth.uid()and not disabled)$$;
revoke all on function public.feed_signed_in()from public,anon,authenticated;

-- One view per person per post, sent in batches as posts scroll into sight.
create or replace function public.feed_view(p_posts uuid[])returns void language plpgsql security definer set search_path=public as $$begin
 if not feed_signed_in()then raise exception 'เข้าสู่ระบบก่อน';end if;
 insert into post_views(post_id,user_id)select p.id,auth.uid()from company_posts p where p.id=any(coalesce(p_posts,'{}'))and p.archived_at is null
 limit 50 on conflict do nothing;end$$;

create or replace function public.feed_share(p_post uuid)returns bigint language plpgsql security definer set search_path=public as $$begin
 if not feed_signed_in()then raise exception 'เข้าสู่ระบบก่อน';end if;
 if not exists(select 1 from company_posts where id=p_post and archived_at is null)then raise exception 'ไม่พบโพสต์';end if;
 insert into post_shares(post_id,user_id)values(p_post,auth.uid())on conflict do nothing;
 return(select count(*)from post_shares where post_id=p_post);end$$;

create or replace function public.feed_save(p_post uuid)returns boolean language plpgsql security definer set search_path=public as $$begin
 if not feed_signed_in()then raise exception 'เข้าสู่ระบบก่อน';end if;
 if not exists(select 1 from company_posts where id=p_post and archived_at is null)then raise exception 'ไม่พบโพสต์';end if;
 delete from post_saves where post_id=p_post and user_id=auth.uid();
 if found then return false;end if;
 insert into post_saves(post_id,user_id)values(p_post,auth.uid());return true;end$$;

create or replace function public.feed_list(p_company uuid,p_filter text default 'all',p_before timestamptz default null,p_limit int default 20)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(item order by (item->>'created_at')desc)from(
  select jsonb_build_object(
   'id',p.id,'company_id',p.company_id,'author_name',p.author_name,'kind',p.kind,'body',p.body,'meta',p.meta,'images',to_jsonb(p.images),'created_at',p.created_at,
   'company',jsonb_build_object('name',c.name,'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),'has_logo',coalesce(c.profile->>'logo','')<>'','line',left(coalesce(c.profile->>'line',''),200)),
   'likes',(select count(*)from post_likes l where l.post_id=p.id),
   'liked',exists(select 1 from post_likes l where l.post_id=p.id and l.user_id=auth.uid()),
   'comment_count',(select count(*)from post_comments m where m.post_id=p.id),
   'comments',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_name',m.author_name,'company_name',mc.name,'body',m.body,'created_at',m.created_at)order by m.created_at)from(select * from post_comments where post_id=p.id order by created_at desc limit 3)m join companies mc on mc.id=m.company_id),'[]'),
   'views',(select count(*)from post_views v where v.post_id=p.id),
   'shares',(select count(*)from post_shares s where s.post_id=p.id),
   'saved',exists(select 1 from post_saves s where s.post_id=p.id and s.user_id=auth.uid()),
   'following',exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=p.company_id),
   'mine',p.company_id=p_company,
   'can_delete',p.author_id=auth.uid()or member_role(p.company_id)='owner',
   'proposal_count',case when p.company_id=p_company then(select count(*)from post_proposals r where r.post_id=p.id)else 0 end,
   'proposed',exists(select 1 from post_proposals r where r.post_id=p.id and r.company_id=p_company)) as item
  from company_posts p join companies c on c.id=p.company_id
  where p.archived_at is null and(p_before is null or p.created_at<p_before)
   and case p_filter when 'following' then p.company_id=p_company or exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=p.company_id)
    when 'post' then p.kind='post' when 'job' then p.kind='job' when 'partner' then p.kind='partner' when 'mine' then p.company_id=p_company
    when 'offers' then p.kind in('job','partner')
    when 'saved' then exists(select 1 from post_saves s where s.post_id=p.id and s.user_id=auth.uid())
    else true end
  order by p.created_at desc limit least(greatest(coalesce(p_limit,20),1),50))q),'[]');end$$;

-- What happened around our company in the network (last 60 days), newest first. The page counts what is newer than
-- the last time this person opened each group.
--   interest = another company sent a proposal to our job/partner post (ผู้สนใจติดต่อ)
--   reply    = a company answered our proposal (การตอบรับงาน)
--   message  = another company commented on our post (ข้อความใหม่)
--   network  = a company started following us (คำขอเข้าร่วมเครือข่าย)
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
  select jsonb_build_object('kind','network','id',f.follower_id,'at',f.created_at,'who',fc.name,'title','เริ่มติดตามบริษัทของคุณ'),f.created_at
   from company_follows f join companies fc on fc.id=f.follower_id
   where f.company_id=p_company and f.created_at>now()-interval '60 days'
  )x order by at desc limit 60)y),'[]');end$$;

revoke all on function public.feed_view(uuid[]),public.feed_share(uuid),public.feed_save(uuid),public.feed_alerts(uuid)from public,anon;
grant execute on function public.feed_view(uuid[]),public.feed_share(uuid),public.feed_save(uuid),public.feed_alerts(uuid)to authenticated;
