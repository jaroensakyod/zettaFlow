// ห้องดีล phase 1 (migration 0064): request for quotation → quotation (revisions) → accept / change / reject,
// as cards inside a B2B conversation. The database functions check every rule; this only shapes the input.
import { z } from "zod";
import { supabaseServer } from "./supabase/server";
import { assert } from "./domain";
import { dbError } from "./data";
import type { Context } from "./types";

export type { Deal, DealCard, DealItem, DealParty } from "./b2b-deal-types";
export { quoteTotals } from "./b2b-deal-types";
import type { Deal, DealCard } from "./b2b-deal-types";

const demoNote = "ห้องดีลใช้ได้เมื่อเชื่อมฐานข้อมูลจริง";
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .or(z.literal(""));
const money = z.coerce.number().min(0).max(1e12);
const item = z.object({
  name: z.string().trim().max(300),
  qty: z.coerce.number().positive().max(1e9).default(1),
  unit: z.string().trim().max(30).optional(),
  price: money.optional(),
});
const requestInput = z.object({
  title: z.string().trim().min(1, "ใส่หัวข้องานที่ต้องการ").max(200),
  items: z.array(item).min(1).max(100),
  needBy: day,
  budget: money.nullish().or(z.literal("")),
  notes: z.string().max(2000).optional(),
});
const quoteInput = z.object({
  deal: z.uuid().nullish(),
  title: z.string().trim().min(1, "ใส่หัวข้อใบเสนอราคา").max(200),
  items: z.array(item).min(1).max(100),
  discount: money.optional(),
  vatMode: z.enum(["excluded", "included", "none"]).default("excluded"),
  validUntil: day,
  deliverBy: day,
  payTerms: z.string().max(300).optional(),
  installments: z.array(z.object({ label: z.string().trim().max(60), percent: z.coerce.number().positive().max(100) })).max(6).optional(),
  notes: z.string().max(2000).optional(),
});

export async function dealsOf(ctx: Context, thread: string): Promise<Deal[]> {
  const id = z.uuid().parse(thread);
  if (ctx.demo) return [];
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_deals_of", { p_company: ctx.company.id, p_thread: id });
  dbError(error);
  return (data || []) as Deal[];
}
export async function dealRequest(ctx: Context, thread: string, input: unknown): Promise<DealCard> {
  const id = z.uuid().parse(thread),
    { title, ...rest } = requestInput.parse(input);
  assert(!ctx.demo, demoNote);
  assert(ctx.member.role !== "viewer", "ผู้ชมทำรายการไม่ได้", 403);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_deal_request", { p_company: ctx.company.id, p_thread: id, p_title: title, p_data: rest });
  dbError(error);
  return data as DealCard;
}
export async function dealQuote(ctx: Context, thread: string, input: unknown): Promise<DealCard> {
  const id = z.uuid().parse(thread),
    { deal, title, ...rest } = quoteInput.parse(input);
  assert(!ctx.demo, demoNote);
  assert(ctx.member.role !== "viewer", "ผู้ชมทำรายการไม่ได้", 403);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_deal_quote", { p_company: ctx.company.id, p_thread: id, p_deal: deal || null, p_title: title, p_data: rest });
  dbError(error);
  return data as DealCard;
}
export async function dealDecide(ctx: Context, card: string, input: unknown): Promise<DealCard> {
  const id = z.uuid().parse(card),
    { decision, reason } = z.object({ decision: z.enum(["accept", "change", "reject"]), reason: z.string().max(1000).optional() }).parse(input);
  assert(!ctx.demo, demoNote);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_deal_decide", { p_company: ctx.company.id, p_card: id, p_decision: decision, p_reason: reason || null });
  dbError(error);
  return data as DealCard;
}
export async function dealWithdraw(ctx: Context, card: string, input: unknown): Promise<DealCard> {
  const id = z.uuid().parse(card),
    { reason } = z.object({ reason: z.string().max(1000).optional() }).parse(input || {});
  assert(!ctx.demo, demoNote);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_deal_withdraw", { p_company: ctx.company.id, p_card: id, p_reason: reason || null });
  dbError(error);
  return data as DealCard;
}

/** Phase 2 (migration 0065): the steps after a quotation is accepted, each a database function with its own checks. */
const reason = z.string().max(1000).optional();
const steps = {
  progress: { on: "deal", rpc: "b2b_deal_progress", input: z.object({ percent: z.coerce.number().int().min(0).max(100), note: z.string().trim().min(1, "เล่าความคืบหน้าสั้น ๆ").max(2000) }), args: (v: any) => ({ p_percent: v.percent, p_note: v.note }) },
  deliver: { on: "deal", rpc: "b2b_deal_deliver", input: z.object({ note: z.string().max(2000).optional() }), args: (v: any) => ({ p_note: v.note || "" }) },
  invoice: { on: "deal", rpc: "b2b_deal_invoice", input: z.object({ index: z.coerce.number().int().min(0).max(5), due: day }), args: (v: any) => ({ p_index: v.index, p_due: v.due || null }) },
  cancel: { on: "deal", rpc: "b2b_deal_cancel", input: z.object({ reason: z.string().trim().min(3, "บอกเหตุผลที่ขอยกเลิก").max(1000) }), args: (v: any) => ({ p_reason: v.reason }) },
  check: { on: "card", rpc: "b2b_deal_check", input: z.object({ ok: z.boolean(), reason }), args: (v: any) => ({ p_ok: v.ok, p_reason: v.reason || null }) },
  pay: {
    on: "card",
    rpc: "b2b_deal_pay",
    input: z.object({ whtRate: z.coerce.number().refine((n) => [0, 1, 2, 3, 5].includes(n)).default(0), date: day, method: z.enum(["โอนธนาคาร", "เงินสด", "บัตร", "อื่นๆ"]).default("โอนธนาคาร"), reference: z.string().max(100).optional(), notes: z.string().max(1000).optional() }),
    args: (v: any) => ({ p_data: v }),
  },
  receive: { on: "card", rpc: "b2b_deal_receive", input: z.object({ ok: z.boolean(), reason }), args: (v: any) => ({ p_ok: v.ok, p_reason: v.reason || null }) },
  answer: { on: "card", rpc: "b2b_deal_cancel_answer", input: z.object({ agree: z.boolean(), reason }), args: (v: any) => ({ p_agree: v.agree, p_reason: v.reason || null }) },
} as const;
export type DealStep = keyof typeof steps;
export const dealSteps = Object.keys(steps) as DealStep[];
export async function dealStep(ctx: Context, on: "deal" | "card", id: string, step: string, input: unknown): Promise<DealCard> {
  const def = steps[step as DealStep];
  assert(def && def.on === on, "ไม่พบขั้นตอนนี้", 404);
  const target = z.uuid().parse(id),
    v = def.input.parse(input || {});
  assert(!ctx.demo, demoNote);
  assert(ctx.member.role !== "viewer", "ผู้ชมทำรายการไม่ได้", 403);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc(def.rpc, { p_company: ctx.company.id, [on === "deal" ? "p_deal" : "p_card"]: target, ...def.args(v) });
  dbError(error);
  return data as DealCard;
}
