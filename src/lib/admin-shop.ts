// Admin console phase 3: App Shop prices (systems, characters, themes, modules) and ads in เครือข่ายธุรกิจ
// (ad package prices, every company's ads with views and clicks, pause / remove). Platform admins only; writes go
// through the service role to the price tables that purchases charge from (modules, shop_items, ad_packages).
import { demoAdminLog, type DemoAdminLog } from "./admin-log";
import { z } from "zod";
import { supabaseAdmin } from "./supabase/server";
import { demoMutate, demoRead } from "./demo";
import { assert } from "./domain";
import { dbError } from "./data";
import { DAY, rawDemo, requireAdmin, requireAdminWrite, type DemoAdmin } from "./admin-console";
import { shopCatalog, type ShopKind, type ShopItem } from "./app-shop";
import { moduleCatalog } from "./coins";
import { adPackages } from "./ads";
import { demoPrices, priced, type DemoPrices, type PriceEdit } from "./shop-prices";
import { platformCompanyId } from "./package-sale";
import type { Context } from "./types";

export type ShopRow = { id: string; kind: ShopKind | "module"; name: string; group: string; price: number; base: number; period: "once" | "month"; active: boolean; buyers: number; item?: ShopItem };
export type AdPackRow = { id: string; name: string; days: number; coins: number; sold: number };
export type AdminShop = { items: ShopRow[]; adPackages: AdPackRow[] };

export async function adminShop(ctx: Context): Promise<AdminShop> {
  requireAdmin(ctx);
  if (ctx.demo) {
    const s = (await demoRead()) as DemoPrices & DemoAdmin,
      p = demoPrices(s),
      buyers = (id: string) => (id.length * 7) % 23;
    return {
      items: [
        ...shopCatalog.map((x) => {
          const c = priced(x, p.items);
          return { id: x.id, kind: x.kind, name: x.name, group: x.subtitle, price: c.price_coins, base: x.price_coins, period: x.period, active: c.on_sale, buyers: x.price_coins ? buyers(x.id) : 0, item: x };
        }),
        ...moduleCatalog.map((m) => {
          const c = priced(m, p.modules);
          return { id: m.id, kind: "module" as const, name: m.name, group: m.description, price: c.price_coins, base: m.price_coins, period: "once" as const, active: c.on_sale, buyers: buyers(m.id) };
        }),
      ],
      adPackages: p.adPackages.map((a, i) => ({ ...a, sold: [4, 9, 2][i] || 0 })),
    };
  }
  const sb = supabaseAdmin();
  const [items, mods, packs, ownItems, ownMods, ads] = await Promise.all([
    sb.from("shop_items").select("*").order("ordinal"),
    sb.from("modules").select("*").order("ordinal"),
    sb.from("ad_packages").select("*").order("ordinal"),
    sb.from("company_shop_items").select("item_id").limit(50000),
    sb.from("company_modules").select("module_id").limit(50000),
    sb.from("feed_ads").select("package_id").limit(50000),
  ]);
  for (const r of [items, mods, packs]) dbError(r.error);
  const count = (rows: unknown[] | null, key: string) => {
    const m = new Map<string, number>();
    for (const r of (rows || []) as Record<string, string>[]) m.set(r[key], (m.get(r[key]) || 0) + 1);
    return m;
  };
  const bi = count(ownItems.data, "item_id"),
    bm = count(ownMods.data, "module_id"),
    sold = count(ads.data, "package_id"),
    cat = new Map(shopCatalog.map((x) => [x.id, x])),
    mcat = new Map(moduleCatalog.map((x) => [x.id, x]));
  type Item = { id: string; kind: ShopKind; name: string; price_coins: number; period: "once" | "month"; active: boolean };
  type Mod = { id: string; name: string; description: string; price_coins: number; active: boolean };
  return {
    items: [
      ...((items.data || []) as Item[]).map((x) => ({
        id: x.id,
        kind: x.kind,
        name: x.name,
        group: cat.get(x.id)?.subtitle || "",
        price: x.price_coins,
        base: cat.get(x.id)?.price_coins ?? x.price_coins,
        period: x.period,
        active: x.active,
        buyers: bi.get(x.id) || 0,
        item: cat.get(x.id),
      })),
      ...((mods.data || []) as Mod[]).map((m) => ({
        id: m.id,
        kind: "module" as const,
        name: m.name,
        group: m.description,
        price: m.price_coins,
        base: mcat.get(m.id)?.price_coins ?? m.price_coins,
        period: "once" as const,
        active: m.active,
        buyers: bm.get(m.id) || 0,
      })),
    ],
    adPackages: ((packs.data || []) as AdPackRow[]).map((a) => ({ id: a.id, name: a.name, days: a.days, coins: a.coins, sold: sold.get(a.id) || 0 })),
  };
}

