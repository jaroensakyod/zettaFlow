// Platform engagement: promotions, announcements and customer ↔ ZettaFlow support chat.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseServer, supabaseAdmin, configured } from "./supabase/server";
import { demoRead, demoMutate, type DemoState } from "./demo";
import { assert } from "./domain";
import { dbError } from "./data";
import { platformAdmin } from "./platform";
import type { Context } from "./types";

export type Promo = {
  id: string;
  title: string;
  body: string;
  cta_label: string;
  cta_url: string;
  tone: "violet" | "pink" | "blue" | "green";
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  ordinal: number;
};
export type Announcement = {
  id: string;
  title: string;
  body: string;
  level: "info" | "success" | "warning";
  popup: boolean;
  active: boolean;
  published_at: string;
  expires_at: string | null;
};
export type SupportMessage = {
  id: string;
  company_id: string;
  sender: "customer" | "admin";
  name: string;
  body: string;
  created_at: string;
};
type DemoEngage = {
  promos?: Promo[];
  announcements?: Announcement[];
  support?: SupportMessage[];
};
const now = () => new Date().toISOString();
const samplePromos = (): Promo[] => [
  { id: "p1", title: "ทดลองฟรี 14 วัน พร้อม AI Add-on ครบทุกตัว", body: "เชื่อม LINE กลุ่มแรกได้ภายใน 5 นาที ไม่ต้องใช้บัตรเครดิต", cta_label: "เริ่มเลย", cta_url: "/eliteflow", tone: "violet", active: true, starts_at: now(), ends_at: null, ordinal: 0 },
  { id: "p2", title: "จ่ายรายปี ฟรี 2 เดือน", body: "รวม Add-on ที่เลือกด้วย", cta_label: "ดูราคา", cta_url: "/zetta#pricing", tone: "pink", active: true, starts_at: now(), ends_at: null, ordinal: 1 },
];
const sampleAnnouncements = (): Announcement[] => [
  { id: "a1", title: "ใหม่! ตรวจสลิปอัตโนมัติ", body: "ส่งรูปสลิปในกลุ่ม LINE ฝ่ายการเงิน ระบบอ่าน QR ตรวจยอด และกันสลิปซ้ำให้ทันที", level: "success", popup: true, active: true, published_at: now(), expires_at: null },
];
const live = <T extends { active: boolean }>(rows: T[], start: keyof T, end: keyof T) =>
  rows.filter((r) => r.active && Date.parse(String(r[start])) <= Date.now() && (!r[end] || Date.parse(String(r[end])) > Date.now()));

/** Public (no login): active promotions and announcements. */
export async function publicContent(demo: boolean) {
  if (demo || !configured()) {
    const s: DemoEngage = demo ? ((await demoRead()) as DemoState & DemoEngage) : {};
    return {
      promos: live(s.promos || samplePromos(), "starts_at", "ends_at"),
      announcements: live(s.announcements || sampleAnnouncements(), "published_at", "expires_at"),
    };
  }
  const sb = await supabaseServer();
  const [{ data: promos }, { data: announcements }] = await Promise.all([
    sb.from("promos").select("*").order("ordinal").limit(10),
    sb.from("announcements").select("*").order("published_at", { ascending: false }).limit(10),
  ]);
  return { promos: promos || [], announcements: announcements || [] };
}

// ---------- Customer support ----------
const canSupport = (ctx: Context) => ctx.member.role === "owner" || ctx.member.role === "manager";
export async function supportThread(ctx: Context) {
  assert(canSupport(ctx), "เฉพาะ Owner หรือ Manager", 403);
  if (ctx.demo) {
    const s = (await demoRead()) as DemoState & DemoEngage;
    return {
      messages: s.support || [
        { id: "m1", company_id: ctx.company.id, sender: "admin", name: "ทีมงาน ZettaFlow", body: "สวัสดีครับ มีอะไรให้ช่วยเรื่องการตั้งค่า LINE หรือแพ็กเกจ พิมพ์ถามได้เลย", created_at: now() },
      ],
      unread: 0,
    };
  }
  const sb = await supabaseServer();
  const [{ data: messages, error }, { data: thread }] = await Promise.all([
    sb.from("support_messages").select("*").eq("company_id", ctx.company.id).order("created_at", { ascending: false }).limit(100),
    sb.from("support_threads").select("unread_customer").eq("company_id", ctx.company.id).maybeSingle(),
  ]);
  dbError(error);
  return { messages: (messages || []).reverse(), unread: thread?.unread_customer || 0 };
}
export async function supportSeen(ctx: Context) {
  if (ctx.demo || !canSupport(ctx)) return;
  const sb = await supabaseServer();
  await sb.rpc("support_seen", { p_company: ctx.company.id });
}
export async function supportSend(ctx: Context, input: unknown) {
  const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(input);
  assert(canSupport(ctx), "เฉพาะ Owner หรือ Manager", 403);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoEngage) => {
      const m: SupportMessage = { id: randomUUID(), company_id: s.company.id, sender: "customer", name: ctx.user.name, body, created_at: now() };
      (s.support ??= []).push(m);
      return m;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("support_send", { p_company: ctx.company.id, p_body: body });
  dbError(error);
  return data as SupportMessage;
}

