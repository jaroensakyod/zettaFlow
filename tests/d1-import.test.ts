// The Supabase → D1 / R2 copy (src/lib/d1/import-supabase.ts) against a fake Supabase: values arrive in D1's encoding,
// the attachments ↔ ingestions cycle is closed by the patch pass, re-runs change nothing, people keep their bcrypt
// passwords, files land in the blob store as "<bucket>/<path>", and the endpoint is hidden without IMPORT_TOKEN.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqlite, applyMigrations } from "../src/lib/d1/local";
import { sqliteDriver } from "../src/lib/d1/driver";
import type { BlobStore, BlobInfo } from "../src/lib/d1/blobs";
import { handleImport, importPlan, toD1 } from "../src/lib/d1/import-supabase";

const C = "11111111-1111-4111-8111-111111111111",
  U = "22222222-2222-4222-8222-222222222222",
  E = "33333333-3333-4333-8333-333333333333",
  A = "44444444-4444-4444-8444-444444444444",
  I = "55555555-5555-4555-8555-555555555555",
  M = "66666666-6666-4666-8666-666666666666";
const T = "2026-11-20 08:30:15.123456+00";

const data: Record<string, Record<string, unknown>[]> = {
  companies: [{ id: C, name: "บริษัท ทดสอบ", settings: { adminTeam: [] }, created_at: "2026-11-20T08:30:15.123456+00:00" }],
  memberships: [{ id: M, company_id: C, user_id: U, email: "staff@example.com", name: "สมชาย", role: "staff", departments: ["Sales"], read_departments: [], disabled: false, created_at: T }],
  entities: [{ id: E, company_id: C, kind: "customers", department: "Sales", data: { name: "ลูกค้า A", total: 1250.5 }, created_at: T, updated_at: T }],
  ingestions: [{ id: I, company_id: C, template: { kind: "sales" }, department: "Sales", attachment_id: A, created_at: T }],
  attachments: [{ id: A, company_id: C, department: "Sales", name: "slip.png", mime: "image/png", size: 3, path: `${C}/slip.png`, ingestion_id: I, created_at: T }],
};
const hash = "$2a$10$abcdefghijklmnopqrstuuJ1aEo5ZKz3sEoHq4mI8b4cT6yVJ1Ue6";
const people = [{ id: U, email: "Staff@Example.com", encrypted_password: hash, email_confirmed_at: T, raw_user_meta_data: { full_name: "สมชาย" }, created_at: T, last_sign_in_at: null }];
const files: Record<string, Record<string, Uint8Array>> = { "eliteflow-files": { [`${C}/slip.png`]: new Uint8Array([1, 2, 3]), [`${C}/docs/a.pdf`]: new Uint8Array([4]) } };

/** Just enough of PostgREST, the RPC and Storage for the import. */
const fakeSupabase: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  // A new "sb_secret_" key travels in apikey only (a bearer that is not a JWT is refused, like Supabase does).
  const h = new Headers(init?.headers);
  if (h.get("apikey") !== "sb_secret_test" || h.has("authorization")) return new Response("no", { status: 401 });
  const rest = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
  if (rest && method === "HEAD") return new Response(null, { status: 206, headers: { "content-range": `0-0/${(data[rest[1]] ?? []).length}` } });
  if (rest) {
    const rows = data[rest[1]] ?? [];
    const offset = Number(url.searchParams.get("offset") ?? 0),
      limit = Number(url.searchParams.get("limit") ?? 1000);
    const select = url.searchParams.get("select") ?? "*";
    const pick = (r: Record<string, unknown>) => (select === "*" ? r : Object.fromEntries(select.split(",").map((c) => [c, r[c] ?? null])));
    return Response.json(rows.slice(offset, offset + limit).map(pick));
  }
  if (url.pathname === "/rest/v1/rpc/migration_auth_users") return Response.json(people);
  const list = url.pathname.match(/^\/storage\/v1\/object\/list\/([\w-]+)$/);
  if (list) {
    const { prefix } = JSON.parse(String(init?.body)) as { prefix: string };
    const under = Object.keys(files[list[1]] ?? {}).filter((k) => (prefix ? k.startsWith(prefix + "/") : true)).map((k) => (prefix ? k.slice(prefix.length + 1) : k));
    const names = [...new Set(under.map((k) => k.split("/")[0]))];
    return Response.json(names.map((n) => (under.includes(n) ? { name: n, id: "x", metadata: { size: 1 } } : { name: n, id: null })));
  }
  const obj = url.pathname.match(/^\/storage\/v1\/object\/([\w-]+)\/(.+)$/);
  if (obj) {
    const body = files[obj[1]]?.[obj[2].split("/").map(decodeURIComponent).join("/")];
    return body ? new Response(body as unknown as BodyInit, { headers: { "content-type": "image/png" } }) : new Response("missing", { status: 404 });
  }
  return new Response("?", { status: 404 });
};

function memoryStore(): BlobStore & { map: Map<string, { bytes: Uint8Array; type: string }> } {
  const map = new Map<string, { bytes: Uint8Array; type: string }>();
  const info = (key: string): BlobInfo => ({ key, size: map.get(key)!.bytes.length, contentType: map.get(key)!.type, uploaded: "" });
  return {
    map,
    put: async (key, bytes, type) => void map.set(key, { bytes, type }),
    get: async (key) => (map.has(key) ? { bytes: map.get(key)!.bytes, info: info(key) } : null),
    head: async (key) => (map.has(key) ? info(key) : null),
    delete: async (keys) => keys.forEach((k) => map.delete(k)),
    list: async (prefix) => [...map.keys()].filter((k) => k.startsWith(prefix)).map(info),
  };
}

