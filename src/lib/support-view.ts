// หลังบ้าน › ดูในมุมมองลูกค้า (0080_support_access.sql). A platform admin opens a customer company read-only for a
// short time with a written reason; the ef_support cookie carries the open view, and context() then puts the admin in
// that company as a "viewer" of every department. The API refuses every change while it lasts. The company's owners
// and managers see each view (who, why, when) in ตั้งค่าบริษัท and can end it.
import { z } from "zod";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, supabaseServer } from "./supabase/server";
import { demoMutate, demoRead, demoAudit, type DemoState } from "./demo";
import { assert } from "./domain";
import { catalog } from "./catalog";
import { adminRoleOf } from "./admin-team";
import { demoAdminLog, logAdmin, type DemoAdminLog } from "./admin-log";
import type { Company, Context, Member } from "./types";

export const SUPPORT_COOKIE = "ef_support";
export type SupportView = { id: string; company_id: string; reason: string; expires_at: string; admin_email: string };
export type SupportAccess = SupportView & { started_at: string; ended_at: string | null; ended_by: string | null; user_id?: string };
type DemoSupport = DemoState & DemoAdminLog & { supportAccess?: SupportAccess[] };

const everyDepartment = () => [...new Set([...Object.values(catalog).map((c) => c.department), "Finance", "Sales", "Marketing", "Warehouse", "HR", "Admin", "IT", "Customer Service", "Legal", "Event", "Data"])];
const viewer = (company: Company, user: Context["user"]): Member => ({
  id: "support",
  company_id: company.id,
  user_id: user.id,
  name: user.name + " (ทีมงาน EliteFlow)",
  email: user.email,
  role: "viewer",
  departments: everyDepartment(),
  read_departments: [],
  disabled: false,
});
const open = (a: SupportAccess) => !a.ended_at && Date.parse(a.expires_at) > Date.now();

/** The open view for this signed-in user, as a context; null when there is none (or it ended / ran out). */
export async function supportContext(user: Context["user"], demo = false): Promise<Context | null> {
  const id = (await cookies()).get(SUPPORT_COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (demo) {
    const s = (await demoRead()) as DemoSupport,
      a = s.supportAccess?.find((x) => x.id === id);
    if (!a || !open(a) || a.company_id !== s.company.id) return null;
    return { user, member: viewer(s.company, user), company: s.company, demo: true, support: pick(a) };
  }
  // The admin team list comes with the catalogue; load it here too (print and file routes reach context() directly).
  const { loadCatalog } = await import("./platform-settings");
  await loadCatalog();
  if (!adminRoleOf(user.email)) return null;
  const sb = supabaseAdmin();
  const { data: a } = await sb.from("support_access").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!a || !open(a as SupportAccess)) return null;
  const { data: company } = await sb.from("companies").select("*").eq("id", a.company_id).maybeSingle();
  if (!company) return null;
  return { user, member: viewer(company as Company, user), company: company as Company, demo: false, support: pick(a as SupportAccess) };
}
const pick = (a: SupportAccess): SupportView => ({ id: a.id, company_id: a.company_id, reason: a.reason, expires_at: a.expires_at, admin_email: a.admin_email });

const openInput = z.object({
  company_id: z.string().min(1).max(64),
  reason: z.string().trim().min(5, "เขียนเหตุผลอย่างน้อย 5 ตัวอักษร").max(300),
  minutes: z.coerce.number().int().refine((m) => [15, 30, 60, 120].includes(m), "เลือกเวลา 15, 30, 60 หรือ 120 นาที").default(30),
});
async function setCookie(id: string, minutes: number) {
  (await cookies()).set(SUPPORT_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: !!process.env.VERCEL, path: "/", maxAge: minutes * 60 });
}

