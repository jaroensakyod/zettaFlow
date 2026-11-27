"use client";
// แชท page: the team's department rooms, and B2B chat with other companies on the network.
// A conversation opened from a feed post shows that post as a card, with ready-made questions for its kind.
// With no conversation yet (or in the public demo) the list shows a labelled sample inbox (lib/mock/b2b.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Send, Users, ArrowLeft, FileText, MapPin, Wallet, Clock3, ExternalLink, X, Sparkles, MessageCircleQuestion, ReceiptText, Megaphone, Settings2, Handshake, Info, MoreHorizontal, PanelRight, Pin, Briefcase, Phone, Mail, Globe, Search, Smile } from "lucide-react";
import type { Context, FeedPost } from "@/lib/types";
import type { CompanyProfile } from "@/lib/feed";
import type { B2bCompany, B2bFile, B2bMessage, B2bPostRef, B2bThread } from "@/lib/b2b";
import { b2bSample, isSampleThread, quickQuestions, sampleThreadFor, SAMPLE_NOTE, SAMPLE_SENT, type SampleThread } from "@/lib/mock/b2b";
import { api, Empty, Loading } from "./shared";
import { Chat } from "./tools";
import { CompanyLogo, employmentLabels, kindLabel, profileView, since } from "./feed";
import { DealBar, DealCardView, DealPanel, PayForm, RequestForm, StepForm, sampleDeal, sampleWorkDeal, type DealStepKind } from "./deal-room";
import type { Deal, DealCard } from "@/lib/b2b-deal-types";
import { AttachButton, MessageFiles, PendingFiles } from "./chat-people";
import { QuoteEditor } from "./quote-editor";

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
  // No page header: the switch between team chat and other companies sits at the top of the list column,
  // so the conversation gets the whole height of the screen.
  const tabs = (
    <div className="chat-tabs chat-switch" role="tablist" aria-label="แชท">
      <button role="tab" aria-selected={tab === "team"} className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>
        <Users size={15} /> ในทีม
      </button>
      <button role="tab" aria-selected={tab === "b2b"} className={tab === "b2b" ? "active" : ""} onClick={() => setTab("b2b")}>
        <Building2 size={15} /> บริษัทอื่น
        {unread > 0 && <b className="li-alert-count">{unread}</b>}
      </button>
    </div>
  );
  return (
    <div className="chat-hub">
      {tab === "team" ? <Chat ctx={ctx} notify={notify} top={tabs} /> : <B2bChat ctx={ctx} notify={notify} navigate={navigate} onRead={setUnread} top={tabs} />}
    </div>
  );
}

/** What เสนอตัว / สมัคร fills in. It starts with “สนใจเสนอตัว / สนใจสมัคร” so the poster's alert says it is an offer (feed.tsx). */
const offerMessage: Record<string, string> = {
  partner: "สนใจเสนอตัวเป็นพาร์ทเนอร์สำหรับงานนี้ ขอส่งรายละเอียดบริษัทและผลงานให้พิจารณา",
  job: "สนใจสมัครงานนี้ ขอส่งประวัติและผลงานให้พิจารณา",
};
/** What the poster usually answers first: the details of the work, filled from their own post. */
const posterReplies = (post: B2bPostRef) => {
  const m = post.meta || {};
  return [
    "ขอบคุณที่สนใจค่ะ รายละเอียดงานมีดังนี้\n• งาน: " + post.title + "\n• ขอบเขตงาน: \n• สถานที่: " + (m.location || "") + "\n• งบประมาณ: " + (m.budget || "") + "\n• กำหนดเสร็จ: ",
    "ขอดูผลงานที่ผ่านมาและใบรับรองบริษัทได้ไหมคะ",
    "สะดวกนัดคุยหรือเข้าดูหน้างานวันไหนคะ",
    "สรุปตามนี้ เดี๋ยวส่งใบเสนอราคาให้ในแชทนี้นะคะ",
  ];
};
/** Type of a picked file when the browser leaves it blank (some systems do for .docx / .xlsx). */
const extTypes: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const mimeOf = (f: File) => f.type || extTypes[f.name.split(".").pop()?.toLowerCase() || ""] || "";
const imageSrc = (path: string) => (path.startsWith("data:") ? path : "/api/feed/image/" + path);
const companyLogo = (c: { id: string; name: string; has_logo: boolean; logo_url?: string }, size: number) => (
  <CompanyLogo id={c.id} name={c.name} logo={c.logo_url || c.has_logo} size={size} />
);
/** The person who wrote a message: their picture when they uploaded one, with their company's logo as a badge. */
const senderFace = (m: B2bMessage, company: { id: string; name: string; has_logo: boolean; logo_url?: string }) =>
  m.author_id && m.avatar_at ? (
    <span className="b2b-face">
      <img src={`/api/avatar/${m.author_id}?v=${encodeURIComponent(m.avatar_at)}`} alt="" width={38} height={38} loading="lazy" />
      <span className="b2b-face-co">{companyLogo(company, 18)}</span>
    </span>
  ) : (
    companyLogo(company, 38)
  );
