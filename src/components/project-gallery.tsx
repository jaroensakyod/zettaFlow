"use client";
import { useEffect, useState } from "react";
import { FileText, PenTool } from "lucide-react";
import type { Attachment, Context, DesignRevision, Entity } from "@/lib/types";
import { api } from "./shared";
import { ReferencePhoto } from "./reference-photo";
import { referenceImages } from "@/lib/zetta";
const categories = [
  ["layout", "Layout Plan"],
  ["perspective", "Perspective 3D"],
  ["site", "ภาพหน้างานจริง"],
] as const;
export function ProjectGallery({
  project,
  ctx,
  open,
}: {
  project: Entity;
  ctx: Context;
  open: (tab: string) => void;
}) {
  const [files, setFiles] = useState<Attachment[]>([]),
    [revisions, setRevisions] = useState<DesignRevision[]>([]);
  const canViewDesign =
    ctx.member.role === "owner" || ctx.member.departments.includes("Design");
  useEffect(() => {
    let active = true;
    setFiles([]);
    setRevisions([]);
    Promise.allSettled([
      api("/files?entity=" + project.id),
      canViewDesign
        ? api("/design?project=" + project.id)
        : Promise.resolve({ revisions: [] }),
    ]).then(([f, d]) => {
      if (!active) return;
      if (f.status === "fulfilled") setFiles(f.value);
      if (d.status === "fulfilled") setRevisions(d.value.revisions);
    });
    return () => {
      active = false;
    };
  }, [project.id, canViewDesign]);
  return (
    <div className="zd-gallery">
      {categories.map(([category, label]) => {
        const revision = revisions
          .filter((r) => r.category === category)
          .sort((a, b) => b.version - a.version)[0];
        const file = files.find((f) => f.id === revision?.attachment_id);
        const sample = ctx.demo && referenceImages(String(project.data.name));
        return (
          <button key={category} onClick={() => open(label)}>
            <strong>{label}</strong>
            {file?.mime.startsWith("image/") ? (
              <img
                src={"/api/files/" + file.id}
                alt={file.name}
                className="zd-project-asset"
              />
            ) : sample ? (
              <ReferencePhoto
                name={String(project.data.name)}
                kind={category}
              />
            ) : (
              <div className="z-image-empty">
                {file ? <FileText size={27} /> : <PenTool size={27} />}
                <span>{file?.name || "เปิดไฟล์ของโครงการ"}</span>
              </div>
            )}
            <small>
              {file
                ? `${file.name} · v${revision!.version}`
                : sample
                  ? "ภาพตัวอย่างจาก PPTX"
                  : "ยังไม่มีเวอร์ชันที่ดูได้"}
            </small>
          </button>
        );
      })}
    </div>
  );
}
