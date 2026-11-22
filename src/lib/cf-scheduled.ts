// Cloudflare Cron Triggers (wrangler.jsonc "triggers.crons") → the app's /api/cron route, run inside the same Worker
// (cloudflare/worker.ts calls the OpenNext fetch handler directly; nothing goes over the network). The route keeps its
// own check: `Authorization: Bearer ${CRON_SECRET}`, exactly what Vercel Cron sent, so without CRON_SECRET the run
// answers 401 and is reported as failed. No Next/app imports here: this module is bundled into the worker entry.

/** The schedules (UTC) and what each runs. Keep in sync with wrangler.jsonc triggers.crons. */
export const CRONS = {
  /** vercel.json's daily run: nudges, expired subscriptions, voice files older than 90 days, AI jobs, LINE outbox, health note. */
  daily: "0 0 * * *",
  /** AI jobs and LINE notifications only: picks up work an after() past the ~30 s waitUntil window left unfinished. */
  jobs: "*/5 * * * *",
} as const;

export type CronEnv = { CRON_SECRET?: string; NEXT_PUBLIC_APP_URL?: string };

/** The request the cron `cron` makes to the app, or null for a schedule this app does not know. */
export function cronRequest(cron: string, env: CronEnv): Request | null {
  const path = cron === CRONS.daily ? "/api/cron" : cron === CRONS.jobs ? "/api/cron?task=jobs" : null;
  if (!path) return null;
  const origin = (env.NEXT_PUBLIC_APP_URL || "https://eliteflow.workers.dev").replace(/\/$/, "");
  const headers = new Headers({ "user-agent": "Cloudflare-Cron", "x-eliteflow-cron": cron });
  if (env.CRON_SECRET) headers.set("authorization", `Bearer ${env.CRON_SECRET}`);
  return new Request(origin + path, { method: "GET", headers });
}

/**
 * The `scheduled` handler body: runs the app's cron route through `fetchApp` (the OpenNext worker's fetch) and throws
 * when it does not answer 2xx, so the Cron Trigger shows as failed in the Cloudflare dashboard.
 */
export async function runScheduled(cron: string, env: CronEnv, fetchApp: (req: Request) => Promise<Response>): Promise<unknown> {
  const req = cronRequest(cron, env);
  if (!req) throw new Error(`[cron] unknown schedule "${cron}" (src/lib/cf-scheduled.ts CRONS)`);
  if (!env.CRON_SECRET) console.error("[cron] CRON_SECRET is not set: /api/cron will answer 401 (wrangler secret put CRON_SECRET)");
  const res = await fetchApp(req);
  const text = await res.text();
  if (!res.ok) throw new Error(`[cron] ${cron} → ${res.status}: ${text.slice(0, 300)}`);
  console.info(`[cron] ${cron} → ${res.status} ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