const priceInput = z.object({
  kind: z.enum(["character", "theme", "system", "module", "adpack"]),
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  price: z.coerce.number().int().min(0, "ราคาต้องไม่ติดลบ").max(1000000),
  active: z.boolean().default(true),
  days: z.coerce.number().int().min(1).max(365).optional(),
  name: z.string().trim().min(1).max(40).optional(),
});
export async function saveShopPrice(ctx: Context, input: unknown) {
  requireAdminWrite(ctx);
  const v = priceInput.parse(input);
  assert(v.kind !== "adpack" || v.price > 0, "ราคาแพ็กโฆษณาต้องมากกว่า 0 เหรียญ");
  if (ctx.demo)
    return demoMutate((s: DemoPrices & DemoAdminLog) => {
      demoAdminLog(s, ctx, "price", `${v.kind}:${v.id} ${v.price}${v.active ? "" : " off"}`);
      const bucket = v.kind === "module" ? "module" : v.kind === "adpack" ? "adpack" : "item",
        known = v.kind === "module" ? moduleCatalog.some((m) => m.id === v.id) : v.kind === "adpack" ? adPackages.some((a) => a.id === v.id) : shopCatalog.some((x) => x.id === v.id);
      assert(known, "ไม่พบรายการ", 404);
      const all = (s.adminPrices ??= {}),
        row: PriceEdit = { price: v.price, active: v.active };
      if (v.kind === "adpack") Object.assign(row, { days: v.days, name: v.name });
      (all[bucket] ??= {})[v.id] = row;
      return { ok: true };
    });
  const sb = supabaseAdmin(),
    q =
      v.kind === "adpack"
        ? sb.from("ad_packages").update({ coins: v.price, ...(v.days ? { days: v.days } : {}), ...(v.name ? { name: v.name } : {}) }).eq("id", v.id)
        : sb.from(v.kind === "module" ? "modules" : "shop_items").update({ price_coins: v.price, active: v.active }).eq("id", v.id);
  const { data, error } = await q.select("id");
  dbError(error);
  assert(data?.length, "ไม่พบรายการ", 404);
  await sb.from("audit_events").insert({ company_id: platformCompanyId(), action: "admin_price", target: `${v.kind}:${v.id} ${v.price}${v.active ? "" : " off"} by ${ctx.user.email}` });
  return { ok: true };
}

// ---------- ads ----------
export type AdminAd = {
  id: string;
  company_id: string;
  company: string;
  title: string;
  body: string;
  tone: string;
  target_industry: string;
  package_id: string;
  coins: number;
  status: "active" | "paused" | "removed";
  starts_at: string;
  ends_at: string;
  views: number;
  clicks: number;
};
export type AdminAds = {
  ads: AdminAd[];
  totals: { live: number; paused: number; ended: number; coins30: number; views: number; clicks: number };
  /** Where ads appear in เครือข่ายธุรกิจ and how many are showing there now. */
  placements: { key: string; name: string; where: string; showing: number }[];
};
type DemoAds = DemoAdmin & { adminAdStatus?: Record<string, AdminAd["status"]> };

