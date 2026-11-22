// A Supabase-shaped client on D1: the app keeps calling sb.from(...).select(...).eq(...), sb.rpc(...), sb.auth and
// sb.storage, and on DATA_BACKEND=d1 those run here against SQLite. The user client (supabaseServer) sees exactly what
// Postgres row-level security let a person see (access.ts read rules, over every company they belong to) and may write
// only what Postgres let them write directly (nothing: every table write goes through an RPC); the service client
// (supabaseAdmin) bypasses the rules like service_role did. Results come back as supabase-js gives them:
// { data, error, count } with JSON parsed, booleans as true/false and PostgREST's error codes.
import { tables, type TableMeta } from "./tables.gen";
import { relations } from "./relations.gen";
import { readRules, canReadDept, canWriteDept, type Viewer, type Where } from "./access";
import { decode, encode, AccessError, ConflictError, Tenant } from "./tenant";
import type { Sql, SqlValue } from "./driver";
import { AppError } from "../domain";
import { fail, serviceTenant, supportViewerIn, pgText } from "./common";
import { rpcs } from "./rpc-map";
import type { RpcCaller } from "./rpc-types";
import { buckets, blobSecret, safePath, signBlobUrl, type BlobStore } from "./blobs";
import type { Role } from "../types";

type Row = Record<string, unknown>;
export type D1User = { id: string; email: string; name: string; emailVerified?: boolean; createdAt?: string };
/** supabase-js User, the fields the app reads. */
export type AuthUser = {
  id: string;
  email: string;
  user_metadata: { name: string };
  app_metadata: Record<string, unknown>;
  aud: string;
  role: string;
  email_confirmed_at: string | null;
  created_at: string | null;
};
export type AuthError = { message: string; name: string; status: number; code: string };
export type AuthUserResponse = { data: { user: AuthUser | null; session: { user: AuthUser } | null }; error: AuthError | null };
/** The supabase-js auth calls the app makes for sign-in, sign-up, email links and password reset. */
export type D1AuthMethods = {
  signInWithPassword(c: { email: string; password: string }): Promise<AuthUserResponse>;
  signUp(c: { email: string; password: string; options?: { data?: Record<string, unknown>; emailRedirectTo?: string } }): Promise<AuthUserResponse>;
  signOut(o?: { scope?: "global" | "local" | "others" }): Promise<{ error: AuthError | null }>;
  resetPasswordForEmail(email: string, o?: { redirectTo?: string }): Promise<{ data: Record<string, never> | null; error: AuthError | null }>;
  verifyOtp(p: { token_hash: string; type: string }): Promise<AuthUserResponse>;
  updateUser(a: { password?: string; data?: Record<string, unknown> }): Promise<{ data: { user: AuthUser | null }; error: AuthError | null }>;
  exchangeCodeForSession(code: string): Promise<AuthUserResponse>;
};
/** Real accounts (src/lib/d1/auth.ts d1AuthBridge): given the client's person, the methods that change it. */
export type D1AuthProvider = (client: {
  setUser(u: D1User | null): void;
  authUser(): AuthUser | null;
  toAuthUser(u: D1User): AuthUser;
}) => D1AuthMethods;
export type D1ClientOptions = {
  sql: Sql | (() => Promise<Sql>);
  /** The signed-in person (auth.uid()), null when nobody is signed in. Ignored for the service client. */
  user: D1User | null;
  /** True for supabaseAdmin(): service_role, no row rules. */
  service: boolean;
  blobs?: BlobStore | (() => Promise<BlobStore>);
  /** Site origin for signed / public file links (e.g. https://app.example.com). */
  origin?: string;
  blobSecret?: string;
  onSignOut?: () => Promise<void> | void;
  /** Sign-in, sign-up, email links, password changes (Better Auth). Without it they answer 501. */
  authProvider?: D1AuthProvider;
};
export type PgError = { message: string; code: string; details: string | null; hint: string | null; status?: number };
export type PgResult<T = unknown> = { data: T; error: PgError | null; count: number | null; status: number; statusText: string };

class QueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: string | null = null,
    readonly status = 400,
  ) {
    super(message);
  }
}
/** Any error thrown inside → the { message, code } PostgREST would answer (the app's dbError reads both). */
export function toPgError(e: unknown): PgError {
  const out = (code: string, message: string, details: string | null = null, status?: number): PgError => ({ message, code, details, hint: null, ...(status ? { status } : {}) });
  if (e instanceof QueryError) return out(e.code, e.message, e.details, e.status);
  if (e instanceof ConflictError) return out("40001", e.message, null, 409);
  if (e instanceof AccessError) return out("42501", e.message, null, 403);
  if (e instanceof AppError) return out("P0001", e.message, null, e.status); // raise exception
  const msg = String((e as Error)?.message ?? e);
  if (/UNIQUE constraint failed|PRIMARY KEY/i.test(msg)) return out("23505", "duplicate key value violates unique constraint", msg, 409);
  if (/FOREIGN KEY constraint failed/i.test(msg)) return out("23503", "insert or update on table violates foreign key constraint", msg);
  if (/NOT NULL constraint failed: ([a-z_]+)\.([a-z_]+)/i.test(msg)) {
    const m = /NOT NULL constraint failed: ([a-z_]+)\.([a-z_]+)/i.exec(msg)!;
    return out("23502", `null value in column "${m[2]}" of relation "${m[1]}" violates not-null constraint`, msg);
  }
  if (/CHECK constraint failed/i.test(msg)) return out("23514", "new row violates check constraint", msg);
  if (/malformed JSON/i.test(msg)) return out("40001", new ConflictError().message, msg, 409);
  return out("XX000", msg);
}

