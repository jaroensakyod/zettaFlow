"use client";
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
  Megaphone,
  Link2,
  ArrowRight,
  Heart,
  Eye,
  Bookmark,
  MoreHorizontal,
  ChevronLeft,
  Bell,
  Inbox,
  UserPlus,
  MessageCircle,
  CircleCheck,
  Info,
  Building2,
  LayoutGrid,
  Rss,
  Users,
  type LucideIcon,
} from "lucide-react";
import { businessGroupOf, businessTypeGroups, industryMatches } from "@/lib/catalog";
import { FEED_MAX_IMAGES } from "@/lib/types";
import type { Context, FeedAlert, FeedComment, FeedKind, FeedPost, FeedSuggestion, NetworkCompany } from "@/lib/types";
import { api, Empty, Loading, Modal } from "./shared";
import type { Promo } from "@/lib/engage";
import type { FeedAd } from "@/lib/ads";
import { AdCard } from "./ad-card";
import { OnlineDot, useCompanyOnline } from "./presence";
import { IndustryPicker, industryLabel } from "./industry-picker";
import { PostMock, SampleFeed, sampleAds, sampleLogo, samplePosts, sampleSuggest } from "./feed-samples";

/** Every this many posts the feed shows one sponsored card. */
const AD_EVERY = 5;

