-- The business network shows every real company on EliteFlow, not only those that have posted.
-- Only the public card is exposed (name, industry, province, logo flag, short description) — same as company_card.

-- Suggestions: companies we do not follow yet; same business type / province first, then ones that post, then newest.
create or replace function public.feed_suggest(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 with me as(select coalesce(profile->>'industry','')industry,coalesce(profile->>'province','')province from companies where id=p_company)
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'industry',s.industry,'province',s.province,'has_logo',s.has_logo,'posts',s.posts,'reason',s.reason)order by s.score desc,s.posts desc,s.last_post desc nulls last,s.created_at desc),'[]')from(
  select c.id,c.name,c.created_at,coalesce(c.profile->>'industry','')industry,coalesce(c.profile->>'province','')province,coalesce(c.profile->>'logo','')<>'' has_logo,
   count(p.id)posts,max(p.created_at)last_post,
   (case when me.industry<>''and c.profile->>'industry'=me.industry then 2 else 0 end)+(case when me.province<>''and c.profile->>'province'=me.province then 1 else 0 end)score,
   case when me.industry<>''and c.profile->>'industry'=me.industry then 'ธุรกิจประเภทเดียวกับคุณ'
        when me.province<>''and c.profile->>'province'=me.province then 'อยู่จังหวัดเดียวกัน'
        when count(p.id)>0 then 'อัปเดตล่าสุด '||to_char(max(p.created_at)at time zone 'Asia/Bangkok','DD/MM')
        else 'เพิ่งเข้าร่วมเครือข่าย' end reason
  from companies c left join company_posts p on p.company_id=c.id and p.archived_at is null cross join me
  where member_role(p_company)is not null and c.id<>p_company and length(trim(coalesce(c.name,'')))>0
   and not exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=c.id)
  group by c.id,me.industry,me.province order by score desc,count(p.id)desc,max(p.created_at)desc nulls last,c.created_at desc limit 6)s$$;

-- All companies on the network (for the "บริษัทในเครือข่าย" list), searchable by name / business type / province.
create or replace function public.feed_companies(p_company uuid,p_search text default null,p_limit int default 60)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(x order by (x->>'posts')::int desc,x->>'joined' desc)from(
  select jsonb_build_object('id',c.id,'name',c.name,'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),
   'has_logo',coalesce(c.profile->>'logo','')<>'','about',left(coalesce(c.profile->>'description',''),140),'joined',c.created_at,
   'posts',(select count(*)from company_posts p where p.company_id=c.id and p.archived_at is null),
   'following',exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=c.id))x
  from companies c
  where c.id<>p_company and length(trim(coalesce(c.name,'')))>0
   and(coalesce(trim(p_search),'')=''or c.name ilike '%'||trim(p_search)||'%'or c.profile->>'industry' ilike '%'||trim(p_search)||'%'or c.profile->>'province' ilike '%'||trim(p_search)||'%')
  order by c.created_at desc limit least(greatest(coalesce(p_limit,60),1),200))q),'[]');end$$;
revoke all on function public.feed_companies(uuid,text,int)from public,anon;
grant execute on function public.feed_companies(uuid,text,int)to authenticated;
