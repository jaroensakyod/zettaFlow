// The D1 port of the deal room (src/lib/d1/network-deals.ts) must behave exactly like the Postgres b2b_deal_*
// functions: request → quotation revisions → decision, then progress, delivery and acceptance, instalment invoices,
// payments with withholding tax, receipts, closing, withdrawing and cancelling — the cards, the chat lines, the deal
// stages and the records each company gets in its own books (with their running codes), or the exact error.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as chat from "../src/lib/d1/network-chat";
import * as deals from "../src/lib/d1/network-deals";
import { json, labeller, runSteps, sameRows, setup, type D1Fns, type Refs, type Step } from "./d1-network-harness";

const NOPE = "20000000-0000-4000-8000-000000000099";
const SUPPLIER = "30000000-0000-4000-8000-0000000000aa";
const TASK = "30000000-0000-4000-8000-0000000000bb";

const d1: D1Fns = {
  b2b_open: chat.b2bOpen,
  b2b_read: chat.b2bRead,
  b2b_inbox: chat.b2bInbox,
  b2b_items: (_t, items, priced) => deals.b2bItems(items, priced),
  b2b_installments: (_t, p) => deals.b2bInstallments(p),
  b2b_installment_amount: (_t, q, i) => deals.b2bInstallmentAmount(q, i),
  b2b_bkk_today: () => deals.b2bBkkToday(),
  b2b_party: deals.b2bParty,
  b2b_accepted_quote: deals.b2bAcceptedQuote,
  b2b_deal_fully_paid: deals.b2bDealFullyPaid,
  b2b_deal_request: deals.b2bDealRequest,
  b2b_deal_quote: deals.b2bDealQuote,
  b2b_deal_decide: deals.b2bDealDecide,
  b2b_deal_withdraw: deals.b2bDealWithdraw,
  b2b_deals_of: deals.b2bDealsOf,
  b2b_deal_take: deals.b2bDealTake,
  b2b_deal_progress: deals.b2bDealProgress,
  b2b_deal_deliver: deals.b2bDealDeliver,
  b2b_deal_check: deals.b2bDealCheck,
  b2b_deal_invoice: deals.b2bDealInvoice,
  b2b_deal_pay: deals.b2bDealPay,
  b2b_deal_receive: deals.b2bDealReceive,
  b2b_deal_cancel: deals.b2bDealCancel,
  b2b_deal_cancel_answer: deals.b2bDealCancelAnswer,
};

