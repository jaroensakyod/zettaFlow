"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Upload,
  Download,
  CheckCircle2,
  Clock3,
  MessageCircle,
  FileText,
  Columns2,
  XCircle,
} from "lucide-react";
import type {
  Context,
  Entity,
  DesignRevision,
  DesignComment,
  Attachment,
} from "@/lib/types";
import { api, Modal, Loading, Empty, displayDate } from "./shared";
type ReviewData = { revisions: DesignRevision[]; comments: DesignComment[] };
const labels = {
  submitted: "รอตรวจทาน",
  revision: "ไม่ผ่าน รอแก้ไข",
  approved: "อนุมัติแล้ว",
};
export function DesignPanel({
  project,
  ctx,
  category,
  changed,
  notify,
}: {
  project: Entity;
  ctx: Context;
  category: "layout" | "perspective" | "site";
  changed: () => void;
  notify: (s: string) => void;
}) {
  const [data, setData] = useState<ReviewData | null>(null),
    [files, setFiles] = useState<Attachment[]>([]),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [compare, setCompare] = useState(""),
    [upload, setUpload] = useState(false),
    [review, setReview] = useState<"approved" | "revision" | null>(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [comment, setComment] = useState("");
  const title =
    category === "layout"
      ? "Layout Plan"
      : category === "perspective"
        ? "Perspective 3D"
        : "ภาพหน้างานจริง";
  const load = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([
        api("/design?project=" + project.id),
        api("/files?entity=" + project.id),
      ]);
      setData(d);
      setFiles(f);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [project.id]);
  useEffect(() => {
    setData(null);
    setSelected("");
    setCompare("");
    load();
    const timer = setInterval(() => {
      if (!document.hidden && !document.querySelector("dialog[open]")) load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load, category]);
  const revisions =
      data?.revisions.filter((r) => r.category === category) || [],
    current = revisions.find((r) => r.id === selected) || revisions[0],
    second = revisions.find((r) => r.id === compare),
    canWrite =
      ctx.member.role !== "viewer" &&
      (ctx.member.role === "owner" ||
        ctx.member.departments.includes("Design")),
    canReview = canWrite && ["owner", "manager"].includes(ctx.member.role);
  const preview = (r: DesignRevision) => {
    const f = files.find((f) => f.id === r.attachment_id);
    return (
      <figure className="z-design-preview">
        {f?.mime.startsWith("image/") ? (
          <img
            src={"/api/files/" + r.attachment_id}
            alt={`${title} v${r.version}`}
          />
        ) : (
          <a
            href={"/api/files/" + r.attachment_id}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileText size={40} />
            เปิดเอกสาร PDF · v{r.version}
          </a>
        )}
        <figcaption>
          {f?.name || title} · v{r.version}
        </figcaption>
      </figure>
    );
  };
  return (
    <>
      <div className="z-design-grid">
        <section className="z-card">
          <div className="z-card-heading">
            <h2>
              {title}
              {current && (
                <>
                  <span className="z-badge">v{current.version}</span>
                  <span
                    className={
                      "z-badge " +
                      (current.status === "approved"
                        ? "z-approved"
                        : current.status === "revision"
                          ? "z-rejected"
                          : "z-pending")
                    }
                  >
                    {labels[current.status]}
                  </span>
                </>
              )}
            </h2>
            <div className="z-heading-actions">
              {revisions.length > 1 && (
                <button
                  className="z-small-button"
                  onClick={() =>
                    setCompare(
                      compare
                        ? ""
                        : revisions.find((r) => r.id !== current?.id)?.id || "",
                    )
                  }
                >
                  <Columns2 size={13} />
                  เปรียบเทียบเวอร์ชัน
                </button>
              )}
              {current && (
                <a
                  className="z-small-button"
                  href={"/api/files/" + current.attachment_id}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download size={13} />
                  ดาวน์โหลด
                </a>
              )}
              {canWrite && (
                <button
                  className="primary"
                  onClick={() => {
                    setError("");
                    setUpload(true);
                  }}
                >
                  <Upload size={13} />
                  อัปโหลดเวอร์ชันใหม่
                </button>
              )}
            </div>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!data && !error ? (
            <Loading />
          ) : !current ? (
            <Empty
              title={"ยังไม่มี " + title}
              description="อัปโหลดภาพหรือ PDF เพื่อส่งตรวจทาน"
            />
          ) : (
            <>
              <div className={"z-design-images " + (second ? "compare" : "")}>
                {preview(current)}
                {second && (
                  <div>
                    <select
                      aria-label="เวอร์ชันที่เปรียบเทียบ"
                      value={compare}
                      onChange={(e) => setCompare(e.target.value)}
                    >
                      {revisions
                        .filter((r) => r.id !== current.id)
                        .map((r) => (
                          <option value={r.id} key={r.id}>
                            v{r.version} · {labels[r.status]}
                          </option>
                        ))}
                    </select>
                    {preview(second)}
                  </div>
                )}
              </div>
              <h3>รายละเอียดเวอร์ชัน</h3>
              <div className="z-version-meta">
                <span>
                  เวอร์ชัน<strong>v{current.version}</strong>
                </span>
                <span>
                  อัปโหลดโดย<strong>{current.created_name}</strong>
                </span>
                <span>
                  วันที่อัปโหลด
                  <strong>
                    {new Date(current.created_at).toLocaleString("th-TH")}
                  </strong>
                </span>
                <span>
                  ขนาดไฟล์
                  <strong>
                    {(
                      (files.find((f) => f.id === current.attachment_id)
                        ?.size || 0) / 1000000
                    ).toFixed(2)}{" "}
                    MB
                  </strong>
                </span>
                <span>
                  หมายเหตุ<strong>{current.notes || "—"}</strong>
                </span>
              </div>
              <h3>คอมเมนต์และการแก้ไข</h3>
              {canWrite && (
                <form
                  className="z-comment-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      await api("/design", {
                        method: "POST",
                        body: {
                          action: "comment",
                          id: current.id,
                          body: comment,
                        },
                      });
                      setComment("");
                      await load();
                      changed();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <MessageCircle size={17} />
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    aria-label="ความคิดเห็นเกี่ยวกับแบบ"
                    placeholder="พิมพ์คอมเมนต์เกี่ยวกับเวอร์ชันนี้…"
                    required
                    maxLength={4000}
                  />
                  <button className="primary" disabled={busy}>
                    ส่งคอมเมนต์
                  </button>
                </form>
              )}
              {data?.comments
                .filter((c) => c.revision_id === current.id)
                .map((c) => (
                  <article className="z-design-comment" key={c.id}>
                    <span className="avatar">{c.name[0]}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <small>
                        {new Date(c.created_at).toLocaleString("th-TH")}
                      </small>
                      <p>{c.body}</p>
                    </div>
                  </article>
                ))}
              <h3>ประวัติเวอร์ชัน</h3>
              <div className="z-version-history">
                {revisions
                  .slice()
                  .reverse()
                  .map((r) => (
                    <button
                      className={r.id === current.id ? "active" : ""}
                      key={r.id}
                      onClick={() => {
                        setSelected(r.id);
                        setCompare("");
                      }}
                    >
                      <strong>v{r.version}</strong>
                      <span>{r.created_name}</span>
                      <small>
                        {displayDate(r.created_at)} · {labels[r.status]}
                      </small>
                    </button>
                  ))}
              </div>
            </>
          )}
        </section>
        <aside>
          <section className="z-card">
            <h2>สถานะการอนุมัติ</h2>
            {current ? (
              <>
                <div className="z-review-step">
                  <CheckCircle2 size={22} />
                  <div>
                    <strong>ผู้ออกแบบ (Designer)</strong>
                    <span>{current.created_name}</span>
                    <small>
                      {new Date(current.created_at).toLocaleString("th-TH")}
                    </small>
                  </div>
                  <span className="z-badge">ส่งแบบแล้ว</span>
                </div>
                <div className="z-review-step">
                  {current.status === "approved" ? (
                    <CheckCircle2 size={22} />
                  ) : current.status === "revision" ? (
                    <XCircle size={22} />
                  ) : (
                    <Clock3 size={22} />
                  )}
                  <div>
                    <strong>ผู้ตรวจทาน / ผู้อนุมัติ</strong>
                    <span>
                      {current.reviewed_name || "รอผู้มีสิทธิ์ตรวจทาน"}
                    </span>
                    {current.reviewed_at && (
                      <small>
                        {new Date(current.reviewed_at).toLocaleString("th-TH")}
                      </small>
                    )}
                  </div>
                </div>
                <div className={"z-review-result " + current.status}>
                  <strong>
                    {labels[current.status]} · v{current.version}
                  </strong>
                  <p>{current.review_note || "ยังไม่มีผลการตรวจทาน"}</p>
                </div>
                {canReview &&
                  current.id === revisions[0]?.id &&
                  current.status === "submitted" && (
                    <div className="z-review-actions">
                      <button
                        className="secondary"
                        onClick={() => {
                          setNote("");
                          setReview("revision");
                        }}
                      >
                        ไม่ผ่าน / ขอแก้ไข
                      </button>
                      <button
                        className="primary"
                        onClick={() => {
                          setNote("");
                          setReview("approved");
                        }}
                      >
                        <CheckCircle2 size={14} />
                        อนุมัติ
                      </button>
                    </div>
                  )}
              </>
            ) : (
              <Empty title="ยังไม่มีแบบที่ส่งตรวจ" />
            )}
          </section>
          <section className="z-card">
            <h2>Activity Log (บันทึกการเปลี่ยนแปลง)</h2>
            {revisions.map((r) => (
              <div className="z-timeline" key={r.id}>
                <Clock3 size={16} />
                <div>
                  <small>{displayDate(r.created_at)}</small>
                  <p>
                    {r.created_name} อัปโหลดเวอร์ชัน v{r.version}
                  </p>
                  {r.reviewed_at && (
                    <p>
                      {r.reviewed_name} · {labels[r.status]} ·{" "}
                      {displayDate(r.reviewed_at)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </section>
        </aside>
      </div>
      {upload && (
        <Modal
          title={"อัปโหลด " + title + " เวอร์ชันใหม่"}
          onClose={() => setUpload(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const form = new FormData(e.currentTarget),
                file = form.get("file") as File;
              try {
                const uploadData = new FormData();
                uploadData.set("file", file);
                uploadData.set("entity", project.id);
                uploadData.set("department", "Design");
                const response = await fetch("/api/files", {
                    method: "POST",
                    body: uploadData,
                  }),
                  attachment = await response.json();
                if (!response.ok) throw Error(attachment.error);
                await api("/design", {
                  method: "POST",
                  body: {
                    action: "create",
                    projectId: project.id,
                    attachmentId: attachment.id,
                    category,
                    notes: String(form.get("notes") || ""),
                  },
                });
                setUpload(false);
                setSelected("");
                await load();
                changed();
                notify("ส่งเวอร์ชันใหม่เพื่อรอตรวจทานแล้ว");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              ภาพ / PDF · สูงสุด 4 MB
              <input
                name="file"
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                required
              />
            </label>
            <label>
              หมายเหตุการแก้ไข
              <textarea name="notes" maxLength={4000} />
            </label>
            <p className="form-error" role="alert">
              {error}
            </p>
            <div className="modal-footer">
              <button className="primary" disabled={busy}>
                ส่งตรวจทาน
              </button>
            </div>
          </form>
        </Modal>
      )}
      {review && current && (
        <Modal
          title={
            review === "approved" ? "อนุมัติเวอร์ชันนี้" : "ส่งกลับให้แก้ไข"
          }
          onClose={() => setReview(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/design", {
                  method: "POST",
                  body: {
                    action: "review",
                    id: current.id,
                    status: review,
                    note,
                  },
                });
                setReview(null);
                await load();
                changed();
                notify("บันทึกผลการตรวจทานแล้ว");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {title} · v{current.version} · {current.created_name}
            </p>
            <label>
              ผลการตรวจทาน / จุดที่ต้องแก้ไข
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required={review === "revision"}
                maxLength={4000}
              />
            </label>
            <p className="form-error" role="alert">
              {error}
            </p>
            <div className="modal-footer">
              <button className="primary" disabled={busy}>
                ยืนยันผลการตรวจทาน
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
