// ลงโฆษณา: companies buy sponsored cards in เครือข่ายธุรกิจ with coins (0035_feed_ads.sql).
import { z } from "zod";
import { supabaseServer } from "./supabase/server";
import { assert, requireOwner } from "./domain";
import { dbError } from "./data";
import type { Context } from "./types";

export type AdTone = "violet" | "pink" | "blue" | "green";
export type AdPackage = { id: string; name: string; days: number; coins: number };
/** Mirrors the seed in 0035_feed_ads.sql. */
export const adPackages: AdPackage[] = [
  { id: "d3", name: "3 วัน", days: 3, coins: 30 },
  { id: "d7", name: "7 วัน", days: 7, coins: 60 },
  { id: "d30", name: "30 วัน", days: 30, coins: 200 },
];
/** A sponsored card as the feed shows it (company ads and the EliteFlow team's promotions share this shape). */
export type FeedAd = {
  id: string;
  title: string;
  body: string;
  cta_label: string;
  cta_url: string;
  tone: AdTone;
  /** Advertiser; empty for EliteFlow's own promotions. */
  company?: string;
  company_id?: string;
  has_logo?: boolean;
  industry?: string;
};
export type MyAd = FeedAd & {
  status: "active" | "paused" | "removed";
  starts_at: string;
  ends_at: string;
  coins: number;
  package: string;
  target_industry: string;
  post_id: string | null;
  views: number;
  clicks: number;
};

const adInput = z.object({
  title: z.string().trim().min(1, "ใส่หัวข้อโฆษณา").max(120),
  body: z.string().trim().max(500).default(""),
  cta_label: z.string().trim().max(40).default(""),
  cta_url: z
    .string()
    .trim()
    .max(300)
    .regex(/^(https:\/\/|\/|$)/, "ลิงก์ต้องขึ้นต้นด้วย https://")
    .default(""),
  tone: z.enum(["violet", "pink", "blue", "green"]).default("violet"),
  target_industry: z.string().trim().max(100).default(""),
  post_id: z.uuid().nullable().default(null),
});

export async function adStudio(ctx: Context) {
  if (ctx.demo) return { packages: adPackages, ads: [] as MyAd[], balance: 0, posts: [] as { id: string; title: string }[] };
  const sb = await supabaseServer();
  const [ads, wallet, posts] = await Promise.all([
    sb.rpc("my_feed_ads", { p_company: ctx.company.id }),
    sb.from("coin_wallets").select("balance").eq("company_id", ctx.company.id).maybeSingle(),
    sb.from("company_posts").select("id, kind, body, meta").eq("company_id", ctx.company.id).is("archived_at", null).order("created_at", { ascending: false }).limit(20),
  ]);
  dbError(ads.error);
  dbError(wallet.error);
  dbError(posts.error);
  return {
    packages: adPackages,
    ads: (ads.data || []) as MyAd[],
    balance: Number(wallet.data?.balance || 0),
    posts: (posts.data || []).map((p) => ({
      id: String(p.id),
      title: String((p.meta as { title?: string })?.title || String(p.body || "").slice(0, 60)),
    })),
  };
}

export async function buyAd(ctx: Context, input: unknown) {
  requireOwner(ctx);
  assert(!ctx.demo, "ระบบตัวอย่างซื้อโฆษณาไม่ได้ สมัครใช้งานจริงก่อน", 403);
  const { package: pkg, ...ad } = adInput.extend({ package: z.enum(["d3", "d7", "d30"]) }).parse(input);
  assert(!ad.cta_label || ad.cta_url, "ใส่ลิงก์ของปุ่มด้วย");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("buy_feed_ad", { p_company: ctx.company.id, p_package: pkg, p_ad: ad });
  dbError(error);
  return data;
}

export async function setAdStatus(ctx: Context, id: string, input: unknown) {
  assert(!ctx.demo, "ระบบตัวอย่าง", 403);
  const { status } = z.object({ status: z.enum(["active", "paused"]) }).parse(input);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("set_feed_ad_status", { p_company: ctx.company.id, p_id: z.uuid().parse(id), p_status: status });
  dbError(error);
}

export async function liveAds(ctx: Context): Promise<FeedAd[]> {
  if (ctx.demo) return [];
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("feed_ads_live", { p_company: ctx.company.id });
  dbError(error);
  return (data || []) as FeedAd[];
}

export async function trackAd(ctx: Context, id: string, input: unknown) {
  if (ctx.demo) return;
  const { kind } = z.object({ kind: z.enum(["view", "click"]) }).parse(input);
  const sb = await supabaseServer();
  await sb.rpc("feed_ad_track", { p_company: ctx.company.id, p_ad: z.uuid().parse(id), p_kind: kind });
}
