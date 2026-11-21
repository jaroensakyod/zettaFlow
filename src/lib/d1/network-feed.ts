// The company feed (เครือข่าย) for D1, step for step after the Postgres feed_* functions: posts, likes, comments,
// views, shares, saves, follows, job/partner proposals, the company directory and profile, suggestions and alerts.
// Posts and companies are shared across tenants, so reads and writes are global; each function checks what the
// Postgres one checked (member of the asking company, not a viewer, author or owner, ...).
import type { Tenant } from "./tenant";
import { companiesById, hasLogo, postTitle, type Company, type Message, type Post, type Thread } from "./network-chat";
import { bkkDDMM, fail, feedAuthor, ilike, jsonbText, jsonbType, jtext, left, len, memberRole, minusDays, myRole, stamp, textOrder, trim, uuid, type Data } from "./network-common";

export { feedAuthor };
type Proposal = { id: string; post_id: string; company_id: string; author_id: string; author_name: string; message: string; contact: string; status: string; created_at: string; updated_at: string };
type Comment = { id: string; post_id: string; company_id: string; author_id: string; author_name: string; body: string; created_at: string };
type Follow = { follower_id: string; company_id: string; created_at: string };
const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
const prof = (c: Company, k: string) => jtext(c.profile?.[k]) ?? "";

/** feed_signed_in(): a signed-in person with at least one active membership. */
export async function feedSignedIn(t: Tenant): Promise<boolean> {
  return !!t.viewer.userId && (await t.selectGlobal("memberships", { where: { user_id: t.viewer.userId, disabled: false }, limit: 1 })).length > 0;
}
const livePost = async (t: Tenant, id: string) => (await t.selectGlobal<Post>("company_posts", { where: { id, archived_at: null } }))[0];
const member = async (t: Tenant) => {
  if ((await myRole(t)) === null) fail("ไม่มีสิทธิ์", 403);
};

/** feed_post(c, id, kind, body, meta, images): a post, job or partner notice in the company's name. */
export async function feedPost(t: Tenant, id: string, kind: string, body: string | null, meta: unknown, images: string[] | null): Promise<Post> {
  const c = t.viewer.companyId,
    role = await myRole(t);
  if (role === null || role === "viewer") fail("ไม่มีสิทธิ์โพสต์ในนามบริษัทนี้", 403);
  if (!["post", "job", "partner"].includes(kind)) fail("ประเภทโพสต์ไม่ถูกต้อง");
  const text = trim(body ?? "");
  if (len(text) < 1 || len(text) > 5000) fail("เขียนข้อความโพสต์ 1–5000 ตัวอักษร");
  const m = meta ?? {};
  const title = jsonbType(m) === "object" ? jtext((m as Data).title) : null;
  if (kind !== "post" && (len(trim(title ?? "")) < 1 || len(trim(title ?? "")) > 120)) fail("ใส่หัวข้อประกาศ");
  if (jsonbType(m) !== "object" || len(jsonbText(m)) > 1000) fail("ข้อมูลประกาศไม่ถูกต้อง");
  const imgs = images ?? [];
  if (imgs.length > 10) fail("แนบรูปได้สูงสุด 10 รูป");
  const re = new RegExp("^" + c + "/" + id + "/[0-9]\\.(webp|png|jpg)$");
  for (const i of imgs) if (!re.test(i)) fail("รูปภาพไม่ถูกต้อง");
  const row: Post = { id, company_id: c, author_id: t.viewer.userId, author_name: (await feedAuthor(t)) as string, kind, body: text, meta: m as Data, images: imgs, created_at: stamp(), archived_at: null };
  await t.atomic([t.insertGlobalStmt("company_posts", row)]);
  return row;
}

/** feed_delete(post): the author, or the owner of the posting company, archives it. */
export async function feedDelete(t: Tenant, postId: string): Promise<void> {
  const p = await livePost(t, postId);
  if (!p) fail("ไม่พบโพสต์", 404);
  if (p.author_id !== t.viewer.userId && (await memberRole(t, p.company_id)) !== "owner") fail("ลบได้เฉพาะผู้โพสต์หรือเจ้าของบริษัท", 403);
  await t.atomic([t.updateGlobalStmt("company_posts", { id: postId }, { archived_at: stamp() })]);
}

