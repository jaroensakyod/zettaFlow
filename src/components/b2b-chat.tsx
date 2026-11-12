"use client";
// แชท page: the team's department rooms, and B2B chat with other companies on the network.
// A conversation opened from a feed post shows that post as a card, with ready-made questions for its kind.
// With no conversation yet (or in the public demo) the list shows a labelled sample inbox (lib/mock/b2b.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, MessagesSquare, Send, Users, ArrowLeft, FileText, MapPin, Wallet, Clock3, ExternalLink, X, Sparkles, MessageCircleQuestion } from "lucide-react";
import type { Context, FeedPost } from "@/lib/types";
import type { B2bCompany, B2bMessage, B2bPostRef, B2bThread } from "@/lib/b2b";
import { b2bSample, isSampleThread, quickQuestions, sampleThreadFor, SAMPLE_NOTE, SAMPLE_SENT, type SampleThread } from "@/lib/mock/b2b";
import { api, Empty, Loading } from "./shared";
import { Chat } from "./tools";
import { CompanyLogo, employmentLabels, kindLabel, since } from "./feed";

export function ChatHub({ ctx, notify, navigate }: { ctx: Context; notify: (s: string) => void; navigate: (v: string) => void }) {
  const params = useSearchParams(),
    b2bLink = params.has("with") || params.has("b2b"),
    [tab, setTab] = useState<"team" | "b2b">(b2bLink ? "b2b" : "team"),
    [unread, setUnread] = useState(0);
  useEffect(() => {
    if (b2bLink) setTab("b2b");
  }, [b2bLink]);
  useEffect(() => {
    const load = () => api("/b2b/unread").then((r: { unread: number }) => setUnread(r.unread)).catch(() => {});
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="chat-hub">
      <div className={"chat-bar t-" + tab}>
        <span className="chat-bar-icon">
          <MessagesSquare size={20} />
        </span>
        <div className="chat-bar-title">
          <h1>แชท</h1>
          <small>{tab === "team" ? "คุยกันในทีม แยกตามแผนก" : "ติดต่อ สอบถาม และต่อรองกับบริษัทในเครือข่าย"}</small>
        </div>
        <div className="chat-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "team"} className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>
            <Users size={16} /> แชทในทีม
          </button>
          <button role="tab" aria-selected={tab === "b2b"} className={tab === "b2b" ? "active" : ""} onClick={() => setTab("b2b")}>
            <Building2 size={16} /> คุยกับบริษัทอื่น
            {unread > 0 && <b className="li-alert-count">{unread}</b>}
          </button>
        </div>
      </div>
      {tab === "team" ? <Chat ctx={ctx} notify={notify} /> : <B2bChat ctx={ctx} notify={notify} navigate={navigate} onRead={setUnread} />}
    </div>
  );
}

const imageSrc = (path: string) => (path.startsWith("data:") ? path : "/api/feed/image/" + path);
const companyLogo = (c: { id: string; name: string; has_logo: boolean; logo_url?: string }, size: number) => (
  <CompanyLogo id={c.id} name={c.name} logo={c.logo_url || c.has_logo} size={size} />
);
/** A feed post (demo feed) as a chat card. */
const cardOf = (p: FeedPost): B2bPostRef => ({
  id: p.id,
  title: p.meta.title || p.body.split("\n")[0].slice(0, 90),
  kind: p.kind,
  excerpt: p.body.slice(0, 200),
  meta: p.meta,
  image: p.images[0] || null,
  created_at: p.created_at,
  company: { id: p.company_id, name: p.company.name, has_logo: p.company.has_logo },
});

/** The post a conversation is about, as a card: picture, company, kind, title, excerpt and key details. */
export function ChatPostCard({ post, onOpen, onAsk, compact }: { post: B2bPostRef; onOpen?: () => void; onAsk?: () => void; compact?: boolean }) {
  const meta = post.meta || {},
    details = [
      meta.location && { icon: MapPin, text: meta.location },
      meta.budget && { icon: Wallet, text: (post.kind === "job" ? "ค่าจ้าง: " : "งบ: ") + meta.budget },
      meta.employment && { icon: Clock3, text: employmentLabels[meta.employment] || meta.employment },
    ].filter(Boolean) as { icon: typeof MapPin; text: string }[],
    body = post.excerpt && post.excerpt.trim() !== post.title.trim() ? post.excerpt : "";
  return (
    <div className={"b2b-card kind-" + post.kind + (compact ? " compact" : "")}>
      {post.image && <img className="b2b-card-img" src={imageSrc(post.image)} alt="" loading="lazy" />}
      <div className="b2b-card-body">
        <div className="b2b-card-who">
          {post.company && companyLogo(post.company, 22)}
          <span>{post.company?.name || "โพสต์ในเครือข่าย"}</span>
          <em className={"b2b-kind kind-" + post.kind}>{kindLabel[post.kind]}</em>
        </div>
        <strong className="b2b-card-title">{post.title}</strong>
        {body && !compact && <p className="b2b-card-text">{body}</p>}
        {details.length > 0 && (
          <div className="b2b-card-meta">
            {details.map(({ icon: Icon, text }) => (
              <span key={text}>
                <Icon size={12} /> {text}
              </span>
            ))}
          </div>
        )}
        {(onOpen || onAsk) && (
          <div className="b2b-card-actions">
            {onOpen && (
              <button type="button" className="link-button" onClick={onOpen}>
                <ExternalLink size={13} /> ดูโพสต์
              </button>
            )}
            {onAsk && (
              <button type="button" className="link-button" onClick={onAsk}>
                <MessageCircleQuestion size={13} /> ถามเรื่องนี้
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function B2bChat({
  ctx,
  notify,
  navigate,
  onRead,
}: {
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
  onRead: (n: number) => void;
}) {
  const params = useSearchParams(),
    router = useRouter(),
    [threads, setThreads] = useState<B2bThread[] | null>(null),
    [samples, setSamples] = useState<SampleThread[]>(() => b2bSample()),
    [active, setActive] = useState<string | null>(params.get("b2b")),
    [messages, setMessages] = useState<B2bMessage[] | null>(null),
    [topic, setTopic] = useState<B2bPostRef | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    viewer = ctx.member.role === "viewer";
  // Samples while the company has no real conversation yet, and always in the demo.
  // Sample conversations only in the public demo; a real company sees its own (possibly empty) inbox.
  const sampleMode = ctx.demo,
    list: B2bThread[] | null = sampleMode ? samples : threads;
  const loadThreads = useCallback(async () => {
    const list: B2bThread[] = await api("/b2b");
    setThreads(list);
    onRead(list.reduce((n, t) => n + (t.id === active ? 0 : Number(t.unread)), 0));
    return list;
  }, [active, onRead]);
  const select = useCallback(
    (id: string | null) => {
      setActive(id);
      if (id) router.replace("/workspace/chat?b2b=" + id);
    },
    [router],
  );
  // "ส่งข้อความ" from the feed: chat?with=<company>&post=<post> opens (or starts) that conversation about that post.
  const target = params.get("with"),
    fromPost = params.get("post");
  useEffect(() => {
    if (!target) return;
    if (ctx.demo) {
      // The demo cannot start a real conversation: open the company's sample conversation about this post.
      api("/feed")
        .catch(() => [] as FeedPost[])
        .then((posts: FeedPost[]) => {
          const p = posts.find((x) => x.id === fromPost) || posts.find((x) => x.company_id === target),
            card = p ? cardOf(p) : null,
            company: B2bCompany = p
              ? { id: target, name: p.company.name, industry: p.company.industry, province: p.company.province, has_logo: p.company.has_logo }
              : { id: target, name: "บริษัทในเครือข่าย", industry: "", province: "", has_logo: false };
          const t = sampleThreadFor(samples, company, card);
          setSamples((all) => [t, ...all.filter((x) => x.id !== t.id)]);
          setTopic(t.post);
          select(t.id);
        });
      return;
    }
    api("/b2b/open", { method: "POST", body: { company: target, post: fromPost } })
      .then((r: { id: string; post?: B2bPostRef | null }) => {
        setTopic(r.post || null);
        select(r.id);
        return loadThreads();
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, fromPost]);
  useEffect(() => {
    loadThreads().catch((e) => setError((e as Error).message));
    const timer = setInterval(() => loadThreads().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [loadThreads]);
  useEffect(() => {
    if (!active || isSampleThread(active)) return;
    setMessages(null);
    const load = () =>
      api("/b2b/" + active)
        .then(setMessages)
        .catch((e) => setError((e as Error).message));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [active]);
  const thread = list?.find((t) => t.id === active),
    sample = thread && "sample" in thread ? (thread as SampleThread) : null,
    shown = sample ? sample.messages : messages;
  // Reading a sample conversation clears its unread badge.
  useEffect(() => {
    if (sample && Number(sample.unread) > 0) setSamples((all) => all.map((t) => (t.id === sample.id ? { ...t, unread: 0 } : t)));
  }, [sample]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [shown?.length, active, topic?.id]);
  // A conversation with no messages yet is about its post.
  useEffect(() => {
    if (thread && !topic && thread.post && shown && !shown.length) setTopic(thread.post);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, shown?.length]);
  const lastPost = shown ? [...shown].reverse().find((m) => m.post)?.post : undefined,
    pendingCard = topic && lastPost?.id !== topic.id ? topic : null,
    openPost = () => navigate("feed");
  const ask = (q: string) => {
    setText(q);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(q.length, q.length);
    });
  };
  const send = async () => {
    if (!thread || !text.trim()) return;
    const body = text.trim();
    if (sample) {
      const m: B2bMessage = {
        id: sample.id + "-local-" + Date.now(),
        company_id: "sample-own",
        author_name: ctx.member.name || "คุณ",
        body,
        created_at: new Date().toISOString(),
        mine: true,
        post: topic,
      };
      setSamples((all) =>
        all.map((t) => (t.id === sample.id ? { ...t, messages: [...t.messages, m], last: { body, mine: true, at: m.created_at }, last_at: m.created_at } : t)),
      );
      setText("");
      setTopic(null);
      notify(SAMPLE_SENT);
      return;
    }
    setBusy(true);
    try {
      const m: B2bMessage = await api("/b2b/" + thread.id, { method: "POST", body: { body, post: topic?.id || null } });
      setMessages((list) => [...(list || []), { ...m, post: m.post ?? topic }]);
      setText("");
      setTopic(null);
      loadThreads().catch(() => {});
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const chips = useMemo(() => (topic ? quickQuestions[topic.kind] : []), [topic]);
  return (
    <section className={"card b2b" + (active && thread ? " open" : "")}>
      <aside className="b2b-list" aria-label="บริษัทที่คุยด้วย">
        <div className="b2b-list-head">
          <b>บริษัทที่คุยด้วย</b>
          {sampleMode && (
            <span className="sample-badge" title={SAMPLE_NOTE}>
              <Sparkles size={11} /> ตัวอย่าง
            </span>
          )}
        </div>
        {!list ? (
          <Loading />
        ) : (
          list.map((t) => (
            <button
              key={t.id}
              className={"b2b-thread" + (t.id === active ? " active" : "")}
              onClick={() => {
                select(t.id);
                setTopic(null);
                setText("");
              }}
            >
              {companyLogo(t.company, 40)}
              <span>
                <strong>{t.company.name}</strong>
                {t.post && (
                  <span className="b2b-topic">
                    {t.post.image ? <img src={imageSrc(t.post.image)} alt="" /> : <FileText size={12} />}
                    <span>
                      {kindLabel[t.post.kind]}: {t.post.title}
                    </span>
                  </span>
                )}
                <small className={t.id !== active && Number(t.unread) > 0 ? "unread" : ""}>
                  {t.last ? (t.last.mine ? "คุณ: " : "") + t.last.body : "ยังไม่มีข้อความ"}
                </small>
              </span>
              <span className="b2b-thread-meta">
                {t.last && <time>{since(t.last.at)}</time>}
                {t.id !== active && Number(t.unread) > 0 && <b className="li-alert-count">{t.unread}</b>}
              </span>
            </button>
          ))
        )}
        {list && sampleMode && (
          <div className="b2b-empty">
            <small>กด “ส่งข้อความ” ที่โพสต์หรือบริษัทแนะนำในเครือข่ายธุรกิจเพื่อเริ่มคุยจริง</small>
            <button className="secondary" onClick={() => navigate("feed")}>
              ไปที่เครือข่ายธุรกิจ
            </button>
          </div>
        )}
      </aside>
      <div className="b2b-main">
        {thread ? (
          <>
            <header className="b2b-head">
              <button className="icon-button b2b-back" aria-label="กลับไปรายชื่อ" onClick={() => setActive(null)}>
                <ArrowLeft size={18} />
              </button>
              {companyLogo(thread.company, 40)}
              <span>
                <strong>
                  {thread.company.name} {sample && <span className="sample-badge">ตัวอย่าง</span>}
                </strong>
                <small>{[thread.company.industry, thread.company.province].filter(Boolean).join(" · ") || "บริษัทในเครือข่าย"}</small>
              </span>
            </header>
            <div className="b2b-messages">
              {!shown ? (
                <Loading />
              ) : (
                <>
                  {!shown.length && !pendingCard && (
                    <Empty title={"เริ่มคุยกับ " + thread.company.name} description="ข้อความเห็นได้ทุกคนในสองบริษัทนี้เท่านั้น" />
                  )}
                  {shown.map((m, i) => (
                    <div className={"b2b-msg" + (m.mine ? " mine" : "")} key={m.id}>
                      {(i === 0 || shown[i - 1].mine !== m.mine || Date.parse(m.created_at) - Date.parse(shown[i - 1].created_at) > 6e5) && (
                        <small>
                          {m.mine ? m.author_name : (m.company_name || thread.company.name) + " · " + m.author_name} · {since(m.created_at)}
                        </small>
                      )}
                      {m.post &&
                        (m.post.excerpt !== undefined || m.post.image || m.post.company ? (
                          <ChatPostCard post={m.post} onOpen={openPost} onAsk={m.post.id !== topic?.id ? () => setTopic(m.post!) : undefined} />
                        ) : (
                          <span className="b2b-ref">
                            <FileText size={13} /> {kindLabel[m.post.kind]}: {m.post.title}
                          </span>
                        ))}
                      <p>{m.body}</p>
                    </div>
                  ))}
                  {pendingCard && (
                    <div className="b2b-msg mine b2b-pending">
                      <small>คุณกำลังถามเกี่ยวกับโพสต์นี้</small>
                      <ChatPostCard post={pendingCard} onOpen={openPost} />
                    </div>
                  )}
                </>
              )}
              <div ref={bottom} />
            </div>
            {error && !sample && <p className="form-error">{error}</p>}
            <form
              className="b2b-compose"
              onSubmit={async (e) => {
                e.preventDefault();
                await send();
              }}
            >
              {topic && (
                <div className="b2b-topic-bar">
                  <span className="b2b-ref compose">
                    {topic.image ? <img src={imageSrc(topic.image)} alt="" /> : <FileText size={13} />} กำลังถามเกี่ยวกับ:{" "}
                    <b>{topic.title}</b>
                    <button type="button" aria-label="ไม่ถามเรื่องโพสต์นี้" onClick={() => setTopic(null)}>
                      <X size={13} />
                    </button>
                  </span>
                  {!viewer && (
                    <div className="b2b-quick" aria-label="คำถามด่วน">
                      {chips.map((q) => (
                        <button type="button" key={q} className={text === q ? "active" : ""} onClick={() => ask(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {sample && <small className="b2b-sample-compose">{SAMPLE_SENT} — ลองพิมพ์หรือกดคำถามด่วนได้</small>}
              <div>
                <textarea
                  ref={input}
                  aria-label={"ข้อความถึง " + thread.company.name}
                  placeholder={viewer ? "ผู้ชมอ่านได้อย่างเดียว" : topic ? "ถามเกี่ยวกับโพสต์นี้…" : `พิมพ์ข้อความในนาม ${ctx.company.name}…`}
                  value={text}
                  rows={1}
                  maxLength={4000}
                  disabled={viewer || busy}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button className="primary" aria-label="ส่งข้อความ" disabled={viewer || busy || !text.trim()}>
                  <Send size={18} />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="b2b-placeholder">
            {error && !sampleMode ? (
              <p className="form-error">{error}</p>
            ) : (
              <Empty title="เลือกบริษัทที่ต้องการคุย" description="แชทนี้ใช้ติดต่อระหว่างบริษัท ทุกคนในบริษัทของคุณเห็นข้อความเดียวกัน" />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