test("b2b_deal_* on D1 match Postgres step for step", async () => {
  const h = await setup();
  try {
    const { A } = h.company;
    const T = (r: Refs) => r("T");
    const deal = (name: string) => (r: Refs) => r(name).deal_id;
    const card = (name: string) => (r: Refs) => r(name).id;
    /** The id of the last card of a kind in a deal, from a b2b_deals_of result saved as `dealsName`. */
    const lastCard = (dealsName: string, i: number, kind: string) => (r: Refs) => (r(dealsName)[i].cards as { id: string; kind: string }[]).filter((c) => c.kind === kind).pop()!.id;
    const items = [{ name: "บูธ 3x6 ม.", qty: 1, unit: "งาน", price: 110000 }, { name: "ป้ายไวนิล", qty: 10, unit: "แผ่น", price: 1500 }];
    const steps: Step[] = [
      // A supplier Alice already has for Bob (matched by name), and the conversation.
      { as: "alice", fn: "raw", raw: { pg: `insert into entities(id,company_id,kind,department,data) values ($1,$2,'suppliers','Purchasing','{"name":" bob booth studio ","code":"SUP-OLD"}')`, d1: `insert into entities(id,company_id,kind,department,data) values (?,?,'suppliers','Purchasing','{"name":" bob booth studio ","code":"SUP-OLD"}')` }, args: () => [SUPPLIER, A] },
      { as: "bob", fn: "b2b_open", save: "T", args: () => [A, null] },
      { as: "carol", fn: "b2b_open", save: "T2", args: () => [A, null] },
      // Helpers.
      { as: "bob", fn: "b2b_items", admin: true, self: false, args: () => [json([{ name: " a ", qty: "2", unit: " ชิ้น ", price: 10.005 }, { name: "  " }, "x", { name: "b" }]), true] },
      { as: "bob", fn: "b2b_items", admin: true, self: false, args: () => [json([{ name: "a" }]), false] },
      { as: "bob", fn: "b2b_items", admin: true, self: false, args: () => [null, false] },
      { as: "bob", fn: "b2b_items", admin: true, self: false, args: () => [json([{ name: "  " }]), false] },
      { as: "bob", fn: "b2b_items", admin: true, self: false, args: () => [json([{ name: "a", qty: 0 }]), false] },
      { as: "bob", fn: "b2b_items", admin: true, self: false, args: () => [json([{ name: "a", qty: "abc" }]), false] },
      { as: "bob", fn: "b2b_items", admin: true, self: false, args: () => [json([{ name: "a", price: -1 }]), true] },
      { as: "bob", fn: "b2b_items", admin: true, self: false, args: () => [json(Array.from({ length: 101 }, (_, i) => ({ name: "x" + i }))), false] },
      { as: "bob", fn: "b2b_installments", admin: true, self: false, args: () => [null] },
      { as: "bob", fn: "b2b_installments", admin: true, self: false, args: () => [json([{ label: " มัดจำ ", percent: 30 }, { percent: "70" }])] },
      { as: "bob", fn: "b2b_installments", admin: true, self: false, args: () => [json([{ percent: 30 }])] },
      { as: "bob", fn: "b2b_installments", admin: true, self: false, args: () => [json([{ percent: 0 }, { percent: 100 }])] },
      { as: "bob", fn: "b2b_installments", admin: true, self: false, args: () => [json(Array.from({ length: 7 }, () => ({ percent: 10 })))] },
      { as: "bob", fn: "b2b_installments", admin: true, self: false, args: () => [json([{ percent: 33.33 }, { percent: 33.33 }, { percent: 33.34 }])] },
      { as: "bob", fn: "b2b_installment_amount", admin: true, self: false, args: () => [{ total: 107000.01, vat: 7000.01, installments: [{ percent: 33.33 }, { percent: 33.33 }, { percent: 33.34 }] }, 0] },
      { as: "bob", fn: "b2b_installment_amount", admin: true, self: false, args: () => [{ total: 107000.01, vat: 7000.01, installments: [{ percent: 33.33 }, { percent: 33.33 }, { percent: 33.34 }] }, 2] },
      { as: "bob", fn: "b2b_installment_amount", admin: true, self: false, args: () => [{ total: 5000 }, 1] },
      { as: "bob", fn: "b2b_bkk_today", admin: true, self: false, pgSql: "select b2b_bkk_today()::text as b2b_bkk_today" },
      { as: "bob", fn: "b2b_party", admin: true, self: false, args: () => [h.company.B] },
      { as: "bob", fn: "b2b_party", admin: true, self: false, args: () => [h.company.C] },

      // 1. Alice (buyer) asks for a quotation.
      { as: "vic", fn: "b2b_deal_request", args: (r) => [T(r), "x", { items: [{ name: "a" }] }] },
      { as: "carol", fn: "b2b_deal_request", args: (r) => [T(r), "x", { items: [{ name: "a" }] }] },
      { as: "alice", fn: "b2b_deal_request", args: (r) => [T(r), "  ", {}] },
      { as: "alice", fn: "b2b_deal_request", args: (r) => [T(r), "x", { items: [] }] },
      { as: "alice", fn: "b2b_deal_request", args: (r) => [T(r), "x", { items: [{ name: "a" }], budget: -1 }] },
      { as: "alice", fn: "b2b_deal_request", args: (r) => [T(r), "x", { items: [{ name: "a" }], needBy: "พรุ่งนี้" }] },
      { as: "alice", fn: "b2b_deal_request", save: "RFQ", args: (r) => [T(r), " บูธงาน Bangkok Expo ", { items: [{ name: "บูธ 3x6 ม.", qty: 1, unit: "งาน" }, { name: "ป้ายไวนิล", qty: 10, unit: "แผ่น" }, { name: "  " }], needBy: "2026-12-20", budget: "150000", notes: "ส่งแบบ 3D ด้วย" }] },
      { as: "alice", fn: "b2b_deal_quote", args: (r) => [T(r), deal("RFQ")(r), "x", { items: [{ name: "a", price: 1 }] }] },
      // 2. Bob (seller) quotes it; every refusal first.
      { as: "bob", fn: "b2b_deals_of", args: (r) => [T(r)] },
      // Taking over a side (b2b_deal_take): refusals, then Bob takes the contractor's side before any project exists.
      { as: "vic", fn: "b2b_deal_take", args: (r) => [deal("RFQ")(r)] },
      { as: "alice", fn: "b2b_deal_take", args: () => [NOPE] },
      { as: "carol", fn: "b2b_deal_take", args: (r) => [deal("RFQ")(r)] },
      { as: "bob", fn: "b2b_deal_take", args: (r) => [deal("RFQ")(r)] },
      { as: "alice", fn: "b2b_deals_of", args: (r) => [T(r)] },
      { as: "bob", fn: "b2b_deal_quote", args: (r) => [T(r), deal("RFQ")(r), "  ", { items }] },
      { as: "bob", fn: "b2b_deal_quote", args: (r) => [T(r), NOPE, "x", { items }] },
      { as: "bob", fn: "b2b_deal_quote", args: (r) => [T(r), deal("RFQ")(r), "x", { items, validUntil: "2020-01-01" }] },
      { as: "bob", fn: "b2b_deal_quote", args: (r) => [T(r), deal("RFQ")(r), "x", { items, discount: 999999 }] },
      { as: "bob", fn: "b2b_deal_quote", args: (r) => [T(r), deal("RFQ")(r), "x", { items: [{ name: "a", qty: -1, price: 1 }] }] },
      { as: "bob", fn: "b2b_deal_quote", args: (r) => [T(r), deal("RFQ")(r), "x", { items, vatMode: "half" }] },
      { as: "bob", fn: "b2b_deal_quote", args: (r) => [T(r), deal("RFQ")(r), "x", { items, installments: [{ label: "มัดจำ", percent: 30 }] }] },
      { as: "carol", fn: "b2b_deal_quote", args: (r) => [T(r), deal("RFQ")(r), "x", { items }] },
      { as: "bob", fn: "b2b_deal_quote", save: "Q1", args: (r) => [T(r), deal("RFQ")(r), "บูธงาน Bangkok Expo", { items: [{ ...items[0], price: 120000 }, items[1]], discount: 5000, vatMode: "excluded", validUntil: "2099-01-31", deliverBy: "2026-12-18", payTerms: "มัดจำ 50%" }] },
      { as: "bob", fn: "b2b_deal_decide", args: (r) => [card("Q1")(r), "accept", null] },
      // 3. Alice asks for a change.
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("RFQ")(r), "accept", null] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [NOPE, "accept", null] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("Q1")(r), "maybe", null] },
      { as: "amy", fn: "b2b_deal_decide", args: (r) => [card("Q1")(r), "accept", null] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("Q1")(r), "change", " "] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("Q1")(r), "change", " ขอลดราคาบูธเหลือ 110,000 "] },
      // 4. Rev.2 with instalments replaces Rev.1.
      { as: "bob", fn: "b2b_deal_quote", save: "Q2", args: (r) => [T(r), deal("RFQ")(r), "บูธงาน Bangkok Expo", { items, vatMode: "excluded", validUntil: "2099-01-31", deliverBy: "2026-12-18", installments: [{ label: "มัดจำ", percent: 30 }, { label: "ส่วนที่เหลือ", percent: 70 }], notes: "ราคารวมติดตั้ง" }] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("Q1")(r), "accept", null] },
      { as: "carol", fn: "b2b_deal_decide", args: (r) => [card("Q2")(r), "accept", null] },
      { as: "alice", fn: "b2b_deals_of", args: (r) => [T(r)] },
      // An expired quotation cannot be accepted.
      { as: "alice", fn: "raw", raw: { pg: `update b2b_cards set data=data||'{"validUntil":"2020-01-01"}' where id=$1`, d1: `update b2b_cards set data=json_set(data,'$.validUntil','2020-01-01') where id=?` }, args: (r) => [card("Q2")(r)] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("Q2")(r), "accept", null] },
      { as: "alice", fn: "raw", raw: { pg: `update b2b_cards set data=data||'{"validUntil":"2099-01-31"}' where id=$1`, d1: `update b2b_cards set data=json_set(data,'$.validUntil','2099-01-31') where id=?` }, args: (r) => [card("Q2")(r)] },
      // 5. Alice accepts Rev.2: customer, project, quotation for Bob; supplier (existing) and a project for the work for Alice.
      { as: "alice", fn: "b2b_deal_decide", save: "ACC", args: (r) => [card("Q2")(r), "accept", null] },
      { as: "alice", fn: "b2b_deals_of", args: (r) => [T(r)] },
      { as: "bob", fn: "b2b_deals_of", args: (r) => [T(r)] },
      // Amy takes over the hiring side: her name goes on Alice's project for the work.
      { as: "amy", fn: "b2b_deal_take", args: (r) => [deal("Q2")(r)] },
      { as: "amy", fn: "b2b_deals_of", args: (r) => [T(r)] },
      { as: "alice", fn: "b2b_deals_of", args: (r) => [T(r)] },
      { as: "bob", fn: "b2b_accepted_quote", admin: true, self: false, args: (r) => [deal("Q2")(r)] },
      { as: "bob", fn: "b2b_deal_fully_paid", admin: true, self: false, args: (r) => [deal("Q2")(r)] },
      // 6. The deal is agreed: no new quotation, no withdrawal, no second decision.
      { as: "bob", fn: "b2b_deal_quote", args: (r) => [T(r), deal("RFQ")(r), "x", { items }] },
      { as: "bob", fn: "b2b_deal_withdraw", args: (r) => [card("Q2")(r), null] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("Q2")(r), "reject", "x"] },

      // Phase 2 on the agreed deal: progress.
      { as: "bob", fn: "b2b_deal_progress", args: () => [NOPE, 10, "x"] },
      { as: "carol", fn: "b2b_deal_progress", args: (r) => [deal("Q2")(r), 10, "x"] },
      { as: "alice", fn: "b2b_deal_progress", args: (r) => [deal("Q2")(r), 10, "x"] },
      { as: "bob", fn: "b2b_deal_progress", args: (r) => [deal("Q2")(r), 120, "x"] },
      { as: "bob", fn: "b2b_deal_progress", args: (r) => [deal("Q2")(r), null, "x"] },
      { as: "bob", fn: "b2b_deal_progress", args: (r) => [deal("Q2")(r), 10, "  "] },
      { as: "bob", fn: "b2b_deal_progress", args: (r) => [deal("Q2")(r), 40, " ขึ้นโครงบูธแล้ว "] },
      // Deposit invoice; the final one only after acceptance.
      { as: "alice", fn: "b2b_deal_invoice", args: (r) => [deal("Q2")(r), 0, null] },
      { as: "bob", fn: "b2b_deal_invoice", args: (r) => [deal("Q2")(r), 5, null] },
      { as: "bob", fn: "b2b_deal_invoice", args: (r) => [deal("Q2")(r), 1, null] },
      { as: "bob", fn: "b2b_deal_invoice", args: (r) => [deal("Q2")(r), 0, "2020-01-01"] },
      { as: "bob", fn: "b2b_deal_invoice", save: "IV1", args: (r) => [deal("Q2")(r), 0, "2099-02-01"] },
      { as: "bob", fn: "b2b_deal_invoice", args: (r) => [deal("Q2")(r), 0, null] },
      // The buyer reports paying, with withholding tax.
      { as: "alice", fn: "b2b_deal_pay", args: () => [NOPE, {}] },
      { as: "alice", fn: "b2b_deal_pay", args: (r) => [card("Q2")(r), {}] },
      { as: "bob", fn: "b2b_deal_pay", args: (r) => [card("IV1")(r), {}] },
      { as: "alice", fn: "b2b_deal_pay", args: (r) => [card("IV1")(r), { whtRate: 4 }] },
      { as: "alice", fn: "b2b_deal_pay", args: (r) => [card("IV1")(r), { date: "2099-01-01" }] },
      { as: "alice", fn: "b2b_deal_pay", args: (r) => [card("IV1")(r), { method: "เช็ค" }] },
      { as: "alice", fn: "b2b_deal_pay", save: "PAY1", args: (r) => [card("IV1")(r), { whtRate: 3, method: "โอนธนาคาร", reference: "KBank 123", date: "2026-11-10", notes: "โอนแล้วค่ะ" }] },
      { as: "alice", fn: "b2b_deal_pay", args: (r) => [card("IV1")(r), {}] },
      // The seller first says the money is not there, then confirms the second report.
      { as: "alice", fn: "b2b_deal_receive", args: (r) => [card("PAY1")(r), true, null] },
      { as: "bob", fn: "b2b_deal_receive", args: () => [NOPE, true, null] },
      { as: "bob", fn: "b2b_deal_receive", args: (r) => [card("PAY1")(r), false, " "] },
      { as: "bob", fn: "b2b_deal_receive", args: (r) => [card("PAY1")(r), false, " ยอดยังไม่เข้าบัญชี "] },
      { as: "bob", fn: "b2b_deal_receive", args: (r) => [card("PAY1")(r), true, null] },
      { as: "alice", fn: "b2b_deal_pay", save: "PAY2", args: (r) => [card("IV1")(r), { whtRate: "3", reference: "KBank 124" }] },
      { as: "bob", fn: "b2b_deal_receive", save: "RC1", args: (r) => [card("PAY2")(r), true, null] },
      { as: "alice", fn: "b2b_deal_pay", args: (r) => [card("IV1")(r), {}] },
      // Delivery → a fix → delivered again → accepted.
      { as: "alice", fn: "b2b_deal_deliver", args: (r) => [deal("Q2")(r), "x"] },
      { as: "bob", fn: "b2b_deal_deliver", args: (r) => [deal("Q2")(r), " ติดตั้งเสร็จแล้ว "] },
      { as: "bob", fn: "b2b_deal_progress", args: (r) => [deal("Q2")(r), 90, "x"] },
      { as: "bob", fn: "b2b_deal_deliver", args: (r) => [deal("Q2")(r), null] },
      { as: "alice", fn: "b2b_deals_of", save: "DL1", args: (r) => [T(r)] },
      { as: "alice", fn: "b2b_deal_check", args: (r) => [card("IV1")(r), true, null] },
      { as: "bob", fn: "b2b_deal_check", args: (r) => [lastCard("DL1", 0, "delivery")(r), true, null] },
      { as: "alice", fn: "b2b_deal_check", args: (r) => [lastCard("DL1", 0, "delivery")(r), false, ""] },
      { as: "alice", fn: "b2b_deal_check", args: (r) => [lastCard("DL1", 0, "delivery")(r), false, "ป้ายด้านข้างสีเพี้ยน"] },
      { as: "alice", fn: "b2b_deal_check", args: (r) => [lastCard("DL1", 0, "delivery")(r), true, null] },
      { as: "bob", fn: "b2b_deal_deliver", args: (r) => [deal("Q2")(r), "เปลี่ยนป้ายให้แล้ว"] },
      { as: "alice", fn: "b2b_deals_of", save: "DL2", args: (r) => [T(r)] },
      { as: "alice", fn: "b2b_deal_check", args: (r) => [lastCard("DL2", 0, "delivery")(r), true, null] },
      // The final invoice, paid without withholding tax: the deal closes.
      { as: "bob", fn: "b2b_deal_invoice", save: "IV2", args: (r) => [deal("Q2")(r), 1, null] },
      { as: "alice", fn: "b2b_deal_pay", save: "PAY3", args: (r) => [card("IV2")(r), { whtRate: 0 }] },
      { as: "bob", fn: "b2b_deal_fully_paid", admin: true, self: false, args: (r) => [deal("Q2")(r)] },
      { as: "bob", fn: "b2b_deal_receive", args: (r) => [card("PAY3")(r), true, null] },
      { as: "bob", fn: "b2b_deal_fully_paid", admin: true, self: false, args: (r) => [deal("Q2")(r)] },
      { as: "alice", fn: "b2b_deal_cancel", args: (r) => [deal("Q2")(r), "เปลี่ยนใจ"] },
      { as: "alice", fn: "b2b_deals_of", args: (r) => [T(r)] },

      // A second deal (no request): accepted, paid in part, then cancelled with both sides' consent.
      { as: "bob", fn: "b2b_deal_quote", save: "Q3", args: (r) => [T(r), null, "งานป้าย", { items: [{ name: "ป้าย", price: 5000 }], vatMode: "none", validUntil: "2099-01-01", installments: [{ percent: 30 }, { percent: 30 }, { percent: 40 }] }] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("Q3")(r), "accept", null] },
      // A deal accepted before 0083 points at a task, not a project: taking it over leaves the task alone, cancelling closes it.
      { as: "alice", fn: "raw", raw: { pg: `insert into entities(id,company_id,kind,department,data) values ($1,$2,'tasks','Purchasing','{"name":"ติดตามงาน: งานป้าย","code":"TSK-OLD","status":"pending"}')`, d1: `insert into entities(id,company_id,kind,department,data) values (?,?,'tasks','Purchasing','{"name":"ติดตามงาน: งานป้าย","code":"TSK-OLD","status":"pending"}')` }, args: () => [TASK, A] },
      { as: "alice", fn: "raw", raw: { pg: `update b2b_deals set buyer_task=$1 where id=$2`, d1: `update b2b_deals set buyer_task=? where id=?` }, args: (r) => [TASK, deal("Q3")(r)] },
      { as: "alice", fn: "b2b_deal_take", args: (r) => [deal("Q3")(r)] },
      { as: "bob", fn: "b2b_deal_cancel", args: (r) => [deal("Q3")(r), " "] },
      { as: "bob", fn: "b2b_deal_invoice", save: "IV3", args: (r) => [deal("Q3")(r), 0, null] },
      { as: "alice", fn: "b2b_deal_pay", save: "PAY4", args: (r) => [card("IV3")(r), {}] },
      { as: "bob", fn: "b2b_deal_receive", args: (r) => [card("PAY4")(r), true, null] },
      { as: "bob", fn: "b2b_deal_invoice", save: "IV4", args: (r) => [deal("Q3")(r), 1, null] },
      { as: "alice", fn: "b2b_deal_pay", args: (r) => [card("IV4")(r), { whtRate: 1 }] },
      { as: "bob", fn: "b2b_deal_deliver", args: (r) => [deal("Q3")(r), "ส่งงานแล้ว"] },
      { as: "bob", fn: "b2b_deal_cancel", save: "CX1", args: (r) => [deal("Q3")(r), " วัสดุขาดตลาด "] },
      { as: "bob", fn: "b2b_deal_cancel", args: (r) => [deal("Q3")(r), "อีกครั้ง"] },
      { as: "bob", fn: "b2b_deal_cancel_answer", args: (r) => [card("CX1")(r), true, null] },
      { as: "alice", fn: "b2b_deal_cancel_answer", args: () => [NOPE, true, null] },
      { as: "amy", fn: "b2b_deal_cancel_answer", args: (r) => [card("CX1")(r), true, null] },
      { as: "alice", fn: "b2b_deal_cancel_answer", args: (r) => [card("CX1")(r), false, " ขอให้ทำต่อ "] },
      { as: "alice", fn: "b2b_deal_cancel_answer", args: (r) => [card("CX1")(r), true, null] },
      { as: "alice", fn: "b2b_deal_cancel", save: "CX2", args: (r) => [deal("Q3")(r), "งบถูกตัดค่ะ"] },
      { as: "bob", fn: "b2b_deal_cancel_answer", args: (r) => [card("CX2")(r), true, null] },
      { as: "bob", fn: "b2b_deal_take", args: (r) => [deal("Q3")(r)] },
      { as: "bob", fn: "b2b_deal_progress", args: (r) => [deal("Q3")(r), 10, "x"] },
      { as: "alice", fn: "b2b_deal_pay", args: (r) => [card("IV4")(r), {}] },
      { as: "bob", fn: "b2b_deal_fully_paid", admin: true, self: false, args: (r) => [deal("Q3")(r)] },

      // Withdrawing: a direct quotation; a quotation on a request (back to request), then the request itself.
      { as: "bob", fn: "b2b_deal_quote", save: "Q4", args: (r) => [T(r), null, "งานป้ายหน้าร้าน", { items: [{ name: "ป้ายอะคริลิก", qty: 2, price: 3500 }], vatMode: "included" }] },
      { as: "alice", fn: "b2b_deal_withdraw", args: (r) => [card("Q4")(r), null] },
      { as: "alice", fn: "b2b_deal_withdraw", args: () => [NOPE, null] },
      { as: "bob", fn: "b2b_deal_withdraw", args: (r) => [card("Q4")(r), " ราคาวัสดุขึ้น "] },
      { as: "bob", fn: "b2b_deal_withdraw", args: (r) => [card("Q4")(r), null] },
      { as: "alice", fn: "b2b_deal_request", save: "R5", args: (r) => [T(r), "ถ่ายวิดีโองาน", { items: [{ name: "วิดีโอ 3 นาที" }] }] },
      { as: "bob", fn: "b2b_deal_quote", save: "Q5", args: (r) => [T(r), deal("R5")(r), "ถ่ายวิดีโองาน", { items: [{ name: "วิดีโอ", price: 20000 }] }] },
      { as: "bob", fn: "b2b_deal_withdraw", args: (r) => [card("Q5")(r), null] },
      { as: "bob", fn: "b2b_deal_withdraw", args: (r) => [card("Q5")(r), null] },
      { as: "bob", fn: "b2b_deal_quote", save: "Q5b", args: (r) => [T(r), deal("R5")(r), "ถ่ายวิดีโองาน", { items: [{ name: "วิดีโอ", price: 18000 }] }] },
      { as: "alice", fn: "b2b_deal_withdraw", args: (r) => [card("R5")(r), "ไม่ใช้แล้ว"] },
      // Rejecting.
      { as: "alice", fn: "b2b_deal_request", save: "R6", args: (r) => [T(r), "งานพิมพ์", { items: [{ name: "โบรชัวร์", qty: 500 }] }] },
      { as: "bob", fn: "b2b_deal_quote", save: "Q6", args: (r) => [T(r), deal("R6")(r), "งานพิมพ์", { items: [{ name: "โบรชัวร์", qty: 500, price: 3.5 }] }] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("Q6")(r), "reject", null] },
      { as: "alice", fn: "b2b_deal_take", args: (r) => [deal("Q6")(r)] },
      { as: "bob", fn: "b2b_deal_quote", save: "Q7", args: (r) => [T(r), null, "งานพิมพ์ 2", { items: [{ name: "โบรชัวร์", qty: 1000, price: 3 }] }] },
      { as: "alice", fn: "b2b_deal_decide", args: (r) => [card("Q7")(r), "reject", " แพงไป "] },
      // What both companies see at the end.
      { as: "alice", fn: "b2b_deals_of", args: (r) => [T(r)] },
      { as: "bob", fn: "b2b_deals_of", args: (r) => [T(r)] },
      { as: "carol", fn: "b2b_deals_of", args: (r) => [T(r)] },
      { as: "alice", fn: "b2b_read", args: (r) => [T(r), null] },
      { as: "bob", fn: "b2b_inbox" },
    ];
    const norm = labeller(h, { [NOPE]: "NOPE", [SUPPLIER]: "SUPPLIER", [TASK]: "TASK" });
    const n = await runSteps(h, steps, d1, norm);
    const made = { pg: "data ? 'b2bDealId' or data ? 'networkCompanyId' or kind in ('suppliers','tasks')", d1: "json_extract(data,'$.b2bDealId') is not null or json_extract(data,'$.networkCompanyId') is not null or kind in ('suppliers','tasks')" };
    await sameRows(h, norm, "entities", ["company_id", "kind", "department", "data", "version", "created_by", "archived_at"], made);
    await sameRows(h, norm, "project_stages", ["company_id", "key", "ordinal", "department", "status", "version"]);
    await sameRows(h, norm, "doc_counters", ["company_id", "prefix", "year", "last"]);
    await sameRows(h, norm, "b2b_deals", ["thread_id", "buyer", "seller", "title", "stage", "accepted_by", "buyer_task", "buyer_contact_id", "buyer_contact", "seller_contact_id", "seller_contact"]);
    await sameRows(h, norm, "b2b_cards", ["company_id", "author_id", "author_name", "kind", "rev", "data", "status", "reason", "decided_by"]);
    await sameRows(h, norm, "b2b_messages", ["company_id", "author_id", "author_name", "body"]);
    assert.ok(n > 150);
  } finally {
    await h.db.close();
  }
});
