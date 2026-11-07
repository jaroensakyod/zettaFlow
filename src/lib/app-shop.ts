// EliteFlow App Shop: AI characters and themes (buy once) and business-type systems (monthly), paid with coins.
// Works in demo mode (JSON store) and on Supabase (RPCs shop_buy / shop_activate in 0044_app_shop.sql).
import { z } from "zod";
import { supabaseServer } from "./supabase/server";
import { demoRead, demoMutate, demoAudit, type DemoState } from "./demo";
import { assert } from "./domain";
import { dbError } from "./data";
import { coinStore, moduleCatalog } from "./coins";
import type { Context } from "./types";

export type ShopKind = "character" | "theme" | "system";
export type ShopItem = {
  id: string;
  kind: ShopKind;
  name: string;
  subtitle: string;
  description: string;
  price_coins: number;
  period: "once" | "month";
  features: string[];
  /** "ยอดนิยม" ribbon. */
  popular?: boolean;
  /** Systems: length of the demo video shown on the cover. */
  duration?: string;
  /** lucide icon name (systems) */
  icon?: string;
  /** Characters: how the assistant talks. */
  voice?: string;
};

// Mirrors the seed in 0044_app_shop.sql; the database price is the one charged.
export const shopCatalog: ShopItem[] = [
  { id: "nong_flow", kind: "character", name: "น้องโฟลว์", subtitle: "ผู้ช่วยประจำ EliteFlow", description: "ผู้ช่วยตัวกลมสีม่วง ใจดี ตอบไว ใช้ได้ฟรีทุกบริษัท", voice: "เป็นกันเอง สุภาพ ใช้คำง่าย", price_coins: 0, period: "once", features: ["ฟรี", "ใช้ได้ทุกแผนก"] },
  { id: "siri_style", kind: "character", name: "Siri Style", subtitle: "เลขาสาวมืออาชีพ", description: "เลขาสาวยิ้มหวาน จัดการตารางงานและสรุปงานให้อย่างเป็นระเบียบ", voice: "นุ่มนวล สุภาพ ลงท้ายด้วยค่ะ", price_coins: 300, period: "once", popular: true, features: ["น้ำเสียงสุภาพ", "เหมาะกับงานบริการลูกค้า"] },
  { id: "elite_style", kind: "character", name: "Elite Style", subtitle: "ที่ปรึกษาธุรกิจ", description: "หนุ่มใส่แว่นสุขุม ตอบตรงประเด็น เน้นตัวเลขและข้อสรุป", voice: "กระชับ มั่นใจ ลงท้ายด้วยครับ", price_coins: 300, period: "once", features: ["สรุปตัวเลขเก่ง", "เหมาะกับผู้บริหาร"] },
  { id: "neo_anime", kind: "character", name: "Neo Anime", subtitle: "สาวอนิเมะหูแมว", description: "สาวผมชมพูใส่หูฟังหูแมว สดใส ให้กำลังใจทีมทุกวัน", voice: "สดใส ร่าเริง มีอีโมจิ", price_coins: 250, period: "once", features: ["สไตล์อนิเมะ", "ทีมสายครีเอทีฟชอบ"] },
  { id: "nova_anime", kind: "character", name: "Nova Anime", subtitle: "หนุ่มอนิเมะผมเงิน", description: "หนุ่มผมเงินสุดคูล ทำงานไว พูดน้อยแต่ได้งาน", voice: "คูล สั้น ได้ใจความ", price_coins: 250, period: "once", features: ["สไตล์อนิเมะ", "ตอบสั้นกระชับ"] },
  { id: "flow_dog", kind: "character", name: "Flow Dog", subtitle: "ชิบะสายลุย", description: "น้องหมาชิบะใส่ฮู้ดม่วง ขี้เล่น พร้อมวิ่งตามงานให้ทุกเรื่อง", voice: "ขี้เล่น อบอุ่น", price_coins: 200, period: "once", features: ["น่ารักเป็นกันเอง", "เหมาะกับร้านค้า"] },
  { id: "mochi_cat", kind: "character", name: "Mochi Cat", subtitle: "แมวขาวนุ่มนิ่ม", description: "แมวขาวตัวกลมยิ้มง่าย ใจเย็น ช่วยเตือนงานแบบไม่กดดัน", voice: "ใจเย็น อ่อนโยน", price_coins: 200, period: "once", features: ["อ่อนโยน", "เหมาะกับคลินิก/สปา"] },
  { id: "elitebot", kind: "character", name: "EliteBot", subtitle: "หุ่นยนต์ผู้ช่วย", description: "หุ่นยนต์สีขาวจอฟ้า แม่นยำ ตรวจตัวเลขและเอกสารละเอียด", voice: "เป็นทางการ แม่นยำ", price_coins: 150, period: "once", features: ["ตรวจตัวเลขละเอียด", "เหมาะกับบัญชี/IT"] },
  { id: "flow_dragon", kind: "character", name: "Flow Dragon", subtitle: "มังกรน้อยนำโชค", description: "มังกรม่วงตัวน้อย กล้าหาญ พาธุรกิจพุ่งทะยาน", voice: "ฮึกเหิม ให้กำลังใจ", price_coins: 250, period: "once", features: ["นำโชคค้าขาย", "สีสันโดดเด่น"] },
  { id: "modern_purple", kind: "theme", name: "Modern Purple", subtitle: "ธีมมาตรฐาน", description: "ม่วงทันสมัย สบายตา ธีมเริ่มต้นของ EliteFlow", price_coins: 0, period: "once", features: ["ฟรี"] },
  { id: "luxury_black_gold", kind: "theme", name: "Luxury Black Gold", subtitle: "หรูหรา พรีเมียม", description: "ดำ-ทอง สำหรับแบรนด์หรู โรงแรม และร้านพรีเมียม", price_coins: 199, period: "once", features: ["เมนูสีดำ", "ปุ่มสีทอง"] },
  { id: "clean_minimal", kind: "theme", name: "Clean Minimal", subtitle: "สะอาด เรียบง่าย", description: "ฟ้าอ่อนเรียบง่าย อ่านง่ายทั้งวัน", price_coins: 199, period: "once", features: ["โทนฟ้า", "เรียบง่าย"] },
  { id: "soft_pink", kind: "theme", name: "Soft Pink", subtitle: "อ่อนหวาน เป็นมิตร", description: "ชมพูพาสเทล เหมาะกับคลินิกความงาม ร้านเค้ก และแฟชั่น", price_coins: 199, period: "once", features: ["โทนชมพู", "อบอุ่น"] },
  { id: "clinic_medical", kind: "theme", name: "Clinic Medical", subtitle: "สะอาด น่าเชื่อถือ", description: "เขียวมิ้นต์สำหรับคลินิกและโรงพยาบาล", price_coins: 199, period: "once", features: ["โทนมิ้นต์", "ดูสะอาด"] },
  { id: "real_estate_theme", kind: "theme", name: "Real Estate", subtitle: "มั่นคง มืออาชีพ", description: "น้ำเงินเข้มสำหรับอสังหาริมทรัพย์และงานก่อสร้าง", price_coins: 199, period: "once", features: ["โทนน้ำเงิน", "มืออาชีพ"] },
  { id: "condo_rental", kind: "system", name: "ระบบบริหารคอนโด / ปล่อยเช่า", subtitle: "คอนโด · อพาร์ตเมนต์ · ปล่อยเช่า", description: "บริหารทรัพย์สิน สัญญาเช่า ผู้เช่า และการชำระเงิน", icon: "Building2", duration: "01:24", price_coins: 1200, period: "month", popular: true, features: ["จัดการห้อง / สัญญาเช่า", "ลูกค้า / ผู้เช่า / การชำระเงิน", "แจ้งซ่อม / บำรุงรักษา", "รายงานรายได้และค่าใช้จ่าย"] },
  { id: "beauty_clinic", kind: "system", name: "ระบบบริหารคลินิกความงาม", subtitle: "คลินิก · สปา · เวชสำอาง", description: "จัดการคิว ประวัติลูกค้า คอร์ส และสต็อกเวชภัณฑ์", icon: "Sparkles", duration: "01:38", price_coins: 1500, period: "month", features: ["นัดหมาย / คิวบริการ", "ประวัติลูกค้า (CRM)", "แพ็กเกจ / คอร์ส / สมาชิก", "สต็อกเวชภัณฑ์ / สินค้า"] },
  { id: "restaurant_cafe", kind: "system", name: "ระบบบริหารร้านอาหารและคาเฟ่", subtitle: "ร้านอาหาร · คาเฟ่ · เดลิเวอรี่", description: "สั่งอาหาร โต๊ะ สต็อกวัตถุดิบ POS และสมาชิก", icon: "UtensilsCrossed", duration: "01:16", price_coins: 900, period: "month", features: ["จัดการเมนู / สต็อกวัตถุดิบ", "ออเดอร์ / โต๊ะ / คิว", "การขาย (POS) และรายงาน", "ลูกค้าสมาชิก / โปรโมชั่น"] },
  { id: "medical_clinic", kind: "system", name: "ระบบบริหารคลินิกการแพทย์", subtitle: "คลินิกทั่วไป · เฉพาะทาง · Wellness", description: "เวชระเบียน นัดหมาย การรักษา และการเงินคลินิก", icon: "Stethoscope", duration: "01:32", price_coins: 1800, period: "month", features: ["เวชระเบียนผู้ป่วย (EMR)", "นัดหมาย / คิวแพทย์", "การรักษา / ใบสั่งยา", "เบิกประกัน / การชำระเงิน"] },
  { id: "real_estate", kind: "system", name: "ระบบอสังหาริมทรัพย์ (โครงการ)", subtitle: "บ้านจัดสรร · ทาวน์โฮม · ที่ดิน", description: "จัดการโครงการ ลูกค้า การขาย และโอนกรรมสิทธิ์", icon: "House", duration: "01:45", price_coins: 2000, period: "month", features: ["จัดการโครงการ / แปลง", "ลูกค้า / การจอง", "การขาย / สัญญาจะซื้อจะขาย", "โอนกรรมสิทธิ์ / รายงาน"] },
];
export const defaultTheme = "modern_purple";
export const defaultCharacter = "nong_flow";
const MONTH_MS = 30 * 86400000;

