// Platform settings the admin edits in หลังบ้าน → ตั้งค่าแพลตฟอร์ม: package prices and limits (plans), add-on prices
// (addons), coin packs (coin_packs), the Free and trial AI allowances (free_limits, trial_limits), the admin team and
// LINE alerts (the platform company's settings). The database functions already charge and limit from those tables;
// this loads the same numbers into billing.ts / coins.ts for the pages, cached for a minute per server instance.
import { supabaseAdmin } from "./supabase/server";
import { demoEnabled, demoRead, type DemoState } from "./demo";
import { applyCatalog, defaultAddons, defaultPlans, type PlanNumbers } from "./billing";
import { coinPacks } from "./coins";
import { setAdminTeam, type TeamMember } from "./admin-team";
import { platformCompanyId } from "./package-sale";

export type AlertEvent = "signup" | "payment" | "topup" | "support" | "health";
export type Alerts = { to: string; events: Record<AlertEvent, boolean> };
export type Allowance = { resource: string; amount: number; label: string };
export type Catalog = {
  plans: (PlanNumbers & { id: string; name: string })[];
  addons: { id: string; name: string; price: number; per_unit: boolean }[];
  coinPacks: { coins: number; price: number }[];
  freeAi: Allowance[];
  trial: Allowance[];
  team: TeamMember[];
  alerts: Alerts;
};
export type DemoCatalog = DemoState & {
  adminCatalog?: { plans?: Record<string, Partial<PlanNumbers>>; addons?: Record<string, number>; coinPacks?: Record<string, number>; freeAi?: Record<string, number>; trial?: Record<string, number> };
  adminTeam?: TeamMember[];
  adminAlerts?: Alerts;
};

export const defaultAlerts: Alerts = { to: "", events: { signup: true, payment: true, topup: true, support: true, health: false } };
const defaultCoinPacks = coinPacks.map((p) => ({ ...p }));
// Seeds of free_limits / trial_limits (schema.sql); demo starts from these.
const defaultFreeAi: Allowance[] = [
  { resource: "ai_files", amount: 300, label: "ไฟล์ที่ AI อ่าน" },
  { resource: "ai_chat", amount: 30, label: "คำถามถึงน้องโฟลว์" },
  { resource: "ai_calls", amount: 1500, label: "การเรียก AI ทั้งหมด" },
];
const defaultTrial: Allowance[] = [
  { resource: "line_groups", amount: 2, label: "กลุ่ม LINE" },
  { resource: "users", amount: 5, label: "ผู้ใช้" },
  { resource: "workflows", amount: 5, label: "ฟอร์ม/Template" },
  { resource: "documents", amount: 500, label: "รายการจาก LINE และเว็บ" },
  { resource: "ai_files", amount: 100, label: "ไฟล์ที่ AI อ่าน" },
  { resource: "ai_chat", amount: 100, label: "คำถามถึงน้องโฟลว์" },
  { resource: "ai_calls", amount: 1500, label: "การเรียก AI ทั้งหมด" },
];
const numbers = (p: PlanNumbers) => ({
  monthly: p.monthly,
  yearly: p.yearly,
  workflows: p.workflows,
  documents: p.documents,
  line_groups: p.line_groups,
  users: p.users,
  voice_minutes: p.voice_minutes,
  storage_gb: p.storage_gb,
});
export const defaultCatalog = (): Catalog => ({
  plans: defaultPlans.map((p) => ({ id: p.id, name: p.name, ...numbers(p) })),
  addons: defaultAddons.map((a) => ({ id: a.id, name: a.name, price: a.price, per_unit: a.id === "extra_user" })),
  coinPacks: defaultCoinPacks.map((p) => ({ ...p })),
  freeAi: defaultFreeAi.map((x) => ({ ...x })),
  trial: defaultTrial.map((x) => ({ ...x })),
  team: [],
  alerts: structuredClone(defaultAlerts),
});

