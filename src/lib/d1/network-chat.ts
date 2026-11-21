// The B2B chat between two companies for D1, step for step after the Postgres functions b2b_open / b2b_send /
// b2b_read / b2b_inbox / b2b_unread / b2b_post / b2b_thread_member (+ the helpers b2b_thread_of, b2b_writer,
// b2b_post_card, b2b_card_note, b2b_sender), and the people's pictures set_my_avatar / my_avatar (0082). A conversation belongs to two companies, so everything here reads and writes globally and checks
// first that the request's company is one of the two.
import type { Stmt } from "./driver";
import type { Tenant } from "./tenant";
import { fail, feedAuthor, jsonbType, jtext, left, len, myRole, stamp, trim, uuid, type Data } from "./network-common";

export type Thread = { id: string; company_a: string; company_b: string; post_id: string | null; created_at: string; last_at: string };
export type Message = { id: string; thread_id: string; company_id: string; author_id: string; author_name: string; body: string; post_id: string | null; created_at: string; card_id: string | null; files?: Data[] };
export type Post = { id: string; company_id: string; author_id: string; author_name: string; kind: string; body: string; meta: Data; images: string[]; created_at: string; archived_at: string | null };
export type Company = { id: string; name: string; profile: Data; created_at: string };

export const hasLogo = (c: Company) => (jtext(c.profile?.logo) ?? "") !== "";
export async function companiesById(t: Tenant, ids: string[]): Promise<Map<string, Company>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const rows = uniq.length ? await t.selectGlobal<Company>("companies", { where: { id: uniq } }) : [];
  return new Map(rows.map((c) => [c.id, c]));
}
export const postTitle = (p: Post) => {
  const title = jtext(p.meta?.title);
  return title !== null && title !== "" ? title : left(p.body, 90);
};

/** b2b_writer(c): a member who is not a viewer. */
export async function b2bWriter(t: Tenant): Promise<void> {
  const role = await myRole(t);
  if (role === null || role === "viewer") fail("ไม่มีสิทธิ์ทำรายการในนามบริษัทนี้", 403);
}
/** b2b_thread_of(c, thread): the conversation, only if the request's company is one of its two. */
export async function b2bThreadOf(t: Tenant, threadId: string): Promise<Thread> {
  if ((await myRole(t)) === null) fail("ไม่มีสิทธิ์", 403);
  const c = t.viewer.companyId;
  const [th] = await t.selectGlobal<Thread>("b2b_threads", { where: { id: threadId } });
  if (!th || (th.company_a !== c && th.company_b !== c)) fail("ไม่พบห้องแชท", 404);
  return th!;
}

// ---------- people's pictures (user_profiles; the file itself is eliteflow-avatars/<user>.webp → R2) ----------
/** set_my_avatar(on): sets (true) or clears (false) the signed-in person's picture; returns its version (null when cleared). */
export async function setMyAvatar(t: Tenant, on: boolean): Promise<string | null> {
  if (!t.viewer.userId) fail("ไม่มีสิทธิ์", 403);
  const now = stamp(),
    at = on ? now : null;
  await t.atomic([t.upsertGlobalStmt("user_profiles", { user_id: t.viewer.userId, avatar_at: at, updated_at: now }, ["user_id"], ["avatar_at", "updated_at"])]);
  return at;
}
/** my_avatar(): the signed-in person's picture version (null: none). */
export async function myAvatar(t: Tenant): Promise<string | null> {
  const [p] = await t.selectGlobal<{ avatar_at: string | null }>("user_profiles", { where: { user_id: t.viewer.userId }, limit: 1 });
  return p?.avatar_at ?? null;
}
/** b2b_thread_member(thread, write): an active member (write: not a viewer) of either company of the conversation. */
export async function b2bThreadMember(t: Tenant, threadId: string, write = false): Promise<boolean> {
  const [th] = await t.selectGlobal<Thread>("b2b_threads", { where: { id: threadId }, limit: 1 });
  if (!th) return false;
  const ms = await t.selectGlobal<{ role: string }>("memberships", { where: { company_id: [th.company_a, th.company_b], user_id: t.viewer.userId, disabled: false } });
  return ms.some((m) => !write || m.role !== "viewer");
}
/** b2b_sender(m) for several messages: the sender as a chat shows them (picture version, company name, has logo). */
async function senders(t: Tenant, msgs: Message[], cos: Map<string, Company>): Promise<(m: Message) => Data> {
  const ids = [...new Set(msgs.map((m) => m.author_id))];
  const pics = new Map((ids.length ? await t.selectGlobal<{ user_id: string; avatar_at: string | null }>("user_profiles", { where: { user_id: ids } }) : []).map((p) => [p.user_id, p.avatar_at]));
  return (m) => {
    const c = cos.get(m.company_id)!;
    return { author_id: m.author_id, avatar_at: pics.get(m.author_id) ?? null, company_name: c.name, company_has_logo: hasLogo(c) };
  };
}
/** What the inbox and alerts show for a chat message: left(body, n), or "ส่งไฟล์แนบ" when it has only files. */
export const b2bShownBody = (body: string, n: number) => {
  const s = left(body, n);
  return s !== "" ? s : "ส่งไฟล์แนบ";
};

