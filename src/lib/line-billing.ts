// อัปเกรดแพ็กเกจใน LINE: when a free company records something outside บัญชีและการเงิน the bot sends the packages as
// cards; a tap on a price shows how to pay (PromptPay QR for the exact amount, or the bank account) and the bot waits
// for the slip in the chat. The slip is checked like on the website and, when it matches, the package opens at once.
// Pure helpers here (tested in tests/line-billing.test.ts); the webhook does the rest.
import { planById, planPrice, plans } from "./billing";
import { billingPayee, type Payee } from "./payee";

/** How long the bot waits for the slip after a package was picked. */
export const BILLING_MS = 30 * 60_000;
export type Cycle = "monthly" | "yearly";
export type BillingChoice = { plan: string; cycle: Cycle; amount: number };
const paidIds = plans.map((p) => p.id);

/** "bill=pick&p=growth&c=monthly" (a price on a package card) / "bill=cancel". */
export function billingAction(data: string): { act: "pick"; plan: string; cycle: Cycle } | { act: "cancel" } | null {
  const q = new URLSearchParams(data || "");
  const act = q.get("bill");
  if (act === "cancel") return { act: "cancel" };
  if (act !== "pick") return null;
  const plan = q.get("p") || "",
    cycle = q.get("c") || "";
  if (!paidIds.includes(plan as (typeof paidIds)[number]) || (cycle !== "monthly" && cycle !== "yearly")) return null;
  return { act: "pick", plan, cycle };
}
/** The price to transfer for a package (VAT included), as on the website. */
export function billingChoice(plan: string, cycle: Cycle): BillingChoice {
  return { plan, cycle, amount: planPrice(plan, cycle).total };
}
const baht = (n: number) => "฿" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const tone: Record<string, string> = { starter: "#0ea5e9", growth: "#7c3aed", business: "#db2777", enterprise: "#f59e0b" };
const perks: Record<string, string[]> = {
  starter: ["ปลดล็อก การตลาด · เซลล์ · คลัง · HR", "ผู้ใช้ 5 คน · LINE 3 กลุ่ม", "เอกสาร 2,500 ฉบับ/เดือน"],
  growth: ["ทุกอย่างใน Starter", "ผู้ใช้ 10 คน · LINE 5 กลุ่ม", "เอกสาร 5,000 ฉบับ/เดือน"],
  business: ["ทุกอย่างใน Growth", "ผู้ใช้ 25 คน · LINE 10 กลุ่ม", "เอกสาร 10,000 ฉบับ/เดือน · API"],
  enterprise: ["ทุกอย่างใน Business", "ผู้ใช้และ LINE ไม่จำกัด", "ตั้งค่าให้ + ซัพพอร์ต Exclusive"],
};
const txt = (text: string, extra: Record<string, unknown> = {}) => ({ type: "text", text, wrap: true, ...extra });

/** One card per package with its price per month / per year as buttons, and the full page on the website. */
export function plansCarousel(pricingUrl: string) {
  const bubbles = plans.map((p) => {
    const m = planPrice(p.id, "monthly").total,
      y = planPrice(p.id, "yearly").total,
      c = tone[p.id] || "#7c3aed";
    return {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: c,
        paddingAll: "16px",
        contents: [
          txt(p.id === "growth" ? "⭐ แนะนำ" : "แพ็กเกจ", { size: "xs", color: "#ffffffcc", weight: "bold" }),
          txt(p.name, { size: "xl", color: "#ffffff", weight: "bold" }),
          txt(baht(p.monthly) + " / เดือน", { size: "sm", color: "#ffffff" }),
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: (perks[p.id] || []).map((x) => txt("✓ " + x, { size: "sm", color: "#3b3651" })),
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "button", style: "primary", color: c, height: "sm", action: { type: "postback", label: "รายเดือน " + baht(m), data: `bill=pick&p=${p.id}&c=monthly`, displayText: `เลือก ${p.name} รายเดือน` } },
          { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "รายปี " + baht(y) + " (ลด 2 เดือน)", data: `bill=pick&p=${p.id}&c=yearly`, displayText: `เลือก ${p.name} รายปี` } },
        ],
      },
    };
  });
  if (pricingUrl)
    bubbles.push({
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        justifyContent: "center",
        spacing: "md",
        contents: [txt("ดูรายละเอียดทุกแพ็กเกจ และ Add-on", { weight: "bold", size: "md", align: "center", color: "#2c2550" }), txt("เปรียบเทียบครบบนเว็บ", { size: "sm", align: "center", color: "#8a86a3" })],
      },
      footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: "link", action: { type: "uri", label: "เปิดหน้าแพ็กเกจ", uri: pricingUrl } }] },
    } as never);
  return { type: "flex", altText: "เลือกแพ็กเกจ EliteFlow เพื่อปลดล็อกทุกระบบ", contents: { type: "carousel", contents: bubbles } };
}

