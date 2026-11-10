-- 0056: online status. Each open workspace pings every 30 s; a member counts as online for 2 minutes after a ping.
--   presence_ping records the caller and answers which of the given companies (network logos) and which of the
--   caller's own colleagues are online right now. Only "online or not" leaves the function, never timestamps.
alter table public.memberships add column if not exists last_seen_at timestamptz;
create index if not exists memberships_seen_idx on public.memberships(company_id,last_seen_at);
create or replace function public.presence_ping(p_company uuid,p_companies uuid[] default '{}')returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบ'; end if;
  if not exists(select 1 from memberships where company_id=p_company and user_id=auth.uid() and not disabled) then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  if coalesce(cardinality(p_companies),0)>300 then raise exception 'รายการยาวเกินไป'; end if;
  update memberships set last_seen_at=now()
   where company_id=p_company and user_id=auth.uid() and (last_seen_at is null or last_seen_at<now()-interval '20 seconds');
  return jsonb_build_object(
    'companies',coalesce((select jsonb_agg(distinct m.company_id) from memberships m
      where m.company_id=any(p_companies||p_company) and not m.disabled and m.last_seen_at>now()-interval '2 minutes'),'[]'::jsonb),
    'users',coalesce((select jsonb_agg(m.user_id) from memberships m
      where m.company_id=p_company and not m.disabled and m.last_seen_at>now()-interval '2 minutes'),'[]'::jsonb));
end $$;
revoke all on function public.presence_ping(uuid,uuid[]) from public,anon;
grant execute on function public.presence_ping(uuid,uuid[]) to authenticated;
select 'ok 0056' as result,(select count(*) from public.memberships where last_seen_at is not null) as seen;
