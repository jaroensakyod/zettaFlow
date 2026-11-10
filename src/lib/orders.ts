/**
 * คำสั่งซื้อ (src/components/orders-page.tsx): each order with who ordered, the platform and package it sold, its total and
 * whether it is paid. Recording a payment stores who paid, when, how and the reference on the order, and creates the
 * income payment (so รายรับ counts it) — once.
 */
import { z } from "zod";
import { allEntities, saveEntity } from "./data";
import { assert, canRead, canWrite } from "./domain";
import { catalog } from "./catalog";
import type { Context, Entity } from "./types";

export type PayState = "ชำระแล้ว" | "รอชำระ" | "ยังไม่ชำระ";
export type OrderRow = {
  id: string;
  version: number;
  code: string;
  name: string;
  date: string;
  deliveryDate: string;
  customerId: string;
  customer: string;
  platformId: string;
  platform: string;
  platformType: string;
  packageId: string;
  package: string;
  packageType: string;
  items: { name: string; qty: number; price: number }[];
  total: number;
  status: string;
  payState: PayState;
  paidAt: string;
  payerName: string;
  payMethod: string;
  payReference: string;
  paymentId: string;
  quotation: string;
  project: string;
  notes: string;
};
export type Platform = { id: string; name: string; type: string; feePercent: number; status: string };
export type Pack = { id: string; name: string; code: string; type: string; platformId: string; price: number; status: string };
export type OrdersData = { orders: OrderRow[]; platforms: Platform[]; packages: Pack[]; customers: { id: string; name: string }[]; canPay: boolean };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const n = (v: unknown) => Number(v) || 0;
export const orderPayState = (d: Record<string, unknown>): PayState =>
  d.payStatus === "ชำระแล้ว" || d.paymentId ? "ชำระแล้ว" : d.payStatus === "รอชำระ" ? "รอชำระ" : "ยังไม่ชำระ";

export async function ordersList(ctx: Context): Promise<OrdersData> {
  assert(canRead(ctx, "Sales") || canRead(ctx, "Finance"), "ไม่มีสิทธิ์ดูคำสั่งซื้อ", 403);
  const none = Promise.resolve([] as Entity[]);
  const [orders, platforms, packages, customers, quotes, projects] = await Promise.all([
    allEntities(ctx, "sales_orders", 5000),
    allEntities(ctx, "sales_platforms", 500),
    allEntities(ctx, "sales_packages", 2000),
    allEntities(ctx, "customers", 5000).catch(() => [] as Entity[]),
    allEntities(ctx, "quotations", 5000).catch(() => [] as Entity[]),
    canRead(ctx, "Operations") ? allEntities(ctx, "projects", 5000).catch(() => [] as Entity[]) : none,
  ]);
  const byId = (rows: Entity[]) => new Map(rows.map((r) => [r.id, r]));
  const P = byId(platforms),
    K = byId(packages),
    C = byId(customers),
    Q = byId(quotes),
    J = byId(projects);
  const total = (d: Record<string, unknown>) => catalog.sales_orders.computed?.total?.calc(d) || 0;
  const rows: OrderRow[] = orders.map((o) => {
    const d = o.data,
      pf = P.get(s(d.platformId)),
      pk = K.get(s(d.packageId)),
      cu = C.get(s(d.customerId)),
      q = Q.get(s(d.quotationId)),
      pj = J.get(s(d.projectId));
    return {
      id: o.id,
      version: o.version,
      code: s(d.code) || s(d.name),
      name: s(d.name),
      date: s(d.date),
      deliveryDate: s(d.deliveryDate),
      customerId: s(d.customerId),
      customer: cu ? s(cu.data.company) || s(cu.data.name) : "",
      platformId: s(d.platformId),
      platform: pf ? s(pf.data.name) : "",
      platformType: pf ? s(pf.data.type) : "",
      packageId: s(d.packageId),
      package: pk ? s(pk.data.name) : "",
      packageType: pk ? s(pk.data.type) : "",
      items: Array.isArray(d.lines) ? (d.lines as { name: string; qty: number; price: number }[]).map((l) => ({ name: s(l.name), qty: n(l.qty), price: n(l.price) })) : [],
      total: total(d),
      status: s(d.status),
      payState: orderPayState(d),
      paidAt: s(d.paidAt),
      payerName: s(d.payerName),
      payMethod: s(d.payMethod),
      payReference: s(d.payReference),
      paymentId: s(d.paymentId),
      quotation: q ? s(q.data.code) || s(q.data.name) : "",
      project: pj ? s(pj.data.code) || s(pj.data.name) : "",
      notes: s(d.notes),
    };
  });
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.code.localeCompare(a.code));
  return {
    orders: rows,
    platforms: platforms.map((p) => ({ id: p.id, name: s(p.data.name), type: s(p.data.type), feePercent: n(p.data.feePercent), status: s(p.data.status) })),
    packages: packages.map((p) => ({ id: p.id, name: s(p.data.name), code: s(p.data.code), type: s(p.data.type), platformId: s(p.data.platformId), price: n(p.data.price), status: s(p.data.status) })),
    customers: customers.map((c) => ({ id: c.id, name: s(c.data.company) || s(c.data.name) })),
    canPay: canWrite(ctx, "Sales") && canWrite(ctx, "Finance"),
  };
}

