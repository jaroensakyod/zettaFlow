-- Hand-written: rate limits of the D1 sign-in (src/lib/d1/rate-limit.ts). Supabase Auth limited these itself; Better
-- Auth's own limiter only guards its HTTP handler, which the app does not mount. One row per counted event:
--   action  'sign_in_failed' | 'sign_up' | 'reset'
--   subject sha-256 (hex) of "email:<address>" or "ip:<address>" (no raw addresses kept)
-- Rows older than a day are deleted as new ones are written.
CREATE TABLE "auth_rate_limits" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "action" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX "auth_rate_limits_lookup" ON "auth_rate_limits" ("action", "subject", "created_at");
CREATE INDEX "auth_rate_limits_created" ON "auth_rate_limits" ("created_at");
