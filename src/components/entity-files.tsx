"use client";
// Documents attached to one record: list (newest first) and upload.
import { useCallback, useEffect, useState } from "react";
import { FileText, Paperclip } from "lucide-react";
import { api, displayDate, Loading } from "./shared";

type FileRow = { id: string; name: string; size: number; mime: string; created_at: string };

export function EntityFiles({ entity, department, writable }: { entity: string; department: string; writable: boolean }) {
  const [files, setFiles] = useState<FileRow[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(() => api("/files?entity=" + entity).then(setFiles).catch((e) => setError(e.message)), [entity]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="dir-files">
      {files === null ? (
        <Loading />
      ) : !files.length ? (
        <p className="muted">ยังไม่มีเอกสาร</p>
      ) : (
        files.map((f) => (
          <a key={f.id} href={"/api/files/" + f.id} target="_blank" rel="noreferrer">
            <FileText size={16} />
            <span>
              <b>{f.name}</b>
              <small>
                {displayDate(f.created_at)} · {Math.max(1, Math.round(f.size / 1024))} KB
              </small>
            </span>
          </a>
        ))
      )}
      {writable && (
        <label className="secondary as-button dir-upload">
          <Paperclip size={15} /> {busy ? "กำลังอัปโหลด…" : "แนบเอกสาร"}
          <input
            type="file"
            hidden
            disabled={busy}
            accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,.xlsx"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true);
              setError("");
              try {
                const form = new FormData();
                form.set("file", f);
                form.set("department", department);
                form.set("entity", entity);
                const r = await fetch("/api/files", { method: "POST", body: form });
                if (!r.ok) throw Error((await r.json()).error);
                await load();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

