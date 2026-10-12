-- Link approved workflow records to a unique project in the same company.
create function public.create_ingestion_workflow(c uuid,u uuid,t jsonb,v jsonb,i uuid)returns void language plpgsql security definer set search_path=public as $$declare p uuid;n text;matches int;s jsonb;budget numeric:=0;start_date text;end_date text;begin
 if jsonb_array_length(t->'steps')=0 then return;end if;
 if exists(select 1 from jsonb_array_elements(t->'fields')f where f->>'key'='start'and f->>'type'='date')then start_date=v->>'start';end if;
 if exists(select 1 from jsonb_array_elements(t->'fields')f where f->>'key'='end'and f->>'type'='date')then end_date=v->>'end';end if;
 if start_date>end_date then raise exception 'ช่วงวันที่โครงการไม่ถูกต้อง';end if;
 if jsonb_typeof(v->'project_id')='string'and nullif(v->>'project_id','')is not null then select id into p from entities where id=(v->>'project_id')::uuid and company_id=c and kind='projects'and archived_at is null;if not found then raise exception 'โครงการอ้างอิงไม่อยู่ในบริษัทนี้';end if;
 elsif jsonb_typeof(v->'project')='string'and length(trim(v->>'project'))>0 then
 n=trim(v->>'project');if length(n)>500 then raise exception 'ชื่อโครงการยาวเกินไป';end if;
 select count(*)into matches from entities where company_id=c and kind='projects'and archived_at is null and lower(data->>'name')=lower(n);if matches>1 then raise exception 'พบชื่อโครงการซ้ำ กรุณาใช้ฟิลด์ project_id เพื่อระบุโครงการ';end if;
 select id into p from entities where company_id=c and kind='projects'and archived_at is null and lower(data->>'name')=lower(n);
 if p is null then
 if jsonb_typeof(v->'rent')='number'then budget=greatest(0,(v->>'rent')::numeric);end if;
 
 insert into entities(company_id,kind,department,data,created_by)values(c,'projects','Operations',jsonb_build_object('name',n,'status','active','priority','normal','budget',budget,'startDate',start_date,'endDate',end_date,'ingestionId',i),u)returning id into p;
 end if;end if;
 if t->>'department'='Business Development'and jsonb_typeof(v->'rent')='number'and jsonb_typeof(v->'location')='string'then
 if (v->>'rent')::numeric<0 then raise exception 'ค่าเช่าต้องไม่ติดลบ';end if;
 insert into entities(company_id,kind,department,data,created_by)values(c,'deals','Business Development',jsonb_build_object('name',coalesce(v->>'project',t->>'name'),'location',v->>'location','rent',v->'rent','projectId',p,'status','approved','startDate',start_date,'endDate',end_date,'ingestionId',i),u);
 end if;
 for s in select value from jsonb_array_elements(t->'steps')loop insert into entities(company_id,kind,department,data,created_by)values(c,'tasks',s->>'department',jsonb_build_object('name',s->>'name','department',s->>'department','notes',coalesce(v->>'project',t->>'name'),'projectId',p,'priority','normal','status','pending','ingestionId',i),u);end loop;
end$$;
revoke execute on function create_ingestion_workflow(uuid,uuid,jsonb,jsonb,uuid)from public,anon,authenticated;
-- GENERATED APPROVAL FUNCTIONS
create or replace function public.decide_ingestion(p_company uuid,p_id uuid,p_status text,p_values jsonb,p_reason text default '')returns void language plpgsql security definer set search_path=public as $$declare i ingestions;f jsonb;v jsonb;s jsonb;begin
 select * into i from ingestions where id=p_id and company_id=p_company for update;if not found or not can_read_dept(p_company,i.department)or member_role(p_company)not in ('owner','manager')then raise exception 'ไม่มีสิทธิ์อนุมัติ';end if;
 if i.status<>'review'or p_status not in ('approved','rejected')then raise exception 'รายการตัดสินแล้วหรือสถานะไม่ถูกต้อง';end if;
 if p_status='approved'then p_values=coalesce((select jsonb_object_agg(field_def->>'key',p_values->(field_def->>'key'))from jsonb_array_elements(i.template->'fields')field_def),'{}'::jsonb);for f in select value from jsonb_array_elements(i.template->'fields')loop v=p_values->(f->>'key');if (f->>'required')::boolean and (v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ: %',f->>'label';end if;if v is not null and v<>'null'::jsonb then if f->>'type'='number'then if jsonb_typeof(v)<>'number'or abs((v#>>'{}')::numeric)>1e12 then raise exception 'ตัวเลขไม่ถูกต้อง';end if;elsif jsonb_typeof(v)<>'string'then raise exception 'ข้อความไม่ถูกต้อง';end if;if f->>'type'='date'and ((v#>>'{}')!~ '^\d{4}-\d{2}-\d{2}$'or to_char((v#>>'{}')::date,'YYYY-MM-DD')<>(v#>>'{}'))then raise exception 'วันที่ไม่ถูกต้อง';end if;end if;end loop;
 perform create_ingestion_workflow(p_company,auth.uid(),i.template,p_values,i.id);
 elsif length(trim(p_reason))=0 then raise exception 'ต้องมีเหตุผล';end if;
 update ingestions set status=p_status,values=case when p_status='approved'then p_values else values end,error=nullif(p_reason,''),missing=case when p_status='approved'then '[]'::jsonb else missing end where id=p_id;
 perform log_action(p_company,'ingestion_'||p_status,p_id::text);end$$;
create or replace function public.line_approve(p_group text,p_user text,p_id uuid)returns void language plpgsql security definer set search_path=public as $$declare g line_groups;u memberships;i ingestions;f jsonb;v jsonb;s jsonb;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select m.* into u from memberships m join line_users l on l.company_id=m.company_id and l.user_id=m.user_id where l.company_id=g.company_id and l.line_user_id=p_user and not m.disabled and m.role in ('owner','manager');
 if not found then raise exception 'LINE นี้ไม่มีสิทธิ์อนุมัติ';end if;
 select * into i from ingestions where id=p_id and company_id=g.company_id and group_id=p_group for update;if not found then raise exception 'ไม่พบรายการ';end if;
 if u.role<>'owner'and not i.department=any(u.departments)then raise exception 'ไม่มีสิทธิ์แผนกนี้';end if;
 if i.status='approved'then return;end if;if i.status<>'review'then raise exception 'รายการนี้อนุมัติไม่ได้';end if;
 for f in select value from jsonb_array_elements(i.template->'fields')loop v=i.values->(f->>'key');if(f->>'required')::boolean and(v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ';end if;end loop;
 perform create_ingestion_workflow(g.company_id,u.user_id,i.template,i.values,i.id);
 update ingestions set status='approved',missing='[]'where id=i.id;insert into audit_events(company_id,actor,action,target)values(g.company_id,u.user_id,'line_approved',i.id::text);end$$;
