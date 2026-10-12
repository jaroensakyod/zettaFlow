import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context, DesignRevision, DesignComment } from "./types";
import { assert, canRead, canWrite } from "./domain";
import { demoRead, demoMutate, demoAudit } from "./demo";
import { dbError } from "./data";
import { supabaseServer } from "./supabase/server";
export async function designData(ctx: Context, projectId: string) {
  if (ctx.demo) {
    const s = await demoRead();
    const project = s.entities.find(
      (e) => e.id === projectId && e.kind === "projects" && !e.archived_at,
    );
    assert(
      project && canRead(ctx, project.department) && canRead(ctx, "Design"),
      "ไม่มีสิทธิ์ดูแบบ",
      403,
    );
    const revisions = (s.designs || [])
      .filter(
        (r) => r.project_id === projectId && r.company_id === ctx.company.id,
      )
      .sort((a, b) => b.version - a.version);
    return {
      revisions,
      comments: (s.designComments || []).filter((c) =>
        revisions.some((r) => r.id === c.revision_id),
      ),
    };
  }
  const sb = await supabaseServer();
  const { data: revisions, error } = await sb
    .from("design_revisions")
    .select("*")
    .eq("company_id", ctx.company.id)
    .eq("project_id", projectId)
    .order("version", { ascending: false });
  dbError(error);
  const ids = (revisions || []).map((r) => r.id);
  if (!ids.length) return { revisions: [], comments: [] };
  const { data: comments, error: e } = await sb
    .from("design_comments")
    .select("*")
    .in("revision_id", ids)
    .order("created_at", { ascending: false });
  dbError(e);
  return { revisions, comments };
}
export async function designAction(ctx: Context, input: unknown) {
  const body = z
    .discriminatedUnion("action", [
      z.object({
        action: z.literal("create"),
        projectId: z.uuid(),
        attachmentId: z.uuid(),
        category: z.enum(["layout", "perspective", "site"]),
        notes: z.string().max(4000).default(""),
      }),
      z.object({
        action: z.literal("review"),
        id: z.uuid(),
        status: z.enum(["approved", "revision"]),
        note: z.string().max(4000).default(""),
      }),
      z.object({
        action: z.literal("comment"),
        id: z.uuid(),
        body: z.string().trim().min(1).max(4000),
      }),
    ])
    .parse(input);
  assert(canWrite(ctx, "Design"), "ไม่มีสิทธิ์แก้ไขแบบ", 403);
  if (ctx.demo)
    return demoMutate((s) => {
      s.designs ||= [];
      s.designComments ||= [];
      const r =
        body.action !== "create"
          ? s.designs.find(
              (r) => r.id === body.id && r.company_id === ctx.company.id,
            )
          : undefined;
      const projectId =
        body.action === "create" ? body.projectId : r?.project_id;
      const p = s.entities.find(
        (e) =>
          e.id === projectId &&
          e.kind === "projects" &&
          !e.archived_at &&
          e.company_id === ctx.company.id,
      );
      assert(p && canRead(ctx, p.department), "ไม่พบโครงการ", 404);
      if (body.action === "create") {
        const f = s.attachments.find(
          (f) =>
            f.id === body.attachmentId &&
            f.entity_id === projectId &&
            f.company_id === ctx.company.id,
        );
        assert(
          f &&
            canRead(ctx, f.department) &&
            [
              "image/png",
              "image/jpeg",
              "image/webp",
              "application/pdf",
            ].includes(f.mime),
          "ไฟล์ต้องเป็นภาพหรือ PDF ของโครงการนี้",
        );
        assert(
          !s.designs.some(
            (r) =>
              r.attachment_id === body.attachmentId &&
              r.category === body.category,
          ),
          "ไฟล์นี้ถูกส่งเป็นเวอร์ชันแล้ว",
          409,
        );
        const revision: DesignRevision = {
          id: randomUUID(),
          company_id: ctx.company.id,
          project_id: p.id,
          attachment_id: f.id,
          category: body.category,
          version:
            1 +
            Math.max(
              0,
              ...s.designs
                .filter(
                  (r) => r.project_id === p.id && r.category === body.category,
                )
                .map((r) => r.version),
            ),
          status: "submitted",
          notes: body.notes,
          created_by: ctx.user.id,
          created_name: ctx.user.name,
          created_at: new Date().toISOString(),
        };
        s.designs.unshift(revision);
        demoAudit(s, "design_version_uploaded", p.id);
        return revision;
      }
      assert(r, "ไม่พบเวอร์ชัน", 404);
      if (body.action === "review") {
        assert(
          ["owner", "manager"].includes(ctx.member.role),
          "ไม่มีสิทธิ์อนุมัติแบบ",
          403,
        );
        assert(r.status === "submitted", "เวอร์ชันนี้ตรวจทานแล้ว", 409);
        assert(
          !s.designs.some(
            (v) =>
              v.project_id === r.project_id &&
              v.category === r.category &&
              v.version > r.version,
          ),
          "มีเวอร์ชันใหม่กว่า กรุณาตรวจเวอร์ชันล่าสุด",
          409,
        );
        assert(
          body.status !== "revision" || !!body.note.trim(),
          "กรอกเหตุผลที่ให้แก้ไข",
        );
        r.status = body.status;
        r.review_note = body.note;
        r.reviewed_by = ctx.user.id;
        r.reviewed_name = ctx.user.name;
        r.reviewed_at = new Date().toISOString();
        demoAudit(s, "design_" + body.status, p.id);
        return r;
      }
      const comment: DesignComment = {
        id: randomUUID(),
        revision_id: r.id,
        company_id: ctx.company.id,
        user_id: ctx.user.id,
        name: ctx.user.name,
        body: body.body,
        created_at: new Date().toISOString(),
      };
      s.designComments.unshift(comment);
      demoAudit(s, "design_comment", p.id);
      return comment;
    });
  const sb = await supabaseServer();
  const params =
    body.action === "create"
      ? {
          p_company: ctx.company.id,
          p_project: body.projectId,
          p_attachment: body.attachmentId,
          p_category: body.category,
          p_notes: body.notes,
        }
      : body.action === "review"
        ? {
            p_company: ctx.company.id,
            p_id: body.id,
            p_status: body.status,
            p_note: body.note,
          }
        : { p_company: ctx.company.id, p_revision: body.id, p_body: body.body };
  const { data, error } = await sb.rpc(
    body.action === "create"
      ? "create_design_revision"
      : body.action === "review"
        ? "review_design_revision"
        : "comment_design_revision",
    params,
  );
  dbError(error);
  return data;
}
