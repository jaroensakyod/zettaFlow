-- PPTX pages 17-18: purchase lifecycle and stock transfers between warehouse/projects.
create or replace function public.purchase_action(p_company uuid,p_id uuid,p_action text) returns void language plpgsql security definer set search_path=public as $$
declare r entities;next_status text;
begin
 if not can_write_dept(p_company,'Purchasing')then raise exception 'ไม่มีสิทธิ์จัดซื้อ';end if;
 select * into r from entities where id=p_id and company_id=p_company and kind='purchases' and archived_at is null for update;
 if r.id is null then raise exception 'ไม่พบใบขอซื้อ';end if;
 if p_action='approve'then
  if member_role(p_company)not in ('owner','manager')or r.data->>'status'<>'draft'then raise exception 'ไม่มีสิทธิ์ หรือรายการนี้อนุมัติแล้ว';end if;
  next_status:='approved';
  r.data:=jsonb_set(r.data,'{poNumber}',to_jsonb(coalesce(nullif(r.data->>'poNumber',''),'PO-'||upper(left(replace(r.id::text,'-',''),12)))));
 elsif p_action='receive'then
  if not can_write_dept(p_company,'Warehouse')or r.data->>'status'not in ('approved','pending_vendor','in_progress','pending_delivery','delivered')then raise exception 'ต้องอนุมัติก่อนรับ หรือรับสินค้าไปแล้ว';end if;
  perform post_stock_movement(p_company,(r.data->>'productId')::uuid,'in',(r.data->>'quantity')::bigint,'PO:'||p_id::text,'รับตามใบสั่งซื้อ');next_status:='received';
 elsif p_action='request_vendor'and r.data->>'status'='approved'then next_status:='pending_vendor';
 elsif p_action='vendor_confirm'and r.data->>'status'='pending_vendor'then next_status:='in_progress';
 elsif p_action='dispatch'and r.data->>'status'='in_progress'then next_status:='pending_delivery';
 elsif p_action='deliver'and r.data->>'status'='pending_delivery'then next_status:='delivered';
 elsif p_action='cancel'and r.data->>'status'not in ('received','cancelled')then
  if r.data->>'status'<>'draft'and member_role(p_company)not in ('owner','manager')then raise exception 'ให้หัวหน้างานยกเลิกใบสั่งซื้อที่อนุมัติแล้ว';end if;next_status:='cancelled';
 else raise exception 'ขั้นตอนนี้ไม่สอดคล้องกับสถานะปัจจุบัน';end if;
 update entities set data=jsonb_set(r.data,'{status}',to_jsonb(next_status)),version=version+1,updated_at=now()where id=p_id;
 perform log_action(p_company,'purchase_'||p_action,p_id::text);
end$$;
create table public.project_inventory (
 company_id uuid not null references companies(id),product_id uuid not null references entities(id),project_id uuid not null references entities(id),
 quantity bigint not null default 0 check(quantity>=0),updated_at timestamptz not null default now(),primary key(product_id,project_id)
);
create table public.stock_transfers (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),product_id uuid not null references entities(id),
 from_project uuid references entities(id),to_project uuid references entities(id),quantity bigint not null check(quantity>0),
 reason text not null,reference text not null,created_by uuid references auth.users(id),created_name text not null,
 created_at timestamptz not null default now(),unique(company_id,reference),check(from_project is distinct from to_project)
);
alter table project_inventory enable row level security;alter table stock_transfers enable row level security;
create policy inventory_read on project_inventory for select to authenticated using(can_read_dept(company_id,'Warehouse') and exists(select 1 from entities e where e.id=project_id and e.company_id=project_inventory.company_id and e.archived_at is null));
create policy transfer_read on stock_transfers for select to authenticated using(can_read_dept(company_id,'Warehouse') and (from_project is null or exists(select 1 from entities e where e.id=from_project and e.company_id=stock_transfers.company_id)) and (to_project is null or exists(select 1 from entities e where e.id=to_project and e.company_id=stock_transfers.company_id)));
grant select on project_inventory,stock_transfers to authenticated;grant all on project_inventory,stock_transfers to service_role;
create function public.transfer_project_stock(p_company uuid,p_product uuid,p_from uuid,p_to uuid,p_quantity bigint,p_reference text,p_reason text)returns stock_transfers language plpgsql security definer set search_path=public as $$
declare p entities;project entities;current_qty bigint;name text;r stock_transfers;
begin
 if not can_write_dept(p_company,'Warehouse')then raise exception 'ไม่มีสิทธิ์โอนสินค้า';end if;
 if p_quantity is null or p_quantity<=0 or p_from is not distinct from p_to or length(trim(coalesce(p_reference,'')))not between 1 and 200 or length(trim(coalesce(p_reason,'')))not between 1 and 4000 then raise exception 'ข้อมูลการโอนไม่ถูกต้อง';end if;
 select * into p from entities where id=p_product and company_id=p_company and kind='products'and archived_at is null for update;
 if p.id is null then raise exception 'ไม่พบสินค้า';end if;
 if p_from is not null then select * into project from entities where id=p_from and company_id=p_company and kind='projects' and archived_at is null;if project.id is null or not can_read_dept(p_company,project.department)then raise exception 'ไม่มีสิทธิ์โครงการต้นทาง';end if;end if;
 if p_to is not null then select * into project from entities where id=p_to and company_id=p_company and kind='projects' and archived_at is null;if project.id is null or not can_read_dept(p_company,project.department)then raise exception 'ไม่มีสิทธิ์โครงการปลายทาง';end if;end if;
 if exists(select 1 from stock_transfers where company_id=p_company and reference=p_reference)then raise exception 'รายการโอนนี้บันทึกแล้ว';end if;
 if p_from is null then
  current_qty:=coalesce((p.data->>'stock')::bigint,0);if current_qty<p_quantity then raise exception 'สต็อกคลังกลางไม่เพียงพอ';end if;
  perform post_stock_movement(p_company,p_product,'out',p_quantity,'TRANSFER:'||p_reference||':out',p_reason);
 else
  select quantity into current_qty from project_inventory where product_id=p_product and project_id=p_from for update;
  if coalesce(current_qty,0)<p_quantity then raise exception 'สต็อกโครงการไม่เพียงพอ';end if;
  update project_inventory set quantity=quantity-p_quantity,updated_at=now()where product_id=p_product and project_id=p_from;
 end if;
 if p_to is null then perform post_stock_movement(p_company,p_product,'in',p_quantity,'TRANSFER:'||p_reference||':in',p_reason);
 else insert into project_inventory(company_id,product_id,project_id,quantity)values(p_company,p_product,p_to,p_quantity)on conflict(product_id,project_id)do update set quantity=project_inventory.quantity+excluded.quantity,updated_at=now();end if;
 select m.name into name from memberships m where m.company_id=p_company and m.user_id=auth.uid() and not m.disabled;
 insert into stock_transfers(company_id,product_id,from_project,to_project,quantity,reference,reason,created_by,created_name)values(p_company,p_product,p_from,p_to,p_quantity,p_reference,p_reason,auth.uid(),coalesce(name,''))returning * into r;
 perform log_action(p_company,'stock_transfer',r.id::text);return r;
end$$;
revoke all on function transfer_project_stock(uuid,uuid,uuid,uuid,bigint,text,text)from public,anon;
grant execute on function transfer_project_stock(uuid,uuid,uuid,uuid,bigint,text,text)to authenticated;
