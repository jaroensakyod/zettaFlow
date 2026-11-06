-- เครือข่ายธุรกิจ (/feed): platform ads and better company suggestions.
-- 1) A promotion can now be shown on the public landing page, as a sponsored card in the business feed, or both.
alter table public.promos add column if not exists placement text not null default 'landing';
alter table public.promos drop constraint if exists promos_placement_check;
alter table public.promos add constraint promos_placement_check check(placement in('landing','feed','both'));

-- 2) Suggested companies: only companies that take part in the network (they have posted), not followed yet,
--    same business type first, then same province, then the most recently active. Says why each one is suggested.
create or replace function public.feed_suggest(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 with me as(select coalesce(profile->>'industry','')industry,coalesce(profile->>'province','')province from companies where id=p_company)
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'industry',s.industry,'province',s.province,'has_logo',s.has_logo,'posts',s.posts,'reason',s.reason)order by s.score desc,s.last_post desc),'[]')from(
  select c.id,c.name,coalesce(c.profile->>'industry','')industry,coalesce(c.profile->>'province','')province,coalesce(c.profile->>'logo','')<>'' has_logo,
   count(p.id)posts,max(p.created_at)last_post,
   (case when me.industry<>''and c.profile->>'industry'=me.industry then 2 else 0 end)+(case when me.province<>''and c.profile->>'province'=me.province then 1 else 0 end)score,
   case when me.industry<>''and c.profile->>'industry'=me.industry then 'ธุรกิจประเภทเดียวกับคุณ'
        when me.province<>''and c.profile->>'province'=me.province then 'อยู่จังหวัดเดียวกัน'
        else 'อัปเดตล่าสุด '||to_char(max(p.created_at)at time zone 'Asia/Bangkok','DD/MM')end reason
  from companies c join company_posts p on p.company_id=c.id and p.archived_at is null cross join me
  where member_role(p_company)is not null and c.id<>p_company and not exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=c.id)
  group by c.id,me.industry,me.province order by score desc,last_post desc limit 6)s$$;
revoke all on function public.feed_suggest(uuid)from public,anon;
grant execute on function public.feed_suggest(uuid)to authenticated;
