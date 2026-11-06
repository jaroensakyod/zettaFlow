// Sample companies, posts and sponsored cards for เครือข่ายธุรกิจ: the public mockup (/feed/preview) and the
// real feed while the network has no posts yet (always labelled ตัวอย่าง). Every company here is fictional.
import { Bookmark, BriefcaseBusiness, Eye, Handshake, Heart, MessageSquare, Newspaper, Plus, Share2, Sparkles } from "lucide-react";
import type { FeedAd } from "@/lib/ads";

export type SamplePost = {
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
export const samplePosts: SamplePost[] = [
  { company: "สยามคราฟต์ เฟอร์นิเจอร์", tint: "#7c4dff", meta: "ผลิต · กรุงเทพฯ", ago: "2 ชม.", by: "ทีมการตลาด", kind: "post", title: "เปิดโชว์รูมใหม่ที่บางนา พร้อมคอลเลกชันโต๊ะไม้สัก", body: "รับออกแบบโต๊ะทำงานและชั้นวางตามขนาดพื้นที่ออฟฟิศ บริษัทไหนกำลังรีโนเวตออฟฟิศ ทักมาคุยได้เลย มีส่วนลดพิเศษสำหรับสมาชิก EliteFlow", likes: 24, comments: 6 },
  { company: "ลมหนาว คอฟฟี่", tint: "#e0457b", meta: "ร้านอาหาร / คาเฟ่ · เชียงใหม่", ago: "5 ชม.", by: "เจ้าของร้าน", kind: "job", title: "บาริสต้า (2 ตำแหน่ง)", body: "รับสมัครบาริสต้าประจำสาขานิมมาน มีประสบการณ์จะพิจารณาเป็นพิเศษ", where: "นิมมาน, เชียงใหม่", budget: "ตามประสบการณ์", likes: 11, comments: 3, hint: "แนะนำ · ธุรกิจประเภทเดียวกับคุณ" },
  { company: "กรีนบิลด์ ดีไซน์", tint: "#1d9a5b", meta: "ก่อสร้าง / ตกแต่ง · กรุงเทพฯ", ago: "8 ชม.", by: "ฝ่ายจัดซื้อ", kind: "partner", title: "หา Supplier ไม้อัด 3 สาขา", body: "กำลังหา Supplier ไม้อัดและวัสดุตกแต่ง สำหรับโปรเจกต์ร้านค้า 3 สาขา ส่งของได้ทั่วกรุงเทพฯ ภายในเดือนหน้า", where: "กรุงเทพฯ", budget: "ตามใบเสนอราคา", likes: 8, comments: 4 },
  { company: "บ้านสวน ออร์แกนิค", tint: "#2f74e0", meta: "เกษตรกรรม · นครปฐม", ago: "1 วัน", by: "ฝ่ายขาย", kind: "post", title: "ผักออร์แกนิกส่งตรงร้านอาหารทุกเช้า", body: "รับออเดอร์ร้านอาหารและโรงแรมในกรุงเทพฯ ตัดสดตี 4 ส่งถึงก่อน 9 โมง มีใบรับรอง Organic Thailand", likes: 31, comments: 9 },
  { company: "ไทยลอจิส เอ็กซ์เพรส", tint: "#b25a00", meta: "ขนส่ง / โลจิสติกส์ · ชลบุรี", ago: "1 วัน", by: "ฝ่ายปฏิบัติการ", kind: "partner", title: "รับช่วงงานขนส่งภาคตะวันออก", body: "มีรถ 6 ล้อว่างทุกวันอังคาร–พฤหัส เส้นทางชลบุรี–ระยอง–กรุงเทพฯ ยินดีรับงานต่อจากบริษัทขนส่งพันธมิตร", where: "ชลบุรี", likes: 5, comments: 2 },
];
export const sampleAds: FeedAd[] = [
  { id: "a1", company: "พรีเมียร์ บูธ แอนด์ อีเวนต์", industry: "อีเวนต์ / จัดงาน", title: "รับออกแบบและติดตั้งบูธงานแฟร์ ครบจบในที่เดียว", body: "ออกแบบ 3D ฟรี ผลิตและติดตั้งภายใน 7 วัน ผลงานกว่า 200 บูธที่ไบเทคและอิมแพ็ค", cta_label: "ดูผลงาน", cta_url: "", tone: "violet" },
  { id: "a2", company: "บัญชีดี แอคเคาน์ติ้ง", industry: "บริการด้านบัญชี", title: "ทำบัญชีและยื่นภาษีรายเดือน เริ่ม 2,500 บาท", body: "เชื่อมกับ EliteFlow อ่านใบเสร็จจาก LINE ได้ทันที ปิดงบไวขึ้น", cta_label: "ขอใบเสนอราคา", cta_url: "", tone: "blue" },
  { id: "a3", company: "คลีนโปร เซอร์วิส", industry: "ทำความสะอาด / แม่บ้าน", title: "แม่บ้านออฟฟิศรายเดือน ทดลองฟรี 1 วัน", body: "", cta_label: "ทักเลย", cta_url: "", tone: "green" },
];
export const sampleSuggest = [
  { name: "ช่างดี ซ่อมบำรุง", tint: "#7c4dff", meta: "ซ่อมบำรุง · กรุงเทพฯ", why: "ธุรกิจประเภทเดียวกับคุณ" },
  { name: "อิมแพ็ค พริ้นท์", tint: "#e0457b", meta: "สิ่งพิมพ์ · นนทบุรี", why: "อยู่จังหวัดเดียวกัน" },
  { name: "สมาร์ท ไอที โซลูชัน", tint: "#2f74e0", meta: "ไอที · กรุงเทพฯ", why: "อัปเดตล่าสุด 06/11" },
];
const kindLabel = { post: "ข่าว & ผลงาน", job: "ประกาศงาน", partner: "หาพาร์ทเนอร์" } as const;
const KindIcon = { post: Newspaper, job: BriefcaseBusiness, partner: Handshake } as const;
export const sampleLogo = (name: string, tint: string, size: number) => (
  <span className="net-logo" style={{ width: size, height: size, background: tint, fontSize: size / 2.8 }}>
    {name.slice(0, 2)}
  </span>
);

export function PostMock({ p, sample }: { p: SamplePost; sample?: boolean }) {
  const Icon = KindIcon[p.kind];
  return (
    <article className="card li-post">
      {sample && <span className="sample-badge">ตัวอย่าง</span>}
      {p.hint && (
        <p className="li-post-hint">
          <Sparkles size={13} /> {p.hint}
        </p>
      )}
      <header className="li-post-head">
        {sampleLogo(p.company, p.tint, 48)}
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
        <span className="li-stat like">
          <Heart size={14} /> {p.likes}
        </span>
        <span className="li-stat">
          <MessageSquare size={14} /> {p.comments}
        </span>
        <span className="li-stat">
          <Share2 size={14} /> {Math.round(p.likes / 3)}
        </span>
        <span className="li-stat views">
          <Eye size={14} /> {p.likes * 37}
        </span>
      </div>
      <div className="li-actions">
        <button type="button">
          <Heart size={18} /> ถูกใจ
        </button>
        <button type="button">
          <MessageSquare size={18} /> แสดงความคิดเห็น
        </button>
        <button type="button">
          <Share2 size={18} /> แชร์
        </button>
        <button type="button">
          <Bookmark size={18} /> บันทึก
        </button>
      </div>
    </article>
  );
}

/** The feed while nobody on the network has posted yet: sample posts and a sample ad, clearly marked as samples. */
export function SampleFeed({ kind, AdCard }: { kind: string; AdCard: (p: { ad: FeedAd; preview?: boolean }) => React.ReactNode }) {
  const list = samplePosts.filter((p) => kind === "all" || p.kind === kind);
  return (
    <>
      <div className="sample-note">
        <Sparkles size={15} />
        <span>
          <b>ยังไม่มีอัปเดตจริงในเครือข่าย</b> ด้านล่างเป็น<b>ตัวอย่าง</b>หน้าตาเมื่อบริษัทต่าง ๆ เริ่มลงอัปเดตและโฆษณา จะหายไปเองเมื่อมีโพสต์จริง
        </span>
      </div>
      {list.map((p, i) => (
        <div key={p.title}>
          <PostMock p={p} sample />
          {i === 1 && (
            <div className="sample-wrap">
              <span className="sample-badge">ตัวอย่างโฆษณา</span>
              {AdCard({ ad: sampleAds[0], preview: true })}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
