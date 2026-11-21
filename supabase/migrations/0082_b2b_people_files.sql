-- B2B chat: every message shows who sent it (their picture, name and company), and a message can carry pictures and
-- files. Pictures of people: one per signed-in person (user_profiles.avatar_at, file eliteflow-avatars/<user>.webp).
-- Chat files: eliteflow-b2b/<thread>/<file>, readable by the members of the two companies in that conversation.

create table if not exists public.user_profiles(user_id uuid primary key,avatar_at timestamptz,updated_at timestamptz not null default now());
alter table user_profiles enable row level security;
revoke all on user_profiles from anon,authenticated;
grant all on user_profiles to service_role;

-- Set (true) or clear (false) the signed-in person's picture; returns its version (null when cleared).
create or replace function public.set_my_avatar(p_on boolean)returns timestamptz language plpgsql security definer set search_path=public as $$declare t timestamptz=case when p_on then now() end;begin
 if auth.uid()is null then raise exception 'ไม่มีสิทธิ์';end if;
 insert into user_profiles(user_id,avatar_at,updated_at)values(auth.uid(),t,now())on conflict(user_id)do update set avatar_at=t,updated_at=now();
 return t;end$$;
revoke all on function set_my_avatar(boolean)from public,anon;
grant execute on function set_my_avatar(boolean)to authenticated;

-- The signed-in person's picture version (null: none).
create or replace function public.my_avatar()returns timestamptz language sql stable security definer set search_path=public as $$select avatar_at from user_profiles where user_id=auth.uid()$$;
revoke all on function my_avatar()from public,anon;
grant execute on function my_avatar()to authenticated;

-- A member (p_write: who may send, not a viewer) of either company in the conversation.
create or replace function public.b2b_thread_member(p_thread uuid,p_write boolean default false)returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from b2b_threads t join memberships m on m.company_id in(t.company_a,t.company_b)and m.user_id=auth.uid()and not m.disabled
  where t.id=p_thread and(not p_write or m.role<>'viewer'))$$;
revoke all on function b2b_thread_member(uuid,boolean)from public,anon;
grant execute on function b2b_thread_member(uuid,boolean)to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('eliteflow-avatars','eliteflow-avatars',false,1000000,array['image/webp'])on conflict(id)do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('eliteflow-b2b','eliteflow-b2b',false,10000000,
 array['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/zip'])on conflict(id)do nothing;
drop policy if exists eliteflow_avatars_read on storage.objects;
drop policy if exists eliteflow_avatars_insert on storage.objects;
drop policy if exists eliteflow_avatars_update on storage.objects;
drop policy if exists eliteflow_avatars_delete on storage.objects;
create policy eliteflow_avatars_read on storage.objects for select to authenticated using(bucket_id='eliteflow-avatars');
create policy eliteflow_avatars_insert on storage.objects for insert to authenticated with check(bucket_id='eliteflow-avatars'and name=auth.uid()::text||'.webp');
create policy eliteflow_avatars_update on storage.objects for update to authenticated using(bucket_id='eliteflow-avatars'and name=auth.uid()::text||'.webp');
create policy eliteflow_avatars_delete on storage.objects for delete to authenticated using(bucket_id='eliteflow-avatars'and name=auth.uid()::text||'.webp');
drop policy if exists eliteflow_b2b_read on storage.objects;
drop policy if exists eliteflow_b2b_insert on storage.objects;
create policy eliteflow_b2b_read on storage.objects for select to authenticated using(bucket_id='eliteflow-b2b'and b2b_thread_member(((storage.foldername(name))[1])::uuid));
create policy eliteflow_b2b_insert on storage.objects for insert to authenticated with check(bucket_id='eliteflow-b2b'and b2b_thread_member(((storage.foldername(name))[1])::uuid,true));

-- Files on a message: [{path,name,mime,size}], paths inside this conversation's folder. A message is text, files or both.
alter table b2b_messages add column if not exists files jsonb not null default '[]';
alter table b2b_messages drop constraint if exists b2b_messages_body_check;
alter table b2b_messages add constraint b2b_messages_body_check check(length(body)<=4000 and(length(body)>=1 or jsonb_array_length(files)>0));

-- The sender as a chat shows them: picture version, name, company and its logo.
create or replace function public.b2b_sender(m b2b_messages)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('author_id',m.author_id,'avatar_at',(select p.avatar_at from user_profiles p where p.user_id=m.author_id),
  'company_name',c.name,'company_has_logo',coalesce(c.profile->>'logo','')<>'')from companies c where c.id=m.company_id$$;
revoke all on function b2b_sender(b2b_messages)from public,anon,authenticated;

