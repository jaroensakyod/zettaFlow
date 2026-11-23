// หลังบ้าน → บริษัท → one company in full: package and rights, money, App Shop purchases, ads and posts.
// Read with the service key after the platform-admin check (requireAdmin). The company's own business records
// (customers, accounting, tasks …) are not copied here: they are opened through "ดูในมุมมองลูกค้า"
// (support-view.ts), which is time-limited, logged and shown to the customer.
import { z } from "zod";
import { supabaseAdmin } from "./supabase/server";
import { dbError } from "./data";
import { requireAdmin } from "./admin-console";
import { adPackages } from "./ads";
import type { Context } from "./types";

type Row = Record<string, unknown>;
export type CompanyFull = {
  subscription: { plan: string; cycle: string; status: string; trial_ends_at: string | null; current_period_end: string | null; addons: string[]; extra_users: number } | null;
  /** Add-on names keyed by id (subscriptions.addons holds ids). */
  addonNames: Record<string, string>;
  payments: { id: string; plan: string; cycle: string; amount: number; status: string; slip_ref: string | null; note: string | null; created_at: string; decided_at: string | null }[];
  wallet: number;
  topups: { id: string; coins: number; amount: number; status: string; created_at: string; decided_at: string | null }[];
  ledger: { id: string; delta: number; reason: string; ref: string | null; created_at: string }[];
  purchases: { id: string; kind: string; name: string; price_coins: number; bought_at: string; expires_at: string | null; active: boolean }[];
  ads: { id: string; title: string; body: string; status: string; package: string; coins: number; target_industry: string; starts_at: string; ends_at: string; views: number; clicks: number; placement: string }[];
  posts: { id: string; author_id: string | null; author_name: string; kind: string; body: string; images: number; created_at: string; archived_at: string | null }[];
};

const empty: CompanyFull = { subscription: null, addonNames: {}, payments: [], wallet: 0, topups: [], ledger: [], purchases: [], ads: [], posts: [] };
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v.startsWith("[") ? (JSON.parse(v) as string[]) : []);

