-- People who can sign in (Supabase had auth.users). For now the D1 build signs in the dev user named by D1_DEV_USER;
-- Better Auth will own this table later. ids are uuids like auth.users.id, so memberships.user_id keeps its meaning.
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