export async function adminAds(ctx: Context): Promise<AdminAds> {
  requireAdmin(ctx);
  let ads: AdminAd[];
  if (ctx.demo) {
    const s = (await demoRead()) as DemoAds,
      cs = rawDemo(s).companies.slice(1, 9),
      titles = ["โปรเปิดร้านใหม่ ลด 20%", "รับสมัครพนักงานขาย 5 อัตรา", "หาพาร์ทเนอร์จัดส่งทั่วไทย", "แพ็กเกจจัดงานแต่งงานครบวงจร", "ห้องพักราคาพิเศษสำหรับองค์กร", "รับเหมาตกแต่งออฟฟิศ", "คอร์สผิวใส 3 ครั้ง", "บริการขนส่งเย็น"],
      tones = ["violet", "pink", "blue", "green"],
      packs = ["d7", "d30", "d3"];
    ads = cs.map((c, i) => {
      const pk = adPackages.find((a) => a.id === packs[i % 3])!,
        start = Date.now() - (i * 4 + 1) * DAY,
        views = 120 + ((i * 97) % 400);
      return {
        id: `ad${i}`,
        company_id: c.id,
        company: c.name,
        title: titles[i],
        body: "รายละเอียดโฆษณาตัวอย่าง",
        tone: tones[i % 4],
        target_industry: i % 3 ? "" : c.industry || "",
        package_id: pk.id,
        coins: pk.coins,
        status: s.adminAdStatus?.[`ad${i}`] || (i === 5 ? "paused" : "active"),
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(start + pk.days * DAY).toISOString(),
        views,
        clicks: Math.round(views * (0.02 + (i % 4) * 0.012)),
      };
    });
  } else {
    const sb = supabaseAdmin();
    const [a, e] = await Promise.all([
      sb.from("feed_ads").select("id,company_id,title,body,tone,target_industry,package_id,coins,status,starts_at,ends_at,companies(name)").order("created_at", { ascending: false }).limit(1000),
      sb.from("feed_ad_events").select("ad_id,kind").gte("day", new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10)).limit(200000),
    ]);
    dbError(a.error);
    const stats = new Map<string, { views: number; clicks: number }>();
    for (const r of (e.data || []) as { ad_id: string; kind: string }[]) {
      const x = stats.get(r.ad_id) || { views: 0, clicks: 0 };
      if (r.kind === "view") x.views++;
      else x.clicks++;
      stats.set(r.ad_id, x);
    }
    // companies(name) arrives as an object (many-to-one) though the generated type says array.
    ads = ((a.data || []) as unknown as (Omit<AdminAd, "company" | "views" | "clicks"> & { companies: { name: string } | { name: string }[] | null })[]).map(({ companies, ...r }) => ({
      ...r,
      company: (Array.isArray(companies) ? companies[0]?.name : companies?.name) || "",
      ...(stats.get(r.id) || { views: 0, clicks: 0 }),
    }));
  }
  const now = Date.now(),
    live = ads.filter((a) => a.status === "active" && Date.parse(a.ends_at) > now);
  return {
    ads,
    totals: {
      live: live.length,
      paused: ads.filter((a) => a.status === "paused" && Date.parse(a.ends_at) > now).length,
      ended: ads.filter((a) => a.status === "removed" || Date.parse(a.ends_at) <= now).length,
      coins30: ads.filter((a) => Date.parse(a.starts_at) > now - 30 * DAY).reduce((t, a) => t + a.coins, 0),
      views: ads.reduce((t, a) => t + a.views, 0),
      clicks: ads.reduce((t, a) => t + a.clicks, 0),
    },
    placements: [
      { key: "feed", name: "แทรกระหว่างโพสต์", where: "ฟีดเครือข่ายธุรกิจ ทุก ๆ ไม่กี่โพสต์", showing: live.length },
      { key: "side", name: "คอลัมน์ขวา · การ์ดแนะนำ", where: "ด้านขวาของเครือข่ายธุรกิจ (มือถือ: แถบ “แนะนำ”)", showing: Math.min(live.length, 2) },
      { key: "promo", name: "โปรโมชันของ EliteFlow", where: "การ์ดโปรของทีมงาน แสดงเมื่อไม่มีโฆษณาลูกค้า", showing: 0 },
    ],
  };
}

export async function setAdminAdStatus(ctx: Context, id: string, input: unknown) {
  requireAdminWrite(ctx);
  const { status } = z.object({ status: z.enum(["active", "paused", "removed"]) }).parse(input);
  if (ctx.demo)
    return demoMutate((s: DemoAds & DemoAdminLog) => {
      demoAdminLog(s, ctx, "ad_" + status, id);
      (s.adminAdStatus ??= {})[z.string().min(1).max(64).parse(id)] = status;
      return { ok: true };
    });
  const sb = supabaseAdmin(),
    adId = z.uuid().parse(id);
  const { error } = await sb.from("feed_ads").update({ status }).eq("id", adId);
  dbError(error);
  await sb.from("audit_events").insert({ company_id: platformCompanyId(), action: "admin_ad_" + status, target: adId + " by " + ctx.user.email });
  return { ok: true };
}
