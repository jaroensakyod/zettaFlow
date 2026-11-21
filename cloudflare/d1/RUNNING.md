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
| `MAIL_PROVIDER` | `resend` to send mail through Resend's HTTP API (fetch, no SDK). Unset: dev log + `.data/mail` (outside production); in production nothing is sent and an error is logged. |
| `MAIL_API_KEY`, `MAIL_FROM` | Required with `MAIL_PROVIDER` (`wrangler secret put MAIL_API_KEY`; `MAIL_FROM` like `EliteFlow <no-reply@eliteflow-ai.com>`, a verified sender). `MAIL_ENDPOINT` overrides the API URL. |
| `MAIL_DIR` | Node only: where the dev mailer saves messages (default `.data/mail`). |
| `D1_DEV_USER` | Optional dev stand-in: the email of the person used when a request has **no** Better Auth session (looked up in `users`, created on first use). Ignored in production. Unset = signed-out requests are signed out. |
| `D1_DEV_USER_NAME` | Display name for a newly created dev user (default: the part of the email before `@`). |
| `BLOB_SECRET` | HMAC key of signed file links (`/api/blob/<bucket>/<path>?exp=&sig=`). Required in production; a fixed dev key is used otherwise. Set it with `wrangler secret put BLOB_SECRET` on Workers. |
| `NEXT_PUBLIC_APP_URL` | Origin for file links made by the service client (the user client uses the request's host). |
| `D1_FILE`, `D1_BLOBS_DIR` | Node only: where the database file and the files live. |

## Workers bindings (wrangler.jsonc)

- `DB` — D1 database `eliteflow-db`, migrations from `cloudflare/d1` (`wrangler d1 migrations apply eliteflow-db`).
- `BLOBS` — R2 bucket `eliteflow-blobs` (create it once with `wrangler r2 bucket create eliteflow-blobs`).

The code tells Workers from node by `navigator.userAgent === "Cloudflare-Workers"` and reads the bindings through
`getCloudflareContext()` of @opennextjs/cloudflare (src/lib/d1/runtime.ts).

## Migrations in cloudflare/d1

| file | made by |
|---|---|
| `0001_schema.sql` | `npx tsx scripts/d1-schema.ts` (from supabase/migrations; do not edit by hand) |
| `0002_users.sql` | hand-written: the `users` table (auth.users had it on Supabase) |
| `0003_seed.sql` | `npx tsx scripts/d1-seed.ts`: the rows the Supabase migrations insert (entity_schemas, plans, limits, modules, add-ons, shop items, coin packs, ad packages) |
| `0004_auth.sql` | hand-written: Better Auth (columns on `users`, `auth_sessions`, `auth_accounts`, `auth_verifications`) |

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