export type OwnedItem = { item_id: string; kind: ShopKind; price_coins: number; bought_at: string; expires_at: string | null };
export type ShopActive = { theme: string; character: string };
export type PurchaseRow = { delta: number; reason: string; ref: string; name: string; kind: "module" | ShopKind | "topup" | "other"; created_at: string };
type Ledger = { delta: number; reason: string; ref: string; created_at: string };
type DemoShop = {
  coins?: { balance: number; owned: string[]; topups: unknown[]; ledger: Ledger[] };
  shop?: { owned: OwnedItem[]; theme: string | null; character: string | null };
};
// Same defaults as demoCoins in coins.ts (the demo wallet is shared with module purchases).
const demoCoins = (s: DemoState & DemoShop) => (s.coins ??= { balance: 150, owned: ["accounting", "inventory"], topups: [], ledger: [] });
const demoShop = (s: DemoState & DemoShop) => (s.shop ??= { owned: [], theme: null, character: null });
const canBuy = (ctx: Context) => ctx.member.role === "owner" || ctx.member.role === "manager";

function describe(ref: string): Pick<PurchaseRow, "name" | "kind"> {
  if (ref?.startsWith("shop:")) {
    const i = shopCatalog.find((x) => x.id === ref.slice(5));
    return { name: i?.name || ref.slice(5), kind: i?.kind || "other" };
  }
  const m = moduleCatalog.find((x) => x.id === ref);
  return m ? { name: m.name, kind: "module" } : { name: ref, kind: "other" };
}

