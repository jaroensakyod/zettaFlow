// /feed/preview — a public, no-login mockup of เครือข่ายธุรกิจ with sample companies, posts and sponsored cards.
// For showing prospects and advertisers what the network and its ads look like. Every company here is fictional.
import Link from "next/link";
import { BriefcaseBusiness, ChevronRight, Handshake, Newspaper, Plus } from "lucide-react";
import { AdCard } from "@/components/ad-card";
import { PostMock, sampleAds as ads, sampleLogo as logo, samplePosts as posts, sampleSuggest as suggest } from "@/components/feed-samples";

export const metadata = {
  title: "ตัวอย่างเครือข่ายธุรกิจ — EliteFlow",
  description: "หน้าตัวอย่างฟีดเครือข่ายธุรกิจและการ์ดโฆษณาผู้สนับสนุนบน EliteFlow",
  icons: { icon: "/brand/eliteflow-icon.png", apple: "/brand/eliteflow-mark.png" },
};


export default function FeedPreview() {
  return (
    <div className="feed-preview">
      <header className="feed-preview-bar">
        <Link href="/zetta" className="feed-preview-brand">
          <img src="/brand/eliteflow-mark.png" alt="" width={32} height={32} />
          <b>
            Elite<span>Flow</span>
          </b>
        </Link>
        <span className="feed-preview-tag">ตัวอย่างหน้าเครือข่ายธุรกิจ · ข้อมูลทั้งหมดเป็นตัวอย่าง</span>
        <nav>
          <Link href="/workspace/ads" className="secondary">
            ลงโฆษณา
          </Link>
          <Link href="/feed?signup=1" className="primary">
            เข้าร่วมฟรี
          </Link>
        </nav>
      </header>
      <section className="feed-preview-hero">
        <h1>เครือข่ายธุรกิจสำหรับบริษัทไทย</h1>
        <p>อัปเดตผลงาน ประกาศงาน หาพาร์ทเนอร์ และลงโฆษณาให้บริษัทที่ใช่เห็นธุรกิจของคุณ</p>
      </section>
      <div className="li">
        <aside className="li-left">
          <section className="card li-profile">
            <div className="li-profile-cover" style={{ background: "linear-gradient(135deg,#ede4ff,#f9f6ff)" }} />
            <div className="li-profile-logo">{logo("บริษัทของคุณ", "#5b37c9", 64)}</div>
            <h2>บริษัทของคุณ</h2>
            <p className="li-tagline">ประเภทธุรกิจ · จังหวัด</p>
          </section>
        </aside>
        <main className="li-main" aria-label="ตัวอย่างอัปเดต">
          <section className="card li-start feed-preview-start">
            <span>เริ่มลงอัปเดตในนามบริษัทของคุณ…</span>
            <div>
              <span>
                <Newspaper size={16} /> ข่าว & ผลงาน
              </span>
              <span>
                <BriefcaseBusiness size={16} /> ประกาศงาน
              </span>
              <span>
                <Handshake size={16} /> หาพาร์ทเนอร์
              </span>
            </div>
          </section>
          {posts.slice(0, 3).map((p) => (
            <PostMock key={p.title} p={p} />
          ))}
          <div className="feed-preview-callout">↓ การ์ดผู้สนับสนุนแทรกในฟีดทุก 5 โพสต์</div>
          <AdCard ad={ads[0]} preview />
          {posts.slice(3).map((p) => (
            <PostMock key={p.title} p={p} />
          ))}
          <AdCard ad={ads[2]} preview />
        </main>
        <aside className="li-right">
          <div className="feed-preview-callout">↓ การ์ดผู้สนับสนุนแถบขวา</div>
          <AdCard ad={ads[1]} compact preview />
          <Link href="/workspace/ads" className="card li-advertise">
            <span>
              <b>ลงโฆษณาในเครือข่ายธุรกิจ</b>
              <small>ให้บริษัทอื่นเห็นสินค้าและบริการของคุณ เริ่ม 30 เหรียญ</small>
            </span>
            <ChevronRight size={16} />
          </Link>
          <section className="card li-side">
            <div className="li-side-head">
              <h2>บริษัทแนะนำให้ติดตาม</h2>
            </div>
            {suggest.map((c) => (
              <div className="li-suggest" key={c.name}>
                {logo(c.name, c.tint, 44)}
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.meta}</small>
                  <em className="li-suggest-why">{c.why}</em>
                  <span className="li-follow-pill">
                    <Plus size={14} /> ติดตาม
                  </span>
                </span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
