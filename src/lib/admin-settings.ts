// Admin console phase 4: ตั้งค่าแพลตฟอร์ม (package prices and limits, add-ons, coin packs, Free / trial AI allowances,
// the admin team, LINE alerts) and ความปลอดภัย (failed sign-ins, share links being guessed, what admins did, sensitive
// changes inside customer companies). Writes go through the service role to the tables the database functions
// already charge and limit from (plans, addons, coin_packs, free_limits, trial_limits) — no migration needed.
import { createHash } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "./supabase/server";
import { demoMutate, demoRead } from "./demo";
import { assert } from "./domain";
import { dbError } from "./data";
import { DAY, rawDemo, requireAdmin, requireAdminWrite, type DemoAdmin } from "./admin-console";
import { platformRole } from "./platform";
import { defaultCatalog, demoCatalog, invalidateCatalog, loadCatalog, type Alerts, type Catalog, type DemoCatalog } from "./platform-settings";
import { ownerEmails, type AdminRole, type TeamMember } from "./admin-team";
import { demoAdminLog, logAdmin, sendAdminAlert, type AdminLogRow, type DemoAdminLog } from "./admin-log";
import { platformCompanyId } from "./package-sale";
import type { Context } from "./types";

export type AdminSettings = {
  catalog: Catalog;
  defaults: Catalog;
  role: AdminRole;
  me: string;
  owners: string[];
  lineTargets: { id: string; label: string }[];
  lineReady: boolean;
};

export async function adminSettings(ctx: Context): Promise<AdminSettings> {
  requireAdmin(ctx);
  const role = platformRole(ctx)!,
    defaults = defaultCatalog();
  if (ctx.demo) {
    const s = (await demoRead()) as DemoCatalog;
    return {
      catalog: demoCatalog(s),
      defaults,
      role,
      me: ctx.user.email,
      owners: [ctx.user.email],
      lineTargets: [{ id: "Cabcdef0123456789abcdef0123456789", label: "กลุ่ม LINE ทีม EliteFlow (ตัวอย่าง)" }],
      lineReady: false,
    };
  }
  invalidateCatalog();
  const [catalog, groups] = await Promise.all([loadCatalog(), supabaseAdmin().from("line_groups").select("group_id,name").eq("company_id", platformCompanyId())]);
  return {
    catalog,
    defaults,
    role,
    me: ctx.user.email,
    owners: ownerEmails(),
    lineTargets: ((groups.data || []) as { group_id: string; name: string | null }[]).map((g) => ({ id: g.group_id, label: g.name || "กลุ่ม LINE " + g.group_id.slice(-6) })),
    lineReady: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
  };
}

const limit = z.union([z.null(), z.coerce.number().int().min(0).max(10000000)]);
const settingInput = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("plan"),
    id: z.enum(["free", "starter", "growth", "business", "enterprise"]),
    monthly: z.coerce.number().min(0).max(10000000),
    yearly: z.coerce.number().min(0).max(100000000),
    workflows: limit,
    documents: limit,
    line_groups: limit,
    users: limit,
    voice_minutes: limit,
    storage_gb: limit,
  }),
  z.object({ section: z.literal("addon"), id: z.string().regex(/^[a-z_]{1,40}$/), price: z.coerce.number().min(0).max(1000000) }),
  z.object({ section: z.literal("coinpack"), coins: z.coerce.number().int().positive(), price: z.coerce.number().positive("ราคาต้องมากกว่า 0").max(10000000) }),
  z.object({ section: z.enum(["freeAi", "trial"]), resource: z.string().regex(/^[a-z_]{1,40}$/), amount: z.coerce.number().int().min(0).max(10000000) }),
  z.object({ section: z.literal("team"), email: z.email("อีเมลไม่ถูกต้อง").transform((e) => e.toLowerCase()), role: z.enum(["admin", "viewer", "remove"]), name: z.string().trim().max(60).optional() }),
  z.object({
    section: z.literal("alerts"),
    to: z.string().trim().max(64).regex(/^([CUR][0-9a-f]{32})?$/, "LINE ID ต้องขึ้นต้นด้วย C (กลุ่ม) หรือ U (ผู้ใช้) ตามด้วย 32 ตัวอักษร"),
    events: z.object({ signup: z.boolean(), payment: z.boolean(), topup: z.boolean(), support: z.boolean(), health: z.boolean() }),
  }),
  z.object({ section: z.literal("testAlert") }),
]);
type SettingInput = z.infer<typeof settingInput>;
const money = (n: number) => n.toLocaleString("th-TH");