// ---------- Operator console (PLATFORM_ADMIN_EMAILS) ----------
const requireAdmin = (ctx: Context) => assert(platformAdmin(ctx), "เฉพาะผู้ดูแลแพลตฟอร์ม", 403);
export async function adminInbox(ctx: Context) {
  requireAdmin(ctx);
  if (ctx.demo) return [];
  const { data, error } = await supabaseAdmin().from("support_threads").select("*, companies(name)").order("updated_at", { ascending: false }).limit(200);
  dbError(error);
  return data;
}
export async function adminThread(ctx: Context, company: string) {
  requireAdmin(ctx);
  const id = z.uuid().parse(company);
  if (ctx.demo) return [];
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("support_messages").select("*").eq("company_id", id).order("created_at").limit(300);
  dbError(error);
  await sb.from("support_threads").update({ unread_admin: 0 }).eq("company_id", id);
  return data;
}
export async function adminReply(ctx: Context, company: string, input: unknown) {
  requireAdmin(ctx);
  const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(input);
  assert(!ctx.demo, "ใช้ได้เมื่อเชื่อม Supabase", 503);
  const { data, error } = await supabaseAdmin().rpc("support_reply", { p_company: z.uuid().parse(company), p_name: "ทีมงาน ZettaFlow", p_body: body });
  dbError(error);
  return data;
}
const promoSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(500).default(""),
  cta_label: z.string().trim().max(40).default(""),
  cta_url: z.string().trim().max(300).regex(/^(https:\/\/|\/|$)/, "ลิงก์ต้องขึ้นต้นด้วย https:// หรือ /").default(""),
  tone: z.enum(["violet", "pink", "blue", "green"]).default("violet"),
  active: z.boolean().default(true),
  ends_at: z.iso.datetime({ offset: true }).nullable().default(null),
  ordinal: z.number().int().min(0).max(100).default(0),
});
const announcementSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  level: z.enum(["info", "success", "warning"]).default("info"),
  popup: z.boolean().default(true),
  active: z.boolean().default(true),
  expires_at: z.iso.datetime({ offset: true }).nullable().default(null),
});
type Kind = "promos" | "announcements";
export async function adminList(ctx: Context, kind: Kind) {
  requireAdmin(ctx);
  if (ctx.demo) {
    const s = (await demoRead()) as DemoState & DemoEngage;
    return kind === "promos" ? s.promos || samplePromos() : s.announcements || sampleAnnouncements();
  }
  const { data, error } = await supabaseAdmin().from(kind).select("*").order(kind === "promos" ? "ordinal" : "published_at", { ascending: kind === "promos" }).limit(100);
  dbError(error);
  return data;
}
export async function adminSave(ctx: Context, kind: Kind, input: unknown, id?: string) {
  requireAdmin(ctx);
  const row: Record<string, unknown> = (kind === "promos" ? promoSchema : announcementSchema).parse(input);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoEngage) => {
      const list = (kind === "promos" ? (s.promos ??= samplePromos()) : (s.announcements ??= sampleAnnouncements())) as (Promo | Announcement)[];
      const old = id ? list.find((r) => r.id === id) : undefined;
      if (old) Object.assign(old, row);
      else list.push({ id: randomUUID(), starts_at: now(), published_at: now(), ...row } as Promo & Announcement);
    });
  const sb = supabaseAdmin();
  const { error } = id ? await sb.from(kind).update(row).eq("id", z.uuid().parse(id)) : await sb.from(kind).insert(row);
  dbError(error);
}
export async function adminDelete(ctx: Context, kind: Kind, id: string) {
  requireAdmin(ctx);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoEngage) => {
      if (kind === "promos") s.promos = (s.promos || samplePromos()).filter((r) => r.id !== id);
      else s.announcements = (s.announcements || sampleAnnouncements()).filter((r) => r.id !== id);
    });
  const { error } = await supabaseAdmin().from(kind).delete().eq("id", z.uuid().parse(id));
  dbError(error);
}
