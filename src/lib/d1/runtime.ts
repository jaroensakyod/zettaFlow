// Where the D1 build gets its database, files and signed-in person: on Cloudflare Workers the bindings DB (D1) and
// BLOBS (R2); in node (next dev) the file .data/d1.sqlite and the folder .data/d1-blobs. The person comes from the
// Better Auth session cookie (src/lib/d1/auth.ts). Used by
// src/lib/supabase/server.ts when DATA_BACKEND=d1 and by the /api/blob route.
import { d1Driver, type Sql } from "./driver";
import { fsBlobStore, r2BlobStore, type BlobStore, type R2Like } from "./blobs";
import { d1Client, type D1User } from "./postgrest";
import { d1Auth, d1AuthAdmin, d1AuthBridge, withAuthAdmin, type CookieJar } from "./auth";
import { rateLimiter } from "./rate-limit";

export const d1Enabled = () => process.env.DATA_BACKEND === "d1";
/** Running inside workerd (Cloudflare Workers / wrangler dev / OpenNext preview). */
export const onWorkers = () => typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

type Bindings = { DB?: Parameters<typeof d1Driver>[0]; BLOBS?: R2Like };
async function bindings(): Promise<Bindings> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  return (await getCloudflareContext({ async: true })).env as unknown as Bindings;
}

let sqlP: Promise<Sql> | null = null;
/** The database of this process (opened once; on node the file is created and migrated on first use). */
export function d1Sql(): Promise<Sql> {
  sqlP ??= (async () => {
    if (onWorkers()) {
      const env = await bindings();
      if (!env.DB) throw new Error("D1 binding DB is missing (wrangler.jsonc d1_databases)");
      return d1Driver(env.DB);
    }
    const { openLocalD1 } = await import("./local");
    return openLocalD1();
  })();
  sqlP.catch(() => (sqlP = null));
  return sqlP;
}
let blobsP: Promise<BlobStore> | null = null;
export function d1Blobs(): Promise<BlobStore> {
  blobsP ??= (async () => {
    if (onWorkers()) {
      const env = await bindings();
      if (!env.BLOBS) throw new Error("R2 binding BLOBS is missing (wrangler.jsonc r2_buckets)");
      return r2BlobStore(env.BLOBS);
    }
    return fsBlobStore(process.env.D1_BLOBS_DIR || ".data/d1-blobs");
  })();
  blobsP.catch(() => (blobsP = null));
  return blobsP;
}

/**
 * Dev stand-in for a signed-in person, only when env D1_DEV_USER (an email) is set and never in production: used when
 * the request has no Better Auth session. Looked up in the users table and created there on first use (name from
 * D1_DEV_USER_NAME, else the part before @).
 */
export async function d1DevUser(sql: Sql): Promise<D1User | null> {
  const email = process.env.D1_DEV_USER?.trim().toLowerCase();
  if (!email) return null;
  if (process.env.NODE_ENV === "production") {
    console.warn("[d1] D1_DEV_USER is ignored in production");
    return null;
  }
  const [found] = await sql.all<D1User>("SELECT id, email, name FROM users WHERE email = ?", [email]);
  if (found) return found;
  const name = process.env.D1_DEV_USER_NAME?.trim() || email.split("@")[0];
  await sql.run("INSERT INTO users (id, email, name, email_verified) VALUES (?, ?, ?, 1) ON CONFLICT (email) DO NOTHING", [crypto.randomUUID(), email, name]);
  const [made] = await sql.all<D1User>("SELECT id, email, name FROM users WHERE email = ?", [email]);
  return made ?? null;
}

export const appOrigin = () => (process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

/** The request's cookies and headers (next/headers in the app). */
export type D1Request = { cookies: CookieJar; headers?: Headers };
/**
 * supabaseServer() on D1: the person of this request (Better Auth session cookie, else the dev stand-in), row rules on.
 * sb.auth.signInWithPassword / signUp / verifyOtp / … run Better Auth and write its cookies to `req.cookies`.
 */
export async function d1ServerClient(origin = appOrigin(), req: D1Request = { cookies: { getAll: () => [], set: () => {} } }) {
  const sql = await d1Sql();
  const bridge = d1AuthBridge({ auth: () => d1Auth(sql), cookies: req.cookies, headers: req.headers, devUser: () => d1DevUser(sql), limiter: rateLimiter(sql) });
  return d1Client({ sql, user: await bridge.currentUser(), service: false, blobs: d1Blobs, origin, authProvider: bridge.provider });
}
/**
 * supabaseAdmin() on D1: service role, synchronous like createClient (the database opens on first query). Its auth also
 * answers admin.inviteUserByEmail and resetPasswordForEmail (Better Auth, src/lib/d1/auth.ts d1AuthAdmin).
 */
export function d1AdminClient(origin = appOrigin()) {
  const client = d1Client({ sql: d1Sql, user: null, service: true, blobs: d1Blobs, origin });
  return withAuthAdmin(client, d1AuthAdmin({ auth: async () => d1Auth(await d1Sql()), limiter: async () => rateLimiter(await d1Sql()) }));
}
