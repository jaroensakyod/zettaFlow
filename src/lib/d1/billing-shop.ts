// Coins and payments for D1, step for step after buy_module, shop_buy, shop_activate, request_payment,
// confirm_payment, request_topup and confirm_topup. The wallet Postgres locked (FOR UPDATE) is guarded on the balance
// read, so two purchases at once cannot both spend the same coins (the loser gets ConflictError).
// confirm_payment / confirm_topup were granted to service_role only: they take the driver, and the caller must have
// checked the platform admin (platformAdmin(ctx) / PLATFORM_ADMIN_EMAILS) first, as src/lib/platform.ts and coins.ts do.
import { randomUUID } from "node:crypto";
import type { Sql, Stmt } from "./driver";
import type { Tenant } from "./tenant";
import { addDays, addMonths, fail, iso, later, serviceTenant, type Row } from "./billing-util";
import { subscriptionOf } from "./billing-plan";

type Wallet = { company_id: string; balance: number };
const audit = (t: Tenant, action: string, target: string) => t.insertStmt("audit_events", { actor: t.viewer.userId || null, action, target });
const isOwner = (t: Tenant) => t.viewer.role === "owner";
const ownerOrManager = (t: Tenant) => ["owner", "manager"].includes(t.viewer.role);
async function wallet(t: Tenant): Promise<Wallet | null> {
  return (await t.selectInternal<Wallet>("coin_wallets"))[0] ?? null;
}
/** update coin_wallets set balance = balance - n, guarded on the balance read (the FOR UPDATE). */
export function spend(t: Tenant, w: Wallet, coins: number, now: string): Stmt[] {
  // The wallet is the company's only row; matching the balance read makes the update itself the guard as well.
  return [t.guardStmt("coin_wallets", { balance: w.balance }), t.updateStmt("coin_wallets", { balance: w.balance }, { balance: w.balance - coins, updated_at: now })];
}

export type CompanyModule = { company_id: string; module_id: string; price_coins: number; purchased_at: string };
/** buy_module(): the owner buys a department module once, paid in coins. */
export async function buyModule(t: Tenant, moduleId: string): Promise<CompanyModule> {
  if (!isOwner(t)) fail("เฉพาะเจ้าของบริษัท", 403);
  const [m] = await t.selectGlobal<{ id: string; price_coins: number }>("modules", { where: { id: moduleId, active: true } });
  if (!m) fail("ไม่พบโมดูล", 404);
  if ((await t.selectInternal("company_modules", { where: { module_id: moduleId } })).length) fail("ซื้อระบบนี้แล้ว", 409);
  const w = await wallet(t);
  if ((w?.balance ?? 0) < m.price_coins) fail("เหรียญไม่พอ กรุณาเติมเหรียญ");
  const now = iso(),
    stmts: Stmt[] = [];
  if (m.price_coins > 0) stmts.push(...spend(t, w!, m.price_coins, now), t.insertStmt("coin_ledger", { delta: -m.price_coins, reason: "purchase", ref: m.id, created_by: t.viewer.userId, created_at: now }));
  stmts.push(t.insertStmt("company_modules", { module_id: m.id, price_coins: m.price_coins, purchased_at: now }), audit(t, "module_purchased", m.id));
  await t.atomic(stmts);
  return (await t.selectInternal<CompanyModule>("company_modules", { where: { module_id: m.id } }))[0];
}

type ShopItem = { id: string; kind: string; price_coins: number; period: "once" | "month" };
export type CompanyShopItem = { company_id: string; item_id: string; kind: string; price_coins: number; bought_at: string; expires_at: string | null };
/** shop_buy(): owners and managers buy a character, theme or system with coins (monthly items extend 30 days). */
export async function shopBuy(t: Tenant, itemId: string): Promise<CompanyShopItem> {
  if (!ownerOrManager(t)) fail("เฉพาะเจ้าของหรือผู้จัดการ", 403);
  const [i] = await t.selectGlobal<ShopItem>("shop_items", { where: { id: itemId, active: true } });
  if (!i) fail("ไม่พบสินค้า", 404);
  if (i.price_coins === 0) fail("รายการนี้ใช้ได้ฟรีอยู่แล้ว");
  const [o] = await t.selectInternal<CompanyShopItem>("company_shop_items", { where: { item_id: itemId } });
  if (o && i.period === "once") fail("ซื้อรายการนี้แล้ว", 409);
  const w = await wallet(t);
  if ((w?.balance ?? 0) < i.price_coins) fail("เหรียญไม่พอ กรุณาเติมเหรียญ");
  const now = iso();
  const stmts: Stmt[] = [...spend(t, w!, i.price_coins, now), t.insertStmt("coin_ledger", { delta: -i.price_coins, reason: "purchase", ref: "shop:" + i.id, created_by: t.viewer.userId, created_at: now })];
  if (o)
    // on conflict: price_coins = excluded, bought_at = now(), expires_at = greatest(coalesce(expires_at, now()), now()) + 30 days
    stmts.push(
      t.guardStmt("company_shop_items", { item_id: o.item_id, expires_at: o.expires_at }),
      t.updateStmt("company_shop_items", { item_id: o.item_id }, { price_coins: i.price_coins, bought_at: now, expires_at: addDays(later(o.expires_at ?? now, now), 30) }),
    );
  else stmts.push(t.insertStmt("company_shop_items", { item_id: i.id, kind: i.kind, price_coins: i.price_coins, bought_at: now, expires_at: i.period === "month" ? addDays(now, 30) : null }));
  stmts.push(audit(t, "shop_purchased", i.id));
  await t.atomic(stmts);
  return (await t.selectInternal<CompanyShopItem>("company_shop_items", { where: { item_id: i.id } }))[0];
}

