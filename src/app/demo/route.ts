import { NextResponse, type NextRequest } from "next/server";
import { publicDemoAllowed, PUBLIC_DEMO_COOKIE } from "@/lib/demo";
export const dynamic = "force-dynamic";
/** Opens the public read-only showcase: sample company, no login, no writes. */
export function GET(req: NextRequest) {
  const target = new URL(
    publicDemoAllowed() ? "/zetta/dashboard" : "/zetta",
    req.nextUrl.origin,
  );
  const res = NextResponse.redirect(target);
  if (publicDemoAllowed())
    res.cookies.set(PUBLIC_DEMO_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 4,
    });
  return res;
}
