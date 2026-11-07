"use client";
// A company's page in the business network (ours or another company's): cover, logo, about, public channels,
// its updates, and who follows it / whom it follows. Opened from names and logos across the feed.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Globe,
  MessageCircle,
  Pencil,
  Plus,
  Users,
  UserCheck,
  Newspaper,
  Info,
  CalendarDays,
  MapPin,
  Building2,
  PenSquare,
} from "lucide-react";
import type { Context, FeedPost } from "@/lib/types";
import type { CompanyProfile, FollowRow } from "@/lib/feed";
import { api, Empty, Loading } from "./shared";
import { CompanyLogo, PostCard, lineLink } from "./feed";

type Tab = "posts" | "about" | "followers" | "following";
const tabs: [Tab, string, typeof Users][] = [
  ["posts", "อัปเดต", Newspaper],
  ["about", "เกี่ยวกับ", Info],
  ["followers", "ผู้ติดตาม", Users],
  ["following", "กำลังติดตาม", UserCheck],
];
const joinedText = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
const external = (url: string) => (/^https?:\/\//i.test(url) ? url : "https://" + url);

export function CompanyProfilePage({ ctx, notify, navigate }: { ctx: Context; notify: (s: string) => void; navigate: (v: string) => void }) {
  const params = useSearchParams(),
    id = params.get("id") || ctx.company.id,
    [profile, setProfile] = useState<CompanyProfile | null>(null),
    [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "posts"),
    [error, setError] = useState("");
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
    setTab((params.get("tab") as Tab) || "posts");
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
  if (error) return <section className="card"><Empty title="เปิดหน้าบริษัทไม่ได้" description={error} /></section>;
  if (!profile) return <section className="card"><Loading /></section>;
  const p = profile,
    line = p.line ? lineLink(p.line) : "",
    viewer = ctx.member.role === "viewer";
  return (
    <div className="cp">
      <button className="cp-back" onClick={() => navigate("feed")}>
        <ArrowLeft size={16} /> เครือข่ายธุรกิจ
      </button>
      <section className="card cp-hero">
        <div
          className={"cp-cover" + (p.has_cover ? "" : " empty")}
          style={p.has_cover ? { backgroundImage: `url("/api/feed/cover/${p.id}")` } : undefined}
        />
        <div className="cp-head">
          <span className="cp-logo">
            <CompanyLogo id={p.id} name={p.name} logo={p.has_logo} size={112} />
          </span>
          <div className="cp-title">
            <h1>{p.name}</h1>
            {p.name_en && <p className="cp-en">{p.name_en}</p>}
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
              <button onClick={() => setTab("posts")}>
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
                <button className="secondary" onClick={() => navigate("company")}>
                  <Pencil size={16} /> แก้ไขหน้าบริษัท
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
            </button>
          ))}
        </nav>
      </section>

      <div className="cp-body">
        <aside className="cp-side">
          <section className="card cp-card">
            <h2>เกี่ยวกับ</h2>
            {p.about ? <p className="cp-about clamp">{p.about}</p> : <p className="muted">{p.mine ? "ยังไม่ได้เขียนแนะนำบริษัท — เพิ่มได้ที่ แก้ไขหน้าบริษัท" : "ยังไม่มีคำแนะนำบริษัท"}</p>}
            <Channels p={p} line={line} />
          </section>
        </aside>
        <main className="cp-main">
          {tab === "posts" && <CompanyPosts ctx={ctx} id={p.id} name={p.name} notify={notify} navigate={navigate} mine={p.mine} />}
          {tab === "about" && (
            <section className="card cp-card">
              <h2>เกี่ยวกับ {p.name}</h2>
              {p.about ? <p className="cp-about">{p.about}</p> : <p className="muted">ยังไม่มีคำแนะนำบริษัท</p>}
              <dl className="cp-facts">
                {p.industry && (
                  <>
                    <dt>ประเภทธุรกิจ</dt>
                    <dd>{p.industry}</dd>
                  </>
                )}
                {p.province && (
                  <>
                    <dt>จังหวัด</dt>
                    <dd>{p.province}</dd>
                  </>
                )}
                <dt>เข้าร่วม EliteFlow</dt>
                <dd>{joinedText(p.joined)}</dd>
              </dl>
              <Channels p={p} line={line} />
            </section>
          )}
          {(tab === "followers" || tab === "following") && (
            <FollowList ctx={ctx} id={p.id} dir={tab} name={p.name} mine={p.mine} notify={notify} open={open} />
          )}
        </main>
      </div>
    </div>
  );
}

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
