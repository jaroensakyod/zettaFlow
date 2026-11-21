// The deal room (ห้องดีล) between two companies for D1, step for step after the Postgres b2b_deal_* functions:
// request → quotation (revisions) → decision; then progress, delivery and acceptance, instalment invoices, payments
// with withholding tax and receipts, closing, and cancelling with both sides' consent. Accepting, invoicing and
// receiving write records into each company's own books (customers, projects, quotations, suppliers, tasks,
// invoices, payments, expenses), with the entities triggers those inserts and updates fire (network-common.ts).
// Rows Postgres locked (FOR UPDATE) are guarded on what was read, so a concurrent change aborts the batch.
import type { Stmt } from "./driver";
import type { Tenant } from "./tenant";
import { b2bThreadOf, b2bWriter, cardNoteStmts } from "./network-chat";
import {
  addDays,
  bkkDate,
  bkkYYMM,
  cat,
  date,
  ddmmyyyy,
  fail,
  feedAuthor,
  fix,
  insertEntityStmts,
  int,
  jsonbType,
  jtext,
  left,
  len,
  money,
  myRole,
  nullif,
  numeric,
  round2,
  setEntityStmts,
  stamp,
  stripNulls,
  trim,
  uuid,
  type Data,
} from "./network-common";

export type Deal = {
  id: string;
  thread_id: string;
  buyer: string;
  seller: string;
  title: string;
  stage: string;
  accepted_at: string | null;
  accepted_by: string | null;
  seller_quote: string | null;
  seller_project: string | null;
  seller_customer: string | null;
  buyer_supplier: string | null;
  buyer_task: string | null;
  created_at: string;
  updated_at: string;
};
export type Card = {
  id: string;
  deal_id: string;
  company_id: string;
  author_id: string | null;
  author_name: string;
  kind: string;
  rev: number;
  data: Data;
  status: string;
  reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  seller_ref: string | null;
  buyer_ref: string | null;
};
const obj = (v: unknown): Data => (v && typeof v === "object" && !Array.isArray(v) ? (v as Data) : {});
/** x->'k' of a JSON value (only objects have keys). */
const get = (v: unknown, k: string): unknown => obj(v)[k];
const num = (v: unknown) => numeric(jtext(v));
const docId = (dealId: string) => dealId.replace(/-/g, "").slice(0, 5).toUpperCase();

// ---------- helpers (immutable / stable SQL functions) ----------
/** b2b_bkk_today(): today in Bangkok. */
export const b2bBkkToday = (now = stamp()) => bkkDate(now);

/** b2b_items(items, priced): the item lines of a request (priced = a quotation), blank rows dropped. */
export function b2bItems(items: unknown, priced: boolean): Data[] {
  if (jsonbType(items ?? null) !== "array") fail("ใส่รายการอย่างน้อย 1 รายการ");
  const out: Data[] = [];
  for (const x of items as unknown[]) {
    const name = jtext(get(x, "name"));
    if (trim(name ?? "") === "") continue;
    const q = numeric(nullif(jtext(get(x, "qty")))) ?? 1;
    if (q <= 0 || q > 1e9) fail("จำนวนต้องมากกว่า 0");
    let p = 0;
    if (priced) {
      p = numeric(nullif(jtext(get(x, "price")))) ?? 0;
      if (p < 0 || p > 1e12) fail("ราคาไม่ถูกต้อง");
    }
    out.push({ name: left(trim(name!), 300), qty: q, unit: left(trim(jtext(get(x, "unit")) ?? ""), 30), ...(priced ? { price: p, amount: round2(q * p) } : {}) });
  }
  if (!out.length) fail("ใส่รายการอย่างน้อย 1 รายการ");
  if (out.length > 100) fail("ไม่เกิน 100 รายการ");
  return out;
}
/** b2b_installments(p): the payment schedule (one full payment when none), adding up to 100%. */
export function b2bInstallments(p: unknown): { label: string; percent: number }[] {
  if (jsonbType(p ?? null) !== "array" || !(p as unknown[]).length) return [{ label: "ชำระเต็มจำนวน", percent: 100 }];
  const out: { label: string; percent: number }[] = [];
  let s = 0;
  for (const x of p as unknown[]) {
    const pc = numeric(nullif(jtext(get(x, "percent"))));
    if (pc === null || pc <= 0 || pc > 100) fail("เปอร์เซ็นต์งวดชำระต้องอยู่ระหว่าง 1–100");
    s = fix(s + pc!);
    const label = jtext(get(x, "label"));
    out.push({ label: left(nullif(label === null ? null : trim(label)) ?? "งวดที่ " + (out.length + 1), 60), percent: pc! });
  }
  if (out.length > 6) fail("แบ่งได้ไม่เกิน 6 งวด");
  if (s !== 100) fail("งวดชำระรวมกันต้องได้ 100%");
  return out;
}
/** b2b_installment_amount(quote, i): instalment i of a quotation; the last one takes what rounding left over. */
export function b2bInstallmentAmount(q: unknown, i: number) {
  const inst = b2bInstallments(get(q, "installments")),
    n = inst.length;
  const total = num(get(q, "total")) as number,
    vat = num(get(q, "vat")) ?? 0,
    base = fix(total - vat);
  if (i < 0 || i >= n) fail("ไม่พบงวดชำระนี้");
  let net: number, v: number;
  if (i < n - 1) {
    net = round2((base * inst[i].percent) / 100);
    v = round2((vat * inst[i].percent) / 100);
  } else {
    net = base;
    v = vat;
    for (let k = 0; k <= n - 2; k++) {
      net = fix(net - round2((base * inst[k].percent) / 100));
      v = fix(v - round2((vat * inst[k].percent) / 100));
    }
  }
  return { index: i, count: n, label: inst[i].label, percent: inst[i].percent, net, vat: v, amount: fix(net + v) };
}
/** b2b_party(c): a company as it appears on a document. */
export async function b2bParty(t: Tenant, companyId: string): Promise<Data | null> {
  const [c] = await t.selectGlobal<{ id: string; name: string; profile: Data }>("companies", { where: { id: companyId } });
  if (!c) return null;
  const p = (k: string) => jtext(c.profile?.[k]);
  return { id: c.id, name: nullif(p("name")) ?? c.name, taxId: nullif(p("taxId")) ?? nullif(p("registration")) ?? "", address: p("address") ?? "", phone: p("phone") ?? "" };
}
/** b2b_card_json(card, c): a deal card as the deal room shows it to company c. */
export const b2bCardJson = (c: Card, companyId: string): Data => ({
  id: c.id,
  deal_id: c.deal_id,
  kind: c.kind,
  rev: c.rev,
  data: c.data,
  status: c.status,
  reason: c.reason,
  decided_by: c.decided_by,
  decided_at: c.decided_at,
  author_name: c.author_name,
  created_at: c.created_at,
  mine: c.company_id === companyId,
  company_id: c.company_id,
});
const cardsOf = (t: Tenant, dealId: string) => t.selectGlobal<Card>("b2b_cards", { where: { deal_id: dealId }, order: [["created_at", "asc"]] });
/** b2b_accepted_quote(deal): the quotation the buyer accepted. */
export async function b2bAcceptedQuote(t: Tenant, dealId: string): Promise<Card | null> {
  const [q] = await t.selectGlobal<Card>("b2b_cards", { where: { deal_id: dealId, kind: "quote", status: "accepted" }, order: [["created_at", "desc"]], limit: 1 });
  return q ?? null;
}
/** b2b_deal_fully_paid(deal): every instalment of the accepted quotation has an accepted invoice (`alsoPaid`: one more being accepted now). */
export async function b2bDealFullyPaid(t: Tenant, dealId: string, alsoPaid?: number | null): Promise<boolean> {
  const q = await b2bAcceptedQuote(t, dealId);
  if (!q) return false;
  const n = b2bInstallments(get(q.data, "installments")).length;
  const paid = new Set((await t.selectGlobal<Card>("b2b_cards", { where: { deal_id: dealId, kind: "invoice", status: "accepted" } })).map((c) => int(jtext(c.data.index))));
  if (alsoPaid !== undefined) paid.add(alsoPaid);
  paid.delete(null);
  return paid.size >= n;
}