const TOKEN = "t".repeat(40);
function setup() {
  const db = openSqlite(":memory:");
  applyMigrations(db);
  const sql = sqliteDriver(db);
  const store = memoryStore();
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test", IMPORT_TOKEN: TOKEN };
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeSupabase;
  const call = async (body: Record<string, unknown>, token = TOKEN, e: Record<string, string | undefined> = env) => {
    const res = await handleImport(new Request("https://w.test/__import", { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(body) }), e, async () => sql, async () => store);
    return { status: res.status, body: res.status === 404 ? null : ((await res.json()) as Record<string, unknown>) };
  };
  return { sql, store, call, env, done: () => (globalThis.fetch = realFetch) };
}

async function runAll(call: ReturnType<typeof setup>["call"]) {
  const plan = (await call({ step: "plan" })).body as { order: string[]; deferred: Record<string, string[]> };
  await call({ step: "users" });
  for (const table of plan.order) assert.equal((await call({ step: "table", table })).status, 200, table);
  for (const table of Object.keys(plan.deferred)) assert.equal((await call({ step: "patch", table })).status, 200, table);
}

test("import plan: parents first, the attachments ↔ ingestions cycle waits for one foreign key", () => {
  const { order, deferred } = importPlan();
  assert.ok(order.indexOf("companies") < order.indexOf("entities"));
  assert.ok(order.indexOf("entities") < order.indexOf("attachments"));
  const cyc = Object.keys(deferred);
  assert.equal(cyc.length, 1);
  assert.ok(["attachments", "ingestions"].includes(cyc[0]));
  assert.equal(new Set(order).size, order.length);
});

test("values arrive as D1 stores them: JSON text, 0/1, ISO timestamps", () => {
  assert.equal(toD1("memberships", "departments", ["Sales"]), '["Sales"]');
  assert.equal(toD1("memberships", "disabled", false), 0);
  assert.equal(toD1("entities", "data", { a: 1 }), '{"a":1}');
  assert.equal(toD1("companies", "created_at", "2026-11-20T08:30:15.123456+00:00"), "2026-11-20T08:30:15.123Z");
  assert.equal(toD1("entities", "created_at", T), "2026-11-20T08:30:15.123Z");
  assert.equal(toD1("monthly_goals", "month", "2026-11-01"), "2026-11-01");
});

test("full copy: rows, links, people and files; a second run changes nothing", async () => {
  const { sql, store, call, done } = setup();
  try {
    await runAll(call);
    const ent = (await sql.all<{ data: string; created_at: string }>(`SELECT data, created_at FROM entities`))[0];
    assert.deepEqual(JSON.parse(ent.data), { name: "ลูกค้า A", total: 1250.5 });
    assert.equal(ent.created_at, "2026-11-20T08:30:15.123Z");
    const m = (await sql.all<{ departments: string; disabled: number }>(`SELECT departments, disabled FROM memberships`))[0];
    assert.deepEqual([JSON.parse(m.departments), m.disabled], [["Sales"], 0]);
    // The cycle: both links are there after the patch pass.
    assert.equal((await sql.all<{ v: string }>(`SELECT attachment_id v FROM ingestions`))[0].v, A);
    assert.equal((await sql.all<{ v: string }>(`SELECT ingestion_id v FROM attachments`))[0].v, I);
    const u = (await sql.all<{ email: string; name: string; email_verified: number }>(`SELECT email, name, email_verified FROM users`))[0];
    assert.deepEqual({ ...u }, { email: "staff@example.com", name: "สมชาย", email_verified: 1 });
    assert.equal((await sql.all<{ password: string }>(`SELECT password FROM auth_accounts WHERE user_id = ?`, [U]))[0].password, hash);

    const listed = (await call({ step: "files", bucket: "eliteflow-files" })).body as { keys: { path: string }[] };
    assert.deepEqual(listed.keys.map((k) => k.path).sort(), [`${C}/docs/a.pdf`, `${C}/slip.png`]);
    await call({ step: "file", bucket: "eliteflow-files", paths: listed.keys.map((k) => k.path) });
    assert.deepEqual([...store.map.get(`eliteflow-files/${C}/slip.png`)!.bytes], [1, 2, 3]);

    await runAll(call);
    for (const t of ["companies", "memberships", "entities", "ingestions", "attachments", "users", "auth_accounts"])
      assert.equal((await sql.all<{ n: number }>(`SELECT count(*) n FROM ${t}`))[0].n, 1, t);
    const v = (await call({ step: "verify" })).body as { mismatched: { table: string }[] };
    // Seed tables exist only on the D1 side of this fake Supabase; the copied tables match.
    assert.deepEqual(v.mismatched.filter((x) => Object.keys(data).includes(x.table)), []);
  } finally {
    done();
  }
});

test("a password the person already changed on D1 is not overwritten by a re-run", async () => {
  const { sql, call, done } = setup();
  try {
    await call({ step: "users" });
    await sql.run(`UPDATE auth_accounts SET password = 'scrypt:new' WHERE user_id = ?`, [U]);
    await call({ step: "users" });
    assert.equal((await sql.all<{ password: string }>(`SELECT password FROM auth_accounts WHERE user_id = ?`, [U]))[0].password, "scrypt:new");
  } finally {
    done();
  }
});

test("the endpoint is hidden without the right token, or when the Worker has no IMPORT_TOKEN", async () => {
  const { call, env, done } = setup();
  try {
    assert.equal((await call({ step: "plan" }, "wrong".repeat(10))).status, 404);
    assert.equal((await call({ step: "plan" }, TOKEN, { ...env, IMPORT_TOKEN: undefined })).status, 404);
    assert.equal((await call({ step: "plan" }, "short", { ...env, IMPORT_TOKEN: "short" })).status, 404);
    assert.equal((await call({ step: "nope" })).status, 400);
  } finally {
    done();
  }
});