// ---------- names and values ----------
const metaOf = (table: string): TableMeta => {
  const m = tables[table];
  if (!m) throw new QueryError("42P01", `relation "public.${table}" does not exist`, null, 404);
  return m;
};
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
type ColRef = { col: string; path: string[]; text: boolean };
/** "data->a->>b" → column data, path [a, b], text (the last arrow is ->>). Casts (::text) are dropped. */
function parseColRef(table: string, m: TableMeta, raw: string): ColRef {
  const s = raw.trim().replace(/::[a-z_ ]+(\[\])?$/i, "");
  const parts = s.split(/(->>|->)/);
  const col = parts[0].trim().replace(/^"|"$/g, "");
  if (!m.columns.includes(col)) throw new QueryError("42703", `column ${table}.${col} does not exist`);
  const path: string[] = [];
  let text = false;
  for (let i = 1; i < parts.length; i += 2) {
    path.push(parts[i + 1].trim().replace(/^'|'$/g, "").replace(/^"|"$/g, ""));
    text = parts[i] === "->>";
  }
  if (path.length && !m.json.includes(col)) throw new QueryError("42883", `operator does not exist: ${col} -> unknown (not a JSON column)`);
  return { col, path, text };
}
const jsonPathText = (path: string[]) => "$" + path.map((p) => (/^\d+$/.test(p) ? `[${p}]` : IDENT.test(p) ? `.${p}` : `.${JSON.stringify(p)}`)).join("");
/** SQL for a column reference: the column, or Postgres `->>` (text) / `->` (JSON text) of a JSON column. */
function colSql(r: ColRef): Where {
  const c = `t."${r.col}"`;
  if (!r.path.length) return { sql: c, params: [] };
  const p = jsonPathText(r.path);
  if (!r.text) return { sql: `(${c} -> ?)`, params: [p] };
  // ->> gives text: true/false as words, numbers as their text, objects as JSON text.
  return { sql: `(CASE WHEN json_type(${c}, ?) IN ('true','false') THEN json_type(${c}, ?) ELSE CAST(json_extract(${c}, ?) AS TEXT) END)`, params: [p, p, p] };
}
/** The value at a path of a decoded JSON value, as Postgres -> (JSON) or ->> (text) returns it. */
function pathValue(v: unknown, r: ColRef): unknown {
  let cur = v;
  for (const k of r.path) {
    if (cur === null || cur === undefined || typeof cur !== "object") return null;
    cur = Array.isArray(cur) ? (/^\d+$/.test(k) ? cur[Number(k)] : undefined) : (cur as Row)[k];
  }
  if (cur === undefined) return null;
  return r.text ? pgText(cur) : cur;
}
const ISO_OFFSET = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d(:?\d\d)?)$/;
/** A filter value for a column: booleans as 1/0, Dates and timestamps with an offset as the stored ISO form. */
function filterValue(m: TableMeta, r: ColRef, v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (r.path.length) {
    if (typeof v === "boolean") return String(v);
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }
  if (m.bool.includes(r.col)) {
    if (v === "true" || v === "t") return 1;
    if (v === "false" || v === "f") return 0;
    return v ? 1 : 0;
  }
  if (typeof v === "string" && ISO_OFFSET.test(v) && !v.endsWith("Z")) {
    const d = new Date(v.replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v as SqlValue;
}
/** A LIKE pattern (Postgres: % _ and \ escapes; PostgREST also takes * for %) as a case-sensitive GLOB. */
function likeToGlob(p: string): string {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "\\" && i + 1 < p.length) {
      const n = p[++i];
      out += n === "*" || n === "?" || n === "[" ? `[${n}]` : n;
    } else if (ch === "%" || ch === "*") out += "*";
    else if (ch === "_") out += "?";
    else if (ch === "?" || ch === "[") out += `[${ch}]`;
    else out += ch;
  }
  return out;
}

// ---------- filters ----------
type Cond = { col: string; op: string; value: unknown; not?: boolean };
type Group = { group: "and" | "or"; items: Filter[]; not?: boolean };
type Filter = Cond | Group;
const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "cs", "cd", "match", "imatch"]);

/** Splits at top-level commas (outside parentheses and double quotes). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0,
    q = false,
    cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === "\\" && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') q = false;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out.map((x) => x.trim());
}
const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\(.)/g, "$1") : s);
/** A PostgREST value: in.(a,b,"c,d") → a list; null/true/false for is; everything else text. */
function restValue(op: string, raw: string): unknown {
  if (op === "in") {
    const inner = raw.trim().replace(/^\(/, "").replace(/\)$/, "");
    return inner === "" ? [] : splitTop(inner).map(unquote);
  }
  if (op === "is") {
    const v = raw.trim().toLowerCase();
    return v === "null" ? null : v === "true" ? true : v === "false" ? false : fail(`invalid is value ${raw}`);
  }
  if (op === "cs" || op === "cd") {
    const v = raw.trim();
    if (v.startsWith("{") && !v.startsWith('{"')) return splitTop(v.slice(1, -1)).map(unquote);
    return JSON.parse(v);
  }
  return unquote(raw);
}
/** Parses a PostgREST logic expression: "a.eq.1,and(b.in.(x,y),c.not.is.null)". */
export function parseLogic(s: string): Filter[] {
  return splitTop(s).map((item) => {
    let neg = false,
      rest = item;
    if (rest.startsWith("not.")) (neg = true), (rest = rest.slice(4));
    const g = /^(and|or)\(([\s\S]*)\)$/.exec(rest);
    if (g) return { group: g[1] as "and" | "or", items: parseLogic(g[2]), not: neg } as Group;
    const dot = rest.indexOf(".");
    if (dot < 0) throw new QueryError("PGRST100", `failed to parse logic tree (${s})`);
    const col = rest.slice(0, dot);
    let tail = rest.slice(dot + 1),
      not = false;
    if (tail.startsWith("not.")) (not = true), (tail = tail.slice(4));
    const d2 = tail.indexOf(".");
    if (d2 < 0) throw new QueryError("PGRST100", `failed to parse logic tree (${s})`);
    const op = tail.slice(0, d2);
    if (!OPS.has(op)) throw new QueryError("PGRST100", `unknown operator ${op} in (${s})`);
    const c: Cond = { col, op, value: restValue(op, tail.slice(d2 + 1)), not };
    return neg ? ({ group: "and", items: [c], not: true } as Group) : c;
  });
}

/** contains (@>) for a JSON column or path: every element / key of `v` is in the stored value. */
function containsSql(base: string, baseParams: SqlValue[], path: string, v: unknown): Where {
  if (Array.isArray(v)) {
    if (!v.length) return { sql: "1", params: [] };
    if (v.some((x) => x !== null && typeof x === "object")) throw new QueryError("PGRST100", "contains: only lists of plain values are supported on D1");
    return {
      sql: `json_type(${base}, ?) = 'array' AND NOT EXISTS (SELECT 1 FROM json_each(?) v WHERE NOT EXISTS (SELECT 1 FROM json_each(${base}, ?) w WHERE w.type = v.type AND w.value IS v.value))`,
      params: [...baseParams, path, JSON.stringify(v), ...baseParams, path],
    };
  }
  if (v !== null && typeof v === "object") {
    const parts = Object.entries(v as Row).map(([k, x]) => containsSql(base, baseParams, path + (IDENT.test(k) ? `.${k}` : `.${JSON.stringify(k)}`), x));
    return { sql: parts.length ? parts.map((p) => `(${p.sql})`).join(" AND ") : `json_type(${base}, ?) = 'object'`, params: parts.length ? parts.flatMap((p) => p.params) : [...baseParams, path] };
  }
  // A plain value at this path: same type and value.
  const type = v === null ? "null" : typeof v === "boolean" ? String(v) : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "real") : "text";
  if (type === "null" || type === "true" || type === "false") return { sql: `json_type(${base}, ?) = ?`, params: [...baseParams, path, type] };
  return { sql: `json_type(${base}, ?) IN (${typeof v === "number" ? "'integer','real'" : "'text'"}) AND json_extract(${base}, ?) = ?`, params: [...baseParams, path, ...baseParams, path, v as SqlValue] };
}

