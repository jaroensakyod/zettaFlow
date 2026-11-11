import Link from "next/link";
import { IBM_Plex_Sans_Thai, Plus_Jakarta_Sans } from "next/font/google";
import { ArrowRight, Check, Minus, ShieldCheck } from "lucide-react";
import { plans } from "@/lib/billing";
import { PricingCards } from "../zetta/landing-parts";
import { LandingHeader, LandingFooter, SIGNUP } from "../zetta/landing-shell";
import "../zetta/landing.css";

const thai = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--lp-thai" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--lp-display" });

export const metadata = {
  title: "แพ็กเกจและราคา — EliteFlow",
  description: "เปรียบเทียบแพ็กเกจ Starter, Growth, Business และ Enterprise ของ EliteFlow พร้อม Add-on และค่าใช้งานเกินโควตา",
  icons: { icon: "/brand/eliteflow-icon.png", apple: "/brand/eliteflow-mark.png" },
};

const count = (n: number | null, unit = "") => (n === null ? "ไม่จำกัด" : n.toLocaleString("th-TH") + unit);
type Cell = string | boolean;
const each = (f: (p: (typeof plans)[number]) => Cell) => plans.map(f);
const rows: { group: string; items: [string, ...Cell[]][] }[] = [
  {
    group: "โควตาการใช้งาน",
    items: [
      ["กลุ่ม LINE", ...each((p) => count(p.line_groups))],
      ["AI ประมวลผลต่อเดือน", ...each((p) => count(p.documents) + (p.id === "enterprise" ? " (Fair use)" : ""))],
      ["ถอดเสียงต่อเดือน", ...each((p) => count(p.voice_minutes, " นาที"))],
      ["พื้นที่จัดเก็บ", ...each((p) => count(p.storage_gb, " GB"))],
      ["ผู้ใช้", ...each((p) => count(p.users, " คน"))],
      ["AI Workflows", ...each((p) => count(p.workflows))],
    ],
  },
  {
    group: "ระบบงานบริษัท",
    items: [
      ["บัญชี ลูกค้า Supplier ภาษี เอกสาร Dashboard (ฟรีทุกบริษัท)", ...each(() => true)],
      ["ปลดล็อก การตลาด · เซลล์ · จัดซื้อ · คลังสินค้า · HR", ...each(() => true)],
      ["เครือข่ายธุรกิจ ลงอัปเดตและติดตามบริษัท", ...each(() => true)],
      ["น้องโฟลว์: เปิดหน้า สร้างงาน ตอบจากข้อมูลบริษัท", ...each(() => true)],
      ["แชร์ Dashboard ด้วยลิงก์และรหัสผ่าน", ...each(() => true)],
    ],
  },
  {
    group: "AI",
    items: [
      ["AI OCR Plus (ใบกำกับภาษี ใบเสร็จ สัญญา)", ...each((p) => (p.id === "enterprise" ? true : "Add-on"))],
      ["AI Insight: น้องโฟลว์ตอบคำถามอิสระและสรุปเอกสาร", ...each((p) => (p.id === "enterprise" ? true : "Add-on"))],
    ],
  },
  {
    group: "เชื่อมต่อและบริการ",
    items: [
      ["API Integration", ...each((p) => (p.api === "—" ? false : p.api === "Optional" ? "เสริม" : true))],
      ["ฝ่ายดูแลลูกค้า", ...each((p) => p.support)],
    ],
  },
];
const billingFaq = [
  ["ใช้ฟรีได้จริงไหม ต้องใส่บัตรเครดิตไหม?", "ใช้ได้จริงและไม่มีวันหมดอายุ ไม่ต้องใช้บัตรเครดิต แพ็กเกจฟรีได้ LINE 1 กลุ่ม และระบบบัญชีและการเงินครบทุกเมนู อัปเกรดเมื่อต้องการแผนกอื่นหรือใช้งานมากขึ้น"],
  ["ชำระเงินอย่างไร?", "โอนเงินเข้าบัญชีบริษัทแล้วแนบสลิปในหน้าแพ็กเกจของระบบ ระบบตรวจ QR บนสลิปและทีมงานยืนยันการชำระ"],
  ["ใช้เกินโควตาแล้วระบบจะหยุดไหม?", "ไม่หยุด ระบบทำงานต่อและคิดค่าใช้งานส่วนเกินในรอบบิลถัดไปตามอัตราด้านบน"],
  ["เปลี่ยนแพ็กเกจหรือยกเลิกได้ไหม?", "อัปเกรด ลดแพ็กเกจ หรือยกเลิกได้ทุกเมื่อ ข้อมูลของบริษัทยังอยู่ครบ"],
  ["ราคารวม VAT หรือยัง?", "ราคาทั้งหมดยังไม่รวม VAT 7% และมีค่า Setup & Onboarding ครั้งเดียว ฿3,000–10,000 ตามขนาดงาน"],
];

