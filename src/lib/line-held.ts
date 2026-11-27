import type { supabaseAdmin } from "@/lib/supabase/server";

type Admin = ReturnType<typeof supabaseAdmin>;

/**
 * Deletes held LINE files (line-mention.ts heldFiles) that no request claimed: the stored bytes and the attachment row.
 * A file that joined an item or a record (ingestion_id / entity_id set) is never touched.
 */
export async function dropHeldFiles(sb: Admin, ids: string[]) {
  if (!ids.length) return 0;
  const { data } = await sb.from("attachments").select("id,path").in("id", ids).is("ingestion_id", null).is("entity_id", null);
  const rows = (data || []) as { id: string; path: string }[];
  if (!rows.length) return 0;
  await sb.storage.from("eliteflow-files").remove(rows.map((r) => r.path).filter(Boolean));
  await sb.from("attachments").delete().in("id", rows.map((r) => r.id)).is("ingestion_id", null).is("entity_id", null);
  return rows.length;
}

/** Daily: held files whose wait ran out without a mention are deleted, with their rows. */
export async function sweepHeldFiles(sb: Admin, now = Date.now()) {
  const cut = new Date(now).toISOString();
  const { data } = await sb.from("line_listen").select("group_id,line_user,meta").lt("until", cut);
  let dropped = 0;
  for (const row of (data || []) as { group_id: string; line_user: string; meta: unknown }[]) {
    const held = (row.meta as { held?: unknown } | null)?.held;
    if (!Array.isArray(held)) continue;
    dropped += await dropHeldFiles(sb, held.filter((x): x is string => typeof x === "string"));
    await sb.from("line_listen").delete().eq("group_id", row.group_id).eq("line_user", row.line_user).lt("until", cut);
  }
  return dropped;
}