// ---------- reads and checks ----------
type Locked = { deal: Deal; guard: Stmt };
/** b2b_deal_for(c, deal): the deal, only for its buyer or seller (and not a viewer). */
export async function b2bDealFor(t: Tenant, dealId: string): Promise<Locked> {
  await b2bWriter(t);
  const [d] = await t.selectGlobal<Deal>("b2b_deals", { where: { id: dealId } });
  if (!d) fail("ไม่พบดีลนี้", 404);
  await b2bThreadOf(t, d.thread_id);
  if (t.viewer.companyId !== d.buyer && t.viewer.companyId !== d.seller) fail("ไม่มีสิทธิ์ในดีลนี้", 403);
  return { deal: d, guard: t.guardGlobalStmt("b2b_deals", { id: d.id, stage: d.stage, updated_at: d.updated_at }) };
}
async function lockCard(t: Tenant, id: string): Promise<Card | undefined> {
  return (await t.selectGlobal<Card>("b2b_cards", { where: { id } }))[0];
}
const cardGuard = (t: Tenant, c: Card) => t.guardGlobalStmt("b2b_cards", { id: c.id, status: c.status });
const reasonOf = (r: string | null | undefined) => nullif(left(trim(r ?? ""), 1000));
const isManagerRole = (r: string | null) => r === null || ["owner", "manager"].includes(r);
const cardInsert = (t: Tenant, c: Card) => t.insertGlobalStmt("b2b_cards", c);
const newCard = (t: Tenant, dealId: string, author: string | null, kind: string, data: Data, now: string, extra: Partial<Card> = {}): Card => ({
  id: uuid(),
  deal_id: dealId,
  company_id: t.viewer.companyId,
  author_id: t.viewer.userId,
  author_name: author as string,
  kind,
  rev: 1,
  data,
  status: "open",
  reason: null,
  decided_by: null,
  decided_at: null,
  created_at: now,
  seller_ref: null,
  buyer_ref: null,
  ...extra,
});
const dealUpdate = (t: Tenant, id: string, patch: Partial<Deal>) => t.updateGlobalStmt("b2b_deals", { id }, patch);
const cardUpdate = (t: Tenant, id: string, patch: Partial<Card>) => t.updateGlobalStmt("b2b_cards", { id }, patch);

// ---------- phase 1: request, quotation, decision ----------
/** b2b_deal_request(c, thread, title, data): the buyer asks the other company for a quotation. */
export async function b2bDealRequest(t: Tenant, threadId: string, title: string | null, input: Data | null): Promise<Data> {
  await b2bWriter(t);
  const th = await b2bThreadOf(t, threadId),
    me = t.viewer.companyId;
  const name = trim(title ?? "");
  if (len(name) < 1 || len(name) > 200) fail("ใส่หัวข้องานที่ต้องการ");
  const need = date(nullif(jtext(get(input, "needBy")))),
    budget = numeric(nullif(jtext(get(input, "budget"))));
  if (budget !== null && (budget < 0 || budget > 1e12)) fail("งบประมาณไม่ถูกต้อง");
  const data = { title: name, items: b2bItems(get(input, "items"), false), needBy: need, budget, notes: left(jtext(get(input, "notes")) ?? "", 2000), buyer: await b2bParty(t, me) };
  const now = stamp(),
    author = await feedAuthor(t);
  const d = { id: uuid(), thread_id: th.id, buyer: me, seller: th.company_a === me ? th.company_b : th.company_a, title: name, stage: "request", created_at: now, updated_at: now };
  const c = newCard(t, d.id, author, "request", data, now);
  await t.atomic([t.insertGlobalStmt("b2b_deals", d), cardInsert(t, c), ...cardNoteStmts(t, th.id, c.id, author, "📝 ขอใบเสนอราคา: " + name, now)]);
  return b2bCardJson(c, me);
}

