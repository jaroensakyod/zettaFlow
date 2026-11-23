// Platform engagement: promotions, announcements and customer ↔ ZettaFlow support chat.
import { sendAdminAlert } from "./admin-log";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseServer, supabaseAdmin, configured } from "./supabase/server";
import { demoRead, demoMutate, type DemoState } from "./demo";
import { assert } from "./domain";
import { dbError } from "./data";
import { platformAdmin } from "./platform";
import { supportTopic, supportTopics } from "./support-topics";
import type { Context } from "./types";

export type Promo = {
  id: string;
  title: string;
  body: string;
  cta_label: string;
  cta_url: string;
  tone: "violet" | "pink" | "blue" | "green";
  /** landing = public home page banner, feed = sponsored card in เครือข่ายธุรกิจ, both, billing = banner on แพ็กเกจบริการ. */
  placement?: "landing" | "feed" | "both" | "billing";
  /** Optional picture or clip (public URL) shown with the promotion. */
  media_url?: string;
  media_type?: "" | "image" | "video";
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
  /** The customer who wrote it; on a team answer, the customer it answers. */
  user_id?: string | null;
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
  { id: "p1", title: "ใช้งานฟรีได้เลย LINE 1 กลุ่ม + ระบบบัญชีและการเงิน", body: "เชื่อม LINE กลุ่มแรกได้ภายใน 5 นาที ไม่ต้องใช้บัตรเครดิต", cta_label: "เริ่มเลย", cta_url: "/feed", tone: "violet", active: true, starts_at: now(), ends_at: null, ordinal: 0 },
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
// One thread per company with the EliteFlow team. Owners and managers see the whole thread; any other member can
// write too (น้องโฟลว์ → ติดต่อเจ้าหน้าที่) and sees only their own messages and the team's answers to them.
const canSupport = (ctx: Context) => ctx.member.role === "owner" || ctx.member.role === "manager";
const roleNames: Record<string, string> = { owner: "เจ้าของ", manager: "ผู้จัดการ", staff: "พนักงาน", viewer: "ผู้ชม" };
/** A member's message into the company thread, written with the service key (the caller has checked the member). */
async function postAsMember(ctx: Context, body: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("support_messages")
    .insert({ company_id: ctx.company.id, sender: "customer", user_id: ctx.user.id, name: ctx.user.name, body })
    .select("*")
    .single();
  dbError(error);
  const { data: thread } = await sb.from("support_threads").select("unread_admin").eq("company_id", ctx.company.id).maybeSingle();
  const { error: e2 } = await sb
    .from("support_threads")
    .upsert({ company_id: ctx.company.id, unread_admin: Number(thread?.unread_admin || 0) + 1, status: "open", updated_at: now() }, { onConflict: "company_id" });
  dbError(e2);
  return data as SupportMessage;
}
export async function supportThread(ctx: Context) {
  if (ctx.demo) {
    const s = (await demoRead()) as DemoState & DemoEngage;
    return {
      messages: s.support || [
        { id: "m1", company_id: ctx.company.id, sender: "admin", name: "ทีมงาน ZettaFlow", body: "สวัสดีครับ มีอะไรให้ช่วยเรื่องการตั้งค่า LINE หรือแพ็กเกจ พิมพ์ถามได้เลย", created_at: now() },
      ],
      unread: 0,
    };
  }
  if (!canSupport(ctx)) {
    // The server has checked the member; the service key reads only this person's messages and the answers to them.
    const { data, error } = await supabaseAdmin()
      .from("support_messages")
      .select("*")
      .eq("company_id", ctx.company.id)
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    dbError(error);
    return { messages: (data || []).reverse(), unread: 0 };
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
  const { body: text, topic } = z
    .object({ body: z.string().trim().min(1).max(3900), topic: z.enum(supportTopics).optional() })
    .parse(input);
  const body = (topic ? "[" + topic + "] " : "") + text;
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoEngage) => {
      const m: SupportMessage = { id: randomUUID(), company_id: s.company.id, sender: "customer", name: ctx.user.name, body, created_at: now() };
      (s.support ??= []).push(m);
      return m;
    });
  let message: SupportMessage;
  if (canSupport(ctx)) {
    const sb = await supabaseServer();
    const { data, error } = await sb.rpc("support_send", { p_company: ctx.company.id, p_body: body });
    dbError(error);
    message = data as SupportMessage;
  } else message = await postAsMember(ctx, body);
  await sendAdminAlert(
    "support",
    `💬 ${topic ? "[" + topic + "] " : ""}ข้อความใหม่จาก ${ctx.company.name} (${ctx.user.name} · ${roleNames[ctx.member.role] || ctx.member.role})
${text.slice(0, 300)}`,
  );
  return message;
}

/**
 * แจ้งปัญหา / ข้อเสนอแนะ sent from น้องโฟลว์: goes into the company's thread with the EliteFlow team (the operator
 * inbox), from any member. The sender sees the team's answer in the "คุยกับเจ้าหน้าที่" chat.
 */
