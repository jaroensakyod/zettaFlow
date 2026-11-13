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
