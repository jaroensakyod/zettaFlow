# Running the app on D1

`DATA_BACKEND=d1` switches `supabaseServer()` / `supabaseAdmin()` (src/lib/supabase/server.ts) to a Supabase-shaped
client on Cloudflare D1 (src/lib/d1/postgrest.ts). The ~40 files that call them do not change: `from()` queries,
`rpc()`, `auth.getUser()` and `storage` answer in the shapes supabase-js gave.

## Local (node)

```sh
npm run d1:local                      # (re)create .data/d1.sqlite: every cloudflare/d1/NNNN_*.sql
DATA_BACKEND=d1 npm run dev           # sign up on the site; the confirmation link is printed and saved (below)
```

- The database is the file `.data/d1.sqlite` (override with `D1_FILE`). It is also created and migrated on first use,
  so `d1:local` is only needed to start over. New migration files are applied on the next start (recorded in the
  `d1_migrations` table, like wrangler does).
- Files go to `.data/d1-blobs/<bucket>/<path>` (override with `D1_BLOBS_DIR`); `d1:local` keeps them.
- With no mail provider set, every email (sign-up confirmation, password reset) is printed to the server console with
  its link and the last one per address is saved to `.data/mail/<email>.json` (override with `MAIL_DIR`).
- `src/proxy.ts` never calls Supabase when `DATA_BACKEND=d1` (it only sets `Cache-Control`).

## Environment

| variable | meaning |
|---|---|
| `DATA_BACKEND` | `d1` to use D1; anything else (or unset) keeps Supabase. |
| `BETTER_AUTH_SECRET` | Signs session cookies and confirmation links (32+ random chars). Required in production (`wrangler secret put BETTER_AUTH_SECRET`); a fixed dev key is used otherwise. Changing it signs everyone out and voids open links. |
| `BETTER_AUTH_URL` | The site the email links open (`<url>/auth/confirm?token_hash=…&type=signup\|recovery`). Default `NEXT_PUBLIC_APP_URL`. `https://` turns on `Secure` (`__Secure-`) cookies. |
| `RESEND_API_KEY`, `MAIL_FROM` | **The** mail configuration, shared with the app's own emails (src/lib/mailer.ts, invitations): Resend's HTTP API (fetch, no SDK). Sign-up confirmations, reset links and D1 invitations (src/lib/d1/mailer.ts) use it when both are set. `MAIL_FROM` like `EliteFlow <noreply@eliteflow-ai.com>` on a domain verified in Resend. `MAIL_ENDPOINT` overrides the API URL. Neither set: dev log + `.data/mail` (outside production); in production nothing is sent and an error is logged. |
| `MAIL_PROVIDER`, `MAIL_API_KEY` | Older fallback, used only when `RESEND_API_KEY` is not set: `MAIL_PROVIDER=resend` + `MAIL_API_KEY` + `MAIL_FROM`. |
| `CRON_SECRET` | Bearer token `/api/cron` requires (Vercel Cron sent it; on Workers the Cron Triggers send it, see below). Unset = every cron run answers 401 and shows as failed. |
| `MAIL_DIR` | Node only: where the dev mailer saves messages (default `.data/mail`). |
| `D1_DEV_USER` | Optional dev stand-in: the email of the person used when a request has **no** Better Auth session (looked up in `users`, created on first use). Ignored in production. Unset = signed-out requests are signed out. |
| `D1_DEV_USER_NAME` | Display name for a newly created dev user (default: the part of the email before `@`). |
| `BLOB_SECRET` | HMAC key of signed file links (`/api/blob/<bucket>/<path>?exp=&sig=`). Required in production; a fixed dev key is used otherwise. Set it with `wrangler secret put BLOB_SECRET` on Workers. |
| `NEXT_PUBLIC_APP_URL` | Origin for file links made by the service client (the user client uses the request's host). |
| `D1_FILE`, `D1_BLOBS_DIR` | Node only: where the database file and the files live. |

## Workers bindings and entry (wrangler.jsonc)

- `main` is `cloudflare/worker.ts`, OpenNext's documented custom-worker set-up: it re-exports the generated
  `.open-next/worker.js` `fetch` and adds `scheduled`. `npm run cf:build` must run before `wrangler deploy` / `wrangler dev`.

- `DB` — D1 database `eliteflow-db`, migrations from `cloudflare/d1` (`wrangler d1 migrations apply eliteflow-db`).
- `BLOBS` — R2 bucket `eliteflow-blobs` (create it once with `wrangler r2 bucket create eliteflow-blobs`).

The code tells Workers from node by `navigator.userAgent === "Cloudflare-Workers"` and reads the bindings through
`getCloudflareContext()` of @opennextjs/cloudflare (src/lib/d1/runtime.ts).

## Scheduled and background work on Workers

- **Cron Triggers** (`triggers.crons`, UTC), handled by `cloudflare/worker.ts` → `src/lib/cf-scheduled.ts`, which calls
  the app's own `/api/cron` inside the same Worker with `Authorization: Bearer $CRON_SECRET` (the route's check is
  unchanged):
  - `0 0 * * *` — the daily run vercel.json had: `queue_nudges`, `expire_subscriptions`, `purge_voice_files` (the audio
    files are removed through `storage.remove` → the blob store, R2 on Workers), AI jobs, LINE outbox, health note.
  - `*/5 * * * *` — `/api/cron?task=jobs`: AI jobs and LINE notifications only.
  A non-2xx answer throws, so the run shows as failed in the dashboard. Locally: `npx wrangler dev --test-scheduled`, then
  `curl "http://127.0.0.1:8787/__scheduled?cron=*/5+*+*+*+*"`.