/** b2b_deal_quote(c, thread, deal, title, data): the seller quotes (a new revision replaces the open one). */
export async function b2bDealQuote(t: Tenant, threadId: string, dealId: string | null, title: string | null, input: Data | null): Promise<Data> {
  await b2bWriter(t);
  const th = await b2bThreadOf(t, threadId),
    me = t.viewer.companyId;
  const name = trim(title ?? "");
  if (len(name) < 1 || len(name) > 200) fail("ใส่หัวข้อใบเสนอราคา");
  const inst = b2bInstallments(get(input, "installments"));
  const now = stamp(),
    today = bkkDate(now),
    stmts: Stmt[] = [];
  let d: Deal;
  if (dealId === null || dealId === undefined) {
    d = { id: uuid(), thread_id: th.id, buyer: th.company_a === me ? th.company_b : th.company_a, seller: me, title: name, stage: "quote", accepted_at: null, accepted_by: null, seller_quote: null, seller_project: null, seller_customer: null, buyer_supplier: null, buyer_task: null, created_at: now, updated_at: now };
    stmts.push(t.insertGlobalStmt("b2b_deals", d));
  } else {
    const [x] = await t.selectGlobal<Deal>("b2b_deals", { where: { id: dealId, thread_id: th.id } });
    if (!x) fail("ไม่พบดีลนี้", 404);
    d = x!;
    if (d.seller !== me) fail("เฉพาะผู้ขายส่งใบเสนอราคาได้", 403);
    if (!["request", "quote"].includes(d.stage)) fail("ดีลนี้ปิดไปแล้ว");
    stmts.push(t.guardGlobalStmt("b2b_deals", { id: d.id, stage: d.stage, updated_at: d.updated_at }));
  }
  const items = b2bItems(get(input, "items"), true);
  const sub = fix(items.reduce((s, x) => s + (x.amount as number), 0));
  const disc = numeric(nullif(jtext(get(input, "discount")))) ?? 0;
  if (disc < 0 || disc > sub) fail("ส่วนลดต้องไม่เกินยอดรวม");
  const net = fix(sub - disc),
    mode = nullif(jtext(get(input, "vatMode"))) ?? "excluded";
  if (!["excluded", "included", "none"].includes(mode)) fail("รูปแบบ VAT ไม่ถูกต้อง");
  const vat = mode === "excluded" ? round2(net * 0.07) : mode === "included" ? round2((net * 7) / 107) : 0;
  const total = mode === "excluded" ? fix(net + vat) : net;
  const valid = date(nullif(jtext(get(input, "validUntil")))) ?? addDays(today, 30);
  if (valid < today) fail("วันยืนราคาต้องไม่ใช่วันที่ผ่านมาแล้ว");
  const quotes = dealId ? (await cardsOf(t, d.id)).filter((c) => c.kind === "quote") : [];
  const r = Math.max(0, ...quotes.map((c) => c.rev)) + 1;
  const doc = "QT" + bkkYYMM(now) + "-" + docId(d.id) + (r > 1 ? "-R" + r : "");
  const data = {
    title: name,
    docNo: doc,
    items,
    subtotal: sub,
    discount: disc,
    vatMode: mode,
    vat,
    total,
    validUntil: valid,
    deliverBy: date(nullif(jtext(get(input, "deliverBy")))),
    payTerms: left(jtext(get(input, "payTerms")) ?? "", 300),
    installments: inst,
    notes: left(jtext(get(input, "notes")) ?? "", 2000),
    seller: await b2bParty(t, d.seller),
    buyer: await b2bParty(t, d.buyer),
  };
  const author = await feedAuthor(t);
  const c = newCard(t, d.id, author, "quote", data, now, { rev: r });
  for (const old of quotes.filter((x) => ["open", "change"].includes(x.status))) stmts.push(cardGuard(t, old), cardUpdate(t, old.id, { status: "superseded" }));
  stmts.push(cardInsert(t, c), dealUpdate(t, d.id, { stage: "quote", title: name, updated_at: now }), ...cardNoteStmts(t, th.id, c.id, author, "💰 ใบเสนอราคา" + (r > 1 ? " Rev." + r : "") + ": " + name + " · ฿" + money(total), now));
  await t.atomic(stmts);
  return b2bCardJson(c, me);
}

/** Records of an existing company found by its network link or name (customers of the seller, suppliers of the buyer). */
async function findParty(t: Tenant, companyId: string, kind: string, network: string, name: string | null): Promise<string | null> {
  const rows = (await t.selectGlobal<{ id: string; data: Data }>("entities", { where: { company_id: companyId, kind, archived_at: null } }))
    .map((e) => {
      const nc = jtext(e.data.networkCompanyId),
        n = jtext(e.data.name);
      const byNet = nc === null ? null : nc === network;
      const byName = n === null || name === null ? null : trim(n).toLowerCase() === trim(name).toLowerCase();
      return { id: e.id, byNet, match: byNet === true || byName === true };
    })
    .filter((x) => x.match);
  const rank = (b: boolean | null) => (b === true ? 0 : b === false ? 1 : 2);
  rows.sort((a, b) => rank(a.byNet) - rank(b.byNet));
  return rows[0]?.id ?? null;
}