/** feed_comment(c, post, body) */
export async function feedComment(t: Tenant, postId: string, body: string | null): Promise<Comment> {
  const role = await myRole(t);
  if (role === null || role === "viewer") fail("ไม่มีสิทธิ์แสดงความคิดเห็น", 403);
  const text = trim(body ?? "");
  if (len(text) < 1 || len(text) > 2000) fail("ความคิดเห็นยาว 1–2000 ตัวอักษร");
  if (!(await livePost(t, postId))) fail("ไม่พบโพสต์", 404);
  const row: Comment = { id: uuid(), post_id: postId, company_id: t.viewer.companyId, author_id: t.viewer.userId, author_name: (await feedAuthor(t)) as string, body: text, created_at: stamp() };
  await t.atomic([t.insertGlobalStmt("post_comments", row)]);
  return row;
}

/** feed_like(post): like or unlike; returns the new state and count. */
export async function feedLike(t: Tenant, postId: string): Promise<{ liked: boolean; likes: number }> {
  if (!(await feedSignedIn(t))) fail("เข้าสู่ระบบก่อน", 401);
  if (!(await livePost(t, postId))) fail("ไม่พบโพสต์", 404);
  const key = { post_id: postId, user_id: t.viewer.userId };
  const [removed] = await t.atomic([t.deleteGlobalStmt("post_likes", key)]);
  const liked = removed.changes === 0;
  if (liked) await t.atomic([t.upsertGlobalStmt("post_likes", { ...key, created_at: stamp() }, ["post_id", "user_id"], [])]);
  return { liked, likes: (await t.selectGlobal("post_likes", { where: { post_id: postId } })).length };
}
/** feed_save(post): save or unsave for oneself; true when now saved. */
export async function feedSave(t: Tenant, postId: string): Promise<boolean> {
  if (!(await feedSignedIn(t))) fail("เข้าสู่ระบบก่อน", 401);
  if (!(await livePost(t, postId))) fail("ไม่พบโพสต์", 404);
  const key = { post_id: postId, user_id: t.viewer.userId };
  const [removed] = await t.atomic([t.deleteGlobalStmt("post_saves", key)]);
  if (removed.changes > 0) return false;
  await t.atomic([t.upsertGlobalStmt("post_saves", { ...key, created_at: stamp() }, ["post_id", "user_id"], [])]);
  return true;
}
/** feed_share(post): counts one share per person; returns the share count. */
export async function feedShare(t: Tenant, postId: string): Promise<number> {
  if (!(await feedSignedIn(t))) fail("เข้าสู่ระบบก่อน", 401);
  if (!(await livePost(t, postId))) fail("ไม่พบโพสต์", 404);
  await t.atomic([t.upsertGlobalStmt("post_shares", { post_id: postId, user_id: t.viewer.userId, created_at: stamp() }, ["post_id", "user_id"], [])]);
  return (await t.selectGlobal("post_shares", { where: { post_id: postId } })).length;
}
/** feed_view(posts): one view per person per post (at most 50 posts per call). */
export async function feedView(t: Tenant, postIds: string[] | null): Promise<void> {
  if (!(await feedSignedIn(t))) fail("เข้าสู่ระบบก่อน", 401);
  const ids = [...new Set(postIds ?? [])];
  const live = ids.length ? (await t.selectGlobal<Post>("company_posts", { where: { id: ids, archived_at: null } })).slice(0, 50) : [];
  if (!live.length) return;
  const now = stamp();
  await t.atomic(live.map((p) => t.upsertGlobalStmt("post_views", { post_id: p.id, user_id: t.viewer.userId, created_at: now }, ["post_id", "user_id"], [])));
}

/** feed_follow(c, target): follow or unfollow another company; true when now following. */
export async function feedFollow(t: Tenant, target: string): Promise<boolean> {
  const me = t.viewer.companyId,
    role = await myRole(t);
  if (role === null || role === "viewer") fail("ไม่มีสิทธิ์", 403);
  if (me === target || !(await t.selectGlobal("companies", { where: { id: target }, limit: 1 })).length) fail("ติดตามบริษัทนี้ไม่ได้");
  const [removed] = await t.atomic([t.deleteGlobalStmt("company_follows", { follower_id: me, company_id: target })]);
  if (removed.changes > 0) return false;
  await t.atomic([t.insertGlobalStmt("company_follows", { follower_id: me, company_id: target, created_at: stamp() })]);
  return true;
}
const following = async (t: Tenant) => new Set((await t.selectGlobal<Follow>("company_follows", { where: { follower_id: t.viewer.companyId } })).map((f) => f.company_id));

