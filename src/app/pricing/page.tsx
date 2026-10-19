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
  description: "เปรียบเทียบแพ็กเกจ Starter, Growth และ Enterprise ของ EliteFlow พร้อม Add-on และค่าใช้งานเกินโควตา",
  icons: { icon: "/brand/eliteflow-icon.png", apple: "/brand/eliteflow-mark.png" },
};

const count = (n: number | null) => (n === null ? "ไม่จำกัด" : n.toLocaleString("th-TH"));
type Cell = string | boolean;
const rows: { group: string; items: [string, Cell, Cell, Cell][] }[] = [
  {
    group: "โควตาการใช้งาน",
    items: [
      ["AI Workflows", count(plans[0].workflows), count(plans[1].workflows), count(plans[2].workflows)],
      ["เอกสารต่อเดือน", count(plans[0].documents), count(plans[1].documents), count(plans[2].documents) + " (Fair use)"],
      ["กลุ่ม LINE", count(plans[0].line_groups), count(plans[1].line_groups), count(plans[2].line_groups)],
      ["ผู้ใช้ Dashboard", count(plans[0].users), count(plans[1].users), count(plans[2].users)],
    ],
  },
  {
    group: "ระบบงานบริษัท",
    items: [
      ["ลูกค้า สต็อก งาน โครงการ การเงิน และทุกแผนก", true, true, true],
      ["เครือข่ายธุรกิจ ลงอัปเดตและติดตามบริษัท", true, true, true],
      ["หางาน & จับคู่งาน พร้อมส่งข้อเสนอ", true, true, true],
      ["น้องโฟลว์: เปิดหน้า สร้างงาน ตอบจากข้อมูลบริษัท", true, true, true],
      ["แชร์ Dashboard ด้วยลิงก์และรหัสผ่าน", true, true, true],
    ],
  },
  {
    group: "AI",
    items: [
      ["AI OCR Plus (ใบกำกับภาษี ใบเสร็จ สัญญา)", "Add-on", "Add-on", true],
      ["AI Insight: น้องโฟลว์ตอบคำถามอิสระและสรุปเอกสาร", "Add-on", "Add-on", true],
    ],
  },
  {
    group: "เชื่อมต่อและบริการ",
    items: [
      ["API Integration", false, "เสริม", true],
      ["ฝ่ายดูแลลูกค้า", "Email", "Priority", "Dedicated"],
    ],
  },
];
const billingFaq = [
  ["ทดลองใช้ฟรีต้องใส่บัตรเครดิตไหม?", "ไม่ต้อง สมัครแล้วใช้ได้ทันที 14 วัน และเปิด Add-on ด้าน AI ให้ลองครบทุกตัว"],
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
            <p>เริ่มฟรี 14 วัน ไม่ต้องใช้บัตรเครดิต เลือกแพ็กเกจที่เหมาะกับขนาดธุรกิจ แล้วอัปเกรดเมื่อพร้อม</p>
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
                    <th scope="colgroup" colSpan={4}>
                      {g.group}
                    </th>
                  </tr>
                  {g.items.map(([label, a, b, c]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      <td><Value v={a} /></td>
                      <td className="pop"><Value v={b} /></td>
                      <td><Value v={c} /></td>
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
          <p>ทดลองฟรี 14 วัน ทีมงานช่วยตั้งค่าและออกแบบ Workflow ให้ในช่วงทดลอง</p>
          <div className="lp-hero-actions center">
            <Link href={SIGNUP} className="lp-btn primary">
              เริ่มทดลองฟรี <ArrowRight size={18} />
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
