// Coins (เหรียญ): top up by transfer slip → platform operator confirms → buy department modules once.
// Works in demo mode (JSON store) and on Supabase (RPCs in 0020_coins_modules.sql).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "./supabase/server";
import { demoRead, demoMutate, demoAudit, type DemoState } from "./demo";
import { assert, requireOwner } from "./domain";
import { dbError } from "./data";
import { download } from "./files";
import { decodeQr, parseSlipQr } from "./slip";
import { platformAdmin } from "./platform";
import type { Context } from "./types";

export const coinPacks = [
  { coins: 50, price: 500 },
  { coins: 100, price: 900 },
  { coins: 200, price: 1700 },
  { coins: 500, price: 4000 },
];
export type Module = { id: string; department: string; name: string; description: string; price_coins: number; features: string[]; view: string };
// Mirrors the seed in 0020_coins_modules.sql; `view` is where the department opens in the workspace.
export const moduleCatalog: Module[] = [
  { id: "accounting", department: "Finance", name: "ระบบบัญชี", description: "บันทึกค่าใช้จ่ายด้วย AI อ่านใบเสร็จ ภาษีซื้อ และหัก ณ ที่จ่าย", price_coins: 100, features: ["บันทึกรายรับ-รายจ่าย", "AI อ่านใบเสร็จ", "รายงานภาษี"], view: "expenses" },
  { id: "marketing", department: "Marketing", name: "ระบบ Marketing", description: "วางแผนแคมเปญ งบประมาณ ROI และกลุ่มลูกค้า", price_coins: 100, features: ["จัดการแคมเปญ", "วิเคราะห์ ROI", "Customer Segment"], view: "campaigns" },
  { id: "hr", department: "HR", name: "ระบบ HR", description: "ข้อมูลพนักงาน วันลา และเงินเดือน", price_coins: 100, features: ["ข้อมูลพนักงาน", "ระบบการลา", "คำนวณเงินเดือน"], view: "employees" },
  { id: "it", department: "IT", name: "ระบบ IT", description: "ทรัพย์สินไอทีและแจ้งปัญหา", price_coins: 100, features: ["ทะเบียนอุปกรณ์", "Ticket แจ้งซ่อม"], view: "assets" },
  { id: "customer_service", department: "Customer Service", name: "ระบบบริการลูกค้า", description: "รับเรื่องและติดตามการแก้ไขให้ลูกค้า", price_coins: 100, features: ["Ticket ลูกค้า", "ติดตามการแก้ไข"], view: "tickets" },
  { id: "data", department: "Data", name: "ระบบ DATA", description: "วิเคราะห์ข้อมูลและรายงานข้ามแผนก", price_coins: 100, features: ["Dashboard", "Export รายงาน"], view: "reports" },
  { id: "legal", department: "Legal", name: "ระบบกฎหมาย", description: "นิติกรรม สัญญา และวันครบกำหนด", price_coins: 100, features: ["ทะเบียนสัญญา", "แจ้งเตือนวันหมดอายุ"], view: "contracts" },
  { id: "inventory", department: "Warehouse", name: "ระบบสต็อกสินค้า", description: "จัดการคลัง รับ-จ่าย และจุดสั่งซื้อ", price_coins: 100, features: ["สต็อกสินค้า", "โอนย้ายคลัง", "แจ้งเตือนของใกล้หมด"], view: "products" },
  { id: "event", department: "Event", name: "ระบบ Event", description: "บันทึกอีเวนต์ พื้นที่จัดงาน และ Freelance", price_coins: 100, features: ["ตารางอีเวนต์", "พื้นที่จัดงาน", "Freelance"], view: "events" },
];
const viewOf = (id: string) => moduleCatalog.find((m) => m.id === id)?.view || "dashboard";

export type Topup = { id: string; coins: number; amount: number; slip_ref: string; status: "pending" | "verified" | "rejected"; note?: string | null; created_at: string; company?: string };
type DemoCoins = { coins?: { balance: number; owned: string[]; topups: Topup[]; ledger: { delta: number; reason: string; ref: string; created_at: string }[] } };
// Demo workspace starts with some coins and two departments so the store has something to show.
const demoCoins = (s: DemoState & DemoCoins) => (s.coins ??= { balance: 150, owned: ["accounting", "inventory"], topups: [], ledger: [] });