/** feed_follow_list(c, target, dir): who follows a company, or whom it follows. */
export async function feedFollowList(t: Tenant, target: string, dir: string): Promise<Data[]> {
  await member(t);
  if (!["followers", "following"].includes(dir)) fail("ประเภทไม่ถูกต้อง");
  const me = t.viewer.companyId;
  const rows = (await t.selectGlobal<Follow>("company_follows", { where: dir === "followers" ? { company_id: target } : { follower_id: target }, order: [["created_at", "desc"]] })).slice(0, 300);
  const cos = await companiesById(
    t,
    rows.map((f) => (dir === "followers" ? f.follower_id : f.company_id)),
  );
  const mine = await following(t);
  return rows
    .map((f) => ({ f, c: cos.get(dir === "followers" ? f.follower_id : f.company_id) }))
    .filter((x) => x.c)
    .map(({ f, c }) => ({ id: c!.id, name: c!.name, industry: prof(c!, "industry"), province: prof(c!, "province"), has_logo: hasLogo(c!), since: f.created_at, mine: c!.id === me, following: mine.has(c!.id) }))
    .sort((a, b) => desc(a.since, b.since));
}

/** Live post counts (and latest post time) per company. */
async function postStats(t: Tenant, companyIds: string[]) {
  const stats = new Map<string, { posts: number; last: string | null }>();
  for (const id of companyIds) stats.set(id, { posts: 0, last: null });
  if (!companyIds.length) return stats;
  for (const p of await t.selectGlobal<Post>("company_posts", { where: { company_id: companyIds, archived_at: null } })) {
    const s = stats.get(p.company_id)!;
    s.posts++;
    if (s.last === null || p.created_at > s.last) s.last = p.created_at;
  }
  return stats;
}
const realOthers = async (t: Tenant) => (await t.selectGlobal<Company>("companies")).filter((c) => c.id !== t.viewer.companyId && len(trim(c.name ?? "")) > 0);

/** feed_companies(c, search, limit): the directory of other companies, those that post most first. */
export async function feedCompanies(t: Tenant, search?: string | null, limit?: number | null): Promise<Data[]> {
  await member(t);
  const s = trim(search ?? "");
  const pat = "%" + s + "%";
  const n = Math.min(Math.max(limit ?? 60, 1), 200);
  const list = (await realOthers(t))
    .filter((c) => s === "" || ilike(c.name, pat) || ilike(jtext(c.profile?.industry), pat) || ilike(jtext(c.profile?.province), pat))
    .sort((a, b) => desc(a.created_at, b.created_at))
    .slice(0, n);
  const stats = await postStats(
    t,
    list.map((c) => c.id),
  );
  const mine = await following(t);
  return list
    .map((c) => ({ id: c.id, name: c.name, industry: prof(c, "industry"), province: prof(c, "province"), has_logo: hasLogo(c), about: left(prof(c, "description"), 140), joined: c.created_at, posts: stats.get(c.id)!.posts, following: mine.has(c.id) }))
    .sort((a, b) => b.posts - a.posts || desc(a.joined, b.joined));
}

