// Writes supabase/migrations/0024_expense_form.sql: the บันทึกค่าใช้จ่าย form (src/components/expense-form.tsx).
// Item rows may carry category / unit / currency / discount, and expenses gain EXP number, payee type, approver and bill discount.
import { readFile, writeFile } from "node:fs/promises";
import { modules } from "../src/lib/catalog";

const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const clean = (fields: object[]) => fields.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
const m = modules.find((x) => x.key === "expenses")!;

// validate_payload as defined in 0021, with the item-row check and copy widened to the optional expense details.
const src = (await readFile("supabase/migrations/0021_accounting.sql", "utf8")).replace(/\r\n/g, "\n");
const start = src.indexOf("create or replace function public.validate_payload(");
const end = src.indexOf("\n", src.indexOf("revoke all on function public.validate_payload(", start));
const swap = (s: string, a: string, b: string) => {
  if (!s.includes(a)) throw Error("0021 changed, update build-0024: " + a);
  return s.replace(a, b);
};
const optional = (k: string, check: string) => `(x ? '${k}' and(${check}))`;
let validate = src.slice(start, end);
validate = swap(
  validate,
  "or abs((x->>'price')::numeric)>1e12)then",
  "or abs((x->>'price')::numeric)>1e12\n   or " +
    [
      optional("category", "jsonb_typeof(x->'category')<>'string'or length(x->>'category')>100"),
      optional("unit", "jsonb_typeof(x->'unit')<>'string'or length(x->>'unit')>30"),
      optional("currency", "jsonb_typeof(x->'currency')<>'string'or length(x->>'currency')>3"),
      optional("discount", "jsonb_typeof(x->'discount')<>'number'or (x->>'discount')::numeric not between 0 and 1e12"),
      optional("discountType", "coalesce(x->>'discountType','')not in('percent','amount')"),
    ].join("or ") +
    ")then",
);
validate = swap(
  validate,
  "jsonb_build_object('name',x->'name','qty',x->'qty','price',x->'price')",
  "jsonb_strip_nulls(jsonb_build_object('name',x->'name','qty',x->'qty','price',x->'price','category',x->'category','unit',x->'unit','currency',x->'currency','discount',x->'discount','discountType',x->'discountType'))",
);

const sql = `-- บันทึกค่าใช้จ่าย form: item rows keep category, unit, currency and a per-row discount (percent or baht);
-- expenses gain an EXP document number, payee type / employee / phone, a bill discount and the chosen approver.

insert into public.entity_schemas(kind,department,fields)values(${quote(m.key)},${quote(m.department)},${quote(JSON.stringify(clean(m.fields)))}::jsonb)on conflict(kind)do update set department=excluded.department,fields=excluded.fields;

-- Same as 0021, except item rows may carry the optional expense details above (still validated, unknown keys dropped).
${validate}
`;
await writeFile("supabase/migrations/0024_expense_form.sql", sql);
console.log("ok");
