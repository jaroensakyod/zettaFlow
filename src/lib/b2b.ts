// B2B chat: one conversation per pair of companies on the network (see migration 0041).
import { z } from "zod";
import { supabaseServer } from "./supabase/server";
import { assert } from "./domain";
import { dbError } from "./data";
import type { Context } from "./types";

export type B2bCompany = {
  id: string;
  name: string;
  industry: string;
  province: string;
  has_logo: boolean;
  /** Sample conversations only: an inline logo picture (data URI). */
  logo_url?: string;
};
export type B2bPostKind = "post" | "job" | "partner";
/** A feed post shown as a card inside the chat (migration 0049). */
export type B2bPostRef = {
  id: string;
  title: string;
  kind: B2bPostKind;
  /** First 200 characters of the post body. */
  excerpt?: string;
  meta?: { title?: string; location?: string; budget?: string; employment?: string };
  /** First picture: a storage path served at /api/feed/image/<path>, or a data URI for samples. */
  image?: string | null;
  created_at?: string;
  company?: { id: string; name: string; has_logo: boolean; logo_url?: string };
};
export type B2bThread = {
  id: string;
  last_at: string;
  company: B2bCompany;
  post: B2bPostRef | null;
  last: { body: string; mine: boolean; at: string } | null;
  unread: number;
};
export type B2bMessage = {
  id: string;
  company_id: string;
  company_name?: string;
  author_name: string;
  body: string;
  created_at: string;
  mine: boolean;
  post?: B2bPostRef | null;
};

const demoNote = "แชทระหว่างบริษัทใช้ได้เมื่อเชื่อมฐานข้อมูลจริง";

export async function b2bInbox(ctx: Context): Promise<B2bThread[]> {
  if (ctx.demo) return [];
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_inbox", { p_company: ctx.company.id });
  dbError(error);
  return (data || []) as B2bThread[];
}
export async function b2bUnread(ctx: Context): Promise<number> {
  if (ctx.demo) return 0;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_unread", { p_company: ctx.company.id });
  dbError(error);
  return Number(data) || 0;
}
/** Find or start the conversation with another company; returns its id and the card of the post it is about. */
export async function b2bOpen(ctx: Context, input: unknown): Promise<{ id: string; post: B2bPostRef | null }> {
  const { company, post } = z.object({ company: z.uuid(), post: z.uuid().nullish() }).parse(input);
  assert(!ctx.demo, demoNote);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_open", { p_company: ctx.company.id, p_target: company, p_post: post || null });
  dbError(error);
  let card: B2bPostRef | null = null;
  if (post) {
    const r = await sb.rpc("b2b_post", { p_company: ctx.company.id, p_post: post });
    dbError(r.error);
    card = (r.data as B2bPostRef | null) || null;
  }
  return { id: String(data), post: card };
}
export async function b2bRead(ctx: Context, thread: string): Promise<B2bMessage[]> {
  const id = z.uuid().parse(thread);
  if (ctx.demo) return [];
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_read", { p_company: ctx.company.id, p_thread: id });
  dbError(error);
  return (data || []) as B2bMessage[];
}
export async function b2bSend(ctx: Context, thread: string, input: unknown): Promise<B2bMessage> {
  const id = z.uuid().parse(thread),
    { body, post } = z.object({ body: z.string().trim().min(1).max(4000), post: z.uuid().nullish() }).parse(input);
  assert(!ctx.demo, demoNote);
  assert(ctx.member.role !== "viewer", "ผู้ชมส่งข้อความไม่ได้", 403);
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("b2b_send", { p_company: ctx.company.id, p_thread: id, p_body: body, p_post: post || null });
  dbError(error);
  return { ...(data as B2bMessage), company_name: ctx.company.name };
}
