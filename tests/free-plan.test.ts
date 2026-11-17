// แพ็กเกจฟรี: only บัญชีและการเงิน (and the customers / suppliers it needs) can be saved; anything else is refused
// with an upgrade error the web turns into the upgrade dialog. A paid package saves everything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("free package saves only accounting; other pages ask for an upgrade; a paid package saves them", async () => {
  process.env.ELITEFLOW_DEMO_MODE = "true";
  delete process.env.VERCEL;
  process.env.DEMO_DATA_FILE = "free-plan-" + Date.now() + ".json";
  const dir = await mkdtemp(join(tmpdir(), "ef-free-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const { demoContext, demoMutate } = await import("../src/lib/demo");
    const { saveEntity } = await import("../src/lib/data");
    const ctx = await demoContext();
    const setPlan = (plan: string, status: string) =>
      demoMutate((s) => {
        (s as unknown as { subscription: unknown }).subscription = { plan, cycle: "monthly", status, trial_ends_at: new Date(Date.now() + 86400000).toISOString(), current_period_end: null, addons: [], extra_users: 0 };
      });
    await setPlan("free", "active");
    await assert.rejects(
      () => saveEntity(ctx, "employees", { name: "สมชาย", status: "active" }),
      (e: Error & { status?: number; upgrade?: boolean }) => e.status === 402 && e.upgrade === true && /แพ็กเกจ/.test(e.message),
    );
    // a trial is not a paid package either
    await setPlan("growth", "trial");
    await assert.rejects(() => saveEntity(ctx, "leaves", { name: "ลาป่วย" }), /แพ็กเกจ/);
    // accounting and its contacts still save
    const c = await saveEntity(ctx, "customers", { name: "ลูกค้าทดสอบ", status: "active" });
    assert.ok(c.id);
    // paid: everything
    await setPlan("growth", "active");
    const e = await saveEntity(ctx, "employees", { name: "สมชาย", status: "active", department: "ฝ่ายขาย", employmentType: "ประจำ" });
    assert.ok(e.id);
  } finally {
    process.chdir(cwd);
  }
});