export async function sendFeedback(ctx: Context, input: unknown) {
  const { kind, text } = z
    .object({ kind: z.enum(["bug", "idea"]), text: z.string().trim().min(3, "เล่ารายละเอียดอีกนิดนะคะ").max(2000) })
    .parse(input);
  const body =
    (kind === "bug" ? "[แจ้งปัญหา]" : "[ข้อเสนอแนะ]") +
    " ผ่านน้องโฟลว์\n" +
    text +
    "\n— " +
    ctx.user.name +
    " (" +
    (roleNames[ctx.member.role] || ctx.member.role) +
    ")";
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoEngage) => {
      const m: SupportMessage = { id: randomUUID(), company_id: s.company.id, sender: "customer", name: ctx.user.name, body, created_at: now() };
      (s.support ??= []).push(m);
      return { ok: true };
    });
  await postAsMember(ctx, body);
  await sendAdminAlert("support", `${kind === "bug" ? "🐞 แจ้งปัญหา" : "💡 ข้อเสนอแนะ"} จาก ${ctx.company.name}
${text.slice(0, 300)}`);
  return { ok: true };
}

// ---------- Operator console (PLATFORM_ADMIN_EMAILS) ----------
const requireAdmin = (ctx: Context) => assert(platformAdmin(ctx), "เฉพาะผู้ดูแลแพลตฟอร์ม", 403);
export type InboxThread = {
  company_id: string;
  unread_admin: number;
  status: string;
  updated_at: string;
  companies?: { name: string } | null;
  /** The newest customer message: who wrote it, its subject and the start of the text. */
  last?: { name: string; topic: string; text: string; at: string } | null;
};
export async function adminInbox(ctx: Context): Promise<InboxThread[]> {
  requireAdmin(ctx);
  if (ctx.demo) return [];
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("support_threads").select("*, companies(name)").order("updated_at", { ascending: false }).limit(200);
  dbError(error);
  const threads = (data || []) as InboxThread[];
  if (!threads.length) return threads;
  const { data: recent, error: e2 } = await sb
    .from("support_messages")
    .select("company_id, name, body, created_at")
    .eq("sender", "customer")
    .in("company_id", threads.map((t) => t.company_id))
    .order("created_at", { ascending: false })
    .limit(1000);
  dbError(e2);
  const last = new Map<string, InboxThread["last"]>();
  for (const m of (recent || []) as { company_id: string; name: string; body: string; created_at: string }[]) {
    if (last.has(m.company_id)) continue;
    const { topic, text } = supportTopic(m.body);
    last.set(m.company_id, { name: m.name, topic, text: text.slice(0, 160), at: m.created_at });
  }
  return threads.map((t) => ({ ...t, last: last.get(t.company_id) || null }));
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
  const id = z.uuid().parse(company),
    sb = supabaseAdmin();
  const { data, error } = await sb.rpc("support_reply", { p_company: id, p_name: "ทีมงาน ZettaFlow", p_body: body });
  dbError(error);
  // The answer belongs to whoever wrote last, so a staff member who asked through น้องโฟลว์ sees it in their chat too.
  const reply = data as SupportMessage;
  const { data: asker } = await sb
    .from("support_messages")
    .select("user_id")
    .eq("company_id", id)
    .eq("sender", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (asker?.user_id && reply?.id) {
    await sb.from("support_messages").update({ user_id: asker.user_id }).eq("id", reply.id);
    reply.user_id = asker.user_id;
  }
  return reply;
}
const promoSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(500).default(""),
  cta_label: z.string().trim().max(40).default(""),
  cta_url: z.string().trim().max(300).regex(/^(https:\/\/|\/|$)/, "ลิงก์ต้องขึ้นต้นด้วย https:// หรือ /").default(""),
  tone: z.enum(["violet", "pink", "blue", "green"]).default("violet"),
  placement: z.enum(["landing", "feed", "both", "billing"]).default("landing"),
  media_url: z.string().trim().max(500).regex(/^(https:\/\/|$)/, "ลิงก์รูป/คลิปต้องขึ้นต้นด้วย https://").default(""),
  media_type: z.enum(["", "image", "video"]).default(""),
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
const PROMO_BUCKET = "eliteflow-promo";
const promoMedia: Record<string, "image" | "video"> = { "image/png": "image", "image/jpeg": "image", "image/webp": "image", "image/gif": "image", "video/mp4": "video", "video/webm": "video" };
/** Admin uploads a promo picture or clip straight to public storage: returns a one-time PUT URL and the public URL to save. */
export async function promoMediaUpload(ctx: Context, input: unknown) {
  requireAdmin(ctx);
  const v = z.object({ mime: z.string().max(100), size: z.number().int().min(1) }).parse(input);
  const type = promoMedia[v.mime];
  assert(type, "รองรับเฉพาะรูป PNG/JPG/WEBP/GIF หรือคลิป MP4/WEBM", 400);
  assert(v.size <= 50_000_000, "ไฟล์ใหญ่เกิน 50 MB", 400);
  if (ctx.demo || !configured()) return { direct: false as const };
  const ext = v.mime.split("/")[1].replace("jpeg", "jpg");
  const path = `promos/${randomUUID()}.${ext}`;
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from(PROMO_BUCKET).createSignedUploadUrl(path);
  dbError(error);
  return { direct: true as const, url: data!.signedUrl, publicUrl: sb.storage.from(PROMO_BUCKET).getPublicUrl(path).data.publicUrl, type };
}
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
