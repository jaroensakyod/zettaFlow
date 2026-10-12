import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.mjs";
import { createHash, createHmac } from "node:crypto";
test("complete workflow, persistence, tenant isolation, roles and session revocation", async () => {
  const app = await createApp({ mode: "local", dataFile: ":memory:" });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, method = "GET", body, cookie) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  try {
    assert.equal((await request("/state")).status, 401);
    const owner = await request("/auth", "POST", {
      register: true,
      email: "owner@example.test",
      password: "long-password",
      name: "Owner",
      company: "Company A",
    });
    assert.equal(owner.status, 200);
    const other = await request("/auth", "POST", {
      register: true,
      email: "other@example.test",
      password: "long-password",
      name: "Other",
      company: "Company B",
    });
    assert.notEqual(owner.data.tenantId, other.data.tenantId);
    let ingest = await request(
      "/ingest",
      "POST",
      {
        templateId: "space",
        raw: "โครงการ: The Promenade\nสถานที่: Bangkok\nค่าเช่า: 55,000\nวันเริ่ม: 2026-10-16\nวันสิ้นสุด: 2026-10-28",
      },
      owner.cookie,
    );
    assert.equal(ingest.status, 202);
    await app.work();
    const state = await request("/state", "GET", null, owner.cookie);
    assert.equal(state.data.records.length, 1);
    assert.equal(
      (await request("/jobs/" + ingest.data.jobId, "GET", null, other.cookie))
        .status,
      404,
    );
    assert.equal(
      (await request("/state", "GET", null, other.cookie)).data.records.length,
      0,
    );
    const body = { status: "approved", values: state.data.records[0].values };
    assert.equal(
      (
        await request(
          "/records/" + ingest.data.jobId,
          "PATCH",
          { ...body, dueAt: "2026-02-30" },
          owner.cookie,
        )
      ).status,
      400,
    );
    const updated = {
      ...state.data.templates[0],
      name: "Updated space template",
    };
    assert.equal(
      (await request("/templates/space", "PATCH", updated, owner.cookie))
        .status,
      200,
    );
    assert.equal(
      (await request("/state", "GET", null, owner.cookie)).data.records[0]
        .template.name,
      "อนุมัติพื้นที่ขาย",
    );
    const approvals = await Promise.all([
      request("/records/" + ingest.data.jobId, "PATCH", body, owner.cookie),
      request("/records/" + ingest.data.jobId, "PATCH", body, owner.cookie),
    ]);
    assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await request("/state", "GET", null, owner.cookie)).data.tasks.length,
      5,
    );
    assert.equal(
      (
        await request(
          "/invites",
          "POST",
          {
            email: "viewer@example.test",
            role: "viewer",
            departments: ["Sales"],
          },
          owner.cookie,
        )
      ).status,
      201,
    );
    const viewer = await request("/auth", "POST", {
      register: true,
      email: "viewer@example.test",
      password: "long-password",
      name: "Viewer",
    });
    assert.equal(viewer.data.tenantId, owner.data.tenantId);
    const visible = (await request("/state", "GET", null, viewer.cookie)).data;
    assert.equal(visible.records.length, 0);
    assert.equal(visible.tasks.length, 1);
    assert.equal(
      (await request("/templates", "POST", {}, viewer.cookie)).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/ingest",
          "POST",
          { templateId: "sales", raw: "hello" },
          viewer.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/team", "GET", null, viewer.cookie)).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/tasks/" + visible.tasks[0].id,
          "PATCH",
          { status: "done" },
          viewer.cookie,
        )
      ).status,
      403,
    );
    await request(
      "/team/" + viewer.data.uid,
      "PATCH",
      { disabled: true },
      owner.cookie,
    );
    assert.equal(
      (await request("/state", "GET", null, viewer.cookie)).status,
      403,
    );
    const csrf = await fetch(base + "/api/templates", {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        Origin: "https://attacker.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(csrf.status, 403);
    const privateFile = await fetch(base + "/.env");
    assert.equal(privateFile.status, 404);
    await request("/logout", "POST", null, owner.cookie);
    assert.equal(
      (await request("/state", "GET", null, owner.cookie)).status,
      401,
    );
  } finally {
    await app.close();
  }
});
test("signed LINE webhook routes into one tenant and redelivery does not duplicate records", async () => {
  const prior = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = "test-only-channel";
  const app = await createApp({ mode: "local", dataFile: ":memory:" });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`,
    hash = (s) => createHash("sha256").update(s).digest("hex");
  try {
    const auth = await fetch(base + "/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        register: true,
        email: "line@example.test",
        password: "long-password",
        name: "LINE Owner",
      }),
    });
    const user = await auth.json();
    await app.store.put("groups", hash("test-group"), {
      groupId: "test-group",
      tenantId: user.tenantId,
      ownerUid: user.uid,
      templateId: "sales",
    });
    const raw = JSON.stringify({
      events: [
        {
          type: "message",
          webhookEventId: "test-event",
          source: { groupId: "test-group", userId: "line-user" },
          message: {
            id: "msg",
            type: "text",
            text: "โครงการ: Test\nวันที่: 2026-10-12\nยอดขาย: 58,420",
          },
        },
      ],
    });
    const signature = createHmac("sha256", "test-only-channel")
      .update(raw)
      .digest("base64");
    assert.equal(
      (
        await fetch(base + "/api/line/webhook", {
          method: "POST",
          headers: { "x-line-signature": "wrong" },
          body: raw,
        })
      ).status,
      401,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await fetch(base + "/api/line/webhook", {
            method: "POST",
            headers: { "x-line-signature": signature },
            body: raw,
          })
        ).status,
        200,
      );
    await app.work();
    const state = await app.store.get("tenants", user.tenantId);
    assert.equal(state.records.length, 1);
    assert.equal(state.records[0].values.sales, 58420);
    assert.equal(state.records[0].createdBy, "LINE:line-user");
    assert.equal(state.records[0].status, "review");
    assert.equal((await app.store.list("notifications")).length, 1);
  } finally {
    await app.close();
    if (prior === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = prior;
  }
});
