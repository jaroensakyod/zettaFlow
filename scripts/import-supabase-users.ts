// People from Supabase Auth → D1 (users + auth_accounts of cloudflare/d1/0004_auth.sql). Does not connect to Supabase:
// it converts a JSON export of auth.users, e.g. from the SQL editor
//   select id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, last_sign_in_at
//   from auth.users;
// (saved as a JSON array) into SQL for D1:
//   npx tsx scripts/import-supabase-users.ts users.json [out.sql]      # writes out.sql (default users-import.sql)
//   npx wrangler d1 execute eliteflow-db --remote --file out.sql
//   npx tsx scripts/import-supabase-users.ts users.json --local         # or straight into .data/d1.sqlite
// Everyone keeps their Supabase id (memberships.user_id), their confirmed state and their password: the bcrypt hash
// ("$2a$…") is verified with bcryptjs and replaced by Better Auth's own hash on the first sign-in. People without a
// password (invited, never set one) sign in after "forgot password". Re-running skips people already imported.
import { readFileSync, writeFileSync } from "node:fs";
import { supabaseUsersToSql, type SupabaseUser } from "../src/lib/d1/supabase-users";
export * from "../src/lib/d1/supabase-users";

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("import-supabase-users.ts")) {
  const [file, target] = process.argv.slice(2);
  if (!file) {
    console.error("usage: npx tsx scripts/import-supabase-users.ts users.json [out.sql | --local]");
    process.exit(1);
  }
  const input = JSON.parse(readFileSync(file, "utf8")) as SupabaseUser[];
  const sql = supabaseUsersToSql(input);
  if (target === "--local") {
    const { openSqlite, applyMigrations, LOCAL_FILE } = await import("../src/lib/d1/local");
    const db = openSqlite(LOCAL_FILE());
    applyMigrations(db);
    db.exec(sql);
    db.close();
    console.log(`${sql.split("\n")[0]} → ${LOCAL_FILE()}`);
  } else {
    const out = target || "users-import.sql";
    writeFileSync(out, sql);
    console.log(`${sql.split("\n")[0]} → ${out}`);
  }
}
