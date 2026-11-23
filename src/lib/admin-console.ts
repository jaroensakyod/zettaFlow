// Admin console (หลังบ้าน) for platform operators: an overview of the whole platform, every company with its package
// and how it got it, every user, and package grants (give / revoke a package for a set time). Platform admins only
// (PLATFORM_ADMIN_EMAILS); reads go through the service role, writes through admin_grant_plan / admin_revoke_grant
// (0079_admin_plan_grants.sql). It shows usage and account data only — never a customer's business records.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "./supabase/server";
import { demoMutate, demoRead, type DemoState } from "./demo";
import { assert } from "./domain";
import { dbError } from "./data";
import { platformAdmin, platformViewer } from "./platform";
import { freePlan, plans, type PlanId } from "./billing";
import type { Context } from "./types";

export const grantKinds = { trial: "ทดลองใช้", gift: "ของแถม / โปรโมชัน", partner: "พาร์ทเนอร์", compensation: "ชดเชย", offline: "จ่ายนอกระบบ" } as const;
export type GrantKind = keyof typeof grantKinds;
/** How a company holds its package. */
export type Via = "paid" | "grant" | "trial" | "free";

export type AdminCompany = {
  id: string;
  name: string;
  industry: string;
  province: string;
  created_at: string;
  plan: PlanId;
  cycle: "monthly" | "yearly";
  status: string;
  period_end: string | null;
  via: Via;
  grant_kind?: GrantKind;
  members: number;
  users_limit: number | null;
  owner_email: string;
  owner_name: string;
  /** The people using its seats (owner first), for the small faces in the ผู้ใช้ column. */
  people?: { user_id: string; name: string; email: string; role: string; avatar_at: string | null; photo: string | null }[];
};
export type AdminUser = { user_id: string; email: string; name: string; role: string; disabled: boolean; company_id: string; company: string; created_at?: string | null; last_sign_in_at?: string | null; avatar_at?: string | null; photo?: string | null };
export type AdminGrant = {
  id: string;
  company_id: string;
  company?: string;
  plan: PlanId;
  kind: GrantKind;
  days: number;
  extra_users: number;
  reason: string;
  starts_at: string;
  ends_at: string;
  granted_by: string;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
};
export type FeedItem = { at: string; kind: "signup" | "paid" | "pending" | "grant" | "revoke" | "failed" | "support"; text: string; company_id?: string };
export type Overview = {
  range: number;
  totals: { companies: number; paid: number; trial: number; users: number; activeToday: number; newCompanies: number; newPrev: number };
  mrr: number;
  revenue: { range: number; today: number; prev: number };
  ai: { month: number; prevMonth: number };
  todo: { slips: number; topups: number; support: number; expiring: number; failed: number; grantsEnding: number };
  plans: { id: PlanId; name: string; companies: number; mrr: number }[];
  /** Daily bars (up to 31 days) or monthly bars (the year view). */
  series: { day: string; label: string; signups: number; paid: number }[];
  /** Running totals of companies and paying customers over the same buckets (for the small KPI lines). */
  growth: { companies: number[]; paid: number[] };
  feed: FeedItem[];
};

/** Read access to หลังบ้าน (view-only team members included). */
export const requireAdmin = (ctx: Context) => assert(platformViewer(ctx), "เฉพาะผู้ดูแลแพลตฟอร์ม", 403);
/** Changing anything: owners and admins, not view-only members. */
export const requireAdminWrite = (ctx: Context) => {
  requireAdmin(ctx);
  assert(platformAdmin(ctx), "บัญชีนี้ดูได้อย่างเดียว แก้ไขไม่ได้", 403);
};
export const DAY = 86400000;
export const planOf = (id: string) => plans.find((p) => p.id === id) || freePlan;
/** Bangkok calendar day (YYYY-MM-DD) of a timestamp. */
export const bkkDay = (t: string | number) => new Date(new Date(t).getTime() + 7 * 3600000).toISOString().slice(0, 10);
const bkkStartOfToday = () => Date.parse(bkkDay(Date.now()) + "T00:00:00+07:00");