/** What was changed, in words, for the admin log. */
function describe(v: SettingInput, c: Catalog) {
  switch (v.section) {
    case "plan": {
      const p = c.plans.find((x) => x.id === v.id);
      return `แพ็กเกจ ${p?.name || v.id}: ฿${money(v.monthly)}/เดือน ฿${money(v.yearly)}/ปี · AI ${v.documents ?? "ไม่จำกัด"} · ผู้ใช้ ${v.users ?? "ไม่จำกัด"} · LINE ${v.line_groups ?? "ไม่จำกัด"}`;
    }
    case "addon":
      return `ราคา Add-on ${c.addons.find((a) => a.id === v.id)?.name || v.id}: ฿${money(v.price)}`;
    case "coinpack":
      return `แพ็ก ${v.coins} เหรียญ: ฿${money(v.price)}`;
    case "freeAi":
    case "trial":
      return `${v.section === "trial" ? "ลิมิตทดลองใช้" : "AI ฟรี"} ${[...c.freeAi, ...c.trial].find((x) => x.resource === v.resource)?.label || v.resource}: ${money(v.amount)}`;
    case "team":
      return v.role === "remove" ? `นำ ${v.email} ออกจากทีมแอดมิน` : `ตั้ง ${v.email} เป็น${v.role === "admin" ? "ผู้ดูแล" : "ดูอย่างเดียว"}`;
    case "alerts":
      return `แจ้งเตือน LINE → ${v.to || "ปิด"} (${Object.entries(v.events).filter(([, on]) => on).map(([k]) => k).join(", ") || "ไม่มีเหตุการณ์"})`;
    default:
      return "ส่งแจ้งเตือนทดสอบ";
  }
}
function checkTeam(ctx: Context, v: Extract<SettingInput, { section: "team" }>, owners: string[]) {
  assert(platformRole(ctx) === "owner", "เฉพาะเจ้าของระบบที่จัดการทีมแอดมินได้", 403);
  assert(!owners.includes(v.email), "บัญชีนี้เป็นเจ้าของระบบ (ตั้งไว้ใน PLATFORM_ADMIN_EMAILS) เปลี่ยนจากหน้านี้ไม่ได้");
}
const nextTeam = (team: TeamMember[], v: Extract<SettingInput, { section: "team" }>, by: string): TeamMember[] => {
  const rest = team.filter((m) => m.email !== v.email);
  if (v.role === "remove") {
    assert(rest.length < team.length, "ไม่พบบัญชีนี้ในทีม", 404);
    return rest;
  }
  const was = team.find((m) => m.email === v.email);
  assert(rest.length < 30, "ทีมแอดมินเต็มแล้ว (30 คน)");
  return [...rest, { email: v.email, role: v.role, name: v.name || was?.name || "", added_by: was?.added_by || by, added_at: was?.added_at || new Date().toISOString() }];
};

