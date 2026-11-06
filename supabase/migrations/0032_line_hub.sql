-- LINE hub: the bot's notice for an item remembers its LINE message id, so a member can press Reply on that notice
-- to add missing data or correct it (the item is read again). Nudges no longer show raw item ids.

alter table public.ingestions add column if not exists bot_message_id text;
create index if not exists ingestions_bot_message on public.ingestions(group_id,bot_message_id)where bot_message_id is not null;
-- The LINE page lists each group's messages newest first.
create index if not exists ingestions_group_recent on public.ingestions(company_id,group_id,created_at desc)where group_id is not null;

create or replace function public.queue_nudges()returns int language plpgsql security definer set search_path=public as $$declare n int;begin
 with x as(update ingestions set nudged_at=now()where status='review'and group_id is not null and jsonb_array_length(missing)>0 and created_at<now()-interval '12 hours'and(nudged_at is null)returning *)
 insert into notification_outbox(company_id,target,body)select company_id,group_id,left('⏰ เตือน: '||coalesce(nullif(values->>'name',''),'รายการที่ส่งมา')||' ยังขาด '||(select string_agg(value,', ')from jsonb_array_elements_text(missing))||chr(10)||'กด Reply ที่ข้อความแจ้งบันทึกเดิม แล้วพิมพ์ข้อมูลที่ขาด',4500)from x;
 get diagnostics n=row_count;return n;end$$;
revoke all on function public.queue_nudges()from public,anon,authenticated;grant execute on function public.queue_nudges()to service_role;
