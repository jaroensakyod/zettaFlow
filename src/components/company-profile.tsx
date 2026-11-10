"use client";
// A company's page in the business network (ours or another company's): cover, logo, and three tabs — ทั้งหมด
// (updates), สินค้าและบริการ (active packages, if the company shows them) and เกี่ยวกับ (company facts; on our own
// page the full editable company form with public/private switches). Also the บริษัท page of the top menu.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Globe,
  MessageCircle,
  Pencil,
  Plus,
  Users,
  Info,
  CalendarDays,
  MapPin,
  Building2,
  PenSquare,
  Camera,
  Package,
  LayoutGrid,
  Lock,
  Phone,
  Mail,
  Hash,
  Users2,
  Settings2,
} from "lucide-react";
import type { Context, FeedPost } from "@/lib/types";
import type { CompanyProduct, CompanyProfile, FollowRow } from "@/lib/feed";
import { api, Empty, Loading, money } from "./shared";
import { CompanyLogo, PostCard, lineLink } from "./feed";
import { CompanySettings, saveCompanyImage } from "./settings";

type Tab = "all" | "products" | "about" | "followers" | "following";
const tabs: [Tab, string, typeof Users][] = [
  ["all", "ทั้งหมด", LayoutGrid],
  ["products", "สินค้าและบริการ", Package],
  ["about", "เกี่ยวกับ", Info],
];
/** Old links used ?tab=posts. */
const tabOf = (t: string | null): Tab =>
  t && ["all", "products", "about", "followers", "following"].includes(t) ? (t as Tab) : "all";
