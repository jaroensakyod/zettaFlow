// Writes supabase/migrations/0045_project_employee_fields.sql: the live validator (entity_schemas) learns the new
// project fields (cover, subtitle, type, location, area, targets, team, paused status) and employees' strengths.
import { writeFile } from "node:fs/promises";
import { modules } from "../src/lib/catalog";

const quote = (s: string | null) => (s === null ? "null" : "'" + s.replace(/'/g, "''") + "'");
const clean = (fields: object[]) => fields.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
const rows = ["projects", "employees"].map((key) => {
  const m = modules.find((x) => x.key === key)!;
  return `insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(clean(m.fields)))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;`;
});
await writeFile(
  "supabase/migrations/0045_project_employee_fields.sql",
  `-- Projects page (cover, subtitle, type, location, area, sales/customer targets, team, paused) and employees' strengths.\n${rows.join("\n")}\n`,
);
console.log("ok");