export async function saveSetting(ctx: Context, input: unknown) {
  requireAdminWrite(ctx);
  const v = settingInput.parse(input);
  if (v.section === "plan") assert(v.id !== "free" || (v.monthly === 0 && v.yearly === 0), "แพ็กเกจ Free ต้องราคา 0");
  if (v.section === "plan" && v.id !== "free") assert(v.monthly > 0 && v.yearly > 0, "ราคาแพ็กเกจต้องมากกว่า 0");
  if (ctx.demo) {
    const out = await demoMutate((s: DemoCatalog & DemoAdminLog) => {
      const c = demoCatalog(s),
        e = (s.adminCatalog ??= {});
      switch (v.section) {
        case "plan": {
          const { section: _s, id, ...n } = v;
          (e.plans ??= {})[id] = n;
          break;
        }
        case "addon":
          assert(c.addons.some((a) => a.id === v.id), "ไม่พบ Add-on", 404);
          (e.addons ??= {})[v.id] = v.price;
          break;
        case "coinpack":
          assert(c.coinPacks.some((p) => p.coins === v.coins), "ไม่พบแพ็กเหรียญ", 404);
          (e.coinPacks ??= {})[v.coins] = v.price;
          break;
        case "freeAi":
        case "trial":
          assert(c[v.section].some((x) => x.resource === v.resource), "ไม่พบรายการ", 404);
          (e[v.section] ??= {})[v.resource] = v.amount;
          break;
        case "team":
          checkTeam(ctx, v, [ctx.user.email.toLowerCase()]);
          s.adminTeam = nextTeam(c.team, v, ctx.user.email);
          break;
        case "alerts":
          s.adminAlerts = { to: v.to, events: v.events };
          break;
        case "testAlert":
          assert(c.alerts.to, "ใส่ LINE ID ที่จะรับแจ้งเตือนแล้วกดบันทึกก่อน");
          break;
      }
      demoAdminLog(s, ctx, v.section === "testAlert" ? "alert_test" : "setting_" + v.section, describe(v, c));
      return { ok: true, sent: v.section === "testAlert" ? "demo" : undefined };
    });
    invalidateCatalog();
    return out;
  }
  const sb = supabaseAdmin(),
    c = await loadCatalog();
  const one = async (q: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) => {
    const { data, error } = await q;
    dbError(error);
    assert(data?.length, "ไม่พบรายการ", 404);
  };
  const settings = async (patch: (s: Record<string, unknown>) => void) => {
    const { data, error } = await sb.from("companies").select("settings").eq("id", platformCompanyId()).maybeSingle();
    dbError(error);
    assert(data, "ไม่พบบริษัทของแพลตฟอร์ม (PLATFORM_COMPANY_ID)", 500);
    const s = { ...((data.settings || {}) as Record<string, unknown>) };
    patch(s);
    const { error: e2 } = await sb.from("companies").update({ settings: s }).eq("id", platformCompanyId());
    dbError(e2);
  };
  let sent: string | undefined;
  switch (v.section) {
    case "plan": {
      const { section: _s, id, ...n } = v;
      await one(sb.from("plans").update(n).eq("id", id).select("id"));
      break;
    }
    case "addon":
      await one(sb.from("addons").update({ monthly: v.price }).eq("id", v.id).select("id"));
      break;
    case "coinpack":
      await one(sb.from("coin_packs").update({ price: v.price }).eq("coins", v.coins).select("coins"));
      break;
    case "freeAi":
    case "trial":
      await one(sb.from(v.section === "trial" ? "trial_limits" : "free_limits").update({ amount: v.amount }).eq("resource", v.resource).select("resource"));
      break;
    case "team":
      checkTeam(ctx, v, ownerEmails());
      await settings((s) => {
        s.admin_team = nextTeam(Array.isArray(s.admin_team) ? (s.admin_team as TeamMember[]) : [], v, ctx.user.email);
      });
      break;
    case "alerts":
      await settings((s) => {
        s.admin_alerts = { to: v.to, events: v.events } satisfies Alerts;
      });
      break;
    case "testAlert":
      assert(c.alerts.to, "ใส่ LINE ID ที่จะรับแจ้งเตือนแล้วกดบันทึกก่อน");
      assert(process.env.LINE_CHANNEL_ACCESS_TOKEN, "ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN บนเซิร์ฟเวอร์");
      sent = (await sendAdminAlert("test", `🔔 ทดสอบแจ้งเตือนจากหลังบ้าน EliteFlow\nส่งโดย ${ctx.user.email}`, true)) ? "queued" : undefined;
      assert(sent, "ส่งไม่สำเร็จ");
      break;
  }
  await logAdmin(ctx, v.section === "testAlert" ? "alert_test" : "setting_" + v.section, describe(v, c));
  invalidateCatalog();
  await loadCatalog();
  if (v.section === "plan" || v.section === "addon") {
    revalidatePath("/pricing");
    revalidatePath("/zetta");
    revalidatePath("/");
  }
  return { ok: true, sent };
}