function compileCond(table: string, m: TableMeta, f: Cond): Where {
  const r = parseColRef(table, m, f.col),
    c = colSql(r);
  const val = (v: unknown) => filterValue(m, r, v);
  let w: Where;
  const isJsonCol = !r.path.length && m.json.includes(r.col);
  switch (f.op) {
    case "eq":
    case "neq":
      if (f.value === null || f.value === undefined) w = { sql: `${c.sql} IS ${f.op === "eq" ? "" : "NOT "}NULL`, params: c.params };
      else if (isJsonCol) w = { sql: `json(${c.sql}) ${f.op === "eq" ? "=" : "<>"} json(?)`, params: [...c.params, JSON.stringify(f.value)] };
      else w = { sql: `${c.sql} ${f.op === "eq" ? "=" : "<>"} ?`, params: [...c.params, val(f.value)] };
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      w = { sql: `${c.sql} ${{ gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op]} ?`, params: [...c.params, val(f.value)] };
      break;
    case "like":
      w = { sql: `${c.sql} GLOB ?`, params: [...c.params, likeToGlob(String(f.value))] };
      break;
    case "ilike":
      w = { sql: `${c.sql} LIKE ? ESCAPE '\\'`, params: [...c.params, String(f.value).replace(/\*/g, "%")] };
      break;
    case "is":
      if (f.value === null) w = { sql: `${c.sql} IS NULL`, params: c.params };
      else if (f.value === true || f.value === false) w = { sql: r.path.length ? `${c.sql} = ?` : `${c.sql} = ?`, params: [...c.params, r.path.length ? String(f.value) : f.value ? 1 : 0] };
      else throw new QueryError("PGRST100", `is.${String(f.value)} is not supported`);
      break;
    case "in": {
      const list = Array.isArray(f.value) ? f.value : typeof f.value === "string" ? (restValue("in", f.value) as unknown[]) : [f.value];
      // One JSON parameter for the whole list: D1 allows only 100 bound parameters per statement.
      w = list.length ? { sql: `${c.sql} IN (SELECT value FROM json_each(?))`, params: [...c.params, JSON.stringify(list.map(val))] } : { sql: "0", params: [] };
      break;
    }
    case "cs": {
      if (!m.json.includes(r.col)) throw new QueryError("PGRST100", `contains on ${table}.${r.col} (not a JSON or array column) is not supported on D1`);
      const v = typeof f.value === "string" ? restValue("cs", f.value) : f.value;
      w = containsSql(`t."${r.col}"`, [], r.path.length ? jsonPathText(r.path) : "$", v);
      break;
    }
    default:
      throw new QueryError("PGRST100", `operator ${f.op} is not supported on D1`);
  }
  return f.not ? { sql: `NOT (${w.sql})`, params: w.params } : w;
}
function compileFilter(table: string, m: TableMeta, f: Filter): Where {
  if ("group" in f) {
    const parts = f.items.map((x) => compileFilter(table, m, x));
    const sql = parts.length ? parts.map((p) => `(${p.sql})`).join(f.group === "and" ? " AND " : " OR ") : f.group === "and" ? "1" : "0";
    return { sql: f.not ? `NOT (${sql})` : sql, params: parts.flatMap((p) => p.params) };
  }
  return compileCond(table, m, f);
}
const andAll = (parts: Where[]): Where => ({ sql: parts.length ? parts.map((p) => `(${p.sql})`).join(" AND ") : "1", params: parts.flatMap((p) => p.params) });

// ---------- select lists ----------
type SelCol = { kind: "col"; key: string; ref: string };
type SelEmbed = { kind: "embed"; key: string; rel: string; hints: string[]; inner: boolean; items: SelItem[] };
type SelItem = { kind: "star" } | SelCol | SelEmbed;
export function parseSelect(s: string | undefined): SelItem[] {
  const text = (s ?? "*").replace(/\s+/g, " ").trim() || "*";
  return splitTop(text).map((raw): SelItem => {
    const item = raw.trim();
    if (item === "*") return { kind: "star" };
    const e = /^(?:([A-Za-z_][\w]*)\s*:\s*)?([A-Za-z_][\w]*)((?:\s*!\s*[\w]+)*)\s*\(([\s\S]*)\)$/.exec(item);
    if (e) {
      const hints = e[3]
        .split("!")
        .map((h) => h.trim())
        .filter(Boolean);
      return { kind: "embed", key: e[1] || e[2], rel: e[2], hints: hints.filter((h) => h !== "inner" && h !== "left"), inner: hints.includes("inner"), items: parseSelect(e[4]) };
    }
    const a = /^([A-Za-z_][\w]*)\s*:\s*([\s\S]+)$/.exec(item);
    const ref = (a ? a[2] : item).trim();
    const noCast = ref.replace(/::[a-z_ ]+(\[\])?$/i, "");
    const segs = noCast.split(/->>|->/);
    const key = a ? a[1] : segs[segs.length - 1].trim().replace(/^'|'$/g, "").replace(/^"|"$/g, "");
    return { kind: "col", key, ref };
  });
}

// ---------- who is asking ----------
type Member = { company_id: string; role: Role; departments: string[]; read_departments: string[] };
class Session {
  private viewersP: Promise<Viewer[]> | null = null;
  constructor(
    readonly sql: Sql,
    readonly user: D1User | null,
  ) {}
  /** Every company the person may read as member_role / support_viewer saw it. */
  viewers(): Promise<Viewer[]> {
    if (!this.user) return Promise.resolve([]);
    const u = this.user;
    return (this.viewersP ??= (async () => {
      const members = (await this.sql.all<Row>("SELECT company_id, role, departments, read_departments FROM memberships WHERE user_id = ? AND disabled = 0", [u.id])).map(
        (r) => decode<Member>(tables.memberships, r),
      );
      const at = new Date().toISOString();
      const support = (await this.sql.all<{ company_id: string; expires_at: string }>("SELECT company_id, expires_at FROM support_access WHERE user_id = ? AND ended_at IS NULL", [u.id])).filter(
        (r) => Date.parse(r.expires_at) > Date.parse(at),
      );
      const out: Viewer[] = members.map((m) => ({ userId: u.id, email: u.email.toLowerCase(), companyId: m.company_id, role: m.role, departments: m.departments || [], readDepartments: m.read_departments || [] }));
      for (const s of support)
        if (!out.some((v) => v.companyId === s.company_id)) out.push({ userId: u.id, email: u.email.toLowerCase(), companyId: s.company_id, role: "viewer", departments: [], support: true });
      return out;
    })());
  }
  async viewerFor(companyId: string | undefined | null): Promise<Viewer | null> {
    if (!companyId) return null;
    return (await this.viewers()).find((v) => v.companyId === companyId) ?? null;
  }
  /** Nobody in particular: rules that hinge on the company then match nothing, rules on the person still apply. */
  nobody(): Viewer {
    return { userId: this.user?.id ?? "", email: (this.user?.email ?? "").toLowerCase(), companyId: "", role: "viewer", departments: [] };
  }
}

