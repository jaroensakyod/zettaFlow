-- Preserve imported Firebase fields separately from the new validated form payload.
alter table public.entities add column legacy_data jsonb;
