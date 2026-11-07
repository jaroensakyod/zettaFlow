-- B2B chat: a conversation started from a feed post shows that post as a card (picture, company, title, excerpt, meta).
-- b2b_inbox / b2b_read keep the checks of 0041 and return the richer post; b2b_post gives the card for b2b_open.

-- Internal: the card for one post (null when it does not exist or is archived, unless p_any).
create or replace function public.b2b_post_card(p_post uuid,p_any boolean default false)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',p.id,'title',coalesce(nullif(p.meta->>'title',''),left(p.body,90)),'kind',p.kind,
  'excerpt',left(p.body,200),'meta',p.meta,'image',p.images[1],'created_at',p.created_at,
  'company',jsonb_build_object('id',c.id,'name',c.name,'has_logo',coalesce(c.profile->>'logo','')<>''))
 from company_posts p join companies c on c.id=p.company_id where p.id=p_post and(p_any or p.archived_at is null)$$;
revoke all on function public.b2b_post_card(uuid,boolean)from public,anon,authenticated;

-- The card for a post we are about to ask about (any member of a company may see network posts).
create or replace function public.b2b_post(p_company uuid,p_post uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return b2b_post_card(p_post);end$$;

create or replace function public.b2b_inbox(p_company uuid)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id',t.id,'last_at',t.last_at,
   'company',jsonb_build_object('id',c.id,'name',c.name,'industry',coalesce(c.profile->>'industry',''),'province',coalesce(c.profile->>'province',''),'has_logo',coalesce(c.profile->>'logo','')<>''),
   'post',b2b_post_card(t.post_id),
   'last',(select jsonb_build_object('body',left(m.body,140),'mine',m.company_id=p_company,'at',m.created_at)from b2b_messages m where m.thread_id=t.id order by m.created_at desc limit 1),
   'unread',(select count(*)from b2b_messages m where m.thread_id=t.id and m.company_id<>p_company and m.created_at>coalesce((select read_at from b2b_reads r where r.thread_id=t.id and r.company_id=p_company),'-infinity')))
  order by t.last_at desc)
  from b2b_threads t join companies c on c.id=case when t.company_a=p_company then t.company_b else t.company_a end
  where p_company in(t.company_a,t.company_b)),'[]');end$$;

-- Messages keep the card of the post they asked about, even after the post is archived.
create or replace function public.b2b_read(p_company uuid,p_thread uuid,p_before timestamptz default null)returns jsonb language plpgsql security definer set search_path=public as $$declare t b2b_threads;begin
 t=b2b_thread_of(p_company,p_thread);
 insert into b2b_reads(thread_id,company_id,read_at)values(t.id,p_company,now())on conflict(thread_id,company_id)do update set read_at=now();
 return coalesce((select jsonb_agg(x order by x->>'created_at')from(
  select jsonb_build_object('id',m.id,'company_id',m.company_id,'company_name',c.name,'author_name',m.author_name,'body',m.body,'created_at',m.created_at,'mine',m.company_id=p_company,
   'post',b2b_post_card(m.post_id,true))x
  from b2b_messages m join companies c on c.id=m.company_id
  where m.thread_id=t.id and(p_before is null or m.created_at<p_before)order by m.created_at desc limit 200)q),'[]');end$$;

revoke all on function public.b2b_post(uuid,uuid),public.b2b_inbox(uuid),public.b2b_read(uuid,uuid,timestamptz)from public,anon;
grant execute on function public.b2b_post(uuid,uuid),public.b2b_inbox(uuid),public.b2b_read(uuid,uuid,timestamptz)to authenticated;
