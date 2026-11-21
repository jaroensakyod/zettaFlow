import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  // DATA_BACKEND=d1: sessions are Better Auth cookies read by supabaseServer() itself (src/lib/d1/auth.ts); Supabase
  // is never called, even when its env is still set.
  if (process.env.DATA_BACKEND === "d1") {
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return response;
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure:
          !!process.env.VERCEL ||
          process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://"),
        path: "/",
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach((i) => request.cookies.set(i.name, i.value));
          response = NextResponse.next({ request });
          items.forEach((i) =>
            response.cookies.set(i.name, i.value, i.options),
          );
        },
      },
    },
  );
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/line|api/cron|api/auth|auth/callback).*)",
  ],
};
