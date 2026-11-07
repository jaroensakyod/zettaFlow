-- LINE groups may send Word (.docx) files and voice messages too (Excel / CSV / text were already allowed).
update storage.buckets
set allowed_mime_types = array[
  'image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mp4','audio/mp3'
]
where id = 'eliteflow-files';

-- Voice clips are kept only for a while: the transcript stays on the item, the audio file is removed.
-- Returns the storage paths so the caller (daily cron, service role) deletes the files themselves.
create or replace function public.purge_voice_files(p_days int default 90)returns setof text language plpgsql security definer set search_path=public as $$begin
 if p_days < 7 then raise exception 'เก็บไฟล์เสียงอย่างน้อย 7 วัน';end if;
 return query
  with old as(select id,path from attachments where mime like 'audio/%' and created_at<now()-make_interval(days=>p_days)),
   cleared as(update ingestions set attachment_id=null where attachment_id in(select id from old)returning 1),
   gone as(delete from attachments where id in(select id from old)returning 1)
  select path from old;end$$;
revoke all on function public.purge_voice_files(int)from public,anon,authenticated;
grant execute on function public.purge_voice_files(int)to service_role;
