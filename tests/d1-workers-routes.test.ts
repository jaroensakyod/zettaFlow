// The Workers side of the D1 build, run against node:sqlite (no Cloudflare, no real LINE): the Cron Trigger glue
// (src/lib/cf-scheduled.ts → /api/cron with CRON_SECRET, voice files removed through the blob store) and the LINE
// webhook route unchanged on D1 (signature over the raw body, supabaseAdmin() → D1 service client, after() work).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ef-workers-"));
Object.assign(process.env, {
  DATA_BACKEND: "d1",
  D1_FILE: join(dir, "d1.sqlite"),
  D1_BLOBS_DIR: join(dir, "blobs"),
  MAIL_DIR: join(dir, "mail"),
  CRON_SECRET: "cron-secret-test",
  LINE_CHANNEL_SECRET: "line-channel-secret-test",
  LINE_CHANNEL_ACCESS_TOKEN: "line-token-test",
  NEXT_PUBLIC_APP_URL: "http://app.test",
});
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ELITEFLOW_DEMO_MODE"]) delete process.env[k];

// after() needs Next's request scope; the route handlers run inside a minimal one that keeps the tasks.
// (Next's server sets globalThis.AsyncLocalStorage before loading these.)
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
const req = createRequire(import.meta.url);
const { workAsyncStorage } = req("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = req("next/dist/server/app-render/work-unit-async-storage.external.js");
async function inRequest<T>(fn: () => Promise<T>) {
  const tasks: (() => unknown)[] = [];
  const store = { afterContext: { after: (t: unknown) => tasks.push(typeof t === "function" ? (t as () => unknown) : () => t) } };
  const res = await workAsyncStorage.run(store, () => workUnitAsyncStorage.run({ type: "request" }, fn));
  return { res, tasks };
}

// LINE / admin-alert calls are answered here.
const lineCalls: { url: string; body: unknown }[] = [];
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith("https://api.line.me/")) throw new Error("unexpected fetch " + u);
    lineCalls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(u.includes("/reply") ? { sentMessages: [{ id: "m1" }] } : {});
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows: the SQLite file is still open in this process.
  }
});

const sign = (body: string) => createHmac("sha256", process.env.LINE_CHANNEL_SECRET!).update(body).digest("base64");

test("cron schedules map to /api/cron with the CRON_SECRET bearer; failures throw", async () => {
  const { cronRequest, runScheduled, CRONS } = await import("../src/lib/cf-scheduled");
  const r = cronRequest(CRONS.daily, { CRON_SECRET: "s", NEXT_PUBLIC_APP_URL: "https://x.example/" })!;
  assert.equal(r.url, "https://x.example/api/cron");
  assert.equal(r.headers.get("authorization"), "Bearer s");
  assert.equal(cronRequest(CRONS.jobs, {})!.url.endsWith("/api/cron?task=jobs"), true);
  assert.equal(cronRequest(CRONS.jobs, {})!.headers.get("authorization"), null);
  assert.equal(cronRequest("1 2 3 4 5", {}), null);
  await assert.rejects(runScheduled("1 2 3 4 5", {}, async () => new Response("")), /unknown schedule/);
  await assert.rejects(runScheduled(CRONS.daily, {}, async () => Response.json({ error: "Unauthorized" }, { status: 401 })), /401/);
  assert.deepEqual(await runScheduled(CRONS.jobs, { CRON_SECRET: "s" }, async (q) => Response.json({ auth: q.headers.get("authorization") })), { auth: "Bearer s" });
});

