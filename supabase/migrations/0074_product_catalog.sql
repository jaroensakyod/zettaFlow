-- 0074: one catalog for คลังสินค้า and ฝ่ายขาย — a product can be a สินค้า, บริการ or แพ็กเกจ, with a picture,
-- a description, what a package includes, and a promotion (price, name, end date). All optional; existing rows
-- read as สินค้า.
update public.entity_schemas set fields=fields
 ||case when fields @> '[{"key":"type"}]'::jsonb then '[]'::jsonb else '[{"key":"type","label":"ประเภท","type":"select","required":false,"options":["product","service","package"]}]'::jsonb end
 ||case when fields @> '[{"key":"image"}]'::jsonb then '[]'::jsonb else '[{"key":"image","label":"รูปสินค้า","type":"image","required":false}]'::jsonb end
 ||case when fields @> '[{"key":"description"}]'::jsonb then '[]'::jsonb else '[{"key":"description","label":"รายละเอียด","type":"textarea","required":false}]'::jsonb end
 ||case when fields @> '[{"key":"includes"}]'::jsonb then '[]'::jsonb else '[{"key":"includes","label":"สิ่งที่รวมในแพ็กเกจ","type":"textarea","required":false}]'::jsonb end
 ||case when fields @> '[{"key":"promoPrice"}]'::jsonb then '[]'::jsonb else '[{"key":"promoPrice","label":"ราคาโปรโมชัน","type":"number","required":false,"min":0}]'::jsonb end
 ||case when fields @> '[{"key":"promoLabel"}]'::jsonb then '[]'::jsonb else '[{"key":"promoLabel","label":"ชื่อโปรโมชัน","type":"text","required":false}]'::jsonb end
 ||case when fields @> '[{"key":"promoEnds"}]'::jsonb then '[]'::jsonb else '[{"key":"promoEnds","label":"โปรโมชันถึงวันที่","type":"date","required":false}]'::jsonb end
 where kind='products';
select 'ok 0074' as result,(select count(*)from jsonb_array_elements((select fields from public.entity_schemas where kind='products'))f where f->>'key'in('type','image','description','includes','promoPrice','promoLabel','promoEnds'))as added;
