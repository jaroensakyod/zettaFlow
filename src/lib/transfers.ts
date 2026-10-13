import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context, StockTransfer } from "./types";
import { demoRead, demoMutate, demoMovement, demoAudit } from "./demo";
import { assert, canRead, canWrite } from "./domain";
import { dbError } from "./data";
import { supabaseServer } from "./supabase/server";
export async function transferData(ctx: Context) {
  assert(canRead(ctx, "Warehouse"), "ไม่มีสิทธิ์คลังสินค้า", 403);
  if (ctx.demo) {
    const s = await demoRead();
    const allowed = (id: string | null) =>
      !id ||
      s.entities.some(
        (e) =>
          e.id === id &&
          e.company_id === ctx.company.id &&
          canRead(ctx, e.department),
      );
    return {
      transfers: (s.transfers || []).filter(
        (t) =>
          t.company_id === ctx.company.id &&
          allowed(t.from_project) &&
          allowed(t.to_project),
      ),
      inventory: (s.projectInventory || []).filter(
        (i) => i.company_id === ctx.company.id && allowed(i.project_id),
      ),
    };
  }
  const sb = await supabaseServer();
  const [t, i] = await Promise.all([
    sb
      .from("stock_transfers")
      .select("*")
      .eq("company_id", ctx.company.id)
      .order("created_at", { ascending: false })
      .limit(100),
    sb.from("project_inventory").select("*").eq("company_id", ctx.company.id),
  ]);
  dbError(t.error);
  dbError(i.error);
  return { transfers: t.data || [], inventory: i.data || [] };
}
export async function transferStock(ctx: Context, input: unknown) {
  const body = z
    .object({
      productId: z.uuid(),
      fromProject: z.uuid().nullable(),
      toProject: z.uuid().nullable(),
      quantity: z.number().int().positive().max(1000000000),
      reference: z.string().trim().min(1).max(200),
      reason: z.string().trim().min(1).max(4000),
    })
    .parse(input);
  assert(canWrite(ctx, "Warehouse"), "ไม่มีสิทธิ์โอนสินค้า", 403);
  assert(body.fromProject !== body.toProject, "ต้นทางกับปลายทางต้องต่างกัน");
  if (ctx.demo)
    return demoMutate((s) => {
      s.projectInventory ||= [];
      s.transfers ||= [];
      const p = s.entities.find(
        (e) =>
          e.id === body.productId &&
          e.kind === "products" &&
          e.company_id === ctx.company.id &&
          !e.archived_at,
      );
      assert(p, "ไม่พบสินค้า", 404);
      for (const id of [body.fromProject, body.toProject])
        if (id) {
          const project = s.entities.find(
            (e) =>
              e.id === id &&
              e.kind === "projects" &&
              e.company_id === ctx.company.id &&
              !e.archived_at,
          );
          assert(
            project && canRead(ctx, project.department),
            "ไม่มีสิทธิ์โครงการ",
            403,
          );
        }
      assert(
        !s.transfers.some(
          (t) =>
            t.company_id === ctx.company.id && t.reference === body.reference,
        ),
        "รายการโอนนี้บันทึกแล้ว",
        409,
      );
      const now = new Date().toISOString();
      if (!body.fromProject)
        demoMovement(
          s,
          p.id,
          "out",
          body.quantity,
          "TRANSFER:" + body.reference + ":out",
          body.reason,
        );
      else {
        const from = s.projectInventory.find(
          (i) => i.product_id === p.id && i.project_id === body.fromProject,
        );
        assert(
          from && from.quantity >= body.quantity,
          "สต็อกโครงการไม่เพียงพอ",
        );
        from.quantity -= body.quantity;
        from.updated_at = now;
      }
      if (!body.toProject)
        demoMovement(
          s,
          p.id,
          "in",
          body.quantity,
          "TRANSFER:" + body.reference + ":in",
          body.reason,
        );
      else {
        let to = s.projectInventory.find(
          (i) => i.product_id === p.id && i.project_id === body.toProject,
        );
        if (!to) {
          to = {
            company_id: ctx.company.id,
            product_id: p.id,
            project_id: body.toProject,
            quantity: 0,
            updated_at: now,
          };
          s.projectInventory.push(to);
        }
        to.quantity += body.quantity;
        to.updated_at = now;
      }
      const transfer: StockTransfer = {
        id: randomUUID(),
        company_id: ctx.company.id,
        product_id: p.id,
        from_project: body.fromProject,
        to_project: body.toProject,
        quantity: body.quantity,
        reference: body.reference,
        reason: body.reason,
        created_by: ctx.user.id,
        created_name: ctx.user.name,
        created_at: now,
      };
      s.transfers.unshift(transfer);
      demoAudit(s, "stock_transfer", transfer.id);
      return transfer;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("transfer_project_stock", {
    p_company: ctx.company.id,
    p_product: body.productId,
    p_from: body.fromProject,
    p_to: body.toProject,
    p_quantity: body.quantity,
    p_reference: body.reference,
    p_reason: body.reason,
  });
  dbError(error);
  return data;
}
