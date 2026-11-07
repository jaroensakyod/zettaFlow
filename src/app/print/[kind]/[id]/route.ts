import { NextRequest } from "next/server";
import { z } from "zod";
import { context } from "@/lib/data";
import { AppError } from "@/lib/domain";
import { documentHtml, issueDocument, isDocKind, docUrl } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ kind: string; id: string }> };
const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy":
    "default-src 'none'; img-src data: https:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
};
const errorPage = (e: unknown) => {
  const status = e instanceof AppError ? e.status : e instanceof z.ZodError ? 404 : 500;
  const msg = e instanceof AppError ? e.message : status === 404 ? "ไม่พบเอกสาร" : "ระบบไม่พร้อม กรุณาลองใหม่";
  const safe = msg.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><html lang="th"><meta charset="utf-8"><title>เอกสาร</title><body style="font:16px sans-serif;padding:40px;text-align:center;color:#333"><p>${safe}</p></body></html>`,
    { status, headers },
  );
};
async function target(p: Params["params"]) {
  const { kind, id } = await p;
  if (!isDocKind(kind)) throw new AppError("ไม่พบเอกสาร", 404);
  return { kind, id: z.uuid().parse(id) };
}

/** Printable A4 document: /print/quotation|invoice|tax_invoice|receipt/<record id>. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { kind, id } = await target(params);
    return new Response(await documentHtml(await context(), kind, id), { headers });
  } catch (e) {
    return errorPage(e);
  }
}

/** Issues the tax invoice / receipt number (the preview's "ออกเลขที่" button), then shows the issued document. */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== req.nextUrl.origin) throw new AppError("คำขอไม่ถูกต้อง", 403);
    const { kind, id } = await target(params);
    await issueDocument(await context(), kind, id);
    return new Response(null, { status: 303, headers: { Location: docUrl(kind, id), "Cache-Control": "no-store" } });
  } catch (e) {
    return errorPage(e);
  }
}