/** Tables Postgres left granted to `authenticated` (RLS on, no write policy): inserts fail RLS, updates/deletes touch nothing. */
const GRANTED_NO_POLICY = new Set(["design_comments", "design_revisions", "project_inventory", "project_stage_history", "project_stages", "stock_transfers"]);
/**
 * Direct table writes the user client may make (Postgres policies for insert/update/delete). The Supabase schema has
 * none: every write goes through an RPC. Kept as a table so a future policy is one line here.
 */
const userWrites: Record<string, { insert?: boolean; update?: boolean; delete?: boolean }> = {};

// ---------- the query builder ----------
type Kind = "select" | "insert" | "update" | "delete" | "upsert";
type Order = { ref: string; asc: boolean; nullsFirst?: boolean };

export class D1Query<T = unknown> implements PromiseLike<PgResult<T>> {
  private kind: Kind = "select";
  private columns: string | undefined = "*";
  private returning = false;
  private countMode: string | null = null;
  private head = false;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private lim: number | null = null;
  private off = 0;
  private one: "single" | "maybe" | null = null;
  private rows: Row[] = [];
  private patch: Row = {};
  private onConflict: string[] | null = null;
  private ignoreDuplicates = false;
  private throwing = false;
  private result: Promise<PgResult<T>> | null = null;

  constructor(
    private ctx: ClientCtx,
    private table: string,
  ) {}