type Sub = { company_id: string; plan: string; cycle: "monthly" | "yearly"; status: string; trial_ends_at: string | null; current_period_end: string | null; extra_users: number };
type Member = { company_id: string; user_id: string; email: string; name: string; role: string; disabled: boolean };
export type Raw = {
  companies: { id: string; name: string; created_at: string; industry: string | null; province: string | null }[];
  subs: Sub[];
  members: Member[];
  grants: AdminGrant[];
  payments: { id: string; company_id: string; amount: number; status: string; created_at: string; plan: string }[];
  topupsPending: number;
  supportUnread: number;
  failed: { id: string; company_id: string; created_at: string; error: string | null }[];
  ai: { cost_usd: number | null; created_at: string }[];
  actors: string[];
  support: { company_id: string; created_at: string; body: string }[];
};

function subActive(s: Sub | undefined, now = Date.now()) {
  if (!s) return false;
  if (s.status === "trial") return !!s.trial_ends_at && Date.parse(s.trial_ends_at) > now;
  if (s.status !== "active") return false;
  return !s.current_period_end || Date.parse(s.current_period_end) > now - 3 * DAY;
}

export function shapeCompanies(r: Raw): AdminCompany[] {
  const subs = new Map(r.subs.map((s) => [s.company_id, s]));
  const now = Date.now();
  return r.companies.map((c) => {
    const s = subs.get(c.id),
      active = subActive(s, now),
      members = r.members.filter((m) => m.company_id === c.id && !m.disabled),
      owner = members.find((m) => m.role === "owner") || r.members.find((m) => m.company_id === c.id && m.role === "owner"),
      plan = (active && s ? s.plan : "free") as PlanId,
      grant = r.grants.find((g) => g.company_id === c.id && !g.revoked_at && Date.parse(g.ends_at) > now && g.plan === plan),
      via: Via = plan === "free" ? "free" : s?.status === "trial" ? "trial" : grant ? "grant" : "paid",
      p = planOf(plan);
    return {
      id: c.id,
      name: c.name,
      industry: c.industry || "",
      province: c.province || "",
      created_at: c.created_at,
      plan,
      cycle: s?.cycle || "monthly",
      status: active ? s?.status || "active" : "free",
      period_end: plan === "free" ? null : s?.status === "trial" ? s?.trial_ends_at || null : s?.current_period_end || null,
      via,
      grant_kind: grant?.kind,
      members: members.length,
      users_limit: p.users === null ? null : p.users + (s?.extra_users || 0),
      owner_email: owner?.email || "",
      owner_name: owner?.name || "",
    };
  });
}

