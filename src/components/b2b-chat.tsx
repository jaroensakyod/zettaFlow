"use client";
// แชท page: the team's department rooms, and B2B chat with other companies on the network.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, MessagesSquare, Send, Users, ArrowLeft, FileText } from "lucide-react";
import type { Context } from "@/lib/types";
import type { B2bMessage, B2bThread } from "@/lib/b2b";
import { api, Empty, Loading } from "./shared";
import { Chat } from "./tools";
import { CompanyLogo, kindLabel, since } from "./feed";

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
      <div className="chat-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "team"} className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>
          <Users size={16} /> แชทในทีม
        </button>
        <button role="tab" aria-selected={tab === "b2b"} className={tab === "b2b" ? "active" : ""} onClick={() => setTab("b2b")}>
          <Building2 size={16} /> คุยกับบริษัทอื่น
          {unread > 0 && <b className="li-alert-count">{unread}</b>}
        </button>
      </div>
      {tab === "team" ? <Chat ctx={ctx} notify={notify} /> : <B2bChat ctx={ctx} notify={notify} navigate={navigate} onRead={setUnread} />}
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
    [active, setActive] = useState<string | null>(params.get("b2b")),
    [messages, setMessages] = useState<B2bMessage[] | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    bottom = useRef<HTMLDivElement>(null),
    viewer = ctx.member.role === "viewer";
  const loadThreads = useCallback(async () => {
    const list: B2bThread[] = await api("/b2b");
    setThreads(list);
    onRead(list.reduce((n, t) => n + (t.id === active ? 0 : Number(t.unread)), 0));
    return list;
  }, [active, onRead]);
  // "ส่งข้อความ" from the feed: chat?with=<company>&post=<post> opens (or starts) that conversation.
  const target = params.get("with"),
    fromPost = params.get("post");
  useEffect(() => {
    if (!target) return;
    api("/b2b/open", { method: "POST", body: { company: target, post: fromPost } })
      .then((r: { id: string }) => {
        setActive(r.id);
        router.replace("/workspace/chat?b2b=" + r.id);
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
    if (!active) return;
    setMessages(null);
    const load = () =>
      api("/b2b/" + active)
        .then(setMessages)
        .catch((e) => setError((e as Error).message));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages?.length]);
  const thread = threads?.find((t) => t.id === active),
    postRef = thread?.post && (fromPost === thread.post.id || !messages?.length) ? thread.post : null;
  return (
    <section className={"card b2b" + (active ? " open" : "")}>
      <aside className="b2b-list" aria-label="บริษัทที่คุยด้วย">
        <h3>
          <MessagesSquare size={16} /> คุยกับบริษัทอื่น
        </h3>
        {!threads ? (
          <Loading />
        ) : threads.length ? (
          threads.map((t) => (
            <button
              key={t.id}
              className={"b2b-thread" + (t.id === active ? " active" : "")}
              onClick={() => {
                setActive(t.id);
                router.replace("/workspace/chat?b2b=" + t.id);
              }}
            >
              <CompanyLogo id={t.company.id} name={t.company.name} logo={t.company.has_logo} size={40} />
              <span>
                <strong>{t.company.name}</strong>
                <small>{t.last ? (t.last.mine ? "คุณ: " : "") + t.last.body : t.post ? "เรื่อง: " + t.post.title : "ยังไม่มีข้อความ"}</small>
              </span>
              <span className="b2b-thread-meta">
                {t.last && <time>{since(t.last.at)}</time>}
                {t.id !== active && Number(t.unread) > 0 && <b className="li-alert-count">{t.unread}</b>}
              </span>
            </button>
          ))
        ) : (
          <div className="b2b-empty">
            <p>ยังไม่มีบทสนทนากับบริษัทอื่น</p>
            <small>กด “ส่งข้อความ” ที่โพสต์หรือบริษัทแนะนำในเครือข่ายธุรกิจเพื่อเริ่มคุย</small>
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
              <CompanyLogo id={thread.company.id} name={thread.company.name} logo={thread.company.has_logo} size={40} />
              <span>
                <strong>{thread.company.name}</strong>
                <small>{[thread.company.industry, thread.company.province].filter(Boolean).join(" · ") || "บริษัทในเครือข่าย"}</small>
              </span>
            </header>
            <div className="b2b-messages">
              {!messages ? (
                <Loading />
              ) : messages.length ? (
                messages.map((m) => (
                  <div className={"b2b-msg" + (m.mine ? " mine" : "")} key={m.id}>
                    <small>
                      {m.mine ? m.author_name : (m.company_name || thread.company.name) + " · " + m.author_name} · {since(m.created_at)}
                    </small>
                    {m.post && (
                      <span className="b2b-ref">
                        <FileText size={13} /> {kindLabel[m.post.kind]}: {m.post.title}
                      </span>
                    )}
                    <p>{m.body}</p>
                  </div>
                ))
              ) : (
                <Empty title={"เริ่มคุยกับ " + thread.company.name} description="ข้อความเห็นได้ทุกคนในสองบริษัทนี้เท่านั้น" />
              )}
              <div ref={bottom} />
            </div>
            {error && <p className="form-error">{error}</p>}
            <form
              className="b2b-compose"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!text.trim()) return;
                setBusy(true);
                try {
                  const m: B2bMessage = await api("/b2b/" + thread.id, {
                    method: "POST",
                    body: { body: text, post: postRef?.id || null },
                  });
                  setMessages((list) => [...(list || []), m]);
                  setText("");
                  loadThreads().catch(() => {});
                } catch (err) {
                  notify((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {postRef && (
                <span className="b2b-ref compose">
                  <FileText size={13} /> เกี่ยวกับ {kindLabel[postRef.kind]}: {postRef.title}
                </span>
              )}
              <div>
                <textarea
                  aria-label={"ข้อความถึง " + thread.company.name}
                  placeholder={viewer ? "ผู้ชมอ่านได้อย่างเดียว" : `พิมพ์ข้อความในนาม ${ctx.company.name}…`}
                  value={text}
                  rows={2}
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
            {error ? <p className="form-error">{error}</p> : <Empty title="เลือกบริษัทที่ต้องการคุย" description="แชทนี้ใช้ติดต่อระหว่างบริษัท ทุกคนในบริษัทของคุณเห็นข้อความเดียวกัน" />}
          </div>
        )}
      </div>
    </section>
  );
}
