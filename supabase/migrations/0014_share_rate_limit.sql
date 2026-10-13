-- Rate limit wrong passwords on shared dashboard links (server/service role only).
create table public.share_attempts(id bigint generated always as identity primary key,token_hash text not null,client_hash text not null,created_at timestamptz not null default now());
create index share_attempts_lookup on share_attempts(token_hash,created_at desc);
create index share_attempts_client on share_attempts(client_hash,created_at desc);
alter table share_attempts enable row level security;
revoke all on share_attempts from anon,authenticated;grant all on share_attempts to service_role;
-- Returns seconds to wait (0 = allowed). Limits: 5 failures per link per client / 15 min, 20 per link overall / 15 min, 30 per client across links / hour.
create or replace function public.share_lockout(p_token text,p_client text)returns int language sql stable security definer set search_path=public as $$
 select case when
  (select count(*)from share_attempts where token_hash=p_token and client_hash=p_client and created_at>now()-interval '15 minutes')>=5
  or(select count(*)from share_attempts where token_hash=p_token and created_at>now()-interval '15 minutes')>=20
  or(select count(*)from share_attempts where client_hash=p_client and created_at>now()-interval '1 hour')>=30
 then 900 else 0 end$$;
create or replace function public.share_failed(p_token text,p_client text)returns void language sql security definer set search_path=public as $$
 delete from share_attempts where created_at<now()-interval '1 day';
 insert into share_attempts(token_hash,client_hash)values(p_token,p_client)$$;
revoke all on function public.share_lockout(text,text),public.share_failed(text,text)from public,anon,authenticated;
grant execute on function public.share_lockout(text,text),public.share_failed(text,text)to service_role;
