import Link from "next/link";
import { IBM_Plex_Sans_Thai, Plus_Jakarta_Sans } from "next/font/google";
import {
  ArrowRight,
  Bell,
  Bot,
  ChartNoAxesCombined,
  CircleCheck,
  FileScan,
  Home,
  LayoutGrid,
  Link2,
  Lock,
  MessageCircle,
  PackageCheck,
  Plus,
  ReceiptText,
  Share2,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  Workflow,
  Download,
  Megaphone,
  Store,
  FolderKanban,
  MoreHorizontal,
} from "lucide-react";
import { PricingCards, Faq, PromoStrip, AutoRow } from "./landing-parts";
import { Logo, LandingHeader, LandingFooter, SIGNUP } from "./landing-shell";
import "./landing.css";
import "./promo-video.css";
import { HeroVideo } from "./promo-video";
import { LineLive } from "./line-live";
import { BusinessShowcase } from "./business-showcase";
import "./showcase.css";
import "./line-live.css";

const thai = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--lp-thai" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--lp-display" });

export const metadata = {
  title: "EliteFlow — ระบบบริหารธุรกิจและเครือข่ายบริษัท",
  description: "เปลี่ยนทุกบทสนทนาใน LINE ให้เป็นข้อมูลธุรกิจ Workflow และ Dashboard แบบ Real-time พร้อมเครือข่ายธุรกิจและผู้ช่วย AI น้องโฟลว์",
  icons: { icon: "/brand/eliteflow-icon.png", apple: "/brand/eliteflow-mark.png" },
};

