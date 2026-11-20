// PromptPay QR for a package payment in LINE (LINE shows images by https URL only): /api/pay-qr?a=3841.3 → PNG.
// Public on purpose — it encodes only the platform's PromptPay ID and the amount. Drawn by png.ts (no native image
// library), so it runs on Vercel and Cloudflare Workers alike.
import { promptPayPayload, qrMatrix } from "@/lib/promptpay";
import { qrPng } from "@/lib/png";
import { payee } from "@/lib/line-billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const amount = Number(new URL(req.url).searchParams.get("a"));
  const id = payee().promptPay;
  if (!id || !(amount > 0 && amount < 1e7)) return Response.json({ error: "ไม่พบข้อมูลการชำระ" }, { status: 404 });
  const png = qrPng(qrMatrix(promptPayPayload(id, Math.round(amount * 100) / 100)));
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}
