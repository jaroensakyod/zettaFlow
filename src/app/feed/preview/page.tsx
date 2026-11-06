// /feed/preview — a public, no-login mockup of เครือข่ายธุรกิจ with sample companies, posts and sponsored cards.
// For showing prospects and advertisers what the network and its ads look like. Every company here is fictional.
import Link from "next/link";
import { BriefcaseBusiness, ChevronRight, Handshake, MessageSquare, Newspaper, Plus, Share2, Sparkles, ThumbsUp } from "lucide-react";
import { AdCard } from "@/components/ad-card";
import type { FeedAd } from "@/lib/ads";

export const metadata = {
  title: "ตัวอย่างเครือข่ายธุรกิจ — EliteFlow",
  description: "หน้าตัวอย่างฟีดเครือข่ายธุรกิจและการ์ดโฆษณาผู้สนับสนุนบน EliteFlow",
  icons: { icon: "/brand/eliteflow-icon.png", apple: "/brand/eliteflow-mark.png" },
};

type Post = {
  company: string;
  tint: string;
  meta: string;
  ago: string;
  by: string;
  kind: "post" | "job" | "partner";
  title: string;
  body: string;
  where?: string;
  budget?: string;
  likes: number;
  comments: number;
  hint?: string;
};
const posts: Post[] = [
  { company: "สยามคราฟต์ เฟอร์นิเจอร์", tint: "#7c4dff", meta: "ผลิต · กรุงเทพฯ", ago: "2 ชม.", by: "ทีมการตลาด", kind: "post", title: "เปิดโชว์รูมใหม่ที่บางนา พร้อมคอลเลกชันโต๊ะไม้สัก", body: "รับออกแบบโต๊ะทำงานและชั้นวางตามขนาดพื้นที่ออฟฟิศ บริษัทไหนกำลังรีโนเวตออฟฟิศ ทักมาคุยได้เลย มีส่วนลดพิเศษสำหรับสมาชิก EliteFlow", likes: 24, comments: 6 },
  { company: "ลมหนาว คอฟฟี่", tint: "#e0457b", meta: "ร้านอาหาร / คาเฟ่ · เชียงใหม่", ago: "5 ชม.", by: "เจ้าของร้าน", kind: "job", title: "บาริสต้า (2 ตำแหน่ง)", body: "รับสมัครบาริสต้าประจำสาขานิมมาน มีประสบการณ์จะพิจารณาเป็นพิเศษ", where: "นิมมาน, เชียงใหม่", budget: "ตามประสบการณ์", likes: 11, comments: 3, hint: "แนะนำ · ธุรกิจประเภทเดียวกับคุณ" },
  { company: "กรีนบิลด์ ดีไซน์", tint: "#1d9a5b", meta: "ก่อสร้าง / ตกแต่ง · กรุงเทพฯ", ago: "8 ชม.", by: "ฝ่ายจัดซื้อ", kind: "partner", title: "หา Supplier ไม้อัด 3 สาขา", body: "กำลังหา Supplier ไม้อัดและวัสดุตกแต่ง สำหรับโปรเจกต์ร้านค้า 3 สาขา ส่งของได้ทั่วกรุงเทพฯ ภายในเดือนหน้า", where: "กรุงเทพฯ", budget: "ตามใบเสนอราคา", likes: 8, comments: 4 },
  { company: "บ้านสวน ออร์แกนิค", tint: "#2f74e0", meta: "เกษตรกรรม · นครปฐม", ago: "1 วัน", by: "ฝ่ายขาย", kind: "post", title: "ผักออร์แกนิกส่งตรงร้านอาหารทุกเช้า", body: "รับออเดอร์ร้านอาหารและโรงแรมในกรุงเทพฯ ตัดสดตี 4 ส่งถึงก่อน 9 โมง มีใบรับรอง Organic Thailand", likes: 31, comments: 9 },
  { company: "ไทยลอจิส เอ็กซ์เพรส", tint: "#b25a00", meta: "ขนส่ง / โลจิสติกส์ · ชลบุรี", ago: "1 วัน", by: "ฝ่ายปฏิบัติการ", kind: "partner", title: "รับช่วงงานขนส่งภาคตะวันออก", body: "มีรถ 6 ล้อว่างทุกวันอังคาร–พฤหัส เส้นทางชลบุรี–ระยอง–กรุงเทพฯ ยินดีรับงานต่อจากบริษัทขนส่งพันธมิตร", where: "ชลบุรี", likes: 5, comments: 2 },
];
const ads: FeedAd[] = [
  { id: "a1", company: "พรีเมียร์ บูธ แอนด์ อีเวนต์", industry: "อีเวนต์ / จัดงาน", title: "รับออกแบบและติดตั้งบูธงานแฟร์ ครบจบในที่เดียว", body: "ออกแบบ 3D ฟรี ผลิตและติดตั้งภายใน 7 วัน ผลงานกว่า 200 บูธที่ไบเทคและอิมแพ็ค", cta_label: "ดูผลงาน", cta_url: "", tone: "violet" },
  { id: "a2", company: "บัญชีดี แอคเคาน์ติ้ง", industry: "บริการด้านบัญชี", title: "ทำบัญชีและยื่นภาษีรายเดือน เริ่ม 2,500 บาท", body: "เชื่อมกับ EliteFlow อ่านใบเสร็จจาก LINE ได้ทันที ปิดงบไวขึ้น", cta_label: "ขอใบเสนอราคา", cta_url: "", tone: "blue" },
  { id: "a3", company: "คลีนโปร เซอร์วิส", industry: "ทำความสะอาด / แม่บ้าน", title: "แม่บ้านออฟฟิศรายเดือน ทดลองฟรี 1 วัน", body: "", cta_label: "ทักเลย", cta_url: "", tone: "green" },
];
const suggest = [
  { name: "ช่างดี ซ่อมบำรุง", tint: "#7c4dff", meta: "ซ่อมบำรุง · กรุงเทพฯ", why: "ธุรกิจประเภทเดียวกับคุณ" },
  { name: "อิมแพ็ค พริ้นท์", tint: "#e0457b", meta: "สิ่งพิมพ์ · นนทบุรี", why: "อยู่จังหวัดเดียวกัน" },
  { name: "สมาร์ท ไอที โซลูชัน", tint: "#2f74e0", meta: "ไอที · กรุงเทพฯ", why: "อัปเดตล่าสุด 06/11" },
];
const kindLabel = { post: "ข่าว & ผลงาน", job: "ประกาศงาน", partner: "หาพาร์ทเนอร์" } as const;
const KindIcon = { post: Newspaper, job: BriefcaseBusiness, partner: Handshake } as const;
const logo = (name: string, tint: string, size: number) => (
  <span className="net-logo" style={{ width: size, height: size, background: tint, fontSize: size / 2.8 }}>
    {name.slice(0, 2)}
  </span>
);