/** b2b_deal_decide(c, card, decision, reason): the buyer accepts, asks to change, or rejects the latest quotation. */
export async function b2bDealDecide(t: Tenant, cardId: string, decision: string, reason?: string | null): Promise<Data> {
  await b2bWriter(t);
  const me = t.viewer.companyId,
    now = stamp(),
    today = bkkDate(now);
  const c = await lockCard(t, cardId);
  if (!c) fail("ไม่พบใบเสนอราคา", 404);
  const [d] = await t.selectGlobal<Deal>("b2b_deals", { where: { id: c!.deal_id } });
  await b2bThreadOf(t, d.thread_id);
  if (d.buyer !== me) fail("เฉพาะผู้ซื้อตัดสินใจได้", 403);
  if (c!.kind !== "quote") fail("ตัดสินใจได้เฉพาะใบเสนอราคา");
  if (c!.status !== "open" || d.stage !== "quote") fail("ใบเสนอราคานี้ไม่ใช่ฉบับล่าสุดที่รอตัดสินใจแล้ว");
  if (!["accept", "change", "reject"].includes(decision)) fail("ตัวเลือกไม่ถูกต้อง");
  if (["accept", "reject"].includes(decision) && !isManagerRole(await myRole(t))) fail("เฉพาะเจ้าของหรือผู้จัดการตอบรับหรือปฏิเสธใบเสนอราคาได้", 403);
  if (decision === "change" && len(trim(reason ?? "")) < 3) fail("บอกสิ่งที่อยากให้แก้ไขด้วยนะคะ");
  if (decision === "accept") {
    const v = date(jtext(c!.data.validUntil));
    if (v !== null && v < today) fail("ใบเสนอราคาหมดอายุแล้ว ขอให้ผู้ขายส่งฉบับใหม่");
  }
  const who = await feedAuthor(t);
  const card: Card = { ...c!, status: decision === "accept" ? "accepted" : decision === "change" ? "change" : "rejected", reason: reasonOf(reason), decided_by: who, decided_at: now };
  const stmts: Stmt[] = [cardGuard(t, c!), t.guardGlobalStmt("b2b_deals", { id: d.id, stage: d.stage, updated_at: d.updated_at }), cardUpdate(t, c!.id, { status: card.status, reason: card.reason, decided_by: who, decided_at: now })];
  if (decision === "change") {
    stmts.push(dealUpdate(t, d.id, { updated_at: now }), ...cardNoteStmts(t, d.thread_id, c!.id, who, "✏️ ขอแก้ไขใบเสนอราคา Rev." + c!.rev + ": " + trim(reason!), now));
    await t.atomic(stmts);
    return b2bCardJson(card, me);
  }
  if (decision === "reject") {
    const why = nullif(trim(reason ?? ""));
    stmts.push(dealUpdate(t, d.id, { stage: "rejected", updated_at: now }), ...cardNoteStmts(t, d.thread_id, c!.id, who, "❌ ปฏิเสธใบเสนอราคา" + (why === null ? "" : ": " + why), now));
    await t.atomic(stmts);
    return b2bCardJson(card, me);
  }
  // Accepted: each company gets its own records (snapshots of the parties and the quotation).
  const q = c!.data;
  const req = (await cardsOf(t, d.id)).find((x) => x.kind === "request")?.data ?? null;
  const buyerName = jtext(get(q.buyer, "name")),
    sellerName = jtext(get(q.seller, "name"));
  const docNo = jtext(q.docNo),
    total = num(q.total);
  // Seller: customer (found by network company or name), project, quotation (ตอบรับ).
  let cust = await findParty(t, d.seller, "customers", d.buyer, buyerName);
  if (!cust) {
    cust = uuid();
    stmts.push(
      ...(await insertEntityStmts(
        t,
        {
          id: cust,
          company_id: d.seller,
          kind: "customers",
          department: "Sales",
          data: stripNulls({ name: buyerName, type: "นิติบุคคล", status: "active", taxId: nullif(jtext(get(q.buyer, "taxId"))), address: nullif(jtext(get(q.buyer, "address"))), phone: nullif(jtext(get(q.buyer, "phone"))), networkCompanyId: d.buyer, notes: "สร้างจากห้องดีล EliteFlow" }),
        },
        now,
      )),
    );
  }
  const proj = uuid();
  stmts.push(
    ...(await insertEntityStmts(
      t,
      {
        id: proj,
        company_id: d.seller,
        kind: "projects",
        department: "Operations",
        data: stripNulls({
          name: jtext(q.title),
          priority: "normal",
          status: "active",
          startDate: today,
          endDate: jtext(q.deliverBy),
          budget: total,
          customerTarget: buyerName,
          description: cat("งานจาก ", buyerName, " ตามใบเสนอราคา ", docNo, " ที่ตอบรับผ่านห้องดีล EliteFlow"),
          b2bDealId: d.id,
        }),
      },
      now,
    )),
  );
  const items = jsonbType(q.items ?? null) === "array" ? (q.items as unknown[]) : [];
  const quote = uuid();
  stmts.push(
    ...(await insertEntityStmts(
      t,
      {
        id: quote,
        company_id: d.seller,
        kind: "quotations",
        department: "Sales",
        data: stripNulls({
          name: jtext(q.title),
          customerId: cust,
          projectId: proj,
          date: today,
          validUntil: jtext(q.validUntil),
          lines: items.length ? items.map((x) => ({ name: jtext(get(x, "name")), qty: num(get(x, "qty")), price: num(get(x, "price")) })) : null,
          subtotal: num(q.subtotal),
          discount: num(q.discount) === 0 ? null : num(q.discount),
          vatMode: jtext(q.vatMode),
          status: "ตอบรับ",
          notes: cat("ใบเสนอราคา ", docNo, " ตอบรับโดย ", who, " (", buyerName, ") ผ่านห้องดีล EliteFlow"),
          b2bDealId: d.id,
        }),
      },
      now,
    )),
  );
  // Buyer: supplier (found by network company or name) and a follow-up task.
  let sup = await findParty(t, d.buyer, "suppliers", d.seller, sellerName);
  if (!sup) {
    sup = uuid();
    stmts.push(
      ...(await insertEntityStmts(
        t,
        {
          id: sup,
          company_id: d.buyer,
          kind: "suppliers",
          department: "Purchasing",
          data: stripNulls({ name: sellerName, type: "นิติบุคคล", category: "บริการ", status: "active", taxId: nullif(jtext(get(q.seller, "taxId"))), address: nullif(jtext(get(q.seller, "address"))), phone: nullif(jtext(get(q.seller, "phone"))), networkCompanyId: d.seller, notes: "สร้างจากห้องดีล EliteFlow" }),
        },
        now,
      )),
    );
  }
  const task = uuid();
  stmts.push(
    ...(await insertEntityStmts(
      t,
      {
        id: task,
        company_id: d.buyer,
        kind: "tasks",
        department: "Purchasing",
        created_by: t.viewer.userId,
        data: stripNulls({
          name: cat("ติดตามงาน: ", jtext(q.title)),
          department: "Purchasing",
          priority: "normal",
          status: "pending",
          dueDate: jtext(q.deliverBy) ?? jtext(get(req, "needBy")),
          notes: cat("จ้าง ", sellerName, " ยอด ฿", total === null ? null : money(total), " ตามใบเสนอราคา ", docNo, " (ตอบรับโดย ", who, ")"),
          b2bDealId: d.id,
        }),
      },
      now,
    )),
  );
  stmts.push(
    dealUpdate(t, d.id, { stage: "accepted", accepted_at: now, accepted_by: who, seller_customer: cust, seller_project: proj, seller_quote: quote, buyer_supplier: sup, buyer_task: task, updated_at: now }),
    ...cardNoteStmts(t, d.thread_id, c!.id, who, "✅ ตอบรับใบเสนอราคา " + docNo + " · ฿" + money(total ?? 0) + " — ตกลงจ้างงานแล้ว", now),
  );
  await t.atomic(stmts);
  return b2bCardJson(card, me);
}

