// Drives the Supabase → D1 / R2 copy that runs inside the Worker (src/lib/d1/import-supabase.ts):
//   npx tsx scripts/import-supabase.ts <worker url> [--only tables|users|files|verify]
// The Worker must have the secret IMPORT_TOKEN (32+ characters); the same value is read here from the env var
// IMPORT_TOKEN. Safe to run again: rows are upserted, files overwritten. Remove the secret when done
// (`npx wrangler secret delete IMPORT_TOKEN`) and the endpoint answers 404 again.
export {};
const [base, flag, only] = process.argv.slice(2);
const token = process.env.IMPORT_TOKEN;
if (!base || !token || (flag && flag !== "--only")) {
  console.error("usage: IMPORT_TOKEN=… npx tsx scripts/import-supabase.ts https://<worker> [--only tables|users|files|verify]");
  process.exit(1);
}
const want = (s: string) => !only || only === s;

async function step<T>(body: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(base.replace(/\/$/, "") + "/__import", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as T & { error?: string };
    if (res.ok) return out;
    if (attempt >= 3 || res.status === 404 || res.status === 400) throw new Error(`${JSON.stringify(body)} → ${out.error ?? res.status}`);
    console.warn(`  retry ${attempt}: ${out.error ?? res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

const plan = await step<{ order: string[]; deferred: Record<string, string[]>; buckets: string[] }>({ step: "plan" });

if (want("users")) {
  const u = await step<{ users: number; passwords: number; skipped: unknown[] }>({ step: "users" });
  console.log(`users: ${u.users} people, ${u.passwords} passwords${u.skipped.length ? `, skipped ${JSON.stringify(u.skipped)}` : ""}`);
}

if (want("tables")) {
  for (const table of plan.order) {
    let rows = 0;
    for (let offset = 0; ; ) {
      const r = await step<{ rows: number; done: boolean }>({ step: "table", table, offset });
      rows += r.rows;
      offset += r.rows;
      if (r.done) break;
    }
    console.log(`${table}: ${rows}`);
  }
  for (const [table, cols] of Object.entries(plan.deferred)) {
    let patched = 0;
    for (let offset = 0; ; ) {
      const r = await step<{ rows: number; patched: number; done: boolean }>({ step: "patch", table, offset });
      patched += r.patched;
      offset += r.rows;
      if (r.done) break;
    }
    console.log(`${table} (${cols.join(", ")}): ${patched} links filled in`);
  }
}

if (want("files")) {
  for (const bucket of plan.buckets) {
    const { keys } = await step<{ keys: { path: string; size: number }[] }>({ step: "files", bucket });
    let done = 0;
    // Groups of files up to ~20 MB per request.
    for (let i = 0; i < keys.length; ) {
      const group: string[] = [];
      let size = 0;
      while (i < keys.length && (group.length === 0 || (size + keys[i].size < 20e6 && group.length < 25))) {
        size += keys[i].size;
        group.push(keys[i++].path);
      }
      await step({ step: "file", bucket, paths: group });
      done += group.length;
    }
    console.log(`files ${bucket}: ${done}`);
  }
}

if (want("verify") || !only) {
  const v = await step<{ tables: { table: string; supabase: number; d1: number }[]; users: number; mismatched: { table: string; supabase: number; d1: number }[] }>({ step: "verify" });
  console.log(`verify: ${v.tables.length} tables, ${v.users} users in D1`);
  for (const m of v.mismatched) console.log(`  MISMATCH ${m.table}: supabase ${m.supabase}, d1 ${m.d1}`);
  if (!v.mismatched.length) console.log("  every table matches");
}