/** Active theme and character; any member may read it (the theme applies to everyone). */
export async function shopActive(ctx: Context): Promise<ShopActive> {
  if (ctx.demo) {
    const s = demoShop((await demoRead()) as DemoState & DemoShop);
    return { theme: s.theme || defaultTheme, character: s.character || defaultCharacter };
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.from("company_shop_settings").select("theme,character").eq("company_id", ctx.company.id).maybeSingle();
  dbError(error);
  return { theme: data?.theme || defaultTheme, character: data?.character || defaultCharacter };
}

/** Wallet, department modules, shop items with ownership, the active look and purchase history in one call. */
export async function shopState(ctx: Context) {
  const store = await coinStore(ctx);
  let owned: OwnedItem[] = [],
    history: Ledger[] = [];
  if (ctx.demo) {
    const s = (await demoRead()) as DemoState & DemoShop;
    owned = demoShop(s).owned;
    history = canBuy(ctx) ? demoCoins(s).ledger : [];
  } else {
    const sb = await supabaseServer();
    const [o, l] = await Promise.all([
      sb.from("company_shop_items").select("item_id,kind,price_coins,bought_at,expires_at").eq("company_id", ctx.company.id),
      canBuy(ctx)
        ? sb.from("coin_ledger").select("delta,reason,ref,created_at").eq("company_id", ctx.company.id).order("created_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [o, l]) dbError(r.error);
    owned = (o.data || []) as OwnedItem[];
    history = (l.data || []) as Ledger[];
  }
  const active = await shopActive(ctx);
  const now = Date.now();
  const byId = new Map(owned.map((o) => [o.item_id, o]));
  return {
    balance: store.balance,
    role: ctx.member.role,
    canBuy: canBuy(ctx),
    canBuyModules: ctx.member.role === "owner",
    modules: store.modules,
    active,
    items: shopCatalog.map((i) => {
      const o = byId.get(i.id);
      const live = i.price_coins === 0 || (!!o && (!o.expires_at || new Date(o.expires_at).getTime() > now));
      return { ...i, owned: live, bought_at: o?.bought_at || null, expires_at: o?.expires_at || null, active: active.theme === i.id || active.character === i.id };
    }),
    history: history.map((h) => ({ ...h, ...describe(h.ref) })) as PurchaseRow[],
  };
}

/** Owner/manager buys an item; coins are deducted atomically. Monthly systems renew for 30 more days. */
export async function shopBuy(ctx: Context, itemId: string) {
  assert(canBuy(ctx), "เฉพาะเจ้าของหรือผู้จัดการ", 403);
  const i = shopCatalog.find((x) => x.id === itemId);
  assert(i, "ไม่พบสินค้า", 404);
  assert(i.price_coins > 0, "รายการนี้ใช้ได้ฟรีอยู่แล้ว");
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoShop) => {
      const w = demoCoins(s),
        shop = demoShop(s);
      const o = shop.owned.find((x) => x.item_id === i.id);
      assert(!(o && i.period === "once"), "ซื้อรายการนี้แล้ว");
      assert(w.balance >= i.price_coins, "เหรียญไม่พอ กรุณาเติมเหรียญ");
      w.balance -= i.price_coins;
      const at = new Date().toISOString();
      w.ledger.unshift({ delta: -i.price_coins, reason: "purchase", ref: "shop:" + i.id, created_at: at });
      const from = Math.max(Date.now(), o?.expires_at ? new Date(o.expires_at).getTime() : 0);
      const row: OwnedItem = { item_id: i.id, kind: i.kind, price_coins: i.price_coins, bought_at: at, expires_at: i.period === "month" ? new Date(from + MONTH_MS).toISOString() : null };
      shop.owned = [...shop.owned.filter((x) => x.item_id !== i.id), row];
      demoAudit(s, "shop_purchased", i.id);
      return row;
    });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("shop_buy", { p_company: ctx.company.id, p_item: i.id });
  dbError(error);
  return data;
}

const activateInput = z.object({ kind: z.enum(["theme", "character"]), item: z.string().regex(/^[a-z_]{1,40}$/) });
/** Owner/manager switches the active theme or character (free default or owned only). */
export async function shopActivate(ctx: Context, input: unknown) {
  assert(canBuy(ctx), "เฉพาะเจ้าของหรือผู้จัดการ", 403);
  const { kind, item } = activateInput.parse(input);
  const i = shopCatalog.find((x) => x.id === item && x.kind === kind);
  assert(i, "ไม่พบสินค้า", 404);
  if (ctx.demo)
    return demoMutate((s: DemoState & DemoShop) => {
      const shop = demoShop(s);
      assert(i.price_coins === 0 || shop.owned.some((x) => x.item_id === i.id), "ยังไม่ได้ซื้อรายการนี้");
      shop[kind] = i.id;
      demoAudit(s, "shop_activated", kind + ":" + i.id);
      return { theme: shop.theme || defaultTheme, character: shop.character || defaultCharacter };
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("shop_activate", { p_company: ctx.company.id, p_kind: kind, p_item: i.id });
  dbError(error);
  return shopActive(ctx);
}