export function demoCatalog(s: DemoCatalog): Catalog {
  const c = defaultCatalog(),
    e = s.adminCatalog || {};
  for (const p of c.plans) Object.assign(p, e.plans?.[p.id] || {});
  for (const a of c.addons) a.price = e.addons?.[a.id] ?? a.price;
  for (const k of c.coinPacks) k.price = e.coinPacks?.[k.coins] ?? k.price;
  for (const x of c.freeAi) x.amount = e.freeAi?.[x.resource] ?? x.amount;
  for (const x of c.trial) x.amount = e.trial?.[x.resource] ?? x.amount;
  c.team = s.adminTeam || [];
  c.alerts = { ...defaultAlerts, ...s.adminAlerts, events: { ...defaultAlerts.events, ...s.adminAlerts?.events } };
  return c;
}

async function readDb(): Promise<Catalog> {
  const sb = supabaseAdmin(),
    c = defaultCatalog();
  const [plans, addons, packs, free, trial, company] = await Promise.all([
    sb.from("plans").select("*").order("ordinal"),
    sb.from("addons").select("*").order("ordinal"),
    sb.from("coin_packs").select("*").order("ordinal"),
    sb.from("free_limits").select("*"),
    sb.from("trial_limits").select("*"),
    sb.from("companies").select("settings").eq("id", platformCompanyId()).maybeSingle(),
  ]);
  type Row = PlanNumbers & { id: string; name: string };
  for (const r of (plans.data || []) as Row[]) {
    const p = c.plans.find((x) => x.id === r.id);
    if (!p) continue;
    for (const k of Object.keys(numbers(p)) as (keyof PlanNumbers)[]) if (r[k] !== undefined) (p as Record<string, unknown>)[k] = r[k] === null ? null : Number(r[k]);
  }
  for (const r of (addons.data || []) as { id: string; monthly: number }[]) {
    const a = c.addons.find((x) => x.id === r.id);
    if (a) a.price = Number(r.monthly);
  }
  if (packs.data?.length) c.coinPacks = (packs.data as { coins: number; price: number }[]).map((p) => ({ coins: p.coins, price: Number(p.price) }));
  const allowance = (list: Allowance[], rows: unknown) => {
    for (const r of (rows || []) as Allowance[]) {
      const x = list.find((y) => y.resource === r.resource);
      if (x) Object.assign(x, { amount: Number(r.amount), label: r.label || x.label });
      else list.push({ resource: r.resource, amount: Number(r.amount), label: r.label || r.resource });
    }
  };
  allowance(c.freeAi, free.data);
  allowance(c.trial, trial.data);
  const settings = (company.data?.settings || {}) as { admin_team?: TeamMember[]; admin_alerts?: Alerts };
  c.team = Array.isArray(settings.admin_team) ? settings.admin_team : [];
  c.alerts = { ...defaultAlerts, ...settings.admin_alerts, events: { ...defaultAlerts.events, ...settings.admin_alerts?.events } };
  return c;
}

let cache: { at: number; demo: boolean; value: Catalog } | null = null;
let loading: Promise<Catalog> | null = null;
const TTL = 60000;

/** Puts the numbers to work: billing.ts prices and limits, coin packs, the admin team. */
function apply(c: Catalog) {
  applyCatalog({ plans: c.plans, addons: c.addons });
  coinPacks.splice(0, coinPacks.length, ...c.coinPacks.map((p) => ({ ...p })));
  setAdminTeam(c.team);
}

/** The current catalogue, applied. Never throws: on a database error it keeps the last (or shipped) numbers. */
export async function loadCatalog(): Promise<Catalog> {
  const demo = demoEnabled();
  if (cache && cache.demo === demo && Date.now() - cache.at < TTL) return cache.value;
  loading ??= (async () => {
    try {
      const value = demo ? demoCatalog((await demoRead()) as DemoCatalog) : await readDb();
      apply(value);
      cache = { at: Date.now(), demo, value };
      return value;
    } catch {
      return cache?.value || defaultCatalog();
    } finally {
      loading = null;
    }
  })();
  return loading;
}
/** After an admin saves: the next request reads the database again. */
export function invalidateCatalog() {
  cache = null;
}
