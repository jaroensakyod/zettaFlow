"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";

const plans = [
  { name: "Starter", for: "ร้านค้า / ธุรกิจขนาดเล็ก", monthly: 1190, yearly: 11900, rows: ["5 AI Workflows", "1,000 เอกสาร/เดือน", "2 กลุ่ม LINE", "2 ผู้ใช้ Dashboard", "Email support"] },
  { name: "Growth", for: "ธุรกิจหลายแผนก", monthly: 3490, yearly: 34900, popular: true, rows: ["20 AI Workflows", "4,000 เอกสาร/เดือน", "10 กลุ่ม LINE", "10 ผู้ใช้ Dashboard", "API Integration (เสริม)", "Priority support"] },
  { name: "Enterprise", for: "องค์กร / หลายบริษัท", monthly: 8900, yearly: 89000, rows: ["Workflows ไม่จำกัด", "เอกสารไม่จำกัด", "กลุ่ม LINE ไม่จำกัด", "ผู้ใช้ไม่จำกัด", "API Integration", "Dedicated support"] },
];

export function PricingCards() {
  const [yearly, setYearly] = useState(false);
  return (
    <>
      <div className="lp-toggle" role="group" aria-label="รอบการชำระ">
        <button className={!yearly ? "on" : ""} onClick={() => setYearly(false)}>
          รายเดือน
        </button>
        <button className={yearly ? "on" : ""} onClick={() => setYearly(true)}>
          รายปี <em>ฟรี 2 เดือน</em>
        </button>
      </div>
      <div className="lp-plans">
        {plans.map((p) => (
          <article key={p.name} className={p.popular ? "popular" : ""}>
            {p.popular && <span className="lp-badge">ยอดนิยม</span>}
            <h3>{p.name}</h3>
            <p className="lp-muted">{p.for}</p>
            <div className="lp-price">
              <strong>฿{(yearly ? p.yearly : p.monthly).toLocaleString("th-TH")}</strong>
              <span>/{yearly ? "ปี" : "เดือน"}</span>
            </div>
            <ul>
              {p.rows.map((r) => (
                <li key={r}>
                  <Check size={16} /> {r}
                </li>
              ))}
            </ul>
            <Link href="/zetta/dashboard" className={p.popular ? "lp-btn primary" : "lp-btn ghost"}>
              ทดลองฟรี 14 วัน <ArrowRight size={16} />
            </Link>
          </article>
        ))}
      </div>
      <p className="lp-fine">ราคายังไม่รวม VAT 7% · ไม่ต้องใช้บัตรเครดิต · ยกเลิกได้ทุกเมื่อ · Setup &amp; Onboarding ครั้งเดียว ฿3,000–10,000</p>
    </>
  );
}

const faqs = [
  ["พนักงานต้องเปลี่ยนวิธีใช้ LINE ไหม?", "ไม่ต้องเลย LINE ของพนักงานเหมือนเดิม 100% แค่เพิ่มบอท ZettaFlow AI เข้าไปในกลุ่ม แล้วส่งข้อความ รูป หรือไฟล์ตามปกติ"],
  ["ถ้าข้อมูลที่ส่งมาไม่ครบ จะเกิดอะไรขึ้น?", "AI ตรวจกับฟอร์มที่คุณกำหนด ถ้าขาดช่องไหนบอทจะทวงถามในกลุ่มทันที และเตือนซ้ำอัตโนมัติจนกว่าจะครบ"],
  ["ผู้จัดการอนุมัติงานยังไง?", "พิมพ์คีย์เวิร์ดที่ตั้งไว้ในแชท เช่น “อนุมัติปล่อยของ” ระบบจะอนุมัติและแตกงานต่อให้ทุกทีมที่เกี่ยวข้องทันที"],
  ["แชร์ Dashboard ให้คนนอกได้ไหม?", "ได้ สร้างลิงก์ที่ตั้งรหัสผ่านและวันหมดอายุได้ และเลือกได้ว่าจะให้เห็นกราฟไหนบ้าง"],
  ["ข้อมูลปลอดภัยแค่ไหน?", "แต่ละบริษัทแยกข้อมูลกันด้วย Row-Level Security เข้ารหัสระหว่างส่งและจัดเก็บ มีสิทธิ์ตามบทบาท และบันทึก Audit Log ทุกการกระทำ"],
];
export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="lp-faq">
      {faqs.map(([q, a], i) => (
        <div key={q} className={open === i ? "open" : ""}>
          <button aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
            {q}
            <ChevronDown size={18} />
          </button>
          <p>{a}</p>
        </div>
      ))}
    </div>
  );
}
