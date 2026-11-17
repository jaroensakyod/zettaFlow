-- 0076: อัปเกรดแพ็กเกจใน LINE. After a member taps a package price on the bot's card, the bot waits for that member's
-- transfer slip ("billing"), remembering the package picked (meta: {plan, cycle, amount}).
alter table public.line_listen add column if not exists meta jsonb;
alter table public.line_listen drop constraint if exists line_listen_mode_check;
alter table public.line_listen add constraint line_listen_mode_check check(mode in('any','files','edit','reject','fix','slip','evidence','billing'));
select 'ok 0076' as result,(select count(*)from information_schema.columns where table_schema='public'and table_name='line_listen'and column_name='meta')as meta_column;
