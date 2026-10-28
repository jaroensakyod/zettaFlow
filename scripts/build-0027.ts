// Writes supabase/migrations/0027_expense_categories.sql: the grouped หมวดหมู่หลัก (src/lib/expense-categories.ts)
// as expense category options, and the chart-of-accounts entries those categories book to (src/lib/ledger.ts).
import { writeFile } from "node:fs/promises";
import { modules } from "../src/lib/catalog";
import { defaultAccounts } from "../src/lib/ledger";

const quote = (s: string | null) => (s === null ? "null" : "'" + s.replace(/'/g, "''") + "'");
const clean = (fields: object[]) => fields.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
const m = modules.find((x) => x.key === "expenses")!;
const accounts = defaultAccounts.map((a) => `(c,${quote(a.code)},${quote(a.name)},${quote(a.type)},${quote(a.category)})`).join(",\n  ");

const sql = `-- หมวดหมู่หลักของค่าใช้จ่าย: the grouped list with emoji in the app; older categories stay valid for existing records.
-- New accounts (asset purchases, travel, fuel, phone & internet, software, fees, insurance, drawings …) are added to
-- every company; existing accounts and their names are left as they are.

insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(clean(m.fields)))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

create or replace function public.seed_accounts(c uuid)returns void language sql security definer set search_path=public as $$
 insert into accounts(company_id,code,name,type,category)values
  ${accounts}
 on conflict do nothing;
 insert into cost_centers(company_id,code,name,kind)values(c,'HQ','สำนักงานใหญ่','branch')on conflict do nothing$$;
revoke all on function public.seed_accounts(uuid)from public,anon,authenticated;
select seed_accounts(id)from companies;
`;
await writeFile("supabase/migrations/0027_expense_categories.sql", sql);
console.log("ok");
