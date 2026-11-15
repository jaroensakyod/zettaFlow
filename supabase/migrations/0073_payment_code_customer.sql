-- 0073: บันทึกรายรับ page — a payment keeps its document number (RV-20261116-001) and the customer who paid
-- (for money received without an invoice, e.g. a cash sale). Both optional.
update public.entity_schemas set fields=fields
 ||case when fields @> '[{"key":"code"}]'::jsonb then '[]'::jsonb else '[{"key":"code","label":"เลขที่เอกสาร","type":"text","required":false}]'::jsonb end
 ||case when fields @> '[{"key":"customerId"}]'::jsonb then '[]'::jsonb else '[{"key":"customerId","label":"ลูกค้า","type":"relation","required":false,"resource":"customers"}]'::jsonb end
 where kind='payments';
select 'ok 0073' as result,(select count(*)from jsonb_array_elements((select fields from public.entity_schemas where kind='payments'))f where f->>'key'in('code','customerId'))as added;