/** b2b_deal_withdraw(c, card, reason): the sender takes back its quotation, or its request (which ends the deal). */
export async function b2bDealWithdraw(t: Tenant, cardId: string, reason?: string | null): Promise<Data> {
  await b2bWriter(t);
  const me = t.viewer.companyId,
    now = stamp();
  const c = await lockCard(t, cardId);
  if (!c) fail("ไม่พบรายการ", 404);
  const [d] = await t.selectGlobal<Deal>("b2b_deals", { where: { id: c!.deal_id } });
  await b2bThreadOf(t, d.thread_id);
  if (c!.company_id !== me) fail("ถอนได้เฉพาะรายการที่บริษัทคุณส่ง", 403);
  if (!["request", "quote"].includes(d.stage)) fail("ดีลนี้ตกลงหรือปิดไปแล้ว");
  const who = await feedAuthor(t),
    why = nullif(trim(reason ?? ""));
  const stmts: Stmt[] = [cardGuard(t, c!), t.guardGlobalStmt("b2b_deals", { id: d.id, stage: d.stage, updated_at: d.updated_at })];
  if (c!.kind === "quote" && !["open", "change"].includes(c!.status)) fail("ใบเสนอราคานี้ถอนไม่ได้แล้ว");
  const card: Card = { ...c!, status: "withdrawn", reason: reasonOf(reason), decided_by: who, decided_at: now };
  stmts.push(cardUpdate(t, c!.id, { status: "withdrawn", reason: card.reason, decided_by: who, decided_at: now }));
  const cards = await cardsOf(t, d.id);
  if (c!.kind === "quote") {
    stmts.push(
      dealUpdate(t, d.id, { stage: cards.some((x) => x.kind === "request") ? "request" : "cancelled", updated_at: now }),
      ...cardNoteStmts(t, d.thread_id, c!.id, who, "↩️ ถอนใบเสนอราคา Rev." + c!.rev + (why === null ? "" : ": " + why), now),
    );
  } else {
    for (const x of cards.filter((x) => x.kind === "quote" && ["open", "change"].includes(x.status) && x.id !== c!.id)) stmts.push(cardUpdate(t, x.id, { status: "withdrawn" }));
    stmts.push(dealUpdate(t, d.id, { stage: "cancelled", updated_at: now }), ...cardNoteStmts(t, d.thread_id, c!.id, who, "🚫 ยกเลิกคำขอใบเสนอราคา: " + d.title, now));
  }
  await t.atomic(stmts);
  return b2bCardJson(card, me);
}

/** b2b_deals_of(c, thread): the deals of a conversation with their cards, as company c sees them. */
export async function b2bDealsOf(t: Tenant, threadId: string): Promise<Data[]> {
  const th = await b2bThreadOf(t, threadId),
    me = t.viewer.companyId;
  const deals = await t.selectGlobal<Deal>("b2b_deals", { where: { thread_id: th.id }, order: [["created_at", "asc"]] });
  const cards = deals.length ? await t.selectGlobal<Card>("b2b_cards", { where: { deal_id: deals.map((d) => d.id) }, order: [["created_at", "asc"]] }) : [];
  return deals.map((d) => ({
    id: d.id,
    title: d.title,
    stage: d.stage,
    role: d.buyer === me ? "buyer" : "seller",
    accepted_at: d.accepted_at,
    accepted_by: d.accepted_by,
    created_at: d.created_at,
    updated_at: d.updated_at,
    project_id: d.seller === me ? d.seller_project : null,
    quote_id: d.seller === me ? d.seller_quote : null,
    task_id: d.buyer === me ? d.buyer_task : null,
    cards: cards.filter((c) => c.deal_id === d.id).map((c) => b2bCardJson(c, me)),
  }));
}

// ---------- phase 2: work, delivery, invoices, payments, cancelling ----------
/** b2b_deal_progress(c, deal, percent, note): the seller reports progress (with the project's progress). */
export async function b2bDealProgress(t: Tenant, dealId: string, percent: number | null, note: string | null): Promise<Data> {
  const { deal: d, guard } = await b2bDealFor(t, dealId),
    me = t.viewer.companyId,
    now = stamp();
  if (d.seller !== me) fail("เฉพาะผู้รับจ้างอัปเดตงานได้", 403);
  if (!["accepted", "work"].includes(d.stage)) fail("อัปเดตงานได้ระหว่างทำงาน (ก่อนส่งมอบ)");
  if (percent === null || percent === undefined || percent < 0 || percent > 100) fail("ความคืบหน้า 0–100%");
  const text = trim(note ?? "");
  if (len(text) < 1 || len(text) > 2000) fail("เล่าความคืบหน้าสั้น ๆ ด้วยนะคะ");
  const author = await feedAuthor(t);
  const c = newCard(t, d.id, author, "progress", { title: d.title, items: [], percent, notes: text }, now, { status: "accepted" });
  const stmts: Stmt[] = [guard, cardInsert(t, c), dealUpdate(t, d.id, { stage: "work", updated_at: now })];
  if (d.seller_project) stmts.push(...(await setEntityStmts(t, d.seller_project, { progress: percent }, now)));
  stmts.push(...cardNoteStmts(t, d.thread_id, c.id, author, "📸 อัปเดตงาน " + percent + "%: " + left(text, 200), now));
  await t.atomic(stmts);
  return b2bCardJson(c, me);
}

/** b2b_deal_deliver(c, deal, note): the seller hands over the work for the buyer to check. */
export async function b2bDealDeliver(t: Tenant, dealId: string, note: string | null): Promise<Data> {
  const { deal: d, guard } = await b2bDealFor(t, dealId),
    me = t.viewer.companyId,
    now = stamp();
  if (d.seller !== me) fail("เฉพาะผู้รับจ้างส่งมอบงานได้", 403);
  if (!["accepted", "work"].includes(d.stage)) fail("ส่งมอบได้ระหว่างทำงานเท่านั้น");
  const author = await feedAuthor(t),
    text = trim(note ?? "");
  const round = (await cardsOf(t, d.id)).filter((x) => x.kind === "delivery").length + 1;
  const c = newCard(t, d.id, author, "delivery", { title: d.title, items: [], notes: left(text, 2000), round }, now);
  const stmts: Stmt[] = [guard, cardInsert(t, c), dealUpdate(t, d.id, { stage: "delivered", updated_at: now })];
  if (d.seller_project) stmts.push(...(await setEntityStmts(t, d.seller_project, { status: "review", progress: 100 }, now)));
  const short = nullif(left(text, 200));
  stmts.push(...cardNoteStmts(t, d.thread_id, c.id, author, "📦 ส่งมอบงานแล้ว — รอผู้จ้างตรวจรับ" + (short === null ? "" : ": " + short), now));
  await t.atomic(stmts);
  return b2bCardJson(c, me);
}

