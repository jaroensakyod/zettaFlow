"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { X, Send, Megaphone, Trash2, Plus, Save } from "lucide-react";
import { api, Modal, Empty, displayDate } from "./shared";
import type { Context } from "@/lib/types";
import type { Announcement, InboxThread, Promo, SupportMessage } from "@/lib/engage";
import { supportTopic, supportTopics } from "@/lib/support-topics";

const DISMISSED = "zf_dismissed_announcements";
function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED) || "[]");
  } catch {
    return [];
  }
}

/** Shows the newest unseen popup announcement once per browser. */
export function AnnouncementPopup() {
  const [item, setItem] = useState<Announcement | null>(null);
  useEffect(() => {
    api("/public-content")
      .then((d: { announcements: Announcement[] }) => {
        const seen = readDismissed();
        setItem(d.announcements.find((a) => a.popup && !seen.includes(a.id)) || null);
      })
      .catch(() => {});
  }, []);
  if (!item) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISSED, JSON.stringify([...readDismissed(), item.id].slice(-50)));
    } catch {}
    setItem(null);
  };
  return (
    <Modal title={item.title} onClose={close}>
      <div className={"announce " + item.level}>
        <Megaphone size={18} />
        <p>{item.body}</p>
      </div>
      <small className="muted">{displayDate(item.published_at)}</small>
      <div className="modal-footer">
        <button className="primary" onClick={close}>
          รับทราบ
        </button>
      </div>
    </Modal>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
/** One message; a "[subject] " at its start is shown as a tag. */
function SupportBubble({ m, mine }: { m: SupportMessage; mine: boolean }) {
  const { topic, text } = supportTopic(m.body);
  return (
    <div className={"support-msg " + (mine ? "customer" : "admin")}>
      <small>
        {m.name} · {when(m.created_at)}
      </small>
      <p>
        {topic && <span className="support-topic">{topic}</span>}
        {text}
      </p>
    </div>
  );
}

/**
 * Chat with the EliteFlow team (ติดต่อเจ้าหน้าที่). Owners and managers see the company's whole thread; other members
 * see their own messages and the answers to them. Opened by น้องโฟลว์ and other screens with
 * window.dispatchEvent(new Event("ef:support-open")).
 */
export function SupportChat({ ctx }: { ctx: Context }) {
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<SupportMessage[]>([]),
    [text, setText] = useState(""),
    [topic, setTopic] = useState<string>(supportTopics[0]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const whole = ctx.member.role === "owner" || ctx.member.role === "manager";
  const load = useCallback(async (seen: boolean) => {
    try {
      const d = await api("/support" + (seen ? "?seen=true" : ""));
      setMessages(d.messages);
    } catch {}
  }, []);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("ef:support-open", show);
    return () => window.removeEventListener("ef:support-open", show);
  }, []);
  useEffect(() => {
    if (!open) return;
    load(true);
    const t = setInterval(() => !document.hidden && load(true), 8000);
    return () => clearInterval(t);
  }, [open, load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);
  if (!open) return null;
  return (
    <>
      {/* No floating launcher: the chat opens from screens that need it (window event "ef:support-open"); this button only closes it. */}
      <button className="support-fab" aria-label="ปิดแชทเจ้าหน้าที่" onClick={() => setOpen(false)}>
        <X size={22} />
      </button>
      <section className="support-panel" aria-label="คุยกับเจ้าหน้าที่">
        <header>
          <b>คุยกับเจ้าหน้าที่ EliteFlow</b>
          <small>
            ตอบกลับในเวลาทำการ ·{" "}
            {whole ? "เจ้าของและผู้จัดการเห็นทุกข้อความของบริษัท" : "เห็นเฉพาะข้อความของคุณและคำตอบจากเจ้าหน้าที่"}
          </small>
        </header>
        <div className="support-list">
          {messages.map((m) => (
            <SupportBubble key={m.id} m={m} mine={m.sender === "customer"} />
          ))}
          {messages.length === 0 && <p className="muted">ยังไม่มีข้อความ เลือกเรื่องแล้วพิมพ์ถามได้เลย</p>}
          <div ref={end} />
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="support-topics" role="radiogroup" aria-label="เรื่องที่ติดต่อ">
          {supportTopics.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={topic === t} className={topic === t ? "on" : ""} onClick={() => setTopic(t)}>
              {t}
            </button>
          ))}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            setBusy(true);
            setError("");
            try {
              await api("/support", { method: "POST", body: { body: text, topic } });
              setText("");
              await load(true);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="พิมพ์ข้อความถึงเจ้าหน้าที่…" maxLength={3900} aria-label="ข้อความถึงเจ้าหน้าที่" />
          <button className="primary" disabled={busy || !text.trim()} aria-label="ส่ง">
            <Send size={16} />
          </button>
        </form>
      </section>
    </>
  );
}