/** Wallet, store and (for owners) recent top-ups in one call. */
export async function coinStore(ctx: Context) {
  if (ctx.demo) {
    const w = demoCoins((await demoRead()) as DemoState & DemoCoins);
    return {
      balance: w.balance,
      packs: coinPacks,
      modules: moduleCatalog.map((m) => ({ ...m, owned: w.owned.includes(m.id) })),
      topups: ctx.member.role === "owner" ? w.topups.slice(0, 10) : [],
    };
  }
  const sb = await supabaseServer();
  const [w, m, o, t] = await Promise.all([
    sb.from("coin_wallets").select("balance").eq("company_id", ctx.company.id).maybeSingle(),
    sb.from("modules").select("*").order("ordinal"),
    sb.from("company_modules").select("module_id").eq("company_id", ctx.company.id),
    ctx.member.role === "owner"
      ? sb.from("coin_topups").select("id,coins,amount,slip_ref,status,note,created_at").eq("company_id", ctx.company.id).order("created_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [w, m, o, t]) dbError(r.error);
  const owned = new Set((o.data || []).map((r: { module_id: string }) => r.module_id));
  return {
    balance: Number(w.data?.balance || 0),
    packs: coinPacks,
    modules: ((m.data || []) as Module[]).map((x) => ({ ...x, view: viewOf(x.id), owned: owned.has(x.id) })),
    topups: (t.data || []) as Topup[],
  };
}

/** Owner sends a transfer slip for a pack; the slip QR must be readable and unused. */
export async function requestTopup(ctx: Context, input: unknown) {
  requireOwner(ctx);
  const { coins, attachmentId } = z.object({ coins: z.number().int(), attachmentId: z.uuid() }).parse(input);
  const pack = coinPacks.find((p) => p.coins === coins);
  assert(pack, "แพ็กเหรียญไม่ถูกต้อง");
  const { file, bytes } = await download(ctx, attachmentId);
  let text: string | null = null;
  try {
    text = decodeQr(bytes, file.mime);
  } catch {
    text = null;
  }
  const qr = text ? parseSlipQr(text) : null;
  assert(qr, "อ่าน QR บนสลิปไม่ได้ กรุณาอัปโหลดรูปสลิป (PNG/JPEG) ที่ไม่ถูกครอป");
  const slip = { transRef: qr.transRef, bank: qr.bankName, file: file.name };
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoCoins & { payments?: { slip_ref: string | null }[] }) => {
      const w = demoCoins(s);
      assert(!w.topups.some((t) => t.slip_ref === qr.transRef) && !s.payments?.some((p) => p.slip_ref === qr.transRef), "สลิปนี้ถูกใช้แล้ว");
      const t: Topup = { id: randomUUID(), coins, amount: pack.price, slip_ref: qr.transRef, status: "pending", created_at: new Date().toISOString() };
      w.topups.unshift(t);
      demoAudit(s, "coin_topup_requested", t.id);
      return t;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("request_topup", { p_company: ctx.company.id, p_coins: coins, p_attachment: attachmentId, p_slip: slip, p_ref: qr.transRef });
  dbError(error);
  return data;
}

export async function pendingTopups(ctx: Context): Promise<Topup[]> {
  assert(platformAdmin(ctx), "เฉพาะผู้ดูแลแพลตฟอร์ม", 403);
  if (ctx.demo) {
    const s = (await demoRead()) as DemoState & DemoCoins;
    return demoCoins(s).topups.filter((t) => t.status === "pending").map((t) => ({ ...t, company: s.company.name }));
  }
  const { data, error } = await supabaseAdmin().from("coin_topups").select("id,coins,amount,slip_ref,status,created_at,companies(name)").eq("status", "pending").order("created_at").limit(100);
  dbError(error);
  return ((data || []) as unknown as (Topup & { companies?: { name: string } | null })[]).map(({ companies, ...t }) => ({ ...t, company: companies?.name }));
}

export async function confirmTopup(ctx: Context, id: string, status: "verified" | "rejected", note?: string) {
  assert(platformAdmin(ctx), "เฉพาะผู้ดูแลแพลตฟอร์ม", 403);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoCoins) => {
      const w = demoCoins(s);
      const t = w.topups.find((t) => t.id === id && t.status === "pending");
      assert(t, "รายการไม่ถูกต้อง");
      t.status = status;
      t.note = note || null;
      if (status === "verified") {
        w.balance += t.coins;
        w.ledger.unshift({ delta: t.coins, reason: "topup", ref: t.id, created_at: new Date().toISOString() });
      }
      demoAudit(s, "coin_topup_" + status, id);
    });
  const { error } = await supabaseAdmin().rpc("confirm_topup", { p_id: id, p_status: status, p_note: note || null });
  dbError(error);
}

/** Owner buys a module once; coins are deducted atomically. */
export async function buyModule(ctx: Context, moduleId: string) {
  requireOwner(ctx);
  const m = moduleCatalog.find((x) => x.id === moduleId);
  assert(m, "ไม่พบโมดูล", 404);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoCoins) => {
      const w = demoCoins(s);
      assert(!w.owned.includes(m.id), "ซื้อระบบนี้แล้ว");
      assert(w.balance >= m.price_coins, "เหรียญไม่พอ กรุณาเติมเหรียญ");
      w.balance -= m.price_coins;
      w.owned.push(m.id);
      w.ledger.unshift({ delta: -m.price_coins, reason: "purchase", ref: m.id, created_at: new Date().toISOString() });
      demoAudit(s, "module_purchased", m.id);
      return { module_id: m.id };
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("buy_module", { p_company: ctx.company.id, p_module: m.id });
  dbError(error);
  return data;
}
