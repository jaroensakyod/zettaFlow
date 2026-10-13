import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
export async function GET(req: NextRequest) {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    `${req.nextUrl.protocol}//${req.headers.get("host")}`;
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      await sb.rpc("accept_invitations");
      const next =
        req.nextUrl.searchParams.get("next") === "/reset-password"
          ? "/reset-password"
          : "/zetta/dashboard";
      return NextResponse.redirect(new URL(next, origin));
    }
  }
  return NextResponse.redirect(new URL("/zetta/dashboard?auth_error=1", origin));
}
