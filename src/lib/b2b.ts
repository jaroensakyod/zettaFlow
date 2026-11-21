// B2B chat: one conversation per pair of companies on the network (see migration 0041).
import { randomUUID } from "node:crypto";
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
  /** ห้องดีล: this line is a step of a deal card (migration 0064). */
  card_id?: string | null;
  /** Pictures and files sent with the message (migration 0082), served at /api/b2b/<thread>/file/<file>. */
  files?: B2bFile[];
  /** The person who sent it: their picture (/api/avatar/<author_id>?v=<avatar_at>) and their company. */
  author_id?: string | null;
  avatar_at?: string | null;
  company_has_logo?: boolean;
};
export type B2bFile = { path: string; name: string; mime: string; size: number };

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
const fileSchema = z.object({ path: z.string().max(200), name: z.string().trim().min(1).max(200), mime: z.string().min(1).max(120), size: z.number().int().min(1).max(10_000_000) });
export async function b2bSend(ctx: Context, thread: string, input: unknown): Promise<B2bMessage> {
  const id = z.uuid().parse(thread),
    { body, post, files } = z
      .object({ body: z.string().trim().max(4000).default(""), post: z.uuid().nullish(), files: z.array(fileSchema).max(10).default([]) })
      .parse(input);
  assert(body || files.length, "พิมพ์ข้อความหรือแนบไฟล์");
  assert(!ctx.demo, demoNote);
  assert(ctx.member.role !== "viewer", "ผู้ชมส่งข้อความไม่ได้", 403);
  const sb = await supabaseServer();
  // Every attached file must already be in this conversation's folder, at the size the browser said.
  if (files.length) {
    const { data: stored, error } = await sb.storage.from(B2B_BUCKET).list(id, { limit: 1000 });
    dbError(error);
    for (const f of files) {
      const name = f.path.slice(id.length + 1),
        hit = f.path.startsWith(id + "/") && stored?.find((o) => o.name === name);
      assert(hit && Number(hit.metadata?.size) === f.size, "ไฟล์แนบยังอัปโหลดไม่เสร็จ กรุณาลองใหม่");
    }
  }
  // p_files only with files, so text keeps working on a database without migration 0082 yet.
  const { data, error } = await sb.rpc("b2b_send", { p_company: ctx.company.id, p_thread: id, p_body: body, p_post: post || null, ...(files.length ? { p_files: files } : {}) });
  dbError(error);
  return { ...(data as B2bMessage), company_name: ctx.company.name };
}

// ---------- Files in a conversation (bucket eliteflow-b2b, folder = the conversation) ----------
const B2B_BUCKET = "eliteflow-b2b";
/** What can be sent in a conversation, by type → file extension. */
export const b2bFileTypes: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
};
export const B2B_MAX_FILE = 10_000_000;
/** Step 1 of sending a file: a place in the conversation's folder and a one-time URL the browser PUTs the file to. */
export async function b2bUpload(ctx: Context, thread: string, input: unknown): Promise<{ path: string; url: string }> {
  const id = z.uuid().parse(thread),
    { mime, size } = z.object({ name: z.string().min(1).max(200), mime: z.string(), size: z.number().int() }).parse(input),
    ext = b2bFileTypes[mime];
  assert(!ctx.demo, demoNote);
  assert(ctx.member.role !== "viewer", "ผู้ชมส่งไฟล์ไม่ได้", 403);
  assert(ext, "ส่งได้เฉพาะรูป (PNG, JPG, WebP), PDF, Word, Excel, PowerPoint, CSV, TXT และ ZIP");
  assert(size > 0 && size <= B2B_MAX_FILE, "ไฟล์ละไม่เกิน 10 MB");
  const path = `${id}/${randomUUID()}.${ext}`;
  const sb = await supabaseServer();
  const { data, error } = await sb.storage.from(B2B_BUCKET).createSignedUploadUrl(path);
  dbError(error);
  return { path, url: data!.signedUrl };
}
/** A file of the conversation: a short-lived link (storage lets only the two companies' members sign it). */
export async function b2bFile(ctx: Context, thread: string, file: string, download?: string | null): Promise<string> {
  const id = z.uuid().parse(thread);
  assert(/^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(file), "ไม่พบไฟล์", 404);
  assert(!ctx.demo, "ไม่พบไฟล์", 404);
  const sb = await supabaseServer();
  const { data, error } = await sb.storage.from(B2B_BUCKET).createSignedUrl(`${id}/${file}`, 300, download ? { download: download.slice(0, 200) } : undefined);
  assert(!error && data, "ไม่พบไฟล์", 404);
  return data!.signedUrl;
}

// ---------- People's pictures (bucket eliteflow-avatars, <user>.webp) ----------
const AVATAR_BUCKET = "eliteflow-avatars";
export async function myAvatar(ctx: Context): Promise<string | null> {
  if (ctx.demo) return null;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("my_avatar");
  dbError(error);
  return (data as string | null) || null;
}
/** The signed-in person's picture: a square WebP the browser made (≤ 300 KB). */
export async function setAvatar(ctx: Context, file: FormDataEntryValue | null): Promise<string | null> {
  assert(!ctx.demo, "โหมดตัวอย่างตั้งรูปโปรไฟล์ไม่ได้");
  assert(file instanceof File, "เลือกรูป");
  assert(file.size > 0 && file.size <= 300_000, "รูปใหญ่เกินไป");
  const bytes = Buffer.from(await file.arrayBuffer());
  assert(bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP", "ไฟล์รูปไม่ถูกต้อง");
  const sb = await supabaseServer();
  const { error } = await sb.storage.from(AVATAR_BUCKET).upload(`${ctx.user.id}.webp`, bytes, { contentType: "image/webp", upsert: true });
  dbError(error);
  const r = await sb.rpc("set_my_avatar", { p_on: true });
  dbError(r.error);
  return (r.data as string) || null;
}
export async function clearAvatar(ctx: Context): Promise<null> {
  assert(!ctx.demo, "โหมดตัวอย่างตั้งรูปโปรไฟล์ไม่ได้");
  const sb = await supabaseServer();
  await sb.storage.from(AVATAR_BUCKET).remove([`${ctx.user.id}.webp`]);
  const r = await sb.rpc("set_my_avatar", { p_on: false });
  dbError(r.error);
  return null;
}
/** Someone's picture as a short-lived link (any signed-in person may see people's pictures). */
export async function avatarUrl(ctx: Context, user: string): Promise<string> {
  const id = z.uuid().parse(user);
  assert(!ctx.demo, "ไม่พบรูป", 404);
  const sb = await supabaseServer();
  const { data, error } = await sb.storage.from(AVATAR_BUCKET).createSignedUrl(`${id}.webp`, 3600);
  assert(!error && data, "ไม่พบรูป", 404);
  return data!.signedUrl;
}
