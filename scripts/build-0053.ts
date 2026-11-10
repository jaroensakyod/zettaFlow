// Writes supabase/migrations/0053_quotation_project.sql: a quotation can name the project it is for.
import { writeFile } from "node:fs/promises";
import { modules } from "../src/lib/catalog";

const quote = (s: string | null) => (s === null ? "null" : "'" + s.replace(/'/g, "''") + "'");
const clean = (fields: object[]) => fields.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
const rows = ["quotations"].map((key) => {
  const m = modules.find((x) => x.key === key)!;
  return `insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(clean(m.fields)))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;`;
});
await writeFile(
  "supabase/migrations/0053_quotation_project.sql",
  `-- ใบเสนอราคา: optional project (what job the quote is for); accepting it then uses that project.
${rows.join("\n")}\n\n`,
);
console.log("ok");
