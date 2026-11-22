// Supabase Auth people → D1 rows (users + auth_accounts of cloudflare/d1/0004_auth.sql). Used by
// scripts/import-supabase-users.ts (a JSON export) and import-supabase.ts (the Worker import).
export type SupabaseUser = {
  id: string;
  email: string | null;
  encrypted_password?: string | null;
  email_confirmed_at?: string | null;
  raw_user_meta_data?: Record<string, unknown> | string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
};
export type D1UserRow = { id: string; email: string; name: string; email_verified: 0 | 1; created_at: string; updated_at: string; last_sign_in_at: string | null };
export type D1AccountRow = { id: string; account_id: string; provider_id: "credential"; user_id: string; password: string; created_at: string; updated_at: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres timestamps ("2025-01-02 03:04:05.123456+00") → ISO like the rest of D1. */
export function isoTime(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(String(v).replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const meta = (m: SupabaseUser["raw_user_meta_data"]): Record<string, unknown> => {
  if (!m) return {};
  if (typeof m === "string")
    try {
      return JSON.parse(m) as Record<string, unknown>;
    } catch {
      return {};
    }
  return m;
};

/** The rows to insert; people without an email or a uuid id are skipped (reported in `skipped`). */
export function convertSupabaseUsers(input: SupabaseUser[], now = new Date().toISOString()) {
  const users: D1UserRow[] = [],
    accounts: D1AccountRow[] = [],
    skipped: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const u of input) {
    const email = (u.email ?? "").trim().toLowerCase();
    if (!UUID.test(u.id ?? "")) {
      skipped.push({ id: String(u.id), reason: "id is not a uuid" });
      continue;
    }
    if (!email) {
      skipped.push({ id: u.id, reason: "no email" });
      continue;
    }
    if (seen.has(email)) {
      skipped.push({ id: u.id, reason: `duplicate email ${email}` });
      continue;
    }
    seen.add(email);
    const m = meta(u.raw_user_meta_data);
    const name = String(m.name ?? m.full_name ?? "").trim() || email.split("@")[0];
    const created = isoTime(u.created_at) ?? now;
    users.push({ id: u.id.toLowerCase(), email, name, email_verified: u.email_confirmed_at ? 1 : 0, created_at: created, updated_at: created, last_sign_in_at: isoTime(u.last_sign_in_at) });
    const hash = (u.encrypted_password ?? "").trim();
    // The credential account's id is the user id (one password per person), so a re-run finds it.
    if (hash) accounts.push({ id: u.id.toLowerCase(), account_id: u.id.toLowerCase(), provider_id: "credential", user_id: u.id.toLowerCase(), password: hash, created_at: created, updated_at: created });
  }
  return { users, accounts, skipped };
}

const lit = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
/** SQL for `wrangler d1 execute --file`: people already there (same id or email) are left as they are. */
export function supabaseUsersToSql(input: SupabaseUser[], now?: string): string {
  const { users, accounts, skipped } = convertSupabaseUsers(input, now);
  const out = [`-- ${users.length} people, ${accounts.length} passwords from Supabase Auth${skipped.length ? `; skipped: ${skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}` : ""}`];
  for (const u of users)
    out.push(
      `INSERT OR IGNORE INTO "users" ("id", "email", "name", "email_verified", "created_at", "updated_at", "last_sign_in_at") VALUES (${[u.id, u.email, u.name, u.email_verified, u.created_at, u.updated_at, u.last_sign_in_at].map(lit).join(", ")});`,
    );
  for (const a of accounts)
    out.push(
      `INSERT OR IGNORE INTO "auth_accounts" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at") SELECT ${[a.id, a.account_id, a.provider_id, a.user_id, a.password, a.created_at, a.updated_at].map(lit).join(", ")} WHERE EXISTS (SELECT 1 FROM "users" WHERE "id" = ${lit(a.user_id)});`,
    );
  return out.join("\n") + "\n";
}
