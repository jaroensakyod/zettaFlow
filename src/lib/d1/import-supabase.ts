// Copies the live Supabase data into D1 + R2, run inside the production Worker (it already holds the Supabase service
// key and the DB / BLOBS bindings, so no key leaves Cloudflare). Driven step by step from
// scripts/import-supabase.ts through POST /__import (cloudflare/worker.ts), which only answers when the Worker has the
// secret IMPORT_TOKEN. Every step is safe to repeat: rows are upserted by primary key, files are overwritten.
//
// Steps
//  - plan:    table order (parents first) and the foreign keys left empty on the first pass (the attachments ↔ ingestions
//             cycle), which `patch` fills in afterwards.
//  - table:   one page of one table (Supabase REST, ordered by primary key) → INSERT … ON CONFLICT DO UPDATE.
//  - patch:   one page of the deferred foreign keys → UPDATE.
//  - users:   people and their password hashes from the RPC public.migration_auth_users() (service role only, created
//             for the move and dropped after; scripts/import-supabase-users.ts converts them).
//  - files:   every object key of one Storage bucket; `file` copies a list of keys into R2 as "<bucket>/<path>".
//  - verify:  row counts of every table on both sides.
import type { Sql, SqlValue, Stmt } from "./driver";
import type { BlobStore } from "./blobs";
import { buckets } from "./blobs";
import { relations } from "./relations.gen";
import { tables } from "./tables.gen";
import { convertSupabaseUsers, type SupabaseUser } from "./supabase-users";

export type Source = { url: string; key: string; fetch?: typeof fetch };
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const TIMESTAMP = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?([+-]\d\d(:?\d\d)?|Z)$/;

