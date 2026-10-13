import Link from "next/link";
import {
  Clock3,
  Sparkles,
  Settings,
  ArrowRight,
  Zap,
  Crosshair,
  TrendingUp,
} from "lucide-react";
import "./marketing.css";
export const metadata = {
  title: "Zetta Flow AI — CEO Command Center",
  description: "สรุปทุกข้อมูลสำคัญ เพื่อการตัดสินใจที่เร็วกว่า ฉลาดกว่า",
};
const features = [
  {
    title: "Real-Time Reports",
    subtitle: "รับข้อมูลจากทีมในทุกพื้นที่แบบอัตโนมัติ",
    body: "Zetta Flow AI รองรับข้อมูลจาก LINE, Google Forms, Excel และระบบภายในองค์กร พร้อมแสดงแดชบอร์ดในรูปแบบ Real-time ครบทุกมิติ เพื่อช่วยผู้บริหารตัดสินใจได้ทันที",
    icon: Clock3,
  },
  {
    title: "AI Executive Summary",
    subtitle: "AI สรุปข้อมูลสำคัญให้พร้อมตัดสินใจ",
    body: "แสดงภาพรวมสถานะโครงการ ปัญหา ความเสี่ยง และแผนแก้ไขให้องค์กร ดูได้อย่างละเอียดในแอปเดียว แจ้งเตือนอย่างรวดเร็ว ผู้บริหารใช้เวลาในการติดตามงานน้อยลง ช่วยให้เน้นงานที่มีการตัดสินใจ",
    icon: Sparkles,
  },
  {
    title: "Smart Workflow Automation",
    subtitle: "ลดงานเอกสาร เพิ่มความเร็วในการทำงาน",
    body: "เปลี่ยนการรายงานแบบเดิมให้เป็นกระบวนการอัตโนมัติ ตั้งแต่การแจ้งข้อมูล การตรวจสอบ ไปจนถึงการรายงาน Dashboard และ Report พร้อมใช้งานภายในไม่กี่คลิก",
    icon: Settings,
  },
];
export default function ZettaHome() {
  return (
    <div className="zetta-home">
      <header className="zh-header">
        <Link href="/zetta" className="zh-brand">
          <span className="zh-logo-crop">
            <img src="/zetta/ceo-command-center.png" alt="Zetta Flow AI" />
          </span>
        </Link>
        <nav aria-label="เมนู ZettaFlow">
          <a href="#home">Home</a>
          <a href="#product">Product</a>
          <a href="#solutions">Solutions</a>
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>
      <main>
        <section id="home" className="zh-hero">
          <div className="zh-copy">
            <p className="zh-eyebrow">AI-Powered Executive Dashboard</p>
            <h1>
              CEO
              <br />
              <span>Command Center</span>
            </h1>
            <p className="zh-subtitle">
              สรุปทุกข้อมูลสำคัญ เพื่อการตัดสินใจที่เร็วกว่า ฉลาดกว่า
            </p>
            <div className="zh-features">
              {features.map((f) => (
                <article key={f.title}>
                  <span className="zh-feature-icon">
                    <f.icon size={29} />
                  </span>
                  <div>
                    <h2>• {f.title}</h2>
                    <h3>{f.subtitle}</h3>
                    <p>{f.body}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="zh-actions">
              <Link className="zh-cta" href="/zetta/dashboard">
                Request Demo
                <ArrowRight size={19} />
              </Link>
              <div>
                <Zap />
                <span>
                  เชื่อมโยง
                  <br />
                  ประสิทธิภาพ
                </span>
              </div>
              <div>
                <Crosshair />
                <span>
                  ประหยัด
                  <br />
                  ต้นทุนได้ดีขึ้น
                </span>
              </div>
              <div>
                <TrendingUp />
                <span>
                  เข้าใจได้ง่ายด้วย
                  <br />
                  Dashboard ที่ใช้
                </span>
              </div>
            </div>
          </div>
          <div className="zh-phone-preview">
            <img
              src="/zetta/ceo-command-center.png"
              alt="ตัวอย่าง Today Overview และ AI Executive Report พร้อม Branch Overview ตามหน้า 3 ของต้นฉบับ"
            />
            <span className="zh-reference-note">
              ตัวอย่างหน้าจอจากต้นฉบับ · เปิดระบบเพื่อดูข้อมูลธุรกิจจริง
            </span>
          </div>
        </section>
        <section id="product" className="zh-section">
          <p className="zh-section-kicker">ZETTA FLOW AI</p>
          <h2>
            เปลี่ยนทุกบทสนทนา
            <br />
            ให้กลายเป็นข้อมูลเชิงธุรกิจที่องค์กรต้องการ
          </h2>
          <p>
            กำหนด Data Template และ Workflow ได้เอง พนักงานทำงานผ่าน LINE
            ตามปกติ AI วิเคราะห์ข้อความ รูปภาพ เอกสาร และไฟล์ จัดเก็บข้อมูล
            ติดตามสถานะ แจ้งเตือนผู้รับผิดชอบ และแสดงผลผ่าน Dashboard
          </p>
          <div className="zh-product-links">
            <Link href="/zetta/templates">
              Dynamic Form Designer
              <ArrowRight size={17} />
            </Link>
            <Link href="/zetta/team">
              Flexible Role Mapping
              <ArrowRight size={17} />
            </Link>
            <Link href="/zetta/integrations">
              Agnostic Integration
              <ArrowRight size={17} />
            </Link>
          </div>
          <img
            src="/zetta/system-overview-reference.png"
            alt="การแจ้งงานผ่าน LINE การจับคู่โครงการอัตโนมัติ และหน้ารายละเอียดตามหน้า 8"
            loading="lazy"
          />
          <Link className="zh-cta" href="/zetta/dashboard">
            Executive Dashboard
            <ArrowRight size={18} />
          </Link>
        </section>
        <section id="solutions" className="zh-section">
          <p className="zh-section-kicker">MULTI-BUSINESS FRAMEWORK</p>
          <h2>Dashboard แยกตามแผนก</h2>
          <p>
            จัดซื้อ / คลังสินค้า · การเงิน · ฝ่ายขาย · การตลาด & อีเวนต์ ·
            ออกแบบร้านค้า · CRM / บริหารลูกค้า
          </p>
          <img
            src="/zetta/department-dashboards-reference.png"
            alt="หน้าจอ Dashboard ทั้ง 6 แผนกและ CEO Dashboard จากหน้า 16"
            loading="lazy"
          />
          <div className="zh-product-links">
            <Link href="/zetta/purchasing">Procurement / Warehouse</Link>
            <Link href="/zetta/finance">Finance</Link>
            <Link href="/zetta/sales">Sales</Link>
            <Link href="/zetta/marketing">Marketing & Event</Link>
            <Link href="/zetta/design">Store Design</Link>
            <Link href="/zetta/crm">CRM</Link>
          </div>
        </section>
        <section id="pricing" className="zh-section">
          <p className="zh-section-kicker">ZETTAFLOW AI SUBSCRIPTION</p>
          <h2>แพ็กเกจรายเดือน / รายปี</h2>
          <div className="zh-plans">
            {[
              {
                name: "Starter",
                monthly: 1190,
                yearly: 11900,
                workflows: "5",
                documents: "1,000",
                groups: "2",
                users: "2",
              },
              {
                name: "Growth",
                monthly: 3490,
                yearly: 34900,
                workflows: "20",
                documents: "4,000",
                groups: "10",
                users: "10",
              },
              {
                name: "Enterprise",
                monthly: 8900,
                yearly: 89000,
                workflows: "Unlimited",
                documents: "Unlimited",
                groups: "Unlimited",
                users: "Unlimited",
              },
            ].map((p) => (
              <article key={p.name}>
                <h3>{p.name}</h3>
                <strong>฿{p.monthly.toLocaleString("th-TH")}</strong>
                <p>ต่อเดือน · ฿{p.yearly.toLocaleString("th-TH")} ต่อปี</p>
                <ul>
                  <li>AI Workflows {p.workflows}</li>
                  <li>เอกสาร/เดือน {p.documents} รายการ</li>
                  <li>กลุ่ม LINE {p.groups} กลุ่ม</li>
                  <li>Dashboard {p.users} User</li>
                </ul>
                <Link href="/zetta/pricing">
                  ดูรายละเอียดแพ็กเกจ
                  <ArrowRight size={15} />
                </Link>
              </article>
            ))}
          </div>
          <p>
            จ่ายรายปี รับส่วนลด 2 เดือน · One-time Setup & Onboarding
            ฿3,000–10,000
          </p>
        </section>
        <section id="contact" className="zh-section zh-contact">
          <h2>พร้อมเปลี่ยนธุรกิจของคุณให้ก้าวล้ำไปอีกขั้น</h2>
          <Link className="zh-cta" href="/zetta/dashboard">
            เริ่มใช้งาน ZettaFlow AI
            <ArrowRight size={17} />
          </Link>
          <div>
            <a href="mailto:Sirisoaa@gmail.com">Sirisoaa@gmail.com</a>
            <a href="tel:0960041231">096-004-1231</a>
            <span>siri_studio</span>
            <span>www.zettaflowai.com</span>
          </div>
        </section>
      </main>
      <footer className="zh-footer">
        Zetta Flow AI — One AI Platform. Unlimited Business Workflows.
        <Link href="/eliteflow">EliteFlow Workspace</Link>
      </footer>
    </div>
  );
}