const filePath = (thread: string) => new RegExp("^" + thread + "/[0-9a-f-]{36}\\.[a-z0-9]{1,5}$");
/** b2b_send's check of p_files: at most 10 objects {path in this conversation's folder, name 1–200, mime 1–120, size 1–10000000}. */
function checkFiles(threadId: string, f: unknown): unknown[] {
  const bad = () => fail("ไฟล์แนบไม่ถูกต้อง");
  if (jsonbType(f) !== "array" || (f as unknown[]).length > 10) bad();
  const re = filePath(threadId);
  for (const x of f as unknown[]) {
    if (jsonbType(x) !== "object") bad();
    const o = x as Data;
    if (!re.test(jtext(o.path) ?? "")) bad();
    const nl = len(jtext(o.name) ?? ""),
      ml = len(jtext(o.mime) ?? "");
    if (nl < 1 || nl > 200 || ml < 1 || ml > 120) bad();
    // As in Postgres: with no size key the size test is null (not true), so the file passes and is stored with size null.
    if (o.size === undefined) continue;
    if (jsonbType(o.size) !== "number" || (o.size as number) < 1 || (o.size as number) > 10000000) bad();
  }
  return f as unknown[];
}
/** The files as stored: {path, name, mime, size::bigint} (a fractional size fails the bigint cast, after the body check). */
function storedFiles(f: unknown[]): Data[] {
  return f.map((x) => {
    const o = x as Data,
      size = o.size === undefined ? null : (o.size as number);
    if (size !== null && !Number.isInteger(size)) fail(`invalid input syntax for type bigint: "${jtext(size)}"`);
    return { path: jtext(o.path), name: jtext(o.name), mime: jtext(o.mime), size };
  });
}

/** b2b_post_card(post, any) for several posts at once. */
export async function postCards(t: Tenant, ids: (string | null)[], any = false): Promise<Map<string, Data>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const posts = uniq.length ? await t.selectGlobal<Post>("company_posts", { where: { id: uniq } }) : [];
  const cos = await companiesById(
    t,
    posts.map((p) => p.company_id),
  );
  const out = new Map<string, Data>();
  for (const p of posts) {
    const c = cos.get(p.company_id);
    if (!c || (!any && p.archived_at)) continue;
    out.set(p.id, {
      id: p.id,
      title: postTitle(p),
      kind: p.kind,
      excerpt: left(p.body, 200),
      meta: p.meta,
      image: p.images?.[0] ?? null,
      created_at: p.created_at,
      company: { id: c.id, name: c.name, has_logo: (jtext(c.profile?.logo) ?? "") !== "" },
    });
  }
  return out;
}
/** b2b_post_card(post, any): the card shown for a post in the chat (null when gone). */
export async function b2bPostCard(t: Tenant, postId: string | null, any = false): Promise<Data | null> {
  return (await postCards(t, [postId], any)).get(postId ?? "") ?? null;
}
/** b2b_post(c, post): the card of the post a conversation is about. */
export async function b2bPost(t: Tenant, postId: string): Promise<Data | null> {
  if ((await myRole(t)) === null) fail("ไม่มีสิทธิ์", 403);
  return b2bPostCard(t, postId);
}
const livePost = async (t: Tenant, id: string | null | undefined) => (id ? (await t.selectGlobal("company_posts", { where: { id, archived_at: null }, limit: 1 })).length > 0 : false);

