// The D1 reports (src/lib/d1/reports.ts) must give exactly what the Postgres functions give: analytics_series,
// dashboard_summary, usage_summary (on a paid plan, during a trial and after the plan lapsed), template_breakdowns,
// template_metrics, calendar_entries, hhmm and dept_th — for the owner and for members who see only some departments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, both, fid, type Who } from "./d1-line-harness";
import { analyticsSeries, calendarEntries, dashboardSummary, deptTh, hhmm, templateBreakdowns, templateMetrics, usageSummary } from "../src/lib/d1/reports";

type Data = Record<string, unknown>;

test("reports on D1 match Postgres", async () => {
  const h = await setup();
  const c = h.company,
    owner = h.ids.owner;
  const now = Date.now();
  const at = (minutes: number) => new Date(now - minutes * 60000).toISOString();
  let n = 0;
  const E = async (kind: string, department: string, data: Data, extra: Data = {}) => {
    n++;
    await h.seedPg("entities", { id: fid(n), company_id: c, kind, department, data, created_by: owner, created_at: at(1000 - n), updated_at: at(1000 - n), ...extra });
  };
  await E("sales", "Sales", { name: "ขาย 1", date: "2026-11-01", amount: 1000, status: "confirmed" });
  await E("sales", "Sales", { name: "ขาย 2", date: "2026-11-02", amount: 500, status: "confirmed" });
  await E("sales", "Sales", { name: "ขาย 3", date: "2026-11-02", amount: 300, status: "draft" });
  await E("sales", "Sales", { name: "ขาย ไม่มีวัน", amount: 50, status: "confirmed" });
  await E("sales", "Sales", { name: "ขาย เก็บแล้ว", date: "2026-11-01", amount: 9999, status: "confirmed" }, { archived_at: at(5) });
  for (let d = 1; d <= 16; d++) await E("sales", "Sales", { name: "ตุลา " + d, date: `2026-10-${String(d).padStart(2, "0")}`, amount: d * 10, status: "confirmed" });
  await E("expenses", "Finance", { name: "ค่าน้ำมัน", code: "EXP-69-9001", date: "2026-11-01", amount: 200, status: "approved" });
  await E("expenses", "Finance", { name: "ค่าที่พัก", code: "EXP-69-9002", date: "2026-11-03", amount: 100, status: "paid" });
  await E("expenses", "Finance", { name: "รออนุมัติ", code: "EXP-69-9003", date: "2026-11-03", amount: 70, status: "pending" });
  await E("projects", "Operations", { name: "บูธ", status: "active", priority: "normal", startDate: "2026-11-05" });
  await E("projects", "Design", { name: "ร้านใหม่", status: "planning", priority: "normal", endDate: "2026-12-01" });
  await E("tasks", "Operations", { name: "ติดตั้ง", department: "Operations", status: "pending", priority: "normal", dueDate: "2026-11-10" });
  await E("tasks", "Operations", { name: "เสร็จแล้ว", department: "Operations", status: "done", priority: "normal", dueDate: "2026-11-11" });
  await E("tasks", "Finance", { name: "ไม่มีสถานะ", department: "Finance", priority: "normal", dueDate: "2026-11-12" });
  await E("deals", "Business Development", { name: "ดีล", location: "สยาม", rent: 1, status: "pending", startDate: "2026-11-15" });
  await E("products", "Warehouse", { name: "ไม้อัด", stock: 2, reorderLevel: 5, status: "active" });
  await E("products", "Warehouse", { name: "ตะปู", stock: 10, reorderLevel: 5, status: "active" });
  await E("events", "Event", { name: "งานแฟร์", date: "2026-11-20" });

  const tA = fid(100),
    tB = fid(101);
  await h.seedPg("data_templates", { id: tA, company_id: c, name: "เบิกเงิน", department: "Finance", fields: [{ key: "kind", label: "ประเภท", type: "choice" }, { key: "amt", label: "ยอด", type: "number" }, { key: "note", label: "หมายเหตุ", type: "text" }], steps: [] });
  await h.seedPg("data_templates", { id: tB, company_id: c, name: "งบการตลาด", department: "Marketing", fields: [{ key: "ch", label: "ช่องทาง", type: "choice" }, { key: "budget", label: "งบ", type: "number" }], steps: [] });
  await h.seedPg("attachments", { id: fid(200), company_id: c, department: "Finance", name: "a.png", mime: "image/png", size: 10, path: `${c}/Finance/${fid(200)}` });
  await h.seedPg("attachments", { id: fid(201), company_id: c, department: "Finance", name: "b.pdf", mime: "application/pdf", size: 10, path: `${c}/Finance/${fid(201)}` });
  const ing = async (k: number, template: string, department: string, status: string, values: Data, extra: Data = {}) =>
    h.seedPg("ingestions", { id: fid(300 + k), company_id: c, template: { id: template }, department, status, values, raw: "", created_at: at(100 - k), ...extra });
  await ing(1, tA, "Finance", "approved", { kind: "เดินทาง", amt: 100 }, { attachment_id: fid(200), pages: 2 });
  await ing(2, tA, "Finance", "approved", { kind: "เดินทาง", amt: 50.5 }, { attachment_id: fid(201), pages: 3 });
  await ing(3, tA, "Finance", "approved", { kind: "อาหาร", amt: "ไม่ใช่ตัวเลข" });
  await ing(4, tA, "Marketing", "approved", { kind: "อาหาร", amt: 7 });
  await ing(5, tA, "Finance", "review", { kind: "อาหาร", amt: 1000 });
  await ing(6, tB, "Marketing", "approved", { ch: "FB", budget: 3000 });
  await h.seedPg("line_groups", { group_id: "Cgroup1", company_id: c, name: "บัญชี", department: "Finance" }, "group_id");

  const who: Who[] = ["owner", "manager", "staff", "viewer"];
  let steps = 0;
  const check = async (name: string, pg: () => Promise<unknown>, d1: () => Promise<unknown>, tidy: (x: unknown) => unknown = (x) => x) => {
    const r = await both(pg, d1);
    steps++;
    if (process.env.SHOW_PARITY) console.log(steps, name, JSON.stringify(r.pg).slice(0, 220));
    assert.deepEqual(tidy(r.d1), tidy(r.pg), name);
  };
  const one = async (w: Who | null, text: string, params: unknown[]) => (await h.pgCall(w, text, params))[0]?.r;
  const sortList = (key: string) => (x: unknown) => {
    const o = x as { ok?: unknown };
    if (!Array.isArray(o.ok)) return x;
    return { ok: [...o.ok].sort((a, b) => (JSON.stringify((a as Data)[key]) < JSON.stringify((b as Data)[key]) ? -1 : 1)) };
  };
  for (const w of who) {
    await check(`${w} analytics_series`, () => one(w, "select analytics_series($1) r", [c]), () => analyticsSeries(h.tenant(w)));
    await check(
      `${w} dashboard_summary`,
      () => one(w, "select dashboard_summary($1) r", [c]),
      () => dashboardSummary(h.tenant(w)),
      (x) => {
        const o = (x as { ok?: Data }).ok;
        return o ? { ...o, lowStock: [...(o.lowStock as Data[])].sort((a, b) => String(a.id).localeCompare(String(b.id))) } : x;
      },
    );
    await check(`${w} template_breakdowns`, () => one(w, "select template_breakdowns($1) r", [c]), () => templateBreakdowns(h.tenant(w)), sortList("key"));
    await check(`${w} template_metrics`, () => one(w, "select template_metrics($1) r", [c]), () => templateMetrics(h.tenant(w)), sortList("key"));
    for (const m of ["2026-11", "2026-12", "2026-13", "11-2026"])
      await check(
        `${w} calendar_entries ${m}`,
        async () => (await h.pgCall(w, "select to_jsonb(e) r from calendar_entries($1,$2) e", [c, m])).map((x) => x.r),
        () => calendarEntries(h.tenant(w), m),
      );
    await check(`${w} usage_summary (business)`, () => one(w, "select usage_summary($1) r", [c]), () => usageSummary(h.tenant(w)));
  }
  // A trial, then a paid plan that lapsed (shown as free).
  const trialEnd = new Date(now + 5 * 86400000).toISOString();
  await h.login(null);
  await h.db.query("update subscriptions set status='trial',trial_ends_at=$2 where company_id=$1", [c, trialEnd]);
  h.lite.prepare("update subscriptions set status='trial',trial_ends_at=? where company_id=?").run(trialEnd, c);
  await check("usage_summary (trial)", () => one("owner", "select usage_summary($1) r", [c]), () => usageSummary(h.tenant("owner")));
  const lapsed = new Date(now - 10 * 86400000).toISOString();
  await h.db.query("update subscriptions set status='active',plan='growth',current_period_end=$2,trial_ends_at=$2 where company_id=$1", [c, lapsed]);
  h.lite.prepare("update subscriptions set status='active',plan='growth',current_period_end=?,trial_ends_at=? where company_id=?").run(lapsed, lapsed, c);
  await check("usage_summary (lapsed → free)", () => one("owner", "select usage_summary($1) r", [c]), () => usageSummary(h.tenant("owner")));
  await check("usage_summary (lapsed, staff)", () => one("staff", "select usage_summary($1) r", [c]), () => usageSummary(h.tenant("staff")));

  for (const t of ["09:30", "9:05", "24:00", "930", "", "ab:cd"]) await check(`hhmm ${t}`, () => one(null, "select hhmm($1) r", [t]), async () => hhmm(t));
  await check("hhmm null", () => one(null, "select hhmm(null) r", []), async () => hhmm(null));
  for (const d of ["Finance", "Business Development", "Customer Service", "Unknown"]) await check(`dept_th ${d}`, () => one(null, "select dept_th($1) r", [d]), async () => deptTh(d));
  await check("dept_th null", () => one(null, "select dept_th(null) r", []), async () => deptTh(null));
  if (process.env.SHOW_PARITY) console.log("steps:", steps);
  await h.db.close();
});
