// The D1 database in node (next dev, scripts, tests): a SQLite file through node:sqlite, with the migrations of
// cloudflare/d1 applied the way `wrangler d1 migrations apply` does (recorded in d1_migrations, each file once).
// Never imported on Workers: there the database is the DB binding.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sqliteDriver, type Sql } from "./driver";

type Db = {
  exec(sql: string): void;
  prepare(sql: string): { all(...v: (string | number | null)[]): unknown[]; run(...v: (string | number | null)[]): { changes: number | bigint } };
  close(): void;
};
/** node:sqlite without a static import, so no bundler (Workers build) tries to resolve it. */
export function openSqlite(file: string): Db {
  const mod = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new (path: string) => Db };
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  return new mod.DatabaseSync(file);
}
export const MIGRATIONS_DIR = "cloudflare/d1";
/** Applies every cloudflare/d1/NNNN_*.sql not applied yet, in order; returns the names applied now. */
export function applyMigrations(db: Db, dir = MIGRATIONS_DIR): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const done = new Set((db.prepare("SELECT name FROM d1_migrations").all() as { name: string }[]).map((r) => r.name));
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(join(dir, f), "utf8"));
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(f);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`D1 migration ${f}: ${(e as Error).message}`);
    }
    applied.push(f);
  }
  return applied;
}
export const LOCAL_FILE = () => process.env.D1_FILE || ".data/d1.sqlite";
/** The local D1 file (created and migrated on first open). */
export function openLocalD1(file = LOCAL_FILE()): Sql {
  const fresh = !existsSync(file);
  const db = openSqlite(file);
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } catch {}
  const applied = applyMigrations(db);
  if (fresh || applied.length) console.info(`[d1] ${file}: applied ${applied.join(", ") || "nothing"}`);
  return sqliteDriver(db);
}
