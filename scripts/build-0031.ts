// Writes supabase/migrations/0031_expense_currency.sql: expenses gain currency / amountForeign / fxRate
// (src/lib/fx.ts) so a USD invoice keeps its own figure while `amount` stays in baht.
import { writeFile } from "node:fs/promises";
import { modules } from "../src/lib/catalog";

const quote = (s: string | null) => (s === null ? "null" : "'" + s.replace(/'/g, "''") + "'");
const clean = (fields: object[]) => fields.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
const m = modules.find((x) => x.key === "expenses")!;

const sql = `-- Foreign-currency expenses: the document's currency, its own amount and the baht rate used.
-- \`amount\` stays in baht, so totals, VAT, withholding and journals are unchanged.

insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(clean(m.fields)))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;
`;
await writeFile("supabase/migrations/0031_expense_currency.sql", sql);
console.log("ok");