const PROFILE_KEYS = ["nameEn", "taxId", "registration", "legal", "employees", "founded", "description", "address", "zip", "shipAddress", "phone", "email", "website", "line", "facebook"];
const DEFAULT_VISIBLE = "nameEn,description,website,facebook,line";
/** feed_company_profile(c, target): a company's public page; its own members see everything. */
export async function feedCompanyProfile(t: Tenant, target: string): Promise<Data | null> {
  await member(t);
  const me = t.viewer.companyId;
  const [c] = await t.selectGlobal<Company>("companies", { where: { id: target } });
  if (!c) return null;
  const mine = c.id === me;
  const visibility = prof(c, "visibility") || DEFAULT_VISIBLE;
  const vis = visibility.split(",");
  const d: Data = {};
  for (const k of PROFILE_KEYS) if ((mine || vis.includes(k)) && prof(c, k) !== "") d[k] = left(prof(c, k), 3000);
  const str = (k: string) => (d[k] as string | undefined) ?? "";
  const follows = await t.selectGlobal<Follow>("company_follows", { where: { company_id: c.id } });
  const followingOf = await t.selectGlobal<Follow>("company_follows", { where: { follower_id: c.id } });
  const details = { ...d };
  for (const k of ["nameEn", "description", "website", "facebook", "line"]) delete details[k];
  let products: Data[] = [];
  if (mine || vis.includes("products")) {
    const rows = (await t.selectGlobal<{ id: string; data: Data }>("entities", { where: { company_id: c.id, kind: "sales_packages", archived_at: null } })).filter((e) => (jtext(e.data.status) ?? "active") === "active");
    rows.sort((a, b) => textOrder(jtext(a.data.type), jtext(b.data.type)) || textOrder(jtext(a.data.name), jtext(b.data.name)));
    products = rows.slice(0, 200).map((e) => {
      const price = jtext(e.data.price),
        name = jtext(e.data.name);
      return {
        id: e.id,
        name: name === null ? null : left(name, 200),
        code: left(jtext(e.data.code) ?? "", 60),
        type: jtext(e.data.type) ?? "",
        price: price !== null && /^-?[0-9]+(\.[0-9]+)?$/.test(price) ? Number(price) : 0,
        description: left(jtext(e.data.description) ?? "", 1000),
      };
    });
  }
  return {
    id: c.id,
    name: c.name,
    bio: left(prof(c, "bio"), 160),
    name_en: str("nameEn"),
    industry: prof(c, "industry"),
    province: prof(c, "province"),
    has_logo: hasLogo(c),
    has_cover: prof(c, "cover") !== "",
    about: str("description"),
    website: left(str("website"), 200),
    facebook: left(str("facebook"), 200),
    line: left(str("line"), 200),
    joined: c.created_at,
    posts: (await t.selectGlobal("company_posts", { where: { company_id: c.id, archived_at: null } })).length,
    followers: follows.length,
    following_count: followingOf.length,
    mine,
    following: follows.some((f) => f.follower_id === me),
    follows_us: followingOf.some((f) => f.company_id === me),
    visibility: mine ? visibility : null,
    details,
    products,
  };
}

/** feed_suggest(c): up to six companies to follow — same industry, same province, recently active, new. */
export async function feedSuggest(t: Tenant): Promise<Data[]> {
  const me = t.viewer.companyId;
  if ((await myRole(t)) === null) return [];
  const [self] = await t.selectGlobal<Company>("companies", { where: { id: me } });
  if (!self) return [];
  const ind = prof(self, "industry"),
    prov = prof(self, "province");
  const mine = await following(t);
  const list = (await realOthers(t)).filter((c) => !mine.has(c.id));
  const stats = await postStats(
    t,
    list.map((c) => c.id),
  );
  const rows = list.map((c) => {
    const s = stats.get(c.id)!;
    const sameInd = ind !== "" && jtext(c.profile?.industry) === ind,
      sameProv = prov !== "" && jtext(c.profile?.province) === prov;
    return {
      c,
      posts: s.posts,
      last: s.last,
      score: (sameInd ? 2 : 0) + (sameProv ? 1 : 0),
      reason: sameInd ? "ธุรกิจประเภทเดียวกับคุณ" : sameProv ? "อยู่จังหวัดเดียวกัน" : s.posts > 0 ? "อัปเดตล่าสุด " + bkkDDMM(s.last!) : "เพิ่งเข้าร่วมเครือข่าย",
    };
  });
  rows.sort((a, b) => b.score - a.score || b.posts - a.posts || (a.last === b.last ? 0 : a.last === null ? 1 : b.last === null ? -1 : desc(a.last, b.last)) || desc(a.c.created_at, b.c.created_at));
  return rows.slice(0, 6).map((r) => ({ id: r.c.id, name: r.c.name, industry: prof(r.c, "industry"), province: prof(r.c, "province"), has_logo: hasLogo(r.c), posts: r.posts, reason: r.reason }));
}