const tabs = [
  ["all", "ทั้งหมด"],
  ["post", "ข่าว & ผลงาน"],
  ["job", "ประกาศงาน"],
  ["partner", "หาพาร์ทเนอร์"],
  ["following", "บริษัทที่ติดตาม"],
  ["mine", "ของบริษัทเรา"],
  ["saved", "ที่บันทึกไว้"],
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
// Re-encodes a photo as WebP of at most ~400 KB (1600px, smaller if needed), so 10 photos fit one upload (4.5 MB).
const PHOTO_BYTES = 400000;
async function shrink(file: File) {
  const bitmap = await createImageBitmap(file),
    canvas = document.createElement("canvas");
  for (const side of [1600, 1280, 1024]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
      if (blob && blob.size <= PHOTO_BYTES) return blob;
    }
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
/** Workspace view of a company's page in the network (our own page has no id). */
export const profileView = (companyId: string, ctx: Context) => (companyId === ctx.company.id ? "profile" : "profile?id=" + companyId);

export function CompanyLogo({ id, name, logo, size = 40 }: { id: string; name: string; logo: boolean | string; size?: number }) {
  const src = typeof logo === "string" ? logo : logo ? "/api/feed/logo/" + id : "";
  const on = useCompanyOnline(id);
  return (
    <OnlineDot on={on} size={size}>
      {src ? (
        <img className="net-logo" src={src} alt="" width={size} height={size} />
      ) : (
        <span className="net-logo" style={{ width: size, height: size, background: tint(id), fontSize: size / 2.8 }}>
          {initials(name)}
        </span>
      )}
    </OnlineDot>
  );
}

type AlertGroup = "all" | FeedAlert["kind"] | "system";
type AlertItem = { group: AlertGroup; key: string; at: string; who: string; title: string; status?: string; url?: string; thread?: string };
const alertGroups: [AlertGroup, string, typeof ImageIcon, string][] = [
  ["all", "ทั้งหมด", Inbox, "#7c3aed"],
  ["interest", "ผู้สนใจติดต่อ", Handshake, "#f97316"],
  ["reply", "การตอบรับงาน", CircleCheck, "#16a34a"],
  ["message", "ข้อความใหม่", MessageCircle, "#0ea5e9"],
  ["network", "คำขอเข้าร่วมเครือข่าย", UserPlus, "#ec4899"],
  ["system", "ระบบและประกาศ", Info, "#6366f1"],
];
/** Small rounded tile with a coloured icon (left menus of the network page). */
const Tile = ({ icon: Icon, c }: { icon: LucideIcon; c: string }) => (
  <i className="li-ic" style={{ "--c": c } as CSSProperties} aria-hidden>
    <Icon size={15} />
  </i>
);
const tabIcons: Record<string, [LucideIcon, string]> = {
  all: [LayoutGrid, "#7c3aed"],
  post: [Newspaper, "#0ea5e9"],
  job: [BriefcaseBusiness, "#f97316"],
  partner: [Handshake, "#16a34a"],
  following: [Rss, "#ec4899"],
  mine: [Building2, "#6366f1"],
  saved: [Bookmark, "#eab308"],
};
const alertLine = (a: AlertItem) =>
  a.group === "interest"
    ? a.who + " สนใจติดต่อประกาศของคุณ"
    : a.group === "reply"
      ? a.who + (a.status === "shortlisted" ? " ตอบรับข้อเสนอของคุณ" : " ปฏิเสธข้อเสนอของคุณ")
      : a.group === "message"
        ? a.who + (a.thread ? " ส่งข้อความถึงบริษัทของคุณ" : " แสดงความคิดเห็นในโพสต์ของคุณ")
        : a.group === "network"
          ? a.who + " เริ่มติดตามบริษัทของคุณ"
          : "ประกาศจาก EliteFlow";
/** LINE add-friend link from a company's LINE ID (@oa, personal ID, or a line.me / lin.ee link). */
export const lineLink = (id: string) => {
  const v = id.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return /^https:\/\/(line\.me|lin\.ee)\//i.test(v) ? v : "";
  return "https://line.me/R/ti/p/" + (v.startsWith("@") ? "@" + encodeURIComponent(v.slice(1)) : "~" + encodeURIComponent(v));
};

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
    [ads, setAds] = useState<FeedAd[]>([]),
    [discover, setDiscover] = useState<FeedPost[]>([]),
    [search, setSearch] = useState(""),
    [industry, setIndustry] = useState(""),
    [composing, setComposing] = useState<FeedKind | null>(null),
    [alerts, setAlerts] = useState<FeedAlert[]>([]),
    [chatUnread, setChatUnread] = useState(0),
    [showAll, setShowAll] = useState(false),
    [promos, setPromos] = useState<Promo[]>([]),
    [alertsOpen, setAlertsOpen] = useState<AlertGroup | null>(null),
    [seen, setSeen] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const seenKey = "feed-seen:" + ctx.company.id + ":" + ctx.user.id;
  useEffect(() => {
    try {
      setSeen(JSON.parse(localStorage.getItem(seenKey) || "{}"));
    } catch {
      setSeen({});
    }
  }, [seenKey]);
  // Alerts the person has not opened yet, per group.
  const alertItems: AlertItem[] = [
    ...alerts.map((a) => ({ group: a.kind as AlertGroup, key: a.kind + a.id + a.at, at: a.at, who: a.who, title: a.title, status: a.status, thread: a.thread_id })),
    ...promos.map((x) => ({ group: "system" as AlertGroup, key: "system" + x.id, at: x.starts_at || "", who: "EliteFlow", title: x.title, url: x.cta_url })),
  ];
  const unseen = (g: AlertGroup) =>
    alertItems.filter((a) => (g === "all" || a.group === g) && a.at > (seen[a.group] || "")).length;
  const openAlerts = (g: AlertGroup) => {
    setAlertsOpen(g);
    const now = new Date().toISOString(),
      next = { ...seen, ...Object.fromEntries((g === "all" ? alertGroups.slice(1).map(([k]) => k) : [g]).map((k) => [k, now])) };
    setSeen(next);
    try {
      localStorage.setItem(seenKey, JSON.stringify(next));
    } catch {}
  };
  // One view per post that scrolled into sight, sent in small batches.
  const viewed = useRef(new Set<string>()),
    pending = useRef(new Set<string>()),
    flush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sawPost = useCallback((id: string) => {
    if (viewed.current.has(id)) return;
    viewed.current.add(id);
    pending.current.add(id);
    if (flush.current) return;
    flush.current = setTimeout(() => {
      const posts = [...pending.current];
      pending.current.clear();
      flush.current = null;
      api("/feed/views", { method: "POST", body: { posts } }).catch(() => {});
    }, 2500);
  }, []);
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
    api("/feed/alerts").then(setAlerts).catch(() => {});
    api("/b2b/unread").then((r: { unread: number }) => setChatUnread(r.unread)).catch(() => {});
    api("/feed?filter=offers")
      .then((rows: FeedPost[]) => setChances(rows.filter((x) => !x.mine).slice(0, 3)))
      .catch(() => {});
    // Company ads (bought with coins) first, then the EliteFlow team's feed promotions.
    Promise.all([
      api("/ads/live").catch(() => [] as FeedAd[]),
      fetch("/api/public-content", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { promos: [] }))
        .then((d: { promos?: Promo[] }) => (d.promos || []).filter((x) => x.placement === "feed" || x.placement === "both"))
        .catch(() => [] as Promo[]),
    ]).then(([bought, promos]: [FeedAd[], Promo[]]) => {
      setPromos(promos);
      setAds([...bought, ...promos.map((x) => ({ id: x.id, title: x.title, body: x.body, cta_label: x.cta_label, cta_url: x.cta_url, tone: x.tone }))]);
      // One view per company ad per load (the database keeps one per company per day).
      for (const a of bought) api(`/ads/${a.id}/track`, { method: "POST", body: { kind: "view" } }).catch(() => {});
    });
  }, []);
  const adClick = (a: FeedAd) => () => {
    if (a.company_id) api(`/ads/${a.id}/track`, { method: "POST", body: { kind: "click" } }).catch(() => {});
  };
  // บริษัทที่ติดตาม: below the followed companies' posts, suggest posts from companies not followed yet
  // (same business type first) so the tab is never a dead end.
  useEffect(() => {
    if (tab !== "following") return;
    const mine = String(ctx.company.profile.industry || "");
    api("/feed?filter=all")
      .then((rows: FeedPost[]) =>
        setDiscover(
          rows
            .filter((x) => !x.mine && !x.following)
            .sort((a, b) => Number(b.company.industry === mine && !!mine) - Number(a.company.industry === mine && !!mine))
            .slice(0, 5),
        ),
      )
      .catch(() => setDiscover([]));
  }, [tab, ctx.company.profile.industry]);
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
    myIndustry = String(profile.industry || ""),
    q = search.trim().toLowerCase(),
    // A chosen business type shows its own posts first, then the rest of its main group (หมวดหลัก).
    mainGroup = industry.startsWith("group:") ? industry.slice(6) : industry ? businessGroupOf(industry) : "",
    inScope = (type: string) => !industry || industryMatches(industry, type) || (!!mainGroup && businessGroupOf(type) === mainGroup),
    shown = (posts || [])
      .filter(
        (p) =>
          inScope(p.company.industry) &&
          (!q || [p.company.name, p.meta.title || "", p.body].join(" ").toLowerCase().includes(q)),
      )
      .sort((a, b) => Number(b.company.industry === industry) - Number(a.company.industry === industry)),
    writer = ctx.member.role !== "viewer",
    // Sample posts, ads and suggestions only in the public demo; real companies see the real network only.
    samples = ctx.demo && !q && ["all", "post", "job", "partner"].includes(tab) ? samplePosts.filter((x) => (tab === "all" || x.kind === tab) && inScope(x.meta.split(" · ")[0])) : [];
  return (
    <div className="li">
      <aside className="li-left">
        <section className="card li-alerts" aria-label="การแจ้งเตือน">
          <h2>
            <Bell size={18} />
            การแจ้งเตือน
            {unseen("all") > 0 && <b className="li-alert-count">{unseen("all")}</b>}
          </h2>
          {alertGroups.map(([key, label, Ico, c]) => (
            <button key={key} className={alertsOpen === key ? "active" : ""} onClick={() => openAlerts(key)}>
              <Tile icon={Ico} c={c} />
              <span>{label}</span>
              {unseen(key) > 0 && <b className="li-alert-count">{unseen(key)}</b>}
            </button>
          ))}
        </section>
        <section className="card li-profile">
          <div className="li-profile-links">
            <button onClick={() => navigate("profile")}>
              <Tile icon={Building2} c="#7c3aed" />
              <span>หน้าโปรไฟล์บริษัทเรา</span>
              <ChevronRight size={15} />
            </button>
            <button onClick={() => setTab("mine")}>
              <Tile icon={Megaphone} c="#f97316" />
              <span>อัปเดตของบริษัทเรา</span>
              <ChevronRight size={15} />
            </button>
            <button onClick={() => setTab("following")}>
              <Tile icon={Users} c="#ec4899" />
              <span>บริษัทที่ติดตาม</span>
              <ChevronRight size={15} />
            </button>
            <button onClick={() => navigate("jobs")}>
              <Tile icon={BriefcaseBusiness} c="#16a34a" />
              <span>งาน &amp; ข้อเสนอ</span>
              <ChevronRight size={15} />
            </button>
            <button onClick={() => navigate("chat?b2b=")}>
              <Tile icon={MessageSquare} c="#0ea5e9" />
              <span>ข้อความกับบริษัทอื่น</span>
              {chatUnread > 0 ? <b className="li-alert-count">{chatUnread}</b> : <ChevronRight size={15} />}
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
              <Tile icon={tabIcons[key][0]} c={tabIcons[key][1]} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="li-main" aria-label="อัปเดตล่าสุด">
        {writer && (
          <section className="card li-start">
            <div className="li-start-top">
              <button className="li-profile-link" onClick={() => navigate("profile")} aria-label="ดูหน้าโปรไฟล์บริษัทเรา" title="หน้าโปรไฟล์บริษัทเรา">
                <CompanyLogo id={ctx.company.id} name={ctx.company.name} logo={logo} size={48} />
              </button>
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
          <IndustryPicker value={industry} onChange={setIndustry} />
        </div>
        {industry && mainGroup && (
          <p className="ip-scope">
            แสดงโพสต์จาก <b>{industryLabel(industry)}</b>
            {!industry.startsWith("group:") && <> และธุรกิจอื่นในหมวด <b>{mainGroup}</b></>}
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        {!posts ? (
          <section className="card">
            <Loading />
          </section>
        ) : shown.length || samples.length ? (
          <>
          {shown.map((p, i) => (
            <Fragment key={p.id}>
              <PostCard
                post={p}
                ctx={ctx}
                notify={notify}
                navigate={navigate}
                onSeen={sawPost}
                onMessage={() => navigate(`chat?with=${p.company_id}&post=${p.id}`)}
                hint={!p.mine && !p.following && !!myIndustry && p.company.industry === myIndustry ? "แนะนำ · ธุรกิจประเภทเดียวกับคุณ" : ""}
                onFollow={() => follow(p.company_id)}
                onChange={(patch) => update(p.id, patch)}
                onDelete={() => setPosts((list) => list?.filter((x) => x.id !== p.id) || null)}
              />
              {ads.length > 0 && (i + 1) % AD_EVERY === 0 && (() => {
                const a = ads[Math.floor(i / AD_EVERY) % ads.length];
                return <AdCard ad={a} onClick={adClick(a)} />;
              })()}
              {/* While the network is small, a labelled sample post follows each real one. */}
              {samples[i] && <PostMock p={samples[i]} sample />}
              {samples[i] && i === 1 && !ads.length && ctx.demo && (
                <div className="sample-wrap">
                  <span className="sample-badge">ตัวอย่างโฆษณา</span>
                  <AdCard ad={sampleAds[0]} preview />
                </div>
              )}
            </Fragment>
          ))}
          {!more && samples.slice(shown.length).map((x) => <PostMock key={x.title} p={x} sample />)}
          </>
        ) : ctx.demo && !posts.length && !q && !industry && ["all", "post", "job", "partner"].includes(tab) ? (
          <SampleFeed kind={tab} AdCard={(x) => <AdCard {...x} />} />
        ) : (
          <section className="card">
            <Empty
              title={
                posts.length
                  ? "ไม่มีอัปเดตที่ตรงกับตัวกรอง"
                  : tab === "following"
                    ? "ยังไม่ได้ติดตามบริษัทไหน"
                    : tab === "saved"
                      ? "ยังไม่ได้บันทึกโพสต์ไหน"
                      : "ยังไม่มีอัปเดต"
              }
              description={
                posts.length
                  ? "ลองล้างคำค้นหรือเลือกประเภทธุรกิจอื่น"
                  : tab === "following"
                    ? "กดติดตามบริษัทจากรายการแนะนำ แล้วอัปเดตของเขาจะมาอยู่ที่นี่"
                    : tab === "saved"
                      ? "กด “บันทึก” ใต้โพสต์ที่อยากกลับมาดูภายหลัง"
                      : "ลงอัปเดตแนะนำบริษัทของคุณเป็นคนแรก"
              }
            />
          </section>
        )}
        {/* No posts yet on a real network: introduce the real companies already here. */}
        {!ctx.demo && posts && !posts.length && !q && !industry && ["all", "post", "job", "partner"].includes(tab) && (
          <NetworkCompanies ctx={ctx} notify={notify} navigate={navigate} inline />
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
        {tab === "following" && posts && discover.length > 0 && (
          <>
            <h2 className="li-discover-title">
              <Sparkles size={16} /> แนะนำจากบริษัทที่คุณยังไม่ได้ติดตาม
            </h2>
            {discover.map((p) => (
              <PostCard
                key={"d" + p.id}
                post={p}
                ctx={ctx}
                notify={notify}
                navigate={navigate}
                hint="แนะนำสำหรับคุณ"
                onSeen={sawPost}
                onMessage={() => navigate(`chat?with=${p.company_id}&post=${p.id}`)}
                onFollow={() => {
                  follow(p.company_id);
                  setDiscover((d) => d.filter((x) => x.company_id !== p.company_id));
                }}
                onChange={(patch) => setDiscover((d) => d.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))}
                onDelete={() => setDiscover((d) => d.filter((x) => x.id !== p.id))}
              />
            ))}
          </>
        )}
        {posts && !shown.length && ads[0] && <AdCard ad={ads[0]} onClick={adClick(ads[0])} />}
      </section>

      <aside className="li-right">
        {ads.length > 0 ? (
          <AdCard ad={ads[ads.length > 1 ? 1 : 0]} compact onClick={adClick(ads[ads.length > 1 ? 1 : 0])} />
        ) : (
          posts && ctx.demo && (
            <div className="sample-wrap">
              <span className="sample-badge">ตัวอย่างโฆษณา</span>
              <AdCard ad={sampleAds[1]} compact preview />
            </div>
          )
        )}
        <button className="card li-advertise" onClick={() => navigate("ads")}>
          <Megaphone size={16} />
          <span>
            <b>ลงโฆษณาในเครือข่ายธุรกิจ</b>
            <small>ให้บริษัทอื่นเห็นสินค้าและบริการของคุณ เริ่ม 30 เหรียญ</small>
          </span>
          <ChevronRight size={16} />
        </button>
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
          {showAll && <NetworkCompanies ctx={ctx} notify={notify} navigate={navigate} onClose={() => setShowAll(false)} />}
          {suggest.length ? (
            suggest.map((c) => (
              <div className="li-suggest" key={c.id}>
                <button className="li-profile-link" onClick={() => navigate(profileView(c.id, ctx))} aria-label={"ดูหน้าบริษัท " + c.name}>
                  <CompanyLogo id={c.id} name={c.name} logo={c.has_logo} size={44} />
                </button>
                <span>
                  <button className="li-name-link" onClick={() => navigate(profileView(c.id, ctx))}>
                    {c.name}
                  </button>
                  <small>{[c.industry || "บริษัทในเครือข่าย", c.province].filter(Boolean).join(" · ")}</small>
                  {c.reason && <em className="li-suggest-why">{c.reason}</em>}
                  <span className="li-suggest-actions">
                    <button className="li-follow-pill" onClick={() => follow(c.id)}>
                      <Plus size={14} />
                      ติดตาม
                    </button>
                    <button className="li-follow-pill" onClick={() => navigate("chat?with=" + c.id)}>
                      <MessageCircle size={14} />
                      ข้อความ
                    </button>
                  </span>
                </span>
              </div>
            ))
          ) : (
            <div className="li-side-empty">
              {posts && ctx.demo && (
                <div className="sample-suggest">
                  <span className="sample-badge">ตัวอย่าง</span>
                  {sampleSuggest.slice(0, 2).map((c) => (
                    <div className="li-suggest" key={c.name}>
                      {sampleLogo(c.name, c.tint, 40)}
                      <span>
                        <strong>{c.name}</strong>
                        <small>{c.meta}</small>
                        <em className="li-suggest-why">{c.why}</em>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p>ยังไม่มีบริษัทอื่นในเครือข่ายที่คุณยังไม่ได้ติดตาม เครือข่ายจะโตขึ้นเมื่อคู่ค้าของคุณเข้ามาใช้งาน</p>
              <button
                className="li-follow-pill"
                onClick={async () => {
                  await navigator.clipboard.writeText("มาเชื่อมเครือข่ายธุรกิจกับ " + ctx.company.name + " บน EliteFlow: " + location.origin + "/zetta").catch(() => {});
                  notify("คัดลอกลิงก์ชวนคู่ค้าแล้ว");
                }}
              >
                <Link2 size={14} /> คัดลอกลิงก์ชวนคู่ค้า
              </button>
            </div>
          )}
          <button className="li-side-more" onClick={() => setShowAll(true)}>
            ดูบริษัททั้งหมดในเครือข่าย
            <ChevronRight size={15} />
          </button>
        </section>
        <p className="li-footer">EliteFlow · เครือข่ายธุรกิจสำหรับบริษัทไทย</p>
      </aside>

      {alertsOpen && (
        <Modal title={"การแจ้งเตือน · " + alertGroups.find(([k]) => k === alertsOpen)![1]} onClose={() => setAlertsOpen(null)}>
          <div className="li-alert-list">
            {alertItems
              .filter((a) => alertsOpen === "all" || a.group === alertsOpen)
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((a) => {
                const Ico = alertGroups.find(([k]) => k === a.group)![2];
                return (
                  <button
                    key={a.key}
                    className="li-alert-item"
                    onClick={() => {
                      setAlertsOpen(null);
                      if (a.group === "interest" || a.group === "reply") navigate("jobs");
                      else if (a.thread) navigate("chat?b2b=" + a.thread);
                      else if (a.group === "message") setTab("mine");
                      else if (a.group === "system" && a.url) {
                        if (a.url.startsWith("http")) window.open(a.url, "_blank", "noopener");
                        else navigate(a.url.replace(/^\/?(workspace\/)?/, ""));
                      }
                    }}
                  >
                    <span className={"li-alert-icon " + a.group}>
                      <Ico size={16} />
                    </span>
                    <span>
                      <strong>{alertLine(a)}</strong>
                      <small>{a.title}</small>
                    </span>
                    <time>{a.at ? since(a.at) : ""}</time>
                  </button>
                );
              })}
            {!alertItems.some((a) => alertsOpen === "all" || a.group === alertsOpen) && (
              <Empty title="ยังไม่มีการแจ้งเตือน" description="เมื่อมีบริษัทสนใจ ตอบรับ แสดงความคิดเห็น หรือติดตามคุณ จะขึ้นที่นี่" />
            )}
          </div>
        </Modal>
      )}
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
          {images.length < FEED_MAX_IMAGES && (
            <button type="button" className="net-add-image" onClick={() => fileRef.current?.click()}>
              <ImageIcon size={18} />
              เพิ่มรูป ({images.length}/{FEED_MAX_IMAGES})
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
              const picked = [...(e.target.files || [])].slice(0, FEED_MAX_IMAGES - images.length);
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

export function PostCard({
  post: p,
  ctx,
  notify,
  navigate,
  onFollow,
  onChange,
  onDelete,
  onSeen,
  onMessage,
  hint = "",
}: {
  /** Opens B2B chat with the posting company. */
  onMessage?: () => void;
  /** Small label above the post, e.g. why it is recommended. */
  hint?: string;
  post: FeedPost;
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
  onFollow: () => void;
  onChange: (patch: Partial<FeedPost>) => void;
  onDelete: () => void;
  /** Called once the post is on screen, to count a view. */
  onSeen?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [expanded, setExpanded] = useState(false),
    [comment, setComment] = useState(""),
    [sending, setSending] = useState(false),
    [slide, setSlide] = useState(0),
    [menu, setMenu] = useState(false),
    inputRef = useRef<HTMLInputElement>(null),
    cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !onSeen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onSeen(p.id);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [p.id, onSeen]);
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
  const save = async () => {
    onChange({ saved: !p.saved });
    try {
      const { saved } = await api(`/feed/${p.id}/save`, { method: "POST" });
      onChange({ saved });
      notify(saved ? "บันทึกโพสต์แล้ว ดูได้ที่ “ที่บันทึกไว้”" : "เอาออกจากที่บันทึกไว้แล้ว");
    } catch (e) {
      onChange({ saved: p.saved });
      notify((e as Error).message);
    }
  };
  const share = async () => {
    const text = `${headline(p)} — ${p.company.name}`,
      url = `${location.origin}/feed`;
    try {
      if (navigator.share) await navigator.share({ title: headline(p), text, url });
      else {
        await navigator.clipboard.writeText(text + "\n" + url);
        notify("คัดลอกลิงก์ไว้แชร์แล้ว");
      }
    } catch {
      return; // closed the share sheet
    }
    api(`/feed/${p.id}/share`, { method: "POST" })
      .then((r: { shares: number }) => onChange({ shares: r.shares }))
      .catch(() => {});
  };
  const offer = p.kind !== "post",
    text = offer ? p.body : excerpt(p),
    long = text.length > 280 || text.split("\n").length > 4,
    line = !p.mine ? lineLink(p.company.line || "") : "",
    count = p.images.length,
    at = Math.min(slide, Math.max(count - 1, 0)),
    img = (path: string) => "/api/feed/image/" + path;
  return (
    <article className="card li-post" ref={cardRef}>
      {hint && (
        <p className="li-post-hint">
          <Sparkles size={13} /> {hint}
        </p>
      )}
      <header className="li-post-head">
        <button className="li-profile-link" onClick={() => navigate(profileView(p.company_id, ctx))} aria-label={"ดูหน้าบริษัท " + p.company.name}>
          <CompanyLogo id={p.company_id} name={p.company.name} logo={p.company.has_logo} size={48} />
        </button>
        <div className="li-post-who">
          <button className="li-name-link" onClick={() => navigate(profileView(p.company_id, ctx))}>
            {p.company.name}
          </button>
          <small>{[p.company.industry, p.company.province].filter(Boolean).join(" · ") || "บริษัทในเครือข่าย"}</small>
          <small>
            {since(p.created_at)} · โดย {p.author_name}
          </small>
        </div>
        {!p.mine && onMessage && (
          <button className="li-follow li-message" onClick={onMessage}>
            <MessageCircle size={15} />
            ส่งข้อความ
          </button>
        )}
        {!p.mine && (
          <button className={"li-follow" + (p.following ? " on" : "")} onClick={onFollow}>
            {p.following ? <Check size={15} /> : <Plus size={15} />}
            {p.following ? "ติดตามแล้ว" : "ติดตาม"}
          </button>
        )}
        <div className="li-post-menu">
          <button className="icon-button" aria-label="ตัวเลือกโพสต์" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={18} />
          </button>
          {menu && (
            <div className="li-post-menu-list" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={() => { setMenu(false); save(); }}>
                <Bookmark size={15} /> {p.saved ? "เอาออกจากที่บันทึกไว้" : "บันทึกโพสต์"}
              </button>
              <button role="menuitem" onClick={() => { setMenu(false); share(); }}>
                <Share2 size={15} /> แชร์
              </button>
              {p.can_delete && (
                <button
                  role="menuitem"
                  className="danger"
                  onClick={async () => {
                    setMenu(false);
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
                  <Trash2 size={15} /> ลบอัปเดตนี้
                </button>
              )}
            </div>
          )}
        </div>
      </header>
      {count > 0 && (
        <div className="li-gallery">
          <div className="li-slide">
            <a href={img(p.images[at])} target="_blank" rel="noreferrer">
              <img src={img(p.images[at])} alt={`รูปที่ ${at + 1} จาก ${p.company.name}`} loading="lazy" />
            </a>
            {count > 1 && (
              <>
                <button className="li-slide-nav prev" aria-label="รูปก่อนหน้า" onClick={() => setSlide((at - 1 + count) % count)}>
                  <ChevronLeft size={18} />
                </button>
                <button className="li-slide-nav next" aria-label="รูปถัดไป" onClick={() => setSlide((at + 1) % count)}>
                  <ChevronRight size={18} />
                </button>
                <span className="li-slide-count">
                  {at + 1}/{count}
                </span>
              </>
            )}
          </div>
          {(count > 1 || line) && (
            <div className="li-thumbs">
              {count > 1 &&
                p.images.map((path, n) => (
                  <button key={path} className={n === at ? "on" : ""} aria-label={`ดูรูปที่ ${n + 1}`} onClick={() => setSlide(n)}>
                    <img src={img(path)} alt="" loading="lazy" />
                  </button>
                ))}
              {line && <LineButton href={line} />}
            </div>
          )}
        </div>
      )}
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
      {line && !count && (
        <div className="li-line-row">
          <LineButton href={line} />
        </div>
      )}
      <div className="li-counts">
        <span className="li-stat like">
          <Heart size={14} /> {p.likes.toLocaleString()}
        </span>
        <button className="li-stat" onClick={() => setOpen(!open)}>
          <MessageSquare size={14} /> {p.comment_count.toLocaleString()}
        </button>
        <span className="li-stat">
          <Share2 size={14} /> {(p.shares || 0).toLocaleString()}
        </span>
        <span className="li-stat views" title="จำนวนคนที่เห็นโพสต์นี้">
          <Eye size={14} /> {(p.views || 0).toLocaleString()}
        </span>
      </div>
      <div className="li-actions">
        <button className={p.liked ? "on" : ""} aria-pressed={p.liked} onClick={interest}>
          <Heart size={18} />
          ถูกใจ
        </button>
        <button aria-expanded={open} onClick={ask}>
          <MessageSquare size={18} />
          แสดงความคิดเห็น
        </button>
        <button onClick={share}>
          <Share2 size={18} />
          แชร์
        </button>
        <button className={p.saved ? "on" : ""} aria-pressed={p.saved} onClick={save}>
          <Bookmark size={18} />
          {p.saved ? "บันทึกแล้ว" : "บันทึก"}
        </button>
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

/** LINE add-friend button of the posting company (ติดต่อเราเลย). */
function LineButton({ href }: { href: string }) {
  return (
    <a className="li-line-btn" href={href} target="_blank" rel="noreferrer noopener">
      <span className="li-line-logo">LINE</span>
      ติดต่อเราเลย
      <ChevronRight size={16} />
    </a>
  );
}

/**
 * Every real company on EliteFlow (public card only): in a modal from "ดูบริษัททั้งหมดในเครือข่าย", or inline under an
 * empty feed so a new network still shows who is here. Follow and B2B chat from each row.
 */
function NetworkCompanies({
  ctx,
  notify,
  navigate,
  inline = false,
  onClose,
}: {
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
  inline?: boolean;
  onClose?: () => void;
}) {
  const [q, setQ] = useState(""),
    [rows, setRows] = useState<NetworkCompany[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      api("/feed/companies" + (q.trim() ? "?q=" + encodeURIComponent(q.trim()) : ""))
        .then((r: NetworkCompany[]) => {
          setRows(r);
          setError("");
        })
        .catch((e) => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const follow = async (id: string) => {
    try {
      const { following } = await api("/feed/follow/" + id, { method: "POST" });
      setRows((list) => list?.map((c) => (c.id === id ? { ...c, following } : c)) || null);
      notify(following ? "ติดตามบริษัทแล้ว" : "เลิกติดตามแล้ว");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const list = (
    <div className="li-network">
      <label className="li-search li-network-search">
        <Search size={15} />
        <span className="sr-only">ค้นหาบริษัท</span>
        <input placeholder="ค้นหาชื่อบริษัท ประเภทธุรกิจ หรือจังหวัด" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {error && <p className="form-error">{error}</p>}
      {!rows ? (
        <Loading />
      ) : rows.length ? (
        <div className="li-network-grid">
          {(inline ? rows.slice(0, 9) : rows).map((c) => (
            <article className="li-network-card" key={c.id}>
              <button className="li-profile-link" onClick={() => navigate(profileView(c.id, ctx))} aria-label={"ดูหน้าบริษัท " + c.name}>
                <CompanyLogo id={c.id} name={c.name} logo={c.has_logo} size={48} />
              </button>
              <div>
                <button className="li-name-link" onClick={() => navigate(profileView(c.id, ctx))}>
                  {c.name}
                </button>
                <small>{[c.industry || "บริษัทในเครือข่าย", c.province].filter(Boolean).join(" · ")}</small>
                {c.about && <p>{c.about}</p>}
                <em>{c.posts ? `${c.posts} อัปเดต` : "เพิ่งเข้าร่วมเครือข่าย"}</em>
              </div>
              <span className="li-suggest-actions">
                <button className={"li-follow-pill" + (c.following ? " on" : "")} onClick={() => follow(c.id)} disabled={ctx.member.role === "viewer"}>
                  {c.following ? <Check size={14} /> : <Plus size={14} />}
                  {c.following ? "ติดตามแล้ว" : "ติดตาม"}
                </button>
                <button className="li-follow-pill" onClick={() => navigate("chat?with=" + c.id)}>
                  <MessageCircle size={14} />
                  ข้อความ
                </button>
              </span>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={q ? "ไม่พบบริษัทที่ค้นหา" : "ยังไม่มีบริษัทอื่นในเครือข่าย"}
          description={q ? "ลองค้นด้วยคำอื่น" : "ชวนคู่ค้าของคุณมาใช้ EliteFlow แล้วจะเห็นกันในเครือข่ายธุรกิจ"}
        />
      )}
    </div>
  );
  if (inline)
    return (
      <section className="card li-network-inline" aria-label="บริษัทในเครือข่าย">
        <h2>
          <Building2 size={18} /> บริษัทในเครือข่าย EliteFlow
        </h2>
        <p className="muted">ยังไม่มีอัปเดตในเครือข่าย ทำความรู้จักบริษัทที่เข้าร่วมแล้ว กดติดตามเพื่อเห็นอัปเดตของเขา หรือทักคุยได้เลย</p>
        {list}
      </section>
    );
  return (
    <Modal title="บริษัทในเครือข่าย EliteFlow" onClose={onClose || (() => {})}>
      {list}
    </Modal>
  );
}
