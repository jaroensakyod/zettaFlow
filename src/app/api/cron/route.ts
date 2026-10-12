import { processJobs, processNotifications } from "@/lib/ai";
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
    const jobs = await processJobs(),
      notifications = await processNotifications();
    return Response.json({ jobs, notifications });
  } catch {
    return Response.json({ error: "Queue processing failed" }, { status: 500 });
  }
}
