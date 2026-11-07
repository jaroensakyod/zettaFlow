import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
// Email links (sign-up, reset password, invite) land here with a one-time ?code=.
// Success: reset password → /reset-password, everything else → the EliteFlow workspace.
// A used or expired link (Supabase sends error=otp_expired in the hash, so there is no code) goes to a page that
// explains it and lets the person ask for a new link — never to the Zetta shell.
export async function GET(req: NextRequest) {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    `${req.nextUrl.protocol}//${req.headers.get("host")}`;
  const reset = req.nextUrl.searchParams.get("next") === "/reset-password";
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      await sb.rpc("accept_invitations");
      return NextResponse.redirect(new URL(reset ? "/reset-password" : "/workspace/dashboard", origin));
    }
  }
  return NextResponse.redirect(
    new URL(reset ? "/reset-password?expired=1" : "/workspace/dashboard?auth_error=1", origin),
  );
}
