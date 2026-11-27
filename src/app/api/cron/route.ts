import { processJobs, processNotifications } from "@/lib/ai";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendAdminAlert } from "@/lib/admin-log";
import { sweepHeldFiles } from "@/lib/line-held";
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
    // ?task=jobs (Cloudflare Cron Trigger every 5 minutes, cloudflare/worker.ts): only finish AI jobs and LINE
    // notifications. On Workers, after() work gets ~30 s past the response; a job cut off there keeps its expired lease
    // and is claimed again here instead of waiting for the daily run.
    if (new URL(req.url).searchParams.get("task") === "jobs") {
      const jobs = await processJobs(),
        notifications = await processNotifications();
      return Response.json({ jobs, notifications });
    }
    const sb = supabaseAdmin();
    const { data: nudges } = await sb.rpc("queue_nudges");
    const { data: expired } = await sb.rpc("expire_subscriptions");
    // Voice messages from LINE: the transcript stays on the item, the audio file goes after 90 days.
    const { data: oldVoice } = await sb.rpc("purge_voice_files", { p_days: 90 });
    const voicePaths = ((oldVoice as string[] | null) || []).filter(Boolean);
    if (voicePaths.length) await sb.storage.from("eliteflow-files").remove(voicePaths);
    // Photos sent in LINE before a mention that never came (line-held.ts): deleted once their wait ran out.
    const heldDropped = await sweepHeldFiles(sb);
    const jobs = await processJobs(),
      notifications = await processNotifications();
    // Daily health note to the platform team (ตั้งค่าแพลตฟอร์ม → แจ้งเตือน "ระบบมีปัญหา"), only when something failed.
    const since = new Date(Date.now() - 86400000).toISOString();
    const [failed, stuck] = await Promise.all([
      sb.from("ingestions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
      sb.from("notification_outbox").select("id", { count: "exact", head: true }).neq("status", "sent").gte("attempts", 5),
    ]);
    if ((failed.count || 0) + (stuck.count || 0) > 0)
      await sendAdminAlert("health", `⚠️ สรุปสุขภาพระบบ 24 ชม.
งาน AI ล้มเหลว ${failed.count || 0} รายการ
แจ้งเตือน LINE ส่งไม่สำเร็จ ${stuck.count || 0} รายการ
ดูรายละเอียดที่หลังบ้าน → สุขภาพระบบ`);
    return Response.json({ jobs, notifications, nudges, expired, heldDropped });
  } catch {
    return Response.json({ error: "Queue processing failed" }, { status: 500 });
  }
}
