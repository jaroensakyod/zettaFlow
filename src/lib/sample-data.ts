// ข้อมูลตัวอย่าง for a real company: the same demo company as demo mode (demo-company.ts), loaded through
// load_sample_data (migration 0025) so every row is validated like a normal save, and archived again in one call.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assert, requireOwner } from "./domain";
import { dbError } from "./data";
import { seedCompany } from "./demo-company";
import { supabaseServer } from "./supabase/server";
import type { Context } from "./types";

/** Demo-company rows in insert order (a row only points at earlier rows). Fields the database derives travel beside `data`. */
export function sampleRows() {
  const rows: { id: string; kind: string; data: Record<string, unknown>; stock?: number; paid?: number; status?: string }[] = [];
  seedCompany((kind, data) => {
    const id = randomUUID();
    const { stock, paid, ...rest } = data;
    rows.push({
      id,
      kind,
      data: rest,
      ...(kind === "products" && { stock: Number(stock) || 0 }),
      ...(kind === "invoices" && { paid: Number(paid) || 0, status: String(rest.status || "issued") }),
      ...(kind === "purchases" && { status: String(rest.status || "draft") }),
    });
    return id;
  });
  return rows;
}

export async function sampleData(ctx: Context, input: unknown) {
  requireOwner(ctx);
  const { action } = z.object({ action: z.enum(["load", "clear"]) }).parse(input);
  assert(!ctx.demo, "โหมดตัวอย่างมีข้อมูลบริษัทจำลองอยู่แล้ว", 400);
  const sb = await supabaseServer();
  if (action === "clear") {
    const { data, error } = await sb.rpc("clear_sample_data", { p_company: ctx.company.id });
    dbError(error);
    return { archived: data as number };
  }
  const { data, error } = await sb.rpc("load_sample_data", { p_company: ctx.company.id, p_rows: sampleRows() });
  dbError(error);
  return { loaded: data as number };
}
