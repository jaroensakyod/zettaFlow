# Deploying EliteFlow

Two sites on Cloudflare Workers, both on D1 (no Vercel / Supabase after the switch):

| | dev | production |
|---|---|---|
| URL | https://dev.eliteflow-ai.com | https://eliteflow-ai.com |
| Worker | `eliteflow-dev` (`--env dev`) | `eliteflow` |
| D1 | `eliteflow-dev-db` (test data) | `eliteflow-db` (real data) |
| R2 | `eliteflow-blobs-dev` | `eliteflow-blobs` |
| Deployed by | every push to `main` | a published GitHub release |

## Flow

1. Push to `main` → GitHub Actions `Deploy to Cloudflare` runs typecheck + tests, applies new D1 migrations to
   `eliteflow-dev-db` and deploys `eliteflow-dev`.
2. Test on https://dev.eliteflow-ai.com.
3. When dev is good: GitHub → Releases → Draft a new release → tag e.g. `v1.4.0` → Publish. The same workflow applies
   the migrations to `eliteflow-db` and deploys `eliteflow`.

A deploy can also be started by hand: Actions → Deploy to Cloudflare → Run workflow → `dev` or `production`.
Rolling back production: Cloudflare dashboard → Workers → eliteflow → Deployments → roll back (D1 migrations are not
rolled back; write a new migration instead).

## One-time setup

- GitHub repository secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" plus D1: Edit) and
  `CLOUDFLARE_ACCOUNT_ID`.
- Worker secrets, per Worker (`npx wrangler secret put NAME` for production, `... --env dev` for dev):
  `BETTER_AUTH_SECRET`, `BLOB_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`, `GEMINI_API_KEY`,
  `GEMINI_MODEL`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `PLATFORM_ADMIN_EMAILS`, `NEXT_PUBLIC_APP_URL`
  (production). Dev has `DATA_BACKEND` and `NEXT_PUBLIC_APP_URL` as plain vars in wrangler.jsonc. Leave the LINE keys
  off dev so it never answers the real LINE channel.
- After the switch, schema changes are D1 migrations in `cloudflare/d1/` (next number), applied by the workflow; until
  then each Supabase migration also needs its D1 port (cloudflare/d1/RUNNING.md).

## Moving the live data (Supabase → production D1 / R2)

The copy runs inside the production Worker (`src/lib/d1/import-supabase.ts`, endpoint `/__import`), which already has
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, so no key leaves Cloudflare. The endpoint answers 404
unless the Worker has the secret `IMPORT_TOKEN`.

1. On Supabase (SQL editor), the function that hands the people and their password hashes to the service role only:

   ```sql
   create or replace function public.migration_auth_users()
   returns table(id uuid, email text, encrypted_password text, email_confirmed_at timestamptz,
                 raw_user_meta_data jsonb, created_at timestamptz, last_sign_in_at timestamptz)
   language sql security definer set search_path = auth, public as $$
     select id, email::text, encrypted_password::text, email_confirmed_at, raw_user_meta_data, created_at, last_sign_in_at
     from auth.users $$;
   revoke all on function public.migration_auth_users() from public, anon, authenticated;
   grant execute on function public.migration_auth_users() to service_role;
   ```

2. Deploy the production Worker with this code (`npm run cf:deploy`), then set a random `IMPORT_TOKEN` on it and run
   `IMPORT_TOKEN=… npx tsx scripts/import-supabase.ts https://eliteflow.<account>.workers.dev`. It copies people,
   every table (parents first; `attachments.ingestion_id` is filled in afterwards), every Storage file into R2, and
   ends with a row count per table on both sides. Re-running is safe (upserts), but rows deleted on Supabase since an
   earlier run stay in D1, so for the final copy start from an empty `eliteflow-db`.
3. Switch: stop writes on the old site (maintenance), run the final copy, set `DATA_BACKEND=d1` on the production
   Worker, attach `eliteflow-ai.com` to it (Workers → eliteflow → Domains), point the LINE webhook to
   `https://eliteflow-ai.com/api/line/webhook`, remove the Vercel project's domain and cron.
4. Clean up: `npx wrangler secret delete IMPORT_TOKEN`, and on Supabase
   `drop function public.migration_auth_users();`.
