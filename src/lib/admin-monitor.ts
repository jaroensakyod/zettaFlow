// Admin console phase 2: AI cost, LINE Bot and system health monitors. Read-only views over existing tables
// (ai_usage, line_groups, ingestions, notification_outbox) through the service role; platform admins only.
import { z } from "zod";
import { supabaseAdmin } from "./supabase/server";
import { demoRead } from "./demo";
import { dbError } from "./data";
import { bkkDay, DAY, planOf, raw, rawDemo, requireAdmin, shapeCompanies, type DemoAdmin } from "./admin-console";
import type { PlanId } from "./billing";
import type { Context } from "./types";

const since = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const dayKeys = (days: number) => Array.from({ length: days }, (_, i) => bkkDay(Date.now() - (days - 1 - i) * DAY));
const rangeOf = (range: unknown) => z.coerce.number().int().min(1).max(366).catch(30).parse(range ?? 30);
const round2 = (n: number) => Math.round(n * 100) / 100;
async function companyIndex(ctx: Context) {
  const r = await raw(ctx);
  return { names: new Map(r.companies.map((c) => [c.id, c.name])), companies: shapeCompanies(r) };
}
const demoCompanies = async () => rawDemo((await demoRead()) as DemoAdmin).companies;

// ---------- AI · ต้นทุน ----------
export type AiReport = {
  range: number;
  total: { cost: number; calls: number; input: number; output: number; prevCost: number };
  daily: { day: string; cost: number }[];
  byFeature: { key: string; cost: number; calls: number }[];
  byModel: { key: string; cost: number; calls: number }[];
  byCompany: { id: string; name: string; plan: PlanId; cost: number; calls: number; revenue: number }[];
};
type AiRow = { company_id: string; feature: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number | null; created_at: string };

export async function adminAi(ctx: Context, rangeIn: unknown): Promise<AiReport> {
  requireAdmin(ctx);
  const range = rangeOf(rangeIn);
  let rows: AiRow[];
  if (ctx.demo) {
    const cs = await demoCompanies(),
      feats = ["extract", "sort", "chat", "scan", "transcribe", "billing"],
      models = ["gemini-2.5-flash", "gpt-4.1-mini", "gemini-2.5-pro"];
    rows = Array.from({ length: 400 }, (_, i) => ({
      company_id: cs[(i * 3) % cs.length].id,
      feature: feats[(i * 7) % feats.length],
      model: models[(i * 5) % models.length],
      input_tokens: 1800 + (i % 9) * 400,
      output_tokens: 300 + (i % 5) * 90,
      cost_usd: 0.002 + ((i * 13) % 17) / 1000,
      created_at: new Date(Date.now() - ((i * 37) % (range * 48)) * 3600000).toISOString(),
    }));
  } else {
    const { data, error } = await supabaseAdmin()
      .from("ai_usage")
      .select("company_id,feature,model,input_tokens,output_tokens,cost_usd,created_at")
      .gte("created_at", since(range * 2))
      .limit(200000);
    dbError(error);
    rows = (data || []) as AiRow[];
  }
  const from = Date.now() - range * DAY,
    cur = rows.filter((x) => Date.parse(x.created_at) >= from),
    prev = rows.filter((x) => Date.parse(x.created_at) < from),
    cost = (xs: AiRow[]) => xs.reduce((a, x) => a + Number(x.cost_usd || 0), 0),
    group = (key: (x: AiRow) => string) => {
      const m = new Map<string, { cost: number; calls: number }>();
      for (const x of cur) {
        const k = key(x) || "อื่นๆ",
          v = m.get(k) || { cost: 0, calls: 0 };
        v.cost += Number(x.cost_usd || 0);
        v.calls++;
        m.set(k, v);
      }
      return [...m].map(([k, v]) => ({ key: k, cost: round2(v.cost), calls: v.calls })).sort((a, b) => b.cost - a.cost);
    };
  const { names, companies } = await companyIndex(ctx);
  return {
    range,
    total: {
      cost: round2(cost(cur)),
      calls: cur.length,
      input: cur.reduce((a, x) => a + Number(x.input_tokens || 0), 0),
      output: cur.reduce((a, x) => a + Number(x.output_tokens || 0), 0),
      prevCost: round2(cost(prev)),
    },
    daily: dayKeys(Math.min(Math.max(range, 7), 60)).map((day) => ({ day, cost: round2(cost(cur.filter((x) => bkkDay(x.created_at) === day))) })),
    byFeature: group((x) => x.feature),
    byModel: group((x) => x.model),
    byCompany: group((x) => x.company_id)
      .slice(0, 15)
      .map((g) => {
        const c = companies.find((x) => x.id === g.key),
          p = planOf(c?.plan || "free"),
          pays = !!c && (c.via === "paid" || (c.via === "grant" && c.grant_kind === "offline"));
        return {
          id: g.key,
          name: names.get(g.key) || "บริษัท",
          plan: (c?.plan || "free") as PlanId,
          cost: g.cost,
          calls: g.calls,
          // Package revenue over the same number of days, to set against the AI cost.
          revenue: pays ? Math.round((((c!.cycle === "yearly" ? p.yearly / 12 : p.monthly) * range) / 30) * 100) / 100 : 0,
        };
      }),
  };
}

