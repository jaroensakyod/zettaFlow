"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, Check, Send, Sparkles, Wand2, X } from "lucide-react";
import { industryMatches } from "@/lib/catalog";
import { matchScore, type Match } from "@/lib/match";
import type { Context, FeedComment, FeedKind, FeedPost, FeedProposal } from "@/lib/types";
import { api, Empty, Loading } from "./shared";
import { CompanyLogo, Composer, IndustryOptions, employmentLabels, headline, kindLabel, since } from "./feed";
import { FlowMascot } from "./mascot";

const tabs = [
  ["b2b", "จับคู่งานธุรกิจ (B2B)"],
  ["jobs", "ตำแหน่งงาน"],
  ["freelance", "ฟรีแลนซ์"],
  ["mine", "ประกาศของเรา"],
  ["sent", "ข้อเสนอที่ส่งไป"],
] as const;
type Tab = (typeof tabs)[number][0];
const statusLabel: Record<FeedProposal["status"], string> = {
  sent: "รอพิจารณา",
  shortlisted: "ผ่านการคัดเลือก",
  declined: "ไม่ผ่าน",
};
const tone = (score: number) => (score >= 80 ? "high" : score >= 60 ? "mid" : "low");
type Offer = FeedPost & { match: Match | null };

export function Jobs({
  ctx,
  notify,
  navigate,
}: {
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("b2b"),
    [offers, setOffers] = useState<FeedPost[] | null>(null),
    [proposals, setProposals] = useState<FeedProposal[]>([]),
    [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [province, setProvince] = useState(""),
    [industry, setIndustry] = useState(""),
    [sort, setSort] = useState<"match" | "new">("match"),
    [composing, setComposing] = useState<FeedKind | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [rows, props] = await Promise.all([api("/feed?filter=offers"), api("/feed/proposals")]);
      setOffers(rows);
      setProposals(props);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const me = useMemo(
    () => ({
      industry: String(ctx.company.profile.industry || ""),
      province: String(ctx.company.profile.province || ""),
      description: String(ctx.company.profile.description || ""),
    }),
    [ctx.company.profile],
  );
  const scored: Offer[] = useMemo(
    () => (offers || []).map((p) => ({ ...p, match: p.mine ? null : matchScore(p, me) })),
    [offers, me],
  );
  const q = search.trim().toLowerCase(),
    list = scored
      .filter((p) =>
        tab === "mine"
          ? p.mine
          : !p.mine &&
            (tab === "b2b"
              ? p.kind === "partner"
              : tab === "freelance"
                ? p.kind === "job" && p.meta.employment === "freelance"
                : p.kind === "job" && p.meta.employment !== "freelance"),
      )
      .filter(
        (p) =>
          (!province || p.company.province === province || (p.meta.location || "").includes(province)) &&
          industryMatches(industry, p.company.industry) &&
          (!q || [p.company.name, p.meta.title || "", p.body].join(" ").toLowerCase().includes(q)),
      )
      .sort((a, b) =>
        sort === "match" && a.match && b.match
          ? b.match.score - a.match.score
          : b.created_at.localeCompare(a.created_at),
      ),
    current = list.find((p) => p.id === selected) || list[0],
    provinces = [...new Set(scored.map((p) => p.company.province).filter(Boolean))].sort(),
    sent = proposals.filter((p) => !p.incoming);
  return (
    <div className="jobs">
      <section className="card jobs-head">
        <div className="jobs-head-top">
          <div>
            <h1>หางาน &amp; จับคู่งาน</h1>
            <p>หาคนมาร่วมทีม หาโปรเจกต์ให้บริษัท หรือหาพาร์ทเนอร์ที่ใช่ จัดอันดับจากข้อมูลในโปรไฟล์บริษัทคุณ</p>
          </div>
          {ctx.member.role !== "viewer" && (
            <div className="jobs-head-actions">
              <button className="secondary" onClick={() => setComposing("partner")}>
                ประกาศหาพาร์ทเนอร์
              </button>
              <button className="primary" onClick={() => setComposing("job")}>
                <Plus size={16} />
                ประกาศรับสมัครงาน
              </button>
            </div>
          )}
        </div>
        <div className="jobs-tabs" role="tablist" aria-label="ประเภทงาน">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setSelected("");
              }}
            >
              {label}
              {key === "sent" && sent.length > 0 && <b>{sent.length}</b>}
            </button>
          ))}
        </div>
        {tab !== "sent" && (
          <div className="jobs-filters">
            <label className="net-search jobs-search">
              <Search size={16} />
              <span className="sr-only">ค้นหางาน</span>
              <input placeholder="ค้นหา เช่น ตกแต่งบูธ, จัดเลี้ยง, บาริสต้า" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label>
              <span className="sr-only">จังหวัด</span>
              <select value={province} onChange={(e) => setProvince(e.target.value)}>
                <option value="">จังหวัด: ทั้งหมด</option>
                {provinces.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">ประเภทธุรกิจ</span>
              <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                <option value="">ประเภทธุรกิจ: ทั้งหมด</option>
                <IndustryOptions />
              </select>
            </label>
            {tab !== "mine" && (
              <label>
                <span className="sr-only">เรียงลำดับ</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as "match" | "new")}>
                  <option value="match">เรียงตาม: ตรงกับเราที่สุด</option>
                  <option value="new">เรียงตาม: ล่าสุด</option>
                </select>
              </label>
            )}
          </div>
        )}
      </section>
      {error && <p className="form-error">{error}</p>}
      {!offers ? (
        <section className="card">
          <Loading />
        </section>
      ) : tab === "sent" ? (
        <SentList proposals={sent} />
      ) : list.length ? (
        <div className="jobs-body">
          <section className="jobs-list" aria-label="รายการงาน">
            {list.map((p) => (
              <button
                key={p.id}
                className={"jobs-item" + (current?.id === p.id ? " active" : "")}
                aria-current={current?.id === p.id}
                onClick={() => setSelected(p.id)}
              >
                {p.match ? (
                  <span className={"jobs-ring " + tone(p.match.score)}>{p.match.score}%</span>
                ) : (
                  <span className="jobs-ring count">
                    {p.proposal_count}
                    <small>ข้อเสนอ</small>
                  </span>
                )}
                <span className="jobs-item-text">
                  <strong>{headline(p)}</strong>
                  <small>
                    {p.company.name}
                    {p.meta.location ? " · " + p.meta.location : ""}
                  </small>
                  <span className="jobs-tags">
                    <span>{p.kind === "job" ? employmentLabels[p.meta.employment || "full"] : kindLabel[p.kind]}</span>
                    {p.meta.budget && <span>{p.meta.budget}</span>}
                    {p.proposed && <span className="done">ส่งข้อเสนอแล้ว</span>}
                    <span>{since(p.created_at)}</span>
                  </span>
                </span>
              </button>
            ))}
          </section>
          {current && (
            <Detail
              key={current.id}
              offer={current}
              ctx={ctx}
              notify={notify}
              navigate={navigate}
              onChanged={load}
              onPatch={(patch) => setOffers((rows) => rows?.map((r) => (r.id === current.id ? { ...r, ...patch } : r)) || null)}
            />
          )}
        </div>
      ) : (
        <section className="card">
          <Empty
            title={tab === "mine" ? "บริษัทเรายังไม่มีประกาศ" : "ยังไม่มีงานในหมวดนี้"}
            description={
              tab === "mine"
                ? "ลงประกาศรับสมัครงานหรือหาพาร์ทเนอร์ แล้วข้อเสนอจากบริษัทอื่นจะมาอยู่ที่นี่"
                : "ลองเปลี่ยนตัวกรอง หรือกลับมาดูใหม่เมื่อมีบริษัทลงประกาศ"
            }
          />
        </section>
      )}
      {composing && (
        <Composer
          ctx={ctx}
          initialKind={composing}
          onClose={() => setComposing(null)}
          onPosted={() => {
            setComposing(null);
            notify("ลงประกาศแล้ว");
            setTab("mine");
            load();
          }}
        />
      )}
    </div>
  );
}

