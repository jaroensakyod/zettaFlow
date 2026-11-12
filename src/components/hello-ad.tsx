"use client";
// Sponsored card that pops up over the greeting card on ภาพรวม: the same ads as เครือข่ายธุรกิจ (company ads bought
// with coins, then EliteFlow's feed promotions). The user can close it; it comes back 15 minutes later.
import { useEffect, useState } from "react";
import { ArrowRight, Megaphone, X } from "lucide-react";
import type { FeedAd } from "@/lib/ads";
import type { Promo } from "@/lib/engage";
import { api } from "./shared";
import { sampleAds } from "./feed-samples";

const SNOOZE_KEY = "ef_hello_ad_snooze",
  SNOOZE_MS = 15 * 60 * 1000,
  /** The greeting shows first; the ad slides in after this. */
  FIRST_DELAY_MS = 2500,
  /** Several ads take turns while the card is open. */
  ROTATE_MS = 9000;
const snoozedUntil = () => {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0;
  } catch {
    return 0;
  }
};
const initials = (name: string) => name.replace(/^(บริษัท|หจก\.?|ห้างหุ้นส่วน)\s*/, "").trim().slice(0, 2).toUpperCase() || "AD";

export function HelloAd({ demo }: { demo: boolean }) {
  const [ads, setAds] = useState<FeedAd[]>([]),
    [open, setOpen] = useState(false),
    [i, setI] = useState(0);
  useEffect(() => {
    let live = true;
    if (demo) {
      setAds(sampleAds);
      return;
    }
    Promise.all([
      api("/ads/live").catch(() => [] as FeedAd[]),
      fetch("/api/public-content", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { promos: [] }))
        .then((d: { promos?: Promo[] }) => (d.promos || []).filter((x) => x.placement === "feed" || x.placement === "both"))
        .catch(() => [] as Promo[]),
    ]).then(([bought, promos]: [FeedAd[], Promo[]]) => {
      if (!live) return;
      setAds([...bought, ...promos.map((x) => ({ id: x.id, title: x.title, body: x.body, cta_label: x.cta_label, cta_url: x.cta_url, tone: x.tone }))]);
    });
    return () => {
      live = false;
    };
  }, [demo]);
  // Pop up after a moment, or once the 15-minute snooze is over.
  useEffect(() => {
    if (!ads.length || open) return;
    const wait = Math.max(FIRST_DELAY_MS, snoozedUntil() - Date.now());
    const t = setTimeout(() => setOpen(true), wait);
    return () => clearTimeout(t);
  }, [ads.length, open]);
  useEffect(() => {
    if (!open || ads.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % ads.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [open, ads.length]);
  const ad = ads[i % Math.max(ads.length, 1)];
  // One view per company ad each time it is shown.
  useEffect(() => {
    if (open && ad?.company_id && !demo) api(`/ads/${ad.id}/track`, { method: "POST", body: { kind: "view" } }).catch(() => {});
  }, [open, ad?.id, ad?.company_id, demo]);
  if (!open || !ad) return null;
  const close = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {}
    setOpen(false);
    setI((n) => (n + 1) % ads.length); // next time, the next ad
  };
  const click = (x: FeedAd) => () => {
    if (x.company_id && !demo) api(`/ads/${x.id}/track`, { method: "POST", body: { kind: "click" } }).catch(() => {});
  };
  const cur = i % ads.length;
  // Every ad is its own layer; changing ads fades one out while the next fades in (colour included).
  return (
    <div className="hd-hello-ads" role="complementary" aria-label="ผู้สนับสนุน">
      {ads.map((x, n) => {
        const on = n === cur,
          external = x.cta_url.startsWith("http");
        return (
          <div key={x.id} className={"hd-hello-ad " + x.tone + (on ? "" : " off")} aria-hidden={!on}>
            <i className="hd-hello-ad-glow" aria-hidden />
            <div className="hd-hello-ad-head">
              {x.company && (
                <span className="hd-hello-ad-who">
                  {x.has_logo && x.company_id ? <img src={"/api/feed/logo/" + x.company_id} alt="" width={30} height={30} /> : <i>{initials(x.company)}</i>}
                  <span>
                    <b>{x.company}</b>
                    {x.industry && <small>{x.industry}</small>}
                  </span>
                </span>
              )}
              <span className="hd-hello-ad-tag">
                <Megaphone size={12} /> ผู้สนับสนุน{x.company ? "" : " · EliteFlow"}
              </span>
            </div>
            <strong>{x.title}</strong>
            {x.body && <p>{x.body}</p>}
            <div className="hd-hello-ad-foot">
              {x.cta_label &&
                (x.cta_url ? (
                  <a className="hd-hello-ad-cta" href={x.cta_url} target={external ? "_blank" : undefined} rel="noreferrer sponsored" onClick={click(x)} tabIndex={on ? 0 : -1}>
                    {x.cta_label} <ArrowRight size={14} />
                  </a>
                ) : (
                  <span className="hd-hello-ad-cta">
                    {x.cta_label} <ArrowRight size={14} />
                  </span>
                ))}
            </div>
          </div>
        );
      })}
      <button className="hd-hello-ad-x" onClick={close} aria-label="ปิดโฆษณา (แสดงอีกครั้งใน 15 นาที)" title="ปิด · แสดงอีกครั้งใน 15 นาที">
        <X size={16} />
      </button>
      {ads.length > 1 && (
        <span className="hd-hello-ad-dots" aria-hidden>
          {ads.map((x, n) => (
            <i key={x.id} className={n === cur ? "on" : ""} />
          ))}
        </span>
      )}
    </div>
  );
}