/** feed_list(c, filter, before, limit): the feed — all, following, post/job/partner, mine, offers, saved, company:<id>. */
export async function feedList(t: Tenant, filter: string | null = "all", before?: string | null, limit?: number | null): Promise<Data[]> {
  await member(t);
  if (filter === null) return [];
  const me = t.viewer.companyId,
    user = t.viewer.userId;
  const where: Data = { archived_at: null };
  if (before) where.created_at = { op: "<", value: before };
  if (filter.startsWith("company:")) {
    const id = filter.slice(8);
    if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(id)) fail(`invalid input syntax for type uuid: "${id}"`);
    where.company_id = id.toLowerCase();
  }
  const follows = await following(t);
  if (filter === "following") where.company_id = [me, ...follows].filter((x) => where.company_id === undefined || x === where.company_id);
  else if (["post", "job", "partner"].includes(filter)) where.kind = filter;
  else if (filter === "mine") where.company_id = where.company_id === undefined || where.company_id === me ? me : [];
  else if (filter === "offers") where.kind = ["job", "partner"];
  else if (filter === "saved") where.id = (await t.selectGlobal<{ post_id: string }>("post_saves", { where: { user_id: user } })).map((s) => s.post_id);
  const n = Math.min(Math.max(limit ?? 20, 1), 50);
  const all = await t.selectGlobal<Post>("company_posts", { where: where as never, order: [["created_at", "desc"]] });
  const cos = await companiesById(
    t,
    all.map((p) => p.company_id),
  );
  const posts = all.filter((p) => cos.has(p.company_id)).slice(0, n);
  if (!posts.length) return [];
  const ids = posts.map((p) => p.id);
  const by = <T extends { post_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.post_id, [...(m.get(r.post_id) || []), r]);
    return (id: string) => m.get(id) || [];
  };
  const likes = by(await t.selectGlobal<{ post_id: string; user_id: string }>("post_likes", { where: { post_id: ids } }));
  const comments = by(await t.selectGlobal<Comment>("post_comments", { where: { post_id: ids }, order: [["created_at", "desc"]] }));
  const views = by(await t.selectGlobal<{ post_id: string }>("post_views", { where: { post_id: ids } }));
  const shares = by(await t.selectGlobal<{ post_id: string }>("post_shares", { where: { post_id: ids } }));
  const saves = by(await t.selectGlobal<{ post_id: string; user_id: string }>("post_saves", { where: { post_id: ids, user_id: user } }));
  const proposals = by(await t.selectGlobal<Proposal>("post_proposals", { where: { post_id: ids } }));
  const commenters = await companiesById(t, posts.flatMap((p) => comments(p.id).slice(0, 3).map((m) => m.company_id)));
  const roles = new Map((await t.selectGlobal<{ company_id: string; role: string }>("memberships", { where: { user_id: user, disabled: false } })).map((m) => [m.company_id, m.role]));
  if (t.viewer.support) roles.set(me, roles.get(me) ?? "viewer");
  return posts.map((p) => {
    const c = cos.get(p.company_id)!;
    return {
      id: p.id,
      company_id: p.company_id,
      author_name: p.author_name,
      kind: p.kind,
      body: p.body,
      meta: p.meta,
      images: p.images,
      created_at: p.created_at,
      company: { name: c.name, industry: prof(c, "industry"), province: prof(c, "province"), has_logo: hasLogo(c), line: left(prof(c, "line"), 200) },
      likes: likes(p.id).length,
      liked: likes(p.id).some((l) => l.user_id === user),
      comment_count: comments(p.id).length,
      comments: comments(p.id)
        .slice(0, 3)
        .filter((m) => commenters.has(m.company_id))
        .reverse()
        .map((m) => ({ id: m.id, author_name: m.author_name, company_name: commenters.get(m.company_id)!.name, body: m.body, created_at: m.created_at })),
      views: views(p.id).length,
      shares: shares(p.id).length,
      saved: saves(p.id).length > 0,
      following: follows.has(p.company_id),
      mine: p.company_id === me,
      // author = me OR member_role(company) = 'owner': null (not false) when neither holds and the person is no member there.
      can_delete: p.author_id === user || (roles.has(p.company_id) ? roles.get(p.company_id) === "owner" : null),
      proposal_count: p.company_id === me ? proposals(p.id).length : 0,
      proposed: proposals(p.id).some((r) => r.company_id === me),
    };
  });
}