/** Tiny inline sparkline. */
function Spark({ points, color = "#7c5cff" }: { points: number[]; color?: string }) {
  const max = Math.max(...points), min = Math.min(...points);
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 100},${30 - ((p - min) / (max - min || 1)) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="lp-spark" aria-hidden>
      <polyline points={`0,32 ${d} 100,32`} fill={color} opacity=".12" stroke="none" />
      <polyline points={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PhoneNav() {
  return (
    <nav className="ph-nav" aria-hidden>
      <span className="on"><Home size={15} />Overview</span>
      <span><FolderKanban size={15} />Projects</span>
      <span className="ph-plus"><Plus size={18} /></span>
      <span><ChartNoAxesCombined size={15} />Analytics</span>
      <span><MoreHorizontal size={15} />More</span>
    </nav>
  );
}

function PhoneOverview() {
  const kpis = [
    { label: "Sales Revenue", value: "฿1,284,500", delta: "8.4%", pts: [3, 5, 4, 6, 5, 8, 7, 10] },
    { label: "Projects Active", value: "32", delta: "4.7%", pts: [4, 4, 5, 4, 6, 6, 8, 9] },
    { label: "Tasks Completed", value: "487", delta: "12.4%", pts: [2, 3, 3, 5, 4, 6, 8, 9], color: "#3b82f6" },
    { label: "Team Performance", value: "96%", delta: "5.9%", pts: [5, 4, 6, 5, 7, 6, 9, 8], color: "#e443d0" },
  ];
  return (
    <div className="phone" aria-label="ตัวอย่างหน้าจอ Today Overview">
      <div className="ph-status"><b>9:41</b><i /></div>
      <div className="ph-top"><Logo /><Bell size={16} /></div>
      <div className="ph-body">
        <div className="ph-row"><h4>TODAY OVERVIEW</h4><small>updated 09:45</small></div>
        <div className="ph-kpis">
          {kpis.map((k) => (
            <div key={k.label}>
              <small>{k.label}</small>
              <b>{k.value}</b>
              <em>▲ {k.delta}</em>
              <Spark points={k.pts} color={k.color} />
            </div>
          ))}
        </div>
        <div className="ph-card">
          <div className="ph-row"><h4>AI INSIGHTS</h4><span className="ph-pill">See All</span></div>
          <ul className="ph-insights">
            <li><i style={{ background: "#f59e0b" }} />สาขา Bangkok ยอดเกินเป้า 21%</li>
            <li><i style={{ background: "#3b82f6" }} />3 โครงการรออนุมัติพื้นที่</li>
            <li><i style={{ background: "#7c5cff" }} />สินค้า 5 รายการใกล้หมดสต็อก</li>
          </ul>
        </div>
        <div className="ph-row"><h4>BRANCH OVERVIEW</h4></div>
        <div className="ph-branches">
          {[["Siam Paragon", "320,000", "a"], ["Central Ladprao", "280,000", "b"], ["Westgate", "240,000", "c"]].map(([n, s, c]) => (
            <div key={n}>
              <span className={"ph-photo " + c} />
              <b>{n}</b>
              <small>฿{s}</small>
            </div>
          ))}
        </div>
      </div>
      <PhoneNav />
    </div>
  );
}

function PhoneReport() {
  return (
    <div className="phone back" aria-label="ตัวอย่างหน้าจอ AI Executive Report">
      <div className="ph-status"><b>9:41</b><i /></div>
      <div className="ph-top"><Logo /><Bell size={16} /></div>
      <div className="ph-body">
        <div className="ph-row">
          <div><h4>AI EXECUTIVE REPORT</h4><small>Generated 09:45 AM</small></div>
          <span className="ph-icons"><Share2 size={13} /><Download size={13} /></span>
        </div>
        <div className="ph-health">
          <div>
            <small>BUSINESS STATUS</small>
            <b><i />Healthy</b>
            <small>ทุกอย่างเป็นไปตามแผนวันนี้</small>
          </div>
          <svg viewBox="0 0 44 44" aria-hidden>
            <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="4" />
            <circle cx="22" cy="22" r="18" fill="none" stroke="#5ff2b5" strokeWidth="4" strokeDasharray={`${0.87 * 113} 113`} strokeLinecap="round" transform="rotate(-90 22 22)" />
            <text x="22" y="26" textAnchor="middle">87</text>
          </svg>
        </div>
        <div className="ph-minis">
          <div><small>Sales Today</small><b>Growing</b><em>▲ 12.8%</em></div>
          <div><small>Revenue</small><b>฿12.48M</b><em>This month</em></div>
          <div><small>Pending</small><b>3</b><em>ต้องตัดสินใจ</em></div>
        </div>
        <h4 className="ph-h">PROJECT SUMMARY</h4>
        <table className="ph-table">
          <thead><tr><th>Project</th><th>Status</th><th>Sales</th></tr></thead>
          <tbody>
            {[["The Promenade", "On Progress", "250,000"], ["Fashion Island", "Completed", "180,000"], ["Central World", "On Progress", "320,000"], ["Mega Bangna", "Completed", "210,000"]].map(([p, s, v]) => (
              <tr key={p}><td>{p}</td><td className={s === "Completed" ? "ok" : ""}>{s}</td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <PhoneNav />
    </div>
  );
}



// What a paid package unlocks on top of the free บัญชีและการเงิน (see dept-menu.tsx), then App Shop for the rest.
const departments = [
  { icon: ChartNoAxesCombined, name: "ระบบขาย (Sales)", note: "ใบเสนอราคา คำสั่งซื้อ ลูกค้า เป้ายอดขาย และแพ็กเกจสินค้า", tone: "pink" },
  { icon: Megaphone, name: "ระบบการตลาด", note: "แคมเปญ คอนเทนต์ โปรโมชัน และผลลัพธ์ทุกช่องทาง", tone: "amber" },
  { icon: PackageCheck, name: "ระบบคลังสินค้า & จัดซื้อ", note: "สต็อกเข้า-ออก ใบสั่งซื้อ ผู้ขาย แจ้งเตือนของใกล้หมด", tone: "violet" },
  { icon: Users, name: "ระบบ HR", note: "พนักงาน ลางาน เวลาทำงาน และเอกสารบุคคล", tone: "blue" },
];
const shopExamples = ["คอนโด / ปล่อยเช่า", "คลินิกความงาม", "ร้านอาหาร & คาเฟ่", "คลินิกการแพทย์", "อสังหาริมทรัพย์", "ธีม & ผู้ช่วย AI"];

export default function LandingHome() {
  return (
    <div className={`lp ${thai.variable} ${display.variable}`}>
      <LandingHeader />

      <main>
        <PromoStrip />
        <HeroVideo>
          <div className="lp-hero-copy">
            <span className="lp-chip"><Sparkles size={14} /> ระบบบริหารธุรกิจ ที่สั่งงานผ่าน LINE ได้ทั้งหมด</span>
            <h1>
              สั่งงานใน LINE <span>ระบบบันทึกให้เอง</span>
            </h1>
            <p className="lp-lead">
              EliteFlow คือผู้ช่วย AI ในกลุ่ม LINE ของทีมคุณ — แค่แท็ก <b>@EliteFlow</b> แล้วพิมพ์ หรือถ่ายรูปใบเสร็จ
              AI จะสรุปให้ตรวจ ขออนุมัติ แล้วบันทึกเข้า<b> บัญชี · HR · สต็อก · ยอดขาย · งาน</b> อัตโนมัติ
              พร้อม Dashboard ผู้บริหารแบบเรียลไทม์
            </p>
            <div className="lp-hero-actions">
              <Link href={SIGNUP} className="lp-btn primary">
                ใช้งานฟรีได้เลย <ArrowRight size={18} />
              </Link>
              <a href="#live" className="lp-btn ghost">ดูการสั่งงานใน LINE ▶</a>
            </div>
            <ul className="lp-proof">
              <li><CircleCheck size={16} /> ฟรีตลอด · LINE 1 กลุ่ม + บัญชีและการเงิน</li>
              <li><CircleCheck size={16} /> เชื่อม LINE ใน 5 นาที</li>
              <li><CircleCheck size={16} /> ข้อมูลแยกต่อบริษัท 100%</li>
            </ul>
          </div>
        </HeroVideo>

        <section id="live" className="lp-live">
          <header className="lp-head">
            <span className="lp-kicker">เข้าใจ EliteFlow ใน 5 นาที</span>
            <h2>
              พิมพ์ในกลุ่ม LINE แบบนี้ <span>แล้วระบบทำให้ทั้งหมด</span>
            </h2>
            <p>ดูตัวอย่างจริง: เบิกเงิน ขอลา แจ้งยอดขาย เบิกของ สั่งงาน เพิ่มพนักงาน และถาม AI — กดเลือกเคสด้านล่างได้เลย</p>
          </header>
          <div className="lp-what">
            <article>
              <span>💬</span>
              <h3>EliteFlow คืออะไร</h3>
              <p>ระบบบริหารธุรกิจครบวงจร (บัญชี HR สต็อก ขาย โปรเจกต์) ที่ทีมใช้งานผ่านกลุ่ม LINE เดิม ไม่ต้องลงแอปใหม่ ไม่ต้องสอนใช้โปรแกรม</p>
            </article>
            <article>
              <span>🤖</span>
              <h3>ใช้งานยังไง</h3>
              <p>เพิ่มบอท EliteFlow เข้ากลุ่ม แท็ก @EliteFlow แล้วพิมพ์ภาษาพูดหรือส่งรูป AI สรุปเป็นการ์ด กดบันทึก / อนุมัติได้ในแชท</p>
            </article>
            <article>
              <span>📊</span>
              <h3>ได้อะไร</h3>
              <p>ทุกเรื่องในแชทกลายเป็นข้อมูลในระบบที่ถูกต้อง มีเลขเอกสาร ผู้อนุมัติ หลักฐาน และ Dashboard ให้ผู้บริหารเห็นธุรกิจทั้งหมดเรียลไทม์</p>
            </article>
          </div>
          <LineLive />
          <div className="lp-hero-actions center" style={{ marginTop: 36 }}>
            <Link href={SIGNUP} className="lp-btn primary">
              เริ่มใช้ฟรี เชื่อม LINE ใน 5 นาที <ArrowRight size={18} />
            </Link>
            <a href="/demo" className="lp-btn ghost">ลองระบบตัวอย่าง</a>
          </div>
        </section>

        <section className="lp-hero lp-mobile-show">
          <div className="lp-hero-copy">
            <span className="lp-chip"><Sparkles size={14} /> CEO ON MOBILE</span>
            <h2>
              เห็นธุรกิจทั้งหมด <span>ในมือถือเครื่องเดียว</span>
            </h2>
            <p className="lp-lead">
              ยอดขาย งาน โปรเจกต์ และสต็อก อัปเดตเรียลไทม์จากทุกกลุ่ม LINE พร้อม AI สรุปสถานะธุรกิจให้ทุกเช้า
              และกดอนุมัติเอกสารได้ทุกที่ ทุกเวลา
            </p>
            <div className="lp-hero-actions">
              <Link href={SIGNUP} className="lp-btn primary">
                ใช้งานฟรีได้เลย <ArrowRight size={18} />
              </Link>
            </div>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-glow" aria-hidden />
            <PhoneReport />
            <PhoneOverview />
            <div className="lp-float f1"><span className="dot ok" />อนุมัติพื้นที่ Fashion Island แล้ว</div>
            <div className="lp-float f2"><Bot size={14} />AI: ยอดขายวันนี้ ฿58,420</div>
          </div>
        </section>

        <section id="product" className="lp-section">
          <header className="lp-head">
            <span className="lp-kicker">PRODUCT</span>
            <h2>AI ที่ปรับตัวเข้ากับทุกธุรกิจ</h2>
            <p>หนึ่งแพลตฟอร์ม ทุกระบบงานของธุรกิจคุณ — One AI Platform. Unlimited Business Workflows.</p>
          </header>
          <BusinessShowcase />
        </section>

        <section id="solutions" className="lp-section">
          <header className="lp-head">
            <span className="lp-kicker">ALL-IN-ONE BUSINESS SYSTEM</span>
            <h2>ซื้อแพ็กเกจเดียว ได้ใช้ทุกระบบหลัก</h2>
            <p>เริ่มฟรีด้วยระบบบัญชีและการเงิน เมื่ออัปเกรดตั้งแต่ Starter ขึ้นไป ปลดล็อกระบบหลักของธุรกิจได้ทันที</p>
          </header>
          <div className="lp-sys-free">
            <span className="lp-ficon"><Wallet size={20} /></span>
            <div>
              <b>ระบบบัญชีและการเงิน</b>
              <small>รายรับ ค่าใช้จ่าย ใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ ภาษี · ใช้ได้ทุกบริษัท</small>
            </div>
            <em>ฟรีตลอด</em>
          </div>
          <AutoRow className="lp-depts">
            {departments.map((d) => (
              <a key={d.name} href="#pricing" className={"lp-dept " + d.tone}>
                <i className="lp-dept-orb" aria-hidden />
                <span className="lp-unlock"><Lock size={12} /> ปลดล็อกเมื่อซื้อแพ็กเกจ</span>
                <span className="lp-ficon"><d.icon size={22} /></span>
                <h3>{d.name}</h3>
                <p>{d.note}</p>
                <span className="lp-more">ดูแพ็กเกจ <ArrowRight size={14} /></span>
              </a>
            ))}
          </AutoRow>
          <div className="lp-shop">
            <span className="lp-shop-icon"><Store size={26} /></span>
            <div>
              <h3>ระบบอื่นๆ ให้เหมาะกับธุรกิจของคุณ ใน App Shop</h3>
              <p>เลือกเพิ่มระบบเฉพาะธุรกิจ ธีม และผู้ช่วย AI ได้ตามต้องการ</p>
              <div className="lp-shop-tags">
                {shopExamples.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
            <Link href={SIGNUP} className="lp-btn primary">
              ใช้งานฟรี แล้วเลือกใน App Shop <ArrowRight size={16} />
            </Link>
          </div>
          <div className="lp-security">
            <ShieldCheck size={22} />
            <p><b>ปลอดภัยระดับองค์กร</b> — แยกข้อมูลรายบริษัท (Tenant Isolation) · เข้ารหัส · สิทธิ์ตามบทบาท · Audit Log · สำรองข้อมูลทุกวัน</p>
            <Lock size={18} />
          </div>
        </section>

        <section id="pricing" className="lp-section">
          <header className="lp-head">
            <span className="lp-kicker">PRICING</span>
            <h2>แพ็กเกจที่โตไปพร้อมธุรกิจ</h2>
            <p>ใช้งานฟรีได้เลย LINE 1 กลุ่ม + ระบบบัญชีและการเงิน · อัปเกรดเมื่อพร้อม</p>
          </header>
          <PricingCards />
          <p className="lp-fine">
            <Link href="/pricing">เปรียบเทียบแพ็กเกจแบบละเอียด <ArrowRight size={14} /></Link>
          </p>
        </section>

        <section id="faq" className="lp-section narrow">
          <header className="lp-head"><span className="lp-kicker">FAQ</span><h2>คำถามที่พบบ่อย</h2></header>
          <Faq />
        </section>

        <section className="lp-cta">
          <h2>พร้อมให้ AI ช่วยบริหารธุรกิจแล้วหรือยัง?</h2>
          <p>เริ่มใช้ฟรีวันนี้ LINE 1 กลุ่ม + ระบบบัญชีและการเงิน ไม่ต้องใช้บัตรเครดิต</p>
          <div className="lp-hero-actions center">
            <Link href={SIGNUP} className="lp-btn primary">ใช้งานฟรีได้เลย <ArrowRight size={18} /></Link>
            <a href="tel:0960041231" className="lp-btn ghost">โทร 096-004-1231</a>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
