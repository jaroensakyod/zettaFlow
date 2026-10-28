"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Sparkles,
  ArrowRight,
  Trash2,
  Paperclip,
  CheckCircle2,
  FileText,
  Edit3,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Wand2,
} from "lucide-react";
import { api, Modal, Empty, Loading, displayDate, money } from "./shared";
import { uploadFile } from "./platform";
import { FieldControl } from "./records";
import { TemplateTarget } from "./template-target";
import type { Context, Template, Ingestion } from "@/lib/types";
import { departmentNames, statusLabels, type Field } from "@/lib/catalog";
export function AiWorkspace({
  ctx,
  view,
  notify,
  changed,
}: {
  ctx: Context;
  view: "ai-inbox" | "templates";
  notify: (s: string) => void;
  changed: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]),
    [items, setItems] = useState<Ingestion[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [modal, setModal] = useState<"template" | "ingest" | "review" | null>(null),
    [current, setCurrent] = useState<Template | null>(null),
    [record, setRecord] = useState<Ingestion | null>(null),
    [fields, setFields] = useState<Template["fields"]>([]),
    [steps, setSteps] = useState<Template["steps"]>([]),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [selected, setSelected] = useState(""),
    [aiReady, setAiReady] = useState(false),
    [formError, setFormError] = useState(""),
    [meta, setMeta] = useState({ name: "", department: "Operations" }),
    [brief, setBrief] = useState(""),
    [drag, setDrag] = useState<number | null>(null);
  const move = (from: number, to: number) =>
    setFields((s) => {
      if (to < 0 || to >= s.length || from === to) return s;
      const next = [...s];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  async function draft() {
    setBusy(true);
    setFormError("");
    try {
      const d = await api("/templates/draft", {
        method: "POST",
        body: { description: brief },
      });
      setMeta({ name: d.name, department: d.department });
      setFields(d.fields);
      notify(
        d.engine === "ai"
          ? "AI ร่างฟอร์มให้แล้ว ตรวจและปรับได้ก่อนบันทึก"
          : "ใช้แม่แบบที่ใกล้เคียงที่สุด (ยังไม่ได้ตั้งค่า AI)",
      );
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const load = useCallback(async () => {
    try {
      const [t, i, c] = await Promise.all([
        api("/templates"),
        api("/ingestions"),
        api("/config"),
      ]);
      setTemplates(t);
      setItems(i);
      setAiReady(c.ai);
      if (!selected && t.length) setSelected(t[0].id);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selected]);
  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, 8000);
    return () => clearInterval(interval);
  }, [load]);
  function openTemplate(t?: Template) {
    setCurrent(t || null);
    setFields(
      t?.fields.map((f) => ({ ...f })) || [
        { key: "name", label: "ชื่อรายการ", type: "text", required: true },
      ],
    );
    setSteps(t?.steps.map((s) => ({ ...s })) || []);
    setMeta({ name: t?.name || "", department: t?.department || "Operations" });
    setBrief("");
    setModal("template");
    setFormError("");
  }
  function openReview(i: Ingestion) {
    setRecord(i);
    setValues({ ...i.values });
    setFormError("");
    setModal("review");
  }
  const canDecide = ["owner", "manager"].includes(ctx.member.role);
  if (loading) return <Loading />;
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      <div className="section-actions">
        <div className="info-strip compact">
          <Sparkles size={16} />
          {aiReady
            ? "AI พร้อมสกัดข้อมูลตาม Template"
            : "โหมดพื้นฐาน · อ่านชื่อฟิลด์: ค่า ยังไม่ได้ตั้งค่า AI"}
        </div>
        <div className="action-group">
          {view === "templates" && ctx.member.role === "owner" && (
            <button className="primary" onClick={() => openTemplate()}>
              <Plus size={16} />
              สร้าง Template
            </button>
          )}
          {ctx.member.role !== "viewer" && (
            <button
              className="primary"
              disabled={!templates.length}
              onClick={() => {
                setFormError("");
                setModal("ingest");
              }}
            >
              <Plus size={16} />
              รับข้อมูลใหม่
            </button>
          )}
        </div>
      </div>
      {view === "templates" ? (
        <div className="template-grid">
          {templates.map((t) => (
            <article className="card template-card" key={t.id}>
              <span className="template-icon">
                <FileText size={23} />
              </span>
              <span className="badge">{t.department}</span>
              <h2>{t.name}</h2>
              <p className="muted">
                {t.fields.length} ฟิลด์ · {t.steps.length} งานหลังอนุมัติ · รุ่น{" "}
                {t.version}
              </p>
              <div className="chips">
                {t.fields.map((f) => (
                  <span key={f.key}>
                    {f.label}
                    {f.required ? " *" : ""}
                  </span>
                ))}
              </div>
              <p className="template-flow">
                {t.steps.map((s) => s.department).join(" → ") ||
                  "ตรวจทานและจัดเก็บข้อมูล"}
              </p>
              <TemplateTarget t={t} editable={ctx.member.role === "owner"} onSaved={() => { load(); notify("บันทึกหน้าปลายทางแล้ว"); }} />
              <div className="template-buttons">
                {ctx.member.role === "owner" && (
                  <button className="secondary" onClick={() => openTemplate(t)}>
                    <Edit3 size={14} />
                    แก้ไข
                  </button>
                )}
                {ctx.member.role !== "viewer" && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(t.id);
                      setModal("ingest");
                    }}
                  >
                    รับข้อมูล
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
          {!templates.length && (
            <Empty
              title="ยังไม่มี Data Template"
              description="Owner สามารถสร้างฟิลด์และขั้นตอนสำหรับธุรกิจได้เอง"
            />
          )}
        </div>
      ) : (
        <section className="card records-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>รายการ / Template</th>
                  <th>แผนก</th>
                  <th>แหล่งข้อมูล</th>
                  <th>วันที่</th>
                  <th>สถานะ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="primary-cell">
                      {String(i.values.project || i.template.name)}
                    </td>
                    <td>{i.template.department}</td>
                    <td>
                      {i.source} · {i.engine === "ai" ? "AI" : "ฟิลด์ตรง"}
                    </td>
                    <td>{displayDate(i.created_at)}</td>
                    <td>
                      <span className={"badge " + i.status}>
                        {statusLabels[i.status] ||
                          (
                            {
                              queued: "รอประมวลผล",
                              processing: "กำลังประมวลผล",
                              failed: "ประมวลผลไม่สำเร็จ",
                            } as Record<string, string>
                          )[i.status] ||
                          i.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => openReview(i)}
                      >
                        ดูรายละเอียด ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!items.length && (
            <Empty
              title="ยังไม่มีข้อมูลที่ส่งเข้าระบบ"
              description="ส่งข้อความ หรือแนบภาพ/PDF เพื่อเริ่มต้นตรวจทาน"
            />
          )}
        </section>
      )}
      {modal === "template" && (
        <Modal
          title={current ? "แก้ไข Data Template" : "สร้าง Data Template"}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setFormError("");
              const form = new FormData(e.currentTarget);
              try {
                await api("/templates" + (current ? "/" + current.id : ""), {
                  method: current ? "PATCH" : "POST",
                  body: {
                    name: form.get("name"),
                    department: form.get("department"),
                    fields: fields.map((f) =>
                      f.type === "choice"
                        ? f
                        : { ...f, options: undefined },
                    ),
                    steps,
                  },
                });
                setModal(null);
                await load();
                notify("บันทึก Template แล้ว");
              } catch (err) {
                setFormError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="ai-draft">
              <label>
                <span>
                  <Wand2 size={14} /> บอก AI ว่าอยากเก็บข้อมูลอะไร
                </span>
                <textarea
                  rows={2}
                  value={brief}
                  placeholder="เช่น ฝ่ายคลังส่งรูปใบส่งของ อยากได้ ซัพพลายเออร์ เลขที่บิล ยอดรวม และประเภทรถ"
                  onChange={(e) => setBrief(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="secondary"
                disabled={busy || brief.trim().length < 3}
                onClick={draft}
              >
                <Sparkles size={14} /> ร่างฟอร์มอัตโนมัติ
              </button>
            </div>
            <div className="form-grid">
              <label>
                ชื่อ Template
                <input
                  name="name"
                  value={meta.name}
                  onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
                  required
                />
              </label>
              <label>
                แผนก
                <select
                  name="department"
                  value={meta.department}
                  onChange={(e) =>
                    setMeta((m) => ({ ...m, department: e.target.value }))
                  }
                >
                  {departmentNames.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
            </div>
            <h3 className="form-section-title">ฟิลด์ข้อมูล</h3>
            <div className="field-legend">
              ลาก ⋮⋮ เพื่อเรียง · รหัสฟิลด์ / ชื่อที่แสดง / ประเภท / บังคับ
            </div>
            {fields.map((f, index) => (
              <div
                className={"template-field draggable" + (drag === index ? " dragging" : "")}
                key={index}
                draggable
                onDragStart={() => setDrag(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag !== null) move(drag, index);
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
              >
                <span className="drag-handle" aria-hidden>
                  <GripVertical size={15} />
                </span>
                <input
                  aria-label={"รหัสฟิลด์ " + (index + 1)}
                  placeholder="sales"
                  value={f.key}
                  required
                  pattern="[a-z][a-z0-9_]*"
                  onChange={(e) =>
                    setFields((s) =>
                      s.map((v, i) =>
                        i === index ? { ...v, key: e.target.value } : v,
                      ),
                    )
                  }
                />
                <input
                  aria-label={"ชื่อฟิลด์ " + (index + 1)}
                  placeholder="ยอดขาย"
                  value={f.label}
                  required
                  onChange={(e) =>
                    setFields((s) =>
                      s.map((v, i) =>
                        i === index ? { ...v, label: e.target.value } : v,
                      ),
                    )
                  }
                />
                <select
                  aria-label={"ประเภทฟิลด์ " + (index + 1)}
                  value={f.type}
                  onChange={(e) =>
                    setFields((s) =>
                      s.map((v, i) =>
                        i === index
                          ? { ...v, type: e.target.value as typeof f.type }
                          : v,
                      ),
                    )
                  }
                >
                  <option value="text">ข้อความ</option>
                  <option value="number">ตัวเลข</option>
                  <option value="date">วันที่</option>
                  <option value="choice">ตัวเลือก (กราฟวงกลม)</option>
                </select>
                <input
                  type="checkbox"
                  aria-label={"บังคับฟิลด์ " + (index + 1)}
                  checked={f.required}
                  onChange={(e) =>
                    setFields((s) =>
                      s.map((v, i) =>
                        i === index ? { ...v, required: e.target.checked } : v,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="เลื่อนขึ้น"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="เลื่อนลง"
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="ลบฟิลด์"
                  onClick={() =>
                    setFields((s) => s.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 size={15} />
                </button>
                {f.type === "choice" && (
                  <input
                    className="choice-options"
                    aria-label={"ตัวเลือกของฟิลด์ " + (index + 1)}
                    placeholder="ตัวเลือก คั่นด้วยจุลภาค เช่น 6 ล้อ, กระบะ"
                    required
                    value={(f.options || []).join(", ")}
                    onChange={(e) =>
                      setFields((s) =>
                        s.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                options: e.target.value
                                  .split(",")
                                  .map((o) => o.trimStart())
                                  .filter((o, n, a) => o || n === a.length - 1),
                              }
                            : v,
                        ),
                      )
                    }
                    onBlur={() =>
                      setFields((s) =>
                        s.map((v, i) =>
                          i === index
                            ? { ...v, options: (v.options || []).map((o) => o.trim()).filter(Boolean) }
                            : v,
                        ),
                      )
                    }
                  />
                )}
              </div>
            ))}
            <div className="note">
              ฟิลด์ตัวเลขสร้างการ์ดยอดรวม · ฟิลด์ตัวเลือกสร้างกราฟวงกลมบน Dashboard อัตโนมัติ
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setFields((s) => [
                  ...s,
                  { key: "", label: "", type: "text", required: false },
                ])
              }
            >
              <Plus size={14} />
              เพิ่มฟิลด์
            </button>
            <h3 className="form-section-title">งานที่สร้างหลังอนุมัติ</h3>
            {steps.map((s, index) => (
              <div className="template-step" key={index}>
                <input
                  aria-label={"ชื่องาน " + (index + 1)}
                  placeholder="ชื่องาน"
                  value={s.name}
                  required
                  onChange={(e) =>
                    setSteps((items) =>
                      items.map((v, i) =>
                        i === index ? { ...v, name: e.target.value } : v,
                      ),
                    )
                  }
                />
                <select
                  aria-label={"แผนกงาน " + (index + 1)}
                  value={s.department}
                  onChange={(e) =>
                    setSteps((items) =>
                      items.map((v, i) =>
                        i === index ? { ...v, department: e.target.value } : v,
                      ),
                    )
                  }
                >
                  {departmentNames.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="ลบงาน"
                  onClick={() =>
                    setSteps((s) => s.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setSteps((s) => [...s, { name: "", department: "Operations" }])
              }
            >
              <Plus size={14} />
              เพิ่มงาน
            </button>
            <div className="note">
              ข้อมูลที่ส่งแล้วเก็บ schema รุ่นเดิม การแก้ Template
              ใช้กับรายการใหม่
            </div>
            <p className="form-error" role="alert">
              {formError}
            </p>
            <div className="modal-footer">
              <button className="primary" disabled={busy}>
                บันทึก Template
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "ingest" && (
        <Modal
          title="รับข้อมูลเข้าสู่ ZettaFlow"
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setFormError("");
              const form = new FormData(e.currentTarget);
              try {
                let attachmentId;
                const file = form.get("file") as File;
                if (file?.size) {
                  attachmentId = await uploadFile(file, templates.find((t) => t.id === selected)!.department);
                }
                await api("/ingestions", {
                  method: "POST",
                  body: {
                    templateId: selected,
                    raw: String(form.get("raw") || ""),
                    attachmentId,
                  },
                });
                setModal(null);
                await load();
                notify("รับข้อมูลแล้ว พร้อมตรวจทานหรือกำลังประมวลผล");
              } catch (err) {
                setFormError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Data Template
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.department}
                  </option>
                ))}
              </select>
            </label>
            <div className="note">
              {aiReady
                ? "AI สกัดข้อมูลตาม Template จากข้อความหรือเอกสาร จากนั้นให้คนตรวจทานก่อนอนุมัติ"
                : "ใช้ชื่อฟิลด์ตาม Template ตามด้วย : ค่า และขึ้นบรรทัดใหม่ ระบบไม่เดาค่าที่ไม่มีหลักฐาน"}
            </div>
            <label>
              ข้อความต้นทาง
              <textarea
                name="raw"
                rows={7}
                placeholder={templates
                  .find((t) => t.id === selected)
                  ?.fields.map(
                    (f) =>
                      `${f.label}: ${f.type === "date" ? "2026-10-16" : f.type === "number" ? "55000" : f.type === "choice" ? f.options?.[0] || "" : "The Promenade"}`,
                  )
                  .join("\n")}
              />
            </label>
            <label className="upload-label">
              ภาพ / PDF (สูงสุด 15 MB)
              <input
                type="file"
                name="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                disabled={!aiReady}
              />
            </label>
            <p className="form-error" role="alert">
              {formError}
            </p>
            <div className="modal-footer">
              <button className="primary" disabled={busy}>
                <Sparkles size={15} />
                {busy ? "กำลังประมวลผล…" : "สกัดข้อมูล"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "review" && record && (
        <Modal title="ตรวจทานข้อมูล" onClose={() => setModal(null)}>
          <div className="record-meta">
            {record.template.name} · {record.source} ·{" "}
            {displayDate(record.created_at)}
            {(record.source_user || record.created_by) && (
              <>
                {" "}
                · ผู้ส่ง{" "}
                {String(record.source_user || record.created_by).slice(0, 12)}
              </>
            )}
          </div>
          <pre className="source-text">{record.raw || "เอกสารแนบ"}</pre>
          {record.attachment_id && (
            <a
              className="secondary"
              href={"/api/files/" + record.attachment_id}
            >
              <Paperclip size={15} />
              เอกสารต้นฉบับ
            </a>
          )}
          {record.error && <p className="form-error">{record.error}</p>}
          {record.status === "failed" && ctx.member.role !== "viewer" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/ingestions/" + record.id + "/retry", {
                    method: "POST",
                    body: {},
                  });
                  setModal(null);
                  await load();
                  notify("ส่งประมวลผลใหม่แล้ว");
                } catch (e) {
                  setFormError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              ลองประมวลผลใหม่
            </button>
          )}
          {record.template.steps.length > 0 && (
            <div className="note">
              หลังอนุมัติ ระบบจะจับคู่โครงการจากชื่อที่ตรงกัน
              หรือสร้างโครงการใหม่ ถ้ามีชื่อซ้ำต้องระบุฟิลด์ project_id สำหรับ
              Template พื้นที่ขาย ระบบจะบันทึกดีลและสร้างงานของทีมด้วย
            </div>
          )}
          {record.missing.length > 0 && (
            <div className="note">
              ข้อมูลที่ขาด: {record.missing.join(", ")}
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/ingestions/" + record.id, {
                  method: "PATCH",
                  body: { status: "approved", values, reason: "" },
                });
                setModal(null);
                await load();
                changed();
                notify("อนุมัติและสร้าง Workflow แล้ว");
              } catch (err) {
                setFormError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset
              disabled={!canDecide || record.status !== "review" || busy}
            >
              <div className="form-grid">
                {record.template.fields.map((f) => (
                  <FieldControl
                    key={f.key}
                    field={
                      (f.type === "choice"
                        ? { ...f, type: "select" }
                        : { ...f, type: f.type }) as Field
                    }
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
                    onClick={async (e) => {
                      const form = e.currentTarget.closest("form")!;
                      setBusy(true);
                      try {
                        await api("/ingestions/" + record.id, {
                          method: "PATCH",
                          body: {
                            status: "rejected",
                            values: {},
                            reason: new FormData(form).get("reason"),
                          },
                        });
                        setModal(null);
                        await load();
                        notify("บันทึกการไม่อนุมัติแล้ว");
                      } catch (err) {
                        setFormError((err as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    ไม่อนุมัติ
                  </button>
                  <button className="primary" disabled={busy}>
                    <CheckCircle2 size={15} />
                    อนุมัติและสร้างงาน
                  </button>
                </div>
              </>
            )}
            <p className="form-error" role="alert">
              {formError}
            </p>
          </form>
        </Modal>
      )}
    </>
  );
}