// ---------- ความปลอดภัย ----------
export type LoginFail = { email: string; count: number; count24: number; ips: number; last: string; reason: string; company?: string };
export type ShareProbe = { token: string; company: string; label: string; attempts: number; clients: number; last: string; blocked: boolean; revoked: boolean };
export type AdminSecurity = {
  totals: { fails24: number; fails7: number; flagged: number; shareAttempts: number; blockedLinks: number; blockedClients: number; adminActions7: number; disabledUsers: number };
  /** Failed sign-ins per hour over the last 24 hours (oldest first). */
  hourly: number[];
  logins: LoginFail[];
  shares: ShareProbe[];
  adminLog: AdminLogRow[];
  customer: { at: string; company_id: string; company: string; action: string; target: string }[];
  team: { email: string; role: AdminRole; name?: string }[];
};
export const sensitiveActions: Record<string, string> = {
  member_invited: "เชิญสมาชิกใหม่",
  member_updated: "เปลี่ยนสิทธิ์/ระงับสมาชิก",
  share_created: "สร้างลิงก์แชร์แดชบอร์ด",
  share_revoked: "ยกเลิกลิงก์แชร์",
  sample_data_cleared: "ล้างข้อมูลตัวอย่าง",
  line_group_unlinked: "ยกเลิกเชื่อมกลุ่ม LINE",
  line_approver_removed: "นำผู้อนุมัติ LINE ออก",
  company_updated: "แก้ข้อมูลบริษัท",
  support_view_started: "ทีมงานเปิดดูในมุมมองลูกค้า",
  support_access_ended: "ลูกค้าหยุดการเข้าดูของทีมงาน",
};
const FLAG = 5;
const actorOf = (target: string) => {
  const i = target.lastIndexOf(" by ");
  return i < 0 ? { text: target, by: "" } : { text: target.slice(0, i), by: target.slice(i + 4) };
};
function shapeLogins(rows: { at: string; email: string; ip: string; reason: string }[], now: number, companyOf: (email: string) => string | undefined) {
  const by = new Map<string, LoginFail & { ipSet: Set<string> }>();
  for (const r of rows) {
    const x = by.get(r.email) || { email: r.email, count: 0, count24: 0, ips: 0, last: r.at, reason: r.reason, ipSet: new Set<string>(), company: companyOf(r.email) };
    x.count++;
    if (now - Date.parse(r.at) < DAY) x.count24++;
    x.ipSet.add(r.ip);
    if (r.at > x.last) (x.last = r.at), (x.reason = r.reason);
    by.set(r.email, x);
  }
  const hourly = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    const h = Math.floor((now - Date.parse(r.at)) / 3600000);
    if (h >= 0 && h < 24) hourly[23 - h]++;
  }
  const logins = [...by.values()]
    .map(({ ipSet, ...x }) => ({ ...x, ips: ipSet.size }))
    .sort((a, b) => b.count24 - a.count24 || b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, 60);
  return { logins, hourly };
}
const reasonText = (m: string) =>
  /confirm/i.test(m) ? "ยังไม่ยืนยันอีเมล" : /invalid/i.test(m) ? "รหัสผ่านหรืออีเมลไม่ถูกต้อง" : /rate|many/i.test(m) ? "ลองบ่อยเกินไป" : m.slice(0, 60) || "ไม่ทราบสาเหตุ";

