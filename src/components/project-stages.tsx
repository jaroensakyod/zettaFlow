"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ArrowRight, Clock3 } from "lucide-react";
import type { Context, ProjectStage, StageHistory } from "@/lib/types";
import { projectWorkflow } from "@/lib/zetta";
import { api, Empty, Loading, Modal } from "./shared";
const labels = {
  pending: "รอดำเนินการ",
  progress: "กำลังดำเนินการ",
  review: "รออนุมัติ",
  done: "เสร็จแล้ว",
};
export function ProjectStages({
  projectId,
  ctx,
  changed,
  compact = false,
}: {
  projectId: string;
  ctx: Context;
  changed: () => void;
  compact?: boolean;
}) {
  const [stages, setStages] = useState<ProjectStage[]>([]),
    [history, setHistory] = useState<StageHistory[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [current, setCurrent] = useState<ProjectStage | null>(null),
    [status, setStatus] = useState<ProjectStage["status"]>("pending"),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const data = await api("/project-stages?project=" + projectId);
      setStages(data.stages);
      setHistory(data.history);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden && !document.querySelector("dialog[open]")) load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <div className={"z-full-workflow" + (compact ? " compact" : "")}>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="z-stage-steps">
            {projectWorkflow.map((spec, i) => {
              const stage = stages.find((s) => s.key === spec.key);
              return (
                <div className="z-stage-wrap" key={spec.key}>
                  <button
                    disabled={!stage}
                    className={"z-stage " + (stage?.status || "restricted")}
                    onClick={() => {
                      if (stage) {
                        setError("");
                        setCurrent(stage);
                        setStatus(stage.status);
                      }
                    }}
                  >
                    <span>
                      {stage?.status === "done" ? (
                        <CheckCircle2 size={23} />
                      ) : (
                        <spec.icon size={23} />
                      )}
                    </span>
                    <strong>{spec.label}</strong>
                    <small>{spec.english}</small>
                    {!compact && (
                      <em>{stage ? labels[stage.status] : "ไม่มีสิทธิ์ดู"}</em>
                    )}
                  </button>
                  {i < 9 && <ArrowRight size={17} />}
                </div>
              );
            })}
          </div>
          {!compact && history.length > 0 && (
            <div className="z-stage-history">
              <h3>Timeline ความคืบหน้า</h3>
              {history.slice(0, 12).map((h) => (
                <div key={h.id}>
                  <Clock3 size={14} />
                  <small>
                    {new Date(h.created_at).toLocaleString("th-TH")}
                  </small>
                  <span>
                    {projectWorkflow.find((s) => s.key === h.key)?.label} ·{" "}
                    {labels[h.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {current && (
        <Modal
          title={current.label + " · " + current.english}
          onClose={() => setCurrent(null)}
        >
          <p>
            แผนก {current.department} · สถานะ {labels[current.status]}
          </p>
          {ctx.member.role === "owner" ||
          (ctx.member.role !== "viewer" &&
            ctx.member.departments.includes(current.department)) ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await api("/project-stages", {
                    method: "POST",
                    body: {
                      projectId,
                      key: current.key,
                      status,
                      version: current.version,
                    },
                  });
                  setCurrent(null);
                  await load();
                  changed();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                สถานะขั้นตอน
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as ProjectStage["status"])
                  }
                >
                  {Object.entries(labels).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-error" role="alert">
                {error}
              </p>
              <div className="modal-footer">
                <button className="primary" disabled={busy}>
                  บันทึกสถานะ
                </button>
              </div>
            </form>
          ) : (
            <p>บัญชีนี้ดูสถานะได้ แต่ไม่มีสิทธิ์แก้ไขขั้นตอนนี้</p>
          )}
        </Modal>
      )}
    </div>
  );
}
