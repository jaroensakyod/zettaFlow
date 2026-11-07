import { test } from "node:test";
import assert from "node:assert/strict";
import { b2bSample, isSampleThread, quickQuestions, sampleThreadFor, SAMPLE_THREAD_PREFIX } from "../src/lib/mock/b2b";
import { samplePosts } from "../src/components/feed-samples";

const NOW = Date.parse("2026-11-07T05:00:00Z");

test("B2B mockup: 5 sample companies from the feed samples, newest conversation first", () => {
  const list = b2bSample(NOW);
  assert.equal(list.length, 5);
  assert.deepEqual(
    [...list.map((t) => t.company.name)].sort(),
    ["กรีนบิลด์ ดีไซน์", "ไทยลอจิส เอ็กซ์เพรส", "บ้านสวน ออร์แกนิค", "ลมหนาว คอฟฟี่", "สยามคราฟต์ เฟอร์นิเจอร์"].sort(),
  );
  assert.equal(list[0].company.name, "สยามคราฟต์ เฟอร์นิเจอร์");
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].last_at >= list[i].last_at);
  assert.ok(list.every((t) => t.sample && isSampleThread(t.id) && t.id.startsWith(SAMPLE_THREAD_PREFIX)));
  assert.equal(new Set(list.map((t) => t.id)).size, 5);
  assert.equal(list.reduce((n, t) => n + t.unread, 0), 4);
  assert.ok(list.every((t) => t.company.logo_url?.startsWith("data:image/svg+xml,")));
});

test("B2B mockup: every conversation is about a feed sample post, shown as a full card", () => {
  for (const t of b2bSample(NOW)) {
    const card = t.post!,
      src = samplePosts.find((p) => p.company === t.company.name)!;
    assert.ok(card, t.company.name);
    assert.equal(card.title, src.title);
    assert.equal(card.kind, src.kind);
    assert.equal(card.excerpt, src.body.slice(0, 200));
    assert.ok(card.image?.startsWith("data:image/svg+xml,"));
    assert.equal(card.company?.id, t.company.id);
    assert.equal(card.company?.name, t.company.name);
    assert.ok(card.id.startsWith("sample-post-"));
    if (src.where) assert.equal(card.meta?.location, src.where);
    // The first message asks about the post (attaches the card); the rest is plain conversation.
    assert.equal(t.messages[0].post?.id, card.id);
    assert.equal(t.messages[0].mine, true);
    assert.ok(t.messages.slice(1).every((m) => !m.post));
  }
});

test("B2B mockup: last message, times and unread are consistent", () => {
  for (const t of b2bSample(NOW)) {
    const last = t.messages[t.messages.length - 1];
    assert.deepEqual(t.last, { body: last.body, mine: last.mine, at: last.created_at });
    assert.equal(t.last_at, last.created_at);
    for (let i = 1; i < t.messages.length; i++) assert.ok(t.messages[i - 1].created_at < t.messages[i].created_at);
    assert.ok(t.messages.every((m) => Date.parse(m.created_at) < NOW && m.body.length > 10 && m.author_name));
    // Unread never exceeds the trailing messages from the other company.
    let theirs = 0;
    for (let i = t.messages.length - 1; i >= 0 && !t.messages[i].mine; i--) theirs++;
    assert.ok(t.unread <= theirs, t.company.name);
    assert.ok(t.messages.every((m) => (m.mine ? !m.company_name : m.company_name === t.company.name)));
  }
});

test("B2B mockup: quick questions per post kind", () => {
  assert.deepEqual(quickQuestions.post, ["สนใจสินค้า/บริการนี้ ขอรายละเอียดเพิ่ม", "ราคาเท่าไหร่", "มีโปรโมชันไหม", "ขอใบเสนอราคา"]);
  assert.deepEqual(quickQuestions.job, ["ตำแหน่งนี้ยังรับอยู่ไหม", "ขอรายละเอียดงานเพิ่มเติม", "ส่งประวัติ/พอร์ตได้ทางไหน"]);
  assert.deepEqual(quickQuestions.partner, ["สนใจเป็นพาร์ทเนอร์", "ขอรายละเอียดขอบเขตงาน", "งบประมาณ/ระยะเวลา", "ขอนัดคุย"]);
  for (const t of b2bSample(NOW)) assert.ok(quickQuestions[t.post!.kind].length >= 3);
});

test("B2B mockup: ส่งข้อความ in the demo opens the company's sample conversation about that post", () => {
  const list = b2bSample(NOW),
    craft = list.find((t) => t.company.name === "สยามคราฟต์ เฟอร์นิเจอร์")!;
  const booth = { id: "p-booth", title: "ตกแต่งบูธงานแฟร์ 4 วัน", kind: "partner" as const };
  const opened = sampleThreadFor(list, { ...craft.company, logo_url: undefined }, booth);
  assert.equal(opened.id, craft.id);
  assert.equal(opened.post, booth);
  assert.equal(opened.unread, 0);
  assert.equal(opened.messages.length, craft.messages.length);
  assert.equal(sampleThreadFor(list, craft.company, null).post, craft.post);
  // A company without a sample conversation gets an empty one, still a sample.
  const other = sampleThreadFor(list, { id: "x1", name: "บริษัทใหม่", industry: "", province: "", has_logo: false }, booth);
  assert.ok(isSampleThread(other.id) && other.messages.length === 0 && other.post === booth && other.last === null);
});