/** b2b_deal_check(c, card, ok, reason): the buyer accepts the delivered work or asks for a fix. */
export async function b2bDealCheck(t: Tenant, cardId: string, ok: boolean, reason?: string | null): Promise<Data> {
  const c = await lockCard(t, cardId);
  if (!c || c.kind !== "delivery") fail("ไม่พบการส่งมอบงานนี้", 404);
  const { deal: d, guard } = await b2bDealFor(t, c!.deal_id),
    me = t.viewer.companyId,
    now = stamp();
  if (d.buyer !== me) fail("เฉพาะผู้จ้างตรวจรับงานได้", 403);
  if (c!.status !== "open" || d.stage !== "delivered") fail("การส่งมอบนี้ตรวจไปแล้ว");
  if (!ok && len(trim(reason ?? "")) < 3) fail("บอกสิ่งที่ต้องแก้ด้วยนะคะ");
  const who = await feedAuthor(t);
  const card: Card = { ...c!, status: ok ? "accepted" : "change", reason: reasonOf(reason), decided_by: who, decided_at: now };
  const stmts: Stmt[] = [guard, cardGuard(t, c!), cardUpdate(t, c!.id, { status: card.status, reason: card.reason, decided_by: who, decided_at: now })];
  if (ok) {
    const paid = await b2bDealFullyPaid(t, d.id);
    stmts.push(dealUpdate(t, d.id, { stage: paid ? "closed" : "checked", updated_at: now }));
    if (d.seller_project) stmts.push(...(await setEntityStmts(t, d.seller_project, { status: "completed", progress: 100 }, now)));
    if (d.buyer_task) stmts.push(...(await setEntityStmts(t, d.buyer_task, { status: "done" }, now)));
    stmts.push(...cardNoteStmts(t, d.thread_id, c!.id, who, "✅ ตรวจรับงานแล้ว" + (paid ? " — ปิดงานเรียบร้อย" : ""), now));
  } else {
    stmts.push(dealUpdate(t, d.id, { stage: "work", updated_at: now }));
    if (d.seller_project) stmts.push(...(await setEntityStmts(t, d.seller_project, { status: "active" }, now)));
    stmts.push(...cardNoteStmts(t, d.thread_id, c!.id, who, "🔁 ขอแก้งาน: " + left(trim(reason!), 300), now));
  }
  await t.atomic(stmts);
  return b2bCardJson(card, me);
}

/** b2b_deal_invoice(c, deal, index, due): the seller invoices one instalment (the last only after acceptance). */
export async function b2bDealInvoice(t: Tenant, dealId: string, index: number, due?: string | null): Promise<Data> {
  const { deal: d, guard } = await b2bDealFor(t, dealId),
    me = t.viewer.companyId,
    now = stamp(),
    today = bkkDate(now);
  if (d.seller !== me) fail("เฉพาะผู้รับจ้างออกใบแจ้งหนี้ได้", 403);
  if (!["accepted", "work", "delivered", "checked"].includes(d.stage)) fail("ออกใบแจ้งหนี้ได้หลังตกลงจ้างงานเท่านั้น");
  const q = await b2bAcceptedQuote(t, d.id);
  const a = b2bInstallmentAmount(q?.data ?? null, index);
  if (index === a.count - 1 && d.stage !== "checked") fail("งวดสุดท้ายออกได้หลังผู้จ้างตรวจรับงานแล้ว");
  const cards = await cardsOf(t, d.id);
  if (cards.some((x) => x.kind === "invoice" && int(jtext(x.data.index)) === index && ["open", "accepted"].includes(x.status))) fail("งวดนี้ออกใบแจ้งหนี้ไปแล้ว", 409);
  const dueOn = date(due ?? null) ?? addDays(today, 30);
  if (dueOn < today) fail("วันครบกำหนดต้องไม่ใช่วันที่ผ่านมาแล้ว");
  const doc = "IV" + bkkYYMM(now) + "-" + docId(d.id) + "-" + (index + 1);
  const qd = q?.data ?? {};
  const inv = uuid();
  const stmts: Stmt[] = [guard];
  stmts.push(
    ...(await insertEntityStmts(
      t,
      {
        id: inv,
        company_id: d.seller,
        kind: "invoices",
        department: "Finance",
        data: stripNulls({
          name: doc,
          customerId: d.seller_customer,
          date: today,
          dueDate: dueOn,
          subtotal: a.net,
          vat: a.vat > 0 ? 7 : 0,
          total: a.amount,
          status: "issued",
          description: cat(d.title, " — ", a.label, " (", String(a.percent), "%) ตามใบเสนอราคา ", jtext(qd.docNo)),
          b2bDealId: d.id,
        }),
      },
      now,
    )),
  );
  const author = await feedAuthor(t);
  const c = newCard(t, d.id, author, "invoice", { ...a, title: d.title, items: [], docNo: doc, due: dueOn, quoteNo: jtext(qd.docNo), vatMode: jtext(qd.vatMode), seller: qd.seller ?? null, buyer: qd.buyer ?? null }, now, { seller_ref: inv });
  stmts.push(cardInsert(t, c), ...cardNoteStmts(t, d.thread_id, c.id, author, "🧾 ใบแจ้งหนี้ " + a.label + ": ฿" + money(a.amount) + " ครบกำหนด " + ddmmyyyy(dueOn), now));
  await t.atomic(stmts);
  return b2bCardJson(c, me);
}

