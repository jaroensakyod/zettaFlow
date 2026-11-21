-- Better Auth on D1 (src/lib/d1/auth.ts). One user table: Better Auth's `user` model is mapped onto `users` (0002), so
-- memberships.user_id, admin.listUsers and the dev user keep reading the same rows. ids stay uuids (Supabase ids are
-- kept when people are imported, scripts/import-supabase-users.ts). Dates are ISO-8601 text like the rest of D1.
ALTER TABLE "users" ADD COLUMN "email_verified" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "image" TEXT;
-- SQLite cannot add a column with a computed default; Better Auth always writes it, older rows copy created_at.
ALTER TABLE "users" ADD COLUMN "updated_at" TEXT;
-- Supabase's auth.users.last_sign_in_at: set by Better Auth's session hook on every sign-in (and by the import).
ALTER TABLE "users" ADD COLUMN "last_sign_in_at" TEXT;
UPDATE "users" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;

-- Signed-in browsers (the cookie holds the token, signed).
CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL UNIQUE,
  "expires_at" TEXT NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id");

-- Ways to sign in: provider 'credential' holds the password hash (Better Auth scrypt, or a Supabase bcrypt "$2…" hash
-- until the person signs in once).
CREATE TABLE IF NOT EXISTS "auth_accounts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "id_token" TEXT,
  "access_token_expires_at" TEXT,
  "refresh_token_expires_at" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "auth_accounts_user_id_idx" ON "auth_accounts" ("user_id");

-- One-time values (password reset tokens: identifier "reset-password:<token>", value = user id).
CREATE TABLE IF NOT EXISTS "auth_verifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "auth_verifications_identifier_idx" ON "auth_verifications" ("identifier");