export type { Payee };
/** Where to pay: PromptPay QR for the exact amount (when a PromptPay ID is set), else the bank account, else the website. */
export function payCard(choice: BillingChoice, payee: Payee, links: { qrUrl: string; pricingUrl: string }) {
  const p = planById(choice.plan),
    c = tone[p.id] || "#7c3aed",
    cycle = choice.cycle === "yearly" ? "รายปี" : "รายเดือน";
  const how: unknown[] = [];
  if (payee.promptPay && links.qrUrl) {
    how.push({ type: "image", url: links.qrUrl, size: "full", aspectRatio: "1:1", aspectMode: "fit" });
    how.push(txt("สแกนจ่ายด้วยแอปธนาคาร ยอดตรงตามนี้ (พร้อมเพย์" + (payee.name ? " · " + payee.name : "") + ")", { size: "xs", color: "#8a86a3", align: "center" }));
  } else if (payee.account) {
    how.push(txt("โอนเข้าบัญชี", { size: "xs", color: "#8a86a3" }));
    how.push(txt([payee.bank, payee.account].filter(Boolean).join(" "), { size: "lg", weight: "bold", color: "#2c2550" }));
    if (payee.name) how.push(txt("ชื่อบัญชี " + payee.name, { size: "sm", color: "#3b3651" }));
  } else how.push(txt("ดูเลขบัญชีและชำระได้ที่หน้าแพ็กเกจบนเว็บ แล้วส่งสลิปในแชทนี้ได้เลย", { size: "sm", color: "#3b3651" }));
  return {
    type: "flex",
    altText: `ชำระ ${p.name} ${cycle} ${baht(choice.amount)} แล้วส่งรูปสลิปในแชทนี้`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: c,
        paddingAll: "16px",
        contents: [txt("ชำระแพ็กเกจ " + p.name + " · " + cycle, { color: "#ffffff", weight: "bold", size: "md" }), txt(baht(choice.amount), { color: "#ffffff", weight: "bold", size: "xxl" }), txt("รวม VAT 7% แล้ว", { color: "#ffffffcc", size: "xs" })],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          ...how,
          { type: "separator" },
          txt("📸 โอนแล้วส่งรูปสลิปในแชทนี้ได้เลย (ภายใน 30 นาที)", { size: "sm", weight: "bold", color: "#16a34a" }),
          txt("ระบบตรวจยอดและสลิปอัตโนมัติ ถ้าตรง ปลดล็อกทุกระบบทันที", { size: "xs", color: "#8a86a3" }),
        ],
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "ยกเลิก", data: "bill=cancel", displayText: "ยกเลิกการชำระ" } },
          ...(links.pricingUrl ? [{ type: "button", style: "link", height: "sm", action: { type: "uri", label: "ชำระบนเว็บ", uri: links.pricingUrl } }] : []),
        ],
      },
    },
  };
}
/** The bot's answer after the slip: opened, or sent to the team with the reason. */
export function billingResult(r: { auto: boolean; message: string; plan: string }) {
  const name = planById(r.plan).name;
  return r.auto
    ? `🎉 ชำระเงินสำเร็จ เปิดใช้แพ็กเกจ ${name} แล้วค่ะ\nปลดล็อกทุกระบบทันที ส่งข้อความเดิมใหม่ได้เลยนะคะ`
    : `🧾 ${r.message}\n(แพ็กเกจ ${name})`;
}
/** After a package is opened: the invoice and receipt, one tap each. */
export function saleDocsCard(docs: { invoice: string; receipt: string }, nos: { invoiceNo: string; receiptNo: string }) {
  const btn = (label: string, uri: string, primary: boolean) => ({ type: "button", style: primary ? "primary" : "secondary", color: primary ? "#7c3aed" : undefined, height: "sm", action: { type: "uri", label, uri } });
  return {
    type: "flex",
    altText: `ใบแจ้งหนี้ ${nos.invoiceNo} และใบเสร็จรับเงิน ${nos.receiptNo}`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          txt("🧾 เอกสารการชำระเงิน", { weight: "bold", size: "md", color: "#2c2550" }),
          txt(`ใบแจ้งหนี้ ${nos.invoiceNo}\nใบเสร็จรับเงิน ${nos.receiptNo}`, { size: "sm", color: "#3b3651" }),
          txt("บันทึกเป็นค่าใช้จ่ายในระบบบัญชีของบริษัทคุณให้แล้ว", { size: "xs", color: "#16a34a" }),
        ],
      },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: [btn("ใบเสร็จรับเงิน", docs.receipt, true), btn("ใบแจ้งหนี้", docs.invoice, false)] },
    },
  };
}
export const billingPrompt = "เลือกแพ็กเกจที่ต้องการได้เลยค่ะ 👇 กดราคา แล้วส่งสลิปในแชทนี้ ปลดล็อกทันที";
/** The website's address without a trailing slash ("" when not set). */
export const appBase = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
/** The platform's payee (same settings as เติมเหรียญ). */
export const payee = billingPayee;
