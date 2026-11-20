import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// cloudflare/d1/0001_schema.sql is generated from supabase/migrations by scripts/d1-schema.ts. A migration that adds a
// table without regenerating it fails here (run: npx tsx scripts/d1-schema.ts).
test("D1 schema loads in SQLite, has every Postgres table, and keeps defaults and checks", () => {
  const sql = readFileSync("cloudflare/d1/0001_schema.sql", "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  const d1 = new Set((db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all() as { name: string }[]).map((r) => r.name));
  const pg = new Set(
    [...readFileSync("supabase/schema.sql", "utf8").matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]),
  );
  for (const t of pg) assert.ok(d1.has(t), `table ${t} is missing from the D1 schema: regenerate it`);

  db.prepare("insert into companies(name) values (?)").run("ทดสอบ");
  const c = db.prepare("select id, settings, created_at from companies").get() as { id: string; settings: string; created_at: string };
  assert.match(c.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(c.settings, "{}");
  assert.match(c.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.throws(() => db.prepare("insert into companies(name, settings) values ('x', 'not json')").run(), /CHECK/);
  assert.throws(() => db.prepare("insert into memberships(company_id,user_id,email,role) values (?,?,?,?)").run(c.id, "u", "a@b.c", "boss"), /CHECK/);
  assert.throws(() => db.prepare("insert into memberships(company_id,user_id,email,role) values (?,?,?,?)").run("missing", "u", "a@b.c", "owner"), /FOREIGN KEY/);
});
