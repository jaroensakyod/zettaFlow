// What platform admins did in หลังบ้าน (prices, packages, ads, settings, team), shown in ความปลอดภัย. Production keeps
// it in audit_events on the platform company ("admin_*" actions, target ends with " by <email>"); demo keeps a list.
import { supabaseAdmin } from "./supabase/server";
import { platformCompanyId } from "./package-sale";
import type { Context } from "./types";

export type AdminLogRow = { at: string; by: string; action: string; text: string };
export type DemoAdminLog = { adminLog?: AdminLogRow[] };

export function demoAdminLog(s: DemoAdminLog, ctx: Context, action: string, text: string) {
  (s.adminLog ??= []).unshift({ at: new Date().toISOString(), by: ctx.user.email, action, text });
  s.adminLog.length = Math.min(s.adminLog.length, 300);
}
export async function logAdmin(ctx: Context, action: string, text: string) {
  await supabaseAdmin()
    .from("audit_events")
    .insert({ company_id: platformCompanyId(), action: "admin_" + action, target: `${text.slice(0, 400)} by ${ctx.user.email}` });
}

/**
 * A LINE message to the platform team (ตั้งค่าแพลตฟอร์ม → แจ้งเตือน), pushed straight away; if LINE does not take it,
 * it waits in notification_outbox for the usual LINE worker. Off unless an admin set a LINE ID and switched the event
 * on. Never throws.
 */
export async function sendAdminAlert(event: "signup" | "payment" | "topup" | "support" | "health" | "test", text: string, force = false) {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return false;
    const sb = supabaseAdmin(),
      platform = platformCompanyId();
    const { data } = await sb.from("companies").select("settings").eq("id", platform).maybeSingle();
    const a = (data?.settings as { admin_alerts?: { to?: string; events?: Record<string, boolean> } } | undefined)?.admin_alerts;
    if (!a?.to || (!force && !a.events?.[event])) return false;
    const body = text.slice(0, 1800);
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      signal: AbortSignal.timeout(6000),
      headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: a.to, messages: [{ type: "text", text: body }] }),
    }).catch(() => null);
    if (r?.ok) return true;
    const { error } = await sb.from("notification_outbox").insert({ company_id: platform, target: a.to, body, payload: { type: "text", text: body } });
    return !error;
  } catch {
    return false;
  }
}
