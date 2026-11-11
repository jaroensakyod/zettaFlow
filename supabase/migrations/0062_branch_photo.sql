-- 0062: a photo for each branch (shown as the cover of its card on the company page).
update public.entity_schemas set fields='[{"key":"photo","label":"รูปสาขา","type":"image","required":false}]'::jsonb||fields
 where kind='branches' and not fields @> '[{"key":"photo"}]'::jsonb;
select 'ok 0062' as result,(select fields->0->>'key' from public.entity_schemas where kind='branches')as first_field;
