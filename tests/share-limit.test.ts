import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("share_lockout locks after 5 failures and is service-role only", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;");
    await db.exec(await readFile("supabase/migrations/0014_share_rate_limit.sql", "utf8"));
    await db.exec("set role service_role;");
    const lock = async () => (await db.query<{ w: number }>("select share_lockout('T','C')as w")).rows[0].w;
    for (let i = 0; i < 4; i++) await db.query("select share_failed('T','C')");
    assert.equal(await lock(), 0);
    await db.query("select share_failed('T','C')");
    assert.equal(await lock(), 900);
    assert.equal((await db.query<{ w: number }>("select share_lockout('T','D')as w")).rows[0].w, 0);
    await db.exec("reset role;set role authenticated;");
    await assert.rejects(db.query("select share_failed('T','C')"));
  } finally {
    await db.close();
  }
});
