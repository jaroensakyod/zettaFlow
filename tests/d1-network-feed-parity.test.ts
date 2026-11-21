// The D1 port of the company feed (src/lib/d1/network-feed.ts) must behave exactly like the Postgres feed_*
// functions: the same calls run against the real schema (PGlite, every migration) and against D1, and every outcome —
// posts, likes, comments, follows, proposals, the directory, profiles, suggestions, alerts, or the exact error — matches.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as feed from "../src/lib/d1/network-feed";
import { labeller, runSteps, sameRows, setup, type D1Fns, type Step } from "./d1-network-harness";

const post = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P1 = post(1),
  P2 = post(2),
  P3 = post(3),
  P4 = post(4),
  P5 = post(5),
  P10 = post(10),
  NOPE = post(99);

const d1: D1Fns = {
  feed_post: feed.feedPost,
  feed_delete: feed.feedDelete,
  feed_comment: feed.feedComment,
  feed_like: feed.feedLike,
  feed_save: feed.feedSave,
  feed_share: feed.feedShare,
  feed_view: feed.feedView,
  feed_follow: feed.feedFollow,
  feed_follow_list: feed.feedFollowList,
  feed_companies: feed.feedCompanies,
  feed_company_profile: feed.feedCompanyProfile,
  feed_suggest: feed.feedSuggest,
  feed_list: feed.feedList,
  feed_propose: feed.feedPropose,
  feed_proposal_status: feed.feedProposalStatus,
  feed_proposals: feed.feedProposals,
  feed_alerts: feed.feedAlerts,
  feed_signed_in: feed.feedSignedIn,
  feed_author: feed.feedAuthor,
};

