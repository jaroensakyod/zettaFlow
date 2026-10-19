-- Job & partner matching: a company sends a proposal to a job or partner post; the posting company reviews it.

create table public.post_proposals(id uuid primary key default gen_random_uuid(),post_id uuid not null references company_posts(id)on delete cascade,company_id uuid not null references companies(id),author_id uuid not null,author_name text not null,message text not null check(length(message)between 1 and 3000),contact text not null default '' check(length(contact)<=200),status text not null default 'sent' check(status in('sent','shortlisted','declined')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(post_id,company_id));
create index post_proposals_company on post_proposals(company_id,created_at desc);
alter table post_proposals enable row level security;
-- Visible to the proposing company and to the company that owns the post.
create policy post_proposals_read on post_proposals for select to authenticated using(member_role(company_id)is not null or exists(select 1 from company_posts p where p.id=post_id and member_role(p.company_id)is not null));
revoke all on post_proposals from anon,authenticated;grant select on post_proposals to authenticated;grant all on post_proposals to service_role;

create or replace function public.feed_propose(p_company uuid,p_post uuid,p_message text,p_contact text)returns post_proposals language plpgsql security definer set search_path=public as $$declare p company_posts;r post_proposals;begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์ส่งข้อเสนอในนามบริษัทนี้';end if;
 select * into p from company_posts where id=p_post and archived_at is null;
 if not found or p.kind not in('job','partner')then raise exception 'ไม่พบประกาศ';end if;
 if p.company_id=p_company then raise exception 'เสนอให้ประกาศของบริษัทตัวเองไม่ได้';end if;
 if length(trim(coalesce(p_message,'')))not between 1 and 3000 then raise exception 'เขียนข้อเสนอ 1–3000 ตัวอักษร';end if;
 if length(coalesce(p_contact,''))>200 then raise exception 'ช่องทางติดต่อยาวเกินไป';end if;
 if exists(select 1 from post_proposals where post_id=p_post and company_id=p_company)then raise exception 'บริษัทของคุณส่งข้อเสนอให้ประกาศนี้แล้ว';end if;
 insert into post_proposals(post_id,company_id,author_id,author_name,message,contact)values(p_post,p_company,auth.uid(),feed_author(p_company),trim(p_message),trim(coalesce(p_contact,'')))returning * into r;
 return r;end$$;

-- The post's company sees every proposal; a proposing company sees only its own.
create or replace function public.feed_proposals(p_company uuid,p_post uuid default null)returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'post_id',r.post_id,'company_id',r.company_id,'company_name',c.name,'company_industry',coalesce(c.profile->>'industry',''),'author_name',r.author_name,'message',r.message,'contact',r.contact,'status',r.status,'created_at',r.created_at,
   'post_title',coalesce(p.meta->>'title',left(p.body,90)),'post_kind',p.kind,'post_company',pc.name,'incoming',p.company_id=p_company)order by r.created_at desc)
  from post_proposals r join company_posts p on p.id=r.post_id join companies c on c.id=r.company_id join companies pc on pc.id=p.company_id
  where (p.company_id=p_company or r.company_id=p_company)and(p_post is null or r.post_id=p_post)),'[]');end$$;

create or replace function public.feed_proposal_status(p_company uuid,p_id uuid,p_status text)returns void language plpgsql security definer set search_path=public as $$begin
 if member_role(p_company)not in('owner','manager')then raise exception 'เฉพาะ Owner หรือ Manager';end if;
 if p_status not in('sent','shortlisted','declined')then raise exception 'สถานะไม่ถูกต้อง';end if;
 update post_proposals r set status=p_status,updated_at=now()from company_posts p where r.id=p_id and p.id=r.post_id and p.company_id=p_company;
 if not found then raise exception 'ไม่พบข้อเสนอ';end if;end$$;

-- feed_list gains proposal info: how many a post of ours received, and whether we already proposed.
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
   'can_delete',p.author_id=auth.uid()or member_role(p.company_id)='owner',
   'proposal_count',case when p.company_id=p_company then(select count(*)from post_proposals r where r.post_id=p.id)else 0 end,
   'proposed',exists(select 1 from post_proposals r where r.post_id=p.id and r.company_id=p_company)) as item
  from company_posts p join companies c on c.id=p.company_id
  where p.archived_at is null and(p_before is null or p.created_at<p_before)
   and case p_filter when 'following' then p.company_id=p_company or exists(select 1 from company_follows f where f.follower_id=p_company and f.company_id=p.company_id)
    when 'post' then p.kind='post' when 'job' then p.kind='job' when 'partner' then p.kind='partner' when 'mine' then p.company_id=p_company
    when 'offers' then p.kind in('job','partner') else true end
  order by p.created_at desc limit least(greatest(coalesce(p_limit,20),1),50))q),'[]');end$$;

revoke all on function public.feed_propose(uuid,uuid,text,text),public.feed_proposals(uuid,uuid),public.feed_proposal_status(uuid,uuid,text)from public,anon;
grant execute on function public.feed_propose(uuid,uuid,text,text),public.feed_proposals(uuid,uuid),public.feed_proposal_status(uuid,uuid,text)to authenticated;