function Detail({
  offer: p,
  ctx,
  notify,
  navigate,
  onChanged,
  onPatch,
}: {
  offer: Offer;
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
  onChanged: () => void;
  onPatch: (patch: Partial<FeedPost>) => void;
}) {
  const [proposing, setProposing] = useState(false),
    [message, setMessage] = useState(""),
    [contact, setContact] = useState(
      String(ctx.company.profile.phone || ctx.company.profile.line || ctx.company.profile.email || ""),
    ),
    [busy, setBusy] = useState(false),
    [asking, setAsking] = useState(false),
    [question, setQuestion] = useState(""),
    [incoming, setIncoming] = useState<FeedProposal[] | null>(null);
  const canReview = ctx.member.role === "owner" || ctx.member.role === "manager";
  useEffect(() => {
    if (!p.mine) return;
    api("/feed/proposals?post=" + p.id)
      .then(setIncoming)
      .catch((e) => notify((e as Error).message));
  }, [p.mine, p.id, notify]);
  const draft = () => {
    const about = String(ctx.company.profile.description || "").trim(),
      industry = String(ctx.company.profile.industry || "");
    setMessage(
      [
        `เรียน ${p.company.name}`,
        "",
        `${ctx.company.name}${industry ? ` (ธุรกิจ${industry})` : ""} สนใจ${p.kind === "job" ? "ตำแหน่ง" : "งาน"} "${headline(p)}"` +
          (p.match?.reasons.length ? ` เพราะ${p.match.reasons[0]}` : ""),
        about ? `เกี่ยวกับเรา: ${about.slice(0, 300)}` : "",
        "พร้อมส่งรายละเอียด ผลงาน และใบเสนอราคาเพิ่มเติมตามที่ต้องการ",
        "",
        `ขอบคุณครับ/ค่ะ`,
        ctx.user.name,
      ]
        .filter((line, i, all) => line !== "" || all[i - 1] !== "")
        .join("\n"),
    );
  };
  return (
    <article className="card jobs-detail">
      <header className="jobs-detail-head">
        <CompanyLogo id={p.company_id} name={p.company.name} logo={p.company.has_logo} size={54} />
        <div>
          <h2>{headline(p)}</h2>
          <span className="muted">
            {p.company.name} · โพสต์เมื่อ {since(p.created_at)}
          </span>
        </div>
        {p.match && <span className={"jobs-badge " + tone(p.match.score)}>เข้ากับบริษัทคุณ {p.match.score}%</span>}
      </header>
      <div className="jobs-facts">
        <div>
          <span>สถานที่</span>
          <strong>{p.meta.location || p.company.province || "—"}</strong>
        </div>
        <div>
          <span>{p.kind === "job" ? "ค่าจ้าง" : "งบประมาณ"}</span>
          <strong>{p.meta.budget || "—"}</strong>
        </div>
        <div>
          <span>ประเภท</span>
          <strong>{p.kind === "job" ? employmentLabels[p.meta.employment || "full"] : kindLabel[p.kind]}</strong>
        </div>
      </div>
      <section>
        <h3>รายละเอียดงาน</h3>
        <p className="jobs-desc">{p.body}</p>
      </section>
      {p.match && (
        <section className="jobs-why">
          <FlowMascot size={46} antenna={false} />
          <div>
            <strong>ทำไมถึงเหมาะกับบริษัทคุณ</strong>
            {p.match.reasons.length ? (
              <ul>
                {p.match.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p>
                ยังมีข้อมูลบริษัทไม่พอให้จับคู่ เติมประเภทธุรกิจ จังหวัด และรายละเอียดบริษัท แล้วคะแนนจะแม่นขึ้น{" "}
                <button className="text-button" onClick={() => navigate("company")}>
                  ไปที่โปรไฟล์บริษัท
                </button>
              </p>
            )}
          </div>
        </section>
      )}

      {p.mine ? (
        <section className="jobs-incoming">
          <h3>ข้อเสนอที่ได้รับ ({incoming?.length ?? "…"})</h3>
          {!incoming ? (
            <Loading />
          ) : incoming.length ? (
            incoming.map((r) => (
              <div className="jobs-proposal" key={r.id}>
                <div className="jobs-proposal-top">
                  <strong>{r.company_name}</strong>
                  <small className="muted">
                    {[r.company_industry, r.author_name, since(r.created_at)].filter(Boolean).join(" · ")}
                  </small>
                  <span className={"jobs-status " + r.status}>{statusLabel[r.status]}</span>
                </div>
                <p>{r.message}</p>
                {r.contact && <small>ติดต่อ: {r.contact}</small>}
                {canReview && (
                  <div className="jobs-proposal-actions">
                    {(["shortlisted", "declined", "sent"] as const)
                      .filter((s) => s !== r.status)
                      .map((s) => (
                        <button
                          key={s}
                          className={s === "shortlisted" ? "primary" : "secondary"}
                          onClick={async () => {
                            try {
                              await api("/feed/proposals/" + r.id, { method: "PATCH", body: { status: s } });
                              setIncoming((rows) => rows?.map((x) => (x.id === r.id ? { ...x, status: s } : x)) || null);
                            } catch (e) {
                              notify((e as Error).message);
                            }
                          }}
                        >
                          {s === "shortlisted" ? "คัดเลือก" : s === "declined" ? "ไม่ผ่าน" : "กลับเป็นรอพิจารณา"}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="muted">ยังไม่มีบริษัทส่งข้อเสนอ</p>
          )}
        </section>
      ) : p.proposed ? (
        <p className="jobs-sent">
          <Check size={16} />
          บริษัทของคุณส่งข้อเสนอให้ประกาศนี้แล้ว ดูสถานะได้ที่แท็บ "ข้อเสนอที่ส่งไป"
        </p>
      ) : proposing ? (
        <form
          className="jobs-propose"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(`/feed/${p.id}/propose`, { method: "POST", body: { message, contact } });
              notify("ส่งข้อเสนอแล้ว");
              onPatch({ proposed: true });
              onChanged();
            } catch (err) {
              notify((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="jobs-propose-head">
            <h3>ข้อเสนอของ {ctx.company.name}</h3>
            <button type="button" className="secondary" onClick={draft}>
              <Wand2 size={15} />
              ร่างข้อเสนอให้
            </button>
          </div>
          <label>
            ข้อความถึง {p.company.name}
            <textarea required rows={7} maxLength={3000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label>
            ช่องทางติดต่อกลับ
            <input maxLength={200} placeholder="เบอร์โทร, LINE หรืออีเมล" value={contact} onChange={(e) => setContact(e.target.value)} />
          </label>
          <div className="jobs-actions">
            <button type="button" className="secondary" onClick={() => setProposing(false)}>
              <X size={15} />
              ยกเลิก
            </button>
            <button className="primary" disabled={busy || !message.trim()}>
              <Send size={15} />
              {busy ? "กำลังส่ง…" : "ส่งข้อเสนอ"}
            </button>
          </div>
        </form>
      ) : (
        ctx.member.role !== "viewer" && (
          <div className="jobs-actions">
            <button
              className="primary"
              onClick={() => {
                setProposing(true);
                if (!message) draft();
              }}
            >
              <Sparkles size={15} />
              {p.kind === "job" ? "เสนอตัวรับงานนี้" : "เสนอตัวเป็นพาร์ทเนอร์"}
            </button>
            <button className="secondary" aria-expanded={asking} onClick={() => setAsking(!asking)}>
              ถามคำถาม{p.comment_count ? ` · ${p.comment_count}` : ""}
            </button>
            <FollowButton offer={p} notify={notify} onPatch={onPatch} />
          </div>
        )
      )}
      {asking && !p.mine && (
        <section className="net-thread jobs-thread">
          {p.comments.map((c) => (
            <div className="net-reply" key={c.id}>
              <strong>
                {c.company_name}
                <small> · {c.author_name}</small>
              </strong>
              <p>{c.body}</p>
            </div>
          ))}
          {!p.comments.length && <small className="muted">ยังไม่มีคำถาม คำถามจะเห็นได้ทุกบริษัท</small>}
          <form
            className="net-reply-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!question.trim()) return;
              try {
                const c: FeedComment = await api(`/feed/${p.id}/comments`, { method: "POST", body: { body: question } });
                onPatch({ comments: [...p.comments, c].slice(-3), comment_count: p.comment_count + 1 });
                setQuestion("");
              } catch (err) {
                notify((err as Error).message);
              }
            }}
          >
            <label className="sr-only" htmlFor={"ask-" + p.id}>
              คำถามถึง {p.company.name}
            </label>
            <input id={"ask-" + p.id} maxLength={2000} placeholder={`ถาม ${p.company.name}`} value={question} onChange={(e) => setQuestion(e.target.value)} />
            <button className="primary" aria-label="ส่งคำถาม" disabled={!question.trim()}>
              <Send size={15} />
            </button>
          </form>
        </section>
      )}
    </article>
  );
}

function FollowButton({
  offer: p,
  notify,
  onPatch,
}: {
  offer: Offer;
  notify: (s: string) => void;
  onPatch: (patch: Partial<FeedPost>) => void;
}) {
  return (
    <button
      className={"secondary" + (p.following ? " selected" : "")}
      onClick={async () => {
        try {
          const { following } = await api("/feed/follow/" + p.company_id, { method: "POST" });
          onPatch({ following });
        } catch (e) {
          notify((e as Error).message);
        }
      }}
    >
      {p.following ? <Check size={15} /> : <Plus size={15} />}
      {p.following ? "ติดตามแล้ว" : "ติดตามบริษัท"}
    </button>
  );
}

function SentList({ proposals }: { proposals: FeedProposal[] }) {
  return proposals.length ? (
    <section className="card jobs-sent-list">
      {proposals.map((r) => (
        <div className="jobs-proposal" key={r.id}>
          <div className="jobs-proposal-top">
            <strong>{r.post_title}</strong>
            <small className="muted">
              {kindLabel[r.post_kind]} · {r.post_company} · ส่งเมื่อ {since(r.created_at)}
            </small>
            <span className={"jobs-status " + r.status}>{statusLabel[r.status]}</span>
          </div>
          <p>{r.message}</p>
        </div>
      ))}
    </section>
  ) : (
    <section className="card">
      <Empty title="ยังไม่ได้ส่งข้อเสนอ" description="เลือกงานที่สนใจแล้วกด เสนอตัวรับงานนี้" />
    </section>
  );
}
