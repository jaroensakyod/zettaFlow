// Company feed: posts, job openings and partner requests shared across every company on the platform.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { supabaseServer } from "./supabase/server";
import { demoRead, demoMutate, type DemoState } from "./demo";
import { assert } from "./domain";
import { dbError } from "./data";
import type { Context, FeedComment, FeedKind, FeedPost, FeedSuggestion } from "./types";

const BUCKET = "eliteflow-posts";
const filters = ["all", "following", "post", "job", "partner", "mine"] as const;
const imageTypes: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};
const metaSchema = z.object({
  title: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  budget: z.string().trim().max(120).optional(),
});
const postSchema = z.object({
  kind: z.enum(["post", "job", "partner"]),
  body: z.string().trim().min(1, "เขียนข้อความโพสต์").max(5000),
  meta: metaSchema,
});
const canPost = (ctx: Context) => ctx.member.role !== "viewer";
const validImage = (bytes: Buffer, mime: string) =>
  mime === "image/png"
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP";

// ---------- Demo mode: the local company plus a few sample companies ----------
type DemoPost = Omit<
  FeedPost,
  "likes" | "liked" | "comment_count" | "comments" | "following" | "mine" | "can_delete" | "company"
> & { author_id: string; archived_at?: string | null };
type DemoCompany = { id: string; name: string; industry: string; province: string };
type DemoFeed = {
  feedCompanies?: DemoCompany[];
  feedPosts?: DemoPost[];
  feedLikes?: { post_id: string; user_id: string }[];
  feedComments?: (FeedComment & { post_id: string; author_id: string })[];
  feedFollows?: string[];
};
const ago = (hours: number) => new Date(Date.now() - hours * 36e5).toISOString();
function seedFeed(s: DemoState & DemoFeed) {
  if (s.feedPosts) return;
  s.feedCompanies = [
    { id: "f0000000-0000-4000-8000-000000000001", name: "สยามคราฟต์ เฟอร์นิเจอร์", industry: "ผลิต", province: "กรุงเทพฯ" },
    { id: "f0000000-0000-4000-8000-000000000002", name: "ลมหนาว คอฟฟี่", industry: "ร้านอาหาร / คาเฟ่", province: "เชียงใหม่" },
    { id: "f0000000-0000-4000-8000-000000000003", name: "กรีนบิลด์ ดีไซน์", industry: "ก่อสร้าง / ตกแต่ง", province: "กรุงเทพฯ" },
  ];
  const [craft, coffee, build] = s.feedCompanies;
  s.feedPosts = [
    { id: randomUUID(), company_id: craft.id, author_id: "sample", author_name: "ทีมการตลาด", kind: "post", body: "เปิดโชว์รูมใหม่ที่บางนาแล้ว มีคอลเลกชันโต๊ะทำงานไม้สักสำหรับออฟฟิศ รับออกแบบตามขนาดพื้นที่ บริษัทไหนกำลังตกแต่งออฟฟิศใหม่ทักมาคุยได้เลย", meta: { title: "เปิดโชว์รูมใหม่ที่บางนา พร้อมคอลเลกชันโต๊ะไม้สัก" }, images: [], created_at: ago(2) },
    { id: randomUUID(), company_id: coffee.id, author_id: "sample", author_name: "เจ้าของร้าน", kind: "job", body: "รับสมัครบาริสต้าประจำร้านสาขานิมมาน มีประสบการณ์จะพิจารณาเป็นพิเศษ", meta: { title: "บาริสต้า (2 ตำแหน่ง)", location: "นิมมาน, เชียงใหม่", budget: "ตามประสบการณ์" }, images: [], created_at: ago(5) },
    { id: randomUUID(), company_id: build.id, author_id: "sample", author_name: "ฝ่ายจัดซื้อ", kind: "partner", body: "กำลังหา Supplier ไม้อัดและวัสดุตกแต่ง สำหรับโปรเจกต์ร้านค้า 3 สาขา ส่งของได้ทั่วกรุงเทพฯ ภายในเดือนหน้า", meta: { title: "หา Supplier ไม้อัด 3 สาขา", location: "กรุงเทพฯ" }, images: [], created_at: ago(26) },
  ];
  s.feedLikes = [];
  s.feedComments = [];
  s.feedFollows = [];
}
function demoCompanies(s: DemoState & DemoFeed) {
  const own: DemoCompany = {
    id: s.company.id,
    name: s.company.name,
    industry: String(s.company.profile.industry || ""),
    province: String(s.company.profile.province || ""),
  };
  return new Map([own, ...(s.feedCompanies || [])].map((c) => [c.id, c]));
}
function demoView(ctx: Context, s: DemoState & DemoFeed, p: DemoPost): FeedPost {
  const company = demoCompanies(s).get(p.company_id)!,
    comments = (s.feedComments || []).filter((c) => c.post_id === p.id);
  return {
    ...p,
    company: {
      name: company.name,
      industry: company.industry,
      province: company.province,
      has_logo: p.company_id === s.company.id && !!s.company.profile.logo,
    },
    likes: (s.feedLikes || []).filter((l) => l.post_id === p.id).length,
    liked: (s.feedLikes || []).some((l) => l.post_id === p.id && l.user_id === ctx.user.id),
    comment_count: comments.length,
    comments: comments.slice(-3).map(({ id, author_name, company_name, body, created_at }) => ({ id, author_name, company_name, body, created_at })),
    following: (s.feedFollows || []).includes(p.company_id),
    mine: p.company_id === ctx.company.id,
    can_delete: p.author_id === ctx.user.id || (p.company_id === ctx.company.id && ctx.member.role === "owner"),
  };
}
async function demoState() {
  const s = (await demoRead()) as DemoState & DemoFeed;
  if (s.feedPosts) return s;
  try {
    await demoMutate((m: DemoState & DemoFeed) => seedFeed(m));
    return (await demoRead()) as DemoState & DemoFeed;
  } catch {
    // The public showcase is read-only: keep the sample feed in memory.
    seedFeed(s);
    return s;
  }
}

