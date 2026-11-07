"use client";
// LINE items awaiting approval: the review dialog (shared with Data Inbox) and the list each page shows above its records.
import { useCallback, useEffect, useState } from "react";
import { Paperclip, CheckCircle2, Inbox, UserPlus } from "lucide-react";
import { api, Modal, displayDate } from "./shared";
import { FieldControl } from "./records";
import type { Context, Ingestion } from "@/lib/types";
import { catalog, departmentNames, type Field } from "@/lib/catalog";
import { deptLabels } from "./home-dashboard";

type Option = { id: string; kind: string; name: string };
/**
 * A linked record (พนักงาน, ลูกค้า …) read from LINE as a name: pick one from the list, or — for พนักงาน — add the
 * person on the spot. Someone added from a LINE item keeps their LINE account, so their next requests match them.
 */
function RelationPicker({
  field,
  resource,
  value,
  set,
  options,
  lineUser,
  disabled,
  onAdded,
}: {
  field: { key: string; label: string; required?: boolean };
  resource: string;
  value: string;
  set: (v: string) => void;
  options: Option[];
  lineUser?: string | null;
  disabled?: boolean;
  onAdded: (o: Option) => void;
}) {
  const [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const names = options.filter((o) => o.kind === resource).map((o) => o.name);
  const known = !value || names.some((n) => n.toLowerCase() === value.trim().toLowerCase());
  const page = catalog[resource]?.label || resource;
  async function add(e: React.MouseEvent<HTMLButtonElement>) {
    const box = e.currentTarget.closest(".relation-add") as HTMLElement;
    const get = (n: string) => (box.querySelector(`[name="${n}"]`) as HTMLInputElement | HTMLSelectElement).value.trim();
    const name = get("newName");
    if (!name) return setError("ใส่ชื่อ");
    setBusy(true);
    setError("");
    try {
      const rec: { id: string } = await api("/entities/employees", {
        method: "POST",
        body: { data: { name, department: get("newDept"), employmentType: get("newType"), status: "active", ...(lineUser ? { lineUserId: lineUser } : {}) } },
      });
      onAdded({ id: rec.id, kind: "employees", name });
      set(name);
      setAdding(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relation-field">
      <label>
        {field.label.replace(/ \(ชื่อ\)$/, "")}
        {field.required && " *"}
        <input list={"rel-" + field.key} value={value} disabled={disabled} placeholder={"เลือกหรือพิมพ์ชื่อ" + page} onChange={(e) => set(e.target.value)} />
        <datalist id={"rel-" + field.key}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </label>
      {!known && !disabled && (
        <div className="relation-missing">
          <span>
            ไม่พบ “{value}” ในรายชื่อ{page} เลือกชื่อที่มีอยู่จากรายการ{resource === "employees" ? " หรือเพิ่มเป็นพนักงานใหม่" : ""}
          </span>
          {resource === "employees" && !adding && (
            <button type="button" className="secondary" onClick={() => setAdding(true)}>
              <UserPlus size={14} /> เพิ่ม “{value}” เป็นพนักงานใหม่
            </button>
          )}
        </div>
      )}
      {adding && (
        <div className="relation-add">
          <label>
            ชื่อ-นามสกุล
            <input name="newName" defaultValue={value} />
          </label>
          <label>
            แผนก
            <select name="newDept" defaultValue="Operations">
              {departmentNames.map((d) => (
                <option key={d} value={d}>
                  {deptLabels[d] || d}
                </option>
              ))}
            </select>
          </label>
          <label>
            ประเภทการจ้าง
            <select name="newType" defaultValue="ประจำ">
              <option>ประจำ</option>
              <option>สัญญาจ้าง</option>
              <option>พาร์ตไทม์</option>
            </select>
          </label>
          {lineUser && <small>ระบบจะจำ LINE ของคนนี้ไว้ ครั้งหน้าส่งคำขอมาจะจับคู่ให้อัตโนมัติ</small>}
          {error && <small className="form-error">{error}</small>}
          <div className="row-actions">
            <button type="button" className="primary" disabled={busy} onClick={add}>
              บันทึกพนักงาน
            </button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
import { formatMoney, isForeign } from "@/lib/fx";

/** The photo or PDF sent with a LINE message, shown in the dialog (no download needed). */
function AttachmentPreview({ id }: { id: string }) {
  const [file, setFile] = useState<{ mime: string; url: string } | null>(null);
  // Loaded once and shown from memory: no second download, and the link below still opens it full size.
  useEffect(() => {
    let url = "";
    fetch("/api/files/" + id)
      .then(async (r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b) return;
        url = URL.createObjectURL(b);
        setFile({ mime: b.type, url });
      })
      .catch(() => {});
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  const src = "/api/files/" + id,
    mime = file?.mime || "";
  return (
    <div className="attachment-preview">
      {mime.startsWith("image/") ? (
        <a href={src} target="_blank" rel="noreferrer" title="กดเพื่อดูรูปขนาดเต็ม">
          <img src={file!.url} alt="เอกสารต้นฉบับ" />
        </a>
      ) : mime === "application/pdf" ? (
        <object data={file!.url} type="application/pdf" aria-label="เอกสารต้นฉบับ">
          <a href={src} target="_blank" rel="noreferrer">เปิดเอกสาร</a>
        </object>
      ) : mime.startsWith("audio/") ? (
        // Voice message from LINE: play it here; its transcript is in the message text above.
        <audio controls preload="metadata" src={file!.url} aria-label="ข้อความเสียงต้นฉบับ" />
      ) : null}
      <a className="secondary" href={src} target="_blank" rel="noreferrer">
        <Paperclip size={15} />
        เปิดเอกสารต้นฉบับในแท็บใหม่
      </a>
    </div>
  );
}

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
  const [options, setOptions] = useState<Option[]>([]);
  useEffect(() => {
    api("/options").then(setOptions).catch(() => {});
  }, []);
  // Which fields of the target page link to another record (พนักงาน, ลูกค้า …).
  const relations = Object.fromEntries(
    ((record.target_kind && catalog[record.target_kind]?.fields) || []).filter((f) => f.type === "relation" && f.resource).map((f) => [f.key, f.resource as string]),
  );
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
        {(record.source_user || record.created_by) && <> · ผู้ส่ง {(record as Ingestion & { sender_name?: string | null }).sender_name || String(record.source_user || record.created_by).slice(0, 12)}</>}
      </div>
      {record.decided_at && <p className={"decision-line " + record.status}>{decisionText(record)}</p>}
      <pre className="source-text">{record.raw || "เอกสารแนบ"}</pre>
      {record.attachment_id && <AttachmentPreview id={record.attachment_id} />}
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
            {record.template.fields.map((f) =>
              relations[f.key] ? (
                <RelationPicker
                  key={f.key}
                  field={f}
                  resource={relations[f.key]}
                  value={String(values[f.key] ?? "")}
                  set={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                  options={options}
                  lineUser={record.source === "LINE" ? record.source_user : null}
                  disabled={!canDecide || record.status !== "review" || busy}
                  onAdded={(o) => setOptions((os) => [...os, o])}
                />
              ) : (
              <FieldControl
                key={f.key}
                field={(f.type === "choice" ? { ...f, type: "select" } : { ...f, type: f.type }) as Field}
                value={values[f.key]}
                set={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                options={[]}
              />
              ),
            )}
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
    [view, setView] = useState<"open" | "approved" | "rejected">("open"),
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
  const approved = history.filter((i) => i.status === "approved"),
    rejected = history.filter((i) => i.status === "rejected");
  return (
    <section className="card line-pending">
      <h3>
        <Inbox size={16} /> จาก LINE
      </h3>
      {/* รอตรวจ / อนุมัติแล้ว / ไม่อนุมัติ: what still waits, and what was decided (by whom, when). */}
      <div className="line-tabs" role="tablist">
        {(
          [
            ["open", "รอตรวจ", items.length],
            ["approved", "อนุมัติแล้ว", approved.length],
            ["rejected", "ไม่อนุมัติ", rejected.length],
          ] as const
        ).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "active " + k : k} onClick={() => setView(k)}>
            {label} <i>{n}</i>
          </button>
        ))}
      </div>
      {view === "open" && !items.length && <p className="line-pending-empty">ไม่มีรายการรอตรวจ</p>}
      {view !== "open" && !(view === "approved" ? approved : rejected).length && <p className="line-pending-empty">ยังไม่มีรายการ</p>}
      {view === "open" && (
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
      )}
      {view !== "open" && (
        <ul className="line-history">
          {(view === "approved" ? approved : rejected).map((i) => (
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
