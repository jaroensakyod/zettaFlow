// คำสั่งซื้อ: an order sold on a platform with a package; recording its payment marks it paid with who / when / how and
// books the income once, which the รายรับ list then shows under the order's number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("recording an order's payment marks it paid and adds the income once", async () => {
  process.env.ELITEFLOW_DEMO_MODE = "true";
  delete process.env.VERCEL;
  process.env.DEMO_DATA_FILE = "orders-" + Date.now() + ".json";
  const cwd = process.cwd();
  process.chdir(await mkdtemp(join(tmpdir(), "ef-orders-")));
  try {
    const { demoContext } = await import("../src/lib/demo");
    const { ordersList, recordOrderPayment, setOrderWaiting } = await import("../src/lib/orders");
    const { ledger } = await import("../src/lib/dept-views");
    const ctx = await demoContext();
    const data = await ordersList(ctx);
    assert.ok(data.platforms.length >= 3 && data.packages.length >= 3, "demo platforms and packages");
    const o = data.orders.find((x) => x.payState === "ยังไม่ชำระ" && x.platform && x.package)!;
    assert.ok(o, "an unpaid platform order");
    assert.ok(o.total > 0);

    await setOrderWaiting(ctx, o.id, { payStatus: "รอชำระ" });
    assert.equal((await ordersList(ctx)).orders.find((x) => x.id === o.id)!.payState, "รอชำระ");

    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const r = await recordOrderPayment(ctx, o.id, { payerName: "คุณสมชาย", paidAt: today, payMethod: "พร้อมเพย์", payReference: "PP-123" });
    assert.equal(r.payment.data.direction, "income");
    assert.equal(r.payment.data.amount, o.total);
    const after = (await ordersList(ctx)).orders.find((x) => x.id === o.id)!;
    assert.deepEqual([after.payState, after.payerName, after.paidAt, after.payMethod, after.payReference], ["ชำระแล้ว", "คุณสมชาย", today, "พร้อมเพย์", "PP-123"]);
    await assert.rejects(() => recordOrderPayment(ctx, o.id, { payerName: "x", paidAt: today, payMethod: "เงินสด" }), /ไปแล้ว/);
    await assert.rejects(() => setOrderWaiting(ctx, o.id, { payStatus: "รอชำระ" }), /ชำระแล้ว/);

    const row = (await ledger(ctx, today, today)).income.find((x) => x.id === r.payment.id)!;
    assert.equal(row.docNo, after.code, "รายรับ shows the order number");
    assert.equal(row.payState, "ชำระแล้ว");
  } finally {
    process.chdir(cwd);
  }
});
