// หน้าแรก › PRODUCT: what the platform can do, and proof it fits any business — each card a kind of business, the
// records it keeps in EliteFlow, and a real line someone would type in its LINE group.
import { FeatureSpotlight } from "./feature-spotlight";


// photo: public/biz/<name>.webp (a scene of that business on the right of the card); none = a gradient in its colours.
const businesses = [
  { emoji: "🏢", name: "อสังหาริมทรัพย์", tone: "c1", photo: "realestate", keeps: ["ลูกค้าเข้าชมโครงการ", "จองยูนิต · มัดจำ", "ค่าคอมเซลล์"], line: "@EliteFlow ลูกค้าคุณเอ จองห้อง A-1203 มัดจำ 50,000" },
  { emoji: "💉", name: "คลินิกความงาม", tone: "c2", photo: "beauty", keeps: ["นัดหมายคนไข้", "คอร์สคงเหลือ", "สต็อกยา · ฟิลเลอร์"], line: "@EliteFlow นัดคุณมายด์ โบท็อกซ์ พรุ่งนี้ 14:00" },
  { emoji: "🏥", name: "โรงพยาบาล / คลินิก", tone: "c3", photo: "", keeps: ["เวรแพทย์ · พยาบาล", "เบิกเวชภัณฑ์", "แจ้งซ่อมเครื่องมือ"], line: "@EliteFlow เบิกถุงมือ M 20 กล่อง ไปวอร์ด 5" },
  { emoji: "🎤", name: "คอนเสิร์ต & เฟสติวัล", tone: "c5", photo: "concert", keeps: ["ขายบัตร · โซนที่นั่ง", "สปอนเซอร์", "ศิลปิน · ทีมงาน"], line: "@EliteFlow บัตรโซน VIP ขายแล้ว 320 ใบ" },
  { emoji: "👜", name: "แบรนด์ & ค้าปลีก", tone: "c6", photo: "retail", keeps: ["ยอดขายทุกสาขา", "สต็อก · โอนย้าย", "แคมเปญการตลาด"], line: "@EliteFlow ยอดสาขาสยามวันนี้ 86,400" },
  { emoji: "📦", name: "ขายออนไลน์ & ไลฟ์สด", tone: "c16", photo: "online", keeps: ["ออเดอร์จากไลฟ์", "แพ็ก · ส่งของ", "ค่าโฆษณา · แอดมิน"], line: "@EliteFlow ไลฟ์คืนนี้ปิดได้ 152 ออเดอร์ 68,900" },
  { emoji: "☕", name: "ร้านอาหาร & คาเฟ่", tone: "c7", photo: "restaurant", keeps: ["ยอดขายรายวัน", "วัตถุดิบเข้า-ออก", "กะพนักงาน"], line: "@EliteFlow ซื้อนมสด 24 ลิตร 1,080 บาท" },
  { emoji: "🍗", name: "ร้านค้า & แผงลอย", tone: "c15", photo: "smallshop", keeps: ["ยอดขายรายวัน", "รับโอนพร้อมเพย์", "ซื้อของเข้าร้าน"], line: "@EliteFlow ขายวันนี้ 3,250 รับโอน 1,800" },
  { emoji: "🏨", name: "โรงแรม & รีสอร์ต", tone: "c8", photo: "hotel", keeps: ["ห้องพัก · แม่บ้าน", "แจ้งซ่อม", "ค่าใช้จ่ายแผนก"], line: "@EliteFlow ห้อง 512 แอร์ไม่เย็น ส่งช่างด่วน" },
  { emoji: "🏗️", name: "ก่อสร้าง & รับเหมา", tone: "c9", photo: "construction", keeps: ["ความคืบหน้าไซต์", "วัสดุ · ค่าแรง", "เบิกงวดงาน"], line: "@EliteFlow ไซต์บางนา เทพื้นชั้น 3 เสร็จแล้ว" },
  { emoji: "🎓", name: "โรงเรียน & สถาบัน", tone: "c10", photo: "school", keeps: ["ผู้สมัครเรียน", "ค่าเทอม · ใบเสร็จ", "ตารางสอน"], line: "@EliteFlow น้องภูมิ ชำระค่าคอร์ส 9,900 โอนแล้ว" },
  { emoji: "🚚", name: "ขนส่ง & โลจิสติกส์", tone: "c11", photo: "logistics", keeps: ["ใบงานรถ · คนขับ", "ค่าน้ำมัน · ทางด่วน", "ส่งของสำเร็จ"], line: "@EliteFlow ส่งของร้านมะลิเรียบร้อย ค่าทางด่วน 120" },
  { emoji: "🏭", name: "โรงงาน & การผลิต", tone: "c12", photo: "factory", keeps: ["ใบสั่งผลิต", "วัตถุดิบ · สต็อก", "QC · ของเสีย"], line: "@EliteFlow ผลิตล็อต 24 ได้ 1,200 ชิ้น เสีย 8" },
  { emoji: "🚗", name: "ศูนย์รถยนต์ & โชว์รูม", tone: "c13", photo: "carshowroom", keeps: ["ลูกค้าทดลองขับ", "จองรถ · ไฟแนนซ์", "ค่าคอมเซลล์"], line: "@EliteFlow คุณบี จองรถสีขาว มัดจำ 20,000" },
  { emoji: "🛠️", name: "งานบริการ & ซ่อมบำรุง", tone: "c14", photo: "service", keeps: ["ใบงานช่าง", "นัดลูกค้า", "อะไหล่ · ค่าบริการ"], line: "@EliteFlow ล้างแอร์บ้านคุณนิด 2 เครื่อง 1,200 เสร็จแล้ว" },
  { emoji: "🎪", name: "อีเวนต์ & ออแกไนซ์", tone: "c4", photo: "", keeps: ["งบแต่ละงาน", "บูธ · สถานที่", "ทีมหน้างาน"], line: "@EliteFlow ค่าตกแต่งบูธ Central World 12,500" },
];
const marquee = ["สปา", "ฟิตเนส", "ร้านทอง", "สัตวแพทย์", "เอเจนซี่", "ร้านซ่อมรถ", "ทันตกรรม", "ฟาร์ม", "ร้านดอกไม้", "สตูดิโอถ่ายภาพ", "ร้านยา", "ประกันภัย", "ท่องเที่ยว", "ค้าส่ง", "แฟรนไชส์"];

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
          <article key={b.name} className={"bs-card " + b.tone + (b.photo ? " has-photo" : "")} style={{ animationDelay: (i % 4) * 70 + "ms" }}>
            {b.photo ? (
              <div className="bs-photo" aria-hidden="true">
                <img src={"/biz/" + b.photo + ".webp"} alt="" loading="lazy" decoding="async" />
              </div>
            ) : (
              <div className="bs-photo bs-photo-none" aria-hidden="true">
                <span>{b.emoji}</span>
              </div>
            )}
            <div className="bs-body">
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
