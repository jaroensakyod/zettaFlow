# Switching eliteflow-ai.com from Vercel + Supabase to Cloudflare

Rehearsed 2026-11-22: the copy into `eliteflow-db` matched every table (7 people with their passwords, 80 tables,
44 files). Plan for about 30 minutes at a quiet hour; saving is closed for about 10 of them.

## Before the day

- [ ] Production Worker secrets with real values (the ones copied from Vercel's "sensitive" variables were 11-character
      placeholders): `GEMINI_API_KEY`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` (put by the owner with
      `npx wrangler secret put NAME --name eliteflow`), `CRON_SECRET` (random), `PLATFORM_ADMIN_EMAILS` (owner list).
      Checked with the import endpoint's `check` step (lengths only).
- [ ] Tell the team the time: pages stay open, saving pauses for ~10 minutes, everyone signs in again afterwards.

## On the day (in order)

1. **Close saving on the old site.** Vercel → zettaflow → Environment Variables: `MAINTENANCE_MODE=1` (Production),
   redeploy. Every save through `/api` now answers 503 "ระบบกำลังย้ายไปเซิร์ฟเวอร์ใหม่ …" (src/proxy.ts). LINE
   messages sent during these minutes reach the old site and are not copied.
2. **Final copy.** Empty `eliteflow-db` (drop the tables child-first, re-apply `cloudflare/d1` migrations), set a random
   `IMPORT_TOKEN` on the `eliteflow` Worker, run `scripts/import-supabase.ts`, and check that it ends with
   "every table matches". Delete `IMPORT_TOKEN`.
3. **Production config** (one commit on main): in `wrangler.jsonc` top level add
   `"vars": { "DATA_BACKEND": "d1", "NEXT_PUBLIC_APP_URL": "https://eliteflow-ai.com" }` and
   `"routes": [{ "pattern": "eliteflow-ai.com", "custom_domain": true }, { "pattern": "www.eliteflow-ai.com", "custom_domain": true }]`;
   delete `vercel.json`'s cron. On the Worker, delete the secrets `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL` (a var and a secret cannot share a
   name, and D1 never calls Supabase).
4. **Move the domain.** Cloudflare DNS for eliteflow-ai.com: delete the A records of `eliteflow-ai.com`
   (216.198.79.65, 64.29.17.65) and the `www` record pointing at Vercel. Vercel → zettaflow → Domains: remove
   eliteflow-ai.com and www.
5. **Deploy production.** GitHub → Releases → `v1.0.0` → Publish. The workflow applies migrations and deploys
   `eliteflow` with the two custom domains and the crons (daily + every 5 minutes).
6. **LINE.** LINE Developers → the channel → Messaging API → Webhook URL
   `https://eliteflow-ai.com/api/line/webhook` → Verify.
7. **Check** on https://eliteflow-ai.com: sign in with a real account (old password), dashboard numbers, open a file
   attachment, send a LINE message to a paired group, invite email. Server logs: `npx wrangler tail eliteflow`.

## Afterwards

- Supabase SQL: `drop function public.migration_auth_users();`
- Keep Supabase and the Vercel project (without the domain) for 2 weeks as the fallback, then pause/delete them.

## Going back (only if the new site cannot be fixed quickly)

Delete the Worker's custom domains, re-add eliteflow-ai.com to the Vercel project (Cloudflare DNS records as before),
set `MAINTENANCE_MODE=0` on Vercel and redeploy, point the LINE webhook back. Anything saved on the new site in between
stays only in D1.