/** b2b_open(c, target, post): the one conversation of the two companies, made on first contact. */
export async function b2bOpen(t: Tenant, target: string, postId?: string | null): Promise<string> {
  const me = t.viewer.companyId,
    role = await myRole(t);
  if (role === null) fail("ไม่มีสิทธิ์", 403);
  if (me === target || !(await t.selectGlobal("companies", { where: { id: target }, limit: 1 })).length) fail("เปิดแชทกับบริษัทนี้ไม่ได้");
  let post = postId ?? null;
  if (post !== null && !(await livePost(t, post))) post = null;
  const [lo, hi] = me < target ? [me, target] : [target, me];
  const [th] = await t.selectGlobal<Thread>("b2b_threads", { where: { company_a: lo, company_b: hi } });
  if (!th) {
    if (role === "viewer") fail("ผู้ชมเริ่มแชทใหม่ไม่ได้", 403);
    const id = uuid(),
      now = stamp();
    await t.atomic([t.insertGlobalStmt("b2b_threads", { id, company_a: lo, company_b: hi, post_id: post, created_at: now, last_at: now })]);
    return id;
  }
  if (post !== null) await t.atomic([t.updateGlobalStmt("b2b_threads", { id: th.id }, { post_id: post })]);
  return th.id;
}

/** The message, the conversation's last_at and the sender's read mark: what every message write does. */
function messageStmts(t: Tenant, m: Message): Stmt[] {
  return [
    t.insertGlobalStmt("b2b_messages", m),
    t.updateGlobalStmt("b2b_threads", { id: m.thread_id }, { last_at: m.created_at }),
    t.upsertGlobalStmt("b2b_reads", { thread_id: m.thread_id, company_id: m.company_id, read_at: m.created_at }, ["thread_id", "company_id"], ["read_at"]),
  ];
}
/** b2b_card_note(c, thread, card, body): the chat line pointing at a deal card (as statements for the caller's batch). */
export function cardNoteStmts(t: Tenant, threadId: string, cardId: string, author: string | null, body: string, now: string): Stmt[] {
  return messageStmts(t, { id: uuid(), thread_id: threadId, company_id: t.viewer.companyId, author_id: t.viewer.userId, author_name: author as string, body: left(body, 4000), post_id: null, created_at: now, card_id: cardId });
}

/** b2b_send(c, thread, body, post, files): a message of text, files (at most 10, inside the conversation's folder) or both. */
export async function b2bSend(t: Tenant, threadId: string, body: string | null, postId?: string | null, files?: unknown): Promise<Data> {
  const role = await myRole(t);
  if (role === null || role === "viewer") fail("ไม่มีสิทธิ์ส่งข้อความในนามบริษัทนี้", 403);
  const th = await b2bThreadOf(t, threadId);
  const f = checkFiles(th.id, files ?? []);
  const text = trim(body ?? "");
  if (len(text) > 4000 || (len(text) === 0 && f.length === 0)) fail("ข้อความยาว 1–4000 ตัวอักษร");
  let post = postId ?? null;
  if (post !== null && !(await livePost(t, post))) post = null;
  const stored = storedFiles(f);
  const m: Message = { id: uuid(), thread_id: th.id, company_id: t.viewer.companyId, author_id: t.viewer.userId, author_name: (await feedAuthor(t)) as string, body: text, post_id: post, created_at: stamp(), card_id: null, files: stored };
  await t.atomic(messageStmts(t, m));
  const sender = await senders(t, [m], await companiesById(t, [m.company_id]));
  return { id: m.id, company_id: m.company_id, author_name: m.author_name, body: m.body, files: stored, created_at: m.created_at, mine: true, ...sender(m) };
}

