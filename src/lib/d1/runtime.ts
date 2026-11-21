// Where the D1 build gets its database, files and signed-in person: on Cloudflare Workers the bindings DB (D1) and
// BLOBS (R2); in node (next dev) the file .data/d1.sqlite and the folder .data/d1-blobs. Used by
// src/lib/supabase/server.ts when DATA_BACKEND=d1 and by the /api/blob route.
import { d1Driver, type Sql } from "./driver";
import { fsBlobStore, r2BlobStore, type BlobStore, type R2Like } from "./blobs";
import { d1Client, type D1User } from "./postgrest";

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
 * The signed-in person. Until Better Auth arrives this is the dev session: env D1_DEV_USER (an email) is looked up in
 * the users table and created there on first use (name from D1_DEV_USER_NAME, else the part before @).
 */
export async function d1CurrentUser(sql: Sql): Promise<D1User | null> {
  const email = process.env.D1_DEV_USER?.trim().toLowerCase();
  if (!email) return null;
  const [found] = await sql.all<D1User>("SELECT id, email, name FROM users WHERE email = ?", [email]);
  if (found) return found;
  const name = process.env.D1_DEV_USER_NAME?.trim() || email.split("@")[0];
  await sql.run("INSERT INTO users (id, email, name) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING", [crypto.randomUUID(), email, name]);
  const [made] = await sql.all<D1User>("SELECT id, email, name FROM users WHERE email = ?", [email]);
  return made ?? null;
}

export const appOrigin = () => (process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

/** supabaseServer() on D1: the person of this request, row rules on. */
export async function d1ServerClient(origin = appOrigin()) {
  const sql = await d1Sql();
  return d1Client({ sql, user: await d1CurrentUser(sql), service: false, blobs: d1Blobs, origin });
}
/** supabaseAdmin() on D1: service role, synchronous like createClient (the database opens on first query). */
export function d1AdminClient(origin = appOrigin()) {
  return d1Client({ sql: d1Sql, user: null, service: true, blobs: d1Blobs, origin });
}
