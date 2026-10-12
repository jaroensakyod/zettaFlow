import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
export const configured = () =>
  !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
export async function supabaseServer() {
  if (!configured())
    throw Error("ตั้งค่า Supabase URL และ Publishable key ก่อน");
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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
        getAll: () => jar.getAll(),
        setAll: (items) => {
          for (const item of items)
            jar.set(item.name, item.value, item.options);
        },
      },
    },
  );
}
export function supabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw Error("ยังไม่ได้ตั้งค่า Service role สำหรับ webhook");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