export type ShopSettings = { company_id: string; theme: string | null; character: string | null; updated_by: string | null; updated_at: string };
/** shop_activate(): owners and managers switch the company's theme or character (free ones, or ones bought). */
export async function shopActivate(t: Tenant, kind: string, itemId: string): Promise<ShopSettings> {
  if (!ownerOrManager(t)) fail("เฉพาะเจ้าของหรือผู้จัดการ", 403);
  if (!["theme", "character"].includes(kind)) fail("ประเภทไม่ถูกต้อง");
  const [i] = await t.selectGlobal<ShopItem>("shop_items", { where: { id: itemId, kind, active: true } });
  if (!i) fail("ไม่พบสินค้า", 404);
  if (i.price_coins > 0 && !(await t.selectInternal("company_shop_items", { where: { item_id: itemId } })).length) fail("ยังไม่ได้ซื้อรายการนี้");
  const now = iso();
  await t.atomic([
    t.upsertStmt("company_shop_settings", { theme: kind === "theme" ? itemId : null, character: kind === "character" ? itemId : null, updated_by: t.viewer.userId, updated_at: now }, ["company_id"], [kind, "updated_by", "updated_at"]),
    audit(t, "shop_activated", kind + ":" + itemId),
  ]);
  return (await t.selectInternal<ShopSettings>("company_shop_settings"))[0];
}

export type BillingPayment = { id: string; company_id: string; plan: string; cycle: string; amount: number; attachment_id: string | null; slip: Row; slip_ref: string | null; status: string; note: string | null; created_by: string | null; created_at: string; decided_at: string | null; addons: string[]; extra_users: number };
const cents = (n: number) => Math.round(Number(n) * 100);
/** request_payment(): the owner pays for a plan by bank transfer and sends the slip; a platform admin confirms it. */
export async function requestPayment(t: Tenant, plan: string, cycle: string, attachmentId: string | null, slip: Row | null, ref: string | null, addons: string[] | null = [], extraUsers: number | null = 0): Promise<BillingPayment> {
  if (!isOwner(t)) fail("เฉพาะเจ้าของบริษัท", 403);
  const [p] = await t.selectGlobal<{ id: string; monthly: number; yearly: number }>("plans", { where: { id: plan } });
  if (!p || !["monthly", "yearly"].includes(cycle)) fail("แพ็กเกจไม่ถูกต้อง");
  const list = addons ?? [];
  const catalogue = await t.selectGlobal<{ id: string; monthly: number; per_unit: boolean }>("addons");
  if (list.some((a) => !catalogue.some((x) => x.id === a && !x.per_unit))) fail("Add-on ไม่ถูกต้อง");
  const extra = extraUsers ?? 0;
  if (extra < 0 || extra > 1000) fail("จำนวนผู้ใช้เพิ่มไม่ถูกต้อง");
  if (ref !== null && ref !== undefined && (await t.selectGlobal("billing_payments", { where: { slip_ref: ref }, limit: 1 })).length) fail("สลิปนี้ถูกใช้แล้ว", 409);
  const months = cycle === "yearly" ? 10 : 1; // yearly = 2 months free, add-ons included
  const base = cents(cycle === "yearly" ? p!.yearly : p!.monthly);
  const perUser = catalogue.find((x) => x.id === "extra_user");
  const extraCents = catalogue.filter((x) => list.includes(x.id)).reduce((s, x) => s + cents(x.monthly), 0) * months + cents(perUser?.monthly ?? 0) * extra * months;
  // round((base + extra) * 1.07, 2) in exact integer cents, half away from zero like numeric.
  const amount = Math.floor(((base + extraCents) * 107 + 50) / 100) / 100;
  const id = randomUUID(),
    now = iso();
  await t.atomic([
    t.insertStmt("billing_payments", { id, plan, cycle, amount, attachment_id: attachmentId, slip: slip ?? {}, slip_ref: ref ?? null, created_by: t.viewer.userId, created_at: now, addons: list, extra_users: extra }),
    audit(t, "payment_requested", id),
  ]);
  return (await t.selectInternal<BillingPayment>("billing_payments", { where: { id } }))[0];
}