/** หลังบ้าน → ซัพพอร์ต: every company that wrote in, what about, and a reply box for the thread. */
export function SupportInbox({ notify }: { notify: (s: string) => void }) {
  const [threads, setThreads] = useState<InboxThread[]>([]),
    [current, setCurrent] = useState<InboxThread | null>(null),
    [messages, setMessages] = useState<SupportMessage[]>([]),
    [onlyUnread, setOnlyUnread] = useState(false),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const loadThreads = useCallback(() => api("/admin/support").then(setThreads).catch(() => {}), []);
  const loadMessages = useCallback(
    (t: InboxThread) => api("/admin/support/" + t.company_id).then(setMessages).catch(() => {}),
    [],
  );
  useEffect(() => {
    loadThreads();
    const i = setInterval(() => {
      if (document.hidden) return;
      loadThreads();
      if (current) loadMessages(current);
    }, 10000);
    return () => clearInterval(i);
  }, [loadThreads, loadMessages, current]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);
  const shown = onlyUnread ? threads.filter((t) => t.unread_admin > 0 || t.company_id === current?.company_id) : threads;
  const waiting = threads.filter((t) => t.unread_admin > 0).length;
  return (
    <div className="two-column">
      <section className="card">
        <div className="support-inbox-head">
          <h2>บทสนทนา</h2>
          <label className="muted">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> ยังไม่อ่าน ({waiting})
          </label>
        </div>
        {shown.length === 0 && <Empty title={onlyUnread ? "อ่านครบทุกข้อความแล้ว" : "ยังไม่มีข้อความจากลูกค้า"} />}
        {shown.map((t) => (
          <button
            key={t.company_id}
            className={"admin-thread " + (current?.company_id === t.company_id ? "active " : "") + (t.unread_admin > 0 ? "unread" : "")}
            onClick={() => {
              setCurrent(t);
              loadMessages(t).then(loadThreads);
            }}
          >
            <span className="admin-thread-main">
              <span className="admin-thread-top">
                <b>{t.companies?.name || t.company_id.slice(0, 8)}</b>
                <small>{displayDate(t.updated_at)}</small>
              </span>
              {t.last && (
                <small className="admin-thread-preview">
                  {t.last.topic && <span className="support-topic">{t.last.topic}</span>}
                  {t.last.name}: {t.last.text}
                </small>
              )}
            </span>
            {t.unread_admin > 0 && <span className="support-badge inline">{t.unread_admin}</span>}
          </button>
        ))}
      </section>
      <section className="card">
        {current === null ? (
          <Empty title="เลือกบทสนทนา" />
        ) : (
          <>
            <h2>{current.companies?.name}</h2>
            {current.last?.topic && (
              <p className="muted">
                เรื่องล่าสุด: <span className="support-topic">{current.last.topic}</span> จาก {current.last.name}
              </p>
            )}
            <div className="support-list tall">
              {messages.map((m) => (
                <SupportBubble key={m.id} m={m} mine={m.sender === "admin"} />
              ))}
              <div ref={end} />
            </div>
            <form
              className="support-reply"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!text.trim()) return;
                setBusy(true);
                try {
                  await api("/admin/support/" + current.company_id, { method: "POST", body: { body: text } });
                  setText("");
                  await loadMessages(current);
                  loadThreads();
                } catch (err) {
                  notify((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="ตอบกลับลูกค้า…" maxLength={4000} aria-label="ข้อความตอบกลับ" />
              <button className="primary" disabled={busy || !text.trim()}>
                <Send size={15} /> ส่ง
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

type Row = Partial<Promo & Announcement> & { id?: string };
const placementLabels: Record<string, string> = { landing: "หน้าเว็บไซต์ (โปรโมชัน)", feed: "เครือข่ายธุรกิจ (โฆษณา)", both: "ทั้งสองที่", billing: "หน้าแพ็กเกจบริการ (แบนเนอร์)" };

/** Picture or clip for a promotion: upload a file (straight to storage) or paste an https:// link. */
function PromoMedia({ initial }: { initial: Row }) {
  const [url, setUrl] = useState(initial.media_url || ""),
    [type, setType] = useState<string>(initial.media_type || ""),
    [busy, setBusy] = useState(""),
    [err, setErr] = useState("");
  async function upload(file: File) {
    setErr("");
    setBusy("กำลังอัปโหลด…");
    try {
      const r: { direct: boolean; url?: string; publicUrl?: string; type?: string } = await api("/admin/promo-media", { method: "POST", body: { mime: file.type, size: file.size } });
      if (!r.direct) throw new Error("โหมดเดโมอัปโหลดไฟล์ไม่ได้ ใส่ลิงก์ https:// แทนได้");
      const put = await fetch(r.url!, { method: "PUT", headers: { "Content-Type": file.type, "x-upsert": "false" }, body: file });
      if (!put.ok) throw new Error("อัปโหลดไม่สำเร็จ (" + put.status + ")");
      setUrl(r.publicUrl!);
      setType(r.type!);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="promo-media">
      <input type="hidden" name="media_url" value={url} />
      <input type="hidden" name="media_type" value={url ? type || "image" : ""} />
      <b>รูปหรือคลิปโฆษณา</b>
      <small className="muted">แนะนำแนวนอน 1600×500 px · รูป PNG/JPG/WEBP/GIF หรือคลิป MP4/WEBM ไม่เกิน 50 MB</small>
      {url ? (
        <div className="promo-media-preview">
          {type === "video" ? <video src={url} muted loop autoPlay playsInline /> : <img src={url} alt="" />}
          <button type="button" className="secondary" onClick={() => { setUrl(""); setType(""); }}>
            <Trash2 size={14} /> เอาออก
          </button>
        </div>
      ) : (
        <div className="promo-media-pick">
          <label className="secondary promo-media-file">
            อัปโหลดรูป / คลิป
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <span className="muted">หรือ</span>
          <input
            placeholder="วางลิงก์ https://…"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v) return;
              setUrl(v);
              setType(/\.(mp4|webm)(\?|$)/i.test(v) ? "video" : "image");
            }}
          />
        </div>
      )}
      {busy && <small>{busy}</small>}
      {err && <p className="form-error">{err}</p>}
    </div>
  );
}
export function ContentEditor({ kind, notify }: { kind: "promos" | "announcements"; notify: (s: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]),
    [edit, setEdit] = useState<Row | null>(null),
    [error, setError] = useState("");
  const load = useCallback(() => api("/admin/" + kind).then(setRows).catch((e) => setError(e.message)), [kind]);
  useEffect(() => {
    load();
  }, [load]);
  const promo = kind === "promos";
  return (
    <section className="card">
      <div className="section-actions">
        <h2>{promo ? "โปรโมชันและโฆษณา" : "ประกาศในระบบ (ป๊อปอัป)"}</h2>
        <button className="primary" onClick={() => setEdit({ active: true, popup: true, tone: "violet", level: "info", placement: "landing" })}>
          <Plus size={14} /> เพิ่ม
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!rows.length && <Empty title="ยังไม่มีรายการ" />}
      {rows.map((r) => (
        <div className="section-actions" key={r.id}>
          <span>
            <b>{r.title}</b> <small className="muted">{r.body}</small>{" "}
            {promo && <span className="status-pill">{placementLabels[r.placement || "landing"]}</span>}{" "}
            {promo && r.media_url && <span className="status-pill">{r.media_type === "video" ? "มีคลิป" : "มีรูป"}</span>}{" "}
            <span className={"status-pill " + (r.active ? "good" : "bad")}>{r.active ? "แสดงอยู่" : "ซ่อน"}</span>
          </span>
          <div className="row-actions">
            <button className="secondary" onClick={() => setEdit(r)}>
              แก้ไข
            </button>
            <button
              className="icon-button"
              aria-label="ลบ"
              onClick={async () => {
                if (!confirm("ลบรายการนี้?")) return;
                await api(`/admin/${kind}/${r.id}`, { method: "DELETE" });
                load();
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
      {edit && (
        <Modal title={edit.id ? "แก้ไข" : "เพิ่มรายการ"} onClose={() => setEdit(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const end = String(f.get("end") || "");
              const body: Record<string, unknown> = {
                title: f.get("title"),
                body: f.get("body"),
                active: f.get("active") === "on",
              };
              if (promo) Object.assign(body, { cta_label: f.get("cta_label"), cta_url: f.get("cta_url"), tone: f.get("tone"), placement: f.get("placement"), media_url: f.get("media_url") || "", media_type: f.get("media_type") || "", ordinal: Number(f.get("ordinal") || 0), ends_at: end ? new Date(end).toISOString() : null });
              else Object.assign(body, { level: f.get("level"), popup: f.get("popup") === "on", expires_at: end ? new Date(end).toISOString() : null });
              try {
                await api(`/admin/${kind}${edit.id ? "/" + edit.id : ""}`, { method: edit.id ? "PATCH" : "POST", body });
                setEdit(null);
                load();
                notify("บันทึกแล้ว");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <label>
              หัวข้อ
              <input name="title" defaultValue={edit.title} required maxLength={120} />
            </label>
            <label>
              รายละเอียด
              <textarea name="body" defaultValue={edit.body} rows={3} maxLength={promo ? 500 : 2000} required={!promo} />
            </label>
            {promo && <PromoMedia initial={edit} />}
            {promo ? (
              <div className="form-grid">
                <label>
                  ข้อความปุ่ม
                  <input name="cta_label" defaultValue={edit.cta_label} maxLength={40} />
                </label>
                <label>
                  ลิงก์ปุ่ม (https:// หรือ /)
                  <input name="cta_url" defaultValue={edit.cta_url} maxLength={300} />
                </label>
                <label>
                  สี
                  <select name="tone" defaultValue={edit.tone}>
                    <option value="violet">ม่วง</option>
                    <option value="pink">ชมพู</option>
                    <option value="blue">ฟ้า</option>
                    <option value="green">เขียว</option>
                  </select>
                </label>
                <label>
                  ลำดับ
                  <input name="ordinal" type="number" min={0} max={100} defaultValue={edit.ordinal ?? 0} />
                </label>
                <label>
                  แสดงที่
                  <select name="placement" defaultValue={edit.placement || "landing"}>
                    {Object.entries(placementLabels).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="form-grid">
                <label>
                  ระดับ
                  <select name="level" defaultValue={edit.level}>
                    <option value="info">ข่าวสาร</option>
                    <option value="success">ฟีเจอร์ใหม่</option>
                    <option value="warning">แจ้งเตือน</option>
                  </select>
                </label>
                <label className="check-row">
                  <input name="popup" type="checkbox" defaultChecked={edit.popup} /> แสดงเป็นป๊อปอัป
                </label>
              </div>
            )}
            <label>
              แสดงถึงวันที่ (เว้นว่าง = ไม่มีกำหนด)
              <input name="end" type="date" defaultValue={(promo ? edit.ends_at : edit.expires_at)?.slice(0, 10)} />
            </label>
            <label className="check-row">
              <input name="active" type="checkbox" defaultChecked={edit.active} /> แสดงอยู่
            </label>
            <div className="modal-footer">
              <button className="primary">
                <Save size={14} /> บันทึก
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
