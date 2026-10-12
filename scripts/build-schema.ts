import { readFile, readdir, writeFile } from "node:fs/promises";
const names = (await readdir("supabase/migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort();
const parts = await Promise.all(
  names.map((n) => readFile("supabase/migrations/" + n, "utf8")),
);
await writeFile(
  "supabase/schema.sql",
  "-- EliteFlow: combined migrations for a NEW Supabase project. Run once.\n" +
    parts.join("\n"),
);
