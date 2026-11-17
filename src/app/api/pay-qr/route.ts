// PromptPay QR for a package payment in LINE (LINE shows images by https URL only): /api/pay-qr?a=3841.3 → PNG.
// Public on purpose — it encodes only the platform's PromptPay ID and the amount.
import sharp from "sharp";
import { promptPayPayload, qrMatrix, qrSvgPath } from "@/lib/promptpay";
import { payee } from "@/lib/line-billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const amount = Number(new URL(req.url).searchParams.get("a"));
  const id = payee().promptPay;
  if (!id || !(amount > 0 && amount < 1e7)) return Response.json({ error: "ไม่พบข้อมูลการชำระ" }, { status: 404 });
  const m = qrMatrix(promptPayPayload(id, Math.round(amount * 100) / 100));
  const size = m.length + 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 16}" height="${size * 16}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${qrSvgPath(m)}" fill="#19182b"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}
