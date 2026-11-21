// The D1 port of the B2B chat (src/lib/d1/network-chat.ts) must behave exactly like the Postgres b2b_* chat
// functions: one conversation per company pair, the post a conversation is about, messages, read marks and unread
// counts, the inbox, the chat alerts in feed_alerts, and every refusal with the exact message.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as chat from "../src/lib/d1/network-chat";
import * as feed from "../src/lib/d1/network-feed";
import { labeller, runSteps, sameRows, setup, type D1Fns, type Step } from "./d1-network-harness";

const post = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P1 = post(1),
  P2 = post(2),
  P3 = post(3),
  NOPE = post(99);

const d1: D1Fns = {
  b2b_open: chat.b2bOpen,
  b2b_send: chat.b2bSend,
  b2b_read: chat.b2bRead,
  b2b_inbox: chat.b2bInbox,
  b2b_unread: chat.b2bUnread,
  b2b_post: chat.b2bPost,
  b2b_post_card: chat.b2bPostCard,
  b2b_thread_of: chat.b2bThreadOf,
  b2b_writer: chat.b2bWriter,
  feed_post: feed.feedPost,
  feed_delete: feed.feedDelete,
  feed_alerts: feed.feedAlerts,
};

test("b2b chat on D1 matches Postgres step for step", async () => {
  const h = await setup();
  try {
    const { A, B, C } = h.company;
    const steps: Step[] = [
      { as: "alice", fn: "feed_post", args: () => [P1, "partner", "ต้องการซัพพลายเออร์ไม้อัด ".repeat(20), { title: "หาซัพพลายเออร์", location: "กรุงเทพฯ" }, [`${A}/${P1}/0.webp`, `${A}/${P1}/1.webp`]] },
      { as: "bob", fn: "feed_post", args: () => [P2, "post", "บูธใหม่ของเรา", {}, []] },
      { as: "alice", fn: "feed_post", args: () => [P3, "job", "งานพิมพ์", { title: "" }, []], note: "job with an empty title" },
      { as: "alice", fn: "feed_post", args: () => [P3, "job", "งานพิมพ์ป้าย", { title: "รับงานพิมพ์" }, []] },
      // Opening: never with oneself or an unknown company; a viewer cannot start a new conversation.
      { as: "alice", fn: "b2b_open", args: () => [A, null] },
      { as: "alice", fn: "b2b_open", args: () => [NOPE, null] },
      { as: "vic", fn: "b2b_open", args: () => [B, null] },
      { as: "bob", fn: "b2b_open", save: "T1", args: () => [A, P1] },
      { as: "bob", fn: "b2b_open", args: () => [A, null] },
      { as: "vic", fn: "b2b_open", args: () => [B, P2], note: "a viewer may reopen and re-point an existing one" },
      { as: "alice", fn: "b2b_open", args: () => [B, NOPE], note: "unknown post is ignored" },
      { as: "alice", fn: "b2b_open", args: () => [B, P1] },
      { as: "carol", fn: "b2b_open", save: "T2", args: () => [A, null] },
      { as: "bob", fn: "b2b_thread_of", admin: true, args: (r) => [r("T1")] },
      { as: "carol", fn: "b2b_thread_of", admin: true, args: (r) => [r("T1")] },
      { as: "vic", fn: "b2b_writer", admin: true },
      { as: "amy", fn: "b2b_writer", admin: true },
      // Sending.
      { as: "vic", fn: "b2b_send", args: (r) => [r("T1"), "x", null] },
      { as: "carol", fn: "b2b_send", args: (r) => [r("T1"), "x", null] },
      { as: "bob", fn: "b2b_send", args: (r) => [r("T1"), "   ", null] },
      { as: "bob", fn: "b2b_send", args: (r) => [r("T1"), "x".repeat(4001), null] },
      { as: "bob", fn: "b2b_send", save: "M1", args: (r) => [r("T1"), " สนใจเป็นซัพพลายเออร์ครับ ", P1] },
      { as: "bob", fn: "b2b_post", args: () => [P1] },
      { as: "bob", fn: "b2b_post", args: () => [NOPE] },
      { as: "bob", fn: "b2b_inbox" },
      { as: "alice", fn: "b2b_unread" },
      { as: "alice", fn: "feed_alerts", note: "first message about a partner post = interest" },
      { as: "alice", fn: "b2b_inbox" },
      { as: "alice", fn: "b2b_read", args: (r) => [r("T1"), null] },
      { as: "alice", fn: "b2b_unread" },
      { as: "amy", fn: "b2b_send", save: "M2", args: (r) => [r("T1"), "ส่งใบเสนอราคามาได้เลยค่ะ", NOPE] },
      { as: "bob", fn: "b2b_unread" },
      { as: "bob", fn: "b2b_inbox" },
      { as: "bob", fn: "b2b_read", args: (r) => [r("T1"), null] },
      { as: "bob", fn: "b2b_send", save: "M3", args: (r) => [r("T1"), "ส่งให้แล้วครับ", P1] },
      { as: "bob", fn: "b2b_send", args: (r) => [r("T1"), "อีกเรื่องครับ", P3] },
      { as: "bob", fn: "feed_alerts" },
      { as: "alice", fn: "feed_alerts" },
      { as: "carol", fn: "b2b_send", args: (r) => [r("T2"), "สวัสดีค่ะ ขอใบเสนอราคางานพิมพ์", P3] },
      { as: "alice", fn: "b2b_inbox" },
      { as: "alice", fn: "b2b_unread" },
      { as: "alice", fn: "feed_alerts" },
      { as: "alice", fn: "b2b_read", args: (r) => [r("T1"), r("M3").created_at], note: "before a message" },
      { as: "carol", fn: "b2b_read", args: (r) => [r("T1"), null] },
      // A post that is gone: the chat still shows its card, the inbox and b2b_post do not.
      { as: "alice", fn: "feed_delete", self: false, args: () => [P1] },
      { as: "bob", fn: "b2b_post", args: () => [P1] },
      { as: "bob", fn: "b2b_post_card", self: false, admin: true, args: () => [P1, true] },
      { as: "bob", fn: "b2b_post_card", self: false, admin: true, args: () => [P1, false] },
      { as: "bob", fn: "b2b_inbox" },
      { as: "bob", fn: "b2b_read", args: (r) => [r("T1"), null] },
      { as: "bob", fn: "b2b_open", args: () => [A, P1], note: "archived post is not attached" },
      { as: "carol", fn: "b2b_inbox" },
      { as: "carol", fn: "b2b_unread" },
    ];
    const norm = labeller(h, { [P1]: "P1", [P2]: "P2", [P3]: "P3", [NOPE]: "NOPE" });
    const n = await runSteps(h, steps, d1, norm);
    await sameRows(h, norm, "b2b_threads", ["id", "company_a", "company_b", "post_id"]);
    await sameRows(h, norm, "b2b_messages", ["id", "thread_id", "company_id", "author_id", "author_name", "body", "post_id", "card_id"]);
    await sameRows(h, norm, "b2b_reads", ["thread_id", "company_id"]);
    assert.ok(n > 40);
    void C;
  } finally {
    await h.db.close();
  }
});