/** feed_propose(c, post, message, contact): another company answers a job or partner notice, once. */
export async function feedPropose(t: Tenant, postId: string, message: string | null, contact: string | null): Promise<Proposal> {
  const me = t.viewer.companyId,
    role = await myRole(t);
  if (role === null || role === "viewer") fail("ไม่มีสิทธิ์ส่งข้อเสนอในนามบริษัทนี้", 403);
  const p = await livePost(t, postId);
  if (!p || !["job", "partner"].includes(p.kind)) fail("ไม่พบประกาศ", 404);
  if (p!.company_id === me) fail("เสนอให้ประกาศของบริษัทตัวเองไม่ได้");
  const text = trim(message ?? "");
  if (len(text) < 1 || len(text) > 3000) fail("เขียนข้อเสนอ 1–3000 ตัวอักษร");
  if (len(contact ?? "") > 200) fail("ช่องทางติดต่อยาวเกินไป");
  if ((await t.selectGlobal("post_proposals", { where: { post_id: postId, company_id: me }, limit: 1 })).length) fail("บริษัทของคุณส่งข้อเสนอให้ประกาศนี้แล้ว", 409);
  const now = stamp();
  const row: Proposal = { id: uuid(), post_id: postId, company_id: me, author_id: t.viewer.userId, author_name: (await feedAuthor(t)) as string, message: text, contact: trim(contact ?? ""), status: "sent", created_at: now, updated_at: now };
  await t.atomic([t.insertGlobalStmt("post_proposals", row)]);
  return row;
}
/** feed_proposal_status(c, id, status): the posting company's owner or manager marks a proposal. */
export async function feedProposalStatus(t: Tenant, id: string, status: string): Promise<void> {
  const role = await myRole(t);
  if (role !== null && !["owner", "manager"].includes(role)) fail("เฉพาะ Owner หรือ Manager", 403);
  if (!["sent", "shortlisted", "declined"].includes(status)) fail("สถานะไม่ถูกต้อง");
  const [r] = await t.selectGlobal<Proposal>("post_proposals", { where: { id } });
  const p = r && (await t.selectGlobal<Post>("company_posts", { where: { id: r.post_id, company_id: t.viewer.companyId } }))[0];
  if (!p) fail("ไม่พบข้อเสนอ", 404);
  await t.atomic([t.updateGlobalStmt("post_proposals", { id }, { status, updated_at: stamp() })]);
}
/** feed_proposals(c, post): proposals to the company's notices and the ones it sent. */
export async function feedProposals(t: Tenant, postId?: string | null): Promise<Data[]> {
  await member(t);
  const me = t.viewer.companyId;
  const myPosts = (await t.selectGlobal<Post>("company_posts", { where: { company_id: me } })).map((p) => p.id);
  const rows = new Map<string, Proposal>();
  for (const r of [...(myPosts.length ? await t.selectGlobal<Proposal>("post_proposals", { where: { post_id: myPosts } }) : []), ...(await t.selectGlobal<Proposal>("post_proposals", { where: { company_id: me } }))]) rows.set(r.id, r);
  const list = [...rows.values()].filter((r) => !postId || r.post_id === postId);
  const posts = new Map((list.length ? await t.selectGlobal<Post>("company_posts", { where: { id: [...new Set(list.map((r) => r.post_id))] } }) : []).map((p) => [p.id, p]));
  const cos = await companiesById(t, [...list.map((r) => r.company_id), ...[...posts.values()].map((p) => p.company_id)]);
  return list
    .filter((r) => posts.has(r.post_id) && cos.has(r.company_id) && cos.has(posts.get(r.post_id)!.company_id))
    .sort((a, b) => desc(a.created_at, b.created_at))
    .map((r) => {
      const p = posts.get(r.post_id)!,
        c = cos.get(r.company_id)!;
      return {
        id: r.id,
        post_id: r.post_id,
        company_id: r.company_id,
        company_name: c.name,
        company_industry: prof(c, "industry"),
        author_name: r.author_name,
        message: r.message,
        contact: r.contact,
        status: r.status,
        created_at: r.created_at,
        post_title: jtext(p.meta?.title) ?? left(p.body, 90),
        post_kind: p.kind,
        post_company: cos.get(p.company_id)!.name,
        incoming: p.company_id === me,
      };
    });
}

