-- 0057: company page sections and who may see them.
--   companies.profile->>'visibility' lists the sections other companies may see: main (about, type, size, founded,
--   English name, tax id), address, social (phone, e-mail, website, LINE, Facebook) and products (active สินค้า &
--   แพ็กเกจ). Missing = 'main,social' (what was public before); 'none' = everything private. Bank details and
--   document settings are never shown to other companies. Your own company always sees everything.
create or replace function public.feed_company_profile(p_company uuid,p_target uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c companies; vis text[]; mine boolean; facts boolean; pub_main boolean; pub_addr boolean; pub_social boolean; pub_products boolean;
begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 select * into c from companies where id=p_target;
 if c.id is null then return null;end if;
 mine:=c.id=p_company;
 vis:=string_to_array(coalesce(nullif(c.profile->>'visibility',''),'main,social'),',');
 pub_main:=mine or 'main'=any(vis);pub_addr:=mine or 'address'=any(vis);
 pub_social:=mine or 'social'=any(vis);pub_products:=mine or 'products'=any(vis);
 -- Tax id, size and founding date were never public before: shown only once the owner has chosen (visibility saved).
 facts:=mine or (c.profile ? 'visibility' and 'main'=any(vis));
 return jsonb_build_object(
   'id',c.id,'name',c.name,'name_en',case when pub_main then coalesce(c.profile->>'nameEn','') else '' end,
   'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),
   'has_logo',coalesce(c.profile->>'logo','')<>'','has_cover',coalesce(c.profile->>'cover','')<>'',
   'about',case when pub_main then left(coalesce(c.profile->>'description',''),3000) else '' end,
   'website',case when pub_social then left(coalesce(c.profile->>'website',''),200) else '' end,
   'facebook',case when pub_social then left(coalesce(c.profile->>'facebook',''),200) else '' end,
   'line',case when pub_social then left(coalesce(c.profile->>'line',''),200) else '' end,
   'joined',c.created_at,
   'posts',(select count(*)from company_posts p where p.company_id=c.id and p.archived_at is null),
   'followers',(select count(*)from company_follows f where f.company_id=c.id),
   'following_count',(select count(*)from company_follows f where f.follower_id=c.id),
   'mine',mine,
   'following',exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=c.id),
   'follows_us',exists(select 1 from company_follows f where f.follower_id=c.id and f.company_id=p_company),
   'visibility',case when mine then coalesce(nullif(c.profile->>'visibility',''),'main,social') else null end,
   'details',jsonb_strip_nulls(jsonb_build_object(
     'taxId',case when facts then c.profile->>'taxId' end,'legal',case when facts then c.profile->>'legal' end,
     'employees',case when facts then c.profile->>'employees' end,'founded',case when facts then c.profile->>'founded' end,
     'address',case when pub_addr then left(c.profile->>'address',500) end,'zip',case when pub_addr then c.profile->>'zip' end,
     'phone',case when pub_social then left(c.profile->>'phone',50) end,'email',case when pub_social then left(c.profile->>'email',200) end)),
   'products',case when pub_products then coalesce((select jsonb_agg(x)from(
     select jsonb_build_object('id',e.id,'name',left(e.data->>'name',200),'code',left(coalesce(e.data->>'code',''),60),
       'type',coalesce(e.data->>'type',''),'price',case when e.data->>'price' ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.data->>'price')::numeric else 0 end,
       'description',left(coalesce(e.data->>'description',''),1000))x
     from entities e where e.company_id=c.id and e.kind='sales_packages' and e.archived_at is null
       and coalesce(e.data->>'status','active')='active'
     order by e.data->>'type',e.data->>'name' limit 200)q),'[]'::jsonb) else '[]'::jsonb end);
end$$;
revoke all on function public.feed_company_profile(uuid,uuid)from public,anon;
grant execute on function public.feed_company_profile(uuid,uuid)to authenticated;
select 'ok 0057' as result,(select count(*)from public.companies where profile ? 'visibility')as with_visibility;
