-- Company feed: a network-wide social timeline where companies post updates, job openings and partner requests.
-- Posts are visible to every signed-in member of any company; writes go through security-definer RPCs.

create table public.company_posts(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),author_id uuid not null,author_name text not null,kind text not null default 'post' check(kind in('post','job','partner')),body text not null check(length(body)between 1 and 5000),meta jsonb not null default '{}',images text[] not null default '{}' check(cardinality(images)<=4),created_at timestamptz not null default now(),archived_at timestamptz);
create index company_posts_feed on company_posts(created_at desc)where archived_at is null;
create index company_posts_company on company_posts(company_id,created_at desc);
create table public.post_likes(post_id uuid not null references company_posts(id)on delete cascade,user_id uuid not null,created_at timestamptz not null default now(),primary key(post_id,user_id));
create table public.post_comments(id uuid primary key default gen_random_uuid(),post_id uuid not null references company_posts(id)on delete cascade,company_id uuid not null references companies(id),author_id uuid not null,author_name text not null,body text not null check(length(body)between 1 and 2000),created_at timestamptz not null default now());
create index post_comments_post on post_comments(post_id,created_at);
create table public.company_follows(follower_id uuid not null references companies(id),company_id uuid not null references companies(id),created_at timestamptz not null default now(),primary key(follower_id,company_id),check(follower_id<>company_id));
alter table company_posts enable row level security;alter table post_likes enable row level security;alter table post_comments enable row level security;alter table company_follows enable row level security;
create policy company_posts_read on company_posts for select to authenticated using(archived_at is null);
create policy post_comments_read on post_comments for select to authenticated using(true);
create policy company_follows_read on company_follows for select to authenticated using(member_role(follower_id)is not null);
revoke all on company_posts,post_likes,post_comments,company_follows from anon,authenticated;
grant select on company_posts,post_comments,company_follows to authenticated;
grant all on company_posts,post_likes,post_comments,company_follows to service_role;

-- Post images: <company>/<post>/<n>.webp, written by that company's members, readable by any signed-in user.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('eliteflow-posts','eliteflow-posts',false,1600000,array['image/png','image/jpeg','image/webp'])on conflict(id)do nothing;
create policy eliteflow_posts_read on storage.objects for select to authenticated using(bucket_id='eliteflow-posts');
create policy eliteflow_posts_insert on storage.objects for insert to authenticated with check(bucket_id='eliteflow-posts'and member_role(((storage.foldername(name))[1])::uuid)in('owner','manager','staff'));
create policy eliteflow_posts_delete on storage.objects for delete to authenticated using(bucket_id='eliteflow-posts'and member_role(((storage.foldername(name))[1])::uuid)in('owner','manager','staff'));

create or replace function public.feed_author(p_company uuid)returns text language sql stable security definer set search_path=public as $$
 select coalesce(nullif(name,''),email)from memberships where company_id=p_company and user_id=auth.uid()and not disabled$$;
revoke all on function public.feed_author(uuid)from public,anon,authenticated;

create or replace function public.feed_post(p_company uuid,p_id uuid,p_kind text,p_body text,p_meta jsonb,p_images text[])returns company_posts language plpgsql security definer set search_path=public as $$declare p company_posts;i text;begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์โพสต์ในนามบริษัทนี้';end if;
 if p_kind not in('post','job','partner')then raise exception 'ประเภทโพสต์ไม่ถูกต้อง';end if;
 if length(trim(coalesce(p_body,'')))not between 1 and 5000 then raise exception 'เขียนข้อความโพสต์ 1–5000 ตัวอักษร';end if;
 if p_kind<>'post' and length(trim(coalesce(p_meta->>'title','')))not between 1 and 120 then raise exception 'ใส่หัวข้อประกาศ';end if;
 if jsonb_typeof(coalesce(p_meta,'{}'))<>'object' or length(coalesce(p_meta,'{}')::text)>1000 then raise exception 'ข้อมูลประกาศไม่ถูกต้อง';end if;
 if cardinality(coalesce(p_images,'{}'))>4 then raise exception 'แนบรูปได้สูงสุด 4 รูป';end if;
 foreach i in array coalesce(p_images,'{}')loop
  if i !~ ('^'||p_company::text||'/'||p_id::text||'/[0-9]\.(webp|png|jpg)$')then raise exception 'รูปภาพไม่ถูกต้อง';end if;
 end loop;
 insert into company_posts(id,company_id,author_id,author_name,kind,body,meta,images)values(p_id,p_company,auth.uid(),feed_author(p_company),p_kind,trim(p_body),coalesce(p_meta,'{}'),coalesce(p_images,'{}'))returning * into p;
 return p;end$$;

create or replace function public.feed_delete(p_post uuid)returns void language plpgsql security definer set search_path=public as $$declare p company_posts;begin
 select * into p from company_posts where id=p_post and archived_at is null;
 if not found then raise exception 'ไม่พบโพสต์';end if;
 if p.author_id is distinct from auth.uid() and member_role(p.company_id)is distinct from 'owner' then raise exception 'ลบได้เฉพาะผู้โพสต์หรือเจ้าของบริษัท';end if;
 update company_posts set archived_at=now()where id=p_post;end$$;