- **`after()`** (route.ts AI processing / notifications, LINE webhook) works unchanged: OpenNext's cloudflare-node wrapper
  passes `ctx.waitUntil` and patches Next's `getInternalWaitUntil` to it. Workers keep `waitUntil` work alive for
  about 30 s after the response (Vercel gave up to 300 s). A job cut off there stays `processing` with an expired lease;
  `claim_ingestion` takes it again on the next 5-minute cron run (or the next webhook / ingestions page load). That is why
  no Cloudflare Queue is used: the lease + 5-minute drain gives the same "finishes eventually" guarantee without another
  binding. Add a Queue only if items regularly need several retries.

## Sign-in rate limits

Better Auth's own limiter only guards its HTTP handler (not mounted), so `src/lib/d1/rate-limit.ts` limits the calls
the app makes, counted in `auth_rate_limits` (0005) per email and per IP (`cf-connecting-ip`, else the first
`x-forwarded-for`, else `x-real-ip`; both stored as sha-256 only, rows dropped after a day):

| call | window | per email | per IP |
|---|---|---|---|
| `signInWithPassword` (failures; a good sign-in clears the email's) | 15 min | 5 | 20 |
| `signUp` (every attempt) | 1 h | 3 | 10 |
| `resetPasswordForEmail` (every attempt; the service client's is per email only) | 1 h | 3 | 10 |

Over the limit the call answers Supabase's `Too many requests, try again later` (429, `over_request_rate_limit`) without
checking the password or sending mail; route.ts still records the failed sign-in (`recordLoginFailure`).

## Invitations on D1

`supabaseAdmin().auth.admin.inviteUserByEmail(email, { data: { name } })` creates the user without a password and sends
the Thai "invite-user" email linking to `/auth/confirm?token_hash=…&type=invite` (24 h, works once). Opening it confirms
the address and signs the person in; route.ts sends them to `/reset-password?invite=1` to choose a password. An address
that already has an account answers `A user with this email address has already been registered` (422), and route.ts
falls back to the join email (RESEND_API_KEY) or `supabaseAdmin().auth.resetPasswordForEmail` (a recovery link).
`serviceConfigured()` (src/lib/supabase/server.ts) is true on D1, so route.ts no longer needs `SUPABASE_SERVICE_ROLE_KEY`
for invitations, login links and AI-job processing.

## Before go-live on Workers

```sh
wrangler r2 bucket create eliteflow-blobs
wrangler d1 migrations apply eliteflow-db --remote          # includes 0005_rate_limits.sql
wrangler secret put BETTER_AUTH_SECRET    # 32+ random chars
wrangler secret put BLOB_SECRET
wrangler secret put CRON_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
# plus the AI provider keys the app already uses on Vercel
```

Plain vars (dashboard or `vars` in wrangler.jsonc): `DATA_BACKEND=d1`, `NEXT_PUBLIC_APP_URL` (and `BETTER_AUTH_URL` if
different), `MAIL_FROM`. Then point the LINE webhook URL to `<site>/api/line/webhook`, and remove the Vercel cron once
traffic has moved (both would otherwise run the daily job).

## Migrations in cloudflare/d1

| file | made by |
|---|---|
| `0001_schema.sql` | `npx tsx scripts/d1-schema.ts` (from supabase/migrations; do not edit by hand) |
| `0002_users.sql` | hand-written: the `users` table (auth.users had it on Supabase) |
| `0003_seed.sql` | `npx tsx scripts/d1-seed.ts`: the rows the Supabase migrations insert (entity_schemas, plans, limits, modules, add-ons, shop items, coin packs, ad packages) |
| `0004_auth.sql` | hand-written: Better Auth (columns on `users`, `auth_sessions`, `auth_accounts`, `auth_verifications`) |
| `0005_rate_limits.sql` | hand-written: `auth_rate_limits` (sign-in / sign-up / reset limits, src/lib/d1/rate-limit.ts) |

After regenerating `0001_schema.sql`, also run `npx tsx scripts/d1-relations.ts` (primary / foreign keys for embeds
and upserts → `src/lib/d1/relations.gen.ts`) and `npx tsx scripts/d1-seed.ts`.

## What the client does

- **Reads** by the user client follow the Postgres read policies (src/lib/d1/access.ts) over every company the person
  belongs to (or has an open support session on); a `company_id` = / `in` filter narrows that to those companies'
  memberships. Tables without a read policy answer `permission denied for table …` (42501).
- **Writes** by the user client are refused like Postgres refused them (no table had an insert/update/delete policy;
  six tables kept the default grant and answer the RLS error / change nothing). Writes go through `rpc()`.
- **Service client** (`supabaseAdmin()`) reads and writes every table without rules.
- **rpc(name, args)** runs `rpcs[name]` from src/lib/d1/rpc-map.ts; unknown names answer PGRST202, errors keep the
  exact Postgres message.
- **Storage** mirrors the storage.objects policies per bucket (files by department, posts by role, avatars by owner,
  b2b by thread membership; promo is public).
- **Auth**: real accounts with Better Auth (src/lib/d1/auth.ts), see below.

## Accounts (Better Auth)

Better Auth runs inside the D1 client: the app's own endpoints (`POST /api/auth` login / register / reset / verify /
password / logout, `/auth/callback?code=`, `/auth/confirm`) keep calling `sb.auth.*`, and those call Better Auth's
server API (`auth.api.*`) with the request's cookies; its `Set-Cookie` is written through `cookies()` of next/headers.
Its HTTP handler is **not** mounted (no `/api/auth/*` routes of its own; `/api/auth` stays the app's).

- One user table: Better Auth's `user` is `users` (uuid ids; `email_verified`, `image`, `updated_at`,
  `last_sign_in_at` added by 0004). Sessions, passwords and reset tokens live in `auth_sessions`, `auth_accounts`,
  `auth_verifications`.
- Sign-up sends a confirmation (the Thai template of scripts/email-templates.ts) linking to
  `/auth/confirm?token_hash=<token>&type=signup`; sign-in answers `Email not confirmed` until it is opened (signing in
  again sends a new one). Opening it signs the person in. Links work once; confirmation links last 24 h, reset links 1 h.
- Reset: `/auth/confirm?token_hash=<token>&type=recovery` signs the person in (and confirms the address), then
  `/reset-password` sets the new password with `updateUser({ password })`.
- Sessions: cookie `ef.session_token` (HTTP-only, SameSite=Lax, Secure on https), 30 days, extended daily on use.
- Passwords: new ones with Better Auth's scrypt; Supabase bcrypt hashes (`$2…`) are checked with bcryptjs and
  replaced on the first good sign-in.

### Moving people from Supabase

```sh
# Supabase SQL editor, saved as users.json (a JSON array):
#   select id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, last_sign_in_at from auth.users;
npx tsx scripts/import-supabase-users.ts users.json users-import.sql
npx wrangler d1 execute eliteflow-db --remote --file users-import.sql   # or: … users.json --local (into .data/d1.sqlite)
```

Ids, confirmed state, names, `last_sign_in_at` and passwords are kept; re-running skips people already there.