const METHODS = ["โอนธนาคาร", "เงินสด", "บัตร", "อื่นๆ"];
/** b2b_deal_pay(c, invoice card, data): the buyer reports paying an invoice (with withholding tax on the pre-VAT part). */
export async function b2bDealPay(t: Tenant, cardId: string, input: Data | null): Promise<Data> {
  const i = await lockCard(t, cardId);
  if (!i || i.kind !== "invoice") fail("ไม่พบใบแจ้งหนี้นี้", 404);
  const { deal: d, guard } = await b2bDealFor(t, i!.deal_id),
    me = t.viewer.companyId,
    now = stamp(),
    today = bkkDate(now);
  if (d.buyer !== me) fail("เฉพาะผู้จ้างแจ้งชำระได้", 403);
  if (i!.status !== "open" || d.stage === "cancelled") fail("ใบแจ้งหนี้นี้ชำระแล้วหรือถูกยกเลิก");
  if ((await cardsOf(t, d.id)).some((x) => x.kind === "payment" && x.status === "open" && jtext(x.data.invoice) === i!.id)) fail("แจ้งชำระงวดนี้แล้ว รอผู้รับจ้างยืนยัน", 409);
  const rateText = nullif(jtext(get(input, "whtRate")));
  const rate = numeric(rateText) ?? 0;
  if (![0, 1, 2, 3, 5].includes(rate)) fail("อัตราหัก ณ ที่จ่ายต้องเป็น 0, 1, 2, 3 หรือ 5%");
  const net = num(i!.data.net) as number,
    amount = num(i!.data.amount) as number;
  const wht = round2((net * rate) / 100);
  const paidOn = date(nullif(jtext(get(input, "date")))) ?? today;
  if (paidOn > today) fail("วันที่โอนต้องไม่เป็นวันในอนาคต");
  const method = nullif(jtext(get(input, "method"))) ?? "โอนธนาคาร";
  if (!METHODS.includes(method)) fail("ช่องทางชำระไม่ถูกต้อง");
  const label = jtext(i!.data.label);
  const data = {
    title: d.title,
    items: [],
    invoice: i!.id,
    invoiceNo: jtext(i!.data.docNo),
    label,
    index: int(jtext(i!.data.index)),
    amount,
    net,
    vat: num(i!.data.vat),
    whtRate: rate,
    wht,
    transfer: fix(amount - wht),
    date: paidOn,
    method,
    reference: left(jtext(get(input, "reference")) ?? "", 100),
    notes: left(jtext(get(input, "notes")) ?? "", 1000),
  };
  const author = await feedAuthor(t);
  const c = newCard(t, d.id, author, "payment", data, now);
  const rateShown = rateText === null ? "0" : String(rate);
  await t.atomic([
    guard,
    cardGuard(t, i!),
    cardInsert(t, c),
    ...cardNoteStmts(t, d.thread_id, c.id, author, "💳 แจ้งชำระ " + label + ": โอน ฿" + money(amount - wht) + (wht > 0 ? " (หัก ณ ที่จ่าย " + rateShown + "% ฿" + money(wht) + ")" : "") + " — รอผู้รับจ้างยืนยัน", now),
  ]);
  return b2bCardJson(c, me);
}

/** b2b_deal_receive(c, payment card, ok, reason): the seller confirms the money arrived (receipt, both books) or not. */
export async function b2bDealReceive(t: Tenant, cardId: string, ok: boolean, reason?: string | null): Promise<Data> {
  const p = await lockCard(t, cardId);
  if (!p || p.kind !== "payment") fail("ไม่พบการแจ้งชำระนี้", 404);
  const { deal: d, guard } = await b2bDealFor(t, p!.deal_id),
    me = t.viewer.companyId,
    now = stamp();
  if (d.seller !== me) fail("เฉพาะผู้รับจ้างยืนยันรับเงินได้", 403);
  if (p!.status !== "open") fail("ยืนยันรายการนี้ไปแล้ว");
  const who = await feedAuthor(t),
    label = jtext(p!.data.label);
  if (!ok) {
    if (len(trim(reason ?? "")) < 3) fail("บอกเหตุผลด้วยนะคะ เช่น ยอดยังไม่เข้าบัญชี");
    const card: Card = { ...p!, status: "rejected", reason: left(trim(reason!), 1000), decided_by: who, decided_at: now };
    await t.atomic([guard, cardGuard(t, p!), cardUpdate(t, p!.id, { status: "rejected", reason: card.reason, decided_by: who, decided_at: now }), ...cardNoteStmts(t, d.thread_id, p!.id, who, cat("⚠️ ยังไม่ได้รับเงิน ", label, ": ", left(trim(reason!), 300)) as string, now)]);
    return b2bCardJson(card, me);
  }
  const i = (await lockCard(t, jtext(p!.data.invoice) ?? ""))!;
  const index = int(jtext(p!.data.index));
  const rc = "RC" + bkkYYMM(now) + "-" + docId(d.id) + "-" + ((index as number) + 1);
  const pdate = jtext(p!.data.date),
    amount = num(p!.data.amount),
    wht = num(p!.data.wht) ?? 0,
    vat = num(p!.data.vat) ?? 0;
  const stmts: Stmt[] = [guard, cardGuard(t, p!), cardGuard(t, i)];
  // Seller: the invoice is paid, the money is recorded.
  if (i.seller_ref) stmts.push(...(await setEntityStmts(t, i.seller_ref, { status: "paid", paidAt: pdate, receiptNo: rc }, now)));
  const pay = uuid();
  stmts.push(
    ...(await insertEntityStmts(
      t,
      {
        id: pay,
        company_id: d.seller,
        kind: "payments",
        department: "Finance",
        data: stripNulls({
          name: rc,
          invoiceId: i.seller_ref,
          direction: "income",
          date: pdate,
          amount,
          method: jtext(p!.data.method),
          reference: nullif(jtext(p!.data.reference)),
          // (p.data->>'wht') prints the stored round(…, 2), so always two decimals.
          notes: cat(cat("รับชำระ ", label, " จาก ", jtext(get(i.data.buyer, "name"))), wht > 0 ? " · ถูกหัก ณ ที่จ่าย ฿" + wht.toFixed(2) : ""),
          b2bDealId: d.id,
        }),
      },
      now,
    )),
  );
  // Buyer: the expense (approved, paid by transfer) with the supplier and withholding tax.
  const exp = uuid();
  const whtRate = int(jtext(p!.data.whtRate));
  stmts.push(
    ...(await insertEntityStmts(
      t,
      {
        id: exp,
        company_id: d.buyer,
        kind: "expenses",
        department: "Finance",
        data: stripNulls({
          name: cat(d.title, " — ", label),
          category: "บริการทั่วไป/ฟรีแลนซ์",
          supplierId: d.buyer_supplier,
          payee: jtext(get(i.data.seller, "name")),
          payeeType: "บริษัท / Supplier",
          taxId: nullif(jtext(get(i.data.seller, "taxId"))),
          docType: vat > 0 ? "ใบกำกับภาษีเต็มรูป" : "ใบเสร็จ",
          docNo: rc,
          date: pdate,
          amount,
          vatMode: vat > 0 ? "included" : "none",
          whtRate: whtRate === null ? null : String(whtRate),
          payStatus: "โอนแล้ว",
          status: "approved",
          notes: cat("ห้องดีล EliteFlow: ใบแจ้งหนี้ ", jtext(i.data.docNo), " ใบเสร็จ ", rc),
          b2bDealId: d.id,
        }),
      },
      now,
    )),
  );
  const card: Card = { ...p!, status: "accepted", decided_by: who, decided_at: now, seller_ref: pay, buyer_ref: exp, data: { ...p!.data, receiptNo: rc } };
  stmts.push(cardUpdate(t, p!.id, { status: "accepted", decided_by: who, decided_at: now, seller_ref: pay, buyer_ref: exp, data: card.data }), cardUpdate(t, i.id, { status: "accepted", decided_at: now }));
  const closed = d.stage === "checked" && (await b2bDealFullyPaid(t, d.id, i.kind === "invoice" ? int(jtext(i.data.index)) : undefined));
  stmts.push(dealUpdate(t, d.id, closed ? { stage: "closed", updated_at: now } : { updated_at: now }));
  stmts.push(...cardNoteStmts(t, d.thread_id, p!.id, who, "🧾 ได้รับเงินแล้ว ออกใบเสร็จ " + rc + " ฿" + money(amount ?? 0) + (closed ? " — ปิดงานเรียบร้อย 🎉" : ""), now));
  await t.atomic(stmts);
  return b2bCardJson(card, me);
}

