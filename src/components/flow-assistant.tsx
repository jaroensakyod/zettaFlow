"use client";
import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, X, Check, FileText, ArrowRight, Mic, Square, Volume2, VolumeX } from "lucide-react";
import { departmentNames } from "@/lib/catalog";
import type { FlowAction, FlowCard } from "@/lib/flow";
import type { TaskDraft } from "@/lib/flow-intent";
import type { Context } from "@/lib/types";
import { api } from "./shared";
import { deptLabels } from "./home-dashboard";
import { FlowMascot, type FlowMood } from "./mascot";

// Browser speech APIs (Chrome / Edge / Safari). Minimal typing: not every TS DOM lib ships these.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
const recognitionClass = () =>
  typeof window === "undefined"
    ? undefined
    : ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition);
const thaiVoice = () => speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("th"));

type Msg =
  | { id: number; from: "me"; text: string; file?: string }
  | { id: number; from: "bot"; text: string; actions: FlowAction[]; cards: FlowCard[]; done?: string[] };
type NewMsg = Msg extends infer M ? (M extends Msg ? Omit<M, "id"> : never) : never;
const STORE = "eliteflow-flow-chat";
const prompts = ["ใบแจ้งหนี้ไหนค้างจ่ายบ้าง", "งานที่ใกล้ครบกำหนด", "สินค้าไหนใกล้หมด", "สรุปยอดขายสัปดาห์นี้", "เปิดหน้าหางาน"];
const load = (): Msg[] => {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(sessionStorage.getItem(STORE) || "[]");
  } catch {
    return [];
  }
};

