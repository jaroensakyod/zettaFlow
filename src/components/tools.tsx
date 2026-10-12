"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Send,
  Download,
  CalendarDays,
  FileText,
  BarChart3,
  Settings2,
  Search,
  BookOpen,
  Palette,
  Check,
  ArrowUpRight,
} from "lucide-react";
import { api, Empty, Loading, displayDate, money } from "./shared";
import { catalog, departmentNames, statusLabels, modules } from "@/lib/catalog";
import type { Context, Entity, Message } from "@/lib/types";
export function Chat({
  ctx,
  notify,
}: {
  ctx: Context;
  notify: (s: string) => void;
}) {
  const choices =
    ctx.member.role === "owner" ? departmentNames : ctx.member.departments;
  const [department, setDepartment] = useState(choices[0] || ""),
    [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    async function load() {
      try {
        setMessages(
          await api("/chat?department=" + encodeURIComponent(department)),
        );
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [department]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);
  return (
    <section className="card chat-layout">
      <aside className="chat-channels">
        <h3>ห้องแชทของแผนก</h3>
        {choices.map((d) => (
          <button
            key={d}
            className={department === d ? "selected" : ""}
            onClick={() => setDepartment(d)}
          >
            # {d}
          </button>
        ))}
      </aside>
      <div className="chat-main">
        <div className="chat-header">
          <strong># {department}</strong>
          <span className="muted">อัปเดตทุก 5 วินาที</span>
        </div>
        <div className="chat-messages">
          {messages.map((m) => (
            <div
              className={"message " + (m.user_id === ctx.user.id ? "mine" : "")}
              key={m.id}
            >
              <small>
                {m.name} ·{" "}
                {new Date(m.created_at).toLocaleTimeString("th-TH", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
              <p>{m.body}</p>
            </div>
          ))}
          {!messages.length && (
            <Empty
              title="เริ่มบทสนทนาของทีม"
              description="ข้อความแยกตามบริษัทและสิทธิ์แผนก"
            />
          )}
          <div ref={bottom} />
        </div>
        {error && <p className="form-error">{error}</p>}
        <form
          className="chat-compose"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("/chat?department=" + encodeURIComponent(department), {
                method: "POST",
                body: { body: text },
              });
              setText("");
              setMessages(
                await api("/chat?department=" + encodeURIComponent(department)),
              );
            } catch (err) {
              notify((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label="ข้อความแชท"
            placeholder={
              ctx.member.role === "viewer"
                ? "Viewer ดูข้อความได้อย่างเดียว"
                : "พิมพ์ข้อความถึงทีม…"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={ctx.member.role === "viewer" || busy}
            maxLength={4000}
          />
          <button
            className="primary"
            disabled={!text.trim() || busy || ctx.member.role === "viewer"}
            aria-label="ส่งข้อความ"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </section>
  );
}
export function Calendar({ navigate }: { navigate: (view: string) => void }) {
  const [month, setMonth] = useState(
      () =>
        new Date(
          new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }),
        ),
    ),
    [rows, setRows] = useState<Entity[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const year = month.getFullYear(),
    m = month.getMonth();
  useEffect(() => {
    setLoading(true);
    api("/calendar?month=" + year + "-" + String(m + 1).padStart(2, "0"))
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, m]);
  const first = new Date(year, m, 1).getDay(),
    days = new Date(year, m + 1, 0).getDate();
  return (
    <section className="card">
      <div className="card-heading">
        <h2>
          {month.toLocaleDateString("th-TH", {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <div className="action-group">
          <button
            className="icon-button"
            aria-label="เดือนก่อน"
            onClick={() => setMonth(new Date(year, m - 1, 1))}
          >
            <ArrowLeft size={18} />
          </button>
          <button className="secondary" onClick={() => setMonth(new Date())}>
            เดือนนี้
          </button>
          <button
            className="icon-button"
            aria-label="เดือนถัดไป"
            onClick={() => setMonth(new Date(year, m + 1, 1))}
          >
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <Empty title={error} />
      ) : (
        <div className="calendar-grid">
          {["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."].map((d) => (
            <div key={d} className="calendar-weekday">
              {d}
            </div>
          ))}
          {Array.from({ length: first }, (_, i) => (
            <div className="calendar-cell blank" key={"blank" + i} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const day = `${year}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
            const events = rows.filter(
              (r) =>
                r.data.dueDate === day ||
                r.data.startDate === day ||
                r.data.date === day,
            );
            return (
              <div className="calendar-cell" key={day}>
                <span>{i + 1}</span>
                {events.map((r) => (
                  <button
                    key={r.id}
                    title={String(r.data.name)}
                    onClick={() => navigate(r.kind)}
                  >
                    {String(r.data.name)}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <p className="muted calendar-note">
        แสดงวันเริ่มของโครงการ/ดีล/อีเวนต์ และวันครบกำหนดของงาน
      </p>
    </section>
  );
}
export function Reports({ notify }: { notify: (s: string) => void }) {
  const [kind, setKind] = useState("sales"),
    [rows, setRows] = useState<Entity[]>([]),
    [count, setCount] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/entities/" + kind)
      .then((d) => {
        setRows(d.rows);
        setCount(d.count);
      })
      .catch((e) => notify(e.message));
  }, [kind, notify]);
  const module = catalog[kind];
  return (
    <>
      <div className="section-actions">
        <label className="inline-select">
          รายงาน
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {modules.map((m) => (
              <option value={m.key} key={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await fetch("/api/export?kind=" + kind);
              if (!r.ok) throw Error("ส่งออกไม่ได้");
              const url = URL.createObjectURL(await r.blob());
              const a = document.createElement("a");
              a.href = url;
              a.download = kind + ".csv";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              notify("ส่งออกรายงานแล้ว");
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={15} />
          ส่งออก CSV
        </button>
      </div>
      <section className="card">
        <div className="card-heading">
          <h2>
            {module.label} · {count} รายการ
          </h2>
          <span className="muted">
            ตัวอย่าง 25 รายการล่าสุด · ส่งออกสูงสุด 10,000 รายการ
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {module.columns.map((c) => (
                  <th key={c}>
                    {module.fields.find((f) => f.key === c)?.label || c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {module.columns.map((c) => (
                    <td key={c}>
                      {c === "status"
                        ? statusLabels[String(r.data[c])] || String(r.data[c])
                        : typeof r.data[c] === "number"
                          ? money(r.data[c])
                          : String(r.data[c] || "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty title="ยังไม่มีข้อมูลในรายงานนี้" />}
        <div className="note">
          รายงานใช้ข้อมูลที่บัญชีนี้มีสิทธิ์เข้าถึง
          ข้อมูลเก็บเข้าคลังจะไม่รวมในการส่งออก
        </div>
      </section>
    </>
  );
}
export function ModuleStore({ navigate }: { navigate: (v: string) => void }) {
  const [query, setQuery] = useState("");
  return (
    <>
      <div className="section-actions">
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label="ค้นหาโมดูล"
            placeholder="ค้นหาเครื่องมือสำหรับทีม…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="muted">
          โมดูลที่มีใน workspace · ไม่หักเหรียญหรือเรียกเก็บเงิน
        </span>
      </div>
      <div className="template-grid">
        {modules
          .filter((m) =>
            (m.label + " " + m.department)
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((m) => (
            <article className="card store-card" key={m.key}>
              <span className="badge">{m.department}</span>
              <h2>{m.label}</h2>
              <p>{m.description}</p>
              <button className="secondary" onClick={() => navigate(m.key)}>
                เปิดโมดูล
                <ArrowUpRight size={15} />
              </button>
            </article>
          ))}
      </div>
    </>
  );
}
export function Pricing() {
  return (
    <>
      <div className="note">
        แพ็กเกจจากแผน ZettaFlow ใน Canva เพื่อประกอบการตั้งบริการ
        หน้านี้ไม่เรียกเก็บเงินและยังไม่เปิด subscription gateway
      </div>
      <div className="pricing-grid">
        {[
          [
            "Starter",
            1190,
            11900,
            "5 Workflows",
            "1,000 เอกสาร/เดือน",
            "2 กลุ่ม LINE",
            "2 Dashboard Users",
          ],
          [
            "Growth",
            3490,
            34900,
            "20 Workflows",
            "4,000 เอกสาร/เดือน",
            "10 กลุ่ม LINE",
            "10 Dashboard Users",
          ],
          [
            "Enterprise",
            8900,
            89000,
            "กำหนด Workflow ตามองค์กร",
            "โควตาตามสัญญา",
            "เชื่อมต่อ API / ERP",
            "ทีมและสิทธิ์ตามองค์กร",
          ],
        ].map((p) => (
          <article className="card pricing-card" key={String(p[0])}>
            <span className="eyebrow">{p[0]}</span>
            <h2>
              ฿{money(p[1])}
              <small>/เดือน</small>
            </h2>
            <p className="muted">฿{money(p[2])} / ปี</p>
            <ul>
              {p.slice(3).map((f) => (
                <li key={String(f)}>
                  <Check size={15} />
                  {f}
                </li>
              ))}
            </ul>
            <span className="badge">ราคาเสนอในแผน · ยังไม่เปิดรับชำระ</span>
          </article>
        ))}
      </div>
    </>
  );
}
export function Assistant() {
  const [messages, setMessages] = useState<
      { question: string; answer: string; engine: string }[]
    >([]),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="card assistant-card">
      <div className="card-heading">
        <h2>ผู้ช่วยสรุปข้อมูลธุรกิจ</h2>
        <span className="badge">Read-only</span>
      </div>
      <div className="note">
        ตอบจากข้อมูลที่บัญชีนี้มีสิทธิ์ดู ผู้ช่วยไม่อนุมัติหรือแก้ไขข้อมูลแทนคุณ
      </div>
      {!messages.length && (
        <Empty
          title="วันนี้ทีมควรติดตามอะไร?"
          description="ถามงานค้าง ยอดขาย ค่าใช้จ่าย หรือภาพรวมธุรกิจ"
        />
      )}
      {messages.map((m, i) => (
        <div className="assistant-turn" key={i}>
          <h3>{m.question}</h3>
          <p>{m.answer}</p>
          <small>
            {m.engine === "ai"
              ? "คำตอบจาก AI โดยใช้สรุปข้อมูลธุรกิจ"
              : "สรุปโดยระบบจากฐานข้อมูล"}
          </small>
        </div>
      ))}
      <p className="form-error" role="alert">
        {error}
      </p>
      <form
        className="chat-compose"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const d = await api("/assistant", {
              method: "POST",
              body: { prompt },
            });
            setMessages((s) => [...s, { question: prompt, ...d }]);
            setPrompt("");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="คำถามถึงผู้ช่วย"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="สรุปภาพรวมธุรกิจและงานที่ควรติดตามให้หน่อย"
          maxLength={1500}
        />
        <button className="primary" disabled={busy || !prompt.trim()}>
          <Send size={16} />
          {busy ? "กำลังตอบ…" : "ถามผู้ช่วย"}
        </button>
      </form>
    </section>
  );
}
