import { test } from "node:test";
import assert from "node:assert/strict";
import { crc16, parseSlipQr, judgeSlip, parseTlv } from "../src/lib/slip";
import { overage, planPrice, subscriptionActive } from "../src/lib/billing";
import { isQuestion, answerQuestion } from "../src/lib/line";
import { hashPassword, verifyPassword, shareState } from "../src/lib/share";
import { arrangeWidgets, computeWidgets, type Widget } from "../src/lib/platform";
import { templateSchema, explicitExtract, validateValues } from "../src/lib/domain";
import type { Template, Ingestion } from "../src/lib/types";

const tlv = (tag: string, v: string) => tag + String(v.length).padStart(2, "0") + v;
function slipPayload(bank = "004", ref = "015123123456ABC1234") {
  const body = tlv("00", tlv("01", "000001") + tlv("02", bank) + tlv("03", ref)) + tlv("51", "TH") + "9104";
  return body + crc16(body);
}
test("slip QR: checksum, parsing and verdicts", () => {
  assert.equal(crc16("123456789"), "29B1");
  const qr = parseSlipQr(slipPayload());
  assert.ok(qr);
  assert.equal(qr.transRef, "015123123456ABC1234");
  assert.equal(qr.bankName, "ธนาคารกสิกรไทย");
  const tampered = slipPayload().replace("ABC", "ABD");
  assert.equal(parseSlipQr(tampered), null);
  assert.equal(parseSlipQr("hello"), null);
  assert.equal(parseTlv("0002"), null);
  assert.equal(judgeSlip(null, 1, 1, false).status, "unreadable");
  assert.equal(judgeSlip(qr, 500, 500, true).status, "duplicate");
  assert.equal(judgeSlip(qr, 499, 500, false).status, "mismatch");
  assert.equal(judgeSlip(qr, 500, 500, false).status, "verified");
  assert.equal(judgeSlip(qr, null, null, false).status, "verified");
});
test("billing: VAT, overage and active status", () => {
  assert.deepEqual(planPrice("growth", "monthly"), { base: 3490, vat: 244.3, total: 3734.3 });
  assert.equal(planPrice("starter", "yearly").base, 11900);
  const o = overage("starter", { workflows: 1, documents: 1200, ocr: 600, ai_runs: 1200, line_groups: 1, users: 1 });
  assert.equal(o.documents, 200);
  assert.equal(o.ocr, 150);
  assert.equal(o.ai_runs, 400);
  assert.equal(o.total, 750);
  assert.equal(overage("enterprise", { workflows: 1, documents: 1e6, ocr: 0, ai_runs: 0, line_groups: 1, users: 1 }).total, 0);
  const now = Date.parse("2026-10-13T00:00:00Z");
  const sub = { plan: "growth" as const, cycle: "monthly" as const, status: "trial" as const, trial_ends_at: "2026-10-20T00:00:00Z", current_period_end: null, addons: [], extra_users: 0 };
  assert.equal(subscriptionActive(sub, now), true);
  assert.equal(subscriptionActive({ ...sub, trial_ends_at: "2026-10-01T00:00:00Z" }, now), false);
  assert.equal(subscriptionActive({ ...sub, status: "active", current_period_end: "2026-10-11T00:00:00Z" }, now), true);
  assert.equal(subscriptionActive({ ...sub, status: "active", current_period_end: "2026-10-01T00:00:00Z" }, now), false);
});
test("LINE: question detection and read-only answers", () => {
  assert.equal(isQuestion("ตอนนี้มีงานที่รออนุมัติทั้งหมดกี่งาน?"), true);
  assert.equal(isQuestion("ถาม ยอดขายวันนี้"), true);
  assert.equal(isQuestion("วันนี้ขายได้ 58,420"), false);
  const stats = { company: "A", review: 12, missing: 2, pendingDeals: 1, openTasks: 5, activeProjects: 3, salesToday: 125000, salesMonth: 900000 };
  assert.match(answerQuestion("มีงานรออนุมัติกี่งาน?", stats), /มี 12 งานรออนุมัติ/);
  assert.match(answerQuestion("ยอดขายวันนี้เท่าไร", stats), /125,000/);
  assert.match(answerQuestion("@zetta", stats), /สรุป A/);
});
test("share links: scrypt passwords and expiry", () => {
  const h = hashPassword("secret1");
  assert.equal(verifyPassword("secret1", h), true);
  assert.equal(verifyPassword("wrong", h), false);
  assert.equal(verifyPassword("anything", null), true);
  const now = Date.now();
  assert.equal(shareState({ expires_at: new Date(now + 1000).toISOString(), revoked_at: null }, now), "ok");
  assert.equal(shareState({ expires_at: new Date(now - 1).toISOString(), revoked_at: null }, now), "expired");
  assert.equal(shareState({ expires_at: new Date(now + 1000).toISOString(), revoked_at: "x" }, now), "revoked");
  assert.equal(shareState(undefined, now), "missing");
});
test("dynamic forms: choice fields, auto widgets, layout and per-widget roles", () => {
  assert.equal(templateSchema.safeParse({ name: "X", department: "Sales", steps: [], fields: [{ key: "car", label: "รถ", type: "choice", required: true }] }).success, false);
  const parsed = templateSchema.parse({ name: "X", department: "Warehouse", steps: [], fields: [
    { key: "car", label: "ประเภทรถ", type: "choice", required: true, options: ["6 ล้อ", "กระบะ"] },
    { key: "qty", label: "จำนวน", type: "number", required: true, options: ["ignored", "x"] },
  ] });
  assert.equal("options" in parsed.fields[1], false);
  const t: Template = { ...parsed, id: "t1", company_id: "c", version: 1 };
  assert.deepEqual(explicitExtract(t, "ประเภทรถ: กระบะ\nจำนวน: 3").values, { car: "กระบะ", qty: 3 });
  assert.deepEqual(explicitExtract(t, "ประเภทรถ: เรือ\nจำนวน: 3").missing, ["ประเภทรถ"]);
  assert.throws(() => validateValues(t, { car: "เรือ", qty: 1 }));
  const ing = (car: string, qty: number) => ({ id: car + qty, template: t, status: "approved", values: { car, qty } }) as unknown as Ingestion;
  const widgets = computeWidgets([t], [ing("กระบะ", 3), ing("กระบะ", 2), ing("6 ล้อ", 1)], () => true);
  assert.deepEqual(widgets.find((w) => w.type === "choice")?.buckets, { กระบะ: 2, "6 ล้อ": 1 });
  assert.equal(widgets.find((w) => w.type === "number")?.total, 6);
  const ws = [{ key: "a" }, { key: "b" }, { key: "c" }] as Widget[];
  const layout = { order: ["c", "a"], hidden: ["b"], roles: { a: ["owner" as const] } };
  assert.deepEqual(arrangeWidgets(ws, layout, "owner").map((w) => w.key), ["c", "a"]);
  assert.deepEqual(arrangeWidgets(ws, layout, "owner", true).map((w) => w.key), ["c", "a", "b"]);
  assert.deepEqual(arrangeWidgets(ws, layout, "manager").map((w) => w.key), ["c"]);
});
