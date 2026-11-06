"use client";
// One sponsored card (ผู้สนับสนุน) — used in the feed, the ad studio's live preview and the public feed mockup.
import { ArrowRight, Megaphone } from "lucide-react";
import type { FeedAd } from "@/lib/ads";

const initials = (name: string) =>
  name
    .replace(/^(บริษัท|หจก\.?|ห้างหุ้นส่วน)\s*/, "")
    .trim()
    .slice(0, 2)
    .toUpperCase() || "AD";

export function AdCard({ ad, compact, onClick, preview }: { ad: FeedAd; compact?: boolean; onClick?: () => void; preview?: boolean }) {
  const external = ad.cta_url.startsWith("http");
  return (
    <section className={"card li-ad " + ad.tone + (compact ? " compact" : "")} aria-label="ผู้สนับสนุน">
      <span className="li-ad-tag">
        <Megaphone size={13} /> ผู้สนับสนุน{ad.company ? "" : " · EliteFlow"}
      </span>
      {ad.company && (
        <span className="li-ad-who">
          {ad.has_logo && ad.company_id ? (
            <img src={"/api/feed/logo/" + ad.company_id} alt="" width={28} height={28} />
          ) : (
            <i>{initials(ad.company)}</i>
          )}
          <span>
            <b>{ad.company}</b>
            {ad.industry && <small>{ad.industry}</small>}
          </span>
        </span>
      )}
      <strong>{ad.title || "หัวข้อโฆษณา"}</strong>
      {ad.body && <p>{ad.body}</p>}
      {ad.cta_label &&
        (preview || !ad.cta_url ? (
          <span className="li-ad-cta">
            {ad.cta_label} <ArrowRight size={14} />
          </span>
        ) : (
          <a className="li-ad-cta" href={ad.cta_url} target={external ? "_blank" : undefined} rel="noreferrer sponsored" onClick={onClick}>
            {ad.cta_label} <ArrowRight size={14} />
          </a>
        ))}
    </section>
  );
}
