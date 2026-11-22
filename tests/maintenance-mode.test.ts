// MAINTENANCE_MODE=1 on the old site during the move: saving through /api answers 503 with a Thai message, reading and
// pages still work, and without the flag nothing changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

const req = (path: string, method = "GET") => new NextRequest("https://eliteflow-ai.com" + path, { method });

test("maintenance mode blocks saving through /api, nothing else", async () => {
  const before = { m: process.env.MAINTENANCE_MODE, d: process.env.DATA_BACKEND };
  process.env.DATA_BACKEND = "d1"; // skip the Supabase session refresh in this test
  try {
    process.env.MAINTENANCE_MODE = "1";
    const blocked = await proxy(req("/api/entities", "POST"));
    assert.equal(blocked.status, 503);
    assert.match(((await blocked.json()) as { error: string }).error, /ย้ายไปเซิร์ฟเวอร์ใหม่/);
    assert.equal((await proxy(req("/api/entities", "PATCH"))).status, 503);
    assert.equal((await proxy(req("/api/home"))).status, 200);
    assert.equal((await proxy(req("/workspace/dashboard"))).status, 200);
    delete process.env.MAINTENANCE_MODE;
    assert.equal((await proxy(req("/api/entities", "POST"))).status, 200);
  } finally {
    if (before.m === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = before.m;
    if (before.d === undefined) delete process.env.DATA_BACKEND;
    else process.env.DATA_BACKEND = before.d;
  }
});
