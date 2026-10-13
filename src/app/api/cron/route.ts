import { processJobs, processNotifications } from "@/lib/ai";
import { supabaseAdmin } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (
    !process.env.CRON_SECRET ||
    req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const sb = supabaseAdmin();
    const { data: nudges } = await sb.rpc("queue_nudges");
    const { data: expired } = await sb.rpc("expire_subscriptions");
    const jobs = await processJobs(),
      notifications = await processNotifications();
    return Response.json({ jobs, notifications, nudges, expired });
  } catch {
    return Response.json({ error: "Queue processing failed" }, { status: 500 });
  }
}
