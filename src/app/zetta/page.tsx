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
  FolderKanban,
  MoreHorizontal,
} from "lucide-react";
import { PricingCards, Faq, PromoStrip } from "./landing-parts";
import "./landing.css";

const thai = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--lp-thai" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--lp-display" });

export const metadata = {
  title: "Zetta Flow AI — CEO Command Center",
  description: "เปลี่ยนทุกบทสนทนาใน LINE ให้เป็นข้อมูลธุรกิจ Workflow และ Dashboard แบบ Real-time",
};

function Logo() {
  return (
    <span className="lp-logo">
      <svg viewBox="0 0 40 40" aria-hidden>
        <defs>
          <linearGradient id="lpz" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c5cff" />
            <stop offset="1" stopColor="#e443d0" />
          </linearGradient>
        </defs>
        <path d="M6 6h28l-19 22h17v6H6l19-22H6z" fill="url(#lpz)" />
      </svg>
      <span>
        <b>Zetta Flow AI</b>
        <small>AI That Moves Your Business Forward</small>
      </span>
    </span>
  );
}

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

const steps = [
  { icon: MessageCircle, title: "ทีมส่งงานใน LINE", body: "ข้อความ รูป สลิป ใบส่งของ PDF — ใช้ LINE แบบเดิม ไม่ต้องจำรหัสงาน" },
  { icon: Sparkles, title: "AI สกัดและตรวจข้อมูล", body: "อ่านตามฟอร์มที่คุณออกแบบ ขาดอะไรบอททวงถามทันที" },
  { icon: Workflow, title: "อนุมัติและแตกงาน", body: "ผู้จัดการพิมพ์ “อนุมัติ” ระบบส่งงานต่อให้ทุกแผนกอัตโนมัติ" },
  { icon: ChartNoAxesCombined, title: "Dashboard Real-time", body: "CEO เห็นยอดขาย โครงการ และความเสี่ยงในหน้าเดียว" },
];

const features = [
  { icon: LayoutGrid, title: "Dynamic Form Designer", body: "บอก AI ว่าอยากเก็บอะไร ระบบร่างฟอร์มให้ เพิ่มฟิลด์ได้ในนาทีเดียว ไม่ต้องจ้างโปรแกรมเมอร์" },
  { icon: ChartNoAxesCombined, title: "Auto-Generated Dashboard", body: "ทุกฟิลด์กลายเป็นกราฟอัตโนมัติ ลากจัดวาง ซ่อน และกำหนดสิทธิ์รายกราฟ" },
  { icon: Bot, title: "AI Chat Assistant", body: "ถามในแชทว่า “มีงานรออนุมัติกี่งาน?” ได้คำตอบจากข้อมูลจริงทันที" },
  { icon: ReceiptText, title: "ตรวจสลิปอัตโนมัติ", body: "อ่าน QR บนสลิป ตรวจความถูกต้อง เทียบยอด และกันสลิปซ้ำ" },
  { icon: Users, title: "Flexible Role Mapping", body: "Owner, Manager, Staff, Viewer แยกสิทธิ์ตามแผนก ผูก LINE กับตำแหน่งจริง" },
  { icon: Link2, title: "Share Dashboard", body: "แชร์ให้พาร์ทเนอร์ด้วยลิงก์ที่มีรหัสผ่านและวันหมดอายุ" },
];

const departments = [
  { icon: PackageCheck, name: "จัดซื้อ / คลังสินค้า", note: "ถ่ายใบส่งของ → อัปเดตสต็อก", stat: "128 รายการ", tone: "violet" },
  { icon: Wallet, name: "การเงิน", note: "ส่งสลิป → ตรวจ QR → ลงบัญชี", stat: "฿2.4M", tone: "blue" },
  { icon: ChartNoAxesCombined, name: "ฝ่ายขาย / PC", note: "รายงานยอดรายวัน เทียบเป้า", stat: "63.7% ของเป้า", tone: "pink" },
  { icon: FileScan, name: "BD / สัญญาเช่า", note: "PDF สัญญา → คลังเอกสาร", stat: "18 พื้นที่", tone: "amber" },
];

