"use client";
// ห้องดีล in the B2B chat (phase 1): progress bar, the request / quotation cards, their forms and decisions.
// Rules live in the database (migration 0064); these only show what each side can press.
import { useMemo, useState, type FormEvent } from "react";
import { BadgeCheck, CalendarClock, Check, CircleX, FileText, Handshake, LoaderCircle, Pencil, Plus, ReceiptText, Send, Trash2, Undo2, X } from "lucide-react";
import type { Context } from "@/lib/types";
import { quoteTotals, type Deal, type DealCard, type DealItem } from "@/lib/b2b-deal-types";
import { api, Modal, money } from "./shared";

const baht = (n: number | undefined) => "฿" + money(Math.round((Number(n) || 0) * 100) / 100);
const thaiDay = (d?: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const plusDays = (n: number) => {
  const d = new Date(today() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ---------- progress bar ---------- */
const steps: { key: string; label: string; later?: boolean }[] = [
  { key: "request", label: "คำขอ" },
  { key: "quote", label: "ใบเสนอราคา" },
  { key: "accepted", label: "ตกลงจ้าง" },
  { key: "work", label: "กำลังทำ", later: true },
  { key: "check", label: "ตรวจรับ", later: true },
  { key: "bill", label: "วางบิล", later: true },
  { key: "paid", label: "ชำระเงิน", later: true },
];
const stageText: Record<Deal["stage"], string> = { request: "รอใบเสนอราคา", quote: "รอผู้ซื้อตัดสินใจ", accepted: "ตกลงจ้างงานแล้ว", rejected: "ผู้ซื้อปฏิเสธ", cancelled: "ยกเลิกแล้ว" };

export function DealBar({ deals, onRequest, onQuote, disabled }: { deals: Deal[]; onRequest: () => void; onQuote: () => void; disabled?: boolean }) {
  // The deal in progress (else the latest one).
  const deal = [...deals].reverse().find((d) => d.stage === "request" || d.stage === "quote") || deals[deals.length - 1];
  const at = deal ? (deal.stage === "rejected" || deal.stage === "cancelled" ? -1 : steps.findIndex((s) => s.key === deal.stage)) : -1;
  return (
    <div className={"deal-bar" + (deal ? " stage-" + deal.stage : "")}>
      <div className="deal-bar-top">
        <Handshake size={16} />
        {deal ? (
          <>
            <b title={deal.title}>{deal.title}</b>
            <span className={"deal-stage " + deal.stage}>{stageText[deal.stage]}</span>
            {deals.length > 1 && <small>{deals.length} ดีลในห้องนี้</small>}
          </>
        ) : (
          <span className="deal-bar-hint">ห้องดีล · ขอใบเสนอราคา ส่งใบเสนอราคา และตกลงจ้างงานได้ในแชทนี้</span>
        )}
        <span className="deal-bar-actions">
          <button type="button" onClick={onRequest} disabled={disabled}>
            <FileText size={14} /> ขอใบเสนอราคา
          </button>
          <button type="button" onClick={onQuote} disabled={disabled}>
            <ReceiptText size={14} /> ส่งใบเสนอราคา
          </button>
        </span>
      </div>
      {deal && (
        <ol className="deal-steps">
          {steps.map((s, i) => (
            <li key={s.key} className={(i < at ? "done" : i === at ? "now" : "") + (s.later ? " later" : "")} title={s.later ? "มาในเฟสถัดไป" : undefined}>
              <i>{i < at || (i === at && deal.stage === "accepted") ? <Check size={11} /> : i + 1}</i>
              {s.label}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ---------- cards ---------- */
const statusChip: Record<DealCard["status"], [string, string]> = {
  open: ["รอดำเนินการ", "open"],
  accepted: ["ตอบรับแล้ว", "ok"],
  change: ["ขอแก้ไข", "warn"],
  rejected: ["ปฏิเสธ", "bad"],
  superseded: ["ถูกแทนที่ด้วยฉบับใหม่", "muted"],
  withdrawn: ["ถอนแล้ว", "muted"],
};

export function DealCardView({
  card,
  deal,
  ctx,
  sample,
  onQuote,
  onChanged,
  notify,
  navigate,
}: {
  card: DealCard;
  deal: Deal;
  ctx: Context;
  sample?: boolean;
  /** Seller: open the quotation form (from this request, or to revise this quotation). */
  onQuote: (from: DealCard) => void;
  onChanged: () => void;
  notify: (s: string) => void;
  navigate: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [ask, setAsk] = useState<"" | "change" | "reject">(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  const d = card.data,
    seller = deal.role === "seller",
    buyer = deal.role === "buyer",
    viewer = ctx.member.role === "viewer",
    boss = ctx.member.role === "owner" || ctx.member.role === "manager",
    live = deal.stage === "request" || deal.stage === "quote",
    latestQuote = [...deal.cards].reverse().find((c) => c.kind === "quote"),
    isLatest = card.kind === "quote" && latestQuote?.id === card.id,
    expired = card.kind === "quote" && !!d.validUntil && d.validUntil < today() && card.status === "open";
  const act = async (path: string, body: object, done: string) => {
    if (sample) return notify("นี่คือตัวอย่าง — ใช้ได้จริงเมื่อคุยกับบริษัทในเครือข่าย");
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body });
      setAsk("");
      setReason("");
      notify(done);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const [label, tone] = expired ? ["หมดอายุ", "bad"] : statusChip[card.status];
  return (
    <article className={"deal-card " + card.kind + " st-" + card.status + (card.mine ? " mine" : "")}>
      <header>
        <span className="deal-card-icon">{card.kind === "request" ? <FileText size={16} /> : <ReceiptText size={16} />}</span>
        <span className="deal-card-title">
          <small>
            {card.kind === "request" ? "คำขอใบเสนอราคา" : `ใบเสนอราคา ${d.docNo || ""}`}
            {card.kind === "quote" && card.rev > 1 && <em>Rev.{card.rev}</em>}
          </small>
          <b>{d.title}</b>
        </span>
        <span className={"deal-chip " + tone}>{label}</span>
      </header>

      <table className="deal-items">
        <thead>
          <tr>
            <th>รายการ</th>
            <th>จำนวน</th>
            {card.kind === "quote" && <th>ราคา/หน่วย</th>}
            {card.kind === "quote" && <th>รวม</th>}
          </tr>
        </thead>
        <tbody>
          {d.items.map((i: DealItem, n) => (
            <tr key={n}>
              <td>{i.name}</td>
              <td>
                {money(i.qty)} {i.unit}
              </td>
              {card.kind === "quote" && <td>{baht(i.price)}</td>}
              {card.kind === "quote" && <td>{baht(i.amount)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {card.kind === "quote" ? (
        <div className="deal-sum">
          <span>
            รวม <b>{baht(d.subtotal)}</b>
          </span>
          {!!d.discount && (
            <span>
              ส่วนลด <b>-{baht(d.discount)}</b>
            </span>
          )}
          {d.vatMode !== "none" && (
            <span>
              VAT 7%{d.vatMode === "included" ? " (รวมในราคา)" : ""} <b>{baht(d.vat)}</b>
            </span>
          )}
          <span className="total">
            ยอดสุทธิ <b>{baht(d.total)}</b>
          </span>
        </div>
      ) : null}
      <div className="deal-facts">
        {card.kind === "request" && d.needBy && (
          <span>
            <CalendarClock size={13} /> ต้องการภายใน {thaiDay(d.needBy)}
          </span>
        )}
        {card.kind === "request" && !!d.budget && <span>งบประมาณ {baht(d.budget)}</span>}
        {card.kind === "quote" && d.validUntil && (
          <span className={expired ? "bad" : ""}>
            <CalendarClock size={13} /> ยืนราคาถึง {thaiDay(d.validUntil)}
          </span>
        )}
        {card.kind === "quote" && d.deliverBy && <span>ส่งมอบ {thaiDay(d.deliverBy)}</span>}
        {card.kind === "quote" && d.payTerms && <span>เงื่อนไขชำระ: {d.payTerms}</span>}
      </div>
      {d.notes && <p className="deal-notes">{d.notes}</p>}
      {card.reason && card.status !== "accepted" && (
        <p className={"deal-reason " + card.status}>
          {card.status === "rejected" ? "เหตุผลที่ปฏิเสธ" : card.status === "withdrawn" ? "เหตุผล" : "ผู้ซื้อขอแก้ไข"}: {card.reason}
          {card.decided_by && <small> — {card.decided_by}</small>}
        </p>
      )}
      {card.status === "accepted" && (
        <div className="deal-agreed">
          <BadgeCheck size={18} />
          <span>
            <b>ตกลงจ้างงานแล้ว</b>
            <small>
              ตอบรับโดย {card.decided_by}
              {card.decided_at && " · " + new Date(card.decided_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}
            </small>
          </span>
          {seller && (
            <button type="button" onClick={() => navigate("projects")}>
              เปิดโปรเจกต์
            </button>
          )}
          {buyer && (
            <button type="button" onClick={() => navigate("tasks")}>
              เปิดงานติดตาม
            </button>
          )}
        </div>
      )}

      {/* what each side can press */}
      {!viewer && live && (
        <div className="deal-actions">
          {card.kind === "request" && seller && (
            <button type="button" className="primary" onClick={() => onQuote(card)}>
              <ReceiptText size={14} /> สร้างใบเสนอราคาจากคำขอนี้
            </button>
          )}
          {card.kind === "request" && card.mine && card.status === "open" && (
            <button type="button" className="ghost" disabled={busy} onClick={() => act(`/b2b/cards/${card.id}/withdraw`, {}, "ยกเลิกคำขอแล้ว")}>
              <Trash2 size={14} /> ยกเลิกคำขอ
            </button>
          )}
          {card.kind === "quote" && isLatest && buyer && card.status === "open" && !ask && (
            <>
              <button
                type="button"
                className="ok"
                disabled={busy || !boss || expired}
                title={!boss ? "เฉพาะเจ้าของหรือผู้จัดการตอบรับได้" : expired ? "หมดอายุแล้ว ขอให้ผู้ขายส่งฉบับใหม่" : undefined}
                onClick={() => act(`/b2b/cards/${card.id}/decide`, { decision: "accept" }, "ตอบรับใบเสนอราคาแล้ว")}
              >
                <Check size={14} /> ตอบรับ
              </button>
              <button type="button" className="warn" disabled={busy} onClick={() => setAsk("change")}>
                <Pencil size={14} /> ขอแก้ไข
              </button>
              <button type="button" className="bad" disabled={busy || !boss} title={!boss ? "เฉพาะเจ้าของหรือผู้จัดการปฏิเสธได้" : undefined} onClick={() => setAsk("reject")}>
                <CircleX size={14} /> ปฏิเสธ
              </button>
            </>
          )}
          {card.kind === "quote" && isLatest && seller && (card.status === "open" || card.status === "change") && (
            <>
              <button type="button" className="primary" onClick={() => onQuote(card)}>
                <Pencil size={14} /> {card.status === "change" ? "แก้ไขแล้วส่งใหม่" : "ส่งฉบับใหม่"}
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => act(`/b2b/cards/${card.id}/withdraw`, {}, "ถอนใบเสนอราคาแล้ว")}>
                <Undo2 size={14} /> ถอน
              </button>
            </>
          )}
        </div>
      )}
      {ask && (
        <form
          className="deal-ask"
          onSubmit={(e) => {
            e.preventDefault();
            act(`/b2b/cards/${card.id}/decide`, { decision: ask, reason }, ask === "change" ? "ส่งคำขอแก้ไขแล้ว" : "ปฏิเสธใบเสนอราคาแล้ว");
          }}
        >
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            placeholder={ask === "change" ? "อยากให้แก้อะไร เช่น ขอลดราคาบูธเหลือ 110,000" : "เหตุผล (ไม่บังคับ)"}
          />
          <button className={ask === "change" ? "warn" : "bad"} disabled={busy || (ask === "change" && reason.trim().length < 3)}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} {ask === "change" ? "ส่งคำขอแก้ไข" : "ยืนยันปฏิเสธ"}
          </button>
          <button type="button" className="ghost" onClick={() => setAsk("")} aria-label="ยกเลิก">
            <X size={14} />
          </button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
      <footer>
        {card.author_name} · {new Date(card.created_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}
        {sample && <span className="sample-badge">ตัวอย่าง</span>}
      </footer>
    </article>
  );
}

/* ---------- forms ---------- */
type Row = { name: string; qty: string; unit: string; price: string };
const blank = (): Row => ({ name: "", qty: "1", unit: "", price: "" });
const rowsOf = (items?: DealItem[]): Row[] =>
  items?.length ? items.map((i) => ({ name: i.name, qty: String(i.qty ?? 1), unit: i.unit || "", price: i.price !== undefined ? String(i.price) : "" })) : [blank()];

function Items({ rows, setRows, priced }: { rows: Row[]; setRows: (r: Row[]) => void; priced: boolean }) {
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)));
  return (
    <div className={"deal-rows" + (priced ? " priced" : "")}>
      <div className="deal-row head">
        <span>รายการ</span>
        <span>จำนวน</span>
        <span>หน่วย</span>
        {priced && <span>ราคา/หน่วย</span>}
        {priced && <span>รวม</span>}
        <span />
      </div>
      {rows.map((r, i) => (
        <div className="deal-row" key={i}>
          <input value={r.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="เช่น บูธ 3x6 ม." maxLength={300} aria-label="รายการ" />
          <input value={r.qty} onChange={(e) => set(i, "qty", e.target.value)} inputMode="decimal" aria-label="จำนวน" />
          <input value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} placeholder="ชิ้น" maxLength={30} aria-label="หน่วย" />
          {priced && <input value={r.price} onChange={(e) => set(i, "price", e.target.value)} inputMode="decimal" placeholder="0" aria-label="ราคาต่อหน่วย" />}
          {priced && <b>{baht((Number(r.qty) || 0) * (Number(r.price) || 0))}</b>}
          <button type="button" className="icon-button" aria-label="ลบรายการ" disabled={rows.length < 2} onClick={() => setRows(rows.filter((_, n) => n !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="deal-addrow" onClick={() => setRows([...rows, blank()])} disabled={rows.length >= 100}>
        <Plus size={14} /> เพิ่มรายการ
      </button>
    </div>
  );
}

export function RequestForm({ thread, onClose, onSent, sample }: { thread: string; onClose: () => void; onSent: () => void; sample?: boolean }) {
  const [title, setTitle] = useState(""),
    [rows, setRows] = useState<Row[]>([blank()]),
    [needBy, setNeedBy] = useState(""),
    [budget, setBudget] = useState(""),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sample) return setError("นี่คือตัวอย่าง — ส่งได้จริงเมื่อคุยกับบริษัทในเครือข่าย");
    setBusy(true);
    setError("");
    try {
      await api(`/b2b/${thread}/request`, {
        method: "POST",
        body: { title, items: rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name, qty: Number(r.qty) || 1, unit: r.unit })), needBy, budget: budget ? Number(budget) : null, notes },
      });
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="ขอใบเสนอราคา" onClose={onClose} className="deal-modal">
      <form onSubmit={submit} className="deal-form">
        <label className="deal-field wide">
          <span>ต้องการอะไร</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus placeholder="เช่น ออกแบบและติดตั้งบูธงาน Bangkok Expo" />
        </label>
        <Items rows={rows} setRows={setRows} priced={false} />
        <div className="deal-two">
          <label className="deal-field">
            <span>ต้องการภายใน</span>
            <input type="date" value={needBy} min={today()} onChange={(e) => setNeedBy(e.target.value)} />
          </label>
          <label className="deal-field">
            <span>งบประมาณ (ถ้ามี)</span>
            <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="บาท" />
          </label>
        </div>
        <label className="deal-field wide">
          <span>รายละเอียดเพิ่มเติม</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="สเปก สถานที่ เงื่อนไขที่ต้องการ" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="primary" disabled={busy || !title.trim() || !rows.some((r) => r.name.trim())}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} ส่งคำขอในแชท
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function QuoteForm({ thread, deal, from, onClose, onSent, sample }: { thread: string; deal?: Deal | null; from?: DealCard | null; onClose: () => void; onSent: () => void; sample?: boolean }) {
  const src = from?.data;
  const [title, setTitle] = useState(src?.title || deal?.title || ""),
    [rows, setRows] = useState<Row[]>(rowsOf(src?.items)),
    [discount, setDiscount] = useState(src?.discount ? String(src.discount) : ""),
    [vatMode, setVatMode] = useState<"excluded" | "included" | "none">(src?.vatMode || "excluded"),
    [validUntil, setValidUntil] = useState(src?.validUntil && src.validUntil >= today() ? src.validUntil : plusDays(30)),
    [deliverBy, setDeliverBy] = useState(src?.deliverBy || src?.needBy || ""),
    [payTerms, setPayTerms] = useState(src?.payTerms || ""),
    [notes, setNotes] = useState(from?.kind === "quote" ? src?.notes || "" : ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const t = useMemo(() => quoteTotals(rows, Number(discount) || 0, vatMode), [rows, discount, vatMode]);
  const revising = from?.kind === "quote";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sample) return setError("นี่คือตัวอย่าง — ส่งได้จริงเมื่อคุยกับบริษัทในเครือข่าย");
    setBusy(true);
    setError("");
    try {
      await api(`/b2b/${thread}/quote`, {
        method: "POST",
        body: {
          deal: deal?.id || null,
          title,
          items: rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name, qty: Number(r.qty) || 1, unit: r.unit, price: Number(r.price) || 0 })),
          discount: Number(discount) || 0,
          vatMode,
          validUntil,
          deliverBy,
          payTerms,
          notes,
        },
      });
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title={revising ? `แก้ไขใบเสนอราคา (Rev.${(from?.rev || 1) + 1})` : "ส่งใบเสนอราคา"} onClose={onClose} className="deal-modal">
      <form onSubmit={submit} className="deal-form">
        {from?.kind === "quote" && from.status === "change" && from.reason && <p className="deal-reason change">ผู้ซื้อขอแก้ไข: {from.reason}</p>}
        {from?.kind === "request" && <p className="deal-from">ดึงรายการจากคำขอให้แล้ว เหลือแค่ใส่ราคา</p>}
        <label className="deal-field wide">
          <span>หัวข้อ</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus={!title} />
        </label>
        <Items rows={rows} setRows={setRows} priced />
        <div className="deal-totals">
          <label className="deal-field">
            <span>ส่วนลด (บาท)</span>
            <input value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0" />
          </label>
          <label className="deal-field">
            <span>VAT</span>
            <select value={vatMode} onChange={(e) => setVatMode(e.target.value as typeof vatMode)}>
              <option value="excluded">บวก VAT 7%</option>
              <option value="included">รวม VAT แล้ว</option>
              <option value="none">ไม่มี VAT</option>
            </select>
          </label>
          <div className="deal-total-box">
            <span>
              รวม <b>{baht(t.subtotal)}</b>
            </span>
            {vatMode !== "none" && (
              <span>
                VAT <b>{baht(t.vat)}</b>
              </span>
            )}
            <span className="total">
              ยอดสุทธิ <b>{baht(t.total)}</b>
            </span>
          </div>
        </div>
        <div className="deal-two">
          <label className="deal-field">
            <span>ยืนราคาถึง</span>
            <input type="date" value={validUntil} min={today()} onChange={(e) => setValidUntil(e.target.value)} required />
          </label>
          <label className="deal-field">
            <span>ส่งมอบงาน</span>
            <input type="date" value={deliverBy} min={today()} onChange={(e) => setDeliverBy(e.target.value)} />
          </label>
        </div>
        <label className="deal-field wide">
          <span>เงื่อนไขการชำระ</span>
          <input value={payTerms} onChange={(e) => setPayTerms(e.target.value)} maxLength={300} placeholder="เช่น มัดจำ 50% ส่วนที่เหลือเมื่อส่งมอบ" />
        </label>
        <label className="deal-field wide">
          <span>หมายเหตุ</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="primary" disabled={busy || !title.trim() || !rows.some((r) => r.name.trim())}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} ส่งใบเสนอราคาในแชท
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- sample deal (public demo) ---------- */
/** We are the seller (first sample conversation) or the buyer (second one), so the demo shows both sides. */
export function sampleDeal(threadId: string, otherName: string, role: "buyer" | "seller" = "seller"): Deal {
  const buyerName = otherName;
  const at = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
  const items = [
    { name: "ออกแบบและติดตั้งบูธ 3x6 ม.", qty: 1, unit: "งาน", price: 110000, amount: 110000 },
    { name: "ป้ายไวนิลพร้อมโครง", qty: 10, unit: "แผ่น", price: 1500, amount: 15000 },
  ];
  const card = (id: string, kind: DealCard["kind"], rev: number, status: DealCard["status"], mine: boolean, data: DealCard["data"], h: number, extra: Partial<DealCard> = {}): DealCard => ({
    id,
    deal_id: "sample-deal",
    kind,
    rev,
    status,
    reason: null,
    decided_by: null,
    decided_at: null,
    author_name: mine ? "คุณ" : otherName,
    created_at: at(h),
    mine,
    data,
    ...extra,
  });
  return {
    id: "sample-deal",
    title: "บูธงาน Bangkok Expo 2026",
    stage: "quote",
    role,
    accepted_at: null,
    accepted_by: null,
    created_at: at(30),
    updated_at: at(1),
    project_id: null,
    quote_id: null,
    task_id: null,
    cards: [
      card("sample-rfq", "request", 1, "open", role === "buyer", { title: "บูธงาน Bangkok Expo 2026", items: items.map(({ name, qty, unit }) => ({ name, qty, unit })), needBy: plusDays(35), budget: 150000, notes: "ขอแบบ 3D ประกอบด้วยค่ะ" }, 30),
      card("sample-q1", "quote", 1, "superseded", role === "seller", { title: "บูธงาน Bangkok Expo 2026", docNo: "QT2611-8F3A2", items: [{ ...items[0], price: 120000, amount: 120000 }, items[1]], subtotal: 135000, discount: 0, vatMode: "excluded", vat: 9450, total: 144450, validUntil: plusDays(25), deliverBy: plusDays(33), payTerms: "มัดจำ 50% ส่วนที่เหลือเมื่อส่งมอบ" }, 20, {
        reason: "ขอลดราคาบูธเหลือ 110,000 ได้ไหมคะ",
        decided_by: role === "seller" ? buyerName : "คุณ",
      }),
      card("sample-q2", "quote", 2, "open", role === "seller", { title: "บูธงาน Bangkok Expo 2026", docNo: "QT2611-8F3A2-R2", items, subtotal: 125000, discount: 0, vatMode: "excluded", vat: 8750, total: 133750, validUntil: plusDays(25), deliverBy: plusDays(33), payTerms: "มัดจำ 50% ส่วนที่เหลือเมื่อส่งมอบ" }, 1),
    ],
  };
}