// ---------- Reads ----------
export async function feedList(ctx: Context, filterInput: string | null, before: string | null) {
  const filter = z.enum(filters).catch("all").parse(filterInput || "all"),
    cursor = before ? z.iso.datetime({ offset: true }).parse(before) : null;
  if (ctx.demo) {
    const s = await demoState();
    return (s.feedPosts || [])
      .filter((p) => !p.archived_at && (!cursor || p.created_at < cursor))
      .filter((p) =>
        filter === "following"
          ? p.company_id === ctx.company.id || (s.feedFollows || []).includes(p.company_id)
          : filter === "post" || filter === "job" || filter === "partner"
            ? p.kind === filter
            : filter === "mine"
              ? p.company_id === ctx.company.id
              : true,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20)
      .map((p) => demoView(ctx, s, p));
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("feed_list", {
    p_company: ctx.company.id,
    p_filter: filter,
    p_before: cursor,
    p_limit: 20,
  });
  dbError(error);
  return (data || []) as FeedPost[];
}
export async function feedSuggest(ctx: Context): Promise<FeedSuggestion[]> {
  if (ctx.demo) {
    const s = await demoState();
    return (s.feedCompanies || [])
      .filter((c) => !(s.feedFollows || []).includes(c.id))
      .map((c) => ({ id: c.id, name: c.name, industry: c.industry, has_logo: false }));
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("feed_suggest", { p_company: ctx.company.id });
  dbError(error);
  return (data || []) as FeedSuggestion[];
}

// ---------- Writes ----------
export async function feedPost(ctx: Context, form: FormData) {
  assert(canPost(ctx), "ผู้ชมโพสต์ไม่ได้", 403);
  const input = postSchema.parse({
    kind: form.get("kind") || "post",
    body: form.get("body"),
    meta: JSON.parse(String(form.get("meta") || "{}")),
  });
  if (input.kind !== "post") assert(input.meta.title, "ใส่หัวข้อประกาศ");
  const files = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  assert(files.length <= 4, "แนบรูปได้สูงสุด 4 รูป");
  const id = randomUUID(),
    images: { path: string; bytes: Buffer; mime: string }[] = [];
  for (const [n, file] of files.entries()) {
    const ext = imageTypes[file.type];
    assert(ext, "รองรับรูป PNG JPG และ WebP");
    assert(file.size <= 1500000, "รูปละไม่เกิน 1.5 MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    assert(validImage(bytes, file.type), "ไฟล์รูปไม่ถูกต้อง");
    images.push({ path: `${ctx.company.id}/${id}/${n}.${ext}`, bytes, mime: file.type });
  }
  if (ctx.demo) {
    const root = resolve(".data/demo-files/posts");
    await mkdir(root, { recursive: true });
    for (const img of images) await writeFile(resolve(root, img.path.replaceAll("/", "_")), img.bytes);
    return demoMutate((s: DemoState & DemoFeed) => {
      seedFeed(s);
      const post: DemoPost = { id, company_id: ctx.company.id, author_id: ctx.user.id, author_name: ctx.user.name, kind: input.kind as FeedKind, body: input.body, meta: input.meta, images: images.map((i) => i.path), created_at: new Date().toISOString() };
      s.feedPosts!.push(post);
      return demoView(ctx, s, post);
    });
  }
  const sb = await supabaseServer();
  for (const img of images) {
    const { error } = await sb.storage.from(BUCKET).upload(img.path, img.bytes, { contentType: img.mime, upsert: false });
    if (error) {
      await sb.storage.from(BUCKET).remove(images.map((i) => i.path));
      dbError(error);
    }
  }
  const { error } = await sb.rpc("feed_post", {
    p_company: ctx.company.id,
    p_id: id,
    p_kind: input.kind,
    p_body: input.body,
    p_meta: input.meta,
    p_images: images.map((i) => i.path),
  });
  if (error) {
    if (images.length) await sb.storage.from(BUCKET).remove(images.map((i) => i.path));
    dbError(error);
  }
  return { id };
}
export async function feedDelete(ctx: Context, postId: string) {
  const id = z.uuid().parse(postId);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoFeed) => {
      const p = (s.feedPosts || []).find((x) => x.id === id && !x.archived_at);
      assert(p, "ไม่พบโพสต์", 404);
      assert(demoView(ctx, s, p).can_delete, "ลบได้เฉพาะผู้โพสต์หรือเจ้าของบริษัท", 403);
      p.archived_at = new Date().toISOString();
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("feed_delete", { p_post: id });
  dbError(error);
}
export async function feedLike(ctx: Context, postId: string): Promise<{ liked: boolean; likes: number }> {
  const id = z.uuid().parse(postId);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoFeed) => {
      seedFeed(s);
      assert(s.feedPosts!.some((p) => p.id === id && !p.archived_at), "ไม่พบโพสต์", 404);
      const had = s.feedLikes!.some((l) => l.post_id === id && l.user_id === ctx.user.id);
      s.feedLikes = s.feedLikes!.filter((l) => !(l.post_id === id && l.user_id === ctx.user.id));
      if (!had) s.feedLikes.push({ post_id: id, user_id: ctx.user.id });
      return { liked: !had, likes: s.feedLikes.filter((l) => l.post_id === id).length };
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("feed_like", { p_post: id });
  dbError(error);
  return data;
}
export async function feedComment(ctx: Context, postId: string, input: unknown): Promise<FeedComment> {
  const id = z.uuid().parse(postId),
    { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(input);
  assert(canPost(ctx), "ผู้ชมแสดงความคิดเห็นไม่ได้", 403);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoFeed) => {
      seedFeed(s);
      assert(s.feedPosts!.some((p) => p.id === id && !p.archived_at), "ไม่พบโพสต์", 404);
      const c = { id: randomUUID(), post_id: id, author_id: ctx.user.id, author_name: ctx.user.name, company_name: ctx.company.name, body, created_at: new Date().toISOString() };
      s.feedComments!.push(c);
      return c;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("feed_comment", { p_company: ctx.company.id, p_post: id, p_body: body });
  dbError(error);
  return { ...(data as FeedComment), company_name: ctx.company.name };
}
export async function feedFollow(ctx: Context, target: string): Promise<boolean> {
  const id = z.uuid().parse(target);
  assert(canPost(ctx), "ไม่มีสิทธิ์", 403);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoFeed) => {
      seedFeed(s);
      assert(id !== s.company.id && demoCompanies(s).has(id), "ติดตามบริษัทนี้ไม่ได้");
      const on = s.feedFollows!.includes(id);
      s.feedFollows = on ? s.feedFollows!.filter((x) => x !== id) : [...s.feedFollows!, id];
      return !on;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("feed_follow", { p_company: ctx.company.id, p_target: id });
  dbError(error);
  return Boolean(data);
}

// ---------- Media ----------
export async function feedImage(ctx: Context, path: string) {
  assert(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-3]\.(webp|png|jpg)$/.test(path), "ไม่พบรูป", 404);
  const ext = path.split(".").pop()!,
    mime = Object.keys(imageTypes).find((k) => imageTypes[k] === ext)!;
  if (ctx.demo)
    return { mime, bytes: await readFile(resolve(".data/demo-files/posts", path.replaceAll("/", "_"))) };
  const sb = await supabaseServer();
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  dbError(error);
  assert(data, "ไม่พบรูป", 404);
  return { mime, bytes: Buffer.from(await data.arrayBuffer()) };
}
/** A company's logo for feed cards: decoded data URL, or the https link it points to. */
export async function companyLogo(ctx: Context, companyId: string) {
  const id = z.uuid().parse(companyId);
  let logo = "";
  if (ctx.demo) {
    const s = await demoRead();
    logo = id === s.company.id ? String(s.company.profile.logo || "") : "";
  } else {
    const sb = await supabaseServer();
    const { data, error } = await sb.rpc("company_card", { p_id: id });
    dbError(error);
    logo = String((data as { logo?: string } | null)?.logo || "");
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(logo);
  if (match) return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
  if (/^https:\/\/\S+$/.test(logo)) return { redirect: logo };
  return null;
}
