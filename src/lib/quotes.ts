/**
 * ใบเสนอราคา (src/components/quotes-page.tsx): each quotation with its customer, project, total, status, and how far the
 * accepted ones got — order opened, invoice issued, paid.
 */
import { z } from "zod";
import { allEntities, saveEntity, nextCode } from "./data";
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
  /** What was quoted, in short: the title when one was written, else the first items. */
  summary: string;
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
      summary: (() => {
        const title = s(d.name),
          items = Array.isArray(d.lines) ? (d.lines as { name: string }[]).map((l) => s(l.name)).filter(Boolean) : [];
        if (title && title !== s(d.code) && !/^QT-\d/.test(title)) return title;
        return items.length ? items[0] + (items.length > 1 ? " และอีก " + (items.length - 1) + " รายการ" : "") : title;
      })(),
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
    .object({
      status: z.enum(["ร่าง", "ส่งแล้ว", "ตอบรับ", "ปฏิเสธ"]).optional(),
      projectId: z.union([z.uuid(), z.literal("")]).optional(),
      // หัวข้องาน / รายละเอียด: what the quotation offers, in a line or two.
      name: z.string().trim().min(1, "ใส่รายละเอียดอย่างน้อย 1 ตัวอักษร").max(500).optional(),
    })
    .parse(input);
  const q = (await allEntities(ctx, "quotations", 5000)).find((x) => x.id === id);
  assert(q, "ไม่พบใบเสนอราคา", 404);
  const data = { ...q.data };
  if (v.status) data.status = v.status;
  if (v.name) data.name = v.name;
  if (v.projectId !== undefined) {
    if (v.projectId) data.projectId = v.projectId;
    else delete data.projectId;
  }
  return saveEntity(ctx, "quotations", data, q.id, q.version);
}

export type QuoteFormCustomer = { id: string; name: string; address: string; taxId: string; branch: string; contact: string; phone: string; email: string; creditDays: number | null };
export type QuoteForm = {
  company: { id: string; name: string; nameEn: string; hasLogo: boolean; address: string; taxId: string; branch: string; phone: string; email: string; website: string; line: string; bank: string; bankAccount: string; bankAccountName: string; bankAccountType: string; promptPay: string; signerName: string; signerPosition: string; approverName: string; approverPosition: string; conditions: string[]; notes: string[] };
  customers: QuoteFormCustomer[];
  projects: { id: string; code: string; name: string }[];
  /** สินค้า & แพ็กเกจ (Sales) — packages, products and services we sell. */
  packages: { id: string; name: string; price: number; type: string; code: string; description: string }[];
  /** Stock items from the warehouse (สต็อกสินค้า) with what is on hand. */
  products: { id: string; name: string; sku: string; category: string; unit: string; price: number; stock: number }[];
  nextCode: string;
  /** Editing: the quotation as saved (lines with unit / per-line discount; detail is the name's second line). */
  quote: { id: string; version: number; code: string; data: Record<string, unknown> } | null;
};
/** Everything the document-style quotation form shows: our letterhead, customers with their details, projects, packages. */
export async function quoteForm(ctx: Context, id?: string): Promise<QuoteForm> {
  assert(canRead(ctx, "Sales"), "ไม่มีสิทธิ์ดูใบเสนอราคา", 403);
  const none = [] as Entity[];
  const [customers, projects, packages, products, quotes, next] = await Promise.all([
    allEntities(ctx, "customers", 5000).catch(() => none),
    allEntities(ctx, "projects", 5000).catch(() => none),
    allEntities(ctx, "sales_packages", 2000).catch(() => none),
    canRead(ctx, "Warehouse") ? allEntities(ctx, "products", 5000).catch(() => none) : Promise.resolve(none),
    id ? allEntities(ctx, "quotations", 5000) : Promise.resolve(none),
    nextCode(ctx, "quotations").catch(() => ({ code: "" })),
  ]);
  const p = (ctx.company.profile || {}) as Record<string, unknown>;
  const q = id ? quotes.find((x) => x.id === id) : undefined;
  if (id) assert(q, "ไม่พบใบเสนอราคา", 404);
  const lines = (v: unknown) => s(v).split(/\r?\n/).map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);
  return {
    company: {
      id: ctx.company.id, name: s(ctx.company.name), nameEn: s(p.nameEn), hasLogo: !!s(p.logo), address: s(p.address), taxId: s(p.taxId), branch: s(p.branch),
      phone: s(p.phone), email: s(p.email), website: s(p.website), line: s(p.line), bank: s(p.bank) || s(p.bankName), bankAccount: s(p.bankAccount),
      bankAccountName: s(p.bankAccountName), bankAccountType: s(p.bankAccountType), promptPay: s(p.promptPay), signerName: s(p.signerName),
      signerPosition: s(p.signerPosition), approverName: s(p.approverName), approverPosition: s(p.approverPosition), conditions: lines(p.docConditions), notes: lines(p.quotationNotes),
    },
    customers: customers
      .filter((c) => c.data.status !== "inactive")
      .map((c) => {
        const d = c.data,
          company = s(d.company);
        return {
          id: c.id, name: company || s(d.name), address: s(d.address), taxId: s(d.taxId), branch: s(d.branch), contact: s(d.contact) || (company ? s(d.name) : ""),
          phone: s(d.phone), email: s(d.email), creditDays: d.creditDays === undefined || d.creditDays === null || d.creditDays === "" ? null : n(d.creditDays),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
    projects: projects.filter((x) => x.data.status !== "cancelled").map((x) => ({ id: x.id, code: s(x.data.code), name: s(x.data.name) })),
    packages: packages
      .filter((x) => x.data.status !== "inactive")
      .map((x) => ({ id: x.id, name: s(x.data.name), price: n(x.data.price), type: s(x.data.type) || "แพ็กเกจ", code: s(x.data.code), description: s(x.data.description) })),
    products: products
      .filter((x) => x.data.status !== "inactive")
      .map((x) => ({ id: x.id, name: s(x.data.name), sku: s(x.data.sku), category: s(x.data.category), unit: s(x.data.unit), price: n(x.data.price), stock: n(x.data.stock) }))
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
    nextCode: s((next as { code: string }).code),
    quote: q ? { id: q.id, version: q.version, code: s(q.data.code), data: q.data } : null,
  };
}
