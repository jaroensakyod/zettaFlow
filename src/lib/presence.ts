// Online status: the open workspace pings /presence every 30 s with the company logos on screen; the answer says which
// of those companies, and which of the caller's own colleagues, were active in the last 2 minutes (see 0056).
import { z } from "zod";
import { supabaseServer } from "./supabase/server";
import { dbError } from "./data";
import type { Context } from "./types";

const input = z.object({ companies: z.array(z.string().max(64)).max(300).default([]) });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function presence(ctx: Context, body: unknown): Promise<{ companies: string[]; users: string[] }> {
  const companies = [...new Set(input.parse(body).companies.filter((id) => uuid.test(id)))];
  if (ctx.demo) {
    // Demo: your own company, plus roughly half of the others (stable per company), look online.
    const on = companies.filter((id) => id === ctx.company.id || parseInt(id.replace(/-/g, "").slice(-2), 16) % 2 === 0);
    return { companies: [...new Set([ctx.company.id, ...on])], users: [ctx.user.id] };
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("presence_ping", { p_company: ctx.company.id, p_companies: companies });
  dbError(error);
  return data as { companies: string[]; users: string[] };
}