/** b2b_read(c, thread, before): marks the conversation read and returns up to 200 messages (oldest first). */
export async function b2bRead(t: Tenant, threadId: string, before?: string | null): Promise<Data[]> {
  const th = await b2bThreadOf(t, threadId),
    me = t.viewer.companyId;
  // A support view is read-only in D1 (Postgres would have moved the company's read mark): it reads without marking.
  if (!t.viewer.support) await t.atomic([t.upsertGlobalStmt("b2b_reads", { thread_id: th.id, company_id: me, read_at: stamp() }, ["thread_id", "company_id"], ["read_at"])]);
  const where: Data = { thread_id: th.id };
  if (before) where.created_at = { op: "<", value: before };
  const msgs = await t.selectGlobal<Message>("b2b_messages", { where: where as never, order: [["created_at", "desc"]], limit: 200 });
  const cos = await companiesById(
    t,
    msgs.map((m) => m.company_id),
  );
  const cards = await postCards(
    t,
    msgs.map((m) => m.post_id),
    true,
  );
  const sender = await senders(t, msgs, cos);
  return msgs
    .filter((m) => cos.has(m.company_id))
    .map((m) => ({ id: m.id, company_id: m.company_id, author_name: m.author_name, body: m.body, files: m.files ?? [], created_at: m.created_at, mine: m.company_id === me, post: m.post_id ? (cards.get(m.post_id) ?? null) : null, card_id: m.card_id, ...sender(m) }))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

async function myThreads(t: Tenant): Promise<Thread[]> {
  const me = t.viewer.companyId;
  return [...(await t.selectGlobal<Thread>("b2b_threads", { where: { company_a: me } })), ...(await t.selectGlobal<Thread>("b2b_threads", { where: { company_b: me } }))];
}
/** Messages from the other company after this company's read mark, per conversation. */
async function unreadBy(t: Tenant, threads: Thread[]): Promise<Map<string, number>> {
  const me = t.viewer.companyId,
    ids = threads.map((x) => x.id);
  const out = new Map<string, number>(ids.map((id) => [id, 0]));
  if (!ids.length) return out;
  const reads = new Map((await t.selectGlobal<{ thread_id: string; read_at: string }>("b2b_reads", { where: { thread_id: ids, company_id: me } })).map((r) => [r.thread_id, r.read_at]));
  for (const m of await t.selectGlobal<Message>("b2b_messages", { where: { thread_id: ids, company_id: { op: "!=", value: me } } })) {
    const r = reads.get(m.thread_id);
    if (r === undefined || m.created_at > r) out.set(m.thread_id, (out.get(m.thread_id) || 0) + 1);
  }
  return out;
}

/** b2b_inbox(c): the company's conversations, latest first, with the other company, the post, last message, unread. */
export async function b2bInbox(t: Tenant): Promise<Data[]> {
  if ((await myRole(t)) === null) fail("ไม่มีสิทธิ์", 403);
  const me = t.viewer.companyId,
    threads = await myThreads(t);
  const other = (x: Thread) => (x.company_a === me ? x.company_b : x.company_a);
  const cos = await companiesById(t, threads.map(other));
  const cards = await postCards(
    t,
    threads.map((x) => x.post_id),
  );
  const unread = await unreadBy(t, threads);
  const out: (Data & { last_at: string })[] = [];
  for (const x of threads) {
    const c = cos.get(other(x));
    if (!c) continue;
    const [m] = await t.selectGlobal<Message>("b2b_messages", { where: { thread_id: x.id }, order: [["created_at", "desc"]], limit: 1 });
    out.push({
      id: x.id,
      last_at: x.last_at,
      company: { id: c.id, name: c.name, industry: jtext(c.profile?.industry) ?? "", province: jtext(c.profile?.province) ?? "", has_logo: (jtext(c.profile?.logo) ?? "") !== "" },
      post: x.post_id ? (cards.get(x.post_id) ?? null) : null,
      last: m ? { body: b2bShownBody(m.body, 140), mine: m.company_id === me, at: m.created_at } : null,
      unread: unread.get(x.id) || 0,
    });
  }
  return out.sort((a, b) => (a.last_at < b.last_at ? 1 : a.last_at > b.last_at ? -1 : 0));
}

/** b2b_unread(c): unread messages across all the company's conversations. */
export async function b2bUnread(t: Tenant): Promise<number> {
  if ((await myRole(t)) === null) return 0;
  let n = 0;
  for (const v of (await unreadBy(t, await myThreads(t))).values()) n += v;
  return n;
}