export async function adminCompanyFull(ctx: Context, id: string): Promise<CompanyFull> {
  requireAdmin(ctx);
  const cid = z.uuid().parse(id);
  if (ctx.demo) return empty;
  const sb = supabaseAdmin();
  const [sub, addons, pay, wallet, topups, ledger, owned, modules, settings, ads, posts] = await Promise.all([
    sb.from("subscriptions").select("plan,cycle,status,trial_ends_at,current_period_end,addons,extra_users").eq("company_id", cid).maybeSingle(),
    sb.from("addons").select("id,name"),
    sb.from("billing_payments").select("id,plan,cycle,amount,status,slip_ref,note,created_at,decided_at").eq("company_id", cid).order("created_at", { ascending: false }).limit(100),
    sb.from("coin_wallets").select("balance").eq("company_id", cid).maybeSingle(),
    sb.from("coin_topups").select("id,coins,amount,status,created_at,decided_at").eq("company_id", cid).order("created_at", { ascending: false }).limit(50),
    sb.from("coin_ledger").select("id,delta,reason,ref,created_at").eq("company_id", cid).order("created_at", { ascending: false }).limit(100),
    sb.from("company_shop_items").select("item_id,kind,price_coins,bought_at,expires_at").eq("company_id", cid),
    sb.from("company_modules").select("module_id,price_coins,purchased_at").eq("company_id", cid),
    sb.from("company_shop_settings").select("theme,character").eq("company_id", cid).maybeSingle(),
    sb.from("feed_ads").select("id,title,body,status,package_id,coins,target_industry,starts_at,ends_at").eq("company_id", cid).order("created_at", { ascending: false }).limit(100),
    sb.from("company_posts").select("id,author_id,author_name,kind,body,images,created_at,archived_at").eq("company_id", cid).order("created_at", { ascending: false }).limit(200),
  ]);
  for (const r of [sub, pay, wallet, topups, ledger, owned, modules, ads, posts]) dbError(r.error);

  // Names of what was bought: App Shop items and department modules.
  const itemIds = ((owned.data || []) as Row[]).map((r) => String(r.item_id)),
    moduleIds = ((modules.data || []) as Row[]).map((r) => String(r.module_id));
  const [items, mods] = await Promise.all([
    itemIds.length ? sb.from("shop_items").select("id,name").in("id", itemIds) : Promise.resolve({ data: [] as Row[] }),
    moduleIds.length ? sb.from("modules").select("id,name").in("id", moduleIds) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const itemName = new Map(((items.data || []) as Row[]).map((r) => [String(r.id), String(r.name)])),
    moduleName = new Map(((mods.data || []) as Row[]).map((r) => [String(r.id), String(r.name)])),
    active = (settings.data || {}) as { theme?: string; character?: string };
  const purchases: CompanyFull["purchases"] = [
    ...((owned.data || []) as Row[]).map((r) => ({
      id: String(r.item_id),
      kind: String(r.kind),
      name: itemName.get(String(r.item_id)) || String(r.item_id),
      price_coins: Number(r.price_coins || 0),
      bought_at: String(r.bought_at),
      expires_at: (r.expires_at as string) || null,
      active: r.item_id === active.theme || r.item_id === active.character,
    })),
    ...((modules.data || []) as Row[]).map((r) => ({
      id: String(r.module_id),
      kind: "module",
      name: moduleName.get(String(r.module_id)) || String(r.module_id),
      price_coins: Number(r.price_coins || 0),
      bought_at: String(r.purchased_at),
      expires_at: null,
      active: true,
    })),
  ].sort((a, b) => b.bought_at.localeCompare(a.bought_at));

  // Views and clicks of this company's ads.
  const adRows = (ads.data || []) as Row[],
    stats = new Map<string, { views: number; clicks: number }>();
  if (adRows.length) {
    const { data: ev } = await sb.from("feed_ad_events").select("ad_id,kind").in("ad_id", adRows.map((a) => String(a.id))).limit(100000);
    for (const e of (ev || []) as Row[]) {
      const x = stats.get(String(e.ad_id)) || { views: 0, clicks: 0 };
      if (e.kind === "view") x.views++;
      else x.clicks++;
      stats.set(String(e.ad_id), x);
    }
  }

  const s = sub.data as Row | null;
  return {
    subscription: s
      ? {
          plan: String(s.plan),
          cycle: String(s.cycle),
          status: String(s.status),
          trial_ends_at: (s.trial_ends_at as string) || null,
          current_period_end: (s.current_period_end as string) || null,
          addons: arr(s.addons),
          extra_users: Number(s.extra_users || 0),
        }
      : null,
    addonNames: Object.fromEntries(((addons.data || []) as Row[]).map((r) => [String(r.id), String(r.name)])),
    payments: ((pay.data || []) as Row[]).map((r) => ({ ...(r as CompanyFull["payments"][number]), amount: Number(r.amount || 0) })),
    wallet: Number((wallet.data as Row | null)?.balance || 0),
    topups: ((topups.data || []) as Row[]).map((r) => ({ ...(r as CompanyFull["topups"][number]), coins: Number(r.coins || 0), amount: Number(r.amount || 0) })),
    ledger: ((ledger.data || []) as Row[]).map((r) => ({ ...(r as CompanyFull["ledger"][number]), delta: Number(r.delta || 0) })),
    purchases,
    ads: adRows.map((r) => ({
      id: String(r.id),
      title: String(r.title || ""),
      body: String(r.body || ""),
      status: String(r.status),
      package: adPackages.find((p) => p.id === r.package_id)?.name || String(r.package_id || ""),
      coins: Number(r.coins || 0),
      target_industry: String(r.target_industry || ""),
      starts_at: String(r.starts_at),
      ends_at: String(r.ends_at),
      // Company ads show in the business-network feed (between posts) and its right-hand column (adminAds placements).
      placement: "เครือข่ายธุรกิจ · แทรกระหว่างโพสต์ และคอลัมน์ขวา",
      ...(stats.get(String(r.id)) || { views: 0, clicks: 0 }),
    })),
    posts: ((posts.data || []) as Row[]).map((r) => ({
      id: String(r.id),
      author_id: (r.author_id as string) || null,
      author_name: String(r.author_name || ""),
      kind: String(r.kind),
      body: String(r.body || ""),
      images: arr(r.images).length,
      created_at: String(r.created_at),
      archived_at: (r.archived_at as string) || null,
    })),
  };
}
