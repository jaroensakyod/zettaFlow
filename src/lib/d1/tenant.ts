// Company-scoped access to D1: the replacement for Supabase row-level security. Every read goes through the table's
// rule in access.ts; every write is pinned to the request's company (company_id is set, and matched on update and
// delete, whatever the caller passes). Table and column names are checked against the schema (tables.gen.ts), so no
// caller text ever reaches SQL except as a bound value. Rows come back like Supabase returned them: JSON and array
// columns parsed, booleans as true/false.
import { tables, type TableMeta } from "./tables.gen";
import { readRules, type Viewer, type Where } from "./access";
import type { Sql, SqlValue, Stmt } from "./driver";

export type Op = "=" | "!=" | ">" | ">=" | "<" | "<=" | "like";
export type Cond = SqlValue | boolean | SqlValue[] | { op: Op; value: SqlValue };
export type Query = {
  where?: Record<string, Cond>;
  columns?: string[];
  /** e.g. [["created_at", "desc"]] */
  order?: [string, "asc" | "desc"][];
  limit?: number;
  offset?: number;
};
type Row = Record<string, unknown>;

export class AccessError extends Error {
  status = 403;
}
const meta = (table: string): TableMeta => {
  const m = tables[table];
  if (!m) throw new AccessError(`unknown table ${table}`);
  return m;
};
const col = (m: TableMeta, table: string, c: string) => {
  if (!m.columns.includes(c)) throw new AccessError(`unknown column ${table}.${c}`);
  return `t."${c}"`;
};

/** A JS value → what SQLite stores for that column. */
function encode(m: TableMeta, c: string, v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (m.json.includes(c)) return JSON.stringify(v);
  if (m.bool.includes(c)) return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") throw new AccessError(`column ${c} does not take an object`);
  return v as SqlValue;
}
export function decode<T = Row>(m: TableMeta, row: Row): T {
  const out: Row = { ...row };
  for (const c of m.json) if (typeof out[c] === "string") out[c] = JSON.parse(out[c] as string);
  for (const c of m.bool) if (out[c] !== undefined && out[c] !== null) out[c] = !!out[c];
  return out as T;
}

