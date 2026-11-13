"use client";
// ห้องดีล in the B2B chat (phase 1): progress bar, the request / quotation cards, their forms and decisions.
// Rules live in the database (migration 0064); these only show what each side can press.
import { useMemo, useState, type FormEvent } from "react";
import { Ban, BadgeCheck, Banknote, CalendarClock, Camera, Check, CircleX, CreditCard, FileText, Handshake, LoaderCircle, Package, Pencil, Plus, ReceiptText, RotateCcw, Send, Trash2, TriangleAlert, Undo2, X } from "lucide-react";
import type { Context } from "@/lib/types";
import { dealMoney, quoteTotals, type Deal, type DealCard, type DealItem } from "@/lib/b2b-deal-types";
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
const steps: { key: string; label: string }[] = [
  { key: "request", label: "คำขอ" },
  { key: "quote", label: "ใบเสนอราคา" },
  { key: "accepted", label: "ตกลงจ้าง" },
  { key: "work", label: "กำลังทำ" },
  { key: "check", label: "ตรวจรับ" },
  { key: "bill", label: "วางบิล" },
  { key: "paid", label: "ชำระครบ" },
];
const stageText: Record<Deal["stage"], string> = {
  request: "รอใบเสนอราคา",
  quote: "รอผู้ซื้อตัดสินใจ",
  accepted: "ตกลงจ้างงานแล้ว",
  work: "กำลังทำงาน",
  delivered: "รอตรวจรับงาน",
  checked: "ตรวจรับแล้ว · รอชำระ",
  closed: "ปิดงานเรียบร้อย",
  rejected: "ผู้ซื้อปฏิเสธ",
  cancelled: "ยกเลิกแล้ว",
};
const working = (d: Deal) => ["accepted", "work", "delivered", "checked"].includes(d.stage);
/** The step in progress (steps before it are done). */
function stepAt(d: Deal) {
  const m = dealMoney(d);
  const at: Record<string, number> = { request: 0, quote: 1, accepted: 3, work: 3, delivered: 4, checked: m.total && m.paid >= m.total ? 7 : 5, closed: 7 };
  return d.stage in at ? at[d.stage] : -1;
}
export type DealStepKind = "progress" | "deliver" | "invoice" | "cancel";

