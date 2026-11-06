"use client";
// LINE items awaiting approval: the review dialog (shared with Data Inbox) and the list each page shows above its records.
import { useCallback, useEffect, useState } from "react";
import { Paperclip, CheckCircle2, Inbox, History, ChevronDown } from "lucide-react";
import { api, Modal, displayDate } from "./shared";
import { FieldControl } from "./records";
import type { Context, Ingestion } from "@/lib/types";
import type { Field } from "@/lib/catalog";
import { formatMoney, isForeign } from "@/lib/fx";

export function IngestionReview({
  record,
  ctx,
  onClose,
  onDone,
}: {
  record: Ingestion;
  ctx: Context;
  onClose: () => void;
  /** Called after approve / reject / retry with a message for the toast. */
  onDone: (message: string) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({ ...record.values }),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const canDecide = ["owner", "manager"].includes(ctx.member.role);
  const act = async (run: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setFormError("");
    try {
      await run();
      await onDone(message);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="ตรวจทานข้อมูล" onClose={onClose}>
      <div className="record-meta">
        {record.template.name} · {record.source} · {displayDate(record.created_at)}
        {(record.source_user || record.created_by) && <> · ผู้ส่ง {String(record.source_user || record.created_by).slice(0, 12)}</>}
      </div>
      {record.decided_at && <p className={"decision-line " + record.status}>{decisionText(record)}</p>}
      <pre className="source-text">{record.raw || "เอกสารแนบ"}</pre>
      {record.attachment_id && (
        <a className="secondary" href={"/api/files/" + record.attachment_id}>
          <Paperclip size={15} />
          เอกสารต้นฉบับ
        </a>
      )}
      {record.error && <p className="form-error">{record.error}</p>}
      {record.status === "failed" && ctx.member.role !== "viewer" && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => act(() => api("/ingestions/" + record.id + "/retry", { method: "POST", body: {} }), "ส่งประมวลผลใหม่แล้ว")}
        >
          ลองประมวลผลใหม่
        </button>
      )}
      {record.template.steps.length > 0 && (
        <div className="note">
          หลังอนุมัติ ระบบจะจับคู่โครงการจากชื่อที่ตรงกัน หรือสร้างโครงการใหม่ ถ้ามีชื่อซ้ำต้องระบุฟิลด์ project_id สำหรับ Template
          พื้นที่ขาย ระบบจะบันทึกดีลและสร้างงานของทีมด้วย
        </div>
      )}
      {record.missing.length > 0 && <div className="note">ข้อมูลที่ขาด: {record.missing.join(", ")}</div>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(() => api("/ingestions/" + record.id, { method: "PATCH", body: { status: "approved", values, reason: "" } }), "อนุมัติและบันทึกเข้าระบบแล้ว");
        }}
      >
        <fieldset disabled={!canDecide || record.status !== "review" || busy}>
          <div className="form-grid">
            {record.template.fields.map((f) => (
              <FieldControl
                key={f.key}
                field={(f.type === "choice" ? { ...f, type: "select" } : { ...f, type: f.type }) as Field}
                value={values[f.key]}
                set={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                options={[]}
              />
            ))}
          </div>
        </fieldset>
        {canDecide && record.status === "review" && (
          <>
            <label>
              เหตุผลเมื่อไม่อนุมัติ
              <input name="reason" />
            </label>
            <div className="modal-footer">
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={(e) => {
                  const reason = new FormData(e.currentTarget.closest("form")!).get("reason");
                  act(() => api("/ingestions/" + record.id, { method: "PATCH", body: { status: "rejected", values: {}, reason } }), "บันทึกการไม่อนุมัติแล้ว");
                }}
              >
                ไม่อนุมัติ
              </button>
              <button className="primary" disabled={busy}>
                <CheckCircle2 size={15} />
                อนุมัติและบันทึก
              </button>
            </div>
          </>
        )}
        <p className="form-error" role="alert">
          {formError}
        </p>
      </form>
    </Modal>
  );
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
/** "✅ อนุมัติโดย สมชาย · 6 พ.ย. 69 13:51 · ผ่าน LINE" (+ reason when rejected). */
export function decisionText(i: Ingestion) {
  const head = i.status === "approved" ? "✅ อนุมัติโดย " : "❌ ไม่อนุมัติโดย ";
  const parts = [head + (i.decided_name || "ผู้อนุมัติ"), i.decided_at ? stamp(i.decided_at) : "", i.decided_via === "line" ? "ผ่าน LINE" : i.decided_via === "web" ? "ผ่านเว็บ" : ""];
  return parts.filter(Boolean).join(" · ") + (i.status === "rejected" && i.error ? " — เหตุผล: " + i.error : "");
}

/** What LINE groups sent for this page: what is still waiting, and the history of what was approved or rejected. */
export function LinePending({
  kind,
  ctx,
  notify,
  changed,
  onCount,
}: {
  kind: string;
  ctx: Context;
  notify: (s: string) => void;
  changed?: () => void;
  onCount?: (n: number) => void;
}) {
  const [items, setItems] = useState<Ingestion[]>([]),
    [history, setHistory] = useState<Ingestion[]>([]),
    [showHistory, setShowHistory] = useState(false),
    [open, setOpen] = useState<Ingestion | null>(null);
  const load = useCallback(async () => {
    try {
      const [rows, done]: Ingestion[][] = await Promise.all([
        api("/ingestions?kind=" + encodeURIComponent(kind)),
        api("/ingestions?history=1&kind=" + encodeURIComponent(kind)).catch(() => []),
      ]);
      setItems(rows);
      setHistory(done);
      onCount?.(rows.length);
    } catch {
      // The page itself still works; this list is extra.
    }
  }, [kind, onCount]);
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 15000);
    return () => clearInterval(t);
  }, [load]);
  if (!items.length && !history.length) return null;
  return (
    <section className="card line-pending">
      <h3>
        <Inbox size={16} /> {items.length ? "รอตรวจจาก LINE" : "จาก LINE"} <i>{items.length}</i>
        {history.length > 0 && (
          <button type="button" className="line-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
            <History size={14} /> ประวัติ {history.length} <ChevronDown size={14} className={showHistory ? "up" : ""} />
          </button>
        )}
      </h3>
      {!items.length && <p className="line-pending-empty">ไม่มีรายการรอตรวจ</p>}
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <button onClick={() => setOpen(i)}>
              <span>
                <b>{String(i.values?.name || i.values?.payee || i.raw || i.template.name).slice(0, 80)}</b>
                <small>
                  {displayDate(i.created_at)} · {i.attachment_id ? "📎 " : ""}
                  {(i.raw || "เอกสารแนบ").slice(0, 60)}
                </small>
              </span>
              <span>
                {typeof (i.values?.amountForeign ?? i.values?.amount) === "number" && (
                  <b>{isForeign(i.values.currency) ? formatMoney(i.values.amountForeign ?? i.values.amount, i.values.currency) : "฿" + Number(i.values.amount).toLocaleString("th-TH")}</b>
                )}
                <em className={i.status === "review" && !i.missing.length ? "wait" : "warn"}>
                  {i.status === "review" ? (i.missing.length ? "ข้อมูลไม่ครบ" : "รออนุมัติ") : i.status === "failed" ? "อ่านไม่สำเร็จ" : "กำลังอ่าน"}
                </em>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {showHistory && (
        <ul className="line-history">
          {history.map((i) => (
            <li key={i.id}>
              <button onClick={() => setOpen(i)}>
                <span>
                  <b>{String(i.values?.name || i.values?.payee || i.raw || i.template.name).slice(0, 80)}</b>
                  <small>{decisionText(i)}</small>
                  <small>
                    ส่งมา {displayDate(i.created_at)} · {i.attachment_id ? "📎 " : ""}
                    {(i.raw || "เอกสารแนบ").slice(0, 60)}
                  </small>
                </span>
                <span>
                  <em className={i.status === "approved" ? "done" : "muted"}>{i.status === "approved" ? "อนุมัติแล้ว" : "ไม่อนุมัติ"}</em>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <IngestionReview
          record={open}
          ctx={ctx}
          onClose={() => setOpen(null)}
          onDone={async (message) => {
            setOpen(null);
            await load();
            changed?.();
            notify(message);
          }}
        />
      )}
    </section>
  );
}
