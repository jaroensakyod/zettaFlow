// Directory pages (ลูกค้า / Supplier / พนักงาน): the whole list plus figures that live on other records —
// purchase totals from invoices / purchase orders / expenses, and tasks and leave for employees.
import { assert, canRead } from "./domain";
import { allEntities, nextCode } from "./data";
import { catalog } from "./catalog";
import { expenseCalc } from "./tax";
import type { Context, Entity } from "./types";

export type PartyStats = { spend: number; orders: number; openTasks?: number; lateTasks?: number; leaveUsed?: number; onLeave?: boolean; team?: number };
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const days = (from: string, to: string) => Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1);
const add = (m: Record<string, PartyStats>, id: unknown, amount: number) => {
  if (!id) return;
  const s = (m[String(id)] ||= { spend: 0, orders: 0 });
  s.spend = Math.round((s.spend + amount) * 100) / 100;
  s.orders++;
};
/** Records of a related kind, or none when this user cannot read that department. */
const related = (ctx: Context, kind: string) => (canRead(ctx, catalog[kind].department) || kind === "tasks" ? allEntities(ctx, kind, 5000) : Promise.resolve([] as Entity[]));

export async function directory(ctx: Context, kind: string) {
  assert(["customers", "suppliers", "employees"].includes(kind), "ไม่พบโมดูล", 404);
  assert(canRead(ctx, catalog[kind].department), "ไม่มีสิทธิ์ดูข้อมูลนี้", 403);
  const rows = await allEntities(ctx, kind, 2000);
  const stats: Record<string, PartyStats> = {};
  if (kind === "customers") {
    for (const i of await related(ctx, "invoices")) add(stats, i.data.customerId, Number(i.data.total) || 0);
  } else if (kind === "suppliers") {
    const [orders, expenses] = await Promise.all([related(ctx, "purchases"), related(ctx, "expenses")]);
    for (const p of orders) add(stats, p.data.supplierId, Number(p.data.total) || 0);
    for (const e of expenses) if (e.data.status !== "rejected") add(stats, e.data.supplierId, expenseCalc(e.data).gross);
  } else {
    const [tasks, leaves] = await Promise.all([related(ctx, "tasks"), related(ctx, "leaves")]);
    const now = today(),
      year = now.slice(0, 4);
    for (const e of rows) {
      const names = [e.data.name, e.data.nickname].filter(Boolean).map(String);
      const open = tasks.filter((t) => t.data.status !== "done" && names.includes(String(t.data.assignee || "")));
      const mine = leaves.filter((l) => l.data.employeeId === e.id && l.data.status === "approved");
      stats[e.id] = {
        spend: 0,
        orders: 0,
        openTasks: open.length,
        lateTasks: open.filter((t) => t.data.dueDate && String(t.data.dueDate) < now).length,
        leaveUsed: mine
          .filter((l) => l.data.type === "ลาพักร้อน" && String(l.data.startDate || "").startsWith(year))
          .reduce((s, l) => s + days(String(l.data.startDate), String(l.data.endDate || l.data.startDate)), 0),
        onLeave: mine.some((l) => String(l.data.startDate || "") <= now && now <= String(l.data.endDate || l.data.startDate || "")),
        team: rows.filter((x) => x.data.managerId === e.id).length,
      };
    }
  }
  return { rows, stats, nextCode: kind === "employees" ? "" : (await nextCode(ctx, kind)).code };
}