test("feed_* on D1 match Postgres step for step", async () => {
  const h = await setup();
  try {
    const { A, B, C } = h.company;
    const img = (co: string, id: string, n: number) => `${co}/${id}/${n}.webp`;
    const steps: Step[] = [
      { as: "alice", fn: "feed_signed_in", self: false, admin: true },
      { as: "amy", fn: "feed_author", admin: true },
      { as: "vic", fn: "feed_author", admin: true, note: "no name → email" },
      // Posting: rights, kind, body, notice title, meta, images.
      { as: "vic", fn: "feed_post", args: () => [P1, "post", "hi", {}, []] },
      { as: "alice", fn: "feed_post", args: () => [P1, "story", "hi", {}, []] },
      { as: "alice", fn: "feed_post", args: () => [P1, "post", "   ", {}, []] },
      { as: "alice", fn: "feed_post", args: () => [P1, "post", "x".repeat(5001), {}, []] },
      { as: "alice", fn: "feed_post", args: () => [P2, "job", "hiring", { location: "BKK" }, []] },
      { as: "alice", fn: "feed_post", args: () => [P1, "post", "hi", { note: "ก".repeat(1000) }, []] },
      { as: "alice", fn: "feed_post", args: () => [P10, "post", "x", {}, Array.from({ length: 11 }, (_, i) => img(A, P10, i % 10))] },
      { as: "alice", fn: "feed_post", args: () => [P1, "post", "hi", {}, [img(B, P1, 0)]] },
      { as: "alice", fn: "feed_post", args: () => [P1, "post", "hi", {}, [`${A}/${P1}/0.gif`]] },
      { as: "alice", fn: "feed_post", args: () => [P10, "post", "สิบรูป", {}, Array.from({ length: 10 }, (_, i) => img(A, P10, i))] },
      { as: "alice", fn: "feed_post", save: "P1", args: () => [P1, "post", "  โชว์รูมใหม่  ", {}, [img(A, P1, 0), `${A}/${P1}/1.png`]] },
      { as: "alice", fn: "feed_post", save: "P2", args: () => [P2, "job", "รับช่างติดตั้งบูธ ".repeat(10), { title: "ช่างติดตั้งบูธ", location: "กรุงเทพฯ" }, null] },
      { as: "bob", fn: "feed_post", save: "P3", args: () => [P3, "partner", "หาพาร์ทเนอร์งานพิมพ์", { title: "หาพาร์ทเนอร์" }, []] },
      { as: "bob", fn: "feed_post", args: () => [P4, "post", "จะลบทีหลัง", {}, []] },
      { as: "amy", fn: "feed_post", args: () => [P5, "post", "โพสต์จากพนักงาน", null, []] },
      { as: "alice", fn: "feed_delete", self: false, args: () => [P10] },
      { as: "carol", fn: "feed_list" },
      // Suggestions before anyone follows: same industry, same province, recently active.
      { as: "alice", fn: "feed_suggest" },
      { as: "carol", fn: "feed_suggest" },
      // Likes, comments.
      { as: "bob", fn: "feed_like", self: false, args: () => [P1] },
      { as: "bob", fn: "feed_like", self: false, args: () => [P1] },
      { as: "alice", fn: "feed_like", self: false, args: () => [P1] },
      { as: "carol", fn: "feed_like", self: false, args: () => [P1] },
      { as: "bob", fn: "feed_like", self: false, args: () => [NOPE] },
      { as: "bob", fn: "feed_like", self: false, args: () => [P10], note: "archived" },
      { as: "vic", fn: "feed_comment", args: () => [P1, "x"] },
      { as: "bob", fn: "feed_comment", args: () => [P1, "   "] },
      { as: "bob", fn: "feed_comment", args: () => [NOPE, "x"] },
      { as: "bob", fn: "feed_comment", args: () => [P1, " สนใจครับ "] },
      { as: "carol", fn: "feed_comment", args: () => [P1, "ความเห็น 1"] },
      { as: "carol", fn: "feed_comment", args: () => [P1, "ความเห็น 2"] },
      { as: "alice", fn: "feed_comment", args: () => [P1, "ขอบคุณค่ะ"] },
      { as: "carol", fn: "feed_comment", args: () => [P2, "สนใจงานนี้"] },
      // Follows.
      { as: "bob", fn: "feed_follow", args: () => [A] },
      { as: "bob", fn: "feed_follow", args: () => [B] },
      { as: "bob", fn: "feed_follow", args: () => [post(77)] },
      { as: "vic", fn: "feed_follow", args: () => [B] },
      { as: "carol", fn: "feed_follow", args: () => [A] },
      { as: "carol", fn: "feed_follow", args: () => [B] },
      { as: "carol", fn: "feed_follow", args: () => [B] },
      { as: "carol", fn: "feed_follow", args: () => [B] },
      { as: "alice", fn: "feed_follow", args: () => [C] },
      // The feed with each filter.
      { as: "bob", fn: "feed_list", args: () => ["all"] },
      { as: "bob", fn: "feed_list", args: () => ["following"] },
      { as: "alice", fn: "feed_list", args: () => ["following"] },
      { as: "bob", fn: "feed_list", args: () => ["post"] },
      { as: "bob", fn: "feed_list", args: () => ["job"] },
      { as: "bob", fn: "feed_list", args: () => ["partner"] },
      { as: "bob", fn: "feed_list", args: () => ["mine"] },
      { as: "bob", fn: "feed_list", args: () => ["offers"] },
      { as: "carol", fn: "feed_list", args: () => ["all", null, 2] },
      { as: "carol", fn: "feed_list", args: (r) => ["all", r("P3").created_at, 10] },
      { as: "carol", fn: "feed_list", args: () => ["company:" + A] },
      { as: "carol", fn: "feed_list", args: () => ["company:nope"] },
      { as: "carol", fn: "feed_list", args: () => [null] },
      { as: "alice", fn: "feed_list", args: () => ["anything else", null, 0] },
      // Proposals on job / partner notices.
      { as: "vic", fn: "feed_propose", args: () => [P3, "x", ""] },
      { as: "alice", fn: "feed_propose", args: () => [P2, "x", ""] },
      { as: "bob", fn: "feed_propose", args: () => [P1, "x", ""] },
      { as: "bob", fn: "feed_propose", args: () => [P2, "  ", ""] },
      { as: "bob", fn: "feed_propose", args: () => [P2, "x", "c".repeat(201)] },
      { as: "bob", fn: "feed_propose", save: "R1", args: () => [P2, " ทีมเรามีช่าง 5 คน ", " line: bobco "] },
      { as: "bob", fn: "feed_propose", args: () => [P2, "again", ""] },
      { as: "carol", fn: "feed_propose", save: "R2", args: () => [P2, "ช่างเรามีประสบการณ์", null] },
      { as: "alice", fn: "feed_propose", save: "R3", args: () => [P3, "สนใจร่วมงาน", "021111111"] },
      { as: "bob", fn: "feed_list", args: () => ["offers"] },
      { as: "alice", fn: "feed_list", args: () => ["mine"] },
      { as: "bob", fn: "feed_proposals" },
      { as: "alice", fn: "feed_proposals" },
      { as: "alice", fn: "feed_proposals", args: () => [P2] },
      { as: "bob", fn: "feed_proposal_status", args: (r) => [r("R1").id, "shortlisted"] },
      { as: "amy", fn: "feed_proposal_status", args: (r) => [r("R1").id, "shortlisted"] },
      { as: "alice", fn: "feed_proposal_status", args: (r) => [r("R1").id, "maybe"] },
      { as: "alice", fn: "feed_proposal_status", args: (r) => [r("R1").id, "shortlisted"] },
      { as: "alice", fn: "feed_proposal_status", args: (r) => [r("R2").id, "declined"] },
      { as: "bob", fn: "feed_proposal_status", args: (r) => [r("R3").id, "shortlisted"] },
      { as: "bob", fn: "feed_proposals" },
      // Views, shares, saves.
      { as: "bob", fn: "feed_view", self: false, args: () => [[P1, P2, P1, NOPE, P10]] },
      { as: "bob", fn: "feed_view", self: false, args: () => [[P1]] },
      { as: "carol", fn: "feed_view", self: false, args: () => [[P1, P3]] },
      { as: "bob", fn: "feed_share", self: false, args: () => [P1] },
      { as: "bob", fn: "feed_share", self: false, args: () => [P1] },
      { as: "carol", fn: "feed_share", self: false, args: () => [P1] },
      { as: "carol", fn: "feed_share", self: false, args: () => [NOPE] },
      { as: "bob", fn: "feed_save", self: false, args: () => [P1] },
      { as: "bob", fn: "feed_save", self: false, args: () => [NOPE] },
      { as: "bob", fn: "feed_list", args: () => ["saved"] },
      { as: "bob", fn: "feed_save", self: false, args: () => [P1] },
      { as: "bob", fn: "feed_save", self: false, args: () => [P2] },
      { as: "bob", fn: "feed_list", args: () => ["saved"] },
      // Deleting: the author or the owner of the posting company.
      { as: "carol", fn: "feed_delete", self: false, args: () => [P4] },
      { as: "amy", fn: "feed_delete", self: false, args: () => [P1] },
      { as: "bob", fn: "feed_delete", self: false, args: () => [P4] },
      { as: "bob", fn: "feed_delete", self: false, args: () => [P4] },
      { as: "alice", fn: "feed_delete", self: false, args: () => [P5] },
      { as: "carol", fn: "feed_list" },
      // Follow lists, the directory, profiles, suggestions.
      { as: "alice", fn: "feed_follow_list", args: () => [A, "followers"] },
      { as: "bob", fn: "feed_follow_list", args: () => [C, "following"] },
      { as: "bob", fn: "feed_follow_list", args: () => [A, "both"] },
      { as: "alice", fn: "feed_companies" },
      { as: "alice", fn: "feed_companies", args: () => ["  bob "] },
      { as: "alice", fn: "feed_companies", args: () => ["เชียง"] },
      { as: "carol", fn: "feed_companies", args: () => ["%", 1] },
      { as: "carol", fn: "feed_companies", args: () => ["a_i", 500] },
      { as: "bob", fn: "feed_company_profile", args: () => [A] },
      { as: "alice", fn: "feed_company_profile", args: () => [A] },
      { as: "alice", fn: "feed_company_profile", args: () => [B] },
      { as: "carol", fn: "feed_company_profile", args: () => [C] },
      { as: "carol", fn: "feed_company_profile", args: () => [NOPE] },
      { as: "alice", fn: "feed_suggest" },
      { as: "bob", fn: "feed_suggest" },
      { as: "carol", fn: "feed_suggest" },
      // Alerts: proposals, answers, comments, followers.
      { as: "alice", fn: "feed_alerts" },
      { as: "bob", fn: "feed_alerts" },
      { as: "carol", fn: "feed_alerts" },
    ];
    const norm = labeller(h, { [P1]: "P1", [P2]: "P2", [P3]: "P3", [P4]: "P4", [P5]: "P5", [P10]: "P10", [NOPE]: "NOPE", "30000000-0000-4000-8000-000000000001": "PK1", "30000000-0000-4000-8000-000000000002": "PK2" });
    const n = await runSteps(h, steps, d1, norm);
    await sameRows(h, norm, "company_posts", ["id", "company_id", "author_id", "author_name", "kind", "body", "meta", "images", "archived_at"]);
    await sameRows(h, norm, "post_comments", ["post_id", "company_id", "author_id", "author_name", "body"]);
    await sameRows(h, norm, "post_likes", ["post_id", "user_id"]);
    await sameRows(h, norm, "post_views", ["post_id", "user_id"]);
    await sameRows(h, norm, "post_shares", ["post_id", "user_id"]);
    await sameRows(h, norm, "post_saves", ["post_id", "user_id"]);
    await sameRows(h, norm, "post_proposals", ["post_id", "company_id", "author_id", "author_name", "message", "contact", "status"]);
    await sameRows(h, norm, "company_follows", ["follower_id", "company_id"]);
    assert.ok(n > 100);
  } finally {
    await h.db.close();
  }
});