export function DealBar({
  deals,
  onRequest,
  onQuote,
  onStep,
  disabled,
}: {
  deals: Deal[];
  onRequest: () => void;
  onQuote: () => void;
  onStep: (step: DealStepKind, deal: Deal) => void;
  disabled?: boolean;
}) {
  // The deal in progress (else the latest one).
  const deal = [...deals].reverse().find((d) => d.stage === "request" || d.stage === "quote" || working(d)) || deals[deals.length - 1];
  const at = deal ? stepAt(deal) : -1,
    m = deal ? dealMoney(deal) : null,
    seller = deal?.role === "seller",
    cancelOpen = deal?.cards.some((c) => c.kind === "cancel" && c.status === "open"),
    billable = m ? m.rows.filter((r) => !r.invoice) : [];
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
          <span className="deal-bar-hint">ห้องดีล · ขอใบเสนอราคา ส่งใบเสนอราคา ตกลงจ้าง ส่งมอบงาน และชำระเงินได้ในแชทนี้</span>
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
          {steps.map((st, i) => (
            <li key={st.key} className={i < at ? "done" : i === at ? "now" : ""}>
              <i>{i < at ? <Check size={11} /> : i + 1}</i>
              {st.label}
            </li>
          ))}
        </ol>
      )}
      {deal && m && (working(deal) || deal.stage === "closed") && (
        <div className="deal-work">
          <div className="deal-money">
            <span>
              ยอดงาน <b>{baht(m.total)}</b>
            </span>
            <span className="ok">
              ชำระแล้ว <b>{baht(m.paid)}</b>
            </span>
            {m.left > 0 && (
              <span className="left">
                คงเหลือ <b>{baht(m.left)}</b>
              </span>
            )}
            <span className="deal-inst">
              {m.rows.map((r) => (
                <em key={r.index} className={r.paid ? "paid" : r.invoice ? "billed" : ""} title={r.paid ? "ชำระแล้ว" : r.invoice ? "ออกใบแจ้งหนี้แล้ว รอชำระ" : "ยังไม่ออกใบแจ้งหนี้"}>
                  {r.paid ? <Check size={11} /> : null}
                  {r.label} {r.percent}%
                </em>
              ))}
            </span>
          </div>
          {working(deal) && !disabled && (
            <div className="deal-work-actions">
              {seller && (deal.stage === "accepted" || deal.stage === "work") && (
                <>
                  <button type="button" onClick={() => onStep("progress", deal)}>
                    <Camera size={14} /> อัปเดตงาน
                  </button>
                  <button type="button" className="go" onClick={() => onStep("deliver", deal)}>
                    <Package size={14} /> ส่งมอบงาน
                  </button>
                </>
              )}
              {seller && billable.length > 0 && (
                <button type="button" className="bill" onClick={() => onStep("invoice", deal)}>
                  <ReceiptText size={14} /> ออกใบแจ้งหนี้
                </button>
              )}
              {!cancelOpen && (
                <button type="button" className="stop" onClick={() => onStep("cancel", deal)}>
                  <Ban size={14} /> ขอยกเลิกงาน
                </button>
              )}
            </div>
          )}
        </div>
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
const kindChip: Partial<Record<DealCard["kind"], Partial<Record<DealCard["status"], [string, string]>>>> = {
  progress: { accepted: ["อัปเดตงาน", "open"] },
  delivery: { open: ["รอตรวจรับ", "warn"], accepted: ["ตรวจรับแล้ว", "ok"], change: ["ขอแก้งาน", "warn"], withdrawn: ["ยกเลิก", "muted"] },
  invoice: { open: ["รอชำระ", "warn"], accepted: ["ชำระแล้ว", "ok"], withdrawn: ["ยกเลิก", "muted"] },
  payment: { open: ["รอยืนยันรับเงิน", "warn"], accepted: ["ได้รับเงินแล้ว", "ok"], rejected: ["ยังไม่ได้รับเงิน", "bad"], withdrawn: ["ยกเลิก", "muted"] },
  cancel: { open: ["รออีกฝ่ายยืนยัน", "warn"], accepted: ["ยกเลิกงานแล้ว", "bad"], rejected: ["ไม่ยินยอม · ทำงานต่อ", "muted"] },
};
const kindHead: Record<DealCard["kind"], [string, typeof FileText]> = {
  request: ["คำขอใบเสนอราคา", FileText],
  quote: ["ใบเสนอราคา", ReceiptText],
  progress: ["อัปเดตความคืบหน้า", Camera],
  delivery: ["ส่งมอบงาน", Package],
  invoice: ["ใบแจ้งหนี้", ReceiptText],
  payment: ["แจ้งชำระเงิน", CreditCard],
  cancel: ["ขอยกเลิกงาน", Ban],
};

export function DealCardView({
  card,
  deal,
  ctx,
  sample,
  onQuote,
  onPay,
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
  /** Buyer: open the payment form for this invoice. */
  onPay?: (invoice: DealCard) => void;
  onChanged: () => void;
  notify: (s: string) => void;
  navigate: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [ask, setAsk] = useState<"" | "change" | "reject" | "fix" | "notpaid" | "decline">(""),
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
  const [label, tone] = expired ? ["หมดอายุ", "bad"] : kindChip[card.kind]?.[card.status] || statusChip[card.status];
  const [headText, HeadIcon] = kindHead[card.kind],
    paying = card.kind === "invoice" && deal.cards.some((c) => c.kind === "payment" && c.status === "open" && c.data.invoice === card.id);
  return (
    <article className={"deal-card " + card.kind + " st-" + card.status + (card.mine ? " mine" : "")}>
      <header>
        <span className="deal-card-icon">
          <HeadIcon size={16} />
        </span>
        <span className="deal-card-title">
          <small>
            {headText} {d.docNo || ""}
            {card.kind === "delivery" && (d.round || 1) > 1 && <em>รอบที่ {d.round}</em>}
            {card.kind === "invoice" && <em>{d.label}</em>}
            {card.kind === "quote" && card.rev > 1 && <em>Rev.{card.rev}</em>}
          </small>
          <b>{d.title}</b>
        </span>
        <span className={"deal-chip " + tone}>{label}</span>
      </header>

      {d.items?.length > 0 && (
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
      )}

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
          {card.kind === "delivery"
            ? "สิ่งที่ต้องแก้"
            : card.kind === "payment"
              ? "ผู้รับจ้างแจ้งว่า"
              : card.kind === "cancel"
                ? "เหตุผลที่ไม่ยินยอม"
                : card.status === "rejected"
                  ? "เหตุผลที่ปฏิเสธ"
                  : card.status === "withdrawn"
                    ? "เหตุผล"
                    : "ผู้ซื้อขอแก้ไข"}
          : {card.reason}
          {card.decided_by && <small> — {card.decided_by}</small>}
        </p>
      )}
      {card.kind === "progress" && (
        <div className="deal-progress">
          <i>
            <em style={{ width: (d.percent || 0) + "%" }} />
          </i>
          <b>{d.percent}%</b>
        </div>
      )}
      {card.kind === "invoice" && (
        <div className="deal-sum">
          <span>
            {d.label} {d.percent}% ของ {d.quoteNo}
          </span>
          <span>
            ก่อน VAT <b>{baht(d.net)}</b>
          </span>
          {!!d.vat && (
            <span>
              VAT 7% <b>{baht(d.vat)}</b>
            </span>
          )}
          <span className="total">
            ยอดเรียกเก็บ <b>{baht(d.amount)}</b>
          </span>
        </div>
      )}
      {card.kind === "invoice" && d.due && (
        <div className="deal-facts">
          <span className={card.status === "open" && d.due < today() ? "bad" : ""}>
            <CalendarClock size={13} /> ครบกำหนด {thaiDay(d.due)}
          </span>
        </div>
      )}
      {card.kind === "payment" && (
        <div className="deal-sum">
          <span>
            ใบแจ้งหนี้ {d.invoiceNo} ({d.label}) <b>{baht(d.amount)}</b>
          </span>
          {!!d.wht && (
            <span>
              หัก ณ ที่จ่าย {d.whtRate}% <b>-{baht(d.wht)}</b>
            </span>
          )}
          <span className="total">
            ยอดโอน <b>{baht(d.transfer)}</b>
          </span>
        </div>
      )}
      {card.kind === "payment" && (
        <div className="deal-facts">
          <span>
            <Banknote size={13} /> {d.method} · {thaiDay(d.date)}
          </span>
          {d.reference && <span>อ้างอิง {d.reference}</span>}
          {d.receiptNo && <span className="ok">ใบเสร็จ {d.receiptNo}</span>}
        </div>
      )}
      {card.kind === "cancel" && !!d.paid && (
        <div className="deal-facts">
          <span className="bad">มีเงินที่ชำระแล้ว {baht(d.paid)} — ตกลงเรื่องคืนเงินกันโดยตรง</span>
        </div>
      )}
      {card.kind === "quote" && !!d.installments?.length && d.installments.length > 1 && (
        <div className="deal-facts">
          {d.installments.map((x, i) => (
            <span key={i}>
              งวด {i + 1}: {x.label} {x.percent}%
            </span>
          ))}
        </div>
      )}
      {card.kind === "quote" && card.status === "accepted" && (
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
      {!viewer && !ask && (
        <>
          {card.kind === "delivery" && buyer && card.status === "open" && deal.stage === "delivered" && (
            <div className="deal-actions">
              <button type="button" className="ok" disabled={busy} onClick={() => act(`/b2b/cards/${card.id}/check`, { ok: true }, "ตรวจรับงานแล้ว")}>
                <Check size={14} /> ตรวจรับงาน
              </button>
              <button type="button" className="warn" disabled={busy} onClick={() => setAsk("fix")}>
                <RotateCcw size={14} /> ขอแก้งาน
              </button>
            </div>
          )}
          {card.kind === "invoice" && buyer && card.status === "open" && (
            <div className="deal-actions">
              {paying ? (
                <span className="deal-wait">แจ้งชำระแล้ว รอผู้รับจ้างยืนยันรับเงิน</span>
              ) : (
                <button type="button" className="ok" onClick={() => (onPay ? onPay(card) : null)}>
                  <CreditCard size={14} /> แจ้งชำระเงิน
                </button>
              )}
            </div>
          )}
          {card.kind === "payment" && seller && card.status === "open" && (
            <div className="deal-actions">
              <button type="button" className="ok" disabled={busy} onClick={() => act(`/b2b/cards/${card.id}/receive`, { ok: true }, "ยืนยันรับเงินแล้ว ออกใบเสร็จให้แล้ว")}>
                <Check size={14} /> ได้รับเงินแล้ว
              </button>
              <button type="button" className="warn" disabled={busy} onClick={() => setAsk("notpaid")}>
                <TriangleAlert size={14} /> ยังไม่ได้รับเงิน
              </button>
            </div>
          )}
          {card.kind === "cancel" && !card.mine && card.status === "open" && (
            <div className="deal-actions">
              <button
                type="button"
                className="bad"
                disabled={busy || !boss}
                title={!boss ? "เฉพาะเจ้าของหรือผู้จัดการยืนยันได้" : undefined}
                onClick={() => act(`/b2b/cards/${card.id}/answer`, { agree: true }, "ยืนยันยกเลิกงานแล้ว")}
              >
                <Ban size={14} /> ยืนยันยกเลิก
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => setAsk("decline")}>
                ไม่ยินยอม ทำงานต่อ
              </button>
            </div>
          )}
        </>
      )}
      {ask && (
        <form
          className="deal-ask"
          onSubmit={(e) => {
            e.preventDefault();
            const go: Record<string, [string, object, string]> = {
              change: ["decide", { decision: "change", reason }, "ส่งคำขอแก้ไขแล้ว"],
              reject: ["decide", { decision: "reject", reason }, "ปฏิเสธใบเสนอราคาแล้ว"],
              fix: ["check", { ok: false, reason }, "ส่งคำขอแก้งานแล้ว"],
              notpaid: ["receive", { ok: false, reason }, "แจ้งว่ายังไม่ได้รับเงินแล้ว"],
              decline: ["answer", { agree: false, reason }, "ไม่ยินยอมยกเลิก ทำงานต่อ"],
            };
            const [path, body, done] = go[ask];
            act(`/b2b/cards/${card.id}/${path}`, body, done);
          }}
        >
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            placeholder={
              ask === "change"
                ? "อยากให้แก้อะไร เช่น ขอลดราคาบูธเหลือ 110,000"
                : ask === "fix"
                  ? "สิ่งที่ต้องแก้ เช่น ป้ายด้านข้างสีเพี้ยน"
                  : ask === "notpaid"
                    ? "เช่น ยอดยังไม่เข้าบัญชี / ยอดไม่ตรง"
                    : "เหตุผล (ไม่บังคับ)"
            }
          />
          <button className={ask === "reject" || ask === "decline" ? "bad" : "warn"} disabled={busy || (["change", "fix", "notpaid"].includes(ask) && reason.trim().length < 3)}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}{" "}
            {{ change: "ส่งคำขอแก้ไข", reject: "ยืนยันปฏิเสธ", fix: "ส่งคำขอแก้งาน", notpaid: "แจ้งผู้จ้าง", decline: "ยืนยัน ทำงานต่อ" }[ask]}
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
    [inst, setInst] = useState<{ label: string; percent: string }[]>(
      src?.installments?.length ? src.installments.map((x) => ({ label: x.label, percent: String(x.percent) })) : [{ label: "ชำระเต็มจำนวน", percent: "100" }],
    ),
    [notes, setNotes] = useState(from?.kind === "quote" ? src?.notes || "" : ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const t = useMemo(() => quoteTotals(rows, Number(discount) || 0, vatMode), [rows, discount, vatMode]);
  const revising = from?.kind === "quote",
    instSum = Math.round(inst.reduce((n, x) => n + (Number(x.percent) || 0), 0) * 100) / 100;
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
          installments: inst.filter((x) => Number(x.percent) > 0).map((x) => ({ label: x.label, percent: Number(x.percent) })),
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
        <div className="deal-field wide">
          <span>
            งวดชำระ <small className={instSum === 100 ? "ok" : "bad"}>รวม {instSum}%</small>
          </span>
          <div className="deal-presets">
            {(
              [
                ["จ่ายครั้งเดียว", [["ชำระเต็มจำนวน", 100]]],
                ["มัดจำ 30/70", [["มัดจำ", 30], ["ส่วนที่เหลือเมื่อส่งมอบ", 70]]],
                ["50/50", [["มัดจำ", 50], ["ส่วนที่เหลือเมื่อส่งมอบ", 50]]],
              ] as [string, [string, number][]][]
            ).map(([name, rows]) => (
              <button type="button" key={name} onClick={() => setInst(rows.map(([label, percent]) => ({ label, percent: String(percent) })))}>
                {name}
              </button>
            ))}
          </div>
          {inst.map((x, i) => (
            <div className="deal-inst-row" key={i}>
              <input value={x.label} maxLength={60} onChange={(e) => setInst(inst.map((y, n) => (n === i ? { ...y, label: e.target.value } : y)))} aria-label="ชื่องวด" />
              <input value={x.percent} inputMode="decimal" onChange={(e) => setInst(inst.map((y, n) => (n === i ? { ...y, percent: e.target.value.replace(/[^\d.]/g, "") } : y)))} aria-label="เปอร์เซ็นต์" />
              <small>% = {baht((t.total * (Number(x.percent) || 0)) / 100)}</small>
              <button type="button" className="icon-button" aria-label="ลบงวด" disabled={inst.length < 2} onClick={() => setInst(inst.filter((_, n) => n !== i))}>
                <X size={14} />
              </button>
            </div>
          ))}
          {inst.length < 6 && (
            <button type="button" className="deal-addrow" onClick={() => setInst([...inst, { label: "งวดที่ " + (inst.length + 1), percent: "" }])}>
              <Plus size={14} /> เพิ่มงวด
            </button>
          )}
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
          <button className="primary" disabled={busy || !title.trim() || !rows.some((r) => r.name.trim()) || instSum !== 100}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} ส่งใบเสนอราคาในแชท
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- phase 2 forms ---------- */
export function StepForm({ deal, step, onClose, onSent, sample }: { deal: Deal; step: DealStepKind; onClose: () => void; onSent: () => void; sample?: boolean }) {
  const m = dealMoney(deal),
    billable = m.rows.filter((r) => !r.invoice),
    lastIndex = m.rows.length - 1;
  const [percent, setPercent] = useState(String(Math.max(...deal.cards.filter((c) => c.kind === "progress").map((c) => Number(c.data.percent) || 0), 0) || 50)),
    [note, setNote] = useState(""),
    [index, setIndex] = useState(String(billable.find((r) => r.index !== lastIndex || deal.stage === "checked")?.index ?? billable[0]?.index ?? 0)),
    [due, setDue] = useState(plusDays(30)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const title = { progress: "อัปเดตความคืบหน้า", deliver: "ส่งมอบงาน", invoice: "ออกใบแจ้งหนี้", cancel: "ขอยกเลิกงาน" }[step];
  const pick = m.rows[Number(index)];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sample) return setError("นี่คือตัวอย่าง — ส่งได้จริงเมื่อคุยกับบริษัทในเครือข่าย");
    setBusy(true);
    setError("");
    try {
      const body = step === "progress" ? { percent: Number(percent), note } : step === "deliver" ? { note } : step === "invoice" ? { index: Number(index), due } : { reason: note };
      await api(`/b2b/deals/${deal.id}/${step}`, { method: "POST", body });
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  const total = Number(m.quote?.data.total) || 0;
  return (
    <Modal title={title} onClose={onClose} className="deal-modal small">
      <form onSubmit={submit} className="deal-form">
        <p className="deal-from">{deal.title}</p>
        {step === "progress" && (
          <label className="deal-field wide">
            <span>ความคืบหน้า {percent}%</span>
            <input type="range" min={0} max={100} step={5} value={percent} onChange={(e) => setPercent(e.target.value)} />
          </label>
        )}
        {step === "invoice" && (
          <>
            <label className="deal-field wide">
              <span>งวดที่จะเรียกเก็บ</span>
              <select value={index} onChange={(e) => setIndex(e.target.value)}>
                {billable.map((r) => (
                  <option key={r.index} value={r.index} disabled={r.index === lastIndex && deal.stage !== "checked"}>
                    {r.label} {r.percent}% · {baht((total * r.percent) / 100)}
                    {r.index === lastIndex && deal.stage !== "checked" ? " (ออกได้หลังตรวจรับงาน)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="deal-field">
              <span>ครบกำหนดชำระ</span>
              <input type="date" value={due} min={today()} onChange={(e) => setDue(e.target.value)} required />
            </label>
            {pick && <p className="deal-from">ยอดเรียกเก็บประมาณ {baht((total * pick.percent) / 100)} (รวม VAT ตามใบเสนอราคา) · ระบบออกเลขที่และบันทึกในใบแจ้งหนี้ของบริษัทให้</p>}
          </>
        )}
        {step !== "invoice" && (
          <label className="deal-field wide">
            <span>{step === "progress" ? "ทำอะไรไปแล้ว" : step === "deliver" ? "รายละเอียดการส่งมอบ" : "เหตุผลที่ขอยกเลิก"}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              required={step !== "deliver"}
              placeholder={step === "progress" ? "เช่น ขึ้นโครงบูธเสร็จแล้ว รอติดตั้งป้าย" : step === "deliver" ? "เช่น ติดตั้งเสร็จที่ไบเทค ฮอลล์ 98 พร้อมลิงก์รูปงาน" : "อีกฝ่ายต้องกดยืนยันก่อน งานถึงจะถูกยกเลิก"}
            />
          </label>
        )}
        {step === "cancel" && m.paid > 0 && <p className="deal-reason rejected">มีเงินที่ชำระแล้ว {baht(m.paid)} — หลังยกเลิกให้ตกลงเรื่องคืนเงินกันโดยตรง</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            ยกเลิก
          </button>
          <button className={step === "cancel" ? "danger" : "primary"} disabled={busy || (step === "cancel" && note.trim().length < 3) || (step === "progress" && !note.trim())}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} {step === "cancel" ? "ส่งคำขอยกเลิก" : "ส่งในแชท"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PayForm({ invoice, onClose, onSent, sample }: { invoice: DealCard; onClose: () => void; onSent: () => void; sample?: boolean }) {
  const d = invoice.data;
  const [rate, setRate] = useState("0"),
    [date, setDate] = useState(today()),
    [method, setMethod] = useState("โอนธนาคาร"),
    [reference, setReference] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const wht = Math.round(((Number(d.net) || 0) * Number(rate)) / 100 * 100) / 100,
    transfer = (Number(d.amount) || 0) - wht;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sample) return setError("นี่คือตัวอย่าง — ส่งได้จริงเมื่อคุยกับบริษัทในเครือข่าย");
    setBusy(true);
    setError("");
    try {
      await api(`/b2b/cards/${invoice.id}/pay`, { method: "POST", body: { whtRate: Number(rate), date, method, reference } });
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="แจ้งชำระเงิน" onClose={onClose} className="deal-modal small">
      <form onSubmit={submit} className="deal-form">
        <p className="deal-from">
          ใบแจ้งหนี้ {d.docNo} · {d.label} · {baht(d.amount)}
        </p>
        <div className="deal-two">
          <label className="deal-field">
            <span>หัก ณ ที่จ่าย</span>
            <select value={rate} onChange={(e) => setRate(e.target.value)}>
              <option value="0">ไม่หัก</option>
              <option value="1">1% (ค่าขนส่ง)</option>
              <option value="2">2% (ค่าโฆษณา)</option>
              <option value="3">3% (ค่าบริการ / ค่าจ้าง)</option>
              <option value="5">5% (ค่าเช่า)</option>
            </select>
          </label>
          <label className="deal-field">
            <span>วันที่โอน</span>
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="deal-field">
            <span>ช่องทาง</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {["โอนธนาคาร", "เงินสด", "บัตร", "อื่นๆ"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="deal-field">
            <span>เลขอ้างอิง / สลิป</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} placeholder="เช่น KBank 12345" />
          </label>
        </div>
        <div className="deal-total-box">
          <span>
            ยอดใบแจ้งหนี้ <b>{baht(d.amount)}</b>
          </span>
          {wht > 0 && (
            <span>
              หัก ณ ที่จ่าย {rate}% (จากยอดก่อน VAT {baht(d.net)}) <b>-{baht(wht)}</b>
            </span>
          )}
          <span className="total">
            ยอดที่โอน <b>{baht(transfer)}</b>
          </span>
        </div>
        {wht > 0 && <p className="deal-from">อย่าลืมออกหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ให้ผู้รับจ้าง</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} แจ้งชำระในแชท
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Demo: a deal in the middle of the work — deposit paid, work delivered and waiting for the buyer to check it. */
export function sampleWorkDeal(otherName: string): Deal {
  const at = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
  const base = { deal_id: "sample-work", rev: 1, reason: null, decided_by: null, decided_at: null } as const;
  const q = { title: "ป้ายไฟหน้าร้าน + ติดตั้ง", docNo: "QT2611-5C1D0", items: [{ name: "ป้ายไฟ LED 1.2x3 ม.", qty: 1, unit: "ชุด", price: 48000, amount: 48000 }, { name: "ค่าติดตั้ง", qty: 1, unit: "งาน", price: 7000, amount: 7000 }], subtotal: 55000, discount: 0, vatMode: "excluded" as const, vat: 3850, total: 58850, validUntil: plusDays(20), deliverBy: plusDays(2), installments: [{ label: "มัดจำ", percent: 30 }, { label: "ส่วนที่เหลือเมื่อส่งมอบ", percent: 70 }] };
  const card = (id: string, kind: DealCard["kind"], status: DealCard["status"], mine: boolean, data: Partial<DealCard["data"]>, h: number): DealCard => ({ ...base, id, kind, status, mine, author_name: mine ? "คุณ" : otherName, created_at: at(h), data: { title: q.title, items: [], ...data } as DealCard["data"] });
  return {
    id: "sample-work",
    title: q.title,
    stage: "delivered",
    role: "buyer",
    accepted_at: at(70),
    accepted_by: "คุณ",
    created_at: at(80),
    updated_at: at(1),
    project_id: null,
    quote_id: null,
    task_id: null,
    cards: [
      card("sw-q", "quote", "accepted", false, q, 72),
      card("sw-i1", "invoice", "accepted", false, { docNo: "IV2611-5C1D0-1", index: 0, count: 2, label: "มัดจำ", percent: 30, net: 16500, vat: 1155, amount: 17655, due: plusDays(-10), quoteNo: q.docNo }, 60),
      card("sw-p1", "payment", "accepted", true, { invoice: "sw-i1", invoiceNo: "IV2611-5C1D0-1", label: "มัดจำ", index: 0, amount: 17655, net: 16500, vat: 1155, whtRate: 3, wht: 495, transfer: 17160, date: plusDays(-12), method: "โอนธนาคาร", reference: "KBank 88213", receiptNo: "RC2611-5C1D0-1" }, 48),
      card("sw-g", "progress", "accepted", false, { percent: 70, notes: "ผลิตตัวป้ายเสร็จแล้ว นัดติดตั้งพรุ่งนี้ 9 โมง" }, 26),
      card("sw-d", "delivery", "open", false, { notes: "ติดตั้งเสร็จแล้ว ทดสอบไฟครบทุกดวง ส่งรูปงานในแชทนี้แล้วค่ะ", round: 1 }, 2),
    ],
  };
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
