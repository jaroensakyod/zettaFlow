import { readFile, writeFile } from "node:fs/promises";
const path = "supabase/migrations/0008_workflow_links.sql";
const base = (await readFile(path, "utf8")).split(
  "-- GENERATED APPROVAL FUNCTIONS",
)[0];
const web = (await readFile("supabase/migrations/0001_core.sql", "utf8")).match(
  /create function public.decide_ingestion[\s\S]+?end\$\$;/,
)![0];
const line = (
  await readFile("supabase/migrations/0002_workflows.sql", "utf8")
).match(/create function public.line_approve[\s\S]+?end\$\$;/)![0];
const replace = (sql: string, call: string) =>
  sql
    .replace("create function", "create or replace function")
    .replace(
      /for s in select value from jsonb_array_elements\(i\.template->'steps'\)[\s\S]+?end loop;/,
      () => call,
    );
await writeFile(
  path,
  base +
    "-- GENERATED APPROVAL FUNCTIONS\n" +
    replace(
      web,
      "perform create_ingestion_workflow(p_company,auth.uid(),i.template,p_values,i.id);",
    ) +
    "\n" +
    replace(
      line,
      "perform create_ingestion_workflow(g.company_id,u.user_id,i.template,i.values,i.id);",
    ) +
    "\n",
);