function Value({ v }: { v: Cell }) {
  if (v === true) return <Check size={18} className="pr-yes" aria-label="มี" />;
  if (v === false) return <Minus size={18} className="pr-no" aria-label="ไม่มี" />;
  return <span>{v}</span>;
}

export default function PricingPage() {
  return (
    <div className={`lp ${thai.variable} ${display.variable}`}>
      <LandingHeader home={false} />
      <main>
        <section className="lp-section pr-hero">
          <header className="lp-head">
            <span className="lp-kicker">PRICING</span>
            <h1>แพ็กเกจ EliteFlow</h1>
            <p>ใช้งานฟรีได้เลย LINE 1 กลุ่ม + ระบบบัญชีและการเงิน ไม่ต้องใช้บัตรเครดิต แล้วอัปเกรดเมื่อพร้อม</p>
          </header>
          <PricingCards />
        </section>

        <section className="lp-section" aria-labelledby="compare">
          <header className="lp-head">
            <span className="lp-kicker">COMPARE</span>
            <h2 id="compare">เปรียบเทียบแพ็กเกจ</h2>
          </header>
          <div className="pr-table-wrap">
            <table className="pr-table">
              <thead>
                <tr>
                  <th scope="col">ฟีเจอร์</th>
                  {plans.map((p) => (
                    <th scope="col" key={p.id} className={p.id === "growth" ? "pop" : ""}>
                      {p.name}
                      <small>฿{p.monthly.toLocaleString("th-TH")}/เดือน</small>
                    </th>
                  ))}
                </tr>
              </thead>
              {rows.map((g) => (
                <tbody key={g.group}>
                  <tr className="pr-group">
                    <th scope="colgroup" colSpan={plans.length + 1}>
                      {g.group}
                    </th>
                  </tr>
                  {g.items.map(([label, ...cells]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {cells.map((v, i) => (
                        <td key={i} className={plans[i]?.id === "growth" ? "pop" : ""}>
                          <Value v={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr>
                  <th scope="row" />
                  {plans.map((p) => (
                    <td key={p.id} className={p.id === "growth" ? "pop" : ""}>
                      <Link href={SIGNUP} className={p.id === "growth" ? "lp-btn primary sm" : "lp-btn ghost sm"}>
                        เริ่ม {p.name}
                      </Link>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="lp-security">
            <ShieldCheck size={22} />
            <p>
              <b>ทุกแพ็กเกจปลอดภัยเท่ากัน</b> — แยกข้อมูลรายบริษัท · เข้ารหัส · สิทธิ์ตามบทบาท · Audit Log · สำรองข้อมูลทุกวัน
            </p>
          </div>
        </section>

        <section className="lp-section narrow" aria-labelledby="billing-faq">
          <header className="lp-head">
            <span className="lp-kicker">FAQ</span>
            <h2 id="billing-faq">คำถามเรื่องราคาและการชำระเงิน</h2>
          </header>
          <div className="pr-faq">
            {billingFaq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-cta">
          <h2>เริ่มใช้ EliteFlow วันนี้</h2>
          <p>เริ่มใช้ฟรีวันนี้ LINE 1 กลุ่ม + ระบบบัญชีและการเงิน ไม่มีวันหมดอายุ</p>
          <div className="lp-hero-actions center">
            <Link href={SIGNUP} className="lp-btn primary">
              ใช้งานฟรีได้เลย <ArrowRight size={18} />
            </Link>
            <a href="tel:0960041231" className="lp-btn ghost">
              คุยกับฝ่ายขาย 096-004-1231
            </a>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
