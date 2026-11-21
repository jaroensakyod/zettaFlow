// File storage for the D1 build (what Supabase Storage was): one store of blobs keyed "<bucket>/<path>". In node it is
// a folder (.data/d1-blobs), on Workers the R2 binding BLOBS. Signed links point at /api/blob/<bucket>/<path> and carry
// an expiry and an HMAC (env BLOB_SECRET) over what they allow, checked by that route.
import { mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

export type BlobInfo = { key: string; size: number; contentType: string; uploaded: string };
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; info: BlobInfo } | null>;
  head(key: string): Promise<BlobInfo | null>;
  delete(keys: string[]): Promise<void>;
  /** Every blob whose key starts with `prefix`. */
  list(prefix: string): Promise<BlobInfo[]>;
}

/** Buckets and their rules (storage.buckets in the Supabase schema). */
export const buckets: Record<string, { public: boolean; limit: number; mimes: string[] | null }> = {
  "eliteflow-files": {
    public: false,
    limit: 15000000,
    mimes: ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "audio/mp4", "audio/mp3"],
  },
  "eliteflow-posts": { public: false, limit: 1600000, mimes: ["image/png", "image/jpeg", "image/webp"] },
  "eliteflow-promo": { public: true, limit: 50000000, mimes: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"] },
  "eliteflow-avatars": { public: false, limit: 1000000, mimes: ["image/webp"] },
  "eliteflow-b2b": {
    public: false,
    limit: 10000000,
    mimes: ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"],
  },
};

/** A path inside a bucket: no empty, "." or ".." segments, no backslashes (keys never leave the store's folder). */
export function safePath(path: string): boolean {
  if (!path || path.length > 1024 || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

// ---------- node: a folder ----------
export function fsBlobStore(root: string): BlobStore {
  const file = (key: string) => join(root, ...key.split("/"));
  const metaFile = (key: string) => join(root, ".meta", ...key.split("/")) + ".json";
  const info = async (key: string): Promise<BlobInfo | null> => {
    try {
      const s = await stat(file(key));
      if (!s.isFile()) return null;
      let contentType = "application/octet-stream";
      try {
        contentType = JSON.parse(await readFile(metaFile(key), "utf8")).contentType || contentType;
      } catch {}
      return { key, size: s.size, contentType, uploaded: s.mtime.toISOString() };
    } catch {
      return null;
    }
  };
  return {
    async put(key, bytes, contentType) {
      await mkdir(dirname(file(key)), { recursive: true });
      await mkdir(dirname(metaFile(key)), { recursive: true });
      await writeFile(file(key), bytes);
      await writeFile(metaFile(key), JSON.stringify({ contentType }));
    },
    async get(key) {
      const i = await info(key);
      return i ? { bytes: new Uint8Array(await readFile(file(key))), info: i } : null;
    },
    head: info,
    async delete(keys) {
      for (const k of keys) await Promise.all([rm(file(k), { force: true }), rm(metaFile(k), { force: true })]);
    },
    async list(prefix) {
      const out: BlobInfo[] = [];
      const walk = async (dir: string) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const p = join(dir, e.name);
          if (e.isDirectory()) {
            if (dir === root && e.name === ".meta") continue;
            await walk(p);
          } else {
            const key = relative(root, p).split(sep).join("/");
            if (key.startsWith(prefix)) {
              const i = await info(key);
              if (i) out.push(i);
            }
          }
        }
      };
      // Only walk the folder of the prefix (its part up to the last "/").
      const base = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
      await walk(base ? join(root, ...base.split("/")) : root);
      return out.sort((a, b) => a.key.localeCompare(b.key));
    },
  };
}

// ---------- Workers: R2 ----------
/** The part of an R2 bucket binding used here. */
export type R2Like = {
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number; uploaded: Date; httpMetadata?: { contentType?: string } } | null>;
  head(key: string): Promise<{ size: number; uploaded: Date; httpMetadata?: { contentType?: string } } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(opts: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; size: number; uploaded: Date; httpMetadata?: { contentType?: string } }[]; truncated: boolean; cursor?: string }>;
};
export function r2BlobStore(r2: R2Like): BlobStore {
  const toInfo = (key: string, o: { size: number; uploaded: Date; httpMetadata?: { contentType?: string } }): BlobInfo => ({
    key,
    size: o.size,
    contentType: o.httpMetadata?.contentType || "application/octet-stream",
    uploaded: o.uploaded.toISOString(),
  });
  return {
    put: async (key, bytes, contentType) => void (await r2.put(key, bytes, { httpMetadata: { contentType } })),
    async get(key) {
      const o = await r2.get(key);
      return o ? { bytes: new Uint8Array(await o.arrayBuffer()), info: toInfo(key, o) } : null;
    },
    async head(key) {
      const o = await r2.head(key);
      return o ? toInfo(key, o) : null;
    },
    delete: async (keys) => (keys.length ? r2.delete(keys) : undefined),
    async list(prefix) {
      const out: BlobInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await r2.list({ prefix, cursor, limit: 1000 });
        out.push(...page.objects.map((o) => toInfo(o.key, o)));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}

// ---------- signed links ----------
export type BlobOp = "get" | "put";
export function blobSecret(): string {
  const s = process.env.BLOB_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("ตั้งค่า BLOB_SECRET ก่อนใช้ไฟล์บน D1");
  return "d1-dev-blob-secret";
}
const enc = new TextEncoder();
async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const signed = (op: BlobOp, bucket: string, path: string, exp: number, extra: string) => [op, bucket, path, exp, extra].join("\n");
/** The URL path + query of a signed link (append it to the site origin). `extra` is the download name or the upsert flag. */
export async function signBlobUrl(secret: string, op: BlobOp, bucket: string, path: string, expiresIn: number, extra = ""): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresIn));
  const q = new URLSearchParams({ exp: String(exp), sig: await hmac(secret, signed(op, bucket, path, exp, extra)) });
  if (op === "put") q.set("op", "put");
  if (extra) q.set(op === "put" ? "upsert" : "download", extra);
  return `/api/blob/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}?${q}`;
}
/** Checks a signed link's query for this bucket/path: the op it allows and the extra it carries, or null. */
export async function verifyBlobUrl(secret: string, op: BlobOp, bucket: string, path: string, query: URLSearchParams): Promise<{ extra: string } | null> {
  const exp = Number(query.get("exp")),
    sig = query.get("sig") || "",
    extra = query.get(op === "put" ? "upsert" : "download") || "";
  if (!Number.isFinite(exp) || exp < Date.now() / 1000 || !sig) return null;
  const want = await hmac(secret, signed(op, bucket, path, exp, extra));
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { extra } : null;
}
