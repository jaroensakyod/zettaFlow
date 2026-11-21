// Paid ads in the business feed for D1, after buy_feed_ad, set_feed_ad_status, feed_ad_track, feed_ads_live and
// my_feed_ads (0035_feed_ads.sql). The viewer's company plays p_company; member_role(p_company) is viewer.role.
import { randomUUID } from "node:crypto";
import type { Cond, Tenant } from "./tenant";
import { addDays, fail, iso, pgConstraint, toUuid, trimSp, txt, type Row } from "./billing-util";
import { spend } from "./billing-shop";

export type FeedAd = { id: string; company_id: string; post_id: string | null; title: string; body: string; cta_label: string; cta_url: string; tone: string; target_industry: string; package_id: string; coins: number; status: string; starts_at: string; ends_at: string; created_by: string | null; created_at: string };

/** buy_feed_ad(): the owner pays coins for an ad shown to other companies for the package's days. */
export async function buyFeedAd(t: Tenant, packageId: string, ad: Row): Promise<FeedAd> {
  if (t.viewer.role !== "owner") fail("เฉพาะเจ้าของบริษัทซื้อโฆษณาได้", 403);
  const [pk] = await t.selectGlobal<{ id: string; days: number; coins: number }>("ad_packages", { where: { id: packageId } });
  if (!pk) fail("ไม่พบแพ็กเกจโฆษณา", 404);
  const raw = txt(ad, "post_id");
  const post = raw === null || raw === "" ? null : toUuid(raw);
  if (post !== null && !(await t.selectInternal("company_posts", { where: { id: post, archived_at: null }, limit: 1 })).length) fail("เลือกได้เฉพาะโพสต์ของบริษัทตัวเอง", 403);
  const [w] = await t.selectInternal<{ company_id: string; balance: number }>("coin_wallets");
  if ((w?.balance ?? 0) < pk!.coins) fail(`เหรียญไม่พอ ต้องใช้ ${pk!.coins} เหรียญ กรุณาเติมเหรียญ`);
  const id = randomUUID(),
    now = iso();
  try {
    await t.atomic([
      t.insertStmt("feed_ads", {
        id,
        post_id: post,
        title: trimSp(txt(ad, "title")),
        body: trimSp(txt(ad, "body")) ?? "",
        cta_label: trimSp(txt(ad, "cta_label")) ?? "",
        cta_url: trimSp(txt(ad, "cta_url")) ?? "",
        tone: txt(ad, "tone") || "violet",
        target_industry: trimSp(txt(ad, "target_industry")) ?? "",
        package_id: pk!.id,
        coins: pk!.coins,
        status: "active",
        starts_at: now,
        ends_at: addDays(now, pk!.days),
        created_by: t.viewer.userId,
        created_at: now,
      }),
      ...spend(t, w!, pk!.coins, now),
      t.insertStmt("coin_ledger", { delta: -pk!.coins, reason: "ad", ref: id, created_by: t.viewer.userId, created_at: now }),
      t.insertStmt("audit_events", { actor: t.viewer.userId, action: "feed_ad_bought", target: id }),
    ]);
  } catch (e) {
    pgConstraint(e);
  }
  return (await t.selectInternal<FeedAd>("feed_ads", { where: { id } }))[0];
}

/** set_feed_ad_status(): owners and managers pause an ad, or run it again while its time lasts. */
export async function setFeedAdStatus(t: Tenant, id: string, status: string): Promise<void> {
  if (!["owner", "manager"].includes(t.viewer.role)) fail("ไม่มีสิทธิ์", 403);
  if (!["active", "paused"].includes(status)) fail("สถานะไม่ถูกต้อง");
  const now = iso();
  const where: Record<string, Cond> = { id, status: { op: "!=", value: "removed" } };
  if (status !== "paused") where.ends_at = { op: ">", value: now };
  const [r] = await t.atomic([t.updateStmt("feed_ads", where, { status })]);
  if (!r.changes) fail("ไม่พบโฆษณา หรือหมดเวลาแล้ว", 404);
}

/**
 * feed_ad_track(): a view or click on another company's ad, once per company, kind and day. Silently nothing for a
 * bad kind or one's own ad, like Postgres — and in the read-only support view, where D1 writes nothing at all.
 */
export async function feedAdTrack(t: Tenant, adId: string, kind: string): Promise<void> {
  if (!["view", "click"].includes(kind) || t.viewer.support) return;
  const c = t.viewer.companyId;
  if (!(await t.selectGlobal("feed_ads", { where: { id: adId, company_id: { op: "!=", value: c } }, limit: 1 })).length) return;
  const now = iso();
  await t.atomic([t.upsertGlobalStmt("feed_ad_events", { ad_id: adId, viewer_company: c, kind, day: now.slice(0, 10) }, ["ad_id", "viewer_company", "kind", "day"], [])]);
}

export type LiveAd = { id: string; company_id: string; company: string; industry: string; has_logo: boolean; title: string; body: string; cta_label: string; cta_url: string; tone: string; post_id: string | null };
type Company = { id: string; name: string; profile: Row | null };
const industryOf = (c: Company) => txt(c.profile, "industry") ?? "";
/** feed_ads_live(): up to 4 running ads of other companies, ads aimed at the viewer's industry first, otherwise random. */
export async function feedAdsLive(t: Tenant): Promise<LiveAd[]> {
  const c = t.viewer.companyId,
    now = iso();
  const [me] = await t.selectGlobal<Company>("companies", { where: { id: c } });
  if (!me) return [];
  const industry = industryOf(me);
  const ads = await t.selectGlobal<FeedAd>("feed_ads", { where: { status: "active", starts_at: { op: "<=", value: now }, ends_at: { op: ">", value: now }, company_id: { op: "!=", value: c } } });
  const owners = ads.length ? await t.selectGlobal<Company>("companies", { where: { id: [...new Set(ads.map((a) => a.company_id))] } }) : [];
  const picked = ads
    .map((a) => ({ a, co: owners.find((o) => o.id === a.company_id), aimed: a.target_industry !== "" && a.target_industry === industry ? 1 : 0, r: Math.random() }))
    .filter((x) => x.co)
    .sort((x, y) => y.aimed - x.aimed || x.r - y.r)
    .slice(0, 4);
  return picked.map(({ a, co }) => ({
    id: a.id,
    company_id: a.company_id,
    company: co!.name,
    industry: industryOf(co!),
    has_logo: (txt(co!.profile, "logo") ?? "") !== "",
    title: a.title,
    body: a.body,
    cta_label: a.cta_label,
    cta_url: a.cta_url,
    tone: a.tone,
    post_id: a.post_id,
  }));
}

export type MyFeedAd = FeedAd & { views: number; clicks: number; package: string | null };
/** my_feed_ads(): the company's ads (not removed), newest first, with views, clicks and the package name. */
export async function myFeedAds(t: Tenant): Promise<MyFeedAd[]> {
  const ads = await t.selectInternal<FeedAd>("feed_ads", { where: { status: { op: "!=", value: "removed" } }, order: [["created_at", "desc"]] });
  if (!ads.length) return [];
  const events = await t.selectGlobal<{ ad_id: string; kind: string }>("feed_ad_events", { where: { ad_id: ads.map((a) => a.id) } });
  const packages = await t.selectGlobal<{ id: string; name: string }>("ad_packages");
  return ads.map((a) => ({
    ...a,
    views: events.filter((e) => e.ad_id === a.id && e.kind === "view").length,
    clicks: events.filter((e) => e.ad_id === a.id && e.kind === "click").length,
    package: packages.find((p) => p.id === a.package_id)?.name ?? null,
  }));
}
