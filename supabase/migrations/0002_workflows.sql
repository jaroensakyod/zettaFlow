create function public.dashboard_summary(p_company uuid)returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 if member_role(p_company)is null then raise exception 'ไม่มีสิทธิ์บริษัท';end if;
 select jsonb_build_object(
 'sales',coalesce(sum((data->>'amount')::numeric)filter(where kind='sales'and data->>'status'='confirmed'),0),
 'expenses',coalesce(sum((data->>'amount')::numeric)filter(where kind='expenses'and data->>'status'in ('approved','paid')),0),
 'projects',count(*)filter(where kind='projects'and data->>'status'in ('planning','active','review')),
 'tasks',count(*)filter(where kind='tasks'and data->>'status'<>'done'),
 'pendingDeals',count(*)filter(where kind='deals'and data->>'status'='pending'),
 'lowStock',coalesce(jsonb_agg(to_jsonb(entities))filter(where kind='products'and(data->>'stock')::numeric<=(data->>'reorderLevel')::numeric),'[]'::jsonb)
 )into result from entities where company_id=p_company and archived_at is null and can_read_dept(p_company,department);return result;end$$;
create function public.approve_deal(p_company uuid,p_id uuid)returns uuid language plpgsql security definer set search_path=public as $$declare r entities;project uuid;d text;begin
 if member_role(p_company)not in ('owner','manager')or not can_write_dept(p_company,'Business Development')then raise exception 'ไม่มีสิทธิ์อนุมัติ';end if;
 select * into r from entities where id=p_id and company_id=p_company and kind='deals'and archived_at is null for update;if not found or r.data->>'status'<>'pending'then raise exception 'ดีลนี้ไม่ได้รออนุมัติ';end if;
 project=nullif(r.data->>'projectId','')::uuid;
 if project is null then insert into entities(company_id,kind,department,data,created_by)values(p_company,'projects','Operations',jsonb_build_object('name',r.data->>'name','status','active','priority','normal','budget',coalesce((r.data->>'rent')::numeric,0),'startDate',r.data->>'startDate','endDate',r.data->>'endDate'),auth.uid())returning id into project;end if;
 foreach d in array array['Design','Purchasing','Warehouse','Marketing','Sales']loop insert into entities(company_id,kind,department,data,created_by)values(p_company,'tasks',d,jsonb_build_object('name',case d when 'Design'then 'เขียนแบบ / Perspective'when 'Purchasing'then 'ขอใบเสนอราคา'when 'Warehouse'then 'เตรียมสินค้า'when 'Marketing'then 'เตรียมสื่อ'else 'วางแผนการขาย'end,'department',d,'projectId',project,'priority','normal','status','pending','dealId',r.id),auth.uid());end loop;
 update entities set data=data||jsonb_build_object('status','approved','projectId',project),version=version+1,updated_at=now()where id=r.id;perform log_action(p_company,'deal_approved',p_id::text);return project;end$$;
create function public.claim_notifications()returns setof notification_outbox language plpgsql security definer set search_path=public as $$declare n notification_outbox;begin
 for n in select * from notification_outbox where(status='queued'or(status='processing'and lease_until<now()))and attempts<5 and next_at<=now()order by created_at for update skip locked limit 5 loop update notification_outbox set status='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes'where id=n.id returning * into n;return next n;end loop;end$$;
create function public.pair_line_group(p_hash text,p_group text)returns void language plpgsql security definer set search_path=public as $$declare p line_pairings;begin
 select * into p from line_pairings where token_hash=p_hash and used_at is null and expires_at>now()and template_id is not null for update;if not found then raise exception 'รหัสหมดอายุหรือไม่ถูกต้อง';end if;
 if exists(select 1 from line_groups where group_id=p_group and company_id<>p.company_id)then raise exception 'กลุ่มนี้เชื่อมบริษัทอื่น';end if;
 insert into line_groups(group_id,company_id,template_id)values(p_group,p.company_id,p.template_id)on conflict(group_id)do update set template_id=excluded.template_id;update line_pairings set used_at=now()where token_hash=p_hash;end$$;
create function public.pair_line_user(p_hash text,p_group text,p_line_user text)returns void language plpgsql security definer set search_path=public as $$declare p line_pairings;begin
 select * into p from line_pairings where token_hash=p_hash and used_at is null and expires_at>now()and user_id is not null for update;if not found or not exists(select 1 from line_groups where group_id=p_group and company_id=p.company_id)then raise exception 'รหัสหรือกลุ่มไม่ถูกต้อง';end if;
 if exists(select 1 from line_users where company_id=p.company_id and line_user_id=p_line_user and user_id<>p.user_id)then raise exception 'LINE นี้เชื่อมบัญชีอื่น';end if;
 insert into line_users(company_id,line_user_id,user_id)values(p.company_id,p_line_user,p.user_id)on conflict do nothing;update line_pairings set used_at=now()where token_hash=p_hash;end$$;
create function public.line_approve(p_group text,p_user text,p_id uuid)returns void language plpgsql security definer set search_path=public as $$declare g line_groups;u memberships;i ingestions;f jsonb;v jsonb;s jsonb;begin
 select * into g from line_groups where group_id=p_group;if not found then raise exception 'กลุ่มไม่ถูกต้อง';end if;
 select m.* into u from memberships m join line_users l on l.company_id=m.company_id and l.user_id=m.user_id where l.company_id=g.company_id and l.line_user_id=p_user and not m.disabled and m.role in ('owner','manager');
 if not found then raise exception 'LINE นี้ไม่มีสิทธิ์อนุมัติ';end if;
 select * into i from ingestions where id=p_id and company_id=g.company_id and group_id=p_group for update;if not found then raise exception 'ไม่พบรายการ';end if;
 if u.role<>'owner'and not i.department=any(u.departments)then raise exception 'ไม่มีสิทธิ์แผนกนี้';end if;
 if i.status='approved'then return;end if;if i.status<>'review'then raise exception 'รายการนี้อนุมัติไม่ได้';end if;
 for f in select value from jsonb_array_elements(i.template->'fields')loop v=i.values->(f->>'key');if(f->>'required')::boolean and(v is null or v='null'::jsonb or v='""'::jsonb)then raise exception 'ข้อมูลไม่ครบ';end if;end loop;
 for s in select value from jsonb_array_elements(i.template->'steps')loop insert into entities(company_id,kind,department,data,created_by)values(g.company_id,'tasks',s->>'department',jsonb_build_object('name',s->>'name','department',s->>'department','notes',coalesce(i.values->>'project',i.template->>'name'),'priority','normal','status','pending','ingestionId',i.id),u.user_id);end loop;
 update ingestions set status='approved',missing='[]'where id=i.id;insert into audit_events(company_id,actor,action,target)values(g.company_id,u.user_id,'line_approved',i.id::text);end$$;
revoke execute on function dashboard_summary(uuid),approve_deal(uuid,uuid),claim_notifications(),pair_line_group(text,text),pair_line_user(text,text,text),line_approve(text,text,uuid)from public,anon;
grant execute on function dashboard_summary(uuid),approve_deal(uuid,uuid)to authenticated;
revoke execute on function claim_notifications(),pair_line_group(text,text),pair_line_user(text,text,text),line_approve(text,text,uuid)from authenticated;
grant execute on function claim_notifications(),pair_line_group(text,text),pair_line_user(text,text,text),line_approve(text,text,uuid)to service_role;