const joinedText = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
const external = (url: string) => (/^https?:\/\//i.test(url) ? url : "https://" + url);

export function CompanyProfilePage({
  ctx,
  notify,
  navigate,
  changed,
  home = false,
  aboutExtra,
}: {
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
  /** Reloads the workspace (company profile in ctx) after a new logo, cover or company details are saved. */
  changed?: () => void;
  /** Opened as บริษัท from the top menu (our own page, no "back to the network" link). */
  home?: boolean;
  /** Extra cards under our own เกี่ยวกับ tab (e.g. demo sample data). */
  aboutExtra?: ReactNode;
}) {
  const params = useSearchParams(),
    id = params.get("id") || ctx.company.id,
    [profile, setProfile] = useState<CompanyProfile | null>(null),
    [tab, setTab] = useState<Tab>(tabOf(params.get("tab"))),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState<"" | "logo" | "cover">(""),
    // New pictures show at once (the logo/cover URLs are cached by the browser for a few minutes).
    [fresh, setFresh] = useState<{ logo?: string; cover?: string }>({});
  const load = useCallback(() => {
    api("/feed/profile/" + id)
      .then((p: CompanyProfile) => {
        setProfile(p);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => {
    setProfile(null);
    setTab(tabOf(params.get("tab")));
    load();
  }, [load, params]);
  const open = (companyId: string) => navigate(companyId === ctx.company.id ? "profile" : "profile?id=" + companyId);
  const follow = async () => {
    if (!profile) return;
    try {
      const { following } = await api("/feed/follow/" + profile.id, { method: "POST" });
      setProfile({ ...profile, following, followers: profile.followers + (following ? 1 : -1) });
      notify(following ? "ติดตามบริษัทแล้ว" : "เลิกติดตามแล้ว");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const changeImage = async (kind: "logo" | "cover", file?: File) => {
    if (!file) return;
    setUploading(kind);
    try {
      const url = await saveCompanyImage(ctx, kind, file);
      setFresh((f) => ({ ...f, [kind]: url }));
      setProfile((p) => (p ? { ...p, [kind === "logo" ? "has_logo" : "has_cover"]: true } : p));
      notify(kind === "logo" ? "เปลี่ยนโลโก้แล้ว" : "เปลี่ยนรูปปกแล้ว");
      changed?.();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUploading("");
    }
  };
  const picker = (kind: "logo" | "cover") => (
    <input
      type="file"
      accept="image/png,image/jpeg,image/webp"
      className="sr-only"
      onChange={(e) => {
        changeImage(kind, e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );
  if (error) return <section className="card"><Empty title="เปิดหน้าบริษัทไม่ได้" description={error} /></section>;
  if (!profile) return <section className="card"><Loading /></section>;
  const p = profile,
    line = p.line ? lineLink(p.line) : "",
    viewer = ctx.member.role === "viewer",
    // Only the owner may change the company profile (save_company).
    canEdit = p.mine && ctx.member.role === "owner",
    coverSrc = fresh.cover || (p.has_cover ? "/api/feed/cover/" + p.id : ""),
    logoSrc: boolean | string = fresh.logo || (p.mine ? String(ctx.company.profile.logo || "") || p.has_logo : p.has_logo);
  return (
    <div className="cp">
      {!home && (
        <button className="cp-back" onClick={() => navigate("feed")}>
          <ArrowLeft size={16} /> เครือข่ายธุรกิจ
        </button>
      )}
      <section className="card cp-hero">
        <div className={"cp-cover" + (coverSrc ? "" : " empty")} style={coverSrc ? { backgroundImage: `url("${coverSrc}")` } : undefined}>
          {canEdit && (
            <label className={"cp-cover-edit" + (uploading === "cover" ? " busy" : "")}>
              <Camera size={16} /> {uploading === "cover" ? "กำลังอัปโหลด…" : coverSrc ? "เปลี่ยนรูปปก" : "เพิ่มรูปปก"}
              {picker("cover")}
            </label>
          )}
        </div>
        <div className="cp-head">
          <span className="cp-logo">
            <CompanyLogo id={p.id} name={p.name} logo={logoSrc} size={112} />
            {canEdit && (
              <label className={"cp-logo-edit" + (uploading === "logo" ? " busy" : "")} title="เปลี่ยนโลโก้" aria-label="เปลี่ยนโลโก้">
                <Camera size={16} />
                {picker("logo")}
              </label>
            )}
          </span>
          <div className="cp-title">
            <h1>{p.name}</h1>
            {p.name_en && <p className="cp-en">{p.name_en}</p>}
            {p.bio ? (
              <p className="cp-bio">{p.bio}</p>
            ) : (
              canEdit && (
                <button className="cp-bio-add" onClick={() => setTab("about")}>
                  <Plus size={14} /> เพิ่ม Bio สั้นๆ ใต้ชื่อบริษัท
                </button>
              )
            )}
            <p className="cp-meta">
              {p.industry && (
                <span>
                  <Building2 size={14} /> {p.industry}
                </span>
              )}
              {p.province && (
                <span>
                  <MapPin size={14} /> {p.province}
                </span>
              )}
              <span>
                <CalendarDays size={14} /> เข้าร่วมเมื่อ {joinedText(p.joined)}
              </span>
            </p>
            <p className="cp-counts">
              <button onClick={() => setTab("all")}>
                <b>{p.posts.toLocaleString()}</b> อัปเดต
              </button>
              <button onClick={() => setTab("followers")}>
                <b>{p.followers.toLocaleString()}</b> ผู้ติดตาม
              </button>
              <button onClick={() => setTab("following")}>
                <b>{p.following_count.toLocaleString()}</b> กำลังติดตาม
              </button>
              {p.follows_us && !p.mine && <em className="cp-follows-us">ติดตามคุณอยู่</em>}
            </p>
          </div>
          <div className="cp-actions">
            {p.mine ? (
              <>
                <button className="primary" onClick={() => navigate("feed")} disabled={viewer}>
                  <PenSquare size={16} /> ลงอัปเดต
                </button>
                <button className="secondary" onClick={() => setTab("about")}>
                  <Pencil size={16} /> แก้ไขข้อมูลบริษัท
                </button>
              </>
            ) : (
              <>
                <button className={p.following ? "secondary" : "primary"} onClick={follow} disabled={viewer}>
                  {p.following ? <Check size={16} /> : <Plus size={16} />}
                  {p.following ? "ติดตามแล้ว" : "ติดตาม"}
                </button>
                <button className="secondary" onClick={() => navigate("chat?with=" + p.id)}>
                  <MessageCircle size={16} /> ส่งข้อความ
                </button>
              </>
            )}
          </div>
        </div>
        <nav className="cp-tabs" aria-label="เมนูหน้าบริษัท">
          {tabs.map(([key, label, Ico]) => (
            <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key} onClick={() => setTab(key)}>
              <Ico size={16} /> {label}
              {key === "products" && !!p.products?.length && <span className="cp-tab-count">{p.products.length}</span>}
            </button>
          ))}
        </nav>
      </section>

      {tab === "all" || tab === "followers" || tab === "following" ? (
        <div className="cp-body">
          <aside className="cp-side">
            <section className="card cp-card">
              <h2>เกี่ยวกับ</h2>
              {p.about ? <p className="cp-about clamp">{p.about}</p> : <p className="muted">{p.mine ? "ยังไม่ได้เขียนแนะนำบริษัท — เพิ่มได้ที่แท็บ เกี่ยวกับ" : "ยังไม่มีคำแนะนำบริษัท"}</p>}
              <Channels p={p} line={line} />
              <button className="cp-more" onClick={() => setTab("about")}>
                ดูข้อมูลบริษัททั้งหมด
              </button>
            </section>
            {!!p.products?.length && (
              <section className="card cp-card">
                <h2>สินค้าและบริการ</h2>
                <ul className="cp-mini-products">
                  {p.products.slice(0, 4).map((x) => (
                    <li key={x.id}>
                      <span>{x.name}</span>
                      <b>฿{money(x.price)}</b>
                    </li>
                  ))}
                </ul>
                <button className="cp-more" onClick={() => setTab("products")}>
                  ดูทั้งหมด {p.products.length} รายการ
                </button>
              </section>
            )}
          </aside>
          <main className="cp-main">
            {tab === "all" && <CompanyPosts ctx={ctx} id={p.id} name={p.name} notify={notify} navigate={navigate} mine={p.mine} />}
            {(tab === "followers" || tab === "following") && (
              <FollowList ctx={ctx} id={p.id} dir={tab} name={p.name} mine={p.mine} notify={notify} open={open} />
            )}
          </main>
        </div>
      ) : tab === "products" ? (
        <Products p={p} navigate={navigate} setTab={setTab} />
      ) : p.mine ? (
        <div className="cp-about-edit">
          <CompanySettings
            embedded
            ctx={ctx}
            notify={notify}
            changed={() => {
              changed?.();
              load();
            }}
          />
          {aboutExtra}
        </div>
      ) : (
        <AboutView p={p} line={line} />
      )}
    </div>
  );
}

const typeTone: Record<string, string> = { แพ็กเกจ: "violet", สินค้า: "blue", บริการ: "green" };
function Products({ p, navigate, setTab }: { p: CompanyProfile; navigate: (v: string) => void; setTab: (t: Tab) => void }) {
  const list: CompanyProduct[] = p.products || [];
  const shown = p.mine && (p.visibility || "").split(",").includes("products");
  const known = ["แพ็กเกจ", "สินค้า", "บริการ"];
  const groups: [string, CompanyProduct[]][] = known.map((t) => [t, list.filter((x) => (x.type || "สินค้า") === t)] as [string, CompanyProduct[]]);
  const other = list.filter((x) => !known.includes(x.type || "สินค้า"));
  if (other.length) groups.push(["อื่นๆ", other]);
  return (
    <div className="cp-products">
      {p.mine && (
        <section className={"card cp-products-bar" + (shown ? " pub" : "")}>
          {shown ? <Globe size={18} /> : <Lock size={18} />}
          <span>
            <b>{shown ? "บริษัทอื่นในเครือข่ายเห็นรายการนี้" : "ตอนนี้เป็นส่วนตัว เห็นเฉพาะทีมของคุณ"}</b>
            <small>เปลี่ยนได้ที่แท็บ เกี่ยวกับ › ใครเห็นข้อมูลบริษัท</small>
          </span>
          <button className="secondary" onClick={() => setTab("about")}>
            <Settings2 size={15} /> ตั้งค่าการมองเห็น
          </button>
          <button className="primary" onClick={() => navigate("sales_packages")}>
            <Package size={15} /> จัดการสินค้า & แพ็กเกจ
          </button>
        </section>
      )}
      {!list.length ? (
        <section className="card">
          <Empty
            title={p.mine ? "ยังไม่มีสินค้าหรือแพ็กเกจที่เปิดขาย" : "ไม่มีสินค้าและบริการที่แสดง"}
            description={p.mine ? "เพิ่มได้ที่ ฝ่ายขาย › สินค้า & แพ็กเกจ แล้วจะขึ้นที่นี่อัตโนมัติ" : "บริษัทนี้ยังไม่ได้เปิดให้ดูรายการสินค้าและบริการ"}
          />
        </section>
      ) : (
        groups
          .filter(([, items]) => items.length)
          .map(([type, items]) => (
            <section key={type} className="cp-product-group">
              <h3>
                {type} <small>{items.length} รายการ</small>
              </h3>
              <div className="cp-product-grid">
                {items.map((x) => (
                  <article key={x.id} className={"card cp-product tone-" + (typeTone[type] || "violet")}>
                    <span className="cp-product-type">{type}</span>
                    <h4>{x.name}</h4>
                    {x.code && <small className="cp-product-code">{x.code}</small>}
                    {x.description && <p>{x.description}</p>}
                    <b className="cp-product-price">฿{money(x.price)}</b>
                  </article>
                ))}
              </div>
            </section>
          ))
      )}
    </div>
  );
}

/** Another company's เกี่ยวกับ tab: only the sections it made public. */
function AboutView({ p, line }: { p: CompanyProfile; line: string }) {
  const d = p.details || {};
  const row = (icon: ReactNode, label: string, value?: string) =>
    value ? (
      <div className="cp-fact" key={label}>
        {icon}
        <span>
          <small>{label}</small>
          <b>{value}</b>
        </span>
      </div>
    ) : null;
  const main = [
    row(<Building2 size={16} />, "ประเภทธุรกิจ", p.industry),
    row(<Users2 size={16} />, "จำนวนพนักงาน", d.employees),
    row(<CalendarDays size={16} />, "วันที่ก่อตั้ง", d.founded ? new Date(d.founded).toLocaleDateString("th-TH", { dateStyle: "long" }) : ""),
    row(<Hash size={16} />, "เลขประจำตัวผู้เสียภาษี", d.taxId),
    row(<Info size={16} />, "ประเภทนิติบุคคล", d.legal),
    row(<CalendarDays size={16} />, "เข้าร่วม EliteFlow", joinedText(p.joined)),
  ].filter(Boolean);
  const address = [row(<MapPin size={16} />, "จังหวัด", p.province), row(<MapPin size={16} />, "ที่อยู่", [d.address, d.zip].filter(Boolean).join(" "))].filter(Boolean);
  const contact = [row(<Phone size={16} />, "โทรศัพท์", d.phone), row(<Mail size={16} />, "อีเมล", d.email)].filter(Boolean);
  const hasChannels = !!(p.website || p.facebook || line);
  return (
    <div className="cp-about-view">
      <section className="card cp-card">
        <h2>เกี่ยวกับ {p.name}</h2>
        {p.name_en && <p className="cp-en">{p.name_en}</p>}
        {p.about ? <p className="cp-about">{p.about}</p> : <p className="muted">ยังไม่มีคำแนะนำบริษัท</p>}
        <div className="cp-fact-grid">{main}</div>
      </section>
      <div className="cp-about-cols">
        <section className="card cp-card">
          <h2>ที่อยู่</h2>
          {address.length > 1 ? <div className="cp-fact-grid one">{address}</div> : <>{address}<Private /></>}
        </section>
        <section className="card cp-card">
          <h2>ช่องทางติดต่อ</h2>
          {contact.length || hasChannels ? (
            <>
              {!!contact.length && <div className="cp-fact-grid one">{contact}</div>}
              <Channels p={p} line={line} />
            </>
          ) : (
            <Private />
          )}
        </section>
      </div>
    </div>
  );
}
const Private = () => (
  <p className="cp-private">
    <Lock size={14} /> บริษัทนี้ตั้งข้อมูลส่วนนี้เป็นส่วนตัว
  </p>
);

function Channels({ p, line }: { p: CompanyProfile; line: string }) {
  if (!p.website && !p.facebook && !line) return null;
  return (
    <ul className="cp-channels">
      {p.website && (
        <li>
          <Globe size={15} />
          <a href={external(p.website)} target="_blank" rel="noopener noreferrer">
            {p.website.replace(/^https?:\/\//, "")}
          </a>
        </li>
      )}
      {p.facebook && (
        <li>
          <span className="cp-fb" aria-hidden>
            f
          </span>
          <a href={external(p.facebook)} target="_blank" rel="noopener noreferrer">
            Facebook
          </a>
        </li>
      )}
      {line && (
        <li>
          <span className="cp-line" aria-hidden>
            LINE
          </span>
          <a href={line} target="_blank" rel="noopener noreferrer">
            {p.line}
          </a>
        </li>
      )}
    </ul>
  );
}

function CompanyPosts({
  ctx,
  id,
  name,
  notify,
  navigate,
  mine,
}: {
  ctx: Context;
  id: string;
  name: string;
  notify: (s: string) => void;
  navigate: (v: string) => void;
  mine: boolean;
}) {
  const [posts, setPosts] = useState<FeedPost[] | null>(null),
    [more, setMore] = useState(false);
  const load = useCallback(
    async (before?: string) => {
      const rows: FeedPost[] = await api(`/feed?filter=${encodeURIComponent("company:" + id)}` + (before ? "&before=" + encodeURIComponent(before) : ""));
      setMore(rows.length === 20);
      setPosts((old) => (before && old ? [...old, ...rows] : rows));
    },
    [id],
  );
  useEffect(() => {
    setPosts(null);
    load().catch((e) => notify((e as Error).message));
  }, [load, notify]);
  const update = (pid: string, patch: Partial<FeedPost>) => setPosts((l) => l?.map((x) => (x.id === pid ? { ...x, ...patch } : x)) || null);
  if (!posts) return <section className="card"><Loading /></section>;
  if (!posts.length)
    return (
      <section className="card">
        <Empty
          title={mine ? "บริษัทของคุณยังไม่มีอัปเดต" : `${name} ยังไม่มีอัปเดต`}
          description={mine ? "ลงอัปเดตแรก เช่น ผลงาน สินค้าใหม่ หรือประกาศงาน ให้บริษัทอื่นในเครือข่ายเห็น" : "กดติดตามไว้ แล้วอัปเดตใหม่จะขึ้นในหน้าเครือข่ายธุรกิจของคุณ"}
        />
      </section>
    );
  return (
    <div className="cp-posts">
      {posts.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          ctx={ctx}
          notify={notify}
          navigate={navigate}
          onFollow={async () => {
            try {
              const { following } = await api("/feed/follow/" + p.company_id, { method: "POST" });
              setPosts((l) => l?.map((x) => ({ ...x, following })) || null);
            } catch (e) {
              notify((e as Error).message);
            }
          }}
          onMessage={p.mine ? undefined : () => navigate(`chat?with=${p.company_id}&post=${p.id}`)}
          onChange={(patch) => update(p.id, patch)}
          onDelete={() => setPosts((l) => l?.filter((x) => x.id !== p.id) || null)}
        />
      ))}
      {more && (
        <button className="secondary li-more" onClick={() => load(posts[posts.length - 1].created_at).catch((e) => notify((e as Error).message))}>
          ดูอัปเดตก่อนหน้า
        </button>
      )}
    </div>
  );
}

function FollowList({
  ctx,
  id,
  dir,
  name,
  mine,
  notify,
  open,
}: {
  ctx: Context;
  id: string;
  dir: "followers" | "following";
  name: string;
  mine: boolean;
  notify: (s: string) => void;
  open: (id: string) => void;
}) {
  const [rows, setRows] = useState<FollowRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    api(`/feed/follows/${id}?dir=${dir}`)
      .then(setRows)
      .catch((e) => notify((e as Error).message));
  }, [id, dir, notify]);
  const follow = async (cid: string) => {
    try {
      const { following } = await api("/feed/follow/" + cid, { method: "POST" });
      setRows((l) => l?.map((c) => (c.id === cid ? { ...c, following } : c)) || null);
      notify(following ? "ติดตามบริษัทแล้ว" : "เลิกติดตามแล้ว");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const title = dir === "followers" ? (mine ? "บริษัทที่ติดตามคุณ" : `ผู้ติดตาม ${name}`) : mine ? "บริษัทที่คุณติดตาม" : `${name} กำลังติดตาม`;
  return (
    <section className="card cp-card">
      <h2>
        {title} {rows && <small>({rows.length})</small>}
      </h2>
      {!rows ? (
        <Loading />
      ) : rows.length ? (
        <ul className="cp-follow-list">
          {rows.map((c) => (
            <li key={c.id}>
              <button className="cp-follow-who" onClick={() => open(c.id)}>
                <CompanyLogo id={c.id} name={c.name} logo={c.has_logo} size={44} />
                <span>
                  <strong>{c.name}</strong>
                  <small>{[c.industry || "บริษัทในเครือข่าย", c.province].filter(Boolean).join(" · ")}</small>
                  <small>ตั้งแต่ {new Date(c.since).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}</small>
                </span>
              </button>
              {!c.mine && (
                <button className={"li-follow-pill" + (c.following ? " on" : "")} onClick={() => follow(c.id)} disabled={ctx.member.role === "viewer"}>
                  {c.following ? <Check size={14} /> : <Plus size={14} />}
                  {c.following ? "ติดตามแล้ว" : "ติดตาม"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          title={dir === "followers" ? "ยังไม่มีผู้ติดตาม" : "ยังไม่ได้ติดตามบริษัทไหน"}
          description={dir === "followers" ? "ลงอัปเดตสม่ำเสมอ บริษัทอื่นจะเห็นและกดติดตาม" : "ไปที่เครือข่ายธุรกิจ แล้วกดติดตามบริษัทที่สนใจ"}
        />
      )}
    </section>
  );
}
