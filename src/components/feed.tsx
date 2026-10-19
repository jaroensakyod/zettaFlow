"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon,
  BriefcaseBusiness,
  Handshake,
  Newspaper,
  Trash2,
  X,
  Send,
  Search,
  Plus,
  Check,
  Sparkles,
  ChevronRight,
  ThumbsUp,
  MessageSquare,
  Share2,
} from "lucide-react";
import { businessTypeGroups, industryMatches } from "@/lib/catalog";
import type { Context, FeedComment, FeedKind, FeedPost, FeedSuggestion } from "@/lib/types";
import { api, Empty, Loading, Modal } from "./shared";

const tabs = [
  ["all", "ทั้งหมด"],
  ["post", "ข่าว & ผลงาน"],
  ["job", "ประกาศงาน"],
  ["partner", "หาพาร์ทเนอร์"],
  ["following", "บริษัทที่ติดตาม"],
  ["mine", "ของบริษัทเรา"],
] as const;
type Tab = (typeof tabs)[number][0];
const kinds: [FeedKind, string, typeof ImageIcon][] = [
  ["post", "ข่าว & ผลงาน", Newspaper],
  ["job", "ประกาศงาน", BriefcaseBusiness],
  ["partner", "หาพาร์ทเนอร์", Handshake],
];
export const employmentLabels: Record<string, string> = {
  full: "งานประจำ",
  part: "พาร์ทไทม์",
  contract: "สัญญาจ้าง / รายโปรเจกต์",
  freelance: "ฟรีแลนซ์",
};
export const kindLabel: Record<FeedKind, string> = {
  post: "ข่าว & ผลงาน",
  job: "ประกาศงาน",
  partner: "หาพาร์ทเนอร์",
};
const palette = ["#7952dd", "#b2542f", "#2b6cc4", "#2f8a6b", "#a8326b", "#4a5bbf", "#7a6a1f"];
const tint = (id: string) =>
  palette[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % palette.length];
const initials = (name: string) =>
  name.replace(/^(บริษัท|บจก\.?|หจก\.?)\s*/, "").trim().slice(0, 2) || "?";
