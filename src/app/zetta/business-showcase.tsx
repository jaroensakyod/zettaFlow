// หน้าแรก › PRODUCT: what the platform can do, and proof it fits any business — each card a kind of business, the
// records it keeps in EliteFlow, and a real line someone would type in its LINE group.
import { FeatureSpotlight } from "./feature-spotlight";


const businesses = [
  { emoji: "🏢", name: "อสังหาริมทรัพย์", tone: "c1", keeps: ["ลูกค้าเข้าชมโครงการ", "จองยูนิต · มัดจำ", "ค่าคอมเซลล์"], line: "@EliteFlow ลูกค้าคุณเอ จองห้อง A-1203 มัดจำ 50,000" },
  { emoji: "💉", name: "คลินิกความงาม", tone: "c2", keeps: ["นัดหมายคนไข้", "คอร์สคงเหลือ", "สต็อกยา · ฟิลเลอร์"], line: "@EliteFlow นัดคุณมายด์ โบท็อกซ์ พรุ่งนี้ 14:00" },
  { emoji: "🏥", name: "โรงพยาบาล / คลินิก", tone: "c3", keeps: ["เวรแพทย์ · พยาบาล", "เบิกเวชภัณฑ์", "แจ้งซ่อมเครื่องมือ"], line: "@EliteFlow เบิกถุงมือ M 20 กล่อง ไปวอร์ด 5" },
  { emoji: "🎪", name: "อีเวนต์ & ออแกไนซ์", tone: "c4", keeps: ["งบแต่ละงาน", "บูธ · สถานที่", "ทีมหน้างาน"], line: "@EliteFlow ค่าตกแต่งบูธ Central World 12,500" },
  { emoji: "🎤", name: "คอนเสิร์ต & เฟสติวัล", tone: "c5", keeps: ["ขายบัตร · โซนที่นั่ง", "สปอนเซอร์", "ศิลปิน · ทีมงาน"], line: "@EliteFlow บัตรโซน VIP ขายแล้ว 320 ใบ" },
  { emoji: "👜", name: "แบรนด์ & ค้าปลีก", tone: "c6", keeps: ["ยอดขายทุกสาขา", "สต็อก · โอนย้าย", "แคมเปญการตลาด"], line: "@EliteFlow ยอดสาขาสยามวันนี้ 86,400" },
  { emoji: "☕", name: "ร้านอาหาร & คาเฟ่", tone: "c7", keeps: ["ยอดขายรายวัน", "วัตถุดิบเข้า-ออก", "กะพนักงาน"], line: "@EliteFlow ซื้อนมสด 24 ลิตร 1,080 บาท" },
  { emoji: "🏨", name: "โรงแรม & รีสอร์ต", tone: "c8", keeps: ["ห้องพัก · แม่บ้าน", "แจ้งซ่อม", "ค่าใช้จ่ายแผนก"], line: "@EliteFlow ห้อง 512 แอร์ไม่เย็น ส่งช่างด่วน" },
  { emoji: "🏗️", name: "ก่อสร้าง & รับเหมา", tone: "c9", keeps: ["ความคืบหน้าไซต์", "วัสดุ · ค่าแรง", "เบิกงวดงาน"], line: "@EliteFlow ไซต์บางนา เทพื้นชั้น 3 เสร็จแล้ว" },
  { emoji: "🎓", name: "โรงเรียน & สถาบัน", tone: "c10", keeps: ["ผู้สมัครเรียน", "ค่าเทอม · ใบเสร็จ", "ตารางสอน"], line: "@EliteFlow น้องภูมิ ชำระค่าคอร์ส 9,900 โอนแล้ว" },
  { emoji: "🚚", name: "ขนส่ง & โลจิสติกส์", tone: "c11", keeps: ["ใบงานรถ · คนขับ", "ค่าน้ำมัน · ทางด่วน", "ส่งของสำเร็จ"], line: "@EliteFlow ส่งของร้านมะลิเรียบร้อย ค่าทางด่วน 120" },
  { emoji: "🏭", name: "โรงงาน & การผลิต", tone: "c12", keeps: ["ใบสั่งผลิต", "วัตถุดิบ · สต็อก", "QC · ของเสีย"], line: "@EliteFlow ผลิตล็อต 24 ได้ 1,200 ชิ้น เสีย 8" },
];
const marquee = ["สปา", "ฟิตเนส", "ร้านทอง", "สัตวแพทย์", "เอเจนซี่", "ร้านซ่อมรถ", "ทันตกรรม", "ฟาร์ม", "ร้านดอกไม้", "สตูดิโอถ่ายภาพ", "ร้านยา", "ประกันภัย", "ท่องเที่ยว", "ห้างร้านออนไลน์", "ค้าส่ง", "แฟรนไชส์"];

export function BusinessShowcase() {
  return (
    <>
      <FeatureSpotlight />

      <header className="lp-head bs-head">
        <span className="lp-kicker">ใช้ได้กับทุกธุรกิจ</span>
        <h2>
          ธุรกิจไหนก็ใช้ได้ <span>เพราะ AI ปรับระบบตามงานของคุณ</span>
        </h2>
        <p>ตัวอย่างระบบที่ลูกค้าใช้อยู่ — แต่ละธุรกิจเก็บข้อมูลต่างกัน แต่สั่งงานผ่าน LINE ได้เหมือนกันหมด</p>
      </header>
      <div className="bs-grid">
        {businesses.map((b, i) => (
          <article key={b.name} className={"bs-card " + b.tone} style={{ animationDelay: i * 60 + "ms" }}>
            <div className="bs-top">
              <span className="bs-emoji">{b.emoji}</span>
              <b>{b.name}</b>
            </div>
            <ul>
              {b.keeps.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            <div className="bs-line">
              <span className="bs-line-tag">LINE</span>
              <p>
                <span className="bs-at">@EliteFlow</span>
                {b.line.replace("@EliteFlow", "")}
              </p>
            </div>
          </article>
        ))}
      </div>
      <div className="bs-marquee" aria-label="ธุรกิจอื่นๆ ที่ใช้ได้">
        <div className="bs-track">
          {[...marquee, ...marquee].map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      </div>
    </>
  );
}