function shapeOverview(r: Raw, range: number): Overview {
  const now = Date.now(),
    from = now - range * DAY,
    prevFrom = from - range * DAY,
    today = bkkStartOfToday(),
    companies = shapeCompanies(r),
    paid = companies.filter((c) => c.via === "paid" || (c.via === "grant" && c.grant_kind === "offline")),
    monthly = (c: AdminCompany) => {
      const p = planOf(c.plan);
      return c.cycle === "yearly" ? p.yearly / 12 : p.monthly;
    };
  const verified = r.payments.filter((p) => p.status === "verified"),
    sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + Number(x.amount || 0), 0),
    monthStart = Date.parse(bkkDay(now).slice(0, 7) + "-01T00:00:00+07:00"),
    prevMonthStart = (() => {
      const d = new Date(monthStart + 7 * 3600000);
      d.setUTCMonth(d.getUTCMonth() - 1);
      return Date.parse(d.toISOString().slice(0, 7) + "-01T00:00:00+07:00");
    })(),
    aiSum = (a: number, b: number) => r.ai.filter((x) => Date.parse(x.created_at) >= a && Date.parse(x.created_at) < b).reduce((t, x) => t + Number(x.cost_usd || 0), 0);
  const byMonth = range > 31,
    buckets: { day: string; label: string; from: number; to: number }[] = byMonth
      ? Array.from({ length: 12 }, (_, i) => {
          const d = new Date(Date.parse(bkkDay(now).slice(0, 7) + "-01T00:00:00+07:00") + 7 * 3600000);
          d.setUTCMonth(d.getUTCMonth() - (11 - i));
          const start = Date.parse(d.toISOString().slice(0, 7) + "-01T00:00:00+07:00");
          d.setUTCMonth(d.getUTCMonth() + 1);
          const end = Date.parse(d.toISOString().slice(0, 7) + "-01T00:00:00+07:00");
          return { day: bkkDay(start), label: new Date(start).toLocaleDateString("th-TH", { month: "short", timeZone: "Asia/Bangkok" }), from: start, to: end };
        })
      : Array.from({ length: Math.max(range, 14) }, (_, i) => {
          const day = bkkDay(now - (Math.max(range, 14) - 1 - i) * DAY),
            start = Date.parse(day + "T00:00:00+07:00");
          return { day, label: String(Number(day.slice(8))), from: start, to: start + DAY };
        });
  const inB = (t: string, b: { from: number; to: number }) => Date.parse(t) >= b.from && Date.parse(t) < b.to,
    series = buckets.map((b) => ({ day: b.day, label: b.label, signups: r.companies.filter((c) => inB(c.created_at, b)).length, paid: verified.filter((p) => inB(p.created_at, b)).length }));
  const growth = {
    companies: buckets.map((b) => r.companies.filter((c) => Date.parse(c.created_at) < b.to).length),
    paid: buckets.map((b) => new Set(verified.filter((p) => Date.parse(p.created_at) < b.to).map((p) => p.company_id)).size),
  };
  const name = (id?: string) => r.companies.find((c) => c.id === id)?.name || "บริษัท";
  const feed: FeedItem[] = [
    ...r.companies.map((c) => ({ at: c.created_at, kind: "signup" as const, text: c.name + " สมัครใช้งาน", company_id: c.id })),
    ...r.payments.map((p) => ({
      at: p.created_at,
      kind: p.status === "verified" ? ("paid" as const) : ("pending" as const),
      text: name(p.company_id) + (p.status === "verified" ? " ชำระ " : " ส่งสลิป ") + planOf(p.plan).name + " ฿" + Number(p.amount).toLocaleString("th-TH"),
      company_id: p.company_id,
    })),
    ...r.grants.map((g) => ({ at: g.revoked_at || g.created_at, kind: g.revoked_at ? ("revoke" as const) : ("grant" as const), text: (g.revoked_at ? "ยกเลิก " : "มอบ ") + planOf(g.plan).name + " ให้ " + name(g.company_id), company_id: g.company_id })),
    ...r.failed.map((f) => ({ at: f.created_at, kind: "failed" as const, text: "งานล้มเหลวที่ " + name(f.company_id), company_id: f.company_id })),
    ...r.support.map((m) => ({ at: m.created_at, kind: "support" as const, text: name(m.company_id) + ": " + m.body.slice(0, 60), company_id: m.company_id })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 14);
  return {
    range,
    totals: {
      companies: companies.length,
      paid: paid.length,
      trial: companies.filter((c) => c.via === "trial").length,
      users: new Set(r.members.filter((m) => !m.disabled).map((m) => m.user_id)).size,
      activeToday: new Set(r.actors).size,
      newCompanies: r.companies.filter((c) => Date.parse(c.created_at) >= from).length,
      newPrev: r.companies.filter((c) => Date.parse(c.created_at) >= prevFrom && Date.parse(c.created_at) < from).length,
    },
    mrr: Math.round(paid.reduce((a, c) => a + monthly(c), 0)),
    revenue: {
      range: sum(verified.filter((p) => Date.parse(p.created_at) >= from)),
      today: sum(verified.filter((p) => Date.parse(p.created_at) >= today)),
      prev: sum(verified.filter((p) => Date.parse(p.created_at) >= prevFrom && Date.parse(p.created_at) < from)),
    },
    ai: { month: Math.round(aiSum(monthStart, now + DAY) * 100) / 100, prevMonth: Math.round(aiSum(prevMonthStart, monthStart) * 100) / 100 },
    todo: {
      slips: r.payments.filter((p) => p.status === "pending").length,
      topups: r.topupsPending,
      support: r.supportUnread,
      expiring: companies.filter((c) => c.plan !== "free" && c.period_end && Date.parse(c.period_end) > now && Date.parse(c.period_end) < now + 7 * DAY).length,
      failed: r.failed.filter((f) => Date.parse(f.created_at) > now - DAY).length,
      grantsEnding: r.grants.filter((g) => !g.revoked_at && Date.parse(g.ends_at) > now && Date.parse(g.ends_at) < now + 7 * DAY).length,
    },
    plans: [freePlan, ...plans].map((p) => {
      const list = companies.filter((c) => c.plan === p.id);
      return { id: p.id, name: p.name, companies: list.length, mrr: Math.round(list.filter((c) => paid.includes(c)).reduce((a, c) => a + monthly(c), 0)) };
    }),
    series,
    growth,
    feed,
  };
}

