import { test } from "node:test";
import assert from "node:assert/strict";
import { matchScore } from "../src/lib/match";
import type { FeedPost } from "../src/lib/types";

const now = Date.parse("2026-10-19T12:00:00Z");
const post = (over: Partial<FeedPost> = {}): FeedPost => ({
  id: "p",
  company_id: "c",
  author_name: "x",
  kind: "job",
  body: "ต้องการทีมออกแบบและติดตั้งบูธงานแฟร์ 4 วัน",
  meta: { title: "ตกแต่งบูธงานแฟร์", location: "กรุงเทพฯ" },
  images: [],
  created_at: "2026-10-18T12:00:00Z",
  company: { name: "Mega", industry: "อีเวนต์ / ออแกไนซ์", province: "กรุงเทพฯ", has_logo: false },
  likes: 0,
  liked: false,
  comment_count: 0,
  comments: [],
  following: false,
  mine: false,
  can_delete: false,
  proposal_count: 0,
  proposed: false,
  ...over,
});

test("match score: every point has a reason", () => {
  const strong = matchScore(post(), { industry: "อีเวนต์ / ออแกไนซ์", province: "กรุงเทพฯ", description: "" }, now);
  assert.equal(strong.reasons.length, 4);
  assert.ok(strong.score >= 80 && strong.score <= 99);
  assert.match(strong.reasons[2], /บูธ/);

  const weak = matchScore(
    post({ created_at: "2026-08-01T00:00:00Z", company: { name: "B", industry: "การศึกษา", province: "เชียงใหม่", has_logo: false }, meta: { title: "ครูสอนพิเศษ" }, body: "สอนคณิต" }),
    { industry: "อีเวนต์ / ออแกไนซ์", province: "กรุงเทพฯ", description: "" },
    now,
  );
  assert.deepEqual(weak, { score: 5, reasons: [] });

  // Free-text description words count too, capped at three hits.
  const desc = matchScore(post({ company: { name: "B", industry: "", province: "", has_logo: false }, meta: {}, created_at: "2026-10-01T00:00:00Z" }), { industry: "", province: "", description: "รับออกแบบ ติดตั้ง บูธ งานแฟร์" }, now);
  assert.equal(desc.score, 5 + 30 + 5);

  // Same group, different detailed type: partial credit, and the group's hint words apply.
  const sameGroup = matchScore(
    post({ company: { name: "B", industry: "รับจัดงานแต่งงาน", province: "", has_logo: false }, meta: { title: "ทีมจัดบูธ" }, body: "งานแฟร์", created_at: "2026-08-01T00:00:00Z" }),
    { industry: "จัดนิทรรศการ / แสดงสินค้า", province: "", description: "" },
    now,
  );
  assert.match(sameGroup.reasons[0], /หมวดธุรกิจเดียวกัน/);
  assert.equal(sameGroup.score, 5 + 20 + 20);
});
