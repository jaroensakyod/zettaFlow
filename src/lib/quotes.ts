/**
 * ใบเสนอราคา (src/components/quotes-page.tsx): each quotation with its customer, project, total, status, and how far the
 * accepted ones got — order opened, invoice issued, paid.
 */
import { z } from "zod";
import { allEntities, saveEntity } from "./data";
import { assert, canRead, canWrite } from "./domain";
import { catalog } from "./catalog";
import { docUrl } from "./documents";
import type { Context, Entity } from "./types";

/** Where an accepted quotation stands; the other statuses are the quotation's own. */
export type QuoteStage = "ร่าง" | "ส่งแล้ว" | "หมดอายุ" | "ปฏิเสธ" | "ตอบรับ" | "เปิดคำสั่งซื้อแล้ว" | "ออกใบแจ้งหนี้แล้ว" | "ชำระแล้ว";
export type QuoteRow = {
  id: string;
  version: number;
  code: string;
  name: string;
  date: string;
  validUntil: string;
  customerId: string;
  customer: string;
  projectId: string;
  project: string;
  projectName: string;
  owner: string;
  status: string;
  stage: QuoteStage;
  items: { name: string; qty: number; price: number }[];
  discount: number;
  vatMode: string;
  total: number;
  order: { id: string; code: string; paid: boolean } | null;
  invoice: { id: string; name: string; paid: boolean } | null;
  printUrl: string;
  notes: string;
};
export type QuotesData = { quotes: QuoteRow[]; projects: { id: string; code: string; name: string }[]; canWrite: boolean; today: string };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const n = (v: unknown) => Number(v) || 0;

export async function quotesList(ctx: Context): Promise<QuotesData> {
  assert(canRead(ctx, "Sales"), "ไม่มีสิทธิ์ดูใบเสนอราคา", 403);
  const none = [] as Entity[];
  const [quotes, customers, orders, invoices, payments, projects] = await Promise.all([
    allEntities(ctx, "quotations", 5000),
    allEntities(ctx, "customers", 5000).catch(() => none),
    allEntities(ctx, "sales_orders", 5000).catch(() => none),
    canRead(ctx, "Finance") ? allEntities(ctx, "invoices", 5000).catch(() => none) : none,
    canRead(ctx, "Finance") ? allEntities(ctx, "payments", 5000).catch(() => none) : none,
    allEntities(ctx, "projects", 5000).catch(() => none),
  ]);
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const received = new Map<string, number>();
  for (const p of payments)
    if (p.data.direction === "income" && p.data.invoiceId) received.set(s(p.data.invoiceId), (received.get(s(p.data.invoiceId)) || 0) + n(p.data.amount));
  const invoicePaid = (i: Entity) => {
    const total = n(i.data.subtotal) * (1 + n(i.data.vat) / 100);
    return i.data.status === "paid" || (total > 0 && (received.get(i.id) || 0) >= total - 0.01);
  };
  const ref = (id: string) => "#" + id.slice(0, 8);
  const total = (d: Record<string, unknown>) => catalog.quotations.computed?.total?.calc(d) || 0;
  const rows: QuoteRow[] = quotes.map((q) => {
    const d = q.data;
    const cu = customers.find((c) => c.id === d.customerId);
    const so = orders.find((o) => o.data.quotationId === q.id && o.data.status !== "ยกเลิก");
    // The project chosen on the quotation, else the one made when it was accepted, else its order's.
    const pj =
      projects.find((p) => p.id === d.projectId) ||
      projects.find((p) => s(p.data.code) && s(p.data.code) === (s(d.code) || s(d.name))) ||
      (so ? projects.find((p) => p.id === so.data.projectId) : undefined);
    // An invoice made from the quotation directly, or from its order.
    const inv = invoices.find((i) => s(i.data.description).includes(ref(q.id)) || (so && s(i.data.description).includes(ref(so.id))));
    const soPaid = !!so && (so.data.payStatus === "ชำระแล้ว" || !!so.data.paymentId);
    const status = s(d.status);
    const stage: QuoteStage =
      status !== "ตอบรับ"
        ? status === "ส่งแล้ว" && s(d.validUntil) && s(d.validUntil) < today
          ? "หมดอายุ"
          : ((status || "ร่าง") as QuoteStage)
        : soPaid || (inv && invoicePaid(inv))
          ? "ชำระแล้ว"
          : inv
            ? "ออกใบแจ้งหนี้แล้ว"
            : so
              ? "เปิดคำสั่งซื้อแล้ว"
              : "ตอบรับ";
    return {
      id: q.id,
      version: q.version,
      code: s(d.code) || s(d.name),
      name: s(d.name),
      date: s(d.date),
      validUntil: s(d.validUntil),
      customerId: s(d.customerId),
      customer: cu ? s(cu.data.company) || s(cu.data.name) : "",
      projectId: pj ? pj.id : "",
      project: pj ? s(pj.data.code) || s(pj.data.name) : "",
      projectName: pj ? s(pj.data.name) : "",
      owner: s(d.owner),
      status,
      stage,
      items: Array.isArray(d.lines) ? (d.lines as { name: string; qty: number; price: number }[]).map((l) => ({ name: s(l.name), qty: n(l.qty), price: n(l.price) })) : [],
      discount: n(d.discount),
      vatMode: s(d.vatMode),
      total: total(d),
      order: so ? { id: so.id, code: s(so.data.code) || s(so.data.name), paid: soPaid } : null,
      invoice: inv ? { id: inv.id, name: s(inv.data.name), paid: invoicePaid(inv) } : null,
      printUrl: docUrl("quotation", q.id),
      notes: s(d.notes),
    };
  });
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.code.localeCompare(a.code));
  return {
    quotes: rows,
    projects: projects.filter((p) => p.data.status !== "cancelled").map((p) => ({ id: p.id, code: s(p.data.code), name: s(p.data.name) })),
    canWrite: canWrite(ctx, "Sales"),
    today,
  };
}

/** Change a quotation's status or project from the quotation page (accepting it then opens its project). */
export async function updateQuote(ctx: Context, id: string, input: unknown) {
  assert(canWrite(ctx, "Sales"), "ไม่มีสิทธิ์แก้ใบเสนอราคา", 403);
  const v = z
    .object({ status: z.enum(["ร่าง", "ส่งแล้ว", "ตอบรับ", "ปฏิเสธ"]).optional(), projectId: z.union([z.uuid(), z.literal("")]).optional() })
    .parse(input);
  const q = (await allEntities(ctx, "quotations", 5000)).find((x) => x.id === id);
  assert(q, "ไม่พบใบเสนอราคา", 404);
  const data = { ...q.data };
  if (v.status) data.status = v.status;
  if (v.projectId !== undefined) {
    if (v.projectId) data.projectId = v.projectId;
    else delete data.projectId;
  }
  return saveEntity(ctx, "quotations", data, q.id, q.version);
}
