// Mockup data for แชท → คุยกับบริษัทอื่น: 5 fictional companies (the sample posts of เครือข่ายธุรกิจ) and realistic
// Thai B2B conversations, each about one post shown as a card. Shown only in the public demo or while a company has
// no real B2B conversation yet, always labelled ตัวอย่าง. Ids start with "sample-" and never reach the API.
// Pictures are small illustrated SVG data URIs, never external images.
// Types only from ../b2b (it imports server code).
import type { B2bCompany, B2bMessage, B2bPostKind, B2bPostRef, B2bThread } from "../b2b";
import { samplePosts, type SamplePost } from "../../components/feed-samples";

export const SAMPLE_THREAD_PREFIX = "sample-b2b-";
export const isSampleThread = (id: string | null | undefined) => !!id && id.startsWith(SAMPLE_THREAD_PREFIX);
export const SAMPLE_NOTE = "ตัวอย่างบทสนทนา — จะหายไปเมื่อเริ่มคุยจริง";
export const SAMPLE_SENT = "ตัวอย่าง — ข้อความไม่ถูกส่งจริง";

/** Ready-made questions under the composer while a post is the topic, by post kind. */
export const quickQuestions: Record<B2bPostKind, string[]> = {
  post: ["สนใจสินค้า/บริการนี้ ขอรายละเอียดเพิ่ม", "ราคาเท่าไหร่", "มีโปรโมชันไหม", "ขอใบเสนอราคา"],
  job: ["ตำแหน่งนี้ยังรับอยู่ไหม", "ขอรายละเอียดงานเพิ่มเติม", "ส่งประวัติ/พอร์ตได้ทางไหน"],
  partner: ["สนใจเป็นพาร์ทเนอร์", "ขอรายละเอียดขอบเขตงาน", "งบประมาณ/ระยะเวลา", "ขอนัดคุย"],
};

export type SampleThread = B2bThread & { sample: true; messages: B2bMessage[] };