/** b2b_deal_cancel(c, deal, reason): either side asks to cancel an agreed deal; the other side must confirm. */
export async function b2bDealCancel(t: Tenant, dealId: string, reason: string | null): Promise<Data> {
  const { deal: d, guard } = await b2bDealFor(t, dealId),
    me = t.viewer.companyId,
    now = stamp();
  if (!["accepted", "work", "delivered", "checked"].includes(d.stage)) fail("ขอยกเลิกได้เฉพาะงานที่ตกลงจ้างแล้วและยังไม่ปิด");
  if (len(trim(reason ?? "")) < 3) fail("บอกเหตุผลที่ขอยกเลิกด้วยนะคะ");
  const cards = await cardsOf(t, d.id);
  if (cards.some((x) => x.kind === "cancel" && x.status === "open")) fail("มีคำขอยกเลิกที่รออีกฝ่ายตอบอยู่แล้ว", 409);
  const paid = fix(cards.filter((x) => x.kind === "invoice" && x.status === "accepted").reduce((s, x) => s + (num(x.data.amount) as number), 0));
  const author = await feedAuthor(t);
  const c = newCard(t, d.id, author, "cancel", { title: d.title, items: [], notes: left(trim(reason!), 1000), paid }, now);
  await t.atomic([guard, cardInsert(t, c), ...cardNoteStmts(t, d.thread_id, c.id, author, "🛑 ขอยกเลิกงาน: " + left(trim(reason!), 300) + " — รออีกฝ่ายยืนยัน", now)]);
  return b2bCardJson(c, me);
}

/** b2b_deal_cancel_answer(c, card, agree, reason): the other side agrees (the deal and its records are cancelled) or not. */
export async function b2bDealCancelAnswer(t: Tenant, cardId: string, agree: boolean, reason?: string | null): Promise<Data> {
  const c = await lockCard(t, cardId);
  if (!c || c.kind !== "cancel") fail("ไม่พบคำขอยกเลิกนี้", 404);
  const { deal: d, guard } = await b2bDealFor(t, c!.deal_id),
    me = t.viewer.companyId,
    now = stamp();
  if (c!.company_id === me) fail("อีกฝ่ายต้องเป็นผู้ยืนยันการยกเลิก", 403);
  if (c!.status !== "open") fail("ตอบคำขอนี้ไปแล้ว");
  if (agree && !isManagerRole(await myRole(t))) fail("เฉพาะเจ้าของหรือผู้จัดการยืนยันการยกเลิกได้", 403);
  const who = await feedAuthor(t);
  const card: Card = { ...c!, status: agree ? "accepted" : "rejected", reason: reasonOf(reason), decided_by: who, decided_at: now };
  const stmts: Stmt[] = [guard, cardGuard(t, c!), cardUpdate(t, c!.id, { status: card.status, reason: card.reason, decided_by: who, decided_at: now })];
  if (!agree) {
    const why = nullif(left(trim(reason ?? ""), 300));
    stmts.push(...cardNoteStmts(t, d.thread_id, c!.id, who, "▶️ ไม่ยินยอมยกเลิก ทำงานต่อ" + (why === null ? "" : ": " + why), now));
    await t.atomic(stmts);
    return b2bCardJson(card, me);
  }
  // Unpaid invoices and pending payment reports are void; the seller's open invoices are cancelled.
  const cards = await cardsOf(t, d.id);
  for (const x of cards.filter((x) => x.kind === "invoice" && x.status === "open")) if (x.seller_ref) stmts.push(...(await setEntityStmts(t, x.seller_ref, { status: "cancelled" }, now)));
  for (const x of cards.filter((x) => ["invoice", "payment", "delivery"].includes(x.kind) && x.status === "open")) stmts.push(cardUpdate(t, x.id, { status: "withdrawn" }));
  stmts.push(dealUpdate(t, d.id, { stage: "cancelled", updated_at: now }));
  if (d.seller_project) stmts.push(...(await setEntityStmts(t, d.seller_project, { status: "cancelled" }, now)));
  if (d.buyer_task) stmts.push(...(await setEntityStmts(t, d.buyer_task, { status: "done", notes: cat("ยกเลิกงานตามที่ทั้งสองฝ่ายตกลง: ", jtext(c!.data.notes)) }, now)));
  const paid = num(c!.data.paid) as number;
  stmts.push(...cardNoteStmts(t, d.thread_id, c!.id, who, "🛑 ยกเลิกงานแล้ว (ทั้งสองฝ่ายยืนยัน)" + (paid > 0 ? " · มีเงินที่ชำระแล้ว ฿" + money(paid) + " ให้ตกลงคืนกันโดยตรง" : ""), now));
  await t.atomic(stmts);
  return b2bCardJson(card, me);
}
