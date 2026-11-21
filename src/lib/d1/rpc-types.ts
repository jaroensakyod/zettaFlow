// The contract between the Supabase-shaped client on D1 (postgrest.ts) and the table of RPCs (rpc-map.ts).
// The app keeps calling `sb.rpc("name", { p_company, … })`; on D1 each name runs its TypeScript port.
import type { Sql } from "./driver";
import type { Tenant } from "./tenant";

export type RpcCaller = {
  sql: Sql;
  /** The signed-in person (auth.uid()); null for the service-role client (webhooks, cron, platform admin). */
  userId: string | null;
  /** Their email (auth.jwt()->>'email'), lowercased; "" for the service role. */
  email: string;
  /** Their display name from sign-up (auth.users.raw_user_meta_data->>'name'). */
  name: string;
  /** True for supabaseAdmin(): Postgres ran these as service_role (no member checks of its own). */
  service: boolean;
  /**
   * The person as a member of that company (role, departments, support view) — what member_role(p_company) and
   * can_read_dept saw. Throws AppError 'ไม่มีสิทธิ์' (403) when they are not a member, like the SQL functions did.
   */
  tenantFor(companyId: string): Promise<Tenant>;
  /** A tenant for service-role work on a company (owner rights, no person). */
  serviceTenant(companyId: string): Tenant;
};
/** One RPC: the app's named arguments in, what Postgres returned (jsonb / row / scalar / void → null) out. */
export type RpcHandler = (caller: RpcCaller, args: Record<string, unknown>) => Promise<unknown>;
