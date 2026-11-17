-- 0075: products keep more than one photo. "image" stays the cover; "gallery" holds the other photos'
-- attachment ids, comma separated (hidden from generic forms).
update public.entity_schemas set fields=fields
 ||case when fields @> '[{"key":"gallery"}]'::jsonb then '[]'::jsonb else '[{"key":"gallery","label":"รูปเพิ่มเติม","type":"text","required":false,"hidden":true}]'::jsonb end
 where kind='products';
select 'ok 0075' as result,(select count(*)from jsonb_array_elements((select fields from public.entity_schemas where kind='products'))f where f->>'key'='gallery')as added;