drop function if exists public.b2b_send(uuid,uuid,text,uuid);
create or replace function public.b2b_send(p_company uuid,p_thread uuid,p_body text,p_post uuid default null,p_files jsonb default '[]')returns jsonb language plpgsql security definer set search_path=public as $$declare t b2b_threads;m b2b_messages;f jsonb=coalesce(p_files,'[]');begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์ส่งข้อความในนามบริษัทนี้';end if;
 t=b2b_thread_of(p_company,p_thread);
 if jsonb_typeof(f)<>'array'or jsonb_array_length(f)>10 or exists(select 1 from jsonb_array_elements(f)x where jsonb_typeof(x)<>'object'
   or coalesce(x->>'path','')!~('^'||t.id::text||'/[0-9a-f-]{36}\.[a-z0-9]{1,5}$')or length(coalesce(x->>'name',''))not between 1 and 200
   or length(coalesce(x->>'mime',''))not between 1 and 120 or jsonb_typeof(x->'size')<>'number'or(x->>'size')::numeric not between 1 and 10000000)
  then raise exception 'ไฟล์แนบไม่ถูกต้อง';end if;
 if length(trim(coalesce(p_body,'')))>4000 or(length(trim(coalesce(p_body,'')))=0 and jsonb_array_length(f)=0)then raise exception 'ข้อความยาว 1–4000 ตัวอักษร';end if;
 if p_post is not null and not exists(select 1 from company_posts where id=p_post and archived_at is null)then p_post=null;end if;
 insert into b2b_messages(thread_id,company_id,author_id,author_name,body,post_id,files)
  values(t.id,p_company,auth.uid(),feed_author(p_company),trim(coalesce(p_body,'')),p_post,(select coalesce(jsonb_agg(jsonb_build_object('path',x->>'path','name',x->>'name','mime',x->>'mime','size',(x->>'size')::bigint)),'[]')from jsonb_array_elements(f)x))
  returning * into m;
 update b2b_threads set last_at=m.created_at where id=t.id;
 insert into b2b_reads(thread_id,company_id,read_at)values(t.id,p_company,m.created_at)on conflict(thread_id,company_id)do update set read_at=excluded.read_at;
 return jsonb_build_object('id',m.id,'company_id',m.company_id,'author_name',m.author_name,'body',m.body,'files',m.files,'created_at',m.created_at,'mine',true)||b2b_sender(m);end$$;
revoke all on function b2b_send(uuid,uuid,text,uuid,jsonb)from public,anon;
grant execute on function b2b_send(uuid,uuid,text,uuid,jsonb)to authenticated;

create or replace function public.b2b_read(p_company uuid,p_thread uuid,p_before timestamptz default null)returns jsonb language plpgsql security definer set search_path=public as $$declare t b2b_threads;begin
 t=b2b_thread_of(p_company,p_thread);
 insert into b2b_reads(thread_id,company_id,read_at)values(t.id,p_company,now())on conflict(thread_id,company_id)do update set read_at=now();
 return coalesce((select jsonb_agg(x order by x->>'created_at')from(
  select jsonb_build_object('id',m.id,'company_id',m.company_id,'author_name',m.author_name,'body',m.body,'files',m.files,'created_at',m.created_at,'mine',m.company_id=p_company,
   'post',b2b_post_card(m.post_id,true),'card_id',m.card_id)||b2b_sender(m)x
  from b2b_messages m
  where m.thread_id=t.id and(p_before is null or m.created_at<p_before)order by m.created_at desc limit 200)q),'[]');end$$;

-- The inbox and alerts name a message with only files.
create or replace function public.b2b_inbox(p_company uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id',t.id,'last_at',t.last_at,
   'company',jsonb_build_object('id',c.id,'name',c.name,'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),'has_logo',coalesce(c.profile->>'logo','')<>''),
   'post',b2b_post_card(t.post_id),
   'last',(select jsonb_build_object('body',coalesce(nullif(left(m.body,140),''),'ส่งไฟล์แนบ'),'mine',m.company_id=p_company,'at',m.created_at)from b2b_messages m where m.thread_id=t.id order by m.created_at desc limit 1),
   'unread',(select count(*)from b2b_messages m where m.thread_id=t.id and m.company_id<>p_company and m.created_at>coalesce((select read_at from b2b_reads r where r.thread_id=t.id and r.company_id=p_company),'-infinity')))
  order by t.last_at desc)
  from b2b_threads t join companies c on c.id=case when t.company_a=p_company then t.company_b else t.company_a end
  where p_company in(t.company_a,t.company_b)),'[]');end$$;

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
  select case when op.id is not null and not exists(select 1 from b2b_messages e where e.thread_id=m.thread_id and e.post_id=m.post_id and e.company_id=m.company_id and e.created_at<m.created_at)
    then jsonb_build_object('kind','interest','id',m.id,'at',m.created_at,'who',mc.name,'title',coalesce(nullif(op.meta->>'title',''),left(op.body,90)),'body',coalesce(nullif(left(m.body,90),''),'ส่งไฟล์แนบ'),'post_id',op.id,'thread_id',t.id)
    else jsonb_build_object('kind','message','id',m.id,'at',m.created_at,'who',mc.name,'title',coalesce(nullif(left(m.body,90),''),'ส่งไฟล์แนบ'),'thread_id',t.id)end,m.created_at
   from b2b_messages m join b2b_threads t on t.id=m.thread_id join companies mc on mc.id=m.company_id
   left join company_posts op on op.id=m.post_id and op.company_id=p_company and op.kind in('job','partner')
   where p_company in(t.company_a,t.company_b)and m.company_id<>p_company and m.created_at>now()-interval '60 days'
  union all
  select jsonb_build_object('kind','network','id',f.follower_id,'at',f.created_at,'who',fc.name,'title','เริ่มติดตามบริษัทของคุณ'),f.created_at
   from company_follows f join companies fc on fc.id=f.follower_id
   where f.company_id=p_company and f.created_at>now()-interval '60 days'
  )x order by at desc limit 60)y),'[]');end$$;
