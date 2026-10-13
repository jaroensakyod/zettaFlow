import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context, Entity, ProjectStage } from "./types";
import { projectWorkflow } from "./zetta";
import { assert, canRead, canWrite } from "./domain";
import { demoRead, demoMutate, demoAudit } from "./demo";
import { dbError } from "./data";
import { supabaseServer } from "./supabase/server";
export function initialStages(project: Entity): ProjectStage[] {
  return projectWorkflow.map((s, ordinal) => ({
    company_id: project.company_id,
    project_id: project.id,
    key: s.key,
    ordinal,
    department: s.department,
    label: s.label,
    english: s.english,
    status: "pending",
    version: 1,
    updated_at: project.created_at,
  }));
}
export async function stageData(ctx: Context, projectId: string) {
  if (ctx.demo) {
    const s = await demoRead(),
      p = s.entities.find(
        (e) =>
          e.id === projectId &&
          e.kind === "projects" &&
          e.company_id === ctx.company.id &&
          !e.archived_at,
      );
    assert(p && canRead(ctx, p.department), "ไม่พบโครงการ", 404);
    const stored = (s.stages || []).filter((s) => s.project_id === projectId),
      stages = (stored.length ? stored : initialStages(p)).filter((s) =>
        canRead(ctx, s.department),
      ),
      history = (s.stageHistory || []).filter(
        (h) => h.project_id === projectId && canRead(ctx, h.department),
      );
    return { stages, history };
  }
  const sb = await supabaseServer();
  const [s, h] = await Promise.all([
    sb
      .from("project_stages")
      .select("*")
      .eq("company_id", ctx.company.id)
      .eq("project_id", projectId)
      .order("ordinal"),
    sb
      .from("project_stage_history")
      .select("*")
      .eq("company_id", ctx.company.id)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  dbError(s.error);
  dbError(h.error);
  return { stages: s.data || [], history: h.data || [] };
}
export async function changeStage(ctx: Context, input: unknown) {
  const body = z
    .object({
      projectId: z.uuid(),
      key: z.enum([
        "location",
        "contract",
        "payment",
        "layout",
        "procurement",
        "warehouse",
        "setup",
        "selling",
        "summary",
        "close",
      ]),
      status: z.enum(["pending", "progress", "review", "done"]),
      version: z.number().int().positive(),
    })
    .parse(input);
  if (ctx.demo)
    return demoMutate((s) => {
      const p = s.entities.find(
        (e) =>
          e.id === body.projectId &&
          e.kind === "projects" &&
          e.company_id === ctx.company.id &&
          !e.archived_at,
      );
      assert(p && canRead(ctx, p.department), "ไม่พบโครงการ", 404);
      s.stages ||= [];
      s.stageHistory ||= [];
      if (!s.stages.some((r) => r.project_id === p.id))
        s.stages.push(...initialStages(p));
      const r = s.stages.find(
        (r) => r.project_id === p.id && r.key === body.key,
      )!;
      assert(canWrite(ctx, r.department), "ไม่มีสิทธิ์แก้ไขขั้นตอนนี้", 403);
      assert(
        r.version === body.version,
        "ขั้นตอนนี้เปลี่ยนแล้ว กรุณารีเฟรช",
        409,
      );
      if (
        body.status === "done" &&
        ["contract", "payment", "layout", "close"].includes(body.key)
      )
        assert(
          ["owner", "manager"].includes(ctx.member.role),
          "ต้องให้ผู้มีสิทธิ์อนุมัติ",
          403,
        );
      if (body.key === "close" && body.status === "done")
        assert(
          s.stages
            .filter((r) => r.project_id === p.id && r.key !== "close")
            .every((r) => r.status === "done"),
          "ทำขั้นตอนก่อนหน้าให้เสร็จก่อนปิดโครงการ",
        );
      if (body.key === "layout" && body.status === "done") {
        const newest = (s.designs || [])
          .filter((d) => d.project_id === p.id && d.category === "layout")
          .sort((a, b) => b.version - a.version)[0];
        assert(
          !newest || newest.status === "approved",
          "แบบเวอร์ชันล่าสุดยังไม่ได้อนุมัติ",
        );
      }
      const now = new Date().toISOString();
      r.status = body.status;
      r.version++;
      r.updated_at = now;
      r.updated_by = ctx.user.id;
      if (body.status !== "pending") r.started_at ||= now;
      r.completed_at = body.status === "done" ? now : null;
      s.stageHistory.unshift({
        id: randomUUID(),
        company_id: ctx.company.id,
        project_id: p.id,
        key: r.key,
        department: r.department,
        status: r.status,
        actor: ctx.user.id,
        created_at: now,
      });
      if (body.key === "close" && body.status === "done") {
        p.data.status = "completed";
        p.version++;
        p.updated_at = now;
      }
      demoAudit(s, "project_stage_" + body.key + "_" + body.status, p.id);
      return r;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("update_project_stage", {
    p_company: ctx.company.id,
    p_project: body.projectId,
    p_key: body.key,
    p_status: body.status,
    p_version: body.version,
  });
  dbError(error);
  return data;
}