// ---------- LINE Bot ----------
export type LineReport = {
  range: number;
  groups: { total: number; listenAll: number; newInRange: number; quiet: number };
  messages: { total: number; prev: number; approved: number; review: number; failed: number; skipped: number; waiting: number };
  daily: { day: string; total: number; failed: number }[];
  topGroups: { group_id: string; name: string; company: string; company_id: string; count: number; last: string | null }[];
  quietGroups: { group_id: string; name: string; company: string; company_id: string; last: string | null }[];
  recentFailed: { id: string; company: string; company_id: string; group: string; error: string; at: string }[];
};
type Group = { group_id: string; company_id: string; name: string; listen: string; created_at: string };
type Item = { id: string; company_id: string; group_id: string | null; group_name: string | null; status: string; error: string | null; created_at: string };

export async function adminLine(ctx: Context, rangeIn: unknown): Promise<LineReport> {
  requireAdmin(ctx);
  const range = rangeOf(rangeIn);
  let groups: Group[], items: Item[];
  if (ctx.demo) {
    const cs = (await demoCompanies()).slice(0, 10),
      statuses = ["approved", "approved", "approved", "review", "approved", "skipped", "failed", "draft", "approved"],
      errors = ["LINE reply failed (400): Invalid reply token", "AI timeout after 60s", "อ่านรูปไม่ได้"];
    groups = cs.flatMap((c, i) =>
      Array.from({ length: (i % 3) + 1 }, (_, k) => ({
        group_id: `G${i}-${k}`,
        company_id: c.id,
        name: ["ฝ่ายบัญชี", "ทีมขาย", "คลังสินค้า"][k] + " · " + c.name,
        listen: k ? "all" : "mention",
        created_at: new Date(Date.now() - (i * 4 + k) * DAY).toISOString(),
      })),
    );
    const active = groups.slice(0, groups.length - 3);
    items = Array.from({ length: 320 }, (_, i) => {
      const g = active[(i * 3) % active.length],
        status = statuses[i % statuses.length];
      return { id: "i" + i, company_id: g.company_id, group_id: g.group_id, group_name: g.name, status, error: status === "failed" ? errors[i % 3] : null, created_at: new Date(Date.now() - ((i * 29) % (range * 48)) * 3600000).toISOString() };
    });
  } else {
    const sb = supabaseAdmin();
    const [g, i] = await Promise.all([
      sb.from("line_groups").select("group_id,company_id,name,listen,created_at").limit(10000),
      sb
        .from("ingestions")
        .select("id,company_id,group_id,group_name,status,error,created_at")
        .eq("source", "LINE")
        .gte("created_at", since(Math.max(range * 2, 30)))
        .order("created_at", { ascending: false })
        .limit(100000),
    ]);
    dbError(g.error);
    dbError(i.error);
    groups = (g.data || []) as Group[];
    items = (i.data || []) as Item[];
  }
  const { names } = await companyIndex(ctx),
    from = Date.now() - range * DAY,
    cur = items.filter((x) => Date.parse(x.created_at) >= from),
    count = (...s: string[]) => cur.filter((x) => s.includes(x.status)).length,
    lastOf = new Map<string, string>(),
    perGroup = new Map<string, number>();
  for (const x of items) if (x.group_id && x.created_at > (lastOf.get(x.group_id) || "")) lastOf.set(x.group_id, x.created_at);
  for (const x of cur) if (x.group_id) perGroup.set(x.group_id, (perGroup.get(x.group_id) || 0) + 1);
  const quietCut = Date.now() - 14 * DAY,
    quiet = groups.filter((g) => !lastOf.get(g.group_id) || Date.parse(lastOf.get(g.group_id)!) < quietCut),
    gname = (g: Group) => g.name || "กลุ่ม LINE";
  return {
    range,
    groups: { total: groups.length, listenAll: groups.filter((g) => g.listen === "all").length, newInRange: groups.filter((g) => Date.parse(g.created_at) >= from).length, quiet: quiet.length },
    messages: {
      total: cur.length,
      prev: items.filter((x) => Date.parse(x.created_at) < from && Date.parse(x.created_at) >= from - range * DAY).length,
      approved: count("approved"),
      review: count("review", "awaiting_slip"),
      failed: count("failed"),
      skipped: count("skipped", "rejected"),
      waiting: count("draft", "queued", "processing"),
    },
    daily: dayKeys(Math.min(Math.max(range, 7), 60)).map((day) => {
      const d = items.filter((x) => bkkDay(x.created_at) === day);
      return { day, total: d.length, failed: d.filter((x) => x.status === "failed").length };
    }),
    topGroups: groups
      .filter((g) => perGroup.get(g.group_id))
      .sort((a, b) => (perGroup.get(b.group_id) || 0) - (perGroup.get(a.group_id) || 0))
      .slice(0, 10)
      .map((g) => ({ group_id: g.group_id, name: gname(g), company: names.get(g.company_id) || "", company_id: g.company_id, count: perGroup.get(g.group_id) || 0, last: lastOf.get(g.group_id) || null })),
    quietGroups: quiet
      .slice(0, 12)
      .map((g) => ({ group_id: g.group_id, name: gname(g), company: names.get(g.company_id) || "", company_id: g.company_id, last: lastOf.get(g.group_id) || null })),
    recentFailed: cur
      .filter((x) => x.status === "failed")
      .slice(0, 12)
      .map((x) => ({ id: x.id, company: names.get(x.company_id) || "", company_id: x.company_id, group: x.group_name || "", error: (x.error || "ไม่ทราบสาเหตุ").slice(0, 160), at: x.created_at })),
  };
}

