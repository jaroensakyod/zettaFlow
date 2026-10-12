-- Canva page 11: immutable versions, review decisions and comments.
create or replace function public.add_attachment(p_company uuid,p_id uuid,p_entity uuid,p_department text,p_name text,p_mime text,p_size bigint,p_path text) returns void language plpgsql security definer set search_path=public as $$begin
 if not can_write_dept(p_company,p_department) or p_path<>p_company::text||'/'||p_department||'/'||p_id::text then raise exception 'ไม่มีสิทธิ์จัดเก็บเอกสาร';end if;
 if p_entity is not null and not exists(select 1 from entities e where e.id=p_entity and e.company_id=p_company and e.archived_at is null and (e.department=p_department or (e.kind='projects' and p_department='Design' and can_read_dept(p_company,e.department)))) then raise exception 'ข้อมูลอ้างอิงผิด';end if;
 insert into attachments(id,company_id,entity_id,department,name,mime,size,path) values(p_id,p_company,p_entity,p_department,p_name,p_mime,p_size,p_path);
end$$;
create table public.design_revisions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
 project_id uuid not null references entities(id), attachment_id uuid not null references attachments(id),
 category text not null check(category in ('layout','perspective','site')),
 version integer not null, status text not null default 'submitted' check(status in ('submitted','revision','approved')),
 notes text not null default '', created_by uuid not null references auth.users(id), created_name text not null,
 created_at timestamptz not null default now(), reviewed_by uuid references auth.users(id), reviewed_name text,
 reviewed_at timestamptz, review_note text, unique(project_id,category,version)
);
create table public.design_comments (
 id uuid primary key default gen_random_uuid(), revision_id uuid not null references design_revisions(id),
 company_id uuid not null references companies(id), user_id uuid not null references auth.users(id),
 name text not null, body text not null check(length(body) between 1 and 4000), created_at timestamptz not null default now()
);
alter table design_revisions enable row level security;
alter table design_comments enable row level security;
create policy revision_read on design_revisions for select to authenticated using(can_read_dept(company_id,'Design') and exists(select 1 from entities e where e.id=project_id and e.company_id=design_revisions.company_id and e.archived_at is null));
create policy design_comment_read on design_comments for select to authenticated using(exists(select 1 from design_revisions r where r.id=revision_id));
grant select on design_revisions,design_comments to authenticated;
grant all on design_revisions,design_comments to service_role;
create function public.create_design_revision(p_company uuid,p_project uuid,p_attachment uuid,p_category text,p_notes text default '') returns design_revisions language plpgsql security definer set search_path=public as $$
declare p entities; a attachments; r design_revisions; v int; n text;
begin
 if not can_write_dept(p_company,'Design') then raise exception 'ไม่มีสิทธิ์ส่งแบบ';end if;
 select * into p from entities where id=p_project and company_id=p_company and kind='projects' and archived_at is null for update;
 if p.id is null or not can_read_dept(p_company,p.department) then raise exception 'ไม่พบโครงการ';end if;
 select * into a from attachments where id=p_attachment and company_id=p_company and entity_id=p_project;
 if a.id is null or not can_read_dept(p_company,a.department) or a.mime not in ('image/png','image/jpeg','image/webp','application/pdf') then raise exception 'ไฟล์ต้องเป็นภาพหรือ PDF ของโครงการนี้';end if;
 if p_category not in ('layout','perspective','site') or length(coalesce(p_notes,''))>4000 then raise exception 'ข้อมูลเวอร์ชันไม่ถูกต้อง';end if;
 if exists(select 1 from design_revisions where attachment_id=p_attachment and project_id=p_project and category=p_category) then raise exception 'ไฟล์นี้ถูกส่งเป็นเวอร์ชันแล้ว';end if;
 select coalesce(max(version),0)+1 into v from design_revisions where project_id=p_project and category=p_category;
 select name into n from memberships where company_id=p_company and user_id=auth.uid() and not disabled;
 insert into design_revisions(company_id,project_id,attachment_id,category,version,notes,created_by,created_name) values(p_company,p_project,p_attachment,p_category,v,coalesce(p_notes,''),auth.uid(),coalesce(n,'')) returning * into r;
 perform log_action(p_company,'design_version_uploaded',p_project::text);
 return r;
end$$;
create function public.review_design_revision(p_company uuid,p_id uuid,p_status text,p_note text default '') returns design_revisions language plpgsql security definer set search_path=public as $$
declare r design_revisions; p entities; n text;
begin
 if member_role(p_company) not in ('owner','manager') or not can_write_dept(p_company,'Design') then raise exception 'ไม่มีสิทธิ์อนุมัติแบบ';end if;
 select * into r from design_revisions where id=p_id and company_id=p_company for update;
 select * into p from entities where id=r.project_id and company_id=p_company and archived_at is null for update;
 if r.id is null or p.id is null or not can_read_dept(p_company,p.department) then raise exception 'ไม่พบเวอร์ชัน';end if;
 if r.status<>'submitted' then raise exception 'เวอร์ชันนี้ตรวจทานแล้ว';end if;
 if exists(select 1 from design_revisions where project_id=r.project_id and category=r.category and version>r.version) then raise exception 'มีเวอร์ชันใหม่กว่า กรุณาตรวจเวอร์ชันล่าสุด';end if;
 if p_status not in ('approved','revision') or length(coalesce(p_note,''))>4000 or (p_status='revision' and length(trim(coalesce(p_note,'')))=0) then raise exception 'กรอกเหตุผลที่ให้แก้ไข';end if;
 select name into n from memberships where company_id=p_company and user_id=auth.uid() and not disabled;
 update design_revisions set status=p_status,review_note=coalesce(p_note,''),reviewed_by=auth.uid(),reviewed_name=n,reviewed_at=now() where id=p_id returning * into r;
 perform log_action(p_company,'design_'||p_status,r.project_id::text);
 return r;
end$$;
create function public.comment_design_revision(p_company uuid,p_revision uuid,p_body text) returns design_comments language plpgsql security definer set search_path=public as $$
declare r design_revisions; p entities; n text; c design_comments;
begin
 if not can_write_dept(p_company,'Design') then raise exception 'ไม่มีสิทธิ์แสดงความคิดเห็น';end if;
 select * into r from design_revisions where id=p_revision and company_id=p_company;
 select * into p from entities where id=r.project_id and company_id=p_company and archived_at is null;
 if r.id is null or p.id is null or not can_read_dept(p_company,p.department) then raise exception 'ไม่พบเวอร์ชัน';end if;
 if length(trim(coalesce(p_body,''))) not between 1 and 4000 then raise exception 'กรอกความคิดเห็น 1–4000 ตัวอักษร';end if;
 select name into n from memberships where company_id=p_company and user_id=auth.uid() and not disabled;
 insert into design_comments(revision_id,company_id,user_id,name,body) values(p_revision,p_company,auth.uid(),coalesce(n,''),trim(p_body)) returning * into c;
 perform log_action(p_company,'design_comment',r.project_id::text);return c;
end$$;
revoke all on function create_design_revision(uuid,uuid,uuid,text,text),review_design_revision(uuid,uuid,text,text),comment_design_revision(uuid,uuid,text) from public,anon;
grant execute on function create_design_revision(uuid,uuid,uuid,text,text),review_design_revision(uuid,uuid,text,text),comment_design_revision(uuid,uuid,text) to authenticated;
