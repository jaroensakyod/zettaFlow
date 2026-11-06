// Prints the entity_schemas upsert for พนักงาน (employees) from the catalog, appended to 0036_trial_limits.sql.
import { modules } from "../src/lib/catalog";
const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const clean = (fields: object[]) => fields.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
const m = modules.find((x) => x.key === "employees")!;
console.log(
  "\n-- พนักงาน gains lineUserId (hidden) so a LINE member added from a LINE item is matched next time.\n" +
    `insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(clean(m.fields)))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;`,
);