const methods = ["โอนธนาคาร", "พร้อมเพย์", "บัตรเครดิต/เดบิต", "เงินสด", "เก็บเงินปลายทาง (COD)", "ชำระผ่านแพลตฟอร์ม"] as const;
// The payments page knows fewer methods: transfers (incl. PromptPay) / cash / card / other.
const paymentMethod = (m: string) => (m === "โอนธนาคาร" || m === "พร้อมเพย์" ? "โอนธนาคาร" : m === "เงินสด" ? "เงินสด" : m === "บัตรเครดิต/เดบิต" ? "บัตร" : "อื่นๆ");
const payInput = z.object({
  payerName: z.string().trim().min(1, "ใส่ชื่อผู้ชำระ").max(200),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ชำระไม่ถูกต้อง"),
  payMethod: z.enum(methods),
  payReference: z.string().trim().max(200).optional().default(""),
});

/** บันทึกการชำระ: the order becomes ชำระแล้ว with who / when / how, and an income payment is created for รายรับ. */
export async function recordOrderPayment(ctx: Context, id: string, input: unknown) {
  assert(canWrite(ctx, "Sales") && canWrite(ctx, "Finance"), "ต้องมีสิทธิ์ฝ่ายขายและฝ่ายการเงินจึงบันทึกการชำระได้", 403);
  const v = payInput.parse(input);
  const order = (await allEntities(ctx, "sales_orders", 5000)).find((o) => o.id === id);
  assert(order, "ไม่พบคำสั่งซื้อ", 404);
  assert(!order.data.paymentId, "คำสั่งซื้อนี้บันทึกการชำระไปแล้ว", 409);
  const code = s(order.data.code) || s(order.data.name);
  const amount = catalog.sales_orders.computed?.total?.calc(order.data) || 0;
  assert(amount > 0, "คำสั่งซื้อนี้ยังไม่มียอดเงิน");
  const payment = await saveEntity(ctx, "payments", {
    name: "รับชำระ " + code,
    direction: "income",
    date: v.paidAt,
    amount,
    method: paymentMethod(v.payMethod),
    reference: v.payReference || undefined,
    notes: `จากคำสั่งซื้อ ${code} #${order.id.slice(0, 8)} · ผู้ชำระ ${v.payerName} · ${v.payMethod}`,
  });
  const saved = await saveEntity(
    ctx,
    "sales_orders",
    { ...order.data, payStatus: "ชำระแล้ว", paidAt: v.paidAt, payerName: v.payerName, payMethod: v.payMethod, payReference: v.payReference || undefined, paymentId: payment.id },
    order.id,
    order.version,
  );
  return { order: saved, payment };
}

/** ยังไม่ชำระ ↔ รอชำระ (e.g. the customer said they will transfer today). Paid orders stay paid. */
export async function setOrderWaiting(ctx: Context, id: string, input: unknown) {
  assert(canWrite(ctx, "Sales"), "ไม่มีสิทธิ์แก้คำสั่งซื้อ", 403);
  const { payStatus } = z.object({ payStatus: z.enum(["ยังไม่ชำระ", "รอชำระ"]) }).parse(input);
  const order = (await allEntities(ctx, "sales_orders", 5000)).find((o) => o.id === id);
  assert(order, "ไม่พบคำสั่งซื้อ", 404);
  assert(orderPayState(order.data) !== "ชำระแล้ว", "คำสั่งซื้อนี้ชำระแล้ว", 409);
  return saveEntity(ctx, "sales_orders", { ...order.data, payStatus }, order.id, order.version);
}
