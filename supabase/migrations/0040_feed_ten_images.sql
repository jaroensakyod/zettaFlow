-- A feed post may carry up to 10 photos (was 4). File names stay one digit: 0–9.
alter table public.company_posts drop constraint if exists company_posts_images_check;
alter table public.company_posts add constraint company_posts_images_check check(cardinality(images)<=10);

create or replace function public.feed_post(p_company uuid,p_id uuid,p_kind text,p_body text,p_meta jsonb,p_images text[])returns company_posts language plpgsql security definer set search_path=public as $$declare p company_posts;i text;begin
 if member_role(p_company)is null or member_role(p_company)='viewer' then raise exception 'ไม่มีสิทธิ์โพสต์ในนามบริษัทนี้';end if;
 if p_kind not in('post','job','partner')then raise exception 'ประเภทโพสต์ไม่ถูกต้อง';end if;
 if length(trim(coalesce(p_body,'')))not between 1 and 5000 then raise exception 'เขียนข้อความโพสต์ 1–5000 ตัวอักษร';end if;
 if p_kind<>'post' and length(trim(coalesce(p_meta->>'title','')))not between 1 and 120 then raise exception 'ใส่หัวข้อประกาศ';end if;
 if jsonb_typeof(coalesce(p_meta,'{}'))<>'object' or length(coalesce(p_meta,'{}')::text)>1000 then raise exception 'ข้อมูลประกาศไม่ถูกต้อง';end if;
 if cardinality(coalesce(p_images,'{}'))>10 then raise exception 'แนบรูปได้สูงสุด 10 รูป';end if;
 foreach i in array coalesce(p_images,'{}')loop
  if i !~ ('^'||p_company::text||'/'||p_id::text||'/[0-9]\.(webp|png|jpg)$')then raise exception 'รูปภาพไม่ถูกต้อง';end if;
 end loop;
 insert into company_posts(id,company_id,author_id,author_name,kind,body,meta,images)values(p_id,p_company,auth.uid(),feed_author(p_company),p_kind,trim(p_body),coalesce(p_meta,'{}'),coalesce(p_images,'{}'))returning * into p;
 return p;end$$;
