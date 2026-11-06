// หน้า LINE: the connected groups (with their LINE names and activity) and, per group, every message the bot
// received: what it was, where it went (page / small talk) and its state, with the record it became.
import { assert } from "./domain";
import { dbError } from "./data";
import { catalog } from "./catalog";
import { supabaseServer } from "./supabase/server";
import { lineName } from "./ai";
import type { Context } from "./types";

const groupInfo = new Map<string, { name: string; picture: string | null } | null>();
/** Group name and picture as LINE shows them (free API call). Null when LINE is not configured or the bot left. */
async function lineGroup(groupId: string) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return null;
  if (groupInfo.has(groupId)) return groupInfo.get(groupId)!;
  const r = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`, {
    signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  }).catch(() => null);
  const j = r?.ok ? ((await r.json()) as { groupName?: string; pictureUrl?: string }) : null;
  const info = j?.groupName ? { name: j.groupName, picture: j.pictureUrl || null } : null;
  groupInfo.set(groupId, info);
  return info;
}

const canSee = (ctx: Context) => assert(["owner", "manager"].includes(ctx.member.role), "เฉพาะเจ้าของหรือผู้จัดการ", 403);

export async function lineGroupsOverview(ctx: Context) {
  canSee(ctx);
  const sb = await supabaseServer();
  const [{ data: groups, error }, { data: rows, error: e2 }, { data: forms }] = await Promise.all([
    sb.from("line_groups").select("*").eq("company_id", ctx.company.id),
    sb
      .from("ingestions")
      .select("group_id, status, missing, created_at, raw")
      .eq("company_id", ctx.company.id)
      .not("group_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(3000),
    sb.from("data_templates").select("id, name").eq("company_id", ctx.company.id),
  ]);
  dbError(error);
  dbError(e2);
  const weekAgo = Date.now() - 7 * 86400000;
  const list = await Promise.all(
    (groups || []).map(async (g) => {
      const mine = (rows || []).filter((r) => r.group_id === g.group_id);
      // Groups made by scripts/line-e2e.ts have ids "Ce2e…" and do not exist in LINE.
      const test = String(g.group_id).startsWith("Ce2e");
      const info = test ? null : await lineGroup(g.group_id);
      const latest = mine.find((r) => String(r.raw || "").trim());
      return {
        group_id: g.group_id as string,
        name: (g.name as string) || info?.name || "",
        lineName: info?.name || "",
        picture: info?.picture || null,
        template_id: g.template_id as string | null,
        templateName: g.template_id ? String((forms || []).find((f) => f.id === g.template_id)?.name || "ฟอร์ม") : null,
        test,
        /** LINE knows this group (the bot is in it). False for test groups or when the bot was removed. */
        found: !!info,
        preview: latest ? String(latest.raw).slice(0, 60) : "",
        approve_keywords: (g.approve_keywords as string[]) || [],
        department: (g.department as string | null) || null,
        total: mine.length,
        week: mine.filter((r) => Date.parse(r.created_at) > weekAgo).length,
        waiting: mine.filter((r) => r.status === "review").length,
        incomplete: mine.filter((r) => r.status === "review" && Array.isArray(r.missing) && r.missing.length).length,
        lastAt: mine[0]?.created_at || null,
      };
    }),
  );
  // Real groups first, most recently active first.
  return list.sort((a, b) => Number(a.test) - Number(b.test) || String(b.lastAt || "").localeCompare(String(a.lastAt || "")));
}

export type LineMessage = {
  id: string;
  created_at: string;
  sender: string | null;
  raw: string;
  attachment_id: string | null;
  status: string;
  missing: string[];
  error: string | null;
  kind: string | null;
  page: string;
  record: { id: string; kind: string } | null;
  decided: { name: string | null; at: string | null; via: string | null } | null;
  department: string | null;
};

export async function lineGroupMessages(ctx: Context, groupId: string): Promise<LineMessage[]> {
  canSee(ctx);
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("ingestions")
    .select("id, created_at, source_user, raw, attachment_id, status, missing, error, target_kind, template, values, department, decided_name, decided_at, decided_via")
    .eq("company_id", ctx.company.id)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(100);
  dbError(error);
  const items = data || [];
  const ids = items.filter((i) => i.status === "approved").map((i) => i.id as string);
  const { data: records, error: e2 } = ids.length
    ? await sb.from("entities").select("id, kind, data->>ingestionId").eq("company_id", ctx.company.id).in("data->>ingestionId", ids)
    : { data: [], error: null };
  dbError(e2);
  const byIngestion = new Map((records || []).map((r) => [String((r as Record<string, unknown>).ingestionId), { id: String(r.id), kind: String(r.kind) }]));
  return Promise.all(
    items.map(async (i) => {
      const template = (i.template || {}) as { name?: string; target_kind?: string | null };
      const kind = (i.target_kind as string | null) || template.target_kind || null;
      return {
        id: i.id,
        created_at: i.created_at,
        sender: await lineName(groupId, i.source_user),
        raw: String(i.raw || ""),
        attachment_id: i.attachment_id,
        status: i.status,
        missing: Array.isArray(i.missing) ? (i.missing as string[]) : [],
        error: i.error,
        kind,
        page: (kind && catalog[kind]?.label) || (template.name && template.name !== "AI แยกอัตโนมัติ" ? template.name : ""),
        record: byIngestion.get(i.id) || null,
        decided: i.decided_at ? { name: i.decided_name, at: i.decided_at, via: i.decided_via } : null,
        department: i.department || null,
      };
    }),
  );
}