export async function adminSecurity(ctx: Context): Promise<AdminSecurity> {
  requireAdmin(ctx);
  const now = Date.now(),
    iso = (ms: number) => new Date(ms).toISOString();
  if (ctx.demo) {
    const s = (await demoRead()) as DemoAdmin & DemoAdminLog & DemoCatalog,
      r = rawDemo(s),
      co = new Map(r.companies.map((c) => [c.id, c.name])),
      emailCo = new Map(r.members.map((m) => [m.email, co.get(m.company_id)]));
    // Sample failures: one account being hammered, a few ordinary typos.
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => ({ at: iso(now - i * 9 * 60000 - 3 * 3600000), email: "owner@sample2.co.th", ip: "ip" + (i % 6), reason: "Invalid login credentials" })),
      ...Array.from({ length: 3 }, (_, i) => ({ at: iso(now - i * 3600000 - 0.4 * DAY), email: "staff1@sample4.co.th", ip: "ipA", reason: "Invalid login credentials" })),
      { at: iso(now - 1.5 * DAY), email: "new.user@gmail.com", ip: "ipB", reason: "Email not confirmed" },
      ...Array.from({ length: 2 }, (_, i) => ({ at: iso(now - (2 + i) * DAY), email: "owner@sample9.co.th", ip: "ipC", reason: "Invalid login credentials" })),
    ].map((x) => ({ ...x, reason: reasonText(x.reason) }));
    const { logins, hourly } = shapeLogins(rows, now, (e) => emailCo.get(e));
    const shares: ShareProbe[] = [
      { token: "a91f3c", company: co.get(r.companies[2].id) || "", label: "แดชบอร์ดยอดขายสำหรับนักลงทุน", attempts: 26, clients: 1, last: iso(now - 40 * 60000), blocked: true, revoked: false },
      { token: "77b0de", company: co.get(r.companies[5].id) || "", label: "รายงานประจำเดือน", attempts: 6, clients: 2, last: iso(now - 5 * 3600000), blocked: false, revoked: false },
    ];
    const grantsLog: AdminLogRow[] = (s.adminGrants || []).flatMap((g) => [
      { at: g.created_at, by: g.granted_by, action: "grant", text: `มอบแพ็กเกจ ${g.plan} ${g.days} วัน ให้ ${co.get(g.company_id) || g.company_id}` },
      ...(g.revoked_at ? [{ at: g.revoked_at, by: g.revoked_by || "", action: "revoke", text: `ยกเลิกแพ็กเกจที่มอบให้ ${co.get(g.company_id) || g.company_id}` }] : []),
    ]);
    const adminLog = [...(s.adminLog || []), ...grantsLog].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
    const customer = s.audit
      .filter((a) => a.action in sensitiveActions)
      .slice(0, 50)
      .map((a) => ({ at: a.created_at, company_id: s.company.id, company: s.company.name, action: a.action, target: a.target }));
    if (!customer.length)
      customer.push(
        { at: iso(now - 2 * 3600000), company_id: r.companies[3].id, company: r.companies[3].name, action: "member_updated", target: "staff2@sample3.co.th → ระงับ" },
        { at: iso(now - 0.6 * DAY), company_id: r.companies[2].id, company: r.companies[2].name, action: "share_created", target: "แดชบอร์ดยอดขายสำหรับนักลงทุน" },
        { at: iso(now - 1.2 * DAY), company_id: r.companies[1].id, company: r.companies[1].name, action: "member_invited", target: "staff3@sample1.co.th" },
      );
    return {
      totals: {
        fails24: hourly.reduce((a, b) => a + b, 0),
        fails7: rows.length,
        flagged: logins.filter((l) => l.count24 >= FLAG).length,
        shareAttempts: shares.reduce((a, x) => a + x.attempts, 0),
        blockedLinks: shares.filter((x) => x.blocked).length,
        blockedClients: 1,
        adminActions7: adminLog.filter((a) => now - Date.parse(a.at) < 7 * DAY).length,
        disabledUsers: r.members.filter((m) => m.disabled).length,
      },
      hourly,
      logins,
      shares,
      adminLog,
      customer,
      team: [{ email: ctx.user.email, role: "owner" as AdminRole, name: ctx.user.name }, ...demoCatalog(s).team],
    };
  }
  const sb = supabaseAdmin(),
    platform = platformCompanyId(),
    week = iso(now - 7 * DAY);
  const [fails, attempts, adminRows, grants, cust, disabled, catalog] = await Promise.all([
    sb.from("audit_events").select("target,created_at").eq("company_id", platform).eq("action", "login_failed").gte("created_at", week).order("created_at", { ascending: false }).limit(5000),
    sb.from("share_attempts").select("token_hash,client_hash,created_at").order("created_at", { ascending: false }).limit(5000),
    sb.from("audit_events").select("action,target,created_at").eq("company_id", platform).like("action", "admin\\_%").order("created_at", { ascending: false }).limit(200),
    sb.from("plan_grants").select("company_id,plan,days,granted_by,created_at,revoked_at,revoked_by,companies(name)").order("created_at", { ascending: false }).limit(100),
    sb.from("audit_events").select("company_id,action,target,created_at,companies(name)").in("action", Object.keys(sensitiveActions)).neq("company_id", platform).gte("created_at", week).order("created_at", { ascending: false }).limit(100),
    sb.from("memberships").select("user_id", { count: "exact", head: true }).eq("disabled", true),
    loadCatalog(),
  ]);
  for (const x of [fails, attempts, adminRows, grants, cust]) dbError(x.error);
  const nameOf = (c: unknown) => (Array.isArray(c) ? c[0]?.name : (c as { name?: string } | null)?.name) || "";
  // Which company an email belongs to (for the failed sign-in list).
  const emails = [...new Set(((fails.data || []) as { target: string }[]).map((f) => f.target.split("|")[0]))].slice(0, 200);
  const owners = emails.length ? await sb.from("memberships").select("email,companies(name)").in("email", emails) : { data: [] };
  const emailCo = new Map(((owners.data || []) as unknown as { email: string; companies: unknown }[]).map((m) => [m.email, nameOf(m.companies)]));
  const rows = ((fails.data || []) as { target: string; created_at: string }[]).map((f) => {
    const [email, ip = "", reason = ""] = f.target.split("|");
    return { at: f.created_at, email, ip, reason: reasonText(reason) };
  });
  const { logins, hourly } = shapeLogins(rows, now, (e) => emailCo.get(e));
  // share_attempts keeps one day: group by link, look the link up by its hash.
  type Att = { token_hash: string; client_hash: string; created_at: string };
  const atts = (attempts.data || []) as Att[],
    byToken = new Map<string, Att[]>();
  for (const a of atts) byToken.set(a.token_hash, [...(byToken.get(a.token_hash) || []), a]);
  const hashes = [...byToken.keys()].slice(0, 100);
  const links = hashes.length ? await sb.from("dashboard_shares").select("token_hash,label,revoked_at,companies(name)").in("token_hash", hashes) : { data: [] };
  const linkOf = new Map(((links.data || []) as unknown as { token_hash: string; label: string; revoked_at: string | null; companies: unknown }[]).map((l) => [l.token_hash, l]));
  const shares: ShareProbe[] = hashes
    .map((h) => {
      const list = byToken.get(h)!,
        l = linkOf.get(h),
        recent = list.filter((a) => now - Date.parse(a.created_at) < 15 * 60000).length;
      return {
        token: h.slice(0, 6),
        company: l ? nameOf(l.companies) : "ลิงก์ที่ไม่มีอยู่จริง",
        label: l?.label || "(เดาลิงก์)",
        attempts: list.length,
        clients: new Set(list.map((a) => a.client_hash)).size,
        last: list[0].created_at,
        blocked: recent >= 20,
        revoked: !!l?.revoked_at,
      };
    })
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 40);
  const clientHour = new Map<string, number>();
  for (const a of atts) if (now - Date.parse(a.created_at) < 3600000) clientHour.set(a.client_hash, (clientHour.get(a.client_hash) || 0) + 1);
  const adminLog: AdminLogRow[] = [
    ...((adminRows.data || []) as { action: string; target: string; created_at: string }[]).map((a) => {
      const t = actorOf(a.target);
      return { at: a.created_at, by: t.by, action: a.action.replace(/^admin_/, ""), text: t.text };
    }),
    ...((grants.data || []) as unknown as { plan: string; days: number; granted_by: string; created_at: string; revoked_at: string | null; revoked_by: string | null; companies: unknown }[]).flatMap((g) => [
      { at: g.created_at, by: g.granted_by, action: "grant", text: `มอบแพ็กเกจ ${g.plan} ${g.days} วัน ให้ ${nameOf(g.companies)}` },
      ...(g.revoked_at ? [{ at: g.revoked_at, by: g.revoked_by || "", action: "revoke", text: `ยกเลิกแพ็กเกจที่มอบให้ ${nameOf(g.companies)}` }] : []),
    ]),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 200);
  return {
    totals: {
      fails24: hourly.reduce((a, b) => a + b, 0),
      fails7: rows.length,
      flagged: logins.filter((l) => l.count24 >= FLAG).length,
      shareAttempts: atts.length,
      blockedLinks: shares.filter((x) => x.blocked).length,
      blockedClients: [...clientHour.values()].filter((n) => n >= 30).length,
      adminActions7: adminLog.filter((a) => now - Date.parse(a.at) < 7 * DAY).length,
      disabledUsers: disabled.count || 0,
    },
    hourly,
    logins,
    shares,
    adminLog,
    customer: ((cust.data || []) as unknown as { company_id: string; action: string; target: string; created_at: string; companies: unknown }[]).map((a) => ({
      at: a.created_at,
      company_id: a.company_id,
      company: nameOf(a.companies),
      action: a.action,
      target: a.target,
    })),
    team: [...ownerEmails().map((email) => ({ email, role: "owner" as AdminRole })), ...catalog.team],
  };
}

/** A failed sign-in, kept a week for ความปลอดภัย. Never blocks or slows the sign-in itself. */
export async function recordLoginFailure(email: string, ip: string, reason: string) {
  try {
    const ipHash = createHash("sha256").update(ip + (process.env.SUPABASE_SERVICE_ROLE_KEY || "").slice(0, 8)).digest("hex").slice(0, 10);
    await supabaseAdmin()
      .from("audit_events")
      .insert({ company_id: platformCompanyId(), action: "login_failed", target: `${email.toLowerCase().slice(0, 120)}|${ipHash}|${reason.slice(0, 80)}` });
  } catch {
    // Logging must never break signing in.
  }
}
