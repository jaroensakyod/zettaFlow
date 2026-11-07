-- Company profile pages in the business network: our own and any other company's, with who follows whom.
-- Only public information: the network card (name, business type, province, logo), cover, description and the
-- public channels already shown on posts (website, Facebook, LINE). Never tax id, address, bank or phone.

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
   -- company:<id> = one company's updates (its profile page).
   and(p_filter not like 'company:%' or p.company_id=substr(p_filter,9)::uuid)
  order by p.created_at desc limit least(greatest(coalesce(p_limit,20),1),50))q),'[]');end$$;

-- One company's profile, seen by p_company: card, counts, and whether we follow each other.
create or replace function public.feed_company_profile(p_company uuid,p_target uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return(select jsonb_build_object(
   'id',c.id,'name',c.name,'name_en',coalesce(c.profile->>'nameEn',''),
   'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),
   'has_logo',coalesce(c.profile->>'logo','')<>'','has_cover',coalesce(c.profile->>'cover','')<>'',
   'about',left(coalesce(c.profile->>'description',''),3000),
   'website',left(coalesce(c.profile->>'website',''),200),'facebook',left(coalesce(c.profile->>'facebook',''),200),'line',left(coalesce(c.profile->>'line',''),200),
   'joined',c.created_at,
   'posts',(select count(*)from company_posts p where p.company_id=c.id and p.archived_at is null),
   'followers',(select count(*)from company_follows f where f.company_id=c.id),
   'following_count',(select count(*)from company_follows f where f.follower_id=c.id),
   'mine',c.id=p_company,
   'following',exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=c.id),
   'follows_us',exists(select 1 from company_follows f where f.follower_id=c.id and f.company_id=p_company))
  from companies c where c.id=p_target);end$$;

-- Who follows a company (p_dir='followers') or whom it follows ('following'), newest first, as network cards.
create or replace function public.feed_follow_list(p_company uuid,p_target uuid,p_dir text)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 if p_dir not in('followers','following')then raise exception 'ประเภทไม่ถูกต้อง';end if;
 return coalesce((select jsonb_agg(x order by x->>'since' desc)from(
  select jsonb_build_object('id',c.id,'name',c.name,'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),
   'has_logo',coalesce(c.profile->>'logo','')<>'','since',f.created_at,'mine',c.id=p_company,
   'following',exists(select 1 from company_follows g where g.follower_id=p_company and g.company_id=c.id))x
  from company_follows f join companies c on c.id=case when p_dir='followers' then f.follower_id else f.company_id end
  where case when p_dir='followers' then f.company_id=p_target else f.follower_id=p_target end
  order by f.created_at desc limit 300)q),'[]');end$$;

revoke all on function public.feed_company_profile(uuid,uuid),public.feed_follow_list(uuid,uuid,text)from public,anon;
grant execute on function public.feed_company_profile(uuid,uuid),public.feed_follow_list(uuid,uuid,text)to authenticated;

-- Cover picture of a company profile (any signed-in member; like the logo in company_card).
create or replace function public.company_cover(p_id uuid)returns text language sql stable security definer set search_path=public as $$
 select nullif(profile->>'cover','')from companies where id=p_id and auth.uid()is not null$$;
revoke all on function public.company_cover(uuid)from public,anon;
grant execute on function public.company_cover(uuid)to authenticated;
