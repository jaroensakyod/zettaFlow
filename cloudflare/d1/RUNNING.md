# Running the app on D1

`DATA_BACKEND=d1` switches `supabaseServer()` / `supabaseAdmin()` (src/lib/supabase/server.ts) to a Supabase-shaped
client on Cloudflare D1 (src/lib/d1/postgrest.ts). The ~40 files that call them do not change: `from()` queries,
`rpc()`, `auth.getUser()` and `storage` answer in the shapes supabase-js gave.

## Local (node)

```sh
npm run d1:local                      # (re)create .data/d1.sqlite: every cloudflare/d1/NNNN_*.sql
DATA_BACKEND=d1 D1_DEV_USER=me@example.com npm run dev
```

- The database is the file `.data/d1.sqlite` (override with `D1_FILE`). It is also created and migrated on first use,
  so `d1:local` is only needed to start over. New migration files are applied on the next start (recorded in the
  `d1_migrations` table, like wrangler does).
- Files go to `.data/d1-blobs/<bucket>/<path>` (override with `D1_BLOBS_DIR`); `d1:local` keeps them.
- Leave `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` unset so `src/proxy.ts` (which talks to
  Supabase Auth directly) does nothing.

## Environment

| variable | meaning |
|---|---|
| `DATA_BACKEND` | `d1` to use D1; anything else (or unset) keeps Supabase. |
| `D1_DEV_USER` | Email of the signed-in person until Better Auth lands. Looked up in `users`, created on first use. Unset = nobody signed in (`auth.getUser()` answers "Auth session missing!"). |
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
- **Auth**: `getUser`, `getClaims`, `getSession`, `signOut` and `admin.listUsers`. Sign-in, sign-up, password reset
  and email verification answer an error until Better Auth replaces the dev user.
