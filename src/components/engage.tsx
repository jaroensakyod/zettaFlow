"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Megaphone, Trash2, Plus, Save } from "lucide-react";
import { api, Modal, Empty, displayDate } from "./shared";
import { PlatformPayments } from "./platform";
import { AdminTopups } from "./coins";
import type { Context } from "@/lib/types";
import type { Announcement, Promo, SupportMessage } from "@/lib/engage";

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

/** Floating chat with the ZettaFlow team (owners and managers). */
export function SupportChat({ ctx }: { ctx: Context }) {
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<SupportMessage[]>([]),
    [unread, setUnread] = useState(0),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const allowed = ctx.member.role === "owner" || ctx.member.role === "manager";
  const load = useCallback(
    async (seen: boolean) => {
      try {
        const d = await api("/support" + (seen ? "?seen=true" : ""));
        setMessages(d.messages);
        setUnread(seen ? 0 : d.unread);
      } catch {}
    },
    [],
  );
  // Other screens (e.g. coin top-up) open the chat with window.dispatchEvent(new Event("ef:support-open")).
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("ef:support-open", show);
    return () => window.removeEventListener("ef:support-open", show);
  }, []);
  useEffect(() => {
    if (!allowed) return;
    load(open);
    const t = setInterval(() => !document.hidden && load(open), open ? 8000 : 60000);
    return () => clearInterval(t);
  }, [allowed, open, load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);
  if (!allowed) return null;
  return (
    <>
      <button className="support-fab" aria-label="แชทกับทีมงาน ZettaFlow" onClick={() => setOpen((o) => !o)}>
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && unread > 0 && <span className="support-badge">{unread}</span>}
      </button>
      {open && (
        <section className="support-panel" aria-label="แชทกับทีมงาน">
          <header>
            <b>ทีมงาน ZettaFlow</b>
            <small>ตอบกลับในเวลาทำการ · ถามเรื่องการตั้งค่า LINE แพ็กเกจ หรือการชำระเงิน</small>
          </header>
          <div className="support-list">
            {messages.map((m) => (
              <div key={m.id} className={"support-msg " + m.sender}>
                <small>
                  {m.name} · {new Date(m.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                </small>
                <p>{m.body}</p>
              </div>
            ))}
            {!messages.length && <p className="muted">ยังไม่มีข้อความ พิมพ์คำถามได้เลย</p>}
            <div ref={end} />
          </div>
          {error && <p className="form-error">{error}</p>}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              setBusy(true);
              setError("");
              try {
                await api("/support", { method: "POST", body: { body: text } });
                setText("");
                await load(true);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="พิมพ์ข้อความ…" maxLength={4000} aria-label="ข้อความถึงทีมงาน" />
            <button className="primary" disabled={busy || !text.trim()} aria-label="ส่ง">
              <Send size={16} />
            </button>
          </form>
        </section>
      )}
    </>
  );
}

type Thread = { company_id: string; unread_admin: number; status: string; updated_at: string; companies?: { name: string } };
/** Operator console: support inbox, promotions, announcements, payment confirmations. */
export function AdminConsole({ notify }: { notify: (s: string) => void }) {
  const [tab, setTab] = useState<"support" | "promos" | "announcements" | "payments">("support");
  return (
    <>
      <div className="row-actions admin-tabs">
        {(
          [
            ["support", "แชทลูกค้า"],
            ["promos", "โปรโมชัน"],
            ["announcements", "ประกาศ"],
            ["payments", "ยืนยันการชำระ"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? "primary" : "secondary"} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === "support" && <SupportInbox notify={notify} />}
      {tab === "promos" && <ContentEditor kind="promos" notify={notify} />}
      {tab === "announcements" && <ContentEditor kind="announcements" notify={notify} />}
      {tab === "payments" && (
        <>
          <AdminTopups notify={notify} />
          <PlatformPayments notify={notify} changed={() => {}} />
        </>
      )}
    </>
  );
}

function SupportInbox({ notify }: { notify: (s: string) => void }) {
  const [threads, setThreads] = useState<Thread[]>([]),
    [current, setCurrent] = useState<Thread | null>(null),
    [messages, setMessages] = useState<SupportMessage[]>([]),
    [text, setText] = useState("");
  const loadThreads = useCallback(() => api("/admin/support").then(setThreads).catch(() => {}), []);
  const loadMessages = useCallback(
    (t: Thread) => api("/admin/support/" + t.company_id).then(setMessages).catch(() => {}),
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
  return (
    <div className="two-column">
      <section className="card">
        <h2>บทสนทนา</h2>
        {!threads.length && <Empty title="ยังไม่มีข้อความจากลูกค้า" />}
        {threads.map((t) => (
          <button
            key={t.company_id}
            className={"admin-thread " + (current?.company_id === t.company_id ? "active" : "")}
            onClick={() => {
              setCurrent(t);
              loadMessages(t).then(loadThreads);
            }}
          >
            <b>{t.companies?.name || t.company_id.slice(0, 8)}</b>
            <small>{displayDate(t.updated_at)}</small>
            {t.unread_admin > 0 && <span className="support-badge inline">{t.unread_admin}</span>}
          </button>
        ))}
      </section>
      <section className="card">
        {!current ? (
          <Empty title="เลือกบทสนทนา" />
        ) : (
          <>
            <h2>{current.companies?.name}</h2>
            <div className="support-list tall">
              {messages.map((m) => (
                <div key={m.id} className={"support-msg " + (m.sender === "admin" ? "customer" : "admin")}>
                  <small>
                    {m.name} · {new Date(m.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                  </small>
                  <p>{m.body}</p>
                </div>
              ))}
            </div>
            <form
              className="support-reply"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/admin/support/" + current.company_id, { method: "POST", body: { body: text } });
                  setText("");
                  await loadMessages(current);
                  loadThreads();
                } catch (err) {
                  notify((err as Error).message);
                }
              }}
            >
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="ตอบกลับลูกค้า…" aria-label="ข้อความตอบกลับ" />
              <button className="primary" disabled={!text.trim()}>
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
function ContentEditor({ kind, notify }: { kind: "promos" | "announcements"; notify: (s: string) => void }) {
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
        <h2>{promo ? "โปรโมชันบนหน้าแรก" : "ประกาศในระบบ (ป๊อปอัป)"}</h2>
        <button className="primary" onClick={() => setEdit({ active: true, popup: true, tone: "violet", level: "info" })}>
          <Plus size={14} /> เพิ่ม
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!rows.length && <Empty title="ยังไม่มีรายการ" />}
      {rows.map((r) => (
        <div className="section-actions" key={r.id}>
          <span>
            <b>{r.title}</b> <small className="muted">{r.body}</small>{" "}
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
              if (promo) Object.assign(body, { cta_label: f.get("cta_label"), cta_url: f.get("cta_url"), tone: f.get("tone"), ordinal: Number(f.get("ordinal") || 0), ends_at: end ? new Date(end).toISOString() : null });
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