// ---------- สุขภาพระบบ ----------
export type HealthReport = {
  checkedAt: string;
  services: { key: string; label: string; ok: boolean; detail: string }[];
  queue: { queued: number; processing: number; stuck: number; review: number; failed24: number; failed7: number };
  outbox: { pending: number; failed: number; oldest: string | null };
  errors: { message: string; count: number; last: string; companies: number }[];
  recent: { id: string; company: string; company_id: string; source: string; error: string; at: string }[];
};
type Ingest = { id: string; company_id: string; source: string; status: string; error: string | null; created_at: string; lease_until: string | null };

export async function adminHealth(ctx: Context): Promise<HealthReport> {
  requireAdmin(ctx);
  const env = (k: string) => !!process.env[k];
  let ingest: Ingest[],
    outbox: { attempts: number; created_at: string }[],
    dbOk = true,
    dbDetail = "ตอบสนองปกติ";
  if (ctx.demo) {
    const cs = await demoCompanies(),
      errors = ["LINE reply failed (400): Invalid reply token", "AI timeout after 60s", "อ่านรูปไม่ได้ (unreadable image)", "LINE reply failed (400): Invalid reply token"];
    ingest = Array.from({ length: 60 }, (_, i) => ({
      id: "h" + i,
      company_id: cs[i % cs.length].id,
      source: i % 3 ? "LINE" : "Web",
      status: i < 3 ? "queued" : i < 4 ? "processing" : i < 12 ? "failed" : i < 18 ? "review" : "approved",
      error: i >= 4 && i < 12 ? errors[i % 4] : null,
      created_at: new Date(Date.now() - i * 3.3 * 3600000).toISOString(),
      lease_until: i === 3 ? new Date(Date.now() - 600000).toISOString() : null,
    }));
    outbox = [
      { attempts: 1, created_at: new Date(Date.now() - 300000).toISOString() },
      { attempts: 5, created_at: new Date(Date.now() - 2 * DAY).toISOString() },
    ];
  } else {
    const sb = supabaseAdmin(),
      t0 = Date.now(),
      cols = "id,company_id,source,status,error,created_at,lease_until";
    const [a, b, c] = await Promise.all([
      sb.from("ingestions").select(cols).in("status", ["queued", "processing", "review", "awaiting_slip"]).limit(5000),
      sb.from("ingestions").select(cols).eq("status", "failed").gte("created_at", since(7)).order("created_at", { ascending: false }).limit(2000),
      sb.from("notification_outbox").select("attempts,created_at").limit(5000),
    ]);
    const bad = a.error || b.error;
    if (bad) (dbOk = false), (dbDetail = bad.message);
    else dbDetail = `ตอบสนองใน ${Date.now() - t0} ms`;
    ingest = [...((a.data || []) as Ingest[]), ...((b.data || []) as Ingest[])];
    outbox = (c.data || []) as typeof outbox;
  }
  const { names } = await companyIndex(ctx),
    now = Date.now(),
    failed = ingest.filter((x) => x.status === "failed").sort((a, b) => b.created_at.localeCompare(a.created_at)),
    kinds = new Map<string, { count: number; last: string; companies: Set<string> }>();
  for (const f of failed) {
    // The same message with different ids or numbers counts as one kind of error.
    const key = (f.error || "ไม่ทราบสาเหตุ")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "…")
      .replace(/\d{4,}/g, "…")
      .slice(0, 120);
    const k = kinds.get(key) || { count: 0, last: f.created_at, companies: new Set<string>() };
    k.count++;
    if (f.created_at > k.last) k.last = f.created_at;
    k.companies.add(f.company_id);
    kinds.set(key, k);
  }
  const ai = env("GEMINI_API_KEY") || env("OPENAI_API_KEY"),
    line = env("LINE_CHANNEL_ACCESS_TOKEN") && env("LINE_CHANNEL_SECRET"),
    service = ctx.demo || env("SUPABASE_SERVICE_ROLE_KEY"),
    admins = String(process.env.PLATFORM_ADMIN_EMAILS || "")
      .split(",")
      .filter((s) => s.trim()).length;
  return {
    checkedAt: new Date().toISOString(),
    services: [
      { key: "db", label: "ฐานข้อมูล (Supabase)", ok: ctx.demo || dbOk, detail: ctx.demo ? "โหมดตัวอย่าง" : dbDetail },
      { key: "service", label: "สิทธิ์ระบบหลังบ้าน", ok: service, detail: service ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้ง SUPABASE_SERVICE_ROLE_KEY" },
      { key: "line", label: "LINE Messaging API", ok: line, detail: line ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้ง token / secret" },
      { key: "ai", label: "AI (Gemini / OpenAI)", ok: ai, detail: ai ? [env("GEMINI_API_KEY") && "Gemini", env("OPENAI_API_KEY") && "OpenAI"].filter(Boolean).join(" + ") : "ยังไม่ได้ตั้ง API key" },
      { key: "admins", label: "รายชื่อแอดมิน", ok: ctx.demo || admins > 0, detail: ctx.demo ? "โหมดตัวอย่าง" : admins + " คน" },
    ],
    queue: {
      queued: ingest.filter((x) => x.status === "queued").length,
      processing: ingest.filter((x) => x.status === "processing").length,
      stuck: ingest.filter((x) => x.status === "processing" && x.lease_until && Date.parse(x.lease_until) < now).length,
      review: ingest.filter((x) => x.status === "review" || x.status === "awaiting_slip").length,
      failed24: failed.filter((x) => Date.parse(x.created_at) > now - DAY).length,
      failed7: failed.length,
    },
    outbox: {
      pending: outbox.filter((x) => x.attempts < 5).length,
      failed: outbox.filter((x) => x.attempts >= 5).length,
      oldest: outbox.length ? outbox.map((x) => x.created_at).sort()[0] : null,
    },
    errors: [...kinds].map(([message, k]) => ({ message, count: k.count, last: k.last, companies: k.companies.size })).sort((a, b) => b.count - a.count).slice(0, 10),
    recent: failed
      .slice(0, 15)
      .map((x) => ({ id: x.id, company: names.get(x.company_id) || "", company_id: x.company_id, source: x.source, error: (x.error || "ไม่ทราบสาเหตุ").slice(0, 200), at: x.created_at })),
  };
}
