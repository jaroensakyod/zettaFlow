import { readFile, writeFile } from "node:fs/promises";
import { modules } from "../src/lib/catalog";
const file = "supabase/migrations/0001_core.sql";
const base = (await readFile(file, "utf8")).split(
  "-- GENERATED MODULE SCHEMAS",
)[0];
const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const sql = modules
  .map(
    (m) =>
      `insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(m.fields))}::jsonb);`,
  )
  .join("\n");
await writeFile(
  file,
  base +
    "-- GENERATED MODULE SCHEMAS: scripts/generate-schemas.ts\n" +
    sql +
    "\n",
);