/** confirm_payment() (service role): verify or reject a pending payment; verifying starts or extends the plan. */
export async function confirmPayment(sql: Sql, id: string, status: string, note: string | null = null): Promise<void> {
  const [b] = await serviceTenant(sql).selectGlobal<BillingPayment>("billing_payments", { where: { id } });
  if (!b || b.status !== "pending" || !["verified", "rejected"].includes(status)) fail("รายการไม่ถูกต้อง");
  const t = serviceTenant(sql, b!.company_id),
    now = iso();
  const stmts: Stmt[] = [t.guardStmt("billing_payments", { id, status: "pending" }), t.updateStmt("billing_payments", { id }, { status, note, decided_at: now })];
  if (status === "verified") {
    const s = await subscriptionOf(t, b!.company_id);
    if (s) {
      const from = later(s.current_period_end ?? now, now);
      stmts.push(
        t.guardStmt("subscriptions", { updated_at: s.updated_at }),
        t.updateStmt("subscriptions", { company_id: b!.company_id }, { plan: b!.plan, cycle: b!.cycle, status: "active", addons: b!.addons, extra_users: b!.extra_users, current_period_end: b!.cycle === "yearly" ? addMonths(from, 12) : addMonths(from, 1), updated_at: now }),
      );
    }
  }
  await t.atomic(stmts);
}

export type CoinTopup = { id: string; company_id: string; coins: number; amount: number; attachment_id: string | null; slip: Row; slip_ref: string | null; status: string; note: string | null; created_by: string | null; created_at: string; decided_at: string | null };
/** request_topup(): the owner buys a coin pack by bank transfer (one slip, one use — also across plan payments). */
export async function requestTopup(t: Tenant, coins: number, attachmentId: string | null, slip: Row | null, ref: string | null): Promise<CoinTopup> {
  if (!isOwner(t)) fail("เฉพาะเจ้าของบริษัท", 403);
  const [k] = await t.selectGlobal<{ coins: number; price: number }>("coin_packs", { where: { coins } });
  if (!k) fail("แพ็กเหรียญไม่ถูกต้อง");
  if (ref === null || ref === undefined || (await t.selectGlobal("coin_topups", { where: { slip_ref: ref }, limit: 1 })).length || (await t.selectGlobal("billing_payments", { where: { slip_ref: ref }, limit: 1 })).length)
    fail("สลิปนี้ถูกใช้แล้ว", 409);
  const id = randomUUID();
  await t.atomic([
    t.insertStmt("coin_topups", { id, coins: k!.coins, amount: Number(k!.price), attachment_id: attachmentId, slip: slip ?? {}, slip_ref: ref, created_by: t.viewer.userId, created_at: iso() }),
    audit(t, "coin_topup_requested", id),
  ]);
  return (await t.selectInternal<CoinTopup>("coin_topups", { where: { id } }))[0];
}

/** confirm_topup() (service role): verify (coins land in the wallet, ledger 'topup') or reject a pending top-up. */
export async function confirmTopup(sql: Sql, id: string, status: string, note: string | null = null): Promise<void> {
  const [x] = await serviceTenant(sql).selectGlobal<CoinTopup>("coin_topups", { where: { id } });
  if (!x || x.status !== "pending" || !["verified", "rejected"].includes(status)) fail("รายการไม่ถูกต้อง");
  const t = serviceTenant(sql, x!.company_id),
    now = iso();
  const stmts: Stmt[] = [t.guardStmt("coin_topups", { id, status: "pending" }), t.updateStmt("coin_topups", { id }, { status, note, decided_at: now })];
  if (status === "verified")
    stmts.push(
      t.upsertStmt("coin_wallets", { balance: x!.coins, updated_at: now }, ["company_id"], ["updated_at"], ["balance"]),
      t.insertStmt("coin_ledger", { delta: x!.coins, reason: "topup", ref: x!.id, created_at: now }),
    );
  await t.atomic(stmts);
}