// ---------- data ----------
async function rawLive(): Promise<Raw> {
  const sb = supabaseAdmin(),
    now = Date.now(),
    since = new Date(now - 400 * DAY).toISOString(),
    aiSince = new Date(now - 70 * DAY).toISOString(),
    today = new Date(bkkStartOfToday()).toISOString();
  const [companies, subs, members, grants, payments, topups, support, failed, ai, actors, supportMsgs] = await Promise.all([
    sb.from("companies").select("id,name,created_at,industry:profile->>industry,province:profile->>province").order("created_at", { ascending: false }).limit(5000),
    sb.from("subscriptions").select("company_id,plan,cycle,status,trial_ends_at,current_period_end,extra_users").limit(5000),
    sb.from("memberships").select("company_id,user_id,email,name,role,disabled").limit(20000),
    sb.from("plan_grants").select("*").order("created_at", { ascending: false }).limit(2000),
    sb.from("billing_payments").select("id,company_id,amount,status,created_at,plan").gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
    sb.from("coin_topups").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("support_threads").select("company_id", { count: "exact", head: true }).gt("unread_admin", 0),
    sb.from("ingestions").select("id,company_id,created_at,error").eq("status", "failed").gte("created_at", new Date(now - 7 * DAY).toISOString()).order("created_at", { ascending: false }).limit(200),
    sb.from("ai_usage").select("cost_usd,created_at").gte("created_at", aiSince).limit(100000),
    sb.from("audit_events").select("actor").gte("created_at", today).not("actor", "is", null).limit(20000),
    sb.from("support_messages").select("company_id,created_at,body").eq("sender", "customer").order("created_at", { ascending: false }).limit(10),
  ]);
  dbError(companies.error);
  dbError(subs.error);
  dbError(members.error);
  // plan_grants arrives with 0079; until then the page still works without grants.
  return {
    companies: (companies.data || []) as Raw["companies"],
    subs: (subs.data || []) as Sub[],
    members: (members.data || []) as Member[],
    grants: (grants.error ? [] : grants.data || []) as AdminGrant[],
    payments: (payments.data || []) as Raw["payments"],
    topupsPending: topups.count || 0,
    supportUnread: support.count || 0,
    failed: (failed.data || []) as Raw["failed"],
    ai: (ai.data || []) as Raw["ai"],
    actors: ((actors.data || []) as { actor: string }[]).map((a) => a.actor),
    support: (supportMsgs.data || []) as Raw["support"],
  };
}

