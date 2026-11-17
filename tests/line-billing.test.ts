// อัปเกรดแพ็กเกจใน LINE: package cards with a price button each, the payment card, and the reply after the slip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { billingAction, billingChoice, billingResult, payCard, plansCarousel } from "../src/lib/line-billing";
import { listenPlan } from "../src/lib/line-mention";
import { planPrice, plans } from "../src/lib/billing";

test("package cards: one per paid package, each price is a postback the webhook understands", () => {
  const c = plansCarousel("https://eliteflow-ai.com/workspace/pricing") as { type: string; contents: { contents: { footer: { contents: { action: { type: string; data?: string; label: string } }[] } }[] } };
  assert.equal(c.type, "flex");
  const bubbles = c.contents.contents;
  assert.equal(bubbles.length, plans.length + 1, "a card per package and one to the website");
  for (const b of bubbles.slice(0, plans.length))
    for (const btn of b.footer.contents) {
      assert.ok(btn.action.label.length <= 40, btn.action.label);
      const a = billingAction(btn.action.data!);
      assert.ok(a && a.act === "pick", btn.action.data);
    }
  assert.equal(bubbles.length, (plansCarousel("") as typeof c).contents.contents.length + 1, "no website card without the address");
});

test("only real packages and cycles are accepted; the price is the website's (VAT included)", () => {
  assert.deepEqual(billingAction("bill=pick&p=growth&c=yearly"), { act: "pick", plan: "growth", cycle: "yearly" });
  assert.deepEqual(billingAction("bill=cancel"), { act: "cancel" });
  for (const bad of ["bill=pick&p=free&c=monthly", "bill=pick&p=growth&c=weekly", "bill=pick", "draft=save&id=1", ""]) assert.equal(billingAction(bad), null, bad);
  assert.equal(billingChoice("growth", "monthly").amount, planPrice("growth", "monthly").total);
});

test("payment card: QR when a PromptPay ID is set, else the bank account, else the website", () => {
  const choice = billingChoice("starter", "monthly");
  const json = (x: unknown) => JSON.stringify(x);
  assert.match(json(payCard(choice, { promptPay: "0812345678", bank: "", account: "", name: "EliteFlow" }, { qrUrl: "https://x/api/pay-qr?a=1", pricingUrl: "" })), /"type":"image"/);
  const bank = json(payCard(choice, { promptPay: "", bank: "กสิกร", account: "123-4-56789-0", name: "บจก. อีลีท" }, { qrUrl: "", pricingUrl: "https://x/p" }));
  assert.match(bank, /123-4-56789-0/);
  assert.doesNotMatch(bank, /"type":"image"/);
  assert.match(json(payCard(choice, { promptPay: "", bank: "", account: "", name: "" }, { qrUrl: "", pricingUrl: "" })), /หน้าแพ็กเกจบนเว็บ/);
  assert.match(billingResult({ auto: true, message: "", plan: "growth" }), /เปิดใช้แพ็กเกจ Growth/);
  assert.match(billingResult({ auto: false, message: "ส่งสลิปแล้ว (ยอดไม่ตรง) ทีมงานจะตรวจ", plan: "growth" }), /ยอดไม่ตรง/);
});

test("after picking a package, the member's next photo is the slip; plain chat is ignored", () => {
  const row = { mode: "billing" as const, ingestion_id: null, until: new Date(Date.now() + 60000).toISOString() };
  assert.deepEqual(listenPlan(row, "image"), { act: "billing" });
  assert.deepEqual(listenPlan(row, "file"), { act: "billing" });
  assert.deepEqual(listenPlan(row, "text"), { act: "ignore" });
  assert.deepEqual(listenPlan({ ...row, until: new Date(Date.now() - 1000).toISOString() }, "image"), { act: "ignore" });
});
