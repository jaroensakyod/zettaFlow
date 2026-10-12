import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
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
