-- 0061: company branches (สาขา). A company lists its branches (head office 00000, branch 00001 …) and records can be
--   tagged with the branch they belong to (optional "สาขา" field), so data can be kept and filtered per branch.
--   Branches live with Admin; every member of the company can read them (to pick one in a form).
insert into public.entity_schemas(kind,department,fields)values('branches','Admin','[{"key":"name","label":"ชื่อสาขา","type":"text","required":true},{"key":"code","label":"รหัสสาขา (00000 = สำนักงานใหญ่)","type":"text","required":false},{"key":"phone","label":"โทรศัพท์","type":"text","required":false},{"key":"manager","label":"ผู้จัดการสาขา","type":"text","required":false},{"key":"address","label":"ที่อยู่สาขา","type":"textarea","required":false},{"key":"status","label":"สถานะ","type":"select","required":true,"options":["เปิดทำการ","ปิดชั่วคราว","ปิดแล้ว"]},{"key":"notes","label":"หมายเหตุ","type":"textarea","required":false}]')
 on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
update public.entity_schemas set fields=fields||'[{"key":"branchId","label":"สาขา","type":"relation","required":false,"resource":"branches"}]'::jsonb
 where kind=any(array['customers','employees','products','purchases','expenses','invoices','payments','quotations','sales_orders','bills'])
   and not fields @> '[{"key":"branchId"}]'::jsonb;
drop policy if exists entity_read_branches on public.entities;
create policy entity_read_branches on public.entities for select to authenticated using(kind='branches'and member_role(company_id)is not null);
select 'ok 0061' as result,(select count(*)from public.entity_schemas where fields @> '[{"key":"branchId"}]'::jsonb)as kinds_with_branch;