export default function ZettaHome() {
  return (
    <div className={`lp ${thai.variable} ${display.variable}`}>
      <header className="lp-header">
        <Link href="/zetta" aria-label="Zetta Flow AI หน้าแรก"><Logo /></Link>
        <nav aria-label="เมนูหลัก">
          <a href="#product">Product</a>
          <a href="#how">How it works</a>
          <a href="#solutions">Solutions</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="lp-header-cta">
          <a href="/demo" className="lp-link">ดูตัวอย่าง</a>
          <Link href="/eliteflow" className="lp-link">เข้าสู่ระบบ</Link>
          <Link href="/zetta/dashboard" className="lp-btn primary sm">ทดลองฟรี</Link>
        </div>
      </header>

      <main>
        <PromoStrip />
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-chip"><Sparkles size={14} /> AI-Powered Executive Dashboard</span>
            <h1>
              CEO <span>Command Center</span>
            </h1>
            <p className="lp-lead">
              เปลี่ยนทุกบทสนทนาใน LINE ให้กลายเป็นข้อมูลธุรกิจ Workflow และ Dashboard แบบ Real-time
              — ทีมทำงานแบบเดิม ผู้บริหารตัดสินใจได้เร็วกว่าเดิม
            </p>
            <div className="lp-hero-actions">
              <Link href="/zetta/dashboard" className="lp-btn primary">
                เริ่มทดลองฟรี 14 วัน <ArrowRight size={18} />
              </Link>
              <a href="/demo" className="lp-btn ghost">ดูระบบตัวอย่าง</a>
            </div>
            <ul className="lp-proof">
              <li><CircleCheck size={16} /> ไม่ต้องใช้บัตรเครดิต</li>
              <li><CircleCheck size={16} /> เชื่อม LINE ใน 5 นาที</li>
              <li><CircleCheck size={16} /> ข้อมูลแยกต่อบริษัท 100%</li>
            </ul>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-glow" aria-hidden />
            <PhoneReport />
            <PhoneOverview />
            <div className="lp-float f1"><span className="dot ok" />อนุมัติพื้นที่ Fashion Island แล้ว</div>
            <div className="lp-float f2"><Bot size={14} />AI: ยอดขายวันนี้ ฿58,420</div>
          </div>
        </section>

        <section className="lp-stats" aria-label="ประโยชน์หลัก">
          {[["80%", "เวลาสรุปรายงานที่ลดลง"], ["0", "ฟอร์มที่พนักงานต้องกรอกซ้ำ"], ["24/7", "AI ทำงานในทุกกลุ่ม LINE"], ["1", "หน้าจอสำหรับทุกการตัดสินใจ"]].map(([n, l]) => (
            <div key={l}><b>{n}</b><span>{l}</span></div>
          ))}
        </section>

        <section id="how" className="lp-section">
          <header className="lp-head">
            <span className="lp-kicker">HOW IT WORKS</span>
            <h2>จากแชท สู่การตัดสินใจ ใน 4 ขั้นตอน</h2>
            <p>ไม่ต้องเปลี่ยนพฤติกรรมทีม เพิ่มแค่บอทหนึ่งตัวเข้าไปในกลุ่ม</p>
          </header>
          <div className="lp-how">
            <div className="lp-steps">
              {steps.map((s, i) => (
                <article key={s.title}>
                  <span className="lp-step-n">{i + 1}</span>
                  <s.icon size={20} />
                  <div><h3>{s.title}</h3><p>{s.body}</p></div>
                </article>
              ))}
            </div>
            <div className="lp-chat" aria-label="ตัวอย่างแชทในกลุ่ม LINE">
              <div className="lp-chat-top"><MessageCircle size={16} /> [ZettaFlow] คลังสินค้า · 6 คน</div>
              <div className="msg"><i>W</i><p>ส่งของแล้ว: ป้ายราคา 100, ไม้แขวน 180, หุ่น 2<br />ซัพพลายเออร์: Siam Display</p></div>
              <div className="msg bot"><i><Bot size={13} /></i><p>⚠️ ข้อมูลยังไม่ครบ กรุณาส่งเพิ่ม: <b>ยอดรวม</b></p></div>
              <div className="msg"><i>W</i><p>ยอดรวม: 18,500</p></div>
              <div className="msg bot"><i><Bot size={13} /></i><p>✅ บันทึกแล้ว รอผู้จัดการอนุมัติ</p></div>
              <div className="msg me"><p>อนุมัติปล่อยของ</p></div>
              <div className="msg bot"><i><Bot size={13} /></i><p>✅ อนุมัติแล้ว แจ้งงานต่อให้ทีม PC และ Marketing</p></div>
            </div>
          </div>
        </section>

        <section id="product" className="lp-section">
          <header className="lp-head">
            <span className="lp-kicker">PRODUCT</span>
            <h2>AI ที่ปรับตัวเข้ากับทุกธุรกิจ</h2>
            <p>One AI Platform. Unlimited Business Workflows.</p>
          </header>
          <div className="lp-features">
            {features.map((f) => (
              <article key={f.title}>
                <span className="lp-ficon"><f.icon size={20} /></span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="solutions" className="lp-section">
          <header className="lp-head">
            <span className="lp-kicker">MULTI-BUSINESS FRAMEWORK</span>
            <h2>1 สมองกล หลายห้องแชท</h2>
            <p>แต่ละแผนกมีกลุ่ม LINE และฟอร์มของตัวเอง ข้อมูลไม่ปนกัน</p>
          </header>
          <div className="lp-depts">
            {departments.map((d) => (
              <Link key={d.name} href="/zetta/dashboard" className={"lp-dept " + d.tone}>
                <span className="lp-ficon"><d.icon size={20} /></span>
                <h3>{d.name}</h3>
                <p>{d.note}</p>
                <b>{d.stat}</b>
                <span className="lp-more">ดู Dashboard <ArrowRight size={14} /></span>
              </Link>
            ))}
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
            <p>เริ่มฟรี 14 วัน อัปเกรดเมื่อพร้อม</p>
          </header>
          <PricingCards />
        </section>

        <section id="faq" className="lp-section narrow">
          <header className="lp-head"><span className="lp-kicker">FAQ</span><h2>คำถามที่พบบ่อย</h2></header>
          <Faq />
        </section>

        <section className="lp-cta">
          <h2>พร้อมให้ AI ช่วยบริหารธุรกิจแล้วหรือยัง?</h2>
          <p>ตั้งค่าเสร็จภายในวันเดียว ทีมเราช่วยออกแบบ Workflow ให้ฟรีในช่วงทดลอง</p>
          <div className="lp-hero-actions center">
            <Link href="/zetta/dashboard" className="lp-btn primary">เริ่มทดลองฟรี <ArrowRight size={18} /></Link>
            <a href="tel:0960041231" className="lp-btn ghost">โทร 096-004-1231</a>
          </div>
        </section>
      </main>

      <footer className="lp-footer" id="contact">
        <div>
          <Logo />
          <p>One AI Platform. Unlimited Business Workflows.</p>
        </div>
        <div>
          <h4>ติดต่อ</h4>
          <a href="mailto:Sirisoaa@gmail.com">Sirisoaa@gmail.com</a>
          <a href="tel:0960041231">096-004-1231</a>
          <span>LINE: siri_studio</span>
        </div>
        <div>
          <h4>ผลิตภัณฑ์</h4>
          <Link href="/zetta/dashboard">Executive Dashboard</Link>
          <Link href="/zetta/templates">Form Designer</Link>
          <Link href="/eliteflow">EliteFlow Workspace</Link>
        </div>
        <small>© 2026 Zetta Flow AI · www.zettaflowai.com</small>
      </footer>
    </div>
  );
}