  // ----- verbs -----
  select(columns?: string, opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.kind === "select") {
      this.columns = columns ?? "*";
      this.countMode = opts?.count ?? null;
      this.head = !!opts?.head;
    } else {
      this.returning = true;
      this.columns = columns ?? "*";
      if (opts?.count) this.countMode = opts.count;
    }
    return this;
  }
  insert(values: Row | Row[], opts?: { count?: string; defaultToNull?: boolean }) {
    this.kind = "insert";
    this.rows = Array.isArray(values) ? values : [values];
    this.countMode = opts?.count ?? null;
    return this;
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean; count?: string; defaultToNull?: boolean }) {
    this.kind = "upsert";
    this.rows = Array.isArray(values) ? values : [values];
    this.onConflict = opts?.onConflict ? opts.onConflict.split(",").map((s) => s.trim()) : null;
    this.ignoreDuplicates = !!opts?.ignoreDuplicates;
    this.countMode = opts?.count ?? null;
    return this;
  }
  update(values: Row, opts?: { count?: string }) {
    this.kind = "update";
    this.patch = values;
    this.countMode = opts?.count ?? null;
    return this;
  }
  delete(opts?: { count?: string }) {
    this.kind = "delete";
    this.countMode = opts?.count ?? null;
    return this;
  }

  // ----- filters -----
  private add(col: string, op: string, value: unknown, not = false) {
    this.filters.push({ col, op, value, not });
    return this;
  }
  eq(col: string, value: unknown) {
    return this.add(col, "eq", value);
  }
  neq(col: string, value: unknown) {
    return this.add(col, "neq", value);
  }
  gt(col: string, value: unknown) {
    return this.add(col, "gt", value);
  }
  gte(col: string, value: unknown) {
    return this.add(col, "gte", value);
  }
  lt(col: string, value: unknown) {
    return this.add(col, "lt", value);
  }
  lte(col: string, value: unknown) {
    return this.add(col, "lte", value);
  }
  like(col: string, pattern: string) {
    return this.add(col, "like", pattern);
  }
  ilike(col: string, pattern: string) {
    return this.add(col, "ilike", pattern);
  }
  is(col: string, value: null | boolean) {
    return this.add(col, "is", value);
  }
  in(col: string, values: readonly unknown[]) {
    return this.add(col, "in", [...values]);
  }
  contains(col: string, value: unknown) {
    return this.add(col, "cs", value);
  }
  match(query: Row) {
    for (const [k, v] of Object.entries(query)) this.add(k, "eq", v);
    return this;
  }
  not(col: string, op: string, value: unknown) {
    // .not("x", "in", "(a,b)") and .not("x", "is", null): the value as PostgREST would read it.
    const v = typeof value === "string" && op !== "eq" && op !== "neq" && op !== "like" && op !== "ilike" ? restValue(op, value) : value;
    return this.add(col, op, v, true);
  }
  filter(col: string, op: string, value: unknown) {
    if (op.startsWith("not.")) return this.not(col, op.slice(4), value);
    return this.add(col, op, typeof value === "string" ? restValue(op, value) : value);
  }
  or(expr: string, opts?: { foreignTable?: string; referencedTable?: string }) {
    if (opts?.foreignTable || opts?.referencedTable) throw new QueryError("PGRST100", "or() on an embedded table is not supported on D1");
    this.filters.push({ group: "or", items: parseLogic(expr) });
    return this;
  }

  // ----- shape -----
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string }) {
    if (opts?.foreignTable || opts?.referencedTable) throw new QueryError("PGRST100", "order() on an embedded table is not supported on D1");
    this.orders.push({ ref: col, asc: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.off = from;
    this.lim = to - from + 1;
    return this;
  }
  single() {
    this.one = "single";
    return this as unknown as D1Query<T extends (infer U)[] ? U : T>;
  }
  maybeSingle() {
    this.one = "maybe";
    return this as unknown as D1Query<(T extends (infer U)[] ? U : T) | null>;
  }
  returns<U>() {
    return this as unknown as D1Query<U>;
  }
  overrideTypes<U>() {
    return this as unknown as D1Query<U>;
  }
  throwOnError() {
    this.throwing = true;
    return this;
  }
  abortSignal() {
    return this;
  }

  then<A = PgResult<T>, B = never>(onfulfilled?: ((value: PgResult<T>) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    this.result ??= this.run();
    return this.result.then(onfulfilled, onrejected);
  }

  // ----- running -----
  private async run(): Promise<PgResult<T>> {
    try {
      const out = await this.exec();
      return out as PgResult<T>;
    } catch (e) {
      const error = toPgError(e);
      if (this.throwing) throw Object.assign(new Error(error.message), error);
      return { data: null as T, error, count: null, status: error.status ?? 400, statusText: error.code };
    }
  }
  private async exec(): Promise<PgResult<unknown>> {
    const m = metaOf(this.table),
      sql = await this.ctx.sql();
    const where = andAll(this.filters.map((f) => compileFilter(this.table, m, f)));
    let rows: Row[];
    let count: number | null = null;
    let status = 200;
    if (this.kind === "select") {
      const access = await this.ctx.readWhere(this.table, this.filters);
      const w = andAll([access, where]);
      if (this.countMode) count = Number((await sql.all<{ n: number }>(`SELECT count(*) AS n FROM "${this.table}" t WHERE ${w.sql}`, w.params))[0]?.n ?? 0);
      if (this.head) return { data: null, error: null, count, status, statusText: "OK" };
      const ord = this.orderSql(m);
      const tail = ord.sql + (this.lim !== null ? ` LIMIT ${Math.max(0, Math.floor(this.lim))}` : this.off ? " LIMIT -1" : "") + (this.off ? ` OFFSET ${Math.max(0, Math.floor(this.off))}` : "");
      rows = (await sql.all<Row>(`SELECT t.* FROM "${this.table}" t WHERE ${w.sql}${tail}`, [...w.params, ...ord.params])).map((r) => decode<Row>(m, r));
    } else {
      rows = await this.write(sql, m, where);
      status = this.kind === "insert" || this.kind === "upsert" ? 201 : 200;
      if (this.countMode) count = rows.length;
      if (!this.returning) {
        if (this.one) return this.shapeOne([], count, status);
        return { data: null, error: null, count, status: this.kind === "delete" || this.kind === "update" ? 204 : status, statusText: "OK" };
      }
    }
    const data = await this.ctx.project(this.table, rows, parseSelect(this.columns));
    if (this.one) return this.shapeOne(data, count, status);
    return { data, error: null, count, status, statusText: "OK" };
  }
  private shapeOne(data: Row[], count: number | null, status: number): PgResult<unknown> {
    if (data.length === 1) return { data: data[0], error: null, count, status, statusText: "OK" };
    if (this.one === "maybe" && data.length === 0) return { data: null, error: null, count, status, statusText: "OK" };
    const error: PgError = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${data.length} rows`, hint: null, status: 406 };
    if (this.throwing) throw Object.assign(new Error(error.message), error);
    return { data: null, error, count, status: 406, statusText: "Not Acceptable" };
  }
  private orderSql(m: TableMeta): Where {
    if (!this.orders.length) return { sql: "", params: [] };
    const parts = this.orders.map((o) => {
      const c = colSql(parseColRef(this.table, m, o.ref));
      const nullsFirst = o.nullsFirst ?? !o.asc; // Postgres: nulls sort as the largest value
      return { sql: `${c.sql} ${o.asc ? "ASC" : "DESC"} NULLS ${nullsFirst ? "FIRST" : "LAST"}`, params: c.params };
    });
    return { sql: " ORDER BY " + parts.map((p) => p.sql).join(", "), params: parts.flatMap((p) => p.params) };
  }
  private async write(sql: Sql, m: TableMeta, where: Where): Promise<Row[]> {
    const t = this.table,
      kind = this.kind === "upsert" ? "insert" : this.kind;
    if (!this.ctx.service) {
      const allowed = userWrites[t]?.[kind as "insert" | "update" | "delete"];
      if (!allowed) {
        if (!this.ctx.user) throw new QueryError("42501", `permission denied for table ${t}`, null, 401);
        if (GRANTED_NO_POLICY.has(t)) {
          if (kind === "insert") throw new QueryError("42501", `new row violates row-level security policy for table "${t}"`, null, 403);
          return []; // RLS hides every row from UPDATE / DELETE: nothing changes, no error.
        }
        throw new QueryError("42501", `permission denied for table ${t}`, null, 403);
      }
    }
    const check = (c: string) => {
      if (!m.columns.includes(c)) throw new QueryError("PGRST204", `Could not find the '${c}' column of '${t}' in the schema cache`);
      return `"${c}"`;
    };
    let stmt: { sql: string; params: SqlValue[] };
    if (kind === "insert") {
      if (!this.rows.length) return [];
      const keys = [...new Set(this.rows.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))];
      keys.forEach(check);
      if (!keys.length) throw new QueryError("PGRST100", "insert of an empty row is not supported on D1");
      // Missing keys are NULL (supabase-js defaultToNull); several rows go in as one JSON parameter because D1 allows
      // only 100 bound parameters per statement.
      const cells = this.rows.map((r) => keys.map((k) => encode(m, k, r[k])));
      const source: Where =
        cells.length === 1
          ? { sql: `VALUES (${keys.map(() => "?").join(", ")})`, params: cells[0] }
          : { sql: `SELECT ${keys.map((_, i) => `json_extract(value, '$[${i}]')`).join(", ")} FROM json_each(?) WHERE 1`, params: [JSON.stringify(cells)] };
      let tail = "";
      if (this.kind === "upsert") {
        const target = this.onConflict ?? relations[t]?.pk ?? [];
        if (!target.length) throw new QueryError("42P10", `there is no unique or exclusion constraint matching the ON CONFLICT specification`);
        target.forEach(check);
        const sets = keys.filter((k) => !target.includes(k)).map((k) => `"${k}" = excluded."${k}"`);
        tail = ` ON CONFLICT (${target.map((c) => `"${c}"`).join(", ")}) DO ${this.ignoreDuplicates || !sets.length ? "NOTHING" : "UPDATE SET " + sets.join(", ")}`;
      }
      stmt = { sql: `INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(", ")}) ${source.sql}${tail} RETURNING *`, params: source.params };
    } else if (kind === "update") {
      const keys = Object.keys(this.patch).filter((k) => this.patch[k] !== undefined);
      if (!keys.length) return [];
      keys.forEach(check);
      stmt = { sql: `UPDATE "${t}" AS t SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE ${where.sql} RETURNING *`, params: [...keys.map((k) => encode(m, k, this.patch[k])), ...where.params] };
    } else stmt = { sql: `DELETE FROM "${t}" AS t WHERE ${where.sql} RETURNING *`, params: where.params };
    return (await sql.all<Row>(stmt.sql, stmt.params)).map((r) => decode<Row>(m, r));
  }
}

// ---------- the client ----------
type ClientCtx = {
  service: boolean;
  user: D1User | null;
  sql(): Promise<Sql>;
  readWhere(table: string, filters: Filter[]): Promise<Where>;
  project(table: string, rows: Row[], items: SelItem[]): Promise<Row[]>;
};

/** The companies a query is pinned to by a top-level company_id = / IN filter (null when it is not). */
function pinnedCompanies(filters: Filter[]): string[] | null {
  let out: string[] | null = null;
  for (const f of filters) {
    if ("group" in f || f.not || f.col !== "company_id") continue;
    const list = f.op === "eq" ? [f.value] : f.op === "in" ? (f.value as unknown[]) : null;
    if (!list) continue;
    const ids = list.map(String);
    out = out ? out.filter((x) => ids.includes(x)) : ids;
  }
  return out;
}

type Embed = { rel: string; local: string; remote: string; many: boolean };
function resolveEmbed(table: string, e: SelEmbed): Embed {
  if (!tables[e.rel]) throw new QueryError("PGRST200", `Could not find a relationship between '${table}' and '${e.rel}' in the schema cache`);
  const hint = (cols: string[]) => !e.hints.length || e.hints.some((h) => cols.includes(h) || h === e.rel || h === table);
  const out: Embed[] = [];
  for (const fk of relations[table]?.fks ?? []) if (fk.table === e.rel && hint(fk.cols)) out.push({ rel: e.rel, local: fk.cols[0], remote: fk.refs[0], many: false });
  for (const fk of relations[e.rel]?.fks ?? []) if (fk.table === table && hint(fk.cols)) out.push({ rel: e.rel, local: fk.refs[0], remote: fk.cols[0], many: true });
  if (!out.length) throw new QueryError("PGRST200", `Could not find a relationship between '${table}' and '${e.rel}' in the schema cache`);
  if (out.length > 1) throw new QueryError("PGRST201", `Could not embed because more than one relationship was found for '${table}' and '${e.rel}'`);
  return out[0];
}

export function d1Client(opts: D1ClientOptions) {
  const service = opts.service;
  // The signed-in person; sign-in / verifyOtp / signOut on this client change it, like supabase-js does.
  let user = service ? null : opts.user;
  let sqlP: Promise<Sql> | null = null;
  const sql = () => (sqlP ??= typeof opts.sql === "function" ? opts.sql() : Promise.resolve(opts.sql));
  let blobsP: Promise<BlobStore> | null = null;
  const blobs = () => {
    if (!opts.blobs) throw new QueryError("XX000", "file storage is not configured");
    return (blobsP ??= typeof opts.blobs === "function" ? opts.blobs() : Promise.resolve(opts.blobs));
  };
  let sessionP: Promise<Session> | null = null;
  const session = () => (sessionP ??= sql().then((s) => new Session(s, user)));
  const origin = (opts.origin || "").replace(/\/$/, "");

  const readWhere = async (table: string, filters: Filter[]): Promise<Where> => {
    if (service) return { sql: "1", params: [] };
    const rule = readRules[table];
    if (!rule || !user) throw new QueryError("42501", `permission denied for table ${table}`, null, user ? 403 : 401);
    const s = await session();
    const pinned = tables[table]?.columns.includes("company_id") ? pinnedCompanies(filters) : null;
    let vs = await s.viewers();
    if (pinned) vs = vs.filter((v) => pinned.includes(v.companyId));
    if (!vs.length) vs = [s.nobody()];
    const at = new Date().toISOString();
    const parts = vs.map((v) => rule(v, at));
    return { sql: parts.map((p) => `(${p.sql})`).join(" OR "), params: parts.flatMap((p) => p.params) };
  };

  const project = async (table: string, rows: Row[], items: SelItem[]): Promise<Row[]> => {
    const m = metaOf(table);
    const cols = items.filter((i): i is SelCol => i.kind === "col").map((i) => ({ i, r: parseColRef(table, m, i.ref) }));
    const out = rows.map((row) => {
      const o: Row = {};
      for (const it of items) {
        if (it.kind === "star") for (const c of m.columns) o[c] = row[c] ?? null;
        else if (it.kind === "col") {
          const r = cols.find((x) => x.i === it)!.r;
          o[it.key] = r.path.length ? pathValue(row[r.col], r) : (row[r.col] ?? null);
        } else o[it.key] = null;
      }
      return o;
    });
    const keep = rows.map(() => true);
    for (const it of items) {
      if (it.kind !== "embed") continue;
      const e = resolveEmbed(table, it);
      const vals = [...new Set(rows.map((r) => r[e.local]).filter((v) => v !== null && v !== undefined))] as SqlValue[];
      let sub: Row[] = [],
        subOut: Row[] = [];
      if (vals.length) {
        const rm = metaOf(e.rel);
        const access = await readWhere(e.rel, []);
        const w = andAll([access, { sql: `t."${e.remote}" IN (SELECT value FROM json_each(?))`, params: [JSON.stringify(vals)] }]);
        sub = (await (await sql()).all<Row>(`SELECT t.* FROM "${e.rel}" t WHERE ${w.sql}`, w.params)).map((r) => decode<Row>(rm, r));
        subOut = await project(e.rel, sub, it.items);
      }
      rows.forEach((row, i) => {
        const hits = sub.map((s, j) => (s[e.remote] === row[e.local] && row[e.local] != null ? j : -1)).filter((j) => j >= 0);
        if (e.many) out[i][it.key] = hits.map((j) => subOut[j]);
        else out[i][it.key] = hits.length ? subOut[hits[0]] : null;
        if (it.inner && (e.many ? !hits.length : !hits.length)) keep[i] = false;
      });
    }
    return out.filter((_, i) => keep[i]);
  };

  const ctx: ClientCtx = {
    service,
    get user() {
      return user;
    },
    sql,
    readWhere,
    project,
  };

  // ----- rpc -----
  const caller = async (): Promise<RpcCaller> => {
    const s = await sql();
    return {
      sql: s,
      userId: user?.id ?? null,
      email: (user?.email ?? "").toLowerCase(),
      name: user?.name ?? "",
      service,
      serviceTenant: (companyId: string) => serviceTenant(s, companyId),
      async tenantFor(companyId: string): Promise<Tenant> {
        if (service) return serviceTenant(s, companyId);
        if (!user) return fail("ไม่มีสิทธิ์", 403);
        const [m] = (await s.all<Row>("SELECT role, departments, read_departments FROM memberships WHERE company_id = ? AND user_id = ? AND disabled = 0 LIMIT 1", [companyId, user.id])).map((r) =>
          decode<Member>(tables.memberships, r),
        );
        const base = { userId: user.id, email: user.email.toLowerCase(), companyId };
        if (m) return new Tenant(s, { ...base, role: m.role, departments: m.departments || [], readDepartments: m.read_departments || [] });
        if (await supportViewerIn(serviceTenant(s), user.id, companyId)) return new Tenant(s, { ...base, role: "viewer", departments: [], support: true });
        return fail("ไม่มีสิทธิ์", 403);
      },
    };
  };
  const rpc = <T = unknown>(name: string, args: Record<string, unknown> = {}) => new D1Rpc<T>(name, args, caller, service || !!user);

  // ----- auth -----
  const toAuthUser = (u: D1User): AuthUser => ({
    id: u.id,
    email: u.email,
    user_metadata: { name: u.name },
    app_metadata: { provider: "email", providers: ["email"] },
    aud: "authenticated",
    role: "authenticated",
    email_confirmed_at: u.emailVerified === false ? null : (u.createdAt ?? null),
    created_at: u.createdAt ?? null,
  });
  const authUser = () => (user ? toAuthUser(user) : null);
  const setUser = (u: D1User | null) => {
    if (service) return;
    if ((u?.id ?? null) !== (user?.id ?? null)) sessionP = null; // the row rules of the new person
    user = u;
  };
  const missing = { message: "Auth session missing!", name: "AuthSessionMissingError", status: 400, code: "session_missing" };
  const unsupported = (what: string) => async () => ({
    data: { user: null, session: null },
    error: { message: `${what} ยังไม่รองรับบน D1 (ช่วงทดลองใช้ผู้ใช้จาก D1_DEV_USER)`, name: "AuthApiError", status: 501, code: "not_implemented" },
  });
  const fallback: D1AuthMethods = {
    signOut: async () => {
      setUser(null);
      return { error: null };
    },
    signInWithPassword: unsupported("การเข้าสู่ระบบ"),
    signUp: unsupported("การสมัครสมาชิก"),
    resetPasswordForEmail: async () => ({ ...(await unsupported("การรีเซ็ตรหัสผ่าน")()), data: null }),
    verifyOtp: unsupported("การยืนยันอีเมล"),
    updateUser: async () => ({ ...(await unsupported("การเปลี่ยนรหัสผ่าน")()), data: { user: null } }),
    exchangeCodeForSession: unsupported("การเข้าสู่ระบบ"),
  };
  const methods = !service && opts.authProvider ? opts.authProvider({ setUser, authUser, toAuthUser }) : fallback;
  const auth = {
    getUser: async () => {
      const u = authUser();
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: missing };
    },
    getClaims: async () => {
      const u = authUser();
      return u ? { data: { claims: { sub: u.id, email: u.email, role: "authenticated" } }, error: null } : { data: null, error: missing };
    },
    getSession: async () => {
      const u = authUser();
      return { data: { session: u ? { user: u } : null }, error: null };
    },
    ...methods,
    signOut: async (o?: { scope?: "global" | "local" | "others" }) => {
      const r = await methods.signOut(o);
      await opts.onSignOut?.();
      return r;
    },
    admin: {
      /** auth.admin.listUsers on the D1 users table (service client only). */
      async listUsers(p: { page?: number; perPage?: number } = {}) {
        if (!service) return { data: { users: [] }, error: { message: "User not allowed", status: 403 } };
        const per = Math.min(1000, p.perPage ?? 50),
          page = Math.max(1, p.page ?? 1);
        const rows = await (await sql()).all<{ id: string; email: string; name: string; created_at: string; email_verified: number | null; updated_at: string | null; last_sign_in_at: string | null }>(
          "SELECT id, email, name, created_at, email_verified, updated_at, last_sign_in_at FROM users ORDER BY created_at LIMIT ? OFFSET ?",
          [per, (page - 1) * per],
        );
        return {
          data: {
            users: rows.map((u) => ({
              id: u.id,
              email: u.email,
              created_at: u.created_at,
              last_sign_in_at: u.last_sign_in_at ?? null,
              email_confirmed_at: u.email_verified ? (u.updated_at ?? u.created_at) : null,
              user_metadata: { name: u.name },
            })),
          },
          error: null,
        };
      },
    },
  };

  // ----- storage -----
  const storage = { from: (bucket: string) => new D1Bucket(bucket, {
        service,
        get user() {
          return user;
        },
        session,
        blobs,
        origin,
        secret: () => opts.blobSecret ?? blobSecret(),
      }) };

  return { from: <T = Row[]>(table: string) => new D1Query<T>(ctx, table), rpc, auth, storage };
}
export type D1Client = ReturnType<typeof d1Client>;

// ---------- rpc ----------
export class D1Rpc<T = unknown> implements PromiseLike<PgResult<T>> {
  private one: "single" | "maybe" | null = null;
  private throwing = false;
  private result: Promise<PgResult<T>> | null = null;
  constructor(
    private name: string,
    private args: Record<string, unknown>,
    private caller: () => Promise<RpcCaller>,
    private allowed: boolean,
  ) {}
  single() {
    this.one = "single";
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }
  throwOnError() {
    this.throwing = true;
    return this;
  }
  returns<U>() {
    return this as unknown as D1Rpc<U>;
  }
  then<A = PgResult<T>, B = never>(onfulfilled?: ((value: PgResult<T>) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    this.result ??= this.run();
    return this.result.then(onfulfilled, onrejected);
  }
  private async run(): Promise<PgResult<T>> {
    let res: PgResult<unknown>;
    try {
      const handler = Object.prototype.hasOwnProperty.call(rpcs, this.name) ? rpcs[this.name] : undefined;
      if (!handler) throw new QueryError("PGRST202", `Could not find the function public.${this.name}(${Object.keys(this.args).sort().join(", ")}) in the schema cache`, null, 404);
      if (!this.allowed) throw new QueryError("42501", `permission denied for function ${this.name}`, null, 401);
      let data = (await handler(await this.caller(), this.args)) ?? null;
      if (this.one) {
        const list = Array.isArray(data) ? data : data === null ? [] : [data];
        if (list.length === 1) data = list[0];
        else if (this.one === "maybe" && !list.length) data = null;
        else throw new QueryError("PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${list.length} rows`, 406);
      }
      res = { data, error: null, count: null, status: 200, statusText: "OK" };
    } catch (e) {
      const error = toPgError(e);
      if (this.throwing) throw Object.assign(new Error(error.message), error);
      res = { data: null, error, count: null, status: error.status ?? 400, statusText: error.code };
    }
    return res as PgResult<T>;
  }
}