/** Opens a company read-only (any platform team member, view-only included: it only reads). */
export async function openSupportView(ctx: Context, input: unknown, viewerOk: boolean) {
  assert(viewerOk, "เฉพาะผู้ดูแลแพลตฟอร์ม", 403);
  const v = openInput.parse(input);
  const expires_at = new Date(Date.now() + v.minutes * 60000).toISOString();
  if (ctx.demo) {
    const row = await demoMutate((s: DemoSupport) => {
      assert(v.company_id === s.company.id, "ในโหมดตัวอย่างเปิดดูได้เฉพาะบริษัทตัวอย่างหลัก (บริษัทอื่นเป็นตัวเลขจำลอง ไม่มีข้อมูลให้ดู)");
      const a: SupportAccess = { id: randomUUID(), company_id: s.company.id, user_id: ctx.user.id, admin_email: ctx.user.email, reason: v.reason, started_at: new Date().toISOString(), expires_at, ended_at: null, ended_by: null };
      (s.supportAccess ??= []).unshift(a);
      demoAudit(s, "support_view_started", `${ctx.user.email}: ${v.reason}`);
      demoAdminLog(s, ctx, "support_view", `เปิดดู ${s.company.name} ${v.minutes} นาที — ${v.reason}`);
      return a;
    });
    await setCookie(row.id, v.minutes);
    return { ok: true, id: row.id, expires_at };
  }
  const sb = supabaseAdmin();
  const { data: company } = await sb.from("companies").select("id,name").eq("id", z.uuid().parse(v.company_id)).maybeSingle();
  assert(company, "ไม่พบบริษัท", 404);
  // One open view per admin: a new one closes the last.
  await sb.from("support_access").update({ ended_at: new Date().toISOString(), ended_by: "เปิดบริษัทอื่นแทน" }).eq("user_id", ctx.user.id).is("ended_at", null);
  const { data: row, error } = await sb
    .from("support_access")
    .insert({ company_id: company.id, user_id: ctx.user.id, admin_email: ctx.user.email, reason: v.reason, expires_at })
    .select("id")
    .single();
  assert(!error && row, error?.message || "เปิดไม่สำเร็จ", 500);
  await sb.from("audit_events").insert({ company_id: company.id, actor: ctx.user.id, action: "support_view_started", target: `${ctx.user.email}: ${v.reason}` });
  await logAdmin(ctx, "support_view", `เปิดดู ${company.name} ${v.minutes} นาที — ${v.reason}`);
  await setCookie(row.id, v.minutes);
  return { ok: true, id: row.id, expires_at };
}

/** The admin leaves the customer's view. */
export async function closeSupportView(ctx: Context) {
  const id = ctx.support?.id || (await cookies()).get(SUPPORT_COOKIE)?.value;
  (await cookies()).delete(SUPPORT_COOKIE);
  if (!id) return { ok: true };
  if (ctx.demo)
    await demoMutate((s: DemoSupport) => {
      const a = s.supportAccess?.find((x) => x.id === id);
      if (a && !a.ended_at) Object.assign(a, { ended_at: new Date().toISOString(), ended_by: "ทีมงานออกเอง" });
    });
  else await supabaseAdmin().from("support_access").update({ ended_at: new Date().toISOString(), ended_by: "ทีมงานออกเอง" }).eq("id", id).eq("user_id", ctx.user.id).is("ended_at", null);
  return { ok: true };
}

// ---------- the customer's side ----------
const canSee = (ctx: Context) => !ctx.support && (ctx.member.role === "owner" || ctx.member.role === "manager");
/** Every view of this company by the EliteFlow team (owners and managers). */
export async function supportAccessList(ctx: Context): Promise<SupportAccess[]> {
  if (!canSee(ctx)) return [];
  if (ctx.demo) return (((await demoRead()) as DemoSupport).supportAccess || []).filter((a) => a.company_id === ctx.company.id).slice(0, 50);
  const sb = await supabaseServer();
  const { data } = await sb.from("support_access").select("id,company_id,admin_email,reason,started_at,expires_at,ended_at,ended_by").eq("company_id", ctx.company.id).order("started_at", { ascending: false }).limit(50);
  return (data || []) as SupportAccess[];
}
/** Views still open right now, for the banner the owner sees. */
export const activeSupport = async (ctx: Context) => (await supportAccessList(ctx)).filter(open);
export async function endSupportAccess(ctx: Context, id: string) {
  assert(canSee(ctx), "เฉพาะเจ้าของหรือผู้จัดการ", 403);
  if (ctx.demo)
    return demoMutate((s: DemoSupport) => {
      const a = s.supportAccess?.find((x) => x.id === id && x.company_id === ctx.company.id);
      assert(a, "ไม่พบรายการ", 404);
      if (!a.ended_at) Object.assign(a, { ended_at: new Date().toISOString(), ended_by: "ลูกค้า: " + ctx.user.email });
      demoAudit(s, "support_access_ended", a.admin_email);
      return a;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("end_support_access", { p_id: z.uuid().parse(id) });
  assert(!error, error?.message || "", 400);
  return data;
}
