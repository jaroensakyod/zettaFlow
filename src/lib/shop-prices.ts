// Current prices of what is sold for coins: App Shop items (characters, themes, systems), modules and ad packages.
// The platform admin edits them in หลังบ้าน; purchases always charge the database price, so the pages read the same
// numbers here (database in production; the admin's edits kept in the demo data in demo mode).
import { supabaseServer } from "./supabase/server";
import { demoRead, type DemoState } from "./demo";
import { adPackages, type AdPackage } from "./ads";
import type { Context } from "./types";

export type PriceEdit = { price?: number; active?: boolean; days?: number; name?: string };
export type DemoPrices = DemoState & { adminPrices?: { module?: Record<string, PriceEdit>; item?: Record<string, PriceEdit>; adpack?: Record<string, PriceEdit> } };
type Edits = Map<string, { price: number; active: boolean }>;
export type Prices = {
  /** id → current coin price (-1 = unchanged) and whether it is on sale. */
  items: Edits;
  modules: Edits;
  /** Production: the list is the database's (on-sale items only), so an id missing from `items` is off sale. */
  itemsComplete: boolean;
  adPackages: AdPackage[];
};

const edits = (r?: Record<string, PriceEdit>): Edits => new Map(Object.entries(r || {}).map(([id, e]) => [id, { price: e.price ?? -1, active: e.active !== false }]));

export function demoPrices(s: DemoPrices): Prices {
  const p = s.adminPrices || {};
  return {
    items: edits(p.item),
    modules: edits(p.module),
    itemsComplete: false,
    adPackages: adPackages.map((a) => ({ ...a, coins: p.adpack?.[a.id]?.price ?? a.coins, days: p.adpack?.[a.id]?.days ?? a.days, name: p.adpack?.[a.id]?.name ?? a.name })),
  };
}

export async function currentPrices(ctx: Context): Promise<Prices> {
  if (ctx.demo) return demoPrices((await demoRead()) as DemoPrices);
  const sb = await supabaseServer();
  // Inactive rows are hidden from customers by RLS, so anything missing here is off sale.
  const [items, packs] = await Promise.all([sb.from("shop_items").select("id,price_coins,active"), sb.from("ad_packages").select("id,name,days,coins").order("ordinal")]);
  const fromDb: Edits = new Map();
  for (const r of (items.data || []) as { id: string; price_coins: number; active: boolean }[]) fromDb.set(r.id, { price: r.price_coins, active: r.active });
  return {
    items: fromDb,
    modules: new Map(),
    itemsComplete: !items.error && fromDb.size > 0,
    adPackages: packs.error || !packs.data?.length ? adPackages : (packs.data as AdPackage[]),
  };
}

/** Catalogue entry with the current price, and whether it is on sale. */
export function priced<T extends { id: string; price_coins: number }>(x: T, m: Edits, complete = false) {
  const e = m.get(x.id);
  return { ...x, price_coins: e && e.price >= 0 ? e.price : x.price_coins, on_sale: e ? e.active : !complete };
}
