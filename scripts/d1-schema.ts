// Generates the Cloudflare D1 (SQLite) schema from the real Postgres schema: every migration in supabase/migrations is
// applied to an in-memory Postgres (PGlite, as the tests do), then tables, columns, keys, checks and indexes are read
// back and translated. Anything that cannot be translated faithfully is listed in cloudflare/d1/REPORT.md instead of
// being guessed. Run: npx tsx scripts/d1-schema.ts
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

type Col = { table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null; is_identity: string; is_generated: string; generation_expression: string | null };
type Con = { tbl: string; conname: string; contype: string; def: string };
type Idx = { tablename: string; indexname: string; indexdef: string };

const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
  create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
  create function storage.foldername(text)returns text[]language sql immutable as $$select string_to_array($1,'/')$$;
  grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
for (const f of (await readdir("supabase/migrations")).sort())
  await db.exec((await readFile("supabase/migrations/" + f, "utf8")).replace("create extension if not exists pgcrypto;", ""));

const q = async <T>(sql: string) => (await db.query<T>(sql)).rows;
const tables = (await q<{ table_name: string }>(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`)).map((t) => t.table_name);
const cols = await q<Col>(`select table_name,column_name,data_type,udt_name,is_nullable,column_default,is_identity,is_generated,generation_expression from information_schema.columns where table_schema='public' order by table_name,ordinal_position`);
const cons = await q<Con>(`select conrelid::regclass::text tbl,conname,contype,pg_get_constraintdef(oid) def from pg_constraint where connamespace='public'::regnamespace and contype in('p','u','f','c') order by conrelid::regclass::text,contype,conname`);
const idxs = await q<Idx>(`select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname`);
const views = (await q<{ table_name: string }>(`select table_name from information_schema.views where table_schema='public'`)).map((v) => v.table_name);
const counts = (
  await q<{ functions: number; triggers: number; policies: number }>(
    `select (select count(*)::int from pg_proc where pronamespace='public'::regnamespace) functions,(select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal) triggers,(select count(*)::int from pg_policies where schemaname='public') policies`,
  )
)[0];

const notes: string[] = [];
const money: string[] = [];
const authRefs: string[] = [];
const uuidDefault = `(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))))`;
const nowDefault = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

function sqlType(c: Col) {
  if (c.data_type === "ARRAY") return "TEXT"; // JSON array
  switch (c.udt_name) {
    case "int2":
    case "int4":
    case "int8":
      return "INTEGER";
    case "bool":
      return "INTEGER";
    case "numeric":
      return "NUMERIC";
    case "float4":
    case "float8":
      return "REAL";
    case "bytea":
      return "BLOB";
    default:
      return "TEXT"; // uuid, text, varchar, jsonb, json, date, timestamptz, time, interval, citext, enums
  }
}
/** Postgres expression → SQLite, or null when it cannot be translated safely. */
function expr(e: string): string | null {
  let s = e.trim();
  // Exact SQLite equivalents of the Postgres-only pieces this schema uses.
  s = s.replace(/\(?now\(\) \+ '(\d+) (day|days|hour|hours)'::interval\)?/g, (_m, n, u) => `(strftime('%Y-%m-%dT%H:%M:%fZ','now','+${n} ${u.replace(/s$/, "")}s'))`);
  s = s.replace(/\((\w+) <= \((\w+) \+ '(\d+) days'::interval\)\)/g, "(julianday($1) <= julianday($2) + $3)");
  s = s.replace(/^ARRAY\[(.*)\]$/, (_m, items: string) => `'${JSON.stringify(items.split(/,\s*/).map((x) => x.replace(/^'|'::text$|'$/g, "")))}'`);
  s = s.replace(/cardinality\((\w+)\)/g, "json_array_length($1)");
  s = s.replace(/jsonb_array_length\((\w+)\)/g, "json_array_length($1)").replace(/jsonb_typeof\((\w+)\)/g, "json_type($1)");
  s = s.replace(/EXTRACT\(day FROM (\w+)\) = \(1\)::numeric/g, "strftime('%d',$1) = '01'");
  s = s.replace(/\((\w+) ~ '\^\(https:\/\/\|\/\)'::text\)/g, "($1 GLOB 'https://*' OR $1 GLOB '/*')");
  s = s.replace(/\((\w+) ~ '\^https:\/\/'::text\)/g, "($1 GLOB 'https://*')");
  s = s.replace(/\((\w+) ~ '\^\\d\{(\d+),(\d+)\}\$'::text\)/g, "(length($1) BETWEEN $2 AND $3 AND $1 NOT GLOB '*[^0-9]*')");
  s = s.replace(/'([^']*)'::(text|character varying|jsonb|json|uuid|date|timestamp with time zone|bpchar|numeric|integer|bigint)(\[\])?/g, (_m, v, _t, arr) => (arr ? `'${JSON.stringify(v.replace(/^\{|\}$/g, "").split(",").filter(Boolean))}'` : `'${v}'`));
  s = s.replace(/::(text|character varying|jsonb|json|uuid|integer|bigint|numeric|smallint|date|timestamp with time zone|double precision|real|boolean)(\[\])?/g, "");
  s = s.replace(/\bnow\(\)|CURRENT_TIMESTAMP|clock_timestamp\(\)/gi, nowDefault);
  s = s.replace(/\bgen_random_uuid\(\)/g, uuidDefault);
  s = s.replace(/\btrue\b/g, "1").replace(/\bfalse\b/g, "0");
  // x = ANY (ARRAY['a', 'b'])  →  x IN ('a', 'b')
  s = s.replace(/\(?([\w."]+)\)? = ANY \(\(?ARRAY\[([^\]]*)\]\)?\)/g, "$1 IN ($2)");
  s = s.replace(/<> ALL \(\(?ARRAY\[([^\]]*)\]\)?\)/g, "NOT IN ($1)");
  s = s.replace(/\bchar_length\(/g, "length(").replace(/\boctet_length\(/g, "length(");
  // data ->> 'key'  →  json_extract(data,'$.key')
  s = s.replace(/\(?(\w+) ->> '([^']+)'\)?/g, "json_extract($1,'$.$2')");
  // Judge what is left with quoted literals taken out (a value such as 'any' is not the ANY operator).
  const bare = s.replace(/'[^']*'/g, "''").replace(/json_array_length/g, "");
  if (/::|~\*?|\bARRAY\b|\binterval\b|jsonb_|\bany\b|\bILIKE\b|array_length|cardinality|date_trunc|to_char|regexp|similar to|\bextract\(/i.test(bare)) return null;
  return s;
}
function defaultOf(c: Col): string | null | undefined {
  const d = c.column_default;
  if (d == null) return undefined;
  if (/^nextval\(/.test(d)) return undefined; // identity / serial: INTEGER PRIMARY KEY
  if (c.data_type === "ARRAY" && /^'\{\}'/.test(d)) return "'[]'";
  const t = expr(d);
  if (t == null) notes.push(`default \`${c.table_name}.${c.column_name}\` = \`${d}\` (not translated: set it in code)`);
  return t;
}

const out: string[] = [
  "-- Generated by scripts/d1-schema.ts from supabase/migrations (do not edit by hand: change the generator or the migrations).",
  "-- Types: uuid/text/dates/json → TEXT (ISO-8601 UTC times, JSON text, arrays as JSON), booleans → INTEGER 0/1.",
  "PRAGMA foreign_keys = ON;",
  "",
];
for (const t of tables) {
  const tc = cols.filter((c) => c.table_name === t),
    tcon = cons.filter((c) => c.tbl === t || c.tbl === "public." + t || c.tbl === `"${t}"`);
  const pk = tcon.find((c) => c.contype === "p");
  const pkCols = pk ? pk.def.replace(/^PRIMARY KEY \((.*)\)$/, "$1").split(/,\s*/) : [];
  const lines: string[] = [];
  for (const c of tc) {
    const type = sqlType(c);
    if (c.udt_name === "numeric") money.push(`${t}.${c.column_name}`);
    const intPk = pkCols.length === 1 && pkCols[0] === c.column_name && type === "INTEGER" && (c.is_identity === "YES" || /^nextval\(/.test(c.column_default || ""));
    let line = `  "${c.column_name}" ${type}`;
    if (intPk) line += " PRIMARY KEY AUTOINCREMENT";
    if (c.is_generated === "ALWAYS" && c.generation_expression) {
      const g = expr(c.generation_expression);
      if (g) line += ` GENERATED ALWAYS AS (${g}) VIRTUAL`;
      else notes.push(`generated column \`${t}.${c.column_name}\` = \`${c.generation_expression}\` (compute it in code)`);
    }
    if (c.is_nullable === "NO" && !intPk) line += " NOT NULL";
    const d = c.is_generated === "ALWAYS" ? undefined : defaultOf(c);
    if (d) line += ` DEFAULT ${d.startsWith("(") || /^-?[\d.]+$/.test(d) || d.startsWith("'") ? d : `(${d})`}`;
    if (c.udt_name === "bool") line += ` CHECK ("${c.column_name}" IN (0,1))`;
    if (c.udt_name === "jsonb" || c.udt_name === "json" || c.data_type === "ARRAY") line += ` CHECK ("${c.column_name}" IS NULL OR json_valid("${c.column_name}"))`;
    lines.push(line);
  }
  if (pk && !(pkCols.length === 1 && lines.some((l) => l.startsWith(`  "${pkCols[0]}" INTEGER PRIMARY KEY`)))) lines.push(`  PRIMARY KEY (${pkCols.map((c) => `"${c}"`).join(", ")})`);
  for (const u of tcon.filter((c) => c.contype === "u")) lines.push(`  UNIQUE ${u.def.replace(/^UNIQUE (NULLS NOT DISTINCT )?/, "")}`);
  for (const f of tcon.filter((c) => c.contype === "f")) {
    const m = f.def.match(/^FOREIGN KEY \((.*?)\) REFERENCES ([\w."]+)\((.*?)\)(.*)$/);
    if (!m) {
      notes.push(`foreign key \`${t}.${f.conname}\`: \`${f.def}\``);
      continue;
    }
    const target = m[2].replace(/^public\./, "");
    if (target.startsWith("auth.")) {
      authRefs.push(`${t}(${m[1]})`);
      continue; // users move to the new auth tables; linked there
    }
    lines.push(`  FOREIGN KEY (${m[1]}) REFERENCES "${target}"(${m[3]})${m[4].replace(/ DEFERRABLE.*$/, "")}`);
  }
  for (const c of tcon.filter((c) => c.contype === "c")) {
    const body = c.def.replace(/^CHECK /, "").replace(/ NOT VALID$/, "");
    const s = expr(body);
    if (s) lines.push(`  CONSTRAINT "${c.conname}" CHECK ${s}`);
    else notes.push(`check \`${t}.${c.conname}\`: \`${c.def}\` (enforce in code)`);
  }
  out.push(`CREATE TABLE "${t}" (\n${lines.join(",\n")}\n);`);
}
out.push("");
const conNames = new Set(cons.map((c) => c.conname));
for (const i of idxs) {
  if (conNames.has(i.indexname)) continue; // made by PRIMARY KEY / UNIQUE above
  let d = i.indexdef.replace(/ ON public\./, " ON ").replace(/ USING btree/, "").replace(/ NULLS NOT DISTINCT/, "");
  const m = d.match(/^(CREATE (?:UNIQUE )?INDEX) (\S+) ON (\S+) \((.*)\)( WHERE (.*))?$/);
  if (!m) {
    notes.push(`index \`${i.indexname}\`: \`${i.indexdef}\``);
    continue;
  }
  const colsExpr = expr(m[4].replace(/ DESC| ASC/g, (x) => x)),
    where = m[6] ? expr(m[6]) : "";
  if (colsExpr == null || where == null || / USING (gin|gist|hash)/.test(i.indexdef)) {
    notes.push(`index \`${i.indexname}\`: \`${i.indexdef}\` (needs a different approach in SQLite)`);
    continue;
  }
  d = `${m[1]} IF NOT EXISTS "${m[2]}" ON "${m[3]}" (${colsExpr})${where ? ` WHERE ${where}` : ""};`;
  out.push(d);
}

await mkdir("cloudflare/d1", { recursive: true });
await writeFile("cloudflare/d1/0001_schema.sql", out.join("\n") + "\n");
const report = [
  "# D1 schema report",
  "",
  "Generated by `scripts/d1-schema.ts` from all migrations in `supabase/migrations`.",
  "",
  `- Tables: ${tables.length} · columns: ${cols.filter((c) => tables.includes(c.table_name)).length} · indexes kept: ${out.filter((l) => l.startsWith("CREATE")).length - tables.length}`,
  `- Postgres features that move into code: ${counts.functions} functions, ${counts.triggers} triggers, ${counts.policies} row-level security policies`,
  `- Views (rewrite as queries): ${views.length ? views.join(", ") : "none"}`,
  "",
  `## NUMERIC columns: ${money.length}`,
  "",
  "Decided 2026-11-22: kept as NUMERIC (SQLite stores whole numbers as INTEGER and fractions as REAL). The app already reads and writes these as JS numbers on Supabase, sums happen in TypeScript, and the journal balance / debit-credit checks use exact decimal maths (src/lib/d1/network-common.ts numeric(), finance.ts), so no satang conversion is needed.",
  "",
  money.map((m) => "- `" + m + "`").join("\n"),
  "",
  `## References to auth.users (relinked when users move to the new auth tables): ${authRefs.length}`,
  "",
  authRefs.map((m) => "- `" + m + "`").join("\n"),
  "",
  `## Not translated automatically: ${notes.length}`,
  "",
  notes.map((n) => "- " + n).join("\n"),
  "",
].join("\n");
await writeFile("cloudflare/d1/REPORT.md", report);

// Column facts the data layer (src/lib/d1) needs to read and write rows like Supabase did: JSON / array columns come
// back parsed, booleans as true/false, and which tables belong to one company (a company_id column).
const meta: Record<string, { company: boolean; columns: string[]; json: string[]; bool: string[]; num: string[] }> = {};
for (const t of tables) {
  const tc = cols.filter((c) => c.table_name === t);
  meta[t] = {
    company: tc.some((c) => c.column_name === "company_id"),
    columns: tc.map((c) => c.column_name),
    json: tc.filter((c) => c.udt_name === "jsonb" || c.udt_name === "json" || c.data_type === "ARRAY").map((c) => c.column_name),
    bool: tc.filter((c) => c.udt_name === "bool").map((c) => c.column_name),
    num: tc.filter((c) => c.udt_name === "numeric").map((c) => c.column_name),
  };
}
await mkdir("src/lib/d1", { recursive: true });
await writeFile(
  "src/lib/d1/tables.gen.ts",
  `// Generated by scripts/d1-schema.ts from supabase/migrations: do not edit by hand.\nexport type TableMeta = { company: boolean; columns: string[]; json: string[]; bool: string[]; num: string[] };\nexport const tables: Record<string, TableMeta> = ${JSON.stringify(meta, null, 1)};\n`,
);
console.log(`tables ${tables.length}, numeric ${money.length}, auth refs ${authRefs.length}, notes ${notes.length}`);
await db.close();