/** A rounded square with the company's initials. */
export function sampleLogoUrl(name: string, tint: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${tint}"/>` +
    `<text x="32" y="41" text-anchor="middle" font-family="Sarabun,Tahoma,sans-serif" font-size="24" font-weight="700" fill="#fff">${name.slice(0, 2)}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

/** Illustrated post pictures (one per sample post). */
const scenes: Record<string, (tint: string) => string> = {
  desk: (t) =>
    `<rect width="160" height="100" fill="#f6efe4"/><rect y="70" width="160" height="30" fill="#e6d6bf"/>` +
    `<rect x="30" y="46" width="100" height="8" rx="2" fill="#a0672f"/><rect x="36" y="54" width="6" height="30" fill="#7d4f22"/><rect x="118" y="54" width="6" height="30" fill="#7d4f22"/>` +
    `<rect x="98" y="34" width="22" height="12" rx="2" fill="#3b3a4a"/><path d="M48 46l6-16 6 2-4 14z" fill="${t}"/><circle cx="54" cy="29" r="5" fill="#ffd36b"/>` +
    `<rect x="10" y="12" width="40" height="26" rx="3" fill="#fff" stroke="${t}" stroke-width="2"/><rect x="112" y="10" width="36" height="20" rx="3" fill="${t}" opacity=".25"/>`,
  coffee: (t) =>
    `<rect width="160" height="100" fill="#fbe9ef"/><rect y="74" width="160" height="26" fill="#d9b49a"/>` +
    `<path d="M56 40h44l-5 36H61z" fill="#fff" stroke="#6b3f2a" stroke-width="2"/><path d="M100 48h7a8 8 0 010 16h-9" fill="none" stroke="#6b3f2a" stroke-width="3"/>` +
    `<ellipse cx="78" cy="42" rx="20" ry="4" fill="#6b3f2a"/><path d="M70 30q-4-6 0-12M80 30q-4-6 0-12M90 30q-4-6 0-12" fill="none" stroke="${t}" stroke-width="2.5" stroke-linecap="round"/>` +
    `<circle cx="132" cy="24" r="10" fill="${t}" opacity=".3"/><circle cx="24" cy="30" r="7" fill="${t}" opacity=".2"/>`,
  plywood: (t) =>
    `<rect width="160" height="100" fill="#eaf6ef"/><rect y="78" width="160" height="22" fill="#c9d9cf"/>` +
    `<rect x="34" y="62" width="92" height="12" fill="#d9a865"/><rect x="38" y="50" width="88" height="12" fill="#e7bb7a"/><rect x="30" y="38" width="94" height="12" fill="#d9a865"/><rect x="36" y="26" width="90" height="12" fill="#efc98d"/>` +
    `<path d="M36 32h90M30 44h94M38 56h88M34 68h92" stroke="#b9854a" stroke-width="1"/><rect x="118" y="12" width="30" height="20" rx="3" fill="${t}"/><path d="M124 22h18" stroke="#fff" stroke-width="2"/>`,
  veg: (t) =>
    `<rect width="160" height="100" fill="#e9f1fd"/><path d="M20 76h120l-10 18H30z" fill="#b5835a"/>` +
    `<circle cx="50" cy="62" r="16" fill="#5fae6a"/><circle cx="68" cy="56" r="14" fill="#7cc47f"/><circle cx="88" cy="62" r="15" fill="#4f9d5c"/>` +
    `<path d="M104 72l14-30 6 3-12 28z" fill="#f08a24"/><path d="M118 42l-4-8M121 43l2-9" stroke="#4f9d5c" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="132" cy="22" r="9" fill="#ffd36b"/><rect x="14" y="14" width="34" height="14" rx="7" fill="${t}"/>`,
  truck: (t) =>
    `<rect width="160" height="100" fill="#fbf0e3"/><rect y="78" width="160" height="22" fill="#cfc6bb"/><path d="M0 88h160" stroke="#fff" stroke-width="2" stroke-dasharray="10 8"/>` +
    `<rect x="22" y="36" width="78" height="38" rx="3" fill="${t}"/><path d="M100 46h22l14 14v14h-36z" fill="#3b3a4a"/><path d="M106 50h14l9 10h-23z" fill="#bfe0ff"/>` +
    `<circle cx="44" cy="76" r="8" fill="#26252f"/><circle cx="118" cy="76" r="8" fill="#26252f"/><circle cx="44" cy="76" r="3" fill="#ddd"/><circle cx="118" cy="76" r="3" fill="#ddd"/>` +
    `<text x="61" y="60" text-anchor="middle" font-family="Tahoma,sans-serif" font-size="11" font-weight="700" fill="#fff">EXPRESS</text>`,
};
export function sampleScene(kind: keyof typeof scenes, tint: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">${scenes[kind](tint)}</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// The first three match the companies of the demo feed (lib/feed.ts seedFeed), so "ส่งข้อความ" there finds them.
const plan: { company: string; id: string; scene: keyof typeof scenes; employment?: string }[] = [
  { company: "สยามคราฟต์ เฟอร์นิเจอร์", id: "f0000000-0000-4000-8000-000000000001", scene: "desk" },
  { company: "ลมหนาว คอฟฟี่", id: "f0000000-0000-4000-8000-000000000002", scene: "coffee", employment: "full" },
  { company: "กรีนบิลด์ ดีไซน์", id: "f0000000-0000-4000-8000-000000000003", scene: "plywood" },
  { company: "บ้านสวน ออร์แกนิค", id: "f0000000-0000-4000-8000-000000000004", scene: "veg" },
  { company: "ไทยลอจิส เอ็กซ์เพรส", id: "f0000000-0000-4000-8000-000000000005", scene: "truck" },
];

/** [minutes ago, ours?, author, text, about the post?] */
type Line = [number, boolean, string, string, boolean?];
const conversations: Record<string, { unread: number; lines: Line[] }> = {
  "สยามคราฟต์ เฟอร์นิเจอร์": {
    unread: 2,
    lines: [
      [1560, true, "ฝ่ายจัดซื้อ", "สวัสดีครับ สนใจโต๊ะทำงานไม้สักสำหรับออฟฟิศใหม่ ต้องการประมาณ 10 ตัว ขนาด 140×70 ซม. ราคาเท่าไหร่ครับ และส่งถึงลาดพร้าวได้ไหม", true],
      [1500, false, "ทีมการตลาด", "สวัสดีค่ะ ขอบคุณที่สนใจนะคะ รุ่นไม้สักขนาด 140×70 ซม. ราคาตัวละ 12,900 บาท สั่ง 10 ตัวขึ้นไปลด 12% สำหรับสมาชิก EliteFlow ค่ะ"],
      [1498, false, "ทีมการตลาด", "ส่งฟรีในกรุงเทพฯ รวมลาดพร้าว และติดตั้งให้ภายใน 7 วันหลังยืนยันออเดอร์ค่ะ"],
      [95, true, "ฝ่ายจัดซื้อ", "ดีเลยครับ ขอใบเสนอราคาในนามบริษัทได้ไหมครับ แล้วมีสีให้เลือกกี่แบบ"],
      [18, false, "ทีมการตลาด", "ได้เลยค่ะ มี 3 สี คือ สักธรรมชาติ วอลนัท และโอ๊กขาว เดี๋ยวส่งใบเสนอราคาให้ภายในวันนี้นะคะ"],
      [16, false, "ทีมการตลาด", "ถ้าสะดวก เชิญแวะดูของจริงที่โชว์รูมบางนาได้ทุกวัน 10:00–19:00 น. ค่ะ"],
    ],
  },
  "กรีนบิลด์ ดีไซน์": {
    unread: 1,
    lines: [
      [2900, true, "ฝ่ายขาย", "สนใจเป็นพาร์ทเนอร์ครับ เราเป็นตัวแทนจำหน่ายไม้อัดและวัสดุตกแต่ง ส่งได้ทั่วกรุงเทพฯ ขอทราบจำนวนและสเปกที่ต้องการครับ", true],
      [2820, false, "ฝ่ายจัดซื้อ", "ต้องการไม้อัดยาง 15 มม. ประมาณ 180 แผ่น และ 20 มม. 60 แผ่น แบ่งส่ง 3 สาขา: สีลม อารีย์ และบางนา ภายในวันที่ 5 เดือนหน้าค่ะ"],
      [1380, true, "ฝ่ายขาย", "ไม้อัดยาง 15 มม. แผ่นละ 520 บาท 20 มม. แผ่นละ 690 บาท รวมค่าส่ง 3 จุด ส่งใบเสนอราคาเลขที่ QT-2569-118 ทางอีเมลแล้วครับ"],
      [42, false, "ฝ่ายจัดซื้อ", "ได้รับแล้วค่ะ ขอเครดิต 30 วันได้ไหมคะ ถ้าได้จะยืนยันภายในสัปดาห์นี้"],
    ],
  },
  "ไทยลอจิส เอ็กซ์เพรส": {
    unread: 1,
    lines: [
      [4300, true, "ฝ่ายปฏิบัติการ", "ขอรายละเอียดขอบเขตงานครับ รถ 6 ล้อรับน้ำหนักได้เท่าไหร่ และวิ่งรอบเช้าได้ไหม เรามีของส่งชลบุรี–กรุงเทพฯ สัปดาห์ละ 2 เที่ยว", true],
      [4210, false, "ฝ่ายปฏิบัติการ", "รับได้ 5 ตัน ตู้ทึบ ออกจากชลบุรี 06:00 น. ค่ะ เที่ยวชลบุรี–กรุงเทพฯ 4,500 บาท ถ้าทำสัญญารายเดือนลดเหลือ 4,100 บาทค่ะ"],
      [180, false, "ฝ่ายปฏิบัติการ", "สะดวกนัดคุยทางโทรศัพท์พรุ่งนี้ 10 โมงไหมคะ จะได้สรุปตารางรถให้"],
    ],
  },
  "บ้านสวน ออร์แกนิค": {
    unread: 0,
    lines: [
      [2950, true, "ฝ่ายจัดซื้อ", "สนใจสินค้านี้ ขอรายละเอียดเพิ่มครับ ร้านเรามี 2 สาขา ใช้ผักสลัดรวมวันละประมาณ 8 กก.", true],
      [2900, false, "ฝ่ายขาย", "ผักสลัดรวม กก.ละ 180 บาท ส่งทุกเช้าก่อน 9 โมง ขั้นต่ำ 5 กก. ต่อสาขา สัปดาห์แรกทดลองลด 10% ค่ะ"],
      [2880, true, "ฝ่ายจัดซื้อ", "โอเคครับ เริ่มส่งวันจันทร์หน้าได้เลย เดี๋ยวส่งที่อยู่สาขาให้ทางนี้นะครับ"],
    ],
  },
  "ลมหนาว คอฟฟี่": {
    unread: 0,
    lines: [
      [7300, true, "ฝ่ายบุคคล", "ตำแหน่งนี้ยังรับอยู่ไหมครับ ทางเรามีพนักงานที่ผ่านคอร์สบาริสต้าและอยากย้ายไปประจำเชียงใหม่ 2 คน", true],
      [7200, false, "เจ้าของร้าน", "ยังรับอยู่ค่ะ ส่งประวัติแนบในแชทนี้หรือทางอีเมลร้านได้เลย สัมภาษณ์ได้ทุกวันจันทร์–พุธ ช่วงบ่ายค่ะ"],
      [7150, true, "ฝ่ายบุคคล", "ขอบคุณครับ จะส่งประวัติทั้ง 2 คนให้ภายในพรุ่งนี้ครับ"],
    ],
  },
};

/** The card of a sample post (also used to open a sample conversation from the feed). */
export function sampleCard(p: SamplePost, n: number, now = Date.now()): B2bPostRef {
  const x = plan.find((c) => c.company === p.company)!;
  return {
    id: "sample-post-" + n,
    title: p.title,
    kind: p.kind,
    excerpt: p.body.slice(0, 200),
    meta: { title: p.title, location: p.where, budget: p.budget, employment: x.employment },
    image: sampleScene(x.scene, p.tint),
    created_at: new Date(now - 36e5 * (parseFloat(p.ago) * (p.ago.includes("วัน") ? 24 : 1))).toISOString(),
    company: { id: x.id, name: p.company, has_logo: false, logo_url: sampleLogoUrl(p.company, p.tint) },
  };
}

/** The sample inbox, newest conversation first, with times relative to `now`. */
export function b2bSample(now = Date.now()): SampleThread[] {
  const at = (min: number) => new Date(now - min * 60000).toISOString();
  return plan
    .map((c, i) => {
      const p = samplePosts.find((s) => s.company === c.company)!,
        card = sampleCard(p, i + 1, now),
        talk = conversations[c.company],
        company: B2bCompany = {
          id: c.id,
          name: c.company,
          industry: p.meta.split(" · ")[0],
          province: p.meta.split(" · ")[1] || "",
          has_logo: false,
          logo_url: card.company!.logo_url,
        },
        id = SAMPLE_THREAD_PREFIX + (i + 1),
        messages: B2bMessage[] = talk.lines.map(([min, mine, author, body, about], k) => ({
          id: `${id}-m${k + 1}`,
          company_id: mine ? "sample-own" : c.id,
          company_name: mine ? undefined : c.company,
          author_name: author,
          body,
          created_at: at(min),
          mine,
          post: about ? card : null,
        })),
        last = messages[messages.length - 1];
      return {
        id,
        sample: true as const,
        last_at: last.created_at,
        company,
        post: card,
        last: { body: last.body, mine: last.mine, at: last.created_at },
        unread: talk.unread,
        messages,
      };
    })
    .sort((a, b) => b.last_at.localeCompare(a.last_at));
}

/** A sample conversation for "ส่งข้อความ" on a post in the demo: the company's sample thread, now about that post. */
export function sampleThreadFor(list: SampleThread[], company: B2bCompany, card: B2bPostRef | null): SampleThread {
  const found = list.find((t) => t.company.id === company.id || t.company.name === company.name);
  if (found) {
    // The same post as the sample one (demo feed posts have no pictures): keep the sample picture and logo.
    const same = card && found.post && card.title === found.post.title;
    return { ...found, post: same ? { ...found.post!, ...card, image: card.image || found.post!.image, company: found.post!.company } : card || found.post, unread: 0 };
  }
  return {
    id: SAMPLE_THREAD_PREFIX + "new-" + company.id,
    sample: true,
    last_at: new Date().toISOString(),
    company,
    post: card,
    last: null,
    unread: 0,
    messages: [],
  };
}