export function FlowAssistant({
  ctx,
  navigate,
  notify,
}: {
  ctx: Context;
  navigate: (v: string) => void;
  notify: (s: string) => void;
}) {
  const [open, setOpen] = useState(false),
    // Read lazily: the panel starts closed, so this never changes the server-rendered markup.
    [messages, setMessages] = useState<Msg[]>(load),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [hello, setHello] = useState(false),
    [listening, setListening] = useState(false),
    [speaking, setSpeaking] = useState(false),
    [voiceOn, setVoiceOn] = useState(false),
    [canListen, setCanListen] = useState(false),
    recRef = useRef<Recognition | null>(null),
    listRef = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORE + "-open") === "1") setOpen(true);
      setCanListen(!!recognitionClass());
      setVoiceOn(localStorage.getItem(STORE + "-voice") === "1");
      if (!sessionStorage.getItem(STORE + "-hello")) {
        setHello(true);
        sessionStorage.setItem(STORE + "-hello", "1");
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-40)));
    } catch {}
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE + "-open", open ? "1" : "0");
    } catch {}
    if (!open) {
      recRef.current?.abort();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      return;
    }
    inputRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  const push = (m: NewMsg) => setMessages((list) => [...list, { ...m, id: Date.now() + Math.random() } as Msg]);
  const markDone = (id: number, key: string) =>
    setMessages((list) =>
      list.map((m) => (m.id === id && m.from === "bot" ? { ...m, done: [...(m.done || []), key] } : m)),
    );
  const speak = (line: string, force = false) => {
    if ((!voiceOn && !force) || typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line.replace(/[*#•]/g, "").slice(0, 400));
    u.lang = "th-TH";
    const v = thaiVoice();
    if (v) u.voice = v;
    u.rate = 1.05;
    u.pitch = 1.25;
    u.onstart = () => setSpeaking(true);
    u.onend = u.onerror = () => setSpeaking(false);
    speechSynthesis.speak(u);
  };
  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    try {
      localStorage.setItem(STORE + "-voice", next ? "1" : "0");
    } catch {}
    if (!next) speechSynthesis.cancel();
  };
  const listen = () => {
    if (listening) return recRef.current?.stop();
    const Rec = recognitionClass();
    if (!Rec) return notify("เบราว์เซอร์นี้ยังไม่รองรับการพูด ลองใช้ Chrome หรือ Edge");
    speechSynthesis.cancel();
    const rec = new Rec();
    rec.lang = "th-TH";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText(finalText + interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed")
        notify("ยังไม่ได้อนุญาตให้ใช้ไมโครโฟน กดอนุญาตที่แถบที่อยู่ของเบราว์เซอร์");
      else if (e.error !== "no-speech" && e.error !== "aborted") notify("ฟังไม่ได้: " + e.error);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      if (finalText.trim()) {
        // Talking to Flow turns spoken replies on.
        if (!voiceOn) {
          setVoiceOn(true);
          try {
            localStorage.setItem(STORE + "-voice", "1");
          } catch {}
        }
        send(finalText.trim(), undefined, true);
      }
    };
    recRef.current = rec;
    setListening(true);
    setText("");
    rec.start();
  };
  const send = async (message: string, file?: File, spoken = false) => {
    if (busy || (!message.trim() && !file)) return;
    push({ from: "me", text: message || "สรุปเอกสารนี้ให้หน่อย", file: file?.name });
    setText("");
    setBusy(true);
    try {
      let reply: { reply: string; actions: FlowAction[]; cards: FlowCard[] };
      if (file) {
        const form = new FormData();
        form.set("file", file);
        const r = await fetch("/api/flow", { method: "POST", body: form });
        reply = await r.json();
        if (!r.ok) throw Error((reply as unknown as { error: string }).error);
      } else reply = await api("/flow", { method: "POST", body: { message } });
      const auto = reply.actions.find((a) => a.type === "open" && a.auto);
      const bot: Msg = {
        id: Date.now() + Math.random(),
        from: "bot",
        text: reply.reply,
        actions: reply.actions,
        cards: reply.cards,
        done: auto && auto.type === "open" ? ["open:" + auto.view] : undefined,
      };
      setMessages((list) => {
        const next = [...list, bot];
        // Save before navigating: a route change can remount the workspace.
        try {
          sessionStorage.setItem(STORE, JSON.stringify(next.slice(-40)));
        } catch {}
        return next;
      });
      speak(reply.reply, spoken);
      if (auto && auto.type === "open") setTimeout(() => navigate(auto.view), 0);
    } catch (e) {
      push({ from: "bot", text: "ขอโทษค่ะ ตอนนี้ตอบไม่ได้: " + (e as Error).message, actions: [], cards: [] });
    } finally {
      setBusy(false);
    }
  };
  const mood: FlowMood = listening ? "listening" : busy ? "thinking" : speaking ? "talking" : "idle",
    status = listening
      ? "กำลังฟัง… พูดได้เลยค่ะ"
      : busy
        ? "กำลังคิด…"
        : speaking
          ? "กำลังพูด…"
          : "พร้อมช่วยงาน · เห็นเฉพาะข้อมูลที่คุณมีสิทธิ์";
  return (
    <>
      {!open && (
        <div className="flow-fab-wrap">
          {hello && (
            <div className="flow-hello" role="status">
              <button aria-label="ปิดคำทักทาย" onClick={() => setHello(false)}>
                <X size={12} />
              </button>
              <strong>สวัสดีค่ะ น้องโฟลว์เอง</strong>
              <span>ถามเรื่องงาน เอกสาร หรือให้เปิดหน้าไหนก็ได้นะคะ</span>
            </div>
          )}
          <button
            className="flow-fab"
            aria-label="เปิดผู้ช่วย AI น้องโฟลว์"
            onClick={() => {
              setOpen(true);
              setHello(false);
            }}
          >
            <FlowMascot size={84} animated mood="idle" />
            <span className="flow-fab-shadow" />
          </button>
        </div>
      )}
      {open && (
        <aside className="flow-panel" role="dialog" aria-label="ผู้ช่วย AI น้องโฟลว์">
          <header className="flow-head">
            <span className="flow-head-char">
              <FlowMascot size={62} label="น้องโฟลว์" animated mood={mood} />
            </span>
            <div>
              <strong>น้องโฟลว์</strong>
              <span>
                <i className={mood} />
                {status}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label={voiceOn ? "ปิดเสียงตอบ" : "เปิดเสียงตอบ"}
              aria-pressed={voiceOn}
              title={voiceOn ? "ปิดเสียงตอบ" : "ให้น้องโฟลว์พูดตอบ"}
              onClick={toggleVoice}
            >
              {voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            {messages.length > 0 && (
              <button className="flow-clear" onClick={() => setMessages([])}>
                ล้างแชท
              </button>
            )}
            <button className="icon-button" aria-label="ปิดผู้ช่วย" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </header>
          <div className="flow-list" ref={listRef} aria-live="polite">
            {!messages.length && (
              <div className="flow-empty">
                <FlowMascot size={120} animated mood={mood === "idle" ? "happy" : mood} />
                <strong>วันนี้ให้น้องโฟลว์ช่วยอะไรดีคะ?</strong>
                <span>พิมพ์หรือกดไมค์คุยได้เลย ถามงานค้าง ใบแจ้งหนี้ สต็อก ยอดขาย สั่งสร้างงาน หรือแนบเอกสารให้สรุปก็ได้</span>
              </div>
            )}
            {messages.map((m) =>
              m.from === "me" ? (
                <div className="flow-me" key={m.id}>
                  {m.file && (
                    <span className="flow-file">
                      <FileText size={14} />
                      {m.file}
                    </span>
                  )}
                  {m.text}
                </div>
              ) : (
                <div className="flow-bot" key={m.id}>
                  <p>{m.text}</p>
                  {m.cards.map((c, i) => (
                    <button key={i} className={"flow-card " + (c.tone || "")} onClick={() => c.view && navigate(c.view)}>
                      <strong>{c.title}</strong>
                      <small>{c.sub}</small>
                    </button>
                  ))}
                  {m.actions.map((a, i) =>
                    a.type === "open" ? (
                      m.done?.includes("open:" + a.view) ? (
                        <span key={i} className="flow-done">
                          <Check size={14} />
                          {a.label}แล้ว
                        </span>
                      ) : (
                        <button
                          key={i}
                          className="secondary flow-action"
                          onClick={() => {
                            navigate(a.view);
                            markDone(m.id, "open:" + a.view);
                          }}
                        >
                          {a.label}
                          <ArrowRight size={14} />
                        </button>
                      )
                    ) : (
                      <TaskConfirm
                        key={i}
                        draft={a.draft}
                        done={m.done?.includes("task")}
                        onCreated={() => {
                          markDone(m.id, "task");
                          push({
                            from: "bot",
                            text: "สร้างงานให้แล้วค่ะ",
                            actions: [{ type: "open", view: "tasks", label: "เปิดหน้างาน" }],
                            cards: [],
                          });
                          notify("สร้างงานแล้ว");
                        }}
                      />
                    ),
                  )}
                </div>
              ),
            )}
            {busy && (
              <div className="flow-bot flow-typing" aria-label="น้องโฟลว์กำลังพิมพ์">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          <div className="flow-foot">
            <div className="flow-prompts">
              {prompts.map((p) => (
                <button key={p} disabled={busy} onClick={() => send(p)}>
                  {p}
                </button>
              ))}
            </div>
            <form
              className="flow-input"
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
            >
              <button type="button" className="flow-icon" aria-label="แนบเอกสาร PDF หรือรูปภาพ" onClick={() => fileRef.current?.click()}>
                <Paperclip size={18} />
              </button>
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                tabIndex={-1}
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) send(text, f);
                }}
              />
              <label className="sr-only" htmlFor="flow-text">
                พิมพ์ถามน้องโฟลว์
              </label>
              <input
                id="flow-text"
                ref={inputRef}
                maxLength={1500}
                placeholder={listening ? "กำลังฟัง… พูดได้เลยค่ะ" : "พิมพ์ หรือกดไมค์คุยกับน้องโฟลว์…"}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                type="button"
                className={"flow-icon flow-mic" + (listening ? " on" : "")}
                aria-label={listening ? "หยุดฟัง" : "กดแล้วพูด"}
                aria-pressed={listening}
                title={canListen ? (listening ? "หยุดฟัง" : "กดแล้วพูดภาษาไทย") : "เบราว์เซอร์นี้ยังไม่รองรับการพูด ใช้ Chrome หรือ Edge"}
                disabled={busy || !canListen}
                onClick={listen}
              >
                {listening ? <Square size={16} /> : <Mic size={19} />}
              </button>
              <button className="primary flow-send" aria-label="ส่งข้อความ" disabled={busy || !text.trim()}>
                <Send size={17} />
              </button>
            </form>
            <p className="flow-note">น้องโฟลว์จะถามยืนยันก่อนบันทึกอะไรทุกครั้ง · {ctx.company.name}</p>
          </div>
        </aside>
      )}
    </>
  );
}

function TaskConfirm({ draft, done, onCreated }: { draft: TaskDraft; done?: boolean; onCreated: () => void }) {
  const [d, setD] = useState(draft),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (done)
    return (
      <span className="flow-done">
        <Check size={14} />
        สร้างงาน “{d.name}” แล้ว
      </span>
    );
  return (
    <form
      className="flow-task"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/entities/tasks", {
            method: "POST",
            body: { data: { name: d.name, department: d.department, dueDate: d.dueDate || undefined, priority: d.priority, status: "pending" } },
          });
          onCreated();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        ชื่องาน
        <input required maxLength={200} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>
      <div className="flow-task-row">
        <label>
          แผนก
          <select value={d.department} onChange={(e) => setD({ ...d, department: e.target.value })}>
            {departmentNames.map((n) => (
              <option key={n} value={n}>
                {deptLabels[n] || n}
              </option>
            ))}
          </select>
        </label>
        <label>
          ครบกำหนด
          <input type="date" value={d.dueDate} onChange={(e) => setD({ ...d, dueDate: e.target.value })} />
        </label>
        <label>
          ความสำคัญ
          <select value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as TaskDraft["priority"] })}>
            <option value="normal">ปกติ</option>
            <option value="high">สำคัญ</option>
            <option value="urgent">ด่วน</option>
          </select>
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="primary" disabled={busy || !d.name.trim()}>
        <Check size={15} />
        {busy ? "กำลังสร้าง…" : "ยืนยันสร้างงาน"}
      </button>
    </form>
  );
}