export const since = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาที`;
  if (min < 1440) return `${Math.round(min / 60)} ชม.`;
  if (min < 10080) return `${Math.round(min / 1440)} วัน`;
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
};
export const headline = (p: FeedPost) => p.meta.title || p.body.split("\n")[0];
// Body text under the headline: the whole body when the post has its own title, else what follows the first line.
const excerpt = (p: FeedPost) =>
  p.meta.title ? p.body : p.body.slice(p.body.split("\n")[0].length).trim();
// Re-encodes a photo as WebP, at most 1600px on the long side, so uploads stay small.
async function shrink(file: File) {
  const bitmap = await createImageBitmap(file),
    scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
    if (blob && blob.size <= 1400000) return blob;
  }
  throw Error("รูปใหญ่เกินไป");
}

/** Business type filter options: each group as a whole, then its types. */
export function IndustryOptions() {
  return (
    <>
      {businessTypeGroups.map(([group, items]) => (
        <optgroup key={group} label={group}>
          <option value={"group:" + group}>ทั้งหมวด{group}</option>
          {items.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
export function CompanyLogo({ id, name, logo, size = 40 }: { id: string; name: string; logo: boolean | string; size?: number }) {
  const src = typeof logo === "string" ? logo : logo ? "/api/feed/logo/" + id : "";
  return src ? (
    <img className="net-logo" src={src} alt="" width={size} height={size} />
  ) : (
    <span className="net-logo" style={{ width: size, height: size, background: tint(id), fontSize: size / 2.8 }}>
      {initials(name)}
    </span>
  );
}

export function Feed({
  ctx,
  notify,
  navigate,
}: {
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("all"),
    [posts, setPosts] = useState<FeedPost[] | null>(null),
    [more, setMore] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [suggest, setSuggest] = useState<FeedSuggestion[]>([]),
    [chances, setChances] = useState<FeedPost[]>([]),
    [search, setSearch] = useState(""),
    [industry, setIndustry] = useState(""),
    [composing, setComposing] = useState<FeedKind | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async (t: Tab, before?: string) => {
    const rows: FeedPost[] = await api(
      `/feed?filter=${t}` + (before ? "&before=" + encodeURIComponent(before) : ""),
    );
    setMore(rows.length === 20);
    setPosts((old) => (before && old ? [...old, ...rows] : rows));
  }, []);
  useEffect(() => {
    setPosts(null);
    setError("");
    load(tab).catch((e) => setError((e as Error).message));
  }, [tab, load]);
  const loadSide = useCallback(() => {
    api("/feed/suggest").then(setSuggest).catch(() => {});
    api("/feed?filter=offers")
      .then((rows: FeedPost[]) => setChances(rows.filter((x) => !x.mine).slice(0, 3)))
      .catch(() => {});
  }, []);
  useEffect(loadSide, [loadSide]);
  const update = (id: string, patch: Partial<FeedPost>) =>
    setPosts((list) => list?.map((p) => (p.id === id ? { ...p, ...patch } : p)) || null);
  const follow = async (companyId: string) => {
    try {
      const { following } = await api("/feed/follow/" + companyId, { method: "POST" });
      setPosts((list) => list?.map((p) => (p.company_id === companyId ? { ...p, following } : p)) || null);
      setSuggest((s) => s.filter((c) => c.id !== companyId || !following));
      notify(following ? "ติดตามบริษัทแล้ว" : "เลิกติดตามแล้ว");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const profile = ctx.company.profile,
    logo = String(profile.logo || ""),
    cover = String(profile.cover || ""),
    tagline = [profile.industry, profile.province].filter(Boolean).join(" · "),
    about = String(profile.description || ""),
    myIndustry = String(profile.industry || ""),
    q = search.trim().toLowerCase(),
    shown = (posts || []).filter(
      (p) =>
        industryMatches(industry, p.company.industry) &&
        (!q || [p.company.name, p.meta.title || "", p.body].join(" ").toLowerCase().includes(q)),
    ),
    writer = ctx.member.role !== "viewer";
  return (
    <div className="li">
      <aside className="li-left">
        <section className="card li-profile">
          <div
            className="li-profile-cover"
            style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
          />
          <div className="li-profile-logo">
            <CompanyLogo id={ctx.company.id} name={ctx.company.name} logo={logo} size={72} />
          </div>
          <h2>{ctx.company.name}</h2>
          <p className="li-tagline">{tagline || "เพิ่มประเภทธุรกิจและจังหวัดในโปรไฟล์"}</p>
          {about && <p className="li-about">{about}</p>}
          <div className="li-profile-links">
            <button onClick={() => setTab("mine")}>
              อัปเดตของบริษัทเรา
              <ChevronRight size={15} />
            </button>
            <button onClick={() => setTab("following")}>
              บริษัทที่ติดตาม
              <ChevronRight size={15} />
            </button>
            <button onClick={() => navigate("jobs")}>
              งาน &amp; ข้อเสนอ
              <ChevronRight size={15} />
            </button>
          </div>
          <button className="li-profile-edit" onClick={() => navigate("company")}>
            แก้ไขหน้าบริษัท
          </button>
        </section>
        <nav className="card li-nav" aria-label="หมวดอัปเดต">
          <span>หมวดอัปเดต</span>
          {tabs.map(([key, label]) => (
            <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="li-main" aria-label="อัปเดตล่าสุด">
        {writer && (
          <section className="card li-start">
            <div className="li-start-top">
              <CompanyLogo id={ctx.company.id} name={ctx.company.name} logo={logo} size={48} />
              <button className="li-start-input" onClick={() => setComposing("post")}>
                เริ่มลงอัปเดตในนาม {ctx.company.name}
              </button>
            </div>
            <div className="li-start-kinds">
              {kinds.map(([key, label, Ico]) => (
                <button key={key} className={"li-kind " + key} onClick={() => setComposing(key)}>
                  <Ico size={19} />
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}
        <div className="li-toolbar">
          <label className="li-search">
            <Search size={15} />
            <span className="sr-only">ค้นหาในเครือข่าย</span>
            <input placeholder="ค้นหาบริษัทหรืออัปเดต" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="li-select">
            <span className="sr-only">หมวดอัปเดต</span>
            <select value={tab} onChange={(e) => setTab(e.target.value as Tab)}>
              {tabs.map(([key, label]) => (
                <option key={key} value={key}>
                  แสดง: {label}
                </option>
              ))}
            </select>
          </label>
          <label className="li-select">
            <span className="sr-only">ประเภทธุรกิจ</span>
            <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">ทุกประเภทธุรกิจ</option>
              <IndustryOptions />
            </select>
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        {!posts ? (
          <section className="card">
            <Loading />
          </section>
        ) : shown.length ? (
          shown.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              ctx={ctx}
              notify={notify}
              navigate={navigate}
              onFollow={() => follow(p.company_id)}
              onChange={(patch) => update(p.id, patch)}
              onDelete={() => setPosts((list) => list?.filter((x) => x.id !== p.id) || null)}
            />
          ))
        ) : (
          <section className="card">
            <Empty
              title={
                posts.length
                  ? "ไม่มีอัปเดตที่ตรงกับตัวกรอง"
                  : tab === "following"
                    ? "ยังไม่ได้ติดตามบริษัทไหน"
                    : "ยังไม่มีอัปเดต"
              }
              description={
                posts.length
                  ? "ลองล้างคำค้นหรือเลือกประเภทธุรกิจอื่น"
                  : tab === "following"
                    ? "กดติดตามบริษัทจากรายการแนะนำ แล้วอัปเดตของเขาจะมาอยู่ที่นี่"
                    : "ลงอัปเดตแนะนำบริษัทของคุณเป็นคนแรก"
              }
            />
          </section>
        )}
        {posts && more && (
          <button
            className="secondary li-more"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              try {
                await load(tab, posts[posts.length - 1].created_at);
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setLoadingMore(false);
              }
            }}
          >
            {loadingMore ? "กำลังโหลด…" : "ดูอัปเดตก่อนหน้า"}
          </button>
        )}
      </section>

      <aside className="li-right">
        <section className="card li-side">
          <div className="li-side-head">
            <h2>
              <Sparkles size={16} />
              โอกาสที่อาจเหมาะกับคุณ
            </h2>
          </div>
          {chances.length ? (
            chances.map((c) => (
              <button key={c.id} className="li-chance" onClick={() => navigate("jobs")}>
                <CompanyLogo id={c.company_id} name={c.company.name} logo={c.company.has_logo} size={40} />
                <span>
                  <strong>{headline(c)}</strong>
                  <small>
                    {c.company.name} · {kindLabel[c.kind]}
                  </small>
                  {myIndustry && c.company.industry === myIndustry && <em>ธุรกิจประเภทเดียวกับคุณ</em>}
                </span>
              </button>
            ))
          ) : (
            <p className="li-side-empty">ยังไม่มีประกาศงานหรือหาพาร์ทเนอร์จากบริษัทอื่น</p>
          )}
          <button className="li-side-more" onClick={() => navigate("jobs")}>
            ดูงานและโอกาสทั้งหมด
            <ChevronRight size={15} />
          </button>
        </section>
        <section className="card li-side">
          <div className="li-side-head">
            <h2>บริษัทแนะนำให้ติดตาม</h2>
          </div>
          {suggest.length ? (
            suggest.map((c) => (
              <div className="li-suggest" key={c.id}>
                <CompanyLogo id={c.id} name={c.name} logo={c.has_logo} size={44} />
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.industry || "บริษัทในเครือข่าย"}</small>
                  <button className="li-follow-pill" onClick={() => follow(c.id)}>
                    <Plus size={14} />
                    ติดตาม
                  </button>
                </span>
              </div>
            ))
          ) : (
            <p className="li-side-empty">ติดตามครบทุกบริษัทที่มีอัปเดตแล้ว</p>
          )}
        </section>
        <p className="li-footer">EliteFlow · เครือข่ายธุรกิจสำหรับบริษัทไทย</p>
      </aside>

      {composing && (
        <Composer
          ctx={ctx}
          initialKind={composing}
          onClose={() => setComposing(null)}
          onPosted={(kind) => {
            setComposing(null);
            notify("ลงอัปเดตแล้ว");
            if (tab === "all" || tab === "mine" || tab === kind) load(tab).catch(() => {});
            else setTab("all");
            loadSide();
          }}
        />
      )}
    </div>
  );
}

export function Composer({
  ctx,
  onClose,
  onPosted,
  initialKind = "post",
}: {
  ctx: Context;
  onClose: () => void;
  onPosted: (kind: FeedKind) => void;
  initialKind?: FeedKind;
}) {
  const [kind, setKind] = useState<FeedKind>(initialKind),
    [body, setBody] = useState(""),
    [meta, setMeta] = useState({ title: "", location: "", budget: "", employment: "full" }),
    [images, setImages] = useState<{ blob: Blob; url: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    fileRef = useRef<HTMLInputElement>(null),
    urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  return (
    <Modal title="ลงอัปเดตบริษัท" onClose={onClose}>
      <form
        className="net-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const form = new FormData();
            form.set("kind", kind);
            form.set("body", body);
            const { employment, ...rest } = meta;
            form.set(
              "meta",
              JSON.stringify(kind === "post" ? { title: meta.title } : kind === "job" ? meta : rest),
            );
            images.forEach((img, n) => form.append("images", img.blob, `${n}.webp`));
            const r = await fetch("/api/feed", { method: "POST", body: form });
            const data = await r.json();
            if (!r.ok) throw Error(data.error);
            onPosted(kind);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="net-kinds" role="radiogroup" aria-label="ประเภทอัปเดต">
          {kinds.map(([key, label, Ico]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={kind === key}
              className={kind === key ? "active" : ""}
              onClick={() => setKind(key)}
            >
              <Ico size={17} />
              {label}
            </button>
          ))}
        </div>
        <label>
          {kind === "job" ? "ตำแหน่งงาน" : kind === "partner" ? "กำลังหาอะไร" : "หัวข้อ"}
          <input
            required={kind !== "post"}
            maxLength={120}
            placeholder={
              kind === "job" ? "เช่น บาริสต้า 2 ตำแหน่ง" : kind === "partner" ? "เช่น หา Supplier ไม้อัด 3 สาขา" : "เช่น เปิดโชว์รูมใหม่ที่บางนา"
            }
            value={meta.title}
            onChange={(e) => setMeta({ ...meta, title: e.target.value })}
          />
        </label>
        <label>
          รายละเอียด
          <textarea
            required
            rows={5}
            maxLength={5000}
            placeholder={kind === "job" ? "หน้าที่ คุณสมบัติ และวิธีสมัคร" : "เล่ารายละเอียดให้บริษัทอื่นเข้าใจ"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {kind !== "post" && (
          <div className="form-grid">
            <label>
              สถานที่
              <input maxLength={120} placeholder="จังหวัด / ย่าน" value={meta.location} onChange={(e) => setMeta({ ...meta, location: e.target.value })} />
            </label>
            <label>
              {kind === "job" ? "ค่าจ้าง" : "งบประมาณ"}
              <input maxLength={120} placeholder="ไม่บังคับ" value={meta.budget} onChange={(e) => setMeta({ ...meta, budget: e.target.value })} />
            </label>
            {kind === "job" && (
              <label>
                รูปแบบงาน
                <select value={meta.employment} onChange={(e) => setMeta({ ...meta, employment: e.target.value })}>
                  {Object.entries(employmentLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        <div className="net-previews">
          {images.map((img, n) => (
            <span key={img.url}>
              <img src={img.url} alt={`รูปที่ ${n + 1}`} />
              <button type="button" aria-label="เอารูปออก" onClick={() => setImages(images.filter((_, i) => i !== n))}>
                <X size={13} />
              </button>
            </span>
          ))}
          {images.length < 4 && (
            <button type="button" className="net-add-image" onClick={() => fileRef.current?.click()}>
              <ImageIcon size={18} />
              เพิ่มรูป ({images.length}/4)
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={async (e) => {
              const picked = [...(e.target.files || [])].slice(0, 4 - images.length);
              e.target.value = "";
              try {
                const out: { blob: Blob; url: string }[] = [];
                for (const f of picked) {
                  const blob = await shrink(f);
                  const url = URL.createObjectURL(blob);
                  urls.current.push(url);
                  out.push({ blob, url });
                }
                setImages((list) => [...list, ...out]);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
        <div className="modal-footer">
          <span className="muted">ลงในนาม {ctx.company.name} · บริษัทอื่นในเครือข่ายเห็นได้</span>
          <button className="primary" disabled={busy || !body.trim()}>
            {busy ? "กำลังลง…" : "ลงอัปเดต"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PostCard({
  post: p,
  ctx,
  notify,
  navigate,
  onFollow,
  onChange,
  onDelete,
}: {
  post: FeedPost;
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
  onFollow: () => void;
  onChange: (patch: Partial<FeedPost>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false),
    [expanded, setExpanded] = useState(false),
    [comment, setComment] = useState(""),
    [sending, setSending] = useState(false),
    inputRef = useRef<HTMLInputElement>(null);
  const ask = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const interest = async () => {
    onChange({ liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) });
    try {
      onChange(await api(`/feed/${p.id}/like`, { method: "POST" }));
    } catch (e) {
      onChange({ liked: p.liked, likes: p.likes });
      notify((e as Error).message);
    }
  };
  const offer = p.kind !== "post",
    text = offer ? p.body : excerpt(p),
    long = text.length > 280 || text.split("\n").length > 4;
  return (
    <article className="card li-post">
      <header className="li-post-head">
        <CompanyLogo id={p.company_id} name={p.company.name} logo={p.company.has_logo} size={48} />
        <div className="li-post-who">
          <strong>{p.company.name}</strong>
          <small>{[p.company.industry, p.company.province].filter(Boolean).join(" · ") || "บริษัทในเครือข่าย"}</small>
          <small>
            {since(p.created_at)} · โดย {p.author_name}
          </small>
        </div>
        {!p.mine && (
          <button className={"li-follow" + (p.following ? " on" : "")} onClick={onFollow}>
            {p.following ? <Check size={15} /> : <Plus size={15} />}
            {p.following ? "ติดตามแล้ว" : "ติดตาม"}
          </button>
        )}
        {p.can_delete && (
          <button
            className="icon-button li-delete"
            aria-label="ลบอัปเดตนี้"
            onClick={async () => {
              if (!confirm("ลบอัปเดตนี้?")) return;
              try {
                await api("/feed/" + p.id, { method: "DELETE" });
                onDelete();
                notify("ลบอัปเดตแล้ว");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </header>
      {!offer && p.meta.title && <h3 className="li-post-title">{p.meta.title}</h3>}
      {text && (
        <div className="li-post-text">
          <p className={long && !expanded ? "clamped" : ""}>{text}</p>
          {long && (
            <button className="li-more-text" onClick={() => setExpanded(!expanded)}>
              {expanded ? "ย่อ" : "…ดูเพิ่มเติม"}
            </button>
          )}
        </div>
      )}
      {p.images.length > 0 && (
        <div className={"li-media n" + Math.min(p.images.length, 4)}>
          {p.images.map((path, n) => (
            <a key={path} href={"/api/feed/image/" + path} target="_blank" rel="noreferrer">
              <img src={"/api/feed/image/" + path} alt={`รูปที่ ${n + 1} จาก ${p.company.name}`} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {offer && (
        <div className={"li-offer " + p.kind}>
          <span className="li-offer-icon">
            {p.kind === "job" ? <BriefcaseBusiness size={22} /> : <Handshake size={22} />}
          </span>
          <span className="li-offer-text">
            <small>{kindLabel[p.kind]}</small>
            <strong>{headline(p)}</strong>
            <span>
              {[
                p.meta.location,
                p.kind === "job" ? employmentLabels[p.meta.employment || "full"] : "",
                p.meta.budget,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          {!p.mine && (
            <button className="li-offer-cta" onClick={() => navigate("jobs")}>
              {p.proposed ? "ดูข้อเสนอ" : p.kind === "job" ? "สมัคร" : "เสนอตัว"}
            </button>
          )}
        </div>
      )}
      {(p.likes > 0 || p.comment_count > 0) && (
        <div className="li-counts">
          {p.likes > 0 && (
            <span>
              <i>
                <ThumbsUp size={10} />
              </i>
              {p.likes} สนใจ
            </span>
          )}
          {p.comment_count > 0 && (
            <button onClick={() => setOpen(!open)}>{p.comment_count} ถามตอบ</button>
          )}
        </div>
      )}
      <div className="li-actions">
        <button className={p.liked ? "on" : ""} aria-pressed={p.liked} onClick={interest}>
          <ThumbsUp size={18} />
          สนใจ
        </button>
        <button aria-expanded={open} onClick={ask}>
          <MessageSquare size={18} />
          ถามตอบ
        </button>
        {offer && !p.mine ? (
          <button onClick={() => navigate("jobs")}>
            <Handshake size={18} />
            {p.kind === "job" ? "สมัครงาน" : "เสนอตัว"}
          </button>
        ) : (
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${headline(p)} — ${p.company.name}\n${location.origin}/eliteflow`);
                notify("คัดลอกไว้ส่งต่อแล้ว");
              } catch {
                notify("คัดลอกไม่ได้");
              }
            }}
          >
            <Share2 size={18} />
            ส่งต่อ
          </button>
        )}
      </div>
      {open && (
        <div className="li-thread">
          {ctx.member.role !== "viewer" && (
            <form
              className="li-reply-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                setSending(true);
                try {
                  const c: FeedComment = await api(`/feed/${p.id}/comments`, { method: "POST", body: { body: comment } });
                  onChange({ comments: [...p.comments, c].slice(-3), comment_count: p.comment_count + 1 });
                  setComment("");
                } catch (err) {
                  notify((err as Error).message);
                } finally {
                  setSending(false);
                }
              }}
            >
              <CompanyLogo id={ctx.company.id} name={ctx.company.name} logo={String(ctx.company.profile.logo || "")} size={34} />
              <label className="sr-only" htmlFor={"reply-" + p.id}>
                เขียนคำถามหรือคำตอบ
              </label>
              <input
                id={"reply-" + p.id}
                ref={inputRef}
                maxLength={2000}
                placeholder={`ถามหรือตอบในนาม ${ctx.company.name}`}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button className="primary" aria-label="ส่ง" disabled={sending || !comment.trim()}>
                <Send size={15} />
              </button>
            </form>
          )}
          {p.comment_count > p.comments.length && (
            <small className="li-thread-note">แสดง {p.comments.length} ข้อความล่าสุดจาก {p.comment_count}</small>
          )}
          {p.comments.map((c) => (
            <div className="li-reply" key={c.id}>
              <span className="li-reply-avatar" style={{ background: tint(c.company_name) }}>
                {initials(c.company_name)}
              </span>
              <div>
                <strong>
                  {c.company_name}
                  <small> · {c.author_name} · {since(c.created_at)}</small>
                </strong>
                <p>{c.body}</p>
              </div>
            </div>
          ))}
          {!p.comments.length && <small className="li-thread-note">ยังไม่มีคำถาม เริ่มถามได้เลย</small>}
        </div>
      )}
    </article>
  );
}
