-- PPTX slide 8: ten project lifecycle stages, independently versioned and tenant scoped.
create table public.project_stages (
 company_id uuid not null references companies(id),project_id uuid not null references entities(id),
 key text not null,ordinal int not null,department text not null,label text not null,english text not null,
 status text not null default 'pending' check(status in ('pending','progress','review','done')),
 version int not null default 1,started_at timestamptz,completed_at timestamptz,
 updated_at timestamptz not null default now(),updated_by uuid references auth.users(id),
 primary key(project_id,key)
);
create table public.project_stage_history (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),project_id uuid not null references entities(id),
 key text not null,department text not null,status text not null,actor uuid,created_at timestamptz not null default now()
);
alter table project_stages enable row level security;alter table project_stage_history enable row level security;
create policy stage_read on project_stages for select to authenticated using(can_read_dept(company_id,department) and exists(select 1 from entities e where e.id=project_id and e.company_id=project_stages.company_id and e.archived_at is null));
create policy stage_history_read on project_stage_history for select to authenticated using(can_read_dept(company_id,department) and exists(select 1 from entities e where e.id=project_id and e.company_id=project_stage_history.company_id and e.archived_at is null));
grant select on project_stages,project_stage_history to authenticated;grant all on project_stages,project_stage_history to service_role;
create function public.init_project_stages(p_project uuid) returns void language plpgsql security definer set search_path=public as $$
declare p entities;
begin
 select * into p from entities where id=p_project and kind='projects';if p.id is null then return;end if;
 insert into project_stages(company_id,project_id,key,ordinal,department,label,english)
 select p.company_id,p.id,v.key,v.ordinal,v.department,v.label,v.english from (values
 ('location',0,'Business Development','หา Location','Location'),('contract',1,'Legal','ทำสัญญา','Contract'),
 ('payment',2,'Finance','ชำระเงิน','Payment'),('layout',3,'Design','เขียนแบบ','Layout'),
 ('procurement',4,'Purchasing','จัดซื้อ','Procurement'),('warehouse',5,'Warehouse','คลังสินค้า','Warehouse'),
 ('setup',6,'Operations','เตรียมงาน','Setup'),('selling',7,'Sales','PC ขายของ','Selling'),
 ('summary',8,'Marketing','สรุปผล','Summary'),('close',9,'Operations','ปิดงาน','Close')
 ) v(key,ordinal,department,label,english) on conflict(project_id,key)do nothing;
end$$;
revoke all on function init_project_stages(uuid) from public,anon,authenticated;
create function public.project_stage_init_trigger() returns trigger language plpgsql security definer set search_path=public as $$begin perform init_project_stages(new.id);return new;end$$;
revoke all on function project_stage_init_trigger() from public,anon,authenticated;
create trigger create_project_stages after insert on entities for each row when(new.kind='projects')execute function project_stage_init_trigger();
do $$declare p uuid;begin for p in select id from entities where kind='projects' loop perform init_project_stages(p);end loop;end$$;
create function public.update_project_stage(p_company uuid,p_project uuid,p_key text,p_status text,p_version int)returns project_stages language plpgsql security definer set search_path=public as $$
declare r project_stages;p entities;
begin
 select * into p from entities where id=p_project and company_id=p_company and kind='projects' and archived_at is null for update;
 if p.id is null or not can_read_dept(p_company,p.department) then raise exception 'ไม่พบโครงการ';end if;
 select * into r from project_stages where company_id=p_company and project_id=p_project and key=p_key for update;
 if r.project_id is null or not can_write_dept(p_company,r.department) then raise exception 'ไม่มีสิทธิ์แก้ไขขั้นตอนนี้';end if;
 if p_version is null or r.version<>p_version then raise exception 'ขั้นตอนนี้เปลี่ยนแล้ว กรุณารีเฟรช';end if;
 if p_status not in ('pending','progress','review','done') then raise exception 'สถานะไม่ถูกต้อง';end if;
 if p_status='done' and p_key in ('contract','payment','layout','close') and member_role(p_company)not in ('owner','manager') then raise exception 'ต้องให้ผู้มีสิทธิ์อนุมัติ';end if;
 if p_key='close' and p_status='done' and exists(select 1 from project_stages where project_id=p_project and key<>'close' and status<>'done')then raise exception 'ทำขั้นตอนก่อนหน้าให้เสร็จก่อนปิดโครงการ';end if;
 if p_key='layout' and p_status='done' and exists(select 1 from design_revisions dv where dv.project_id=p_project and dv.category='layout' and dv.version=(select max(version)from design_revisions where project_id=p_project and category='layout')and dv.status<>'approved')then raise exception 'แบบเวอร์ชันล่าสุดยังไม่ได้อนุมัติ';end if;
 update project_stages set status=p_status,version=version+1,started_at=case when p_status in ('progress','review','done')then coalesce(started_at,now())else started_at end,completed_at=case when p_status='done'then now()else null end,updated_at=now(),updated_by=auth.uid()where project_id=p_project and key=p_key returning * into r;
 insert into project_stage_history(company_id,project_id,key,department,status,actor)values(p_company,p_project,p_key,r.department,p_status,auth.uid());
 if p_key='close' and p_status='done' then update entities set data=jsonb_set(data,'{status}','"completed"'),version=version+1,updated_at=now()where id=p_project;end if;
 perform log_action(p_company,'project_stage_'||p_key||'_'||p_status,p_project::text);return r;
end$$;
revoke all on function update_project_stage(uuid,uuid,text,text,int) from public,anon;
grant execute on function update_project_stage(uuid,uuid,text,text,int) to authenticated;