// ---------- storage ----------
type StorageError = { name: string; message: string; statusCode: string; status: number };
type BucketCtx = {
  service: boolean;
  user: D1User | null;
  session: () => Promise<Session>;
  blobs: () => Promise<BlobStore>;
  origin: string;
  secret: () => string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const serr = (message: string, status: number): StorageError => ({ name: "StorageApiError", message, statusCode: String(status), status });
type Body = ArrayBuffer | ArrayBufferView | Blob | string;
async function bodyBytes(b: Body): Promise<Uint8Array> {
  if (typeof b === "string") return new TextEncoder().encode(b);
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return new Uint8Array(await (b as Blob).arrayBuffer());
}

export class D1Bucket {
  constructor(
    private bucket: string,
    private c: BucketCtx,
  ) {}
  private key(path: string) {
    return `${this.bucket}/${path}`;
  }
  /** The storage.objects policies of the Supabase schema, per bucket (the service role passes everything). */
  async allowed(op: "select" | "insert" | "update" | "delete", path: string): Promise<boolean> {
    if (this.c.service) return true;
    const u = this.c.user;
    if (!u || !buckets[this.bucket]) return false;
    const folders = path.split("/").slice(0, -1); // storage.foldername(name)
    const s = await this.c.session();
    const viewer = async () => (folders[0] && UUID.test(folders[0]) ? s.viewerFor(folders[0].toLowerCase()) : null);
    switch (this.bucket) {
      case "eliteflow-files": {
        const v = await viewer(),
          d = folders[1];
        if (!v) return false;
        if (op === "select") return d !== undefined && canReadDept(v, d);
        if (op === "insert") return d !== undefined && canWriteDept(v, d);
        if (op === "delete") return v.role === "owner";
        return false;
      }
      case "eliteflow-posts": {
        if (op === "select") return true;
        if (op === "update") return false;
        const v = await viewer();
        return !!v && ["owner", "manager", "staff"].includes(v.role);
      }
      case "eliteflow-avatars":
        return op === "select" || path === `${u.id}.webp`;
      case "eliteflow-b2b": {
        if (op === "update" || op === "delete") return false;
        if (!folders[0] || !UUID.test(folders[0])) return false;
        const rows = await s.sql.all(
          `SELECT 1 FROM b2b_threads t JOIN memberships m ON m.company_id IN (t.company_a, t.company_b) AND m.user_id = ? AND m.disabled = 0 WHERE t.id = ?${op === "insert" ? " AND m.role <> 'viewer'" : ""} LIMIT 1`,
          [u.id, folders[0].toLowerCase()],
        );
        return rows.length > 0;
      }
      default:
        return false;
    }
  }
  private checkFile(bytes: number, contentType: string): StorageError | null {
    const b = buckets[this.bucket];
    if (!b) return serr("Bucket not found", 404);
    if (bytes > b.limit) return serr("The object exceeded the maximum allowed size", 413);
    const base = contentType.split(";")[0].trim().toLowerCase();
    if (b.mimes && !b.mimes.includes(base)) return serr(`mime type ${contentType} is not supported`, 415);
    return null;
  }

  async upload(path: string, body: Body, opts: { contentType?: string; upsert?: boolean; cacheControl?: string } = {}) {
    try {
      if (!safePath(path)) return { data: null, error: serr("Invalid key", 400) };
      const bytes = await bodyBytes(body);
      const type = opts.contentType || (typeof Blob !== "undefined" && body instanceof Blob && body.type) || "text/plain;charset=UTF-8";
      const bad = this.checkFile(bytes.byteLength, type);
      if (bad) return { data: null, error: bad };
      const store = await this.c.blobs();
      const exists = !!(await store.head(this.key(path)));
      if (exists && !opts.upsert) return { data: null, error: serr("The resource already exists", 409) };
      if (!(await this.allowed(exists ? "update" : "insert", path)) || (exists && !(await this.allowed("insert", path))))
        return { data: null, error: serr("new row violates row-level security policy", 403) };
      await store.put(this.key(path), bytes, type);
      return { data: { id: this.key(path), path, fullPath: this.key(path) }, error: null };
    } catch (e) {
      return { data: null, error: serr(String((e as Error)?.message ?? e), 500) };
    }
  }
  async download(path: string) {
    try {
      const store = await this.c.blobs();
      const hit = safePath(path) && (await this.allowed("select", path)) ? await store.get(this.key(path)) : null;
      if (!hit) return { data: null, error: serr("Object not found", 404) };
      return { data: new Blob([hit.bytes as unknown as BlobPart], { type: hit.info.contentType }), error: null };
    } catch (e) {
      return { data: null, error: serr(String((e as Error)?.message ?? e), 500) };
    }
  }
  async remove(paths: string[]) {
    try {
      const store = await this.c.blobs(),
        gone: { name: string; bucket_id: string; id: string }[] = [];
      for (const p of paths) {
        if (!safePath(p) || !(await store.head(this.key(p))) || !(await this.allowed("delete", p))) continue;
        await store.delete([this.key(p)]);
        gone.push({ name: p, bucket_id: this.bucket, id: this.key(p) });
      }
      return { data: gone, error: null };
    } catch (e) {
      return { data: null, error: serr(String((e as Error)?.message ?? e), 500) };
    }
  }
  async list(prefix = "", opts: { limit?: number; offset?: number; search?: string; sortBy?: { column?: string; order?: string } } = {}) {
    try {
      const folder = prefix.replace(/^\/+|\/+$/g, "");
      const base = `${this.bucket}/${folder ? folder + "/" : ""}`;
      const store = await this.c.blobs();
      type Entry = { name: string; id: string | null; updated_at: string | null; created_at: string | null; last_accessed_at: string | null; metadata: Record<string, unknown> | null };
      const seen = new Map<string, Entry>();
      for (const b of await store.list(base)) {
        const rest = b.key.slice(base.length),
          path = b.key.slice(this.bucket.length + 1);
        if (!(await this.allowed("select", path))) continue;
        const slash = rest.indexOf("/");
        if (slash >= 0) {
          const name = rest.slice(0, slash);
          if (!seen.has(name)) seen.set(name, { name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
        } else seen.set(rest, { name: rest, id: b.key, updated_at: b.uploaded, created_at: b.uploaded, last_accessed_at: b.uploaded, metadata: { size: b.size, mimetype: b.contentType } });
      }
      let list = [...seen.values()];
      if (opts.search) list = list.filter((e) => e.name.toLowerCase().includes(opts.search!.toLowerCase()));
      const col = (opts.sortBy?.column || "name") as keyof Entry,
        desc = opts.sortBy?.order === "desc";
      list.sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (desc ? -1 : 1));
      const off = opts.offset ?? 0;
      return { data: list.slice(off, off + (opts.limit ?? 100)), error: null };
    } catch (e) {
      return { data: null, error: serr(String((e as Error)?.message ?? e), 500) };
    }
  }
  async createSignedUrl(path: string, expiresIn: number, opts?: { download?: string | boolean; transform?: unknown }) {
    try {
      const store = await this.c.blobs();
      if (!safePath(path) || !(await this.allowed("select", path)) || !(await store.head(this.key(path)))) return { data: null, error: serr("Object not found", 404) };
      const name = opts?.download === true ? path.split("/").pop()! : typeof opts?.download === "string" ? opts.download : "";
      const url = this.c.origin + (await signBlobUrl(this.c.secret(), "get", this.bucket, path, expiresIn, name));
      return { data: { signedUrl: url }, error: null };
    } catch (e) {
      return { data: null, error: serr(String((e as Error)?.message ?? e), 500) };
    }
  }
  async createSignedUploadUrl(path: string, opts?: { upsert?: boolean }) {
    try {
      if (!safePath(path)) return { data: null, error: serr("Invalid key", 400) };
      if (!buckets[this.bucket]) return { data: null, error: serr("Bucket not found", 404) };
      const store = await this.c.blobs();
      if (!opts?.upsert && (await store.head(this.key(path)))) return { data: null, error: serr("The resource already exists", 409) };
      if (!(await this.allowed("insert", path))) return { data: null, error: serr("new row violates row-level security policy", 403) };
      const signed = await signBlobUrl(this.c.secret(), "put", this.bucket, path, 7200, opts?.upsert ? "true" : "");
      return { data: { signedUrl: this.c.origin + signed, token: new URLSearchParams(signed.split("?")[1]).get("sig")!, path }, error: null };
    } catch (e) {
      return { data: null, error: serr(String((e as Error)?.message ?? e), 500) };
    }
  }
  getPublicUrl(path: string) {
    return { data: { publicUrl: `${this.c.origin}/api/blob/${encodeURIComponent(this.bucket)}/${path.split("/").map(encodeURIComponent).join("/")}` } };
  }
}
