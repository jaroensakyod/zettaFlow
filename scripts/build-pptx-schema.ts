import { writeFile } from "node:fs/promises";
import { catalog } from "../src/lib/catalog";
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const sql = [
  "-- PPTX pages 10 / 12 / 16 / 17 / 18: rental expenses, CRM and procurement fields.",
];
for (const key of ["leads", "purchases", "expenses", "customers"]) {
  const module = catalog[key];
  sql.push(
    `insert into public.entity_schemas(kind,department,fields)values(${quote(key)},${quote(module.department)},${quote(JSON.stringify(module.fields))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;`,
  );
}
await writeFile(
  "supabase/migrations/0010_pptx_fields.sql",
  sql.join("\n") + "\n",
);
