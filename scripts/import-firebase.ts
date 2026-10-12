import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { legacyId, legacyKinds, mapLegacy } from "../src/lib/legacy";
import { catalog } from "../src/lib/catalog";
import { entityDepartment } from "../src/lib/domain";
const args = process.argv.slice(2);
const arg = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const input = arg("--input"),
  company = arg("--company"),
  owner = arg("--source-owner"),
  apply = args.includes("--apply");
if (!input || !company || !owner) {
  console.error(
    "Usage: npx tsx --env-file=.env.local scripts/import-firebase.ts --input export.json --company <Supabase company UUID> --source-owner <Firebase UID> [--apply]",
  );
  process.exit(1);
}
z.uuid().parse(company);
const payload = z
  .record(
    z.string(),
    z.array(
      z.object({ id: z.string(), data: z.record(z.string(), z.unknown()) }),
    ),
  )
  .parse(JSON.parse(await readFile(input, "utf8")));
const rows: {
  id: string;
  company_id: string;
  kind: string;
  department: string;
  data: Record<string, unknown>;
  legacy_data: {
    collection: string;
    id: string;
    original: Record<string, unknown>;
  };
  created_by: null;
}[] = [];
const errors = [];
for (const collection of [
  "customers",
  "dealers",
  "employees",
  "freelancers",
  "projects",
  "dealAreas",
  "companyAssets",
])
  for (const document of payload[collection] || []) {
    if ((document.data.companyId || document.data.createdBy) !== owner)
      continue;
    try {
      const mapped = mapLegacy(collection, document.data, company);
      rows.push({
        id: legacyId(company, collection, document.id),
        company_id: company,
        kind: mapped.kind,
        department: entityDepartment(mapped.kind, mapped.data),
        data: mapped.data,
        legacy_data: { collection, id: document.id, original: document.data },
        created_by: null,
      });
      if (
        collection === "projects" &&
        document.data.deptStatus &&
        typeof document.data.deptStatus === "object"
      ) {
        const departmentMap: Record<string, string> = {
          accounting: "Finance",
          marketing: "Marketing",
          hr: "HR",
          it: "IT",
          cs: "Customer Service",
          data: "Data",
          legal: "Legal",
          stock: "Warehouse",
          event: "Operations",
        };
        for (const [key, status] of Object.entries(document.data.deptStatus)) {
          const department = departmentMap[key] || key;
          rows.push({
            id: legacyId(company, "tasks", document.id + ":" + key),
            company_id: company,
            kind: "tasks",
            department,
            data: {
              name: String(mapped.data.name) + " / " + department,
              projectId: legacyId(company, "projects", document.id),
              department,
              priority: "normal",
              status: ["pending", "progress", "review", "done"].includes(
                String(status),
              )
                ? status
                : "pending",
            },
            legacy_data: {
              collection,
              id: document.id + ":" + key,
              original: { deptStatus: document.data.deptStatus },
            },
            created_by: null,
          });
        }
      }
    } catch (e) {
      errors.push({ collection, id: document.id, error: (e as Error).message });
    }
  }
for (const row of rows)
  for (const field of catalog[row.kind]?.fields || [])
    if (
      field.type === "relation" &&
      row.data[field.key] &&
      !rows.some(
        (r) => r.id === row.data[field.key] && r.kind === field.resource,
      )
    )
      errors.push({
        collection: row.kind,
        id: row.id,
        error: "Missing relation: " + field.key,
      });
console.log(
  JSON.stringify(
    { mode: apply ? "apply" : "dry-run", records: rows.length, errors },
    null,
    2,
  ),
);
if (errors.length) process.exit(1);
if (apply) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw Error("Set Supabase URL and service role in environment");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const { data: target, error } = await sb
    .from("companies")
    .select("id")
    .eq("id", company)
    .single();
  if (error || !target) throw Error("Target company does not exist");
  // Collection order resolves relation references. Ignore duplicates so reruns never overwrite edited records.
  for (const row of rows) {
    const { error } = await sb
      .from("entities")
      .upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw Error(`Import ${row.kind} failed: ${error.message}`);
  }
  console.log(
    "Import complete. Compare counts and sampled fields against the source export.",
  );
}
