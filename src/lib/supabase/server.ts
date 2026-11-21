import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { d1AdminClient, d1Enabled, d1ServerClient } from "@/lib/d1/runtime";
// DATA_BACKEND=d1: the same two clients, backed by Cloudflare D1 (src/lib/d1/postgrest.ts). They answer the calls the
// app makes (from/select/filters, rpc, auth — Better Auth sessions in this request's cookies —, storage) in the shapes supabase-js gives, so callers stay as they are.
export const configured = () =>
  d1Enabled() ||
  !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
async function supabaseServerClient() {
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
function supabaseAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw Error("ยังไม่ได้ตั้งค่า Service role สำหรับ webhook");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
type ServerClient = Awaited<ReturnType<typeof supabaseServerClient>>;
type AdminClient = ReturnType<typeof supabaseAdminClient>;
/** The site origin of this request, for signed file links on D1. */
async function requestOrigin() {
  try {
    const h = await headers(),
      host = h.get("x-forwarded-host") || h.get("host");
    if (host)
      return `${h.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")}://${host}`;
  } catch {}
  return undefined;
}
export async function supabaseServer(): Promise<ServerClient> {
  if (d1Enabled())
    return (await d1ServerClient(await requestOrigin(), {
      cookies: await cookies(),
      headers: new Headers(await headers()),
    })) as unknown as ServerClient;
  return supabaseServerClient();
}
export function supabaseAdmin(): AdminClient {
  if (d1Enabled()) return d1AdminClient() as unknown as AdminClient;
  return supabaseAdminClient();
}