function PostMock({ p }: { p: Post }) {
  const Icon = KindIcon[p.kind];
  return (
    <article className="card li-post">
      {p.hint && (
        <p className="li-post-hint">
          <Sparkles size={13} /> {p.hint}
        </p>
      )}
      <header className="li-post-head">
        {logo(p.company, p.tint, 48)}
        <div className="li-post-who">
          <strong>{p.company}</strong>
          <small>{p.meta}</small>
          <small>
            {p.ago} · โดย {p.by}
          </small>
        </div>
        <button type="button" className="li-follow">
          <Plus size={15} /> ติดตาม
        </button>
      </header>
      {p.kind === "post" ? (
        <>
          <h3 className="li-post-title">{p.title}</h3>
          <div className="li-post-text">
            <p>{p.body}</p>
          </div>
        </>
      ) : (
        <div className="li-offer">
          <span className="li-offer-icon">
            <Icon size={20} />
          </span>
          <span className="li-offer-text">
            <small>{kindLabel[p.kind]}</small>
            <strong>{p.title}</strong>
            <small>{[p.where, p.budget].filter(Boolean).join(" · ")}</small>
            <p>{p.body}</p>
          </span>
        </div>
      )}
      <div className="li-counts">
        <span>
          <ThumbsUp size={13} /> {p.likes}
        </span>
        <span>{p.comments} ความคิดเห็น</span>
      </div>
      <div className="li-actions">
        <button type="button">
          <ThumbsUp size={16} /> ถูกใจ
        </button>
        <button type="button">
          <MessageSquare size={16} /> แสดงความคิดเห็น
        </button>
        <button type="button">
          <Share2 size={16} /> แชร์
        </button>
      </div>
    </article>
  );
}

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
