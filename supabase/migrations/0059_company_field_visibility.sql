-- 0059: public/private per company field (globe = public, lock = private) instead of per section.
--   companies.profile->>'visibility' is now the list of field keys other companies may see, plus 'products' for
--   active สินค้า & แพ็กเกจ. Missing = 'nameEn,description,website,facebook,line' (what was public before);
--   'none' = everything private. Name, bio, business type and province are always public (they appear on network
--   cards); bank details and document settings are never public. Your own company always sees everything.
create or replace function public.feed_company_profile(p_company uuid,p_target uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c companies; vis text[]; mine boolean; d jsonb:='{}'; k text;
begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 select * into c from companies where id=p_target;
 if c.id is null then return null;end if;
 mine:=c.id=p_company;
 vis:=string_to_array(coalesce(nullif(c.profile->>'visibility',''),'nameEn,description,website,facebook,line'),',');
 foreach k in array array['nameEn','taxId','registration','legal','employees','founded','description','address','zip','shipAddress','phone','email','website','line','facebook']loop
  if (mine or k=any(vis)) and coalesce(c.profile->>k,'')<>'' then d:=d||jsonb_build_object(k,left(c.profile->>k,3000));end if;
 end loop;
 return jsonb_build_object(
   'id',c.id,'name',c.name,'bio',left(coalesce(c.profile->>'bio',''),160),
   'name_en',coalesce(d->>'nameEn',''),
   'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),
   'has_logo',coalesce(c.profile->>'logo','')<>'','has_cover',coalesce(c.profile->>'cover','')<>'',
   'about',coalesce(d->>'description',''),
   'website',left(coalesce(d->>'website',''),200),'facebook',left(coalesce(d->>'facebook',''),200),'line',left(coalesce(d->>'line',''),200),
   'joined',c.created_at,
   'posts',(select count(*)from company_posts p where p.company_id=c.id and p.archived_at is null),
   'followers',(select count(*)from company_follows f where f.company_id=c.id),
   'following_count',(select count(*)from company_follows f where f.follower_id=c.id),
   'mine',mine,
   'following',exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=c.id),
   'follows_us',exists(select 1 from company_follows f where f.follower_id=c.id and f.company_id=p_company),
   'visibility',case when mine then coalesce(nullif(c.profile->>'visibility',''),'nameEn,description,website,facebook,line') else null end,
   'details',d-'nameEn'-'description'-'website'-'facebook'-'line',
   'products',case when mine or 'products'=any(vis) then coalesce((select jsonb_agg(x)from(
     select jsonb_build_object('id',e.id,'name',left(e.data->>'name',200),'code',left(coalesce(e.data->>'code',''),60),
       'type',coalesce(e.data->>'type',''),'price',case when e.data->>'price' ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.data->>'price')::numeric else 0 end,
       'description',left(coalesce(e.data->>'description',''),1000))x
     from entities e where e.company_id=c.id and e.kind='sales_packages' and e.archived_at is null
       and coalesce(e.data->>'status','active')='active'
     order by e.data->>'type',e.data->>'name' limit 200)q),'[]'::jsonb) else '[]'::jsonb end);
end$$;
revoke all on function public.feed_company_profile(uuid,uuid)from public,anon;
grant execute on function public.feed_company_profile(uuid,uuid)to authenticated;
select 'ok 0059' as result,(select count(*)from public.companies where profile ? 'visibility')as with_visibility;