/** Emoji the picker offers (inserted into the message as text). */
const EMOJI = ["👍", "🙏", "😊", "😄", "🎉", "✅", "👌", "🤝", "💯", "🔥", "❤️", "👏", "🙂", "😅", "🤔", "📌", "📎", "📄", "💰", "🚚", "⏰", "📅", "✨", "🙌"];
type ThreadFilter = "all" | "unread" | "post";

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
  top,
}: {
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
  onRead: (n: number) => void;
  top?: ReactNode;
}) {
  const params = useSearchParams(),
    router = useRouter(),
    [threads, setThreads] = useState<B2bThread[] | null>(null),
    [samples, setSamples] = useState<SampleThread[]>(() => b2bSample()),
    [active, setActive] = useState<string | null>(params.get("b2b")),
    // The side panel (รายละเอียดงาน / ข้อมูลบริษัท): open by default on wide screens, remembered; a slide-over / bottom sheet
    // on smaller ones, closed until asked for.
    [panel, setPanel] = useState(false),
    [leaving, setLeaving] = useState(false),
    [panelTab, setPanelTab] = useState<"job" | "company">("job"),
    [profile, setProfile] = useState<CompanyProfile | null | undefined>(undefined),
    [more, setMore] = useState(false),
    [emoji, setEmoji] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<ThreadFilter>("all"),
    [messages, setMessages] = useState<B2bMessage[] | null>(null),
    [topic, setTopic] = useState<B2bPostRef | null>(null),
    [text, setText] = useState(""),
    [pending, setPending] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    viewer = ctx.member.role === "viewer",
    // ห้องดีล: the deals of the open conversation and the form being filled
    [deals, setDeals] = useState<Deal[]>([]),
    [form, setForm] = useState<
      | null
      | { kind: "request" }
      | { kind: "quote"; deal?: Deal | null; from?: DealCard | null; post?: B2bPostRef | null; notes?: string }
      | { kind: "step"; step: DealStepKind; deal: Deal }
      | { kind: "pay"; card: DealCard }
    >(null);
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
  // &intent=offer (เสนอตัว / สมัคร on a job or partner post) also fills in the offer, ready to send.
  const target = params.get("with"),
    fromPost = params.get("post"),
    intent = params.get("intent");
  const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("ef.b2b.panel");
    } catch {}
    if (wide() && saved !== "0") setPanel(true);
  }, []);
  const remember = (open: boolean) => {
    // Only the wide layout remembers: there the panel sits beside the chat; elsewhere it covers it.
    if (!wide()) return;
    try {
      localStorage.setItem("ef.b2b.panel", open ? "1" : "0");
    } catch {}
  };
  const openPanel = (tab: "job" | "company") => {
    setPanelTab(tab);
    setPanel(true);
    remember(true);
  };
  // Closing slides the panel out first (instantly when the system asks for less motion).
  const closePanel = () => {
    remember(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setPanel(false);
    setLeaving(true);
    setTimeout(() => {
      setPanel(false);
      setLeaving(false);
    }, 200);
  };
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
          if (intent === "offer" && t.post) ask(offerMessage[t.post.kind] || offerMessage.partner);
          select(t.id);
        });
      return;
    }
    api("/b2b/open", { method: "POST", body: { company: target, post: fromPost } })
      .then((r: { id: string; post?: B2bPostRef | null }) => {
        setTopic(r.post || null);
        if (intent === "offer" && r.post) ask(offerMessage[r.post.kind] || offerMessage.partner);
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
  // Deals follow the messages (each deal step is also a chat line), so they refresh when a line arrives.
  const loadDeals = useCallback(() => {
    if (!active || isSampleThread(active)) return;
    api("/b2b/" + active + "/deals")
      .then(setDeals)
      .catch(() => {});
  }, [active]);
  useEffect(() => {
    setDeals([]);
    loadDeals();
  }, [loadDeals]);
  // ข้อมูลบริษัท: the other company's public profile (only what it lets other companies see).
  const otherId = list?.find((t) => t.id === active)?.company.id;
  useEffect(() => {
    setProfile(undefined);
    if (!otherId || !panel || panelTab !== "company" || (active && isSampleThread(active))) return;
    let live = true;
    api("/feed/profile/" + otherId)
      .then((p: CompanyProfile) => live && setProfile(p))
      .catch(() => live && setProfile(null));
    return () => {
      live = false;
    };
  }, [otherId, panel, panelTab, active]);
  useEffect(() => {
    if (messages?.some((m) => m.card_id)) loadDeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length]);
  // The public demo shows one sample deal in its first sample conversation.
  const shownDeals = sample ? (list?.[0]?.id === sample.id ? [sampleDeal(sample.id, sample.company.name, "seller")] : list?.[1]?.id === sample.id ? [sampleDeal(sample.id, sample.company.name, "buyer")] : list?.[2]?.id === sample.id ? [sampleWorkDeal(sample.company.name)] : []) : deals,
    cardIndex = new Map(shownDeals.flatMap((d) => d.cards.map((c) => [c.id, { card: c, deal: d }] as const))),
    firstLine = new Set<string>(),
    dealChanged = () => {
      loadDeals();
      if (active && !isSampleThread(active)) api("/b2b/" + active).then(setMessages).catch(() => {});
      loadThreads().catch(() => {});
    };
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
    if (!thread || (!text.trim() && !pending.length)) return;
    const body = text.trim();
    if (sample && pending.length) return notify("ตัวอย่างแนบไฟล์ไม่ได้ — ส่งไฟล์ได้จริงเมื่อคุยกับบริษัทในเครือข่าย");
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
      // Files go straight to storage (the conversation's folder), then the message names them.
      const files: B2bFile[] = [];
      for (const f of pending) {
        const mime = mimeOf(f),
          up: { path: string; url: string } = await api(`/b2b/${thread.id}/upload`, { method: "POST", body: { name: f.name, mime, size: f.size } });
        const put = await fetch(up.url, { method: "PUT", headers: { "Content-Type": mime, "x-upsert": "false" }, body: f });
        if (!put.ok) throw new Error("อัปโหลด " + f.name + " ไม่สำเร็จ กรุณาลองใหม่");
        files.push({ path: up.path, name: f.name.slice(0, 200), mime, size: f.size });
      }
      const m: B2bMessage = await api("/b2b/" + thread.id, { method: "POST", body: { body, post: topic?.id || null, files } });
      setMessages((list) => [...(list || []), { ...m, post: m.post ?? topic }]);
      setText("");
      setPending([]);
      setTopic(null);
      loadThreads().catch(() => {});
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  /** A ready-made line sent as is (what is being typed and the files waiting stay in the box). */
  const sendReady = async (body: string) => {
    if (!thread || busy) return;
    if (sample) {
      const m: B2bMessage = { id: sample.id + "-local-" + Date.now(), company_id: "sample-own", author_name: ctx.member.name || "คุณ", body, created_at: new Date().toISOString(), mine: true };
      setSamples((all) => all.map((t) => (t.id === sample.id ? { ...t, messages: [...t.messages, m], last: { body, mine: true, at: m.created_at }, last_at: m.created_at } : t)));
      return notify(SAMPLE_SENT);
    }
    setBusy(true);
    try {
      const m: B2bMessage = await api("/b2b/" + thread.id, { method: "POST", body: { body } });
      setMessages((list) => [...(list || []), m]);
      notify("ส่งคำขอใบเสนอราคาในแชทแล้ว");
      loadThreads().catch(() => {});
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // The box grows with what is typed (up to about half the screen, then it scrolls), so a long message can be read
  // in full before it is sent; it shrinks back after sending.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    // Empty: one line (a long placeholder would otherwise make the box tall).
    if (!text) return;
    el.style.height = Math.min(el.scrollHeight + 2, Math.max(160, Math.round(window.innerHeight * 0.45))) + "px";
  }, [text, thread?.id]);
  const chips = useMemo(() => (topic ? quickQuestions[topic.kind] : []), [topic]);
  // A conversation about a job / partner post: the posting company explains the work and sends the quotation; the
  // company that offered itself asks for one (it has no "ส่งใบเสนอราคา").
  const post = thread?.post || null,
    ownerId = post?.company?.id || null,
    amOwner = !!ownerId && ownerId === ctx.company.id,
    jobPost = !!post && (post.kind === "partner" || post.kind === "job"),
    canQuote = !jobPost || amOwner,
    canRequest = !jobPost || !amOwner,
    talked = !!shown && shown.some((m) => m.mine && !m.card_id) && shown.some((m) => !m.mine && !m.card_id),
    quoteReady = jobPost && amOwner && talked && !shownDeals.length,
    // What the quotation refers to: the post and the details both sides wrote in this chat.
    agreed = () => {
      const fromOwner = (shown || [])
          .filter((m) => !m.card_id && m.body.length > 20)
          .slice(-4)
          .map((m) => m.body),
        meta = post?.meta || {};
      return [
        post ? "อ้างอิงประกาศ: " + post.title : "",
        meta.location ? "สถานที่: " + meta.location : "",
        meta.budget ? "งบประมาณตามประกาศ: " + meta.budget : "",
        fromOwner.length ? "รายละเอียดที่ตกลงในแชท:\n" + fromOwner.join("\n") : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1900);
    },
    startQuote = () => setForm({ kind: "quote", post, notes: agreed() }),
    me = { id: ctx.company.id, name: ctx.company.name, has_logo: !!ctx.company.profile?.logo };
  const q = query.trim().toLowerCase(),
    shownList = (list || []).filter(
      (t) =>
        (filter === "all" || (filter === "unread" ? Number(t.unread) > 0 && t.id !== active : !!t.post)) &&
        (!q || [t.company.name, t.post?.title, t.last?.body].some((x) => x && x.toLowerCase().includes(q))),
    );
  // A document in the side panel: bring its card into view in the chat (closing the panel where it covers the chat).
  const showCard = (id: string) => {
    if (!wide()) closePanel();
    requestAnimationFrame(() => {
      const el = document.getElementById("deal-card-" + id);
      if (!el) return;
      el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    });
  };
  const pick = (files: File[]) => {
    const big = files.find((f) => f.size > 10_000_000);
    if (big) notify(big.name + " ใหญ่เกิน 10 MB");
    setPending((all) => [...all, ...files.filter((f) => f.size <= 10_000_000)].slice(0, 10));
  };
  const putEmoji = (e: string) => {
    const el = input.current,
      at = el?.selectionStart ?? text.length,
      end = el?.selectionEnd ?? at;
    setText((t) => t.slice(0, at) + e + t.slice(end));
    setEmoji(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + e.length, at + e.length);
    });
  };
  return (
    <section className={"card b2b glass" + (active && thread ? " open" : "") + (thread && panel ? " has-panel" : "")}>
      <aside className="b2b-list" aria-label="บริษัทที่คุยด้วย">
        {top}
        <div className="b2b-list-head">
          <b>บริษัทที่คุยด้วย</b>
          {sampleMode && (
            <span className="sample-badge" title={SAMPLE_NOTE}>
              <Sparkles size={11} /> ตัวอย่าง
            </span>
          )}
        </div>
        <div className="b2b-me">
          {companyLogo(me, 40)}
          <span>
            <small>คุยในนามบริษัท</small>
            <b>{ctx.company.name}</b>
          </span>
          <button type="button" className="icon-button" title="รูปที่คู่ค้าเห็นคือโลโก้บริษัท · เปลี่ยนได้ที่ตั้งค่าบริษัท" aria-label="เปลี่ยนโลโก้บริษัท" onClick={() => navigate("settings")}>
            <Settings2 size={16} />
          </button>
        </div>
        <label className="b2b-search">
          <Search size={15} />
          <input type="search" placeholder="ค้นหาบริษัทหรือข้อความ" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="ค้นหาบทสนทนา" />
        </label>
        <div className="b2b-filters" role="tablist" aria-label="กรองแชท">
          {(
            [
              ["all", "ทั้งหมด"],
              ["unread", "ยังไม่อ่าน"],
              ["post", "จากประกาศ"],
            ] as [ThreadFilter, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        {!list ? (
          <Loading />
        ) : !shownList.length ? (
          <p className="b2b-none">{query || filter !== "all" ? "ไม่พบบทสนทนาที่ตรงกัน" : "ยังไม่มีบทสนทนา"}</p>
        ) : (
          shownList.map((t) => (
            <button
              key={t.id}
              className={"b2b-thread" + (t.id === active ? " active" : "")}
              onClick={() => {
                select(t.id);
                setTopic(null);
                setText("");
                setPending([]);
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
              {companyLogo(thread.company, 42)}
              <span className="b2b-head-name">
                <strong>
                  {thread.company.name} {sample && <span className="sample-badge">ตัวอย่าง</span>}
                </strong>
                <small>{[thread.company.industry, thread.company.province].filter(Boolean).join(" · ") || "บริษัทในเครือข่าย"}</small>
              </span>
              {jobPost && (
                <span className="b2b-roles">
                  <em className={amOwner ? "owner" : "offer"}>คุณ · {amOwner ? "เจ้าของประกาศ" : "ผู้เสนอตัว"}</em>
                  <em className={amOwner ? "offer" : "owner"}>
                    {thread.company.name} · {amOwner ? "ผู้เสนอตัว" : "เจ้าของประกาศ"}
                  </em>
                </span>
              )}
              <span className="b2b-head-acts">
                <button type="button" className={"b2b-round" + (panel && panelTab === "company" ? " on" : "")} aria-label="ข้อมูลบริษัท" title="ข้อมูลบริษัท" onClick={() => openPanel("company")}>
                  <Info size={18} />
                </button>
                <span className="b2b-more">
                  <button type="button" className={"b2b-round" + (more ? " on" : "")} aria-label="เมนูเพิ่มเติม" aria-expanded={more} onClick={() => setMore((v) => !v)}>
                    <MoreHorizontal size={18} />
                  </button>
                  {more && (
                    <span className="b2b-menu" role="menu" onMouseLeave={() => setMore(false)}>
                      <button type="button" role="menuitem" onClick={() => (setMore(false), openPanel("job"))}>
                        <PanelRight size={15} /> รายละเอียดงาน
                      </button>
                      {!sample && (
                        <button type="button" role="menuitem" onClick={() => (setMore(false), navigate(profileView(thread.company.id, ctx)))}>
                          <Building2 size={15} /> ดูโปรไฟล์บริษัท
                        </button>
                      )}
                      {post && (
                        <button type="button" role="menuitem" onClick={() => (setMore(false), openPost())}>
                          <ExternalLink size={15} /> ดูโพสต์ต้นทาง
                        </button>
                      )}
                    </span>
                  )}
                </span>
              </span>
            </header>
            <DealBar
              deals={shownDeals}
              disabled={viewer}
              detailsOpen={panel && panelTab === "job"}
              onDetails={() => (panel && panelTab === "job" ? closePanel() : openPanel("job"))}
              // On a job / partner post the company that offered only asks in the chat; the poster writes the quotation.
              onRequest={() =>
                jobPost && !amOwner && post
                  ? sendReady(`ขอใบเสนอราคาสำหรับงาน “${post.title}” ตามรายละเอียดที่คุยกันด้วยค่ะ`)
                  : setForm({ kind: "request" })
              }
              onQuote={() => (shownDeals.length ? setForm({ kind: "quote" }) : startQuote())}
              canRequest={canRequest}
              canQuote={canQuote}
            />
            <div className="b2b-messages" key={thread.id}>
              {post && (
                <button type="button" className={"b2b-pin kind-" + post.kind} onClick={openPost} title="ดูโพสต์ต้นฉบับ">
                  {post.image ? <img src={imageSrc(post.image)} alt="" /> : <span className="b2b-pin-icon"><Handshake size={20} /></span>}
                  <span className="b2b-pin-text">
                    <small>
                      <Pin size={11} /> {kindLabel[post.kind]} ที่คุยกันอยู่
                    </small>
                    <b>{post.title}</b>
                    {post.excerpt && post.excerpt.trim() !== post.title.trim() && <span className="b2b-pin-excerpt">{post.excerpt}</span>}
                    {(post.meta?.budget || post.meta?.location) && (
                      <span className="b2b-pin-meta">
                        {post.meta?.budget && (
                          <em>
                            <Wallet size={12} /> {post.meta.budget}
                          </em>
                        )}
                        {post.meta?.location && (
                          <em>
                            <MapPin size={12} /> {post.meta.location}
                          </em>
                        )}
                      </span>
                    )}
                  </span>
                  <ExternalLink size={15} className="b2b-pin-go" />
                </button>
              )}

              {!shown ? (
                <Loading />
              ) : (
                <>
                  {!shown.length && !pendingCard && (
                    <Empty title={"เริ่มคุยกับ " + thread.company.name} description="ข้อความเห็นได้ทุกคนในสองบริษัทนี้เท่านั้น" />
                  )}
                  {shown.map((m, i) => {
                    const day = new Date(m.created_at).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" }),
                      newDay = i === 0 || new Date(shown[i - 1].created_at).toDateString() !== new Date(m.created_at).toDateString(),
                      divider = newDay ? (
                        <div className="b2b-day" key={"d" + m.id}>
                          <span>{new Date(m.created_at).toDateString() === new Date().toDateString() ? "วันนี้" : day}</span>
                        </div>
                      ) : null;
                    const hit = m.card_id ? cardIndex.get(m.card_id) : undefined;
                    if (hit && m.card_id) {
                      const first = !firstLine.has(m.card_id);
                      firstLine.add(m.card_id);
                      return first ? (
                        [divider,
                        <div className={"b2b-msg deal" + (m.mine ? " mine" : "")} key={m.id} id={"deal-card-" + m.card_id}>
                          <DealCardView
                            card={hit.card}
                            deal={hit.deal}
                            ctx={ctx}
                            notify={notify}
                            navigate={navigate}
                            onChanged={dealChanged}
                            onQuote={(from) => setForm({ kind: "quote", deal: hit.deal, from })}
                            onPay={(card) => setForm({ kind: "pay", card })}
                          />
                        </div>]
                      ) : (
                        [divider,
                        <div className="b2b-deal-line" key={m.id}>
                          <span>{m.body}</span>
                          <small>
                            {m.author_name} · {since(m.created_at)}
                          </small>
                        </div>]
                      );
                    }
                    // Every message says who sent it: the company (its logo and name) and the person who wrote it.
                    const company = m.mine ? { ...me, has_logo: m.company_has_logo ?? me.has_logo } : thread.company;
                    return [divider,
                      <div className={"b2b-msg person" + (m.mine ? " mine" : "")} key={m.id}>
                        {senderFace(m, company)}
                        <div className="b2b-msg-body">
                          <small className="b2b-who">
                            <b>{m.company_name || company.name}</b>
                            {ownerId && (m.mine ? ctx.company.id : thread.company.id) === ownerId && <em className="b2b-owner">เจ้าของประกาศ</em>}
                            <span>{m.author_name}</span>
                            <time>{since(m.created_at)}</time>
                          </small>
                          {m.post &&
                            (m.post.excerpt !== undefined || m.post.image || m.post.company ? (
                              <ChatPostCard post={m.post} onOpen={openPost} onAsk={m.post.id !== topic?.id ? () => setTopic(m.post!) : undefined} />
                            ) : (
                              <span className="b2b-ref">
                                <FileText size={13} /> {kindLabel[m.post.kind]}: {m.post.title}
                              </span>
                            ))}
                          {m.body && <p>{m.body}</p>}
                          {m.files && m.files.length > 0 && <MessageFiles thread={thread.id} files={m.files} />}
                        </div>
                      </div>];
                  })}
                  {/* the sample deal's cards (demo) */}
                  {sample &&
                    shownDeals.flatMap((d) =>
                      d.cards.map((c) => (
                        <div className={"b2b-msg deal" + (c.mine ? " mine" : "")} key={c.id} id={"deal-card-" + c.id}>
                          <DealCardView card={c} deal={d} ctx={ctx} sample notify={notify} navigate={navigate} onChanged={() => {}} onQuote={(from) => setForm({ kind: "quote", deal: d, from })} onPay={(card) => setForm({ kind: "pay", card })} />
                        </div>
                      )),
                    )}
                  {quoteReady && !viewer && (
                    <div className="b2b-next">
                      <ReceiptText size={18} />
                      <span>
                        <b>คุยรายละเอียดครบแล้ว?</b>
                        <small>ส่งใบเสนอราคาให้ {thread.company.name} ได้เลย ระบบกรอกชื่องานและรายละเอียดจากประกาศและแชทนี้ให้</small>
                      </span>
                      <button type="button" className="primary" onClick={startQuote}>
                        ส่งใบเสนอราคา
                      </button>
                    </div>
                  )}
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
              {amOwner && !topic && !viewer && post && (
                <div className="b2b-topic-bar">
                  <span className="b2b-ref compose">
                    <Megaphone size={13} /> ประกาศของคุณ: <b>{post.title}</b> · ตอบรายละเอียดงานให้ผู้สนใจ
                  </span>
                  <div className="b2b-quick" aria-label="ตอบด่วน">
                    {posterReplies(post).map((q) => (
                      <button type="button" key={q} className={text === q ? "active" : ""} onClick={() => ask(q)}>
                        {q.split("\n")[0]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <PendingFiles files={pending} onRemove={(i) => setPending((all) => all.filter((_, n) => n !== i))} />
              {sample && <small className="b2b-sample-compose">{SAMPLE_SENT} — ลองพิมพ์หรือกดคำถามด่วนได้</small>}
              <div>
                <AttachButton disabled={viewer || busy} onPick={pick} />
                <AttachButton disabled={viewer || busy} onPick={pick} images />
                <span className="b2b-emoji">
                  <button type="button" className="b2b-attach" aria-label="อีโมจิ" title="อีโมจิ" aria-expanded={emoji} disabled={viewer || busy} onClick={() => setEmoji((v) => !v)}>
                    <Smile size={18} />
                  </button>
                  {emoji && (
                    <span className="b2b-emoji-pop" role="menu" onMouseLeave={() => setEmoji(false)}>
                      {EMOJI.map((e) => (
                        <button type="button" key={e} role="menuitem" onClick={() => putEmoji(e)}>
                          {e}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
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
                <button className="primary b2b-send" aria-label="ส่งข้อความ" disabled={viewer || busy || (!text.trim() && !pending.length)}>
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
      {thread && panel && (
        <>
          <div className="b2b-scrim" onClick={closePanel} aria-hidden />
          <aside className={"b2b-info" + (leaving ? " leaving" : "")} aria-label="รายละเอียด">
            <span className="b2b-grab" aria-hidden />
            <div className="b2b-info-tabs" role="tablist">
              <button role="tab" aria-selected={panelTab === "job"} className={panelTab === "job" ? "on" : ""} onClick={() => setPanelTab("job")}>
                <Briefcase size={14} /> รายละเอียดงาน
              </button>
              <button role="tab" aria-selected={panelTab === "company"} className={panelTab === "company" ? "on" : ""} onClick={() => setPanelTab("company")}>
                <Building2 size={14} /> ข้อมูลบริษัท
              </button>
              <button type="button" className="b2b-info-close" aria-label="ปิดรายละเอียด" onClick={closePanel}>
                <X size={16} />
              </button>
            </div>
            <div className="b2b-info-body" key={panelTab}>
              {panelTab === "job" ? (
                <>
                  {post && (
                    <div className="dp-post">
                      <small>{kindLabel[post.kind]}</small>
                      <b>{post.title}</b>
                      {(post.meta?.budget || post.meta?.location) && (
                        <span>{[post.meta?.budget && "งบ " + post.meta.budget, post.meta?.location].filter(Boolean).join(" · ")}</span>
                      )}
                    </div>
                  )}
                  <DealPanel
                    deals={shownDeals}
                    disabled={viewer}
                    talking={!!shown?.some((m) => !m.card_id)}
                    theirName={thread.company.name}
                    onStep={(step, deal) => setForm({ kind: "step", step, deal })}
                    onShowCard={showCard}
                    onOpenProject={() => navigate("projects")}
                    onTake={(deal) =>
                      sample
                        ? notify(SAMPLE_SENT)
                        : api(`/b2b/deals/${deal.id}/take`, { method: "POST" })
                            .then(() => {
                              notify("คุณเป็นผู้ดูแลดีลนี้แล้ว");
                              dealChanged();
                            })
                            .catch((e) => notify((e as Error).message))
                    }
                  />
                </>
              ) : (
                <div className="dp-company">
                  {companyLogo(thread.company, 72)}
                  <b>{profile?.name || thread.company.name}</b>
                  <small>{[profile?.industry || thread.company.industry, profile?.province || thread.company.province].filter(Boolean).join(" · ") || "บริษัทในเครือข่าย"}</small>
                  {profile?.bio && <p className="dp-bio">{profile.bio}</p>}
                  {profile?.about && <p className="dp-about">{profile.about}</p>}
                  {profile === undefined && !sample && <Loading />}
                  {profile && (
                    <ul className="dp-contacts">
                      {profile.details?.phone && (
                        <li>
                          <Phone size={14} /> <a href={"tel:" + profile.details.phone.replace(/[^\d+]/g, "")}>{profile.details.phone}</a>
                        </li>
                      )}
                      {profile.details?.email && (
                        <li>
                          <Mail size={14} /> <a href={"mailto:" + profile.details.email}>{profile.details.email}</a>
                        </li>
                      )}
                      {profile.website && (
                        <li>
                          <Globe size={14} />{" "}
                          <a href={/^https?:\/\//i.test(profile.website) ? profile.website : "https://" + profile.website} target="_blank" rel="noreferrer noopener">
                            {profile.website}
                          </a>
                        </li>
                      )}
                      {profile.details?.address && (
                        <li>
                          <MapPin size={14} /> <span>{profile.details.address}</span>
                        </li>
                      )}
                    </ul>
                  )}
                  {!sample && (
                    <button type="button" className="dp-project" onClick={() => navigate(profileView(thread.company.id, ctx))}>
                      <Building2 size={15} /> ดูโปรไฟล์บริษัท
                    </button>
                  )}
                </div>
              )}
            </div>
          </aside>
        </>
      )}
      {form?.kind === "request" && active && (
        <RequestForm
          sample={!!sample}
          thread={active}
          onClose={() => setForm(null)}
          onSent={() => {
            setForm(null);
            notify("ส่งคำขอใบเสนอราคาแล้ว");
            dealChanged();
          }}
        />
      )}
      {form?.kind === "step" && (
        <StepForm
          sample={!!sample}
          deal={form.deal}
          step={form.step}
          onClose={() => setForm(null)}
          onSent={() => {
            setForm(null);
            notify("ส่งในแชทแล้ว");
            dealChanged();
          }}
        />
      )}
      {form?.kind === "pay" && (
        <PayForm
          sample={!!sample}
          invoice={form.card}
          onClose={() => setForm(null)}
          onSent={() => {
            setForm(null);
            notify("แจ้งชำระแล้ว รอผู้รับจ้างยืนยัน");
            dealChanged();
          }}
        />
      )}
      {form?.kind === "quote" && active && thread && (
        // The same quotation document as the ใบเสนอราคา page; sending puts it in this chat as the quotation card.
        <QuoteEditor
          onClose={() => setForm(null)}
          onSaved={() => {}}
          chat={{
            company: thread.company,
            sample: !!sample,
            title: form.from?.data?.title || form.deal?.title || form.post?.title,
            notes: form.from?.kind === "quote" ? form.from.data?.notes || "" : form.notes,
            items: form.from?.data?.items,
            discount: form.from?.kind === "quote" ? Number(form.from.data?.discount) || 0 : 0,
            vatMode: form.from?.kind === "quote" ? form.from.data?.vatMode : undefined,
            validUntil: form.from?.kind === "quote" ? form.from.data?.validUntil : undefined,
            onSend: async (q) => {
              const src = form.from?.kind === "quote" ? form.from.data : undefined;
              await api(`/b2b/${active}/quote`, {
                method: "POST",
                body: {
                  deal: form.deal?.id || null,
                  ...q,
                  // what the document has no field for stays as the earlier version had it
                  deliverBy: src?.deliverBy || src?.needBy || form.from?.data?.needBy || undefined,
                  payTerms: src?.payTerms || undefined,
                  installments: src?.installments?.length ? src.installments : undefined,
                },
              });
              setForm(null);
              notify("ส่งใบเสนอราคาในแชทแล้ว");
              dealChanged();
            },
          }}
        />
      )}
    </section>
  );
}