test("/api/cron on D1: secret checked, daily run removes 90-day-old voice files from the blob store, ?task=jobs drains", async () => {
  const { GET } = await import("../src/app/api/cron/route");
  const { runScheduled, CRONS } = await import("../src/lib/cf-scheduled");
  const { supabaseAdmin } = await import("../src/lib/supabase/server");
  const { d1Blobs } = await import("../src/lib/d1/runtime");
  const sb = supabaseAdmin();
  const { data: co, error } = await sb.from("companies").insert({ name: "บริษัทคร่อน" }).select("id").single();
  assert.equal(error, null);
  const oldPath = `${co!.id}/Operations/voice-old`,
    newPath = `${co!.id}/Operations/voice-new`;
  const blobs = await d1Blobs();
  await blobs.put(`eliteflow-files/${oldPath}`, new Uint8Array([1, 2, 3]), "audio/m4a");
  await blobs.put(`eliteflow-files/${newPath}`, new Uint8Array([4, 5]), "audio/m4a");
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  for (const [path, at] of [[oldPath, old], [newPath, new Date().toISOString()]])
    assert.equal((await sb.from("attachments").insert({ company_id: co!.id, department: "Operations", name: "voice.m4a", mime: "audio/m4a", size: 3, path, created_at: at })).error, null);

  assert.equal((await GET(new Request("http://app.test/api/cron"))).status, 401);
  assert.equal((await GET(new Request("http://app.test/api/cron", { headers: { authorization: "Bearer wrong" } }))).status, 401);

  const { res } = await inRequest(() => runScheduled(CRONS.daily, { CRON_SECRET: process.env.CRON_SECRET }, (q) => GET(q)));
  assert.ok(res && typeof res === "object" && "jobs" in res && "expired" in res, JSON.stringify(res));
  assert.equal(await blobs.head(`eliteflow-files/${oldPath}`), null);
  assert.ok(await blobs.head(`eliteflow-files/${newPath}`));
  assert.ok(!existsSync(join(dir, "blobs", "eliteflow-files", oldPath)));
  const left = (await sb.from("attachments").select("path")).data!.map((a) => a.path);
  assert.deepEqual(left, [newPath]);

  const jobs = await inRequest(() => runScheduled(CRONS.jobs, { CRON_SECRET: process.env.CRON_SECRET }, (q) => GET(q)));
  assert.deepEqual(Object.keys(jobs.res as object).sort(), ["jobs", "notifications"]);
});

test("LINE webhook on D1: bad signature 401; #connect pairs the group, replies through LINE, queues after() work", async () => {
  const { POST } = await import("../src/app/api/line/webhook/route");
  const { supabaseAdmin } = await import("../src/lib/supabase/server");
  const { tokenHash } = await import("../src/lib/ai");
  const sb = supabaseAdmin();
  const { data: co } = await sb.from("companies").insert({ name: "บริษัทไลน์" }).select("id").single();
  assert.equal((await sb.from("line_pairings").insert({ token_hash: tokenHash("PAIR-123"), company_id: co!.id, department: "Finance", expires_at: new Date(Date.now() + 3600000).toISOString() })).error, null);

  const body = JSON.stringify({
    destination: "Ubot",
    events: [{ type: "message", replyToken: "rt-1", source: { type: "group", groupId: "Cgroup1", userId: "Uowner" }, message: { id: "1", type: "text", text: "#connect PAIR-123" } }],
  });
  const bad = await POST(new Request("http://app.test/api/line/webhook", { method: "POST", body, headers: { "x-line-signature": sign(body + " ") } }));
  assert.equal(bad.status, 401);
  assert.equal((await sb.from("line_groups").select("group_id")).data!.length, 0);

  const { res, tasks } = await inRequest(() => POST(new Request("http://app.test/api/line/webhook", { method: "POST", body, headers: { "x-line-signature": sign(body), "content-type": "application/json" } })));
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), { ok: true });
  const { data: g } = await sb.from("line_groups").select("company_id, department").eq("group_id", "Cgroup1").single();
  assert.deepEqual(g, { company_id: co!.id, department: "Finance" });
  const reply = lineCalls.find((c) => c.url.endsWith("/v2/bot/message/reply"));
  assert.ok(reply, "no LINE reply");
  const r = reply.body as { replyToken: string; messages: { text: string }[] };
  assert.equal(r.replyToken, "rt-1");
  assert.match(r.messages[0].text, /เชื่อมกลุ่มนี้กับ EliteFlow แล้ว/);
  // The code is used up.
  assert.ok((await sb.from("line_pairings").select("used_at").eq("token_hash", tokenHash("PAIR-123")).single()).data!.used_at);

  // after(): burst wait, AI jobs, LINE notifications (ctx.waitUntil on Workers) — runs on D1 without errors.
  assert.equal(tasks.length, 1);
  await tasks[0]();
});