/** feed_alerts(c): the last 60 days of what others did towards the company (newest first, at most 60). */
export async function feedAlerts(t: Tenant): Promise<Data[]> {
  await member(t);
  const me = t.viewer.companyId,
    since = minusDays(stamp(), 60);
  const out: Data[] = [];
  const myPosts = await t.selectGlobal<Post>("company_posts", { where: { company_id: me } });
  const myPost = new Map(myPosts.map((p) => [p.id, p]));
  // Proposals to my notices.
  const incoming = myPosts.length ? await t.selectGlobal<Proposal>("post_proposals", { where: { post_id: [...myPost.keys()], created_at: { op: ">", value: since } } }) : [];
  // Answers to my proposals.
  const answered = await t.selectGlobal<Proposal>("post_proposals", { where: { company_id: me, status: { op: "!=", value: "sent" }, updated_at: { op: ">", value: since } } });
  const theirPosts = new Map((answered.length ? await t.selectGlobal<Post>("company_posts", { where: { id: answered.map((r) => r.post_id) } }) : []).map((p) => [p.id, p]));
  // Comments from other companies on my live posts.
  const live = myPosts.filter((p) => !p.archived_at).map((p) => p.id);
  const comments = live.length ? await t.selectGlobal<Comment>("post_comments", { where: { post_id: live, company_id: { op: "!=", value: me }, created_at: { op: ">", value: since } } }) : [];
  // Chat messages from the other company.
  const threads = [...(await t.selectGlobal<Thread>("b2b_threads", { where: { company_a: me } })), ...(await t.selectGlobal<Thread>("b2b_threads", { where: { company_b: me } }))];
  const msgs = threads.length ? await t.selectGlobal<Message>("b2b_messages", { where: { thread_id: threads.map((x) => x.id), company_id: { op: "!=", value: me }, created_at: { op: ">", value: since } } }) : [];
  const offer = (m: Message) => {
    const p = m.post_id ? myPost.get(m.post_id) : undefined;
    return p && ["job", "partner"].includes(p.kind) ? p : undefined;
  };
  const asked = msgs.filter(offer);
  const earlier = asked.length ? await t.selectGlobal<Message>("b2b_messages", { where: { thread_id: [...new Set(asked.map((m) => m.thread_id))], post_id: [...new Set(asked.map((m) => m.post_id!))] } }) : [];
  // New followers.
  const follows = await t.selectGlobal<Follow>("company_follows", { where: { company_id: me, created_at: { op: ">", value: since } } });
  const cos = await companiesById(t, [...incoming.map((r) => r.company_id), ...[...theirPosts.values()].map((p) => p.company_id), ...comments.map((m) => m.company_id), ...msgs.map((m) => m.company_id), ...follows.map((f) => f.follower_id)]);

  for (const r of incoming) {
    const c = cos.get(r.company_id);
    if (c) out.push({ kind: "interest", id: r.id, at: r.created_at, who: c.name, title: postTitle(myPost.get(r.post_id)!), post_id: r.post_id });
  }
  for (const r of answered) {
    const p = theirPosts.get(r.post_id),
      c = p && cos.get(p.company_id);
    if (p && c) out.push({ kind: "reply", id: r.id, at: r.updated_at, who: c.name, title: postTitle(p), post_id: p.id, status: r.status });
  }
  for (const m of comments) {
    const c = cos.get(m.company_id);
    if (c) out.push({ kind: "message", id: m.id, at: m.created_at, who: c.name, title: left(m.body, 90), post_id: m.post_id });
  }
  for (const m of msgs) {
    const c = cos.get(m.company_id);
    if (!c) continue;
    const op = offer(m);
    const first = op && !earlier.some((e) => e.thread_id === m.thread_id && e.post_id === m.post_id && e.company_id === m.company_id && e.created_at < m.created_at);
    out.push(
      first
        ? { kind: "interest", id: m.id, at: m.created_at, who: c.name, title: postTitle(op!), body: left(m.body, 90), post_id: op!.id, thread_id: m.thread_id }
        : { kind: "message", id: m.id, at: m.created_at, who: c.name, title: left(m.body, 90), thread_id: m.thread_id },
    );
  }
  for (const f of follows) {
    const c = cos.get(f.follower_id);
    if (c) out.push({ kind: "network", id: f.follower_id, at: f.created_at, who: c.name, title: "เริ่มติดตามบริษัทของคุณ" });
  }
  return out.sort((a, b) => desc(a.at as string, b.at as string)).slice(0, 60);
}
