"use client";
// ใบเสนอราคา: totals by status, where accepted ones got (order → invoice → paid), a list coloured by status, and each
// quotation in full — change its status or project, attach the copy the customer signed, open the next document.
import { useCallback, useEffect, useState } from "react";
import {
  Plus, Search, FileText, Send, CheckCircle2, XCircle, User, FolderKanban, CalendarDays, CalendarClock, UserRound, Hash,
  ShoppingCart, FileDigit, Wallet, Printer, Upload, Pencil, Check,
} from "lucide-react";
import type { Context } from "@/lib/types";
import type { QuotesData, QuoteRow, QuoteStage } from "@/lib/quotes";
import { api, money, displayDate, Empty, Loading, Modal } from "./shared";
import { PeriodBar, periodRange, todayISO, type PeriodMode } from "./finance-ledger";
import { QuoteEditor } from "./quote-editor";
import { uploadFile } from "./platform";

// Colour per stage, same family as the rest of the money pages.
const tone: Record<QuoteStage, string> = {
  ร่าง: "draft", ส่งแล้ว: "sent", หมดอายุ: "expired", ปฏิเสธ: "rejected",
  ตอบรับ: "won", เปิดคำสั่งซื้อแล้ว: "won", ออกใบแจ้งหนี้แล้ว: "won", ชำระแล้ว: "paid",
};
const stageLabel: Record<QuoteStage, string> = {
  ร่าง: "ร่าง", ส่งแล้ว: "รอลูกค้าตอบ", หมดอายุ: "หมดอายุ", ปฏิเสธ: "ปฏิเสธ",
  ตอบรับ: "ตอบรับแล้ว", เปิดคำสั่งซื้อแล้ว: "เปิดคำสั่งซื้อแล้ว", ออกใบแจ้งหนี้แล้ว: "ออกใบแจ้งหนี้แล้ว", ชำระแล้ว: "ชำระแล้ว",
};
const won: QuoteStage[] = ["ตอบรับ", "เปิดคำสั่งซื้อแล้ว", "ออกใบแจ้งหนี้แล้ว", "ชำระแล้ว"];
// How far an accepted quotation got: 0 none … 4 paid.
const progress = (s: QuoteStage) => (s === "ชำระแล้ว" ? 4 : s === "ออกใบแจ้งหนี้แล้ว" ? 3 : s === "เปิดคำสั่งซื้อแล้ว" ? 2 : s === "ตอบรับ" ? 1 : 0);
type Filter = "" | "ร่าง" | "ส่งแล้ว" | "won" | "lost";

