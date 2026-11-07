import { NextRequest } from "next/server";
import { isDocKind, renderDocument, sampleModel } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Static "sample" wins over the dynamic /print/[kind]/[id] segment, so /print/sample/receipt lands here.
const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=300",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy":
    "default-src 'none'; img-src data: https:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'",
};

/** Sample document with the design's fictional content: /print/sample/quotation|invoice|tax_invoice|receipt. Never issued, no data read. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isDocKind(kind))
    return new Response(
      `<!doctype html><html lang="th"><meta charset="utf-8"><title>เอกสาร</title><body style="font:16px sans-serif;padding:40px;text-align:center;color:#333"><p>ไม่พบตัวอย่างเอกสาร</p></body></html>`,
      { status: 404, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  return new Response(renderDocument(sampleModel(kind)), { headers });
}
