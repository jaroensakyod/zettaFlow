// ใบเสนอราคา page: each quotation's stage (sent → accepted → order → invoice → paid) and its optional project.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("quotation stages follow the documents made from them; a chosen project is kept", async () => {
  process.env.ELITEFLOW_DEMO_MODE = "true";
  delete process.env.VERCEL;
  process.env.DEMO_DATA_FILE = "quotes-" + Date.now() + ".json";
  const cwd = process.cwd();
  process.chdir(await mkdtemp(join(tmpdir(), "ef-quotes-")));
  try {
    const { demoContext } = await import("../src/lib/demo");
    const { quotesList, updateQuote } = await import("../src/lib/quotes");
    const { convertEntity } = await import("../src/lib/data");
    const ctx = await demoContext();
    let d = await quotesList(ctx);
    assert.ok(d.quotes.some((q) => q.stage === "เปิดคำสั่งซื้อแล้ว"), "an accepted quotation with its order");
    const sent = d.quotes.find((q) => q.stage === "ส่งแล้ว")!;
    const project = d.projects[0];
    await updateQuote(ctx, sent.id, { projectId: project.id });
    await updateQuote(ctx, sent.id, { status: "ตอบรับ" });
    d = await quotesList(ctx);
    let q = d.quotes.find((x) => x.id === sent.id)!;
    assert.deepEqual([q.stage, q.projectId], ["ตอบรับ", project.id], "accepted, in the chosen project");
    const so = await convertEntity(ctx, "quotations", q.id);
    assert.equal(so.record.data.projectId, project.id, "the order keeps the quotation's project");
    q = (await quotesList(ctx)).quotes.find((x) => x.id === sent.id)!;
    assert.equal(q.stage, "เปิดคำสั่งซื้อแล้ว");
    await convertEntity(ctx, "sales_orders", so.record.id, "invoices");
    q = (await quotesList(ctx)).quotes.find((x) => x.id === sent.id)!;
    assert.equal(q.stage, "ออกใบแจ้งหนี้แล้ว");
    assert.ok(q.invoice);
    await updateQuote(ctx, sent.id, { projectId: "" });
  } finally {
    process.chdir(cwd);
  }
});