async function call(src: Source, path: string, init: RequestInit = {}) {
  const res = await (src.fetch ?? fetch)(src.url.replace(/\/$/, "") + path, {
    ...init,
    // A legacy service_role JWT also goes as the bearer; a new "sb_secret_" key only in apikey (it is not a JWT).
    headers: { apikey: src.key, ...(src.key.startsWith("eyJ") ? { Authorization: "Bearer " + src.key } : {}), "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
  });
  if (!res.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** Table order with parents first; where a cycle stops that, the table referenced least waits for its foreign keys. */
export function importPlan() {
  const names = Object.keys(relations).filter((t) => tables[t]);
  const order: string[] = [],
    deferred: Record<string, string[]> = {},
    left = new Set(names);
  const deps = (t: string) => relations[t].fks.filter((f) => f.table !== t && left.has(f.table) && !f.cols.some((c) => deferred[t]?.includes(c)));
  while (left.size) {
    let ready = [...left].filter((t) => deps(t).length === 0).sort();
    if (!ready.length) {
      // Stuck: some tables wait on each other. Take a table on such a cycle (one of its parents leads back to it) with
      // the fewest such links, and leave only those links empty for now.
      const reaches = (from: string, to: string, seen = new Set<string>()): boolean =>
        from === to || (!seen.has(from) && (seen.add(from), deps(from).some((f) => reaches(f.table, to, seen))));
      const cyclic = (t: string) => deps(t).filter((f) => reaches(f.table, t));
      const pick = [...left].filter((t) => cyclic(t).length).sort((a, b) => cyclic(a).length - cyclic(b).length || a.localeCompare(b))[0];
      deferred[pick] = [...(deferred[pick] ?? []), ...cyclic(pick).flatMap((f) => f.cols)];
      continue; // with those links set aside, the table loads as soon as its other parents have
    }
    for (const t of ready) {
      order.push(t);
      left.delete(t);
    }
  }
  // Self references are filled in afterwards too (a row may point at one later in the page order).
  for (const t of names) for (const f of relations[t].fks) if (f.table === t) deferred[t] = [...new Set([...(deferred[t] ?? []), ...f.cols])];
  return { order, deferred };
}

/** A Supabase value as D1 stores it (tenant.ts encode): JSON text, 0/1, ISO timestamps. */
export function toD1(table: string, col: string, v: unknown): SqlValue {
  const m = tables[table];
  if (v === undefined || v === null) return null;
  if (m.json.includes(col)) return JSON.stringify(v);
  if (m.bool.includes(col) || typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && TIMESTAMP.test(v)) {
    const d = new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return v as SqlValue;
}

const orderOf = (table: string) => (relations[table].pk.length ? relations[table].pk : tables[table].columns).map((c) => c + ".asc").join(",");

async function page(src: Source, table: string, select: string, offset: number, limit: number) {
  const res = await call(src, `/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(orderOf(table))}&offset=${offset}&limit=${limit}`);
  return (await res.json()) as Record<string, unknown>[];
}

/** One page of one table. Tables without a primary key are emptied before their first page. */
export async function importTable(sql: Sql, src: Source, table: string, offset = 0, limit = 500, deferred: string[] = []) {
  const meta = tables[table],
    pk = relations[table].pk;
  if (!meta) throw new Error("unknown table " + table);
  const rows = await page(src, table, "*", offset, limit);
  const cols = meta.columns.filter((c) => rows.some((r) => c in r));
  const stmts: Stmt[] = [];
  if (!pk.length && offset === 0) stmts.push({ sql: `DELETE FROM ${q(table)}`, params: [] });
  const set = cols.filter((c) => !pk.includes(c));
  const conflict = pk.length ? ` ON CONFLICT (${pk.map(q).join(", ")}) DO ${set.length ? "UPDATE SET " + set.map((c) => `${q(c)} = excluded.${q(c)}`).join(", ") : "NOTHING"}` : "";
  for (const r of rows)
    stmts.push({
      sql: `INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})${conflict}`,
      params: cols.map((c) => (deferred.includes(c) ? null : toD1(table, c, r[c]))),
    });
  for (let i = 0; i < stmts.length; i += 100) await sql.batch(stmts.slice(i, i + 100));
  return { table, offset, rows: rows.length, done: rows.length < limit };
}

/** One page of the foreign keys importTable left empty. */
export async function patchDeferred(sql: Sql, src: Source, table: string, cols: string[], offset = 0, limit = 500) {
  const pk = relations[table].pk;
  const rows = await page(src, table, [...pk, ...cols].join(","), offset, limit);
  const stmts: Stmt[] = rows
    .filter((r) => cols.some((c) => r[c] !== null && r[c] !== undefined))
    .map((r) => ({
      sql: `UPDATE ${q(table)} SET ${cols.map((c) => `${q(c)} = ?`).join(", ")} WHERE ${pk.map((c) => `${q(c)} = ?`).join(" AND ")}`,
      params: [...cols.map((c) => toD1(table, c, r[c])), ...pk.map((c) => toD1(table, c, r[c]))],
    }));
  for (let i = 0; i < stmts.length; i += 100) await sql.batch(stmts.slice(i, i + 100));
  return { table, offset, rows: rows.length, patched: stmts.length, done: rows.length < limit };
}

/** People and passwords (public.migration_auth_users(), service role only). Existing people are updated, not duplicated. */
export async function importUsers(sql: Sql, src: Source) {
  const input = (await (await call(src, "/rest/v1/rpc/migration_auth_users", { method: "POST", body: "{}" })).json()) as SupabaseUser[];
  const { users, accounts, skipped } = convertSupabaseUsers(input);
  const stmts: Stmt[] = [
    ...users.map((u) => ({
      sql: `INSERT INTO "users" ("id", "email", "name", "email_verified", "created_at", "updated_at", "last_sign_in_at") VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT ("id") DO UPDATE SET "email" = excluded."email", "name" = excluded."name", "email_verified" = excluded."email_verified", "last_sign_in_at" = excluded."last_sign_in_at"`,
      params: [u.id, u.email, u.name, u.email_verified, u.created_at, u.updated_at, u.last_sign_in_at] as SqlValue[],
    })),
    ...accounts.map((a) => ({
      sql: `INSERT INTO "auth_accounts" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT ("id") DO UPDATE SET "password" = excluded."password" WHERE "auth_accounts"."password" LIKE '$2%'`,
      params: [a.id, a.account_id, a.provider_id, a.user_id, a.password, a.created_at, a.updated_at] as SqlValue[],
    })),
  ];
  for (let i = 0; i < stmts.length; i += 100) await sql.batch(stmts.slice(i, i + 100));
  return { users: users.length, passwords: accounts.length, skipped };
}

/** Every object key in one Storage bucket (folders walked). */
export async function listFiles(src: Source, bucket: string) {
  const keys: { path: string; size: number }[] = [];
  const walk = async (prefix: string) => {
    for (let offset = 0; ; offset += 1000) {
      const items = (await (await call(src, `/storage/v1/object/list/${bucket}`, { method: "POST", body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }) })).json()) as {
        name: string;
        id: string | null;
        metadata?: { size?: number } | null;
      }[];
      for (const it of items) {
        const path = prefix ? `${prefix}/${it.name}` : it.name;
        if (it.id === null) await walk(path);
        else keys.push({ path, size: it.metadata?.size ?? 0 });
      }
      if (items.length < 1000) break;
    }
  };
  await walk("");
  return keys;
}

/** Copies files into the blob store as "<bucket>/<path>". */
export async function copyFiles(store: BlobStore, src: Source, bucket: string, paths: string[]) {
  let bytes = 0;
  for (const path of paths) {
    const res = await call(src, `/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`);
    const body = new Uint8Array(await res.arrayBuffer());
    await store.put(`${bucket}/${path}`, body, res.headers.get("content-type") || "application/octet-stream");
    bytes += body.length;
  }
  return { bucket, files: paths.length, bytes };
}

/** Rows per table on both sides (Supabase: exact count). */
export async function verifyCounts(sql: Sql, src: Source) {
  const out: { table: string; supabase: number; d1: number }[] = [];
  for (const table of importPlan().order) {
    const res = await call(src, `/rest/v1/${table}?select=*`, { method: "HEAD", headers: { Prefer: "count=exact", Range: "0-0" } });
    const supabase = Number((res.headers.get("content-range") ?? "").split("/")[1] ?? NaN);
    const d1 = Number((await sql.all<{ n: number }>(`SELECT count(*) AS n FROM ${q(table)}`))[0].n);
    out.push({ table, supabase, d1 });
  }
  const users = Number((await sql.all<{ n: number }>(`SELECT count(*) AS n FROM "users"`))[0].n);
  return { tables: out, users, mismatched: out.filter((r) => r.supabase !== r.d1) };
}

export const importBuckets = () => Object.keys(buckets);

type Env = { NEXT_PUBLIC_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; IMPORT_TOKEN?: string };
/** POST /__import {step, …}: only with the Worker secret IMPORT_TOKEN as the bearer token; otherwise 404. */
export async function handleImport(req: Request, env: Env, sql: () => Promise<Sql>, store: () => Promise<BlobStore>): Promise<Response> {
  const token = env.IMPORT_TOKEN;
  if (!token || token.length < 32 || req.method !== "POST" || req.headers.get("authorization") !== "Bearer " + token) return new Response("Not found", { status: 404 });
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: "Supabase URL / service key missing" }, { status: 500 });
  const src: Source = { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
  const b = (await req.json().catch(() => ({}))) as { step?: string; table?: string; offset?: number; limit?: number; cols?: string[]; bucket?: string; paths?: string[] };
  try {
    const plan = importPlan();
    switch (b.step) {
      case "plan":
        return Response.json({ ...plan, buckets: importBuckets() });
      case "check": {
        // What kind of service key the Worker holds (never the key): a JWT, a new "sb_secret_" key, or something else.
        const k = src.key;
        return Response.json({ url: src.url, keyLength: k.length, kind: k.startsWith("eyJ") ? "jwt" : k.startsWith("sb_secret_") ? "sb_secret" : "other" });
      }
      case "table":
        return Response.json(await importTable(await sql(), src, String(b.table), b.offset ?? 0, b.limit ?? 500, plan.deferred[String(b.table)] ?? []));
      case "patch":
        return Response.json(await patchDeferred(await sql(), src, String(b.table), plan.deferred[String(b.table)] ?? [], b.offset ?? 0, b.limit ?? 500));
      case "users":
        return Response.json(await importUsers(await sql(), src));
      case "files":
        return Response.json({ bucket: b.bucket, keys: await listFiles(src, String(b.bucket)) });
      case "file":
        return Response.json(await copyFiles(await store(), src, String(b.bucket), b.paths ?? []));
      case "verify":
        return Response.json(await verifyCounts(await sql(), src));
      default:
        return Response.json({ error: "unknown step" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
