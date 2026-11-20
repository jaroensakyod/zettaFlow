// The one place that talks to SQLite: Cloudflare D1 in production, node:sqlite in tests. Everything else uses the
// company-scoped layer in tenant.ts.
export type SqlValue = string | number | null;
export type Stmt = { sql: string; params: SqlValue[] };
export interface Sql {
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Runs every statement in one transaction: all of them or none. */
  batch(stmts: Stmt[]): Promise<{ changes: number }[]>;
}

/** Minimal shape of the D1 binding (env.DB). */
type D1 = {
  prepare(sql: string): { bind(...v: SqlValue[]): { all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> } };
  batch(s: unknown[]): Promise<{ meta: { changes: number } }[]>;
};
export function d1Driver(db: D1): Sql {
  return {
    all: async <T,>(sql: string, params: SqlValue[] = []) => (await db.prepare(sql).bind(...params).all<T>()).results,
    run: async (sql, params = []) => ({ changes: (await db.prepare(sql).bind(...params).run()).meta.changes }),
    batch: async (stmts) => (await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params)))).map((r) => ({ changes: r.meta.changes })),
  };
}

/** node:sqlite (Node 22+), for tests and scripts. */
type NodeSqlite = {
  prepare(sql: string): { all(...v: SqlValue[]): unknown[]; run(...v: SqlValue[]): { changes: number | bigint } };
  exec(sql: string): void;
};
export function sqliteDriver(db: NodeSqlite): Sql {
  const run = (sql: string, params: SqlValue[] = []) => ({ changes: Number(db.prepare(sql).run(...params).changes) });
  return {
    all: async <T,>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    run: async (sql, params) => run(sql, params),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => run(s.sql, s.params));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