// Demo: the demo company plus sample companies, so every screen can be tried without a database.
export type DemoAdmin = DemoState & { adminGrants?: AdminGrant[] };
const sampleNames = [
  ["ร้านมะลิ คาเฟ่", "ร้านอาหารและคาเฟ่", "เชียงใหม่", "growth", "paid"],
  ["สยามพิวรรณ จำกัด", "ค้าปลีก", "กรุงเทพมหานคร", "business", "paid"],
  ["กวางน้อย จำกัด", "ค้าปลีก", "ปทุมธานี", "starter", "trial"],
  ["บ้านสวนรีสอร์ท", "โรงแรมและรีสอร์ต", "ภูเก็ต", "growth", "paid"],
  ["ทรัพย์ทวีก่อสร้าง", "รับเหมาก่อสร้าง", "ชลบุรี", "enterprise", "paid"],
  ["คลินิกหมอใจดี", "คลินิกความงาม", "กรุงเทพมหานคร", "starter", "paid"],
  ["ฟู้ดแลนด์ซัพพลาย", "ค้าส่ง", "นนทบุรี", "free", "free"],
  ["ไทยโลจิสติกส์", "ขนส่งและโลจิสติกส์", "สมุทรปราการ", "business", "paid"],
  ["สตูดิโอแสงดี", "สตูดิโอถ่ายภาพ", "ขอนแก่น", "free", "free"],
  ["มิตรภาพการเกษตร", "เกษตรกรรม", "นครราชสีมา", "free", "free"],
  ["เอเชียทีค อีเวนต์", "อีเวนต์และออแกไนซ์", "กรุงเทพมหานคร", "growth", "paid"],
  ["โรงเรียนกวดวิชาเก่ง", "สถาบันกวดวิชา", "พิษณุโลก", "free", "free"],
] as const;
export function rawDemo(s: DemoAdmin): Raw {
  const now = Date.now(),
    iso = (ms: number) => new Date(ms).toISOString(),
    id = (i: number) => `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
  const companies: Raw["companies"] = [
    { id: s.company.id, name: s.company.name, created_at: iso(now - 40 * DAY), industry: String(s.company.profile?.industry || ""), province: "" },
    ...sampleNames.map(([name, industry, province], i) => ({ id: id(i), name, created_at: iso(now - (i * 3 + 1) * DAY - i * 3600000), industry, province })),
  ];
  const subs: Sub[] = [
    { company_id: s.company.id, plan: "growth", cycle: "monthly", status: "trial", trial_ends_at: iso(now + 10 * DAY), current_period_end: null, extra_users: 0 },
    ...sampleNames.map(([, , , plan, via], i) => ({
      company_id: id(i),
      plan,
      cycle: (i % 3 === 0 ? "yearly" : "monthly") as Sub["cycle"],
      status: via === "trial" ? "trial" : "active",
      trial_ends_at: iso(now + 3 * DAY),
      current_period_end: plan === "free" ? null : iso(now + (i === 5 ? 4 : 20 + i * 5) * DAY),
      extra_users: 0,
    })),
  ];
  // Grants apply over the samples like the real admin_grant_plan.
  const grants = s.adminGrants || [];
  for (const g of [...grants].reverse()) {
    const sub = subs.find((x) => x.company_id === g.company_id);
    if (!sub || g.revoked_at) continue;
    Object.assign(sub, { plan: g.plan, status: "active", current_period_end: g.ends_at, extra_users: Math.max(sub.extra_users, g.extra_users) });
  }
  const members: Member[] = [
    ...s.members.map((m) => ({ company_id: s.company.id, user_id: m.user_id, email: m.email, name: m.name, role: m.role, disabled: !!m.disabled })),
    ...sampleNames.flatMap(([name], i) =>
      Array.from({ length: (i % 4) + 1 }, (_, k) => ({
        company_id: id(i),
        user_id: `30000000-0000-4000-8000-${String(i * 10 + k).padStart(12, "0")}`,
        email: k ? `staff${k}@sample${i + 1}.co.th` : `owner@sample${i + 1}.co.th`,
        name: k ? `พนักงาน ${k} · ${name}` : `เจ้าของ ${name}`,
        role: k ? "staff" : "owner",
        disabled: false,
      })),
    ),
  ];
  const payments: Raw["payments"] = sampleNames
    .map(([, , , plan, via], i) => ({ plan, via, i }))
    .filter((x) => x.via === "paid")
    .map(({ plan, i }) => ({ id: `p${i}`, company_id: id(i), amount: planOf(plan).monthly, status: "verified", created_at: iso(now - (i * 2 + 0.2) * DAY), plan }));
  payments.push({ id: "pending1", company_id: id(8), amount: planOf("starter").monthly, status: "pending", created_at: iso(now - 0.05 * DAY), plan: "starter" });
  return {
    companies,
    subs,
    members,
    grants,
    payments,
    topupsPending: 1,
    supportUnread: 2,
    failed: [{ id: "f1", company_id: id(3), created_at: iso(now - 0.3 * DAY), error: "LINE reply failed" }],
    ai: Array.from({ length: 50 }, (_, i) => ({ cost_usd: 0.6 + (i % 5) * 0.3, created_at: iso(now - i * 1.2 * DAY) })),
    actors: s.members.map((m) => m.user_id).concat(["a", "b", "c", "d"]),
    support: [{ company_id: id(1), created_at: iso(now - 0.1 * DAY), body: "สอบถามการเพิ่มผู้ใช้เกินแพ็กเกจค่ะ" }],
  };
}
export const raw = async (ctx: Context) => (ctx.demo ? rawDemo((await demoRead()) as DemoAdmin) : rawLive());

// ---------- API ----------
export async function adminOverview(ctx: Context, range: unknown) {
  requireAdmin(ctx);
  const days = z.coerce.number().int().min(1).max(366).catch(30).parse(range ?? 30);
  return shapeOverview(await raw(ctx), days);
}
const roleOrder: Record<string, number> = { owner: 0, manager: 1, staff: 2, viewer: 3 };
export async function adminCompanies(ctx: Context) {
  requireAdmin(ctx);
  const r = await raw(ctx),
    look = await looks(ctx, r.members),
    people = new Map<string, NonNullable<AdminCompany["people"]>>();
  for (const m of [...r.members].sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9))) {
    if (m.disabled) continue;
    const l = look.get(m.company_id + "/" + m.user_id),
      list = people.get(m.company_id) || [];
    list.push({ user_id: m.user_id, name: l?.name || m.name || m.email, email: m.email, role: m.role, avatar_at: l?.avatar_at || null, photo: l?.photo || null });
    people.set(m.company_id, list);
  }
  return shapeCompanies(r)
    .map((c) => ({ ...c, people: people.get(c.id) || [] }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function adminCompany(ctx: Context, id: string) {
  requireAdmin(ctx);
  const cid = z.uuid().parse(id),
    r = await raw(ctx),
    company = shapeCompanies(r).find((c) => c.id === cid);
  assert(company, "ไม่พบบริษัท", 404);
  const members = r.members.filter((m) => m.company_id === cid),
    look = await looks(ctx, members);
  return {
    company,
    members: members.map((m) => {
      const l = look.get(m.company_id + "/" + m.user_id);
      return { ...m, name: l?.name || m.name, avatar_at: l?.avatar_at || null, photo: l?.photo || null };
    }),
    grants: r.grants.filter((g) => g.company_id === cid),
    payments: r.payments.filter((p) => p.company_id === cid),
  };
}
export async function adminUsers(ctx: Context) {
  requireAdmin(ctx);
  const r = await raw(ctx),
    names = new Map(r.companies.map((c) => [c.id, c.name]));
  let seen = new Map<string, { created_at?: string | null; last_sign_in_at?: string | null; account?: string }>();
  if (!ctx.demo) {
    // Sign-up and last sign-in come from Supabase Auth (up to 5,000 users).
    const auth = supabaseAdmin().auth.admin;
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await auth.listUsers({ page, perPage: 1000 });
      if (error || !data?.users.length) break;
      for (const u of data.users) seen.set(u.id, { created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, account: String(u.user_metadata?.name || "").trim() || undefined });
      if (data.users.length < 1000) break;
    }
  } else seen = new Map(r.members.map((m, i) => [m.user_id, { created_at: new Date(Date.now() - (i + 2) * DAY).toISOString(), last_sign_in_at: new Date(Date.now() - i * 5 * 3600000).toISOString() }]));
  // Name: the employee record with this email, then the name on the account, then the membership.
  const look = await looks(ctx, r.members);
  return r.members.map((m): AdminUser => {
    const { account, ...when } = seen.get(m.user_id) || {},
      l = look.get(m.company_id + "/" + m.user_id);
    return { ...m, name: l?.name || account || m.name, company: names.get(m.company_id) || "", ...when, avatar_at: l?.avatar_at || null, photo: l?.photo || null };
  });
}
export async function adminGrants(ctx: Context) {
  requireAdmin(ctx);
  const r = await raw(ctx),
    names = new Map(r.companies.map((c) => [c.id, c.name]));
  return r.grants.map((g) => ({ ...g, company: names.get(g.company_id) || "" }));
}

const grantInput = z.object({
  company_id: z.uuid(),
  plan: z.enum(["starter", "growth", "business", "enterprise"]),
  kind: z.enum(Object.keys(grantKinds) as [GrantKind, ...GrantKind[]]),
  days: z.coerce.number().int().min(1).max(3660),
  extra_users: z.coerce.number().int().min(0).max(1000).default(0),
  reason: z.string().trim().min(1, "ใส่เหตุผลที่มอบแพ็กเกจ").max(500),
});
export async function grantPlan(ctx: Context, input: unknown) {
  requireAdminWrite(ctx);
  const g = grantInput.parse(input),
    by = ctx.user.email;
  if (ctx.demo)
    return demoMutate((s: DemoAdmin) => {
      const r = rawDemo(s),
        sub = r.subs.find((x) => x.company_id === g.company_id);
      assert(sub, "ไม่พบบริษัท", 404);
      const running = sub.plan === g.plan && sub.status === "active" && sub.current_period_end && Date.parse(sub.current_period_end) > Date.now();
      const base = running ? Date.parse(sub.current_period_end!) : Date.now();
      const row: AdminGrant = {
        id: randomUUID(),
        ...g,
        starts_at: new Date().toISOString(),
        ends_at: new Date(base + g.days * DAY).toISOString(),
        granted_by: by,
        revoked_at: null,
        revoked_by: null,
        created_at: new Date().toISOString(),
      };
      (s.adminGrants ??= []).unshift(row);
      return row;
    });
  const { data, error } = await supabaseAdmin().rpc("admin_grant_plan", {
    p_company: g.company_id,
    p_plan: g.plan,
    p_kind: g.kind,
    p_days: g.days,
    p_extra_users: g.extra_users,
    p_reason: g.reason,
    p_by: by,
  });
  dbError(error);
  return data as AdminGrant;
}
export async function revokeGrant(ctx: Context, id: string) {
  requireAdminWrite(ctx);
  const gid = z.string().min(1).max(64).parse(id),
    by = ctx.user.email;
  if (ctx.demo)
    return demoMutate((s: DemoAdmin) => {
      const list = s.adminGrants || [],
        g = list.find((x) => x.id === gid);
      assert(g && !g.revoked_at, "สิทธิ์นี้ถูกยกเลิกไปแล้ว");
      assert(!list.some((x) => x.company_id === g.company_id && x.created_at > g.created_at && !x.revoked_at), "มีการมอบแพ็กเกจที่ใหม่กว่านี้ ยกเลิกรายการล่าสุดก่อน");
      Object.assign(g, { revoked_at: new Date().toISOString(), revoked_by: by });
      return g;
    });
  const { data, error } = await supabaseAdmin().rpc("admin_revoke_grant", { p_id: z.uuid().parse(gid), p_by: by });
  dbError(error);
  return data as AdminGrant;
}

// ---------- how each person looks in the system ----------
/** A member's name and picture as the company knows them: the employee record with the same email (HR → พนักงาน)
 *  gives the real name and photo; a picture the person uploaded themself (user_profiles.avatar_at) wins over it. */
export type Look = { name?: string; avatar_at?: string | null; photo?: string | null };
export async function looks(ctx: Context, members: { company_id: string; user_id: string; email: string }[]): Promise<Map<string, Look>> {
  const out = new Map<string, Look>();
  if (ctx.demo || !members.length) return out;
  const sb = supabaseAdmin(),
    companies = [...new Set(members.map((m) => m.company_id))],
    users = [...new Set(members.map((m) => m.user_id))];
  const [profiles, employees] = await Promise.all([
    sb.from("user_profiles").select("user_id,avatar_at").in("user_id", users),
    sb.from("entities").select("company_id,data").eq("kind", "employees").is("archived_at", null).in("company_id", companies).limit(20000),
  ]);
  const avatar = new Map(((profiles.data || []) as { user_id: string; avatar_at: string | null }[]).map((p) => [p.user_id, p.avatar_at])),
    staff = new Map<string, { name?: string; photo?: string }>();
  for (const e of (employees.data || []) as { company_id: string; data: Record<string, unknown> | string }[]) {
    const d = (typeof e.data === "string" ? JSON.parse(e.data) : e.data) as Record<string, unknown>,
      email = String(d.email || "").trim().toLowerCase();
    if (email) staff.set(e.company_id + "/" + email, { name: String(d.name || "").trim() || undefined, photo: d.photo ? String(d.photo) : undefined });
  }
  for (const m of members) {
    const e = staff.get(m.company_id + "/" + m.email.trim().toLowerCase());
    out.set(m.company_id + "/" + m.user_id, { name: e?.name, avatar_at: avatar.get(m.user_id) || null, photo: e?.photo || null });
  }
  return out;
}

/** An employee photo for หลังบ้าน (admins are not members of the customer company, so /api/files does not serve it). */
export async function adminPhoto(ctx: Context, id: string) {
  requireAdmin(ctx);
  assert(!ctx.demo, "ไม่พบรูป", 404);
  const sb = supabaseAdmin();
  const { data: a } = await sb.from("attachments").select("path,mime").eq("id", z.uuid().parse(id)).maybeSingle();
  assert(a && /^image\/(png|jpeg|webp|gif)$/.test(String(a.mime)), "ไม่พบรูป", 404);
  const { data, error } = await sb.storage.from("eliteflow-files").download(String(a!.path));
  assert(!error && data, "อ่านรูปไม่ได้", 404);
  return { mime: String(a!.mime), bytes: new Uint8Array(await data!.arrayBuffer()) };
}
