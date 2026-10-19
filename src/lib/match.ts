// Explainable match score between our company and a job / partner post. Every point comes with a reason
// the user can read, so the number is never a black box.
import type { FeedPost } from "./types";

export type MatchProfile = {
  industry: string;
  province: string;
  description: string;
};
export type Match = { score: number; reasons: string[] };

// Words that hint a post is in the territory of each business type.
const industryWords: Record<string, string[]> = {
  ค้าปลีก: ["หน้าร้าน", "ค้าปลีก", "สาขา", "สินค้า"],
  "ค้าส่ง / จัดจำหน่าย": ["ค้าส่ง", "supplier", "จัดจำหน่าย", "วัสดุ", "สต็อก", "ส่งของ"],
  ผลิต: ["ผลิต", "โรงงาน", "oem", "วัตถุดิบ"],
  บริการ: ["บริการ", "ดูแล", "ติดตั้ง", "ซ่อม"],
  "ร้านอาหาร / คาเฟ่": ["อาหาร", "คาเฟ่", "กาแฟ", "บาริสต้า", "จัดเลี้ยง", "เครื่องดื่ม"],
  "อีเวนต์ / ออแกไนซ์": ["อีเวนต์", "event", "บูธ", "งานแฟร์", "ออแกไนซ์", "จัดงาน", "เปิดตัว", "pop-up"],
  "ก่อสร้าง / ตกแต่ง": ["ก่อสร้าง", "ตกแต่ง", "ออกแบบ", "ไม้อัด", "บูธ", "ติดตั้ง", "รีโนเวท"],
  เทคโนโลยี: ["ระบบ", "เว็บไซต์", "แอป", "it", "ซอฟต์แวร์", "ข้อมูล"],
  การศึกษา: ["อบรม", "สอน", "หลักสูตร", "workshop"],
  "สุขภาพ / ความงาม": ["ความงาม", "สปา", "คลินิก", "สุขภาพ", "เครื่องสำอาง"],
};

const terms = (text: string) =>
  [...new Set(text.toLowerCase().split(/[\s,./()\-–·|:;!?"']+/).filter((w) => w.length >= 3))];

export function matchScore(post: FeedPost, me: MatchProfile, now = Date.now()): Match {
  const reasons: string[] = [];
  let score = 5;
  const text = [post.meta.title || "", post.body, post.meta.location || ""].join(" ").toLowerCase();
  if (me.industry && post.company.industry === me.industry) {
    score += 35;
    reasons.push(`ธุรกิจประเภทเดียวกับคุณ (${me.industry})`);
  }
  if (
    me.province &&
    (post.company.province === me.province || (post.meta.location || "").includes(me.province))
  ) {
    score += 20;
    reasons.push(`อยู่ใน${me.province}เหมือนกัน`);
  }
  const words = [...(industryWords[me.industry] || []), ...terms(me.description)];
  const hits = [...new Set(words.filter((w) => text.includes(w.toLowerCase())))].slice(0, 3);
  if (hits.length) {
    score += hits.length * 10;
    reasons.push(`เกี่ยวกับ ${hits.join(", ")} ที่บริษัทคุณทำ`);
  }
  const days = (now - Date.parse(post.created_at)) / 864e5;
  if (days <= 7) {
    score += 10;
    reasons.push("ประกาศใหม่ภายใน 7 วัน");
  } else if (days <= 30) score += 5;
  return { score: Math.min(99, score), reasons };
}
