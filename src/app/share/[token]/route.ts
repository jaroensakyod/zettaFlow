import { supabaseAdmin } from "@/lib/supabase/server";
import { readShare } from "@/lib/share-link";
import { renderSubstitute, substituteModel } from "@/lib/substitute-receipt";
import { expenseCsv, type ExpenseRow } from "@/lib/expense-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const html = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
};
const notFound = (msg = "ลิงก์นี้หมดอายุหรือไม่ถูกต้อง ขอเอกสารใหม่ในกลุ่ม LINE ได้เลยค่ะ") =>
  new Response(`<!doctype html><html lang="th"><meta charset="utf-8"><title>เอกสาร</title><body style="font:16px sans-serif;padding:40px;text-align:center;color:#333"><p>${msg}</p></body></html>`, {
    status: 404,
    headers: html,
  });

/**
 * A document sent into LINE as a signed link (src/lib/share-link.ts):
 *  • ใบรับรองแทนใบเสร็จรับเงิน of an expense record;
 *  • the expense summary file (CSV for Excel / Google Sheets) of a company for a period.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const t = readShare((await params).token);
  if (!t) return notFound();
  const sb = supabaseAdmin();
  if (t.k === "sub") {
    const { data: e } = await sb.from("entities").select("id, company_id, kind, data, archived_at").eq("id", t.id).maybeSingle();
    if (!e || e.kind !== "expenses" || e.archived_at) return notFound("ไม่พบรายการค่าใช้จ่ายนี้");
    const data = e.data as Record<string, unknown>;
    const [{ data: company }, { data: item }, { count }] = await Promise.all([
      sb.from("companies").select("name, profile").eq("id", e.company_id).maybeSingle(),
      typeof data.ingestionId === "string" ? sb.from("ingestions").select("approval").eq("id", data.ingestionId).maybeSingle() : Promise.resolve({ data: null }),
      sb.from("attachments").select("id", { count: "exact", head: true }).eq("entity_id", e.id),
    ]);
    const approvals = ((item?.approval as { history?: { action?: string; name?: string; at?: string }[] } | null)?.history || []).filter((h) => h.action === "approve");
    const model = substituteModel({
      company: { name: String(company?.name || ""), profile: (company?.profile as Record<string, unknown>) || {} },
      data,
      approvals,
      files: count || 0,
    });
    return new Response(renderSubstitute(model), { headers: html });
  }
  // The summary file
  const { data: company } = await sb.from("companies").select("name").eq("id", t.c).maybeSingle();
  if (!company) return notFound();
  const { data: rows } = await sb
    .from("entities")
    .select("data, created_at")
    .eq("company_id", t.c)
    .eq("kind", "expenses")
    .is("archived_at", null)
    .limit(5000);
  const inRange = (rows || [])
    .map((r) => ({ d: r.data as Record<string, unknown>, at: String(r.created_at) }))
    .map((r) => ({ ...r, day: String(r.d.date || "").slice(0, 10) || r.at.slice(0, 10) }))
    .filter((r) => r.day >= t.from && r.day <= t.to && r.d.status !== "rejected")
    .sort((a, b) => a.day.localeCompare(b.day));
  const list: ExpenseRow[] = inRange.map(({ d, day }) => ({
    code: String(d.code || ""),
    date: day,
    name: String(d.name || ""),
    category: String(d.category || ""),
    payee: String(d.payee || ""),
    who: String(d.sourceSender || d.requestor || ""),
    amount: Number(d.amount) || 0,
    payStatus: String(d.payStatus || ""),
    status: String(d.status || ""),
    source: d.sourceVia ? `LINE · ${d.sourceGroup || ""}` : "เว็บ",
  }));
  const label = t.from.slice(0, 7) === t.to.slice(0, 7) ? t.from.slice(0, 7) : `${t.from} ถึง ${t.to}`;
  const csv = expenseCsv(list, { from: t.from, to: t.to, label }, String(company.name || ""));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expenses-${t.from}_${t.to}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