export function QuotesPage({ ctx, notify, navigate }: { ctx: Context; notify: (s: string) => void; navigate: (v: string) => void }) {
  const [data, setData] = useState<QuotesData | null>(null),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState<Filter>(""),
    [mode, setMode] = useState<PeriodMode>("month"),
    [anchor, setAnchor] = useState(todayISO),
    [open, setOpen] = useState<QuoteRow | null>(null),
    // The document-style form: "new" or the id being edited.
    [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const d: QuotesData = await api("/quotes");
      setData(d);
      setOpen((o) => (o ? d.quotes.find((x) => x.id === o.id) || null : null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <Loading />;

  const term = q.trim().toLowerCase();
  const { from, to } = periodRange(mode, anchor);
  const base = data.quotes.filter(
    (x) => x.date >= from && x.date <= to && (!term || [x.code, x.name, x.summary, x.customer, x.project, x.projectName, x.owner, stageLabel[x.stage]].join(" ").toLowerCase().includes(term)),
  );
  const match = (x: QuoteRow, f: Filter) =>
    !f || (f === "won" ? won.includes(x.stage) : f === "lost" ? x.stage === "ปฏิเสธ" || x.stage === "หมดอายุ" : x.stage === f);
  const rows = base.filter((x) => match(x, filter));
  const sum = (l: QuoteRow[]) => l.reduce((s, x) => s + x.total, 0);
  const of = (f: Filter) => base.filter((x) => match(x, f));
  const winRate = of("won").length + of("lost").length ? Math.round((of("won").length / (of("won").length + of("lost").length)) * 100) : 0;
  const cards: [React.ComponentType<{ size?: number }>, string, string, string, string][] = [
    [FileText, "ใบเสนอราคาทั้งหมด", "฿" + money(sum(base)), base.length + " ใบ · ร่าง " + of("ร่าง").length, "violet"],
    [Send, "รอลูกค้าตอบ", "฿" + money(sum(of("ส่งแล้ว"))), of("ส่งแล้ว").length + " ใบ", "blue"],
    [CheckCircle2, "ลูกค้าตอบรับ", "฿" + money(sum(of("won"))), of("won").length + " ใบ · ปิดการขาย " + winRate + "%", "green"],
    [XCircle, "ปฏิเสธ / หมดอายุ", "฿" + money(sum(of("lost"))), of("lost").length + " ใบ", "amber"],
  ];

  return (
    <div className="op qp">
      <div className="op-bar">
        {data.canWrite && (
          <button className="primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> เพิ่มใบเสนอราคา
          </button>
        )}
        <button className="secondary" onClick={() => navigate("quotations?manage=1")}>
          <Pencil size={15} /> จัดการ / แก้ไขรายการ
        </button>
      </div>

      <PeriodBar mode={mode} setMode={setMode} anchor={anchor} setAnchor={setAnchor} all />

      <div className="fl-cards">
        {cards.map(([Ico, t, v, note, c]) => (
          <div className={"fl-card " + c} key={t}>
            <span className="fl-card-icon">
              <Ico size={22} />
            </span>
            <div>
              <small>{t}</small>
              <b>{v}</b>
              <em>{note}</em>
            </div>
          </div>
        ))}
      </div>

      <section className="card fl-list">
        <header>
          <h3>รายการใบเสนอราคา</h3>
          <div className="fl-pay-filter qp-filter" role="group" aria-label="กรองตามสถานะ">
            {(
              [
                ["", "ทั้งหมด", "all"],
                ["ร่าง", "ร่าง", "draft"],
                ["ส่งแล้ว", "รอลูกค้าตอบ", "sent"],
                ["won", "ตอบรับ", "won"],
                ["lost", "ปฏิเสธ / หมดอายุ", "expired"],
              ] as [Filter, string, string][]
            ).map(([f, label, c]) => (
              <button key={label} className={(filter === f ? "on " : "") + c} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {label}
                <i>{of(f).length}</i>
              </button>
            ))}
          </div>
          <label className="fl-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเลขที่ ลูกค้า โปรเจกต์…" />
          </label>
        </header>
        {!rows.length ? (
          <Empty title={data.quotes.length ? "ไม่พบใบเสนอราคาตามเงื่อนไข" : "ยังไม่มีใบเสนอราคา"} />
        ) : (
          <div className="table-wrap">
            <table className="fl-table qp-table">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>วันที่</th>
                  <th>ลูกค้า</th>
                  <th>รายละเอียด · โปรเจกต์</th>
                  <th className="num">ยอดสุทธิ</th>
                  <th>สถานะ</th>
                  <th>ความคืบหน้า</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id} className={"fl-row qr-" + tone[x.stage]} onClick={() => setOpen(x)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(x)}>
                    <td className="fl-docno">{x.code}</td>
                    <td>
                      {displayDate(x.date)}
                      {x.validUntil && <small className="qp-sub">ยืนราคาถึง {displayDate(x.validUntil)}</small>}
                    </td>
                    <td className="primary-cell">{x.customer || "—"}</td>
                    <td className="qp-what">
                      <span>{x.summary || "—"}</span>
                      {x.project ? (
                        <small>
                          <em>{x.project}</em>
                          {x.projectName && x.projectName !== x.project ? x.projectName : ""}
                        </small>
                      ) : (
                        <small className="qp-none">ไม่ระบุโปรเจกต์</small>
                      )}
                    </td>
                    <td className="num strong">฿{money(x.total)}</td>
                    <td>
                      <span className={"qp-pill " + tone[x.stage]}>{stageLabel[x.stage]}</span>
                    </td>
                    <td>
                      <Steps stage={x.stage} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>รวม {rows.length} ใบ</td>
                  <td className="num strong">฿{money(sum(rows))}</td>
                  <td colSpan={2}>ตอบรับแล้ว ฿{money(sum(rows.filter((x) => won.includes(x.stage))))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
      {open && !editing && <QuoteDetail quote={open} data={data} notify={notify} navigate={navigate} reload={load} onClose={() => setOpen(null)} onEdit={() => setEditing(open.id)} />}
      {editing && (
        <QuoteEditor
          id={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            notify(msg);
            await load();
          }}
        />
      )}
    </div>
  );
}

/** Four dots: ตอบรับ · คำสั่งซื้อ · ใบแจ้งหนี้ · ชำระ. */
function Steps({ stage }: { stage: QuoteStage }) {
  const p = progress(stage);
  if (!p) return <span className="qp-none">—</span>;
  return (
    <span className="qp-steps" title={stageLabel[stage]}>
      {["ตอบรับ", "คำสั่งซื้อ", "ใบแจ้งหนี้", "ชำระ"].map((s, i) => (
        <i key={s} className={i < p ? "done" : ""} title={s} />
      ))}
    </span>
  );
}

type FileInfo = { id: string; name: string; mime: string };
function QuoteDetail({ quote: x, data, notify, navigate, reload, onClose, onEdit }: { quote: QuoteRow; data: QuotesData; notify: (s: string) => void; navigate: (v: string) => void; reload: () => Promise<void>; onClose: () => void; onEdit: () => void }) {
  const [files, setFiles] = useState<FileInfo[] | null>(null),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [view, setView] = useState<FileInfo | null>(null);
  useEffect(() => {
    api(`/ledger/detail?kind=quotations&id=${x.id}`)
      .then((d: { files: FileInfo[] }) => {
        setFiles(d.files);
        setView((v) => (v && d.files.some((f) => f.id === v.id) ? v : d.files[0] || null));
      })
      .catch(() => setFiles([]));
  }, [x.id, tick]);
  const run = async (key: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(key);
    setError("");
    try {
      await fn();
      if (msg) notify(msg);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const update = (body: Record<string, unknown>, msg: string) => run("update", () => api(`/quotes/${x.id}`, { method: "POST", body }), msg);
  const signed = (files || []).filter((f) => /^เซ็นแล้ว/.test(f.name));
  const [what, setWhat] = useState(x.name && x.name !== x.code ? x.name : x.summary);
  const p = progress(x.stage);
  const t = tone[x.stage];
  const facts: [string, React.ReactNode, React.ComponentType<{ size?: number }>, boolean?][] = [
    ["ลูกค้า", x.customer || "—", User, true],
    ["วันที่", displayDate(x.date), CalendarDays],
    ["ยืนราคาถึง", x.validUntil ? displayDate(x.validUntil) : "—", CalendarClock],
    ["ผู้รับผิดชอบ", x.owner || "—", UserRound],
    ["เลขที่", x.code, Hash],
  ];
  // The next documents after the customer accepts, each with its own button when it is the next step.
  const steps: { label: string; done: boolean; text: string; action?: React.ReactNode }[] = [
    { label: "ลูกค้าตอบรับ", done: p >= 1, text: p >= 1 ? "ตอบรับแล้ว" : "ยังไม่ตอบรับ" },
    {
      label: "คำสั่งซื้อ",
      done: !!x.order,
      text: x.order ? x.order.code : "ยังไม่ได้เปิด",
      action:
        p >= 1 && !x.order && !x.invoice && data.canWrite ? (
          <button className="secondary" disabled={!!busy} onClick={() => run("so", () => api(`/convert/quotations/${x.id}`, { method: "POST", body: { to: "sales_orders" } }), "เปิดคำสั่งซื้อแล้ว")}>
            <ShoppingCart size={14} /> เปิดคำสั่งซื้อ
          </button>
        ) : x.order ? (
          <button className="fc-link" onClick={() => navigate("sales_orders")}>ดูคำสั่งซื้อ</button>
        ) : undefined,
    },
    {
      label: "ใบแจ้งหนี้",
      done: !!x.invoice,
      text: x.invoice ? x.invoice.name : x.order?.paid ? "ไม่ต้องออก (ชำระที่คำสั่งซื้อแล้ว)" : "ยังไม่ได้ออก",
      action:
        p >= 1 && !x.invoice && !x.order?.paid && data.canWrite ? (
          <button
            className="secondary"
            disabled={!!busy}
            onClick={() =>
              run(
                "inv",
                () => (x.order ? api(`/convert/sales_orders/${x.order.id}`, { method: "POST", body: { to: "invoices" } }) : api(`/convert/quotations/${x.id}`, { method: "POST", body: { to: "invoices" } })),
                "ออกใบแจ้งหนี้แล้ว",
              )
            }
          >
            <FileDigit size={14} /> ออกใบแจ้งหนี้
          </button>
        ) : x.invoice ? (
          <button className="fc-link" onClick={() => navigate("invoices")}>ดูใบแจ้งหนี้</button>
        ) : undefined,
    },
    { label: "ชำระเงิน", done: x.stage === "ชำระแล้ว", text: x.stage === "ชำระแล้ว" ? "ได้รับเงินแล้ว" : p >= 1 ? "ยังไม่ได้รับเงิน" : "—" },
  ];
  return (
    <Modal title={`ใบเสนอราคา ${x.code}${x.customer ? " · " + x.customer : ""}`} onClose={onClose}>
      <div className={"fd qd-" + t}>
        <header className="fd-head">
          <div>
            <small>ยอดสุทธิ</small>
            <b>฿{money(x.total)}</b>
            <span>
              {x.name}
              {x.project ? " · " + x.project : ""}
            </span>
          </div>
          <span className="fl-pay">{stageLabel[x.stage]}</span>
        </header>
        <div className="fd-grid">
          <div className="fd-col">
            <section className="fd-card fd-info">
              <h4>ข้อมูลใบเสนอราคา</h4>
              <div className="fd-facts">
                <div className="fd-fact wide">
                  <span className="fd-fact-icon">
                    <FileText size={16} />
                  </span>
                  <span className="fd-fact-text">
                    <small>รายละเอียด (เสนออะไรให้ลูกค้า)</small>
                    {data.canWrite ? (
                      <span className="qp-what-edit">
                        <textarea rows={2} value={what} maxLength={500} onChange={(e) => setWhat(e.target.value)} placeholder="เช่น ออกแบบและผลิตบูธ 6x6 ม. งาน Bangkok Fashion Expo" />
                        {what.trim() && what.trim() !== (x.name && x.name !== x.code ? x.name : x.summary) && (
                          <button className="primary" disabled={!!busy} onClick={() => update({ name: what.trim() }, "บันทึกรายละเอียดแล้ว")}>
                            บันทึก
                          </button>
                        )}
                      </span>
                    ) : (
                      <b>{x.summary || "—"}</b>
                    )}
                  </span>
                </div>
                <div className="fd-fact wide">
                  <span className="fd-fact-icon">
                    <FolderKanban size={16} />
                  </span>
                  <span className="fd-fact-text">
                    <small>โปรเจกต์ (เสนอราคาให้งานไหน · ไม่ระบุก็ได้)</small>
                    {data.canWrite ? (
                      <select className="qp-project" value={x.projectId} disabled={!!busy} onChange={(e) => update({ projectId: e.target.value }, e.target.value ? "ผูกโปรเจกต์แล้ว" : "เอาโปรเจกต์ออกแล้ว")}>
                        <option value="">— ไม่ระบุโปรเจกต์ —</option>
                        {data.projects.map((pj) => (
                          <option key={pj.id} value={pj.id}>
                            {pj.code ? pj.code + " · " : ""}
                            {pj.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <b>{x.project || "ไม่ระบุ"}</b>
                    )}
                  </span>
                </div>
                {facts.map(([label, value, Icon, wide]) => (
                  <div key={label} className={"fd-fact" + (wide ? " wide" : "") + (value === "—" ? " empty" : "")}>
                    <span className="fd-fact-icon">
                      <Icon size={16} />
                    </span>
                    <span className="fd-fact-text">
                      <small>{label}</small>
                      <b>{value}</b>
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <section className="fd-card fd-sum">
              <h4>รายการสินค้า / บริการ</h4>
              {x.items.map((i, k) => (
                <div key={k} className="fd-sum-row">
                  <span>
                    {i.name}
                    <small>
                      {i.qty} × ฿{money(i.price)}
                    </small>
                  </span>
                  <b>฿{money(i.qty * i.price)}</b>
                </div>
              ))}
              {!!x.discount && (
                <div className="fd-sum-row">
                  <span>ส่วนลด</span>
                  <b>−฿{money(x.discount)}</b>
                </div>
              )}
              <div className={"fd-sum-total qs-" + t}>
                <span>ยอดสุทธิ {x.vatMode === "excluded" ? "(รวม VAT 7%)" : x.vatMode === "included" ? "(รวม VAT แล้ว)" : ""}</span>
                <b>฿{money(x.total)}</b>
              </div>
            </section>
          </div>

          <div className="fd-col">
            <section className="fd-card">
              <h4>สถานะใบเสนอราคา</h4>
              <div className="qp-status">
                {(
                  [
                    ["ร่าง", "draft"],
                    ["ส่งแล้ว", "sent"],
                    ["ตอบรับ", "won"],
                    ["ปฏิเสธ", "rejected"],
                  ] as const
                ).map(([st, c]) => (
                  <button key={st} className={(x.status === st ? "on " : "") + c} disabled={!!busy || !data.canWrite} onClick={() => x.status !== st && update({ status: st }, st === "ตอบรับ" ? "ลูกค้าตอบรับแล้ว · เปิดโปรเจกต์ให้แล้ว" : "เปลี่ยนสถานะเป็น " + st)}>
                    {x.status === st && <Check size={14} />} {st === "ส่งแล้ว" ? "ส่งให้ลูกค้าแล้ว" : st}
                  </button>
                ))}
              </div>
              {x.stage === "หมดอายุ" && <p className="fd-status warn qp-warn">เลยวันยืนราคาแล้ว ({displayDate(x.validUntil)}) — ติดตามลูกค้าหรือออกใบใหม่</p>}
            </section>
            <section className={"fd-card qp-track" + (p ? "" : " off")}>
              <h4>ความคืบหน้าหลังตอบรับ</h4>
              <ol>
                {steps.map((s, i) => (
                  <li key={s.label} className={s.done ? "done" : i === steps.findIndex((z) => !z.done) && p >= 1 ? "next" : ""}>
                    <i>{s.done ? <Check size={13} /> : i + 1}</i>
                    <span>
                      <b>{s.label}</b>
                      <small>{s.text}</small>
                    </span>
                    {s.action}
                  </li>
                ))}
              </ol>
            </section>
            <section className={"fd-card fd-receipt " + (signed.length ? "ok" : p >= 1 ? "warn" : "")}>
              <h4>ใบเสนอราคาที่ลูกค้าเซ็น</h4>
              <div className="fd-actions">
                <span className={"fd-status " + (signed.length ? "ok" : "warn")}>
                  {signed.length ? <CheckCircle2 size={16} /> : <FileText size={16} />}
                  {signed.length ? "แนบแล้ว " + signed.length + " ไฟล์" : "ยังไม่ได้แนบ"}
                </span>
                {data.canWrite && (
                  <label className={"secondary as-button" + (busy === "file" ? " busy" : "")}>
                    <Upload size={14} /> {busy === "file" ? "กำลังแนบ…" : "แนบไฟล์"}
                    <input
                      type="file"
                      className="sr-only"
                      accept="image/*,application/pdf"
                      disabled={!!busy}
                      onChange={async (ev) => {
                        const f = ev.target.files?.[0];
                        ev.target.value = "";
                        if (!f) return;
                        setBusy("file");
                        try {
                          await uploadFile(new File([f], "เซ็นแล้ว - " + f.name, { type: f.type }), "Sales", x.id);
                          setTick((k) => k + 1);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy("");
                        }
                      }}
                    />
                  </label>
                )}
              </div>
              {!!files?.length && (
                <div className="fd-slot-files">
                  {files.map((f) => (
                    <button key={f.id} className={view?.id === f.id ? "on" : ""} onClick={() => setView(f)}>
                      <FileText size={14} /> {f.name}
                    </button>
                  ))}
                </div>
              )}
            </section>
            {view && (
              <figure className="fd-preview">
                {view.mime === "application/pdf" ? (
                  <object data={"/api/files/" + view.id} type="application/pdf" aria-label={view.name} />
                ) : view.mime.startsWith("image/") ? (
                  <a href={"/api/files/" + view.id} target="_blank" rel="noreferrer">
                    <img src={"/api/files/" + view.id} alt={view.name} />
                  </a>
                ) : (
                  <a href={"/api/files/" + view.id} target="_blank" rel="noreferrer">เปิด {view.name}</a>
                )}
                <figcaption>{view.name}</figcaption>
              </figure>
            )}
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>
      <div className="modal-footer">
        <a className="secondary as-button" href={x.printUrl} target="_blank" rel="noreferrer">
          <Printer size={15} /> พิมพ์ใบเสนอราคา
        </a>
        {data.canWrite && (
          <button className="secondary" onClick={onEdit}>
            <Pencil size={15} /> แก้ไขใบเสนอราคา
          </button>
        )}
        <button className="primary" onClick={onClose}>
          ปิด
        </button>
      </div>
    </Modal>
  );
}
