-- People who can sign in (Supabase had auth.users). Better Auth uses this table as its user model (0004_auth.sql adds
-- its columns). ids are uuids like auth.users.id, so memberships.user_id keeps its meaning.
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