export class Tenant {
  constructor(
    private sql: Sql,
    readonly viewer: Viewer,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  private filters(table: string, m: TableMeta, where: Record<string, Cond> = {}): Where {
    const parts: string[] = [],
      params: SqlValue[] = [];
    for (const [k, v] of Object.entries(where)) {
      const c = col(m, table, k);
      if (m.json.includes(k)) throw new AccessError(`filter on JSON column ${k}: use a query of its own`);
      if (v === null) parts.push(`${c} IS NULL`);
      else if (Array.isArray(v)) {
        if (!v.length) parts.push("0");
        else parts.push(`${c} IN (${v.map(() => "?").join(", ")})`), params.push(...v);
      } else if (typeof v === "object") {
        const op = v.op === "like" ? "LIKE" : v.op;
        if (!["=", "!=", ">", ">=", "<", "<=", "LIKE"].includes(op)) throw new AccessError(`operator ${v.op}`);
        parts.push(`${c} ${op} ?`), params.push(encode(m, k, v.value));
      } else parts.push(`${c} = ?`), params.push(encode(m, k, v));
    }
    return { sql: parts.length ? parts.join(" AND ") : "1", params };
  }
  private readable(table: string): Where {
    const rule = readRules[table];
    if (!rule) throw new AccessError(`${table} cannot be read here`);
    return rule(this.viewer, this.now());
  }

  async select<T = Row>(table: string, q: Query = {}): Promise<T[]> {
    const m = meta(table),
      r = this.readable(table),
      f = this.filters(table, m, q.where);
    const cols = q.columns?.length ? q.columns.map((c) => col(m, table, c)).join(", ") : "t.*";
    const order = q.order?.length ? ` ORDER BY ${q.order.map(([c, d]) => `${col(m, table, c)} ${d === "desc" ? "DESC" : "ASC"}`).join(", ")}` : "";
    const limit = q.limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(q.limit))}` + (q.offset ? ` OFFSET ${Math.max(0, Math.floor(q.offset))}` : "") : "";
    const rows = await this.sql.all<Row>(`SELECT ${cols} FROM "${table}" t WHERE (${r.sql}) AND (${f.sql})${order}${limit}`, [...r.params, ...f.params]);
    return rows.map((row) => decode<T>(m, row));
  }
  async first<T = Row>(table: string, q: Query = {}): Promise<T | null> {
    return (await this.select<T>(table, { ...q, limit: 1 }))[0] ?? null;
  }
  async count(table: string, where?: Record<string, Cond>): Promise<number> {
    const m = meta(table),
      r = this.readable(table),
      f = this.filters(table, m, where);
    const [row] = await this.sql.all<{ n: number }>(`SELECT count(*) AS n FROM "${table}" t WHERE (${r.sql}) AND (${f.sql})`, [...r.params, ...f.params]);
    return Number(row?.n || 0);
  }

  // ---------- writes: always inside the request's company ----------
  private writable(table: string): TableMeta {
    if (this.viewer.support) throw new AccessError("กำลังดูในมุมมองลูกค้า (อ่านอย่างเดียว)");
    const m = meta(table);
    if (!m.company) throw new AccessError(`${table} does not belong to one company: write it from a checked function`);
    return m;
  }
  insertStmt(table: string, row: Row): Stmt {
    const m = this.writable(table),
      data: Row = { ...row, company_id: this.viewer.companyId };
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    keys.forEach((k) => col(m, table, k));
    return { sql: `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) RETURNING *`, params: keys.map((k) => encode(m, k, data[k])) };
  }
  updateStmt(table: string, where: Record<string, Cond>, patch: Row): Stmt {
    const m = this.writable(table);
    if (!Object.keys(where).length) throw new AccessError("update needs a where");
    const keys = Object.keys(patch).filter((k) => patch[k] !== undefined && k !== "company_id");
    if (!keys.length) throw new AccessError("nothing to update");
    const f = this.filters(table, m, where);
    return {
      sql: `UPDATE "${table}" AS t SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE t.company_id = ? AND (${f.sql}) RETURNING *`,
      params: [...keys.map((k) => (col(m, table, k), encode(m, k, patch[k]))), this.viewer.companyId, ...f.params],
    };
  }
  deleteStmt(table: string, where: Record<string, Cond>): Stmt {
    const m = this.writable(table);
    if (!Object.keys(where).length) throw new AccessError("delete needs a where");
    const f = this.filters(table, m, where);
    return { sql: `DELETE FROM "${table}" AS t WHERE t.company_id = ? AND (${f.sql}) RETURNING *`, params: [this.viewer.companyId, ...f.params] };
  }
  async insert<T = Row>(table: string, row: Row): Promise<T> {
    const s = this.insertStmt(table, row);
    return decode<T>(meta(table), (await this.sql.all<Row>(s.sql, s.params))[0]);
  }
  async update<T = Row>(table: string, where: Record<string, Cond>, patch: Row): Promise<T[]> {
    const s = this.updateStmt(table, where, patch);
    return (await this.sql.all<Row>(s.sql, s.params)).map((r) => decode<T>(meta(table), r));
  }
  async remove<T = Row>(table: string, where: Record<string, Cond>): Promise<T[]> {
    const s = this.deleteStmt(table, where);
    return (await this.sql.all<Row>(s.sql, s.params)).map((r) => decode<T>(meta(table), r));
  }
  /** Several writes as one: all or none. A failed guardStmt aborts the batch with a ConflictError. */
  async atomic(stmts: Stmt[]) {
    if (this.viewer.support) throw new AccessError("กำลังดูในมุมมองลูกค้า (อ่านอย่างเดียว)");
    try {
      return await this.sql.batch(stmts);
    } catch (e) {
      if (/malformed JSON/i.test(String((e as Error).message))) throw new ConflictError();
      throw e;
    }
  }

  // ---------- for checked functions (the old SECURITY DEFINER functions) ----------
  /**
   * Reads inside this company without the per-person read rule — what a Postgres SECURITY DEFINER function saw (e.g.
   * the record being saved even if it sits in a department the person cannot list). Still pinned to the company, so
   * only tables with company_id.
   */
  async selectInternal<T = Row>(table: string, q: Query = {}): Promise<T[]> {
    const m = meta(table);
    if (!m.company) throw new AccessError(`${table} does not belong to one company`);
    const f = this.filters(table, m, q.where);
    const order = q.order?.length ? ` ORDER BY ${q.order.map(([c, d]) => `${col(m, table, c)} ${d === "desc" ? "DESC" : "ASC"}`).join(", ")}` : "";
    const limit = q.limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(q.limit))}` : "";
    const rows = await this.sql.all<Row>(`SELECT t.* FROM "${table}" t WHERE t.company_id = ? AND (${f.sql})${order}${limit}`, [this.viewer.companyId, ...f.params]);
    return rows.map((row) => decode<T>(m, row));
  }
  /**
   * A batch step that aborts the whole batch unless a row matching `where` still exists in this company — the
   * stand-in for Postgres row locks: read, decide, then write only if what was read has not changed meanwhile.
   */
  guardStmt(table: string, where: Record<string, Cond>): Stmt {
    const m = meta(table);
    if (!m.company) throw new AccessError(`${table} does not belong to one company`);
    const f = this.filters(table, m, where);
    return { sql: `SELECT CASE WHEN EXISTS (SELECT 1 FROM "${table}" t WHERE t.company_id = ? AND (${f.sql})) THEN 1 ELSE json('changed') END`, params: [this.viewer.companyId, ...f.params] };
  }
  /** Next running number for a document prefix (next_number): atomic, never reused. */
  async nextNumber(prefix: string, year: number): Promise<number> {
    if (this.viewer.support) throw new AccessError("กำลังดูในมุมมองลูกค้า (อ่านอย่างเดียว)");
    const [r] = await this.sql.all<{ last: number }>(
      `INSERT INTO doc_counters (company_id, prefix, year, last) VALUES (?, ?, ?, 1) ON CONFLICT (company_id, prefix, year) DO UPDATE SET last = last + 1 RETURNING last`,
      [this.viewer.companyId, prefix, year],
    );
    return Number(r.last);
  }
}
/** What was read changed before the write: nothing was saved, the person should reload and try again. */
export class ConflictError extends Error {
  status = 409;
  constructor() {
    super("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่");
  }
}
