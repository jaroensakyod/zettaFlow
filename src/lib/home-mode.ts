// Who sees what on the home page (/workspace/dashboard, ภาพรวม). One place to change it.
// "company": the company's money (ต้นทุน / ยอดขาย / ค่าใช้จ่าย / กำไร-ขาดทุน cards, ภาพรวมยอดขาย chart, the month's
// sales goal, the company's recent activity). "personal": the member's own workspace instead (profile, my tasks,
// what I sent, who I talk with, shortcuts). Pure — the page and the API both call it.
import type { Context } from "./types";

export type HomeMode = "company" | "personal";

export function homeMode(ctx: Pick<Context, "member"> & { support?: unknown }): HomeMode {
  // A platform admin's read-only support view looks at the company as its owner would.
  if (ctx.support) return "company";
  return ctx.member.role === "owner" || ctx.member.role === "manager" ? "company" : "personal";
}

export const personalHome = (ctx: Pick<Context, "member"> & { support?: unknown }) => homeMode(ctx) === "personal";

/** Does a free-text assignee name mean me? (full name or email, or the first word of either name) */
export function isMe(ctx: Pick<Context, "user" | "member">, name: unknown) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  const mine = [ctx.user.name, ctx.member.name, ctx.user.email].map((s) => String(s || "").trim().toLowerCase()).filter(Boolean);
  const first = (s: string) => s.split(/\s+/)[0];
  return mine.some((m) => m === n || first(m) === first(n));
}

/** A task that is mine: assigned to me, or one I created that nobody else was given. */
export function myTask(ctx: Pick<Context, "user" | "member">, t: { created_by?: string | null; data: Record<string, unknown> }) {
  return isMe(ctx, t.data.assignee) || (t.created_by === ctx.user.id && !String(t.data.assignee || "").trim());
}