create or replace function public.feed_like(p_post uuid)returns jsonb language plpgsql security definer set search_path=public as $$declare liked boolean;begin
 if auth.uid()is null or not exists(select 1 from memberships where user_id=auth.uid()and not disabled)then raise exception 'เข้าสู่ระบบก่อน';end if;
 if not exists(select 1 from company_posts where id=p_post and archived_at is null)then raise exception 'ไม่พบโพสต์';end if;
 delete from post_likes where post_id=p_post and user_id=auth.uid();
 liked=not found;
 if liked then insert into post_likes(post_id,user_id)values(p_post,auth.uid());end if;
 return jsonb_build_object('liked',liked,'likes',(select count(*)from post_likes where post_id=p_post));end$$;

create or replace function public.feed_comment(p_company uuid,p_post uuid,p_body text)returns post_comments language plpgsql security definer set search_path=public as $$declare c post_comments;begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์แสดงความคิดเห็น';end if;
 if length(trim(coalesce(p_body,'')))not between 1 and 2000 then raise exception 'ความคิดเห็นยาว 1–2000 ตัวอักษร';end if;
 if not exists(select 1 from company_posts where id=p_post and archived_at is null)then raise exception 'ไม่พบโพสต์';end if;
 insert into post_comments(post_id,company_id,author_id,author_name,body)values(p_post,p_company,auth.uid(),feed_author(p_company),trim(p_body))returning * into c;
 return c;end$$;

create or replace function public.feed_follow(p_company uuid,p_target uuid)returns boolean language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์';end if;
 if p_company=p_target or not exists(select 1 from companies where id=p_target)then raise exception 'ติดตามบริษัทนี้ไม่ได้';end if;
 delete from company_follows where follower_id=p_company and company_id=p_target;
 if found then return false;end if;
 insert into company_follows(follower_id,company_id)values(p_company,p_target);return true;end$$;

-- Public card of a company: only what a feed shows, never the full profile.
create or replace function public.company_card(p_id uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'name',name,'industry',coalesce(profile->>'industry',''),'province',coalesce(profile->>'province',''),'about',left(coalesce(profile->>'description',''),300),'logo',coalesce(profile->>'logo',''))
 from companies where id=p_id and auth.uid()is not null$$;

create or replace function public.feed_list(p_company uuid,p_filter text default 'all',p_before timestamptz default null,p_limit int default 20)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(item order by (item->>'created_at')desc)from(
  select jsonb_build_object(
   'id',p.id,'company_id',p.company_id,'author_name',p.author_name,'kind',p.kind,'body',p.body,'meta',p.meta,'images',to_jsonb(p.images),'created_at',p.created_at,
   'company',jsonb_build_object('name',c.name,'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),'has_logo',coalesce(c.profile->>'logo','')<>''),
   'likes',(select count(*)from post_likes l where l.post_id=p.id),
   'liked',exists(select 1 from post_likes l where l.post_id=p.id and l.user_id=auth.uid()),
   'comment_count',(select count(*)from post_comments m where m.post_id=p.id),
   'comments',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_name',m.author_name,'company_name',mc.name,'body',m.body,'created_at',m.created_at)order by m.created_at)from(select * from post_comments where post_id=p.id order by created_at desc limit 3)m join companies mc on mc.id=m.company_id),'[]'),
   'following',exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=p.company_id),
   'mine',p.company_id=p_company,
   'can_delete',p.author_id=auth.uid()or member_role(p.company_id)='owner') as item
  from company_posts p join companies c on c.id=p.company_id
  where p.archived_at is null and(p_before is null or p.created_at<p_before)
   and case p_filter when 'following' then p.company_id=p_company or exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=p.company_id)
    when 'post' then p.kind='post' when 'job' then p.kind='job' when 'partner' then p.kind='partner' when 'mine' then p.company_id=p_company else true end
  order by p.created_at desc limit least(greatest(coalesce(p_limit,20),1),50))q),'[]');end$$;

create or replace function public.feed_suggest(p_company uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'industry',s.industry,'has_logo',s.has_logo)),'[]')from(
  select c.id,c.name,coalesce(c.profile->>'industry','')industry,coalesce(c.profile->>'logo','')<>'' has_logo,max(p.created_at)last_post
  from companies c join company_posts p on p.company_id=c.id and p.archived_at is null
  where member_role(p_company)is not null and c.id<>p_company and not exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=c.id)
  group by c.id order by last_post desc limit 5)s$$;

revoke all on function public.feed_post(uuid,uuid,text,text,jsonb,text[]),public.feed_delete(uuid),public.feed_like(uuid),public.feed_comment(uuid,uuid,text),public.feed_follow(uuid,uuid),public.company_card(uuid),public.feed_list(uuid,text,timestamptz,int),public.feed_suggest(uuid)from public,anon;
grant execute on function public.feed_post(uuid,uuid,text,text,jsonb,text[]),public.feed_delete(uuid),public.feed_like(uuid),public.feed_comment(uuid,uuid,text),public.feed_follow(uuid,uuid),public.company_card(uuid),public.feed_list(uuid,text,timestamptz,int),public.feed_suggest(uuid)to authenticated;
