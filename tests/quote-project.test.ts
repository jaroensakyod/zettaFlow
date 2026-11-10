// A quotation the customer accepts becomes a project named by its code; the invoice (or sales order) made from it carries
// that project, and the รายรับ / ค่าใช้จ่าย lists show the code in their โปรเจกต์ column.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("accepting a quotation creates its project; the SO and the ledger carry the quotation code", async () => {
  process.env.ELITEFLOW_DEMO_MODE = "true";
  delete process.env.VERCEL;
  process.env.DEMO_DATA_FILE = "quote-project-" + Date.now() + ".json";
  const dir = await mkdtemp(join(tmpdir(), "ef-quote-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const { demoContext } = await import("../src/lib/demo");
    const { saveEntity, allEntities, convertEntity } = await import("../src/lib/data");
    const { ledger } = await import("../src/lib/dept-views");
    const ctx = await demoContext();
    const quotes = await allEntities(ctx, "quotations", 500);
    const q = quotes.find((x) => x.data.status === "ส่งแล้ว")!;
    assert.ok(q, "a sent quotation in the demo data");
    const saved = await saveEntity(ctx, "quotations", { ...q.data, status: "ตอบรับ" }, q.id, q.version);
    // A quotation gets its running code (QT-69-0001…) when saved; the project takes that code.
    const code = String(saved.data.code || saved.data.name);
    const projects = (await allEntities(ctx, "projects", 500)).filter((p) => p.data.code === code);
    assert.equal(projects.length, 1, "one project named by the quotation code");

    // Saving again does not make a second one.
    const again = (await allEntities(ctx, "quotations", 500)).find((x) => x.id === q.id)!;
    await saveEntity(ctx, "quotations", { ...again.data, notes: "เซ็นแล้ว" }, again.id, again.version);
    assert.equal((await allEntities(ctx, "projects", 500)).filter((p) => p.data.code === code).length, 1);

    // Default next step: a sales order, in the quotation's project, once only.
    const so = await convertEntity(ctx, "quotations", q.id);
    assert.equal(so.kind, "sales_orders");
    assert.equal(so.record.data.projectId, projects[0].id, "the order belongs to the quotation's project");
    await assert.rejects(() => convertEntity(ctx, "quotations", q.id, "sales_orders"), /สร้างไปแล้ว/);
    // Or straight to an invoice for work that needs no order.
    const inv = await convertEntity(ctx, "quotations", q.id, "invoices");
    assert.equal(inv.kind, "invoices");
    assert.equal(inv.record.data.projectId, projects[0].id);
    // The รายรับ list shows the quotation code on the unpaid invoice.
    const day = String(inv.record.data.date);
    const rows = (await ledger(ctx, day, day)).income.filter((r) => r.kind === "invoices" && r.id === inv.record.id);
    assert.equal(rows[0]?.project, code);

    // An expense filed to that project shows the quotation code in the list.
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    await saveEntity(ctx, "expenses", { name: "ค่าวัสดุงานลูกค้า", category: "ค่าน้ำมัน/แก๊ส/รถยนต์", date: today, amount: 1000, projectId: projects[0].id, status: "pending" });
    const l = await ledger(ctx, today, today);
    const row = l.expenses.find((e) => e.name === "ค่าวัสดุงานลูกค้า")!;
    assert.equal(row.project, code);
    assert.equal(row.payState, "ยังไม่ชำระ");
  } finally {
    process.chdir(cwd);
  }
});
