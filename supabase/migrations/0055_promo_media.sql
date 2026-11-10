-- 0055: promotions can carry an image or a video, and a new placement 'billing' shows them as the banner on แพ็กเกจบริการ.
--   Media lives in the public bucket eliteflow-promo (platform admins upload through a signed URL; 50 MB max).
alter table public.promos add column if not exists media_url text not null default '';
alter table public.promos add column if not exists media_type text not null default '';
alter table public.promos drop constraint if exists promos_media_url_check;
alter table public.promos add constraint promos_media_url_check check(media_url='' or media_url ~ '^https://');
alter table public.promos drop constraint if exists promos_media_type_check;
alter table public.promos add constraint promos_media_type_check check(media_type in('','image','video'));
alter table public.promos drop constraint if exists promos_placement_check;
alter table public.promos add constraint promos_placement_check check(placement in('landing','feed','both','billing'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('eliteflow-promo','eliteflow-promo',true,50000000,array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'])on conflict(id)do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
select 'ok 0055' as result,(select count(*)from public.promos where media_url<>'')as with_media;
