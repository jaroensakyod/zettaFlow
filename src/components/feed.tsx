"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { businessTypes } from "@/lib/catalog";
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
    [types, setTypes] = useState<string[]>([]),
    [province, setProvince] = useState(""),
    [composing, setComposing] = useState(false),
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
    Promise.all([api("/feed?filter=job"), api("/feed?filter=partner")])
      .then(([j, p]: FeedPost[][]) =>
        setChances(
          [...j, ...p]
            .filter((x) => !x.mine)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 3),
        ),
      )
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
  const provinces = useMemo(
    () => [...new Set((posts || []).map((p) => p.company.province).filter(Boolean))].sort(),
    [posts],
  );
  const q = search.trim().toLowerCase(),
    shown = (posts || []).filter(
      (p) =>
        (!types.length || types.includes(p.company.industry)) &&
        (!province || p.company.province === province) &&
        (!q || [p.company.name, p.meta.title || "", p.body].join(" ").toLowerCase().includes(q)),
    ),
    myIndustry = String(ctx.company.profile.industry || ""),
    logo = String(ctx.company.profile.logo || "");
  return (
    <div className="net">
      <section className="net-head">
        <div>
          <h1>เครือข่ายธุรกิจ</h1>
          <p>อัปเดตจากบริษัทในเครือข่าย ข่าว ผลงาน ประกาศงาน และโอกาสร่วมธุรกิจ</p>
        </div>
        <div className="net-head-actions">
          <label className="net-search">
            <Search size={16} />
            <span className="sr-only">ค้นหาบริษัทหรืออัปเดต</span>
            <input placeholder="ค้นหาบริษัทหรืออัปเดต" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {ctx.member.role !== "viewer" && (
            <button className="primary" onClick={() => setComposing(true)}>
              <Plus size={16} />
              ลงอัปเดตบริษัท
            </button>
          )}
        </div>
      </section>

      <div className="net-tabs" role="tablist" aria-label="ประเภทอัปเดต">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="net-body">
        <aside className="net-filters">
          <section className="card">
            <h2>ประเภทธุรกิจ</h2>
            <label className="net-check">
              <input type="checkbox" checked={!types.length} onChange={() => setTypes([])} />
              ทั้งหมด
            </label>
            {businessTypes.map((t) => (
              <label className="net-check" key={t}>
                <input
                  type="checkbox"
                  checked={types.includes(t)}
                  onChange={(e) => setTypes((s) => (e.target.checked ? [...s, t] : s.filter((x) => x !== t)))}
                />
                {t}
              </label>
            ))}
          </section>
          <section className="card">
            <h2>จังหวัด</h2>
            <label>
              <span className="sr-only">เลือกจังหวัด</span>
              <select value={province} onChange={(e) => setProvince(e.target.value)}>
                <option value="">ทุกจังหวัด</option>
                {provinces.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </section>
          <section className="card net-me">
            <CompanyLogo id={ctx.company.id} name={ctx.company.name} logo={logo} />
            <span>
              <strong>{ctx.company.name}</strong>
              <button className="text-button" onClick={() => navigate("company")}>
                แก้ไขหน้าบริษัทเรา
              </button>
            </span>
          </section>
        </aside>

        <section className="net-main" aria-label="อัปเดตล่าสุด">
          {error && <p className="form-error">{error}</p>}
          {!posts ? (
            <section className="card">
              <Loading />
            </section>
          ) : shown.length ? (
            <div className="net-grid">
              {shown.map((p) => (
                <UpdateCard
                  key={p.id}
                  post={p}
                  ctx={ctx}
                  notify={notify}
                  onFollow={() => follow(p.company_id)}
                  onChange={(patch) => update(p.id, patch)}
                  onDelete={() => setPosts((list) => list?.filter((x) => x.id !== p.id) || null)}
                />
              ))}
            </div>
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
              className="secondary net-more"
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

        <aside className="net-side">
          <section className="card net-chances">
            <h2>
              <Sparkles size={17} />
              โอกาสที่อาจเหมาะกับคุณ
            </h2>
            {chances.length ? (
              chances.map((c) => (
                <button key={c.id} onClick={() => navigate("jobs")}>
                  <strong>{headline(c)}</strong>
                  <small>
                    {kindLabel[c.kind]} · {c.company.name}
                    {myIndustry && c.company.industry === myIndustry ? " · ธุรกิจประเภทเดียวกับคุณ" : ""}
                  </small>
                </button>
              ))
            ) : (
              <p className="muted">ยังไม่มีประกาศงานหรือหาพาร์ทเนอร์จากบริษัทอื่น</p>
            )}
          </section>
          <section className="card">
            <h2>บริษัทแนะนำ</h2>
            {suggest.length ? (
              suggest.map((c) => (
                <div className="net-suggest" key={c.id}>
                  <CompanyLogo id={c.id} name={c.name} logo={c.has_logo} size={38} />
                  <span>
                    <strong>{c.name}</strong>
                    <small>{c.industry || "บริษัทในเครือข่าย"}</small>
                  </span>
                  <button className="secondary" onClick={() => follow(c.id)}>
                    ติดตาม
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">ติดตามครบทุกบริษัทที่มีอัปเดตแล้ว</p>
            )}
          </section>
        </aside>
      </div>

      {composing && (
        <Composer
          ctx={ctx}
          onClose={() => setComposing(false)}
          onPosted={(kind) => {
            setComposing(false);
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

function UpdateCard({
  post: p,
  ctx,
  notify,
  onFollow,
  onChange,
  onDelete,
}: {
  post: FeedPost;
  ctx: Context;
  notify: (s: string) => void;
  onFollow: () => void;
  onChange: (patch: Partial<FeedPost>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false),
    [comment, setComment] = useState(""),
    [sending, setSending] = useState(false),
    inputRef = useRef<HTMLInputElement>(null);
  const ask = (text = "") => {
    setOpen(true);
    if (text) setComment(text);
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
  return (
    <article className={"net-card " + p.kind}>
      {p.images.length > 0 && (
        <a className="net-cover" href={"/api/feed/image/" + p.images[0]} target="_blank" rel="noreferrer">
          <img src={"/api/feed/image/" + p.images[0]} alt={`รูปจาก ${p.company.name}`} loading="lazy" />
          {p.images.length > 1 && <span>+{p.images.length - 1} รูป</span>}
        </a>
      )}
      <div className="net-card-body">
        <div className="net-card-top">
          <span className={"net-type " + p.kind}>{kindLabel[p.kind]}</span>
          <span className="muted">{since(p.created_at)}</span>
          {p.can_delete && (
            <button
              className="icon-button"
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
        </div>
        <h3>{headline(p)}</h3>
        {p.kind !== "post" && (p.meta.location || p.meta.budget) ? (
          <dl className="net-facts">
            {p.meta.location && (
              <>
                <dt>สถานที่</dt>
                <dd>{p.meta.location}</dd>
              </>
            )}
            {p.meta.budget && (
              <>
                <dt>{p.kind === "job" ? "ค่าจ้าง" : "งบประมาณ"}</dt>
                <dd>{p.meta.budget}</dd>
              </>
            )}
          </dl>
        ) : null}
        {excerpt(p) && <p className="net-excerpt">{excerpt(p)}</p>}
        <div className="net-company">
          <CompanyLogo id={p.company_id} name={p.company.name} logo={p.company.has_logo} size={30} />
          <span>
            <strong>{p.company.name}</strong>
            <small>{[p.company.industry, p.company.province].filter(Boolean).join(" · ")}</small>
          </span>
          {!p.mine && (
            <button className={"net-follow" + (p.following ? " on" : "")} onClick={onFollow}>
              {p.following ? <Check size={13} /> : <Plus size={13} />}
              {p.following ? "ติดตามแล้ว" : "ติดตาม"}
            </button>
          )}
        </div>
      </div>
      <div className="net-card-foot">
        {p.kind === "post" || p.mine ? (
          <button className={"secondary" + (p.liked ? " selected" : "")} aria-pressed={p.liked} onClick={interest}>
            สนใจ{p.likes ? ` · ${p.likes}` : ""}
          </button>
        ) : (
          <button
            className={"primary net-cta " + p.kind}
            onClick={() => {
              if (!p.liked) interest();
              ask(p.kind === "job" ? "สนใจตำแหน่งนี้ ขอรายละเอียดเพิ่มเติม" : "บริษัทเราสนใจร่วมงาน ขอรายละเอียดเพิ่มเติม");
            }}
          >
            {p.kind === "job" ? "สนใจสมัครงานนี้" : "เสนอตัวเป็นพาร์ทเนอร์"}
          </button>
        )}
        <button className={"secondary" + (open ? " selected" : "")} aria-expanded={open} onClick={() => setOpen(!open)}>
          ถามตอบ{p.comment_count ? ` · ${p.comment_count}` : ""}
        </button>
      </div>
      {open && (
        <div className="net-thread">
          {p.comment_count > p.comments.length && (
            <small className="muted">แสดง {p.comments.length} ข้อความล่าสุดจาก {p.comment_count}</small>
          )}
          {p.comments.map((c) => (
            <div className="net-reply" key={c.id}>
              <strong>
                {c.company_name}
                <small> · {c.author_name}</small>
              </strong>
              <p>{c.body}</p>
            </div>
          ))}
          {!p.comments.length && <small className="muted">ยังไม่มีคำถาม เริ่มถามได้เลย</small>}
          {ctx.member.role !== "viewer" && (
            <form
              className="net-reply-form"
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
              <label className="sr-only" htmlFor={"reply-" + p.id}>
                เขียนคำถามหรือคำตอบ
              </label>
              <input
                id={"reply-" + p.id}
                ref={inputRef}
                maxLength={2000}
                placeholder={`ถามในนาม ${ctx.company.name}`}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button className="primary" aria-label="ส่ง" disabled={sending || !comment.trim()}>
                <Send size={15} />
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
