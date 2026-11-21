-- Job / partner posts: asking and offering (เสนอตัว / สมัคร) open a B2B chat that quotes the post, instead of comments.
-- The first message a company sends about our job / partner post is a "ผู้สนใจติดต่อ" alert (kind interest) with the
-- post title, the message and the conversation to open; later messages stay "ข้อความใหม่".
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
    then jsonb_build_object('kind','interest','id',m.id,'at',m.created_at,'who',mc.name,'title',coalesce(nullif(op.meta->>'title',''),left(op.body,90)),'body',left(m.body,90),'post_id',op.id,'thread_id',t.id)
    else jsonb_build_object('kind','message','id',m.id,'at',m.created_at,'who',mc.name,'title',left(m.body,90),'thread_id',t.id)end,m.created_at
   from b2b_messages m join b2b_threads t on t.id=m.thread_id join companies mc on mc.id=m.company_id
   left join company_posts op on op.id=m.post_id and op.company_id=p_company and op.kind in('job','partner')
   where p_company in(t.company_a,t.company_b)and m.company_id<>p_company and m.created_at>now()-interval '60 days'
  union all
  select jsonb_build_object('kind','network','id',f.follower_id,'at',f.created_at,'who',fc.name,'title','เริ่มติดตามบริษัทของคุณ'),f.created_at
   from company_follows f join companies fc on fc.id=f.follower_id
   where f.company_id=p_company and f.created_at>now()-interval '60 days'
  )x order by at desc limit 60)y),'[]');end$$;
