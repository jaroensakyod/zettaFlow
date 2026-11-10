// Writes supabase/migrations/0052_sales_orders_platforms.sql: the live validator (entity_schemas) learns the two new
// pages (แพลตฟอร์มการขาย, สินค้า & แพ็กเกจ) and the order's platform / package / payment fields.
import { writeFile } from "node:fs/promises";
import { modules } from "../src/lib/catalog";

const quote = (s: string | null) => (s === null ? "null" : "'" + s.replace(/'/g, "''") + "'");
const clean = (fields: object[]) => fields.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
// Platforms first: packages and orders point at them.
const rows = ["sales_platforms", "sales_packages", "sales_orders"].map((key) => {
  const m = modules.find((x) => x.key === key)!;
  return `insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(clean(m.fields)))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;`;
});
await writeFile(
  "supabase/migrations/0052_sales_orders_platforms.sql",
  `-- คำสั่งซื้อ: which platform it was sold on, which package, and its payment (who paid, when, how, reference).\n-- New pages: แพลตฟอร์มการขาย (sales_platforms) and สินค้า & แพ็กเกจ (sales_packages).\n${rows.join("\n")}\n\n`,
);
console.log("ok");
