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
