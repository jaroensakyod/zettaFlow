"use client";
// EliteFlow App Shop (Canva pages 10–11): the แผนก (Departments) page and the App Shop page share a left nav.
// Department systems are bought once (/coins/buy); characters/themes once and business systems monthly (/shop/buy).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bot, Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, Coins, Crown, Eye, Flame, Gem, History, House, LayoutDashboard,
  LayoutGrid, List, Lock, Palette, Play, Plus, Puzzle, ReceiptText, Search, Settings, ShoppingCart, Sparkles, Star, Stethoscope,
  Store, UsersRound, UtensilsCrossed, type LucideIcon,
} from "lucide-react";
import type { Context } from "@/lib/types";
import type { ShopItem, PurchaseRow } from "@/lib/app-shop";
import { departmentMenu, type DepartmentMenu } from "@/lib/departments";
import { api, money, displayDate, Modal } from "./shared";
import { TopupDialog } from "./coins";
import { MenuIcon } from "./dept-menu";
import { FlowMascot } from "./mascot";
import { themePalettes } from "./theme-apply";

type Item = ShopItem & { owned: boolean; active: boolean; bought_at: string | null; expires_at: string | null };
type StoreModule = { id: string; department: string; name: string; description: string; price_coins: number; features: string[]; view: string; owned: boolean };
type ShopData = {
  balance: number;
  role: string;
  canBuy: boolean;
  canBuyModules: boolean;
  modules: StoreModule[];
  active: { theme: string; character: string };
  items: Item[];
  history: PurchaseRow[];
};
type Nav = (view: string) => void;
type Notify = (s: string) => void;

/** Shop state; refreshed by "ef:shop" (shop changes) and "ef:coins" (top-ups, module purchases). */
function useShop() {
  const [data, setData] = useState<ShopData | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      api("/shop")
        .then((d) => {
          setData(d);
          setError("");
        })
        .catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => {
    load();
    window.addEventListener("ef:shop", load);
    window.addEventListener("ef:coins", load);
    return () => {
      window.removeEventListener("ef:shop", load);
      window.removeEventListener("ef:coins", load);
    };
  }, [load]);
  return { data, error };
}
const refreshAll = () => {
  window.dispatchEvent(new Event("ef:coins"));
  window.dispatchEvent(new Event("ef:shop"));
};

// Department → module that unlocks it. Departments without a module (ฝ่ายขาย, งานทั่วไป) come with every plan.
const moduleOfDept: Record<string, string> = { warehouse: "inventory" };
const moduleIdOf = (d: DepartmentMenu, modules: StoreModule[]) => {
  const id = moduleOfDept[d.id] || d.id;
  return modules.find((m) => m.id === id);
};
const deptActive = (d: DepartmentMenu, modules: StoreModule[]) => moduleIdOf(d, modules)?.owned ?? true;

/* ---------------------------------------------------------------- illustrations */

const charBg: Record<string, string> = {
  nong_flow: "linear-gradient(160deg,#efe8ff,#e2f0ff)",
  siri_style: "linear-gradient(160deg,#ffe6ee,#f3e8ff)",
  elite_style: "linear-gradient(160deg,#e6ecf8,#f2f4fa)",
  neo_anime: "linear-gradient(160deg,#ffe0ef,#eadfff)",
  nova_anime: "linear-gradient(160deg,#e3e6f5,#d9def0)",
  flow_dog: "linear-gradient(160deg,#fff1df,#efe4ff)",
  mochi_cat: "linear-gradient(160deg,#fbf3f7,#efeaf8)",
  elitebot: "linear-gradient(160deg,#e3f3ff,#eef0ff)",
  flow_dragon: "linear-gradient(160deg,#f1e4ff,#ffe9f6)",
};
const Body = ({ fill }: { fill: string }) => <path d="M24 122 Q26 93 60 90 Q94 93 96 122Z" fill={fill} />;
const Head = ({ skin }: { skin: string }) => (
  <>
    <rect x="53" y="78" width="14" height="15" rx="5" fill={skin} />
    <ellipse cx="60" cy="60" rx="23" ry="25" fill={skin} />
  </>
);
const Face = ({ anime = false, eye = "#2a1f2e" }: { anime?: boolean; eye?: string }) => (
  <>
    {anime ? (
      <>
        <ellipse cx="50" cy="63" rx="4.6" ry="6.2" fill={eye} />
        <ellipse cx="70" cy="63" rx="4.6" ry="6.2" fill={eye} />
        <circle cx="51.6" cy="60.4" r="1.9" fill="#fff" />
        <circle cx="71.6" cy="60.4" r="1.9" fill="#fff" />
      </>
    ) : (
      <>
        <ellipse cx="50" cy="63" rx="2.9" ry="3.7" fill={eye} />
        <ellipse cx="70" cy="63" rx="2.9" ry="3.7" fill={eye} />
        <circle cx="51" cy="61.8" r="1" fill="#fff" />
        <circle cx="71" cy="61.8" r="1" fill="#fff" />
      </>
    )}
    <ellipse cx="43" cy="71" rx="4" ry="2.4" fill="#ff8fab" opacity=".45" />
    <ellipse cx="77" cy="71" rx="4" ry="2.4" fill="#ff8fab" opacity=".45" />
    <path d="M55 73.5 Q60 78 65 73.5" fill="none" stroke="#b5475e" strokeWidth="2" strokeLinecap="round" />
  </>
);
const characterSvg: Record<string, ReactNode> = {
  siri_style: (
    <>
      <path d="M32 58 Q31 29 60 29 Q89 29 88 58 L91 106 Q76 112 60 107 Q44 112 29 106Z" fill="#3b2418" />
      <Body fill="#ffffff" />
      <path d="M50 91 L60 103 L70 91" fill="#f2d0bb" />
      <Head skin="#f6d5c1" />
      <path d="M36 58 Q36 32 60 32 Q84 32 84 58 Q76 44 62 41 Q50 47 36 58Z" fill="#3b2418" />
      <Face />
      <circle cx="37" cy="68" r="2" fill="#ffd166" />
      <circle cx="83" cy="68" r="2" fill="#ffd166" />
    </>
  ),
  elite_style: (
    <>
      <Body fill="#1f2a44" />
      <path d="M48 91 L60 110 L72 91Z" fill="#ffffff" />
      <path d="M57.5 94 L62.5 94 L64 106 L60 111 L56 106Z" fill="#7952dd" />
      <Head skin="#f3d2bd" />
      <path d="M36 57 Q34 30 60 30 Q86 30 84 57 Q81 43 68 40 Q54 45 39 46Z" fill="#1c1c24" />
      <Face />
      <g fill="none" stroke="#1c1c24" strokeWidth="2">
        <rect x="42" y="57" width="15" height="11" rx="4" />
        <rect x="63" y="57" width="15" height="11" rx="4" />
        <path d="M57 61 L63 61" />
      </g>
    </>
  ),
  neo_anime: (
    <>
      <path d="M33 58 Q32 30 60 30 Q88 30 87 58 L89 100 Q74 106 60 102 Q46 106 31 100Z" fill="#ff8fb8" />
      <Body fill="#f7f0ff" />
      <path d="M44 93 Q60 104 76 93" fill="none" stroke="#ff8fb8" strokeWidth="4" />
      <Head skin="#fbe0d0" />
      <path d="M36 58 Q36 32 60 32 Q84 32 84 58 L78 48 L72 54 L66 44 L58 52 L52 44 L46 54 L41 48Z" fill="#ff8fb8" />
      <Face anime eye="#6a3fc9" />
      <path d="M33 54 Q33 22 60 22 Q87 22 87 54" fill="none" stroke="#3a2c52" strokeWidth="5" />
      <path d="M38 34 L37 14 L53 27Z" fill="#3a2c52" />
      <path d="M82 34 L83 14 L67 27Z" fill="#3a2c52" />
      <path d="M41 30 L40.5 20 L48.5 27Z" fill="#ffb3cf" />
      <path d="M79 30 L79.5 20 L71.5 27Z" fill="#ffb3cf" />
      <ellipse cx="35" cy="62" rx="6.5" ry="9.5" fill="#3a2c52" />
      <ellipse cx="85" cy="62" rx="6.5" ry="9.5" fill="#3a2c52" />
    </>
  ),
  nova_anime: (
    <>
      <Body fill="#22222e" />
      <path d="M46 91 L60 100 L74 91 L72 120 L48 120Z" fill="#7952dd" opacity=".85" />
      <Head skin="#f5dccd" />
      <path d="M33 62 L29 42 L40 45 L39 27 L50 36 L56 20 L64 33 L75 22 L77 37 L90 33 L84 50 L88 64 Q82 46 60 44 Q42 46 33 62Z" fill="#cfd5e3" />
      <path d="M40 48 L44 56 L50 47 L55 55 L60 46 L66 55 L71 47 L76 56 L80 48" fill="#cfd5e3" />
      <Face anime eye="#3d6fd6" />
    </>
  ),
  flow_dog: (
    <>
      <path d="M22 122 Q24 88 60 86 Q96 88 98 122Z" fill="#7c4ddb" />
      <ellipse cx="60" cy="62" rx="35" ry="32" fill="#7c4ddb" />
      <path d="M37 46 L34 20 L55 35Z" fill="#e8913a" />
      <path d="M83 46 L86 20 L65 35Z" fill="#e8913a" />
      <path d="M39 40 L37.5 27 L48 35Z" fill="#fff4e6" />
      <path d="M81 40 L82.5 27 L72 35Z" fill="#fff4e6" />
      <ellipse cx="60" cy="62" rx="26" ry="23" fill="#e8913a" />
      <ellipse cx="60" cy="73" rx="16" ry="11" fill="#fff4e6" />
      <ellipse cx="50" cy="59" rx="3" ry="3.8" fill="#2a1f22" />
      <ellipse cx="70" cy="59" rx="3" ry="3.8" fill="#2a1f22" />
      <circle cx="51" cy="58" r="1" fill="#fff" />
      <circle cx="71" cy="58" r="1" fill="#fff" />
      <ellipse cx="60" cy="68.5" rx="3.8" ry="2.6" fill="#2a1f22" />
      <path d="M55 73 Q60 77 65 73" fill="none" stroke="#2a1f22" strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="42" cy="69" rx="3.6" ry="2.2" fill="#ff8fab" opacity=".5" />
      <ellipse cx="78" cy="69" rx="3.6" ry="2.2" fill="#ff8fab" opacity=".5" />
    </>
  ),
  mochi_cat: (
    <>
      <ellipse cx="60" cy="104" rx="31" ry="22" fill="#ffffff" stroke="#ebe4f1" strokeWidth="1.5" />
      <path d="M33 52 L34 26 L54 41Z" fill="#ffffff" stroke="#ebe4f1" strokeWidth="1.5" />
      <path d="M87 52 L86 26 L66 41Z" fill="#ffffff" stroke="#ebe4f1" strokeWidth="1.5" />
      <path d="M37 46 L37.5 33 L48 41Z" fill="#ffc2d1" />
      <path d="M83 46 L82.5 33 L72 41Z" fill="#ffc2d1" />
      <ellipse cx="60" cy="64" rx="31" ry="26" fill="#ffffff" stroke="#ebe4f1" strokeWidth="1.5" />
      <path d="M45 63 Q50 58 55 63" fill="none" stroke="#3a2c3a" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M65 63 Q70 58 75 63" fill="none" stroke="#3a2c3a" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M58 69 L62 69 L60 71.5Z" fill="#ff8fab" />
      <path d="M56 74 Q60 77 64 74" fill="none" stroke="#3a2c3a" strokeWidth="1.6" strokeLinecap="round" />
      <g stroke="#cfc3d8" strokeWidth="1.3" strokeLinecap="round">
        <path d="M30 68 L43 70" />
        <path d="M31 75 L43 73" />
        <path d="M90 68 L77 70" />
        <path d="M89 75 L77 73" />
      </g>
      <ellipse cx="42" cy="72" rx="4" ry="2.4" fill="#ff8fab" opacity=".45" />
      <ellipse cx="78" cy="72" rx="4" ry="2.4" fill="#ff8fab" opacity=".45" />
    </>
  ),
  elitebot: (
    <>
      <rect x="36" y="90" width="48" height="34" rx="14" fill="#f4f6fb" stroke="#dfe3ee" />
      <circle cx="60" cy="104" r="5" fill="#7952dd" />
      <line x1="60" y1="34" x2="60" y2="22" stroke="#9aa3ba" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="20" r="5" fill="#7952dd" />
      <rect x="21" y="52" width="9" height="20" rx="4.5" fill="#7952dd" />
      <rect x="90" y="52" width="9" height="20" rx="4.5" fill="#7952dd" />
      <rect x="27" y="33" width="66" height="56" rx="25" fill="#ffffff" stroke="#dfe3ee" strokeWidth="1.5" />
      <rect x="35" y="43" width="50" height="36" rx="16" fill="#1d2440" />
      <ellipse cx="50" cy="59" rx="5" ry="6.5" fill="#5ad1ff" />
      <ellipse cx="70" cy="59" rx="5" ry="6.5" fill="#5ad1ff" />
      <path d="M53 70 Q60 75 67 70" fill="none" stroke="#5ad1ff" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  flow_dragon: (
    <>
      <path d="M36 84 L8 56 L24 60 L14 42 L42 70Z" fill="#b48cf6" />
      <path d="M84 84 L112 56 L96 60 L106 42 L78 70Z" fill="#b48cf6" />
      <ellipse cx="60" cy="100" rx="27" ry="23" fill="#8a5ae6" />
      <ellipse cx="60" cy="104" rx="15" ry="14" fill="#f3d9ff" />
      <path d="M41 42 L36 20 L52 35Z" fill="#ffd166" />
      <path d="M79 42 L84 20 L68 35Z" fill="#ffd166" />
      <ellipse cx="60" cy="60" rx="28" ry="25" fill="#8a5ae6" />
      <ellipse cx="60" cy="71" rx="14" ry="8.5" fill="#a77ff2" />
      <circle cx="56" cy="70" r="1.4" fill="#4a2a8c" />
      <circle cx="64" cy="70" r="1.4" fill="#4a2a8c" />
      <ellipse cx="49" cy="57" rx="4.6" ry="6" fill="#2a1f55" />
      <ellipse cx="71" cy="57" rx="4.6" ry="6" fill="#2a1f55" />
      <circle cx="50.6" cy="54.6" r="1.8" fill="#fff" />
      <circle cx="72.6" cy="54.6" r="1.8" fill="#fff" />
      <path d="M55 76 Q60 79 65 76" fill="none" stroke="#4a2a8c" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M62 77 L63.5 80.5 L65 77" fill="#fff" />
    </>
  ),
};
/** A character's portrait (inline SVG, no external images). */
export function CharacterArt({ id, size = 96, framed = true }: { id: string; size?: number; framed?: boolean }) {
  const art =
    id === "nong_flow" || !characterSvg[id] ? (
      <FlowMascot size={size * 0.82} />
    ) : (
      <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
        {characterSvg[id]}
      </svg>
    );
  return (
    <span className="as-char-art" style={{ width: size, height: size, background: framed ? charBg[id] || charBg.nong_flow : "transparent" }}>
      {art}
    </span>
  );
}

const systemLook: Record<string, { bg: string; Icon: LucideIcon; color: string }> = {
  condo_rental: { bg: "linear-gradient(135deg,#5b7cfa,#9fb6ff)", Icon: Building2, color: "#4b5fd6" },
  beauty_clinic: { bg: "linear-gradient(135deg,#f58bb3,#ffd1df)", Icon: Sparkles, color: "#d94f86" },
  restaurant_cafe: { bg: "linear-gradient(135deg,#f0913a,#ffd39a)", Icon: UtensilsCrossed, color: "#e0761e" },
  medical_clinic: { bg: "linear-gradient(135deg,#25a89a,#9be3d7)", Icon: Stethoscope, color: "#1c8f83" },
  real_estate: { bg: "linear-gradient(135deg,#3b5ba5,#a7c3ee)", Icon: House, color: "#2f4f9b" },
};
/** Business-system cover: gradient, a skyline of soft shapes and the system's icon. */
function SystemCover({ item, onPlay, small = false }: { item: Item; onPlay?: () => void; small?: boolean }) {
  const look = systemLook[item.id] || systemLook.condo_rental;
  return (
    <div className={"as-cover" + (small ? " small" : "")} style={{ background: look.bg }}>
      <svg className="as-cover-shapes" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden>
        <rect x="10" y="38" width="34" height="62" rx="3" fill="#fff" opacity=".22" />
        <rect x="50" y="20" width="40" height="80" rx="3" fill="#fff" opacity=".3" />
        <rect x="96" y="46" width="30" height="54" rx="3" fill="#fff" opacity=".2" />
        <rect x="132" y="28" width="44" height="72" rx="3" fill="#fff" opacity=".26" />
        <circle cx="178" cy="18" r="10" fill="#fff" opacity=".35" />
      </svg>
      <span className="as-cover-icon">
        <look.Icon size={small ? 22 : 30} />
      </span>
      {!small && onPlay && (
        <button type="button" className="as-play" aria-label={"ดูตัวอย่าง " + item.name} onClick={onPlay}>
          <Play size={16} fill="currentColor" />
        </button>
      )}
      {!small && item.duration && <span className="as-duration">{item.duration}</span>}
      {!small && item.popular && (
        <span className="as-ribbon">
          <Star size={11} fill="currentColor" /> ยอดนิยม
        </span>
      )}
    </div>
  );
}

/** Mini mock of the workspace in a theme's palette. */
function ThemeMock({ id, large = false }: { id: string; large?: boolean }) {
  const p = themePalettes[id] || themePalettes.modern_purple;
  return (
    <div className={"as-theme-mock" + (large ? " large" : "")} style={{ background: p.bg } as CSSProperties} aria-hidden>
      <div className="as-tm-nav" style={{ background: p.nav }}>
        <i style={{ background: p.accent }} />
        <b />
        <b />
        <b />
      </div>
      <div className="as-tm-main">
        <div className="as-tm-top">
          <span style={{ background: p.accent }} />
          <em style={{ background: p.accentSoft }} />
        </div>
        <div className="as-tm-cards">
          {[0, 1, 2].map((n) => (
            <div key={n}>
              <i style={{ background: n === 0 ? p.accent : p.accentSoft }} />
              <u />
            </div>
          ))}
        </div>
        <div className="as-tm-chart">
          {[40, 70, 52, 88, 62].map((h, n) => (
            <span key={n} style={{ height: h + "%", background: n % 2 ? p.accent : p.dots[1] }} />
          ))}
        </div>
      </div>
    </div>
  );
}

const coin = (n: number) => (
  <span className="as-price">
    <Coins size={14} />
    {money(n)} เหรียญ
  </span>
);

/* ---------------------------------------------------------------- left nav */

function useBilling() {
  const [b, setB] = useState<{ plan?: { name: string }; subscription?: { status: string; trial_ends_at: string; current_period_end: string | null } } | null>(null);
  useEffect(() => {
    api("/billing")
      .then(setB)
      .catch(() => {});
  }, []);
  return b;
}
type NavKey = "departments" | "store" | "characters" | "addons" | "history";
function ShopNav({ current, navigate, activeDepts }: { current: NavKey; navigate: Nav; activeDepts: number }) {
  const billing = useBilling();
  const end = billing?.subscription ? billing.subscription.current_period_end || billing.subscription.trial_ends_at : null;
  const entries: [string, string, LucideIcon, NavKey | null, boolean?][] = [
    ["dashboard", "ภาพรวมองค์กร", LayoutDashboard, null],
    ["departments", "แผนก (Departments)", LayoutGrid, "departments"],
    ["store", "App Shop", Store, "store", true],
    ["store?tab=characters", "AI Characters", Bot, "characters"],
    ["store?tab=addons", "ฟังก์ชันเสริม", Puzzle, "addons"],
    ["team", "ทีมงาน & สิทธิ์การใช้งาน", UsersRound, null],
    ["pricing", "การใช้งาน & แพ็กเกจ", ReceiptText, null],
    ["store?tab=history", "ประวัติการซื้อ", History, "history"],
    ["company", "ตั้งค่าองค์กร", Settings, null],
  ];
  return (
    <nav className="as-nav" aria-label="เมนูองค์กร">
      <div className="as-nav-list">
        {entries.map(([view, label, Ico, key, isNew]) => (
          <button key={view} className={"as-nav-item" + (key === current ? " active" : "")} aria-current={key === current ? "page" : undefined} onClick={() => navigate(view)}>
            <Ico size={17} />
            <span>{label}</span>
            {isNew && <em>New</em>}
          </button>
        ))}
      </div>
      <div className="as-plan">
        <small>
          <Crown size={14} /> แพ็กเกจปัจจุบัน
        </small>
        <b>{billing?.plan?.name || "—"}</b>
        <span>
          <Check size={13} /> ใช้งานได้ {activeDepts} แผนก
        </span>
        {end && (
          <span>
            <Check size={13} /> {billing?.subscription?.status === "trial" ? "ทดลองใช้ถึง" : "หมดอายุ"} {displayDate(end)}
          </span>
        )}
        <button className="as-plan-btn" onClick={() => navigate("pricing")}>
          ดูรายละเอียดแพ็กเกจ
        </button>
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------------- purchase + preview */

type Buying = { kind: "shop"; item: Item } | { kind: "module"; module: StoreModule };
function BuyDialog({ ctx, data, buying, onClose, notify }: { ctx: Context; data: ShopData; buying: Buying; onClose: () => void; notify: Notify }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [topup, setTopup] = useState(false),
    [bought, setBought] = useState(false);
  const name = buying.kind === "shop" ? buying.item.name : buying.module.name;
  const price = buying.kind === "shop" ? buying.item.price_coins : buying.module.price_coins;
  const monthly = buying.kind === "shop" && buying.item.period === "month";
  const allowed = buying.kind === "shop" ? data.canBuy : data.canBuyModules;
  const activatable = buying.kind === "shop" && (buying.item.kind === "theme" || buying.item.kind === "character");
  if (topup) return <TopupDialog ctx={ctx} onClose={onClose} />;
  return (
    <Modal title={"ซื้อ " + name} onClose={onClose}>
      <div className="as-buy">
        {buying.kind === "shop" && buying.item.kind === "character" && <CharacterArt id={buying.item.id} size={84} />}
        {buying.kind === "shop" && buying.item.kind === "theme" && <ThemeMock id={buying.item.id} />}
        {buying.kind === "shop" && buying.item.kind === "system" && <SystemCover item={buying.item} small />}
        <div>
          <p>
            ใช้ <b>{money(price)} เหรียญ</b>
            {monthly ? " / 30 วัน" : " · ซื้อครั้งเดียวใช้ได้ตลอด"}
          </p>
          <p className="muted">เหรียญคงเหลือ {money(data.balance)} เหรียญ</p>
          {monthly && buying.kind === "shop" && buying.item.owned && buying.item.expires_at && (
            <p className="muted">ต่ออายุจากวันหมดอายุเดิม {displayDate(buying.item.expires_at)}</p>
          )}
        </div>
      </div>
      {bought ? (
        <div className="as-done">
          <CheckCircle2 size={26} />
          <p>ซื้อ {name} แล้ว</p>
          {activatable && buying.kind === "shop" && (
            <button
              className="primary full"
              onClick={async () => {
                try {
                  await api("/shop/activate", { method: "POST", body: { kind: buying.item.kind, item: buying.item.id } });
                  notify("เปลี่ยนเป็น " + name + " แล้ว");
                  refreshAll();
                  onClose();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              ใช้{buying.item.kind === "theme" ? "ธีม" : "คาแรกเตอร์"}นี้เลย
            </button>
          )}
          <p role="alert" className="form-error">{error}</p>
        </div>
      ) : !allowed ? (
        <p className="note">
          <Lock size={14} /> {buying.kind === "module" ? "เฉพาะเจ้าของบริษัทซื้อระบบแผนกได้" : "เฉพาะเจ้าของหรือผู้จัดการซื้อได้"}
        </p>
      ) : data.balance < price ? (
        <>
          <p className="form-error">เหรียญไม่พอ ต้องเติมอีก {money(price - data.balance)} เหรียญ</p>
          <button className="primary full" onClick={() => setTopup(true)}>
            เติมเหรียญ
          </button>
        </>
      ) : (
        <>
          <p role="alert" className="form-error">{error}</p>
          <button
            className="primary full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                if (buying.kind === "module") await api("/coins/buy/" + buying.module.id, { method: "POST", body: {} });
                else await api("/shop/buy/" + buying.item.id, { method: "POST", body: {} });
                notify((buying.kind === "module" ? "เปิดใช้" : "ซื้อ ") + name + " แล้ว");
                refreshAll();
                setBought(true);
                if (!activatable) onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "กำลังซื้อ…" : `ยืนยันซื้อ ${money(price)} เหรียญ`}
          </button>
        </>
      )}
    </Modal>
  );
}

const greeting = (i: Item) =>
  i.id === "siri_style" || i.id === "neo_anime" || i.id === "mochi_cat"
    ? "สวัสดีค่ะ วันนี้มีเอกสารรออนุมัติ 3 รายการ ให้ช่วยสรุปไหมคะ?"
    : i.id === "elitebot"
      ? "ตรวจพบเอกสารรออนุมัติ 3 รายการ ต้องการสรุปหรือไม่"
      : i.id === "flow_dragon"
        ? "ลุยกันเลย! วันนี้มีงานรออนุมัติ 3 รายการนะ"
        : "สวัสดีครับ วันนี้มีเอกสารรออนุมัติ 3 รายการ ให้ช่วยสรุปไหมครับ?";
function PreviewDialog({ item, onClose, onBuy, onUse, canUse }: { item: Item; onClose: () => void; onBuy: () => void; onUse: () => void; canUse: boolean }) {
  return (
    <Modal title={"ตัวอย่าง " + item.name} onClose={onClose}>
      <div className={"as-preview as-preview-" + item.kind}>
        {item.kind === "character" && (
          <div className="as-preview-char">
            <CharacterArt id={item.id} size={170} />
            <div>
              <small className="muted">{item.subtitle}</small>
              <p>{item.description}</p>
              <p>
                <b>บุคลิก/น้ำเสียง:</b> {item.voice}
              </p>
              <div className="as-bubble">
                <CharacterArt id={item.id} size={34} />
                <span>{greeting(item)}</span>
              </div>
            </div>
          </div>
        )}
        {item.kind === "theme" && (
          <>
            <ThemeMock id={item.id} large />
            <p>{item.description}</p>
            <div className="as-dots">
              {(themePalettes[item.id]?.dots || []).map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </div>
          </>
        )}
        {item.kind === "system" && (
          <>
            <SystemCover item={item} />
            <p className="muted">{item.subtitle}</p>
            <p>{item.description}</p>
            <ul className="as-checks">
              {item.features.map((f) => (
                <li key={f}>
                  <Check size={14} /> {f}
                </li>
              ))}
            </ul>
            <p className="note">วิดีโอแนะนำระบบกำลังจัดทำ · ซื้อแล้วใช้ได้ 30 วัน ต่ออายุได้ทุกเมื่อ</p>
          </>
        )}
      </div>
      <div className="as-preview-foot">
        {coin(item.price_coins)}
        {item.period === "month" && <span className="muted">/ เดือน</span>}
        {item.owned && item.kind !== "system" ? (
          item.active ? (
            <span className="as-chip on">
              <Check size={13} /> ใช้งานอยู่
            </span>
          ) : (
            <button className="primary" disabled={!canUse} onClick={onUse}>
              ใช้รายการนี้
            </button>
          )
        ) : (
          <button className="primary" onClick={onBuy}>
            <ShoppingCart size={15} /> {item.owned ? "ต่ออายุ" : "ซื้อเลย"}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Buy / preview / activate state shared by both pages. */
function useShopActions(ctx: Context, data: ShopData | null, notify: Notify) {
  const [buying, setBuying] = useState<Buying | null>(null),
    [preview, setPreview] = useState<Item | null>(null);
  const use = async (i: Item) => {
    try {
      await api("/shop/activate", { method: "POST", body: { kind: i.kind, item: i.id } });
      notify("เปลี่ยนเป็น " + i.name + " แล้ว");
      setPreview(null);
      refreshAll();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const dialogs = data && (
    <>
      {buying && <BuyDialog ctx={ctx} data={data} buying={buying} notify={notify} onClose={() => setBuying(null)} />}
      {preview && (
        <PreviewDialog
          item={data.items.find((i) => i.id === preview.id) || preview}
          canUse={data.canBuy}
          onClose={() => setPreview(null)}
          onUse={() => use(preview)}
          onBuy={() => {
            setPreview(null);
            setBuying({ kind: "shop", item: preview });
          }}
        />
      )}
    </>
  );
  return {
    buy: (item: Item) => setBuying({ kind: "shop", item }),
    buyModule: (module: StoreModule) => setBuying({ kind: "module", module }),
    preview: setPreview,
    use,
    canUse: !!data?.canBuy,
    dialogs,
  };
}
type Actions = ReturnType<typeof useShopActions>;

/* ---------------------------------------------------------------- cards */

function CharacterCard({ item, a }: { item: Item; a: Actions }) {
  return (
    <article className={"as-char" + (item.active ? " active" : "")}>
      <div className="as-char-top">
        <CharacterArt id={item.id} size={112} />
        {item.popular && (
          <span className="as-tag">
            <Crown size={11} /> ยอดนิยม
          </span>
        )}
        <button type="button" className="as-play small" aria-label={"ดูตัวอย่าง " + item.name} onClick={() => a.preview(item)}>
          <Play size={12} fill="currentColor" />
        </button>
      </div>
      <b>{item.name}</b>
      {item.price_coins ? coin(item.price_coins) : <span className="as-price free">ฟรี</span>}
      <div className="as-card-actions">
        <button className="as-ghost" onClick={() => a.preview(item)}>
          <Eye size={13} /> ดูตัวอย่าง
        </button>
        <OwnButton item={item} a={a} />
      </div>
    </article>
  );
}
function OwnButton({ item, a }: { item: Item; a: Actions }) {
  if (item.active)
    return (
      <span className="as-chip on">
        <Check size={13} /> ใช้อยู่
      </span>
    );
  if (item.owned)
    return (
      <button className="as-buy-btn soft" disabled={!a.canUse} title={a.canUse ? "" : "เฉพาะเจ้าของหรือผู้จัดการ"} onClick={() => a.use(item)}>
        ใช้เลย
      </button>
    );
  return (
    <button className="as-buy-btn" onClick={() => a.buy(item)}>
      ซื้อเลย
    </button>
  );
}
function ThemeCard({ item, a }: { item: Item; a: Actions }) {
  return (
    <article className={"as-theme" + (item.active ? " active" : "")}>
      <button type="button" className="as-theme-thumb" onClick={() => a.preview(item)} aria-label={"ดูตัวอย่าง " + item.name}>
        <ThemeMock id={item.id} />
        {item.active && (
          <span className="as-check">
            <Check size={14} />
          </span>
        )}
      </button>
      <div className="as-theme-name">
        <b>{item.name}</b>
        <span className="as-dots">
          {(themePalettes[item.id]?.dots || []).map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
        </span>
      </div>
      <div className="as-card-actions">
        {item.price_coins ? coin(item.price_coins) : <span className="as-price free">ฟรี</span>}
        <button className="as-ghost" onClick={() => a.preview(item)}>
          ดูตัวอย่าง
        </button>
        <OwnButton item={item} a={a} />
      </div>
    </article>
  );
}
function SystemCard({ item, a }: { item: Item; a: Actions }) {
  const look = systemLook[item.id] || systemLook.condo_rental;
  return (
    <article className="as-system">
      <SystemCover item={item} onPlay={() => a.preview(item)} />
      <div className="as-system-title">
        <span style={{ color: look.color }}>
          <look.Icon size={20} />
        </span>
        <div>
          <b>{item.name}</b>
          <small>{item.subtitle}</small>
        </div>
      </div>
      <ul className="as-checks">
        {item.features.map((f) => (
          <li key={f}>
            <Check size={14} /> {f}
          </li>
        ))}
      </ul>
      <div className="as-system-foot">
        <span>
          {coin(item.price_coins)} <small className="muted">/ เดือน</small>
        </span>
        <button className="as-buy-btn" onClick={() => a.buy(item)}>
          <ShoppingCart size={14} /> {item.owned ? "ต่ออายุ" : "ซื้อเลย"}
        </button>
      </div>
      {item.owned && item.expires_at && (
        <small className="as-owned-note">
          <CheckCircle2 size={13} /> ใช้งานอยู่ ถึง {displayDate(item.expires_at)}
        </small>
      )}
    </article>
  );
}
function AddonCard({ item, a }: { item: Item; a: Actions }) {
  return (
    <article className="as-addon">
      <SystemCover item={item} small />
      <div className="as-addon-body">
        <b>{item.name.replace(/^ระบบบริหาร/, "ระบบ")}</b>
        <small>{item.features.slice(0, 3).join(" / ")}</small>
        <span>
          {coin(item.price_coins)} <small className="muted">/ เดือน</small>
        </span>
        {item.owned && item.expires_at && <em className="as-chip on">ใช้งานอยู่ ถึง {displayDate(item.expires_at)}</em>}
      </div>
      <div className="as-card-actions">
        <button className="as-ghost" onClick={() => a.preview(item)}>
          ดูรายละเอียด <ChevronRight size={13} />
        </button>
        <button className="as-buy-btn" onClick={() => a.buy(item)}>
          <ShoppingCart size={13} /> {item.owned ? "ต่ออายุ" : "ซื้อเลย"}
        </button>
      </div>
    </article>
  );
}
function ModuleCard({ m, a, navigate }: { m: StoreModule; a: Actions; navigate: Nav }) {
  return (
    <article className="as-addon module">
      <span className="as-module-icon">
        <Gem size={20} />
      </span>
      <div className="as-addon-body">
        <b>{m.name}</b>
        <small>{m.description}</small>
        <span>
          {coin(m.price_coins)} <small className="muted">· ซื้อครั้งเดียว</small>
        </span>
      </div>
      <div className="as-card-actions">
        {m.owned ? (
          <button className="as-buy-btn soft" onClick={() => navigate(m.view)}>
            <CheckCircle2 size={13} /> เปิดใช้งาน
          </button>
        ) : (
          <button className="as-buy-btn" onClick={() => a.buyModule(m)}>
            <ShoppingCart size={13} /> ซื้อเลย
          </button>
        )}
      </div>
    </article>
  );
}

/** Horizontal scroller with arrow buttons (design's carousels). */
function Carousel({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div className="as-carousel">
      <button type="button" className="as-arrow left" aria-label="เลื่อนซ้าย" onClick={() => scroll(-1)}>
        <ChevronLeft size={18} />
      </button>
      <div className="as-track" ref={ref} role="list" aria-label={label}>
        {children}
      </div>
      <button type="button" className="as-arrow right" aria-label="เลื่อนขวา" onClick={() => scroll(1)}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
function SectionHead({ icon, title, hint, more }: { icon: ReactNode; title: string; hint?: string; more?: () => void }) {
  return (
    <div className="as-section-head">
      <h2>
        {icon} {title}
      </h2>
      {hint && <span className="as-hint">{hint}</span>}
      {more && (
        <button className="as-more" onClick={more}>
          ดูทั้งหมด <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- page 10: แผนก (Departments) */

const deptTabs = [
  ["rec", "แนะนำสำหรับคุณ", Star],
  ["systems", "ระบบตามธุรกิจ", Building2],
  ["all", "ทุกหมวดหมู่", LayoutGrid],
  ["characters", "AI Characters", Bot],
  ["addons", "ฟังก์ชันเสริม", Puzzle],
] as const;

export function DepartmentsPage({ ctx, navigate, notify }: { ctx: Context; navigate: Nav; notify: Notify }) {
  const { data, error } = useShop();
  const a = useShopActions(ctx, data, notify);
  const [q, setQ] = useState(""),
    [mode, setMode] = useState<"grid" | "list">("grid"),
    [tab, setTab] = useState<(typeof deptTabs)[number][0]>("rec");
  const modules = useMemo(() => data?.modules || [], [data]);
  const depts = departmentMenu.filter((d) => !q.trim() || [d.title, d.en, d.subtitle].join(" ").toLowerCase().includes(q.trim().toLowerCase()));
  const active = departmentMenu.filter((d) => deptActive(d, modules)).length;
  const items = data?.items || [];
  const systems = items.filter((i) => i.kind === "system");
  return (
    <div className="as-page">
      <ShopNav current="departments" navigate={navigate} activeDepts={active} />
      <div className="as-main">
        <header className="as-head">
          <span className="as-head-icon">
            <LayoutGrid size={22} />
          </span>
          <div>
            <h1>แผนก (Departments)</h1>
            <p>จัดการแผนกและระบบการทำงานขององค์กร พร้อมเลือกซื้อระบบเพิ่มเติมจาก EliteFlow Shop</p>
          </div>
          <label className="as-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาแผนก / ระบบ / ฟังก์ชัน…" aria-label="ค้นหาแผนก" />
          </label>
          <div className="as-toggle" role="group" aria-label="รูปแบบการแสดงผล">
            <button className={mode === "grid" ? "on" : ""} aria-pressed={mode === "grid"} aria-label="แบบตาราง" onClick={() => setMode("grid")}>
              <LayoutGrid size={16} />
            </button>
            <button className={mode === "list" ? "on" : ""} aria-pressed={mode === "list"} aria-label="แบบรายการ" onClick={() => setMode("list")}>
              <List size={16} />
            </button>
          </div>
        </header>
        {error && <p className="form-error">{error}</p>}
        <div className={"as-depts " + mode}>
          {depts.map((d) => {
            const m = moduleIdOf(d, modules);
            const on = !data || deptActive(d, modules);
            return (
              <button
                key={d.id}
                className={"as-dept tone-" + d.tone + (on ? "" : " locked")}
                onClick={() => (on ? navigate(d.overview) : m && a.buyModule(m))}
                title={on ? "เปิดแผนก" + d.title : `ซื้อ${m?.name || "ระบบ"} ${m?.price_coins || ""} เหรียญ`}
              >
                <span className="as-dept-icon">
                  <MenuIcon name={d.icon} size={20} />
                </span>
                <span className="as-dept-text">
                  <b>
                    {d.title} <em>({d.en})</em>
                  </b>
                  <small>{d.subtitle}</small>
                  {on ? (
                    <span className="as-chip on">
                      <Check size={12} /> ใช้งานอยู่
                    </span>
                  ) : (
                    <span className="as-chip lock">
                      <Lock size={12} /> ซื้อเพิ่ม
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          <button className="as-dept add" onClick={() => navigate("store")}>
            <span className="as-dept-icon">
              <Plus size={20} />
            </span>
            <span className="as-dept-text">
              <b>เพิ่มแผนก / ระบบ</b>
              <small>เลือกจาก App Shop</small>
            </span>
          </button>
        </div>
        {!depts.length && <p className="note">ไม่พบแผนกที่ค้นหา</p>}

        <section className="as-banner">
          <div className="as-banner-brand">
            <ShopArt />
            <div>
              <h2>
                EliteFlow <span>App Shop</span>
              </h2>
              <p>ศูนย์รวมระบบและฟังก์ชันเสริม สำหรับทุกธุรกิจ</p>
            </div>
          </div>
          <div className="as-shortcuts">
            {(
              [
                ["store?tab=addons", "ซื้อระบบเสริม", "เพิ่มแผนก / ฟังก์ชันเฉพาะธุรกิจ", Gem],
                ["store?tab=characters", "AI Characters", "เลือกตัวละคร AI ผู้ช่วยของคุณ", Bot],
                ["team", "ทีมงาน (Team)", "ซื้อสิทธิ์การใช้งานเพิ่มทั้งทีม", UsersRound],
              ] as const
            ).map(([view, title, sub, Ico]) => (
              <button key={view} onClick={() => navigate(view)}>
                <span>
                  <Ico size={18} />
                </span>
                <b>{title}</b>
                <small>{sub}</small>
              </button>
            ))}
          </div>
        </section>

        <div className="as-tabs" role="tablist">
          {deptTabs.map(([k, label, Ico]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              <Ico size={15} /> {label}
            </button>
          ))}
        </div>
        {tab === "characters" ? (
          <>
            <SectionHead icon={<Bot size={20} />} title="AI Characters" more={() => navigate("store?tab=characters")} />
            <Carousel label="AI Characters">
              {items.filter((i) => i.kind === "character").map((i) => <CharacterCard key={i.id} item={i} a={a} />)}
            </Carousel>
          </>
        ) : tab === "addons" ? (
          <>
            <SectionHead icon={<Puzzle size={20} />} title="ฟังก์ชันเสริม" more={() => navigate("store?tab=addons")} />
            <div className="as-addons">
              {systems.map((i) => <AddonCard key={i.id} item={i} a={a} />)}
            </div>
          </>
        ) : tab === "all" ? (
          <>
            <SectionHead icon={<Gem size={20} />} title="ระบบแผนก (ซื้อครั้งเดียว)" />
            <div className="as-addons">
              {modules.map((m) => <ModuleCard key={m.id} m={m} a={a} navigate={navigate} />)}
            </div>
            <SectionHead icon={<Building2 size={20} />} title="ระบบตามธุรกิจ (รายเดือน)" more={() => navigate("store?tab=systems")} />
            <Carousel label="ระบบตามธุรกิจ">{systems.map((i) => <SystemCard key={i.id} item={i} a={a} />)}</Carousel>
          </>
        ) : (
          <>
            <SectionHead
              icon={tab === "rec" ? <Flame size={20} className="as-flame" /> : <Building2 size={20} />}
              title={tab === "rec" ? "ระบบยอดนิยม (แนะนำ)" : "ระบบตามธุรกิจ"}
              more={() => navigate("store?tab=systems")}
            />
            <Carousel label="ระบบยอดนิยม">{systems.map((i) => <SystemCard key={i.id} item={i} a={a} />)}</Carousel>
          </>
        )}
        {a.dialogs}
      </div>
    </div>
  );
}

function ShopArt() {
  return (
    <svg className="as-shop-art" viewBox="0 0 96 80" aria-hidden>
      <path d="M8 14 L20 14 L30 52 L74 52 L84 24 L24 24" fill="none" stroke="#6d3fe0" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="36" cy="66" r="6" fill="#6d3fe0" />
      <circle cx="68" cy="66" r="6" fill="#6d3fe0" />
      <rect x="54" y="4" width="34" height="38" rx="6" fill="#a07bf0" />
      <path d="M62 12 Q71 -2 80 12" fill="none" stroke="#fff" strokeWidth="3" />
      <path d="M64 22 L71 32 L80 20" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------------------- page 11: App Shop */

const shopTabs = [
  ["rec", "แนะนำสำหรับคุณ", Star],
  ["characters", "AI Characters", Bot],
  ["themes", "ธีมเสริม (Themes)", Palette],
  ["addons", "ฟังก์ชันเสริม (Add-ons)", Puzzle],
  ["systems", "ระบบตามธุรกิจ", Building2],
  ["all", "ทั้งหมด", LayoutGrid],
] as const;
type ShopTab = (typeof shopTabs)[number][0] | "history";

export function AppShop({ ctx, navigate, notify }: { ctx: Context; navigate: Nav; notify: Notify }) {
  const params = useSearchParams();
  const raw = params.get("tab") || "rec";
  const tab: ShopTab = raw === "history" || shopTabs.some(([k]) => k === raw) ? (raw as ShopTab) : "rec";
  const { data, error } = useShop();
  const a = useShopActions(ctx, data, notify);
  const [q, setQ] = useState(""),
    [topup, setTopup] = useState(false);
  const modules = data?.modules || [];
  const activeDepts = departmentMenu.filter((d) => deptActive(d, modules)).length;
  const needle = q.trim().toLowerCase();
  const items = (data?.items || []).filter((i) => !needle || [i.name, i.subtitle, i.description, ...i.features].join(" ").toLowerCase().includes(needle));
  const chars = items.filter((i) => i.kind === "character"),
    themes = items.filter((i) => i.kind === "theme"),
    systems = items.filter((i) => i.kind === "system"),
    mods = modules.filter((m) => !needle || [m.name, m.description, m.department].join(" ").toLowerCase().includes(needle));
  const go = (t: ShopTab) => navigate(t === "rec" ? "store" : "store?tab=" + t);
  const show = (t: ShopTab) => tab === t || tab === "all" || (tab === "rec" && t !== "systems");
  const navKey: NavKey = tab === "characters" ? "characters" : tab === "addons" ? "addons" : tab === "history" ? "history" : "store";
  return (
    <div className="as-page">
      <ShopNav current={navKey} navigate={navigate} activeDepts={activeDepts} />
      <div className="as-main">
        <section className="as-hero">
          <div className="as-hero-text">
            <div className="as-hero-title">
              <ShopArt />
              <h1>
                EliteFlow <span>App Shop</span>
              </h1>
            </div>
            <p className="as-hero-sub">ศูนย์รวมระบบเสริม · AI Characters · ธีมสวย · ฟังก์ชันเฉพาะทาง</p>
            <p className="muted">ปรับแต่ง EliteFlow ให้เป็นสไตล์ของคุณ เลือกซื้อเพิ่มเติมได้ตามต้องการ</p>
            <div className="as-wallet">
              <span>
                <Coins size={16} /> เหรียญคงเหลือ <b>{money(data?.balance ?? 0)}</b>
              </span>
              <button className="as-buy-btn" onClick={() => setTopup(true)}>
                + เติมเหรียญ
              </button>
            </div>
          </div>
          <ThemeMock id={data?.active.theme || "modern_purple"} />
          <ul className="as-hero-checks">
            {["ปรับแต่งหน้าตา / สไตล์", "เพิ่มฟังก์ชันตามธุรกิจ", "ใช้งานได้ทุกแผนก", "ซื้อครั้งเดียวหรือรายเดือน"].map((t) => (
              <li key={t}>
                <CheckCircle2 size={16} /> {t}
              </li>
            ))}
          </ul>
        </section>

        <div className="as-tabs with-search" role="tablist">
          {shopTabs.map(([k, label, Ico]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => go(k)}>
              <Ico size={15} /> {label}
            </button>
          ))}
          <label className="as-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา: คาแรกเตอร์, ธีม, ระบบ…" aria-label="ค้นหาใน App Shop" />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        {!data && !error && <p className="note">กำลังโหลด…</p>}

        {tab === "history" ? (
          <PurchaseHistory data={data} />
        ) : (
          <>
            {show("characters") && !!chars.length && (
              <section>
                <SectionHead icon={<Bot size={20} />} title="AI Characters (คาแรกเตอร์ AI)" hint='เลือก "หน้าตา / สไตล์" ของผู้ช่วย AI ได้ตามชอบ (ใช้งานได้ทุกแผนกและทุกประเภทธุรกิจ)' more={tab === "characters" ? undefined : () => go("characters")} />
                {tab === "characters" ? (
                  <div className="as-grid chars">{chars.map((i) => <CharacterCard key={i.id} item={i} a={a} />)}</div>
                ) : (
                  <Carousel label="AI Characters">{chars.filter((i) => i.price_coins > 0).map((i) => <CharacterCard key={i.id} item={i} a={a} />)}</Carousel>
                )}
              </section>
            )}
            {show("themes") && !!themes.length && (
              <section>
                <SectionHead icon={<Palette size={20} />} title="ธีมเสริม (Themes)" hint="เปลี่ยนหน้าตาและบรรยากาศของระบบให้เข้ากับแบรนด์หรือธุรกิจของคุณ" more={tab === "themes" ? undefined : () => go("themes")} />
                {tab === "themes" ? (
                  <div className="as-grid themes">{themes.map((i) => <ThemeCard key={i.id} item={i} a={a} />)}</div>
                ) : (
                  <Carousel label="ธีมเสริม">{themes.map((i) => <ThemeCard key={i.id} item={i} a={a} />)}</Carousel>
                )}
              </section>
            )}
            {show("addons") && !!systems.length && (
              <section>
                <SectionHead icon={<Puzzle size={20} />} title="ฟังก์ชันเสริม / ระบบตามธุรกิจ (Add-ons)" hint="เลือกระบบสำเร็จรูปและฟีเจอร์เฉพาะทาง เพิ่มความสามารถให้กับองค์กรของคุณ" more={tab === "addons" ? undefined : () => go("addons")} />
                <div className="as-addons">{systems.map((i) => <AddonCard key={i.id} item={i} a={a} />)}</div>
              </section>
            )}
            {(tab === "addons" || tab === "all") && !!mods.length && (
              <section>
                <SectionHead icon={<Gem size={20} />} title="ระบบแผนก (ซื้อครั้งเดียว ใช้ได้ตลอด)" hint={data && !data.canBuyModules ? "เฉพาะเจ้าของบริษัทซื้อระบบแผนกได้" : undefined} />
                <div className="as-addons">{mods.map((m) => <ModuleCard key={m.id} m={m} a={a} navigate={navigate} />)}</div>
              </section>
            )}
            {(tab === "systems" || tab === "all") && !!systems.length && (
              <section>
                <SectionHead icon={<Building2 size={20} />} title="ระบบตามธุรกิจ" hint="ราคาต่อเดือน · ต่ออายุได้ทุกเมื่อ" />
                <div className="as-grid systems">{systems.map((i) => <SystemCard key={i.id} item={i} a={a} />)}</div>
              </section>
            )}
            {data && !chars.length && !themes.length && !systems.length && !mods.length && <p className="note">ไม่พบรายการที่ค้นหา</p>}
            {data && !data.canBuy && <p className="note">เจ้าของหรือผู้จัดการเป็นผู้ซื้อและเปลี่ยนธีม/คาแรกเตอร์ได้</p>}
          </>
        )}
        {a.dialogs}
        {topup && <TopupDialog ctx={ctx} onClose={() => setTopup(false)} />}
      </div>
    </div>
  );
}

const kindLabel: Record<string, string> = { module: "ระบบแผนก", character: "AI Character", theme: "ธีม", system: "ระบบตามธุรกิจ", other: "อื่นๆ" };
function PurchaseHistory({ data }: { data: ShopData | null }) {
  if (!data) return null;
  if (!data.canBuy) return <p className="note">เฉพาะเจ้าของหรือผู้จัดการดูประวัติการซื้อได้</p>;
  const rows = data.history;
  const spent = rows.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0);
  return (
    <section className="as-history">
      <SectionHead icon={<History size={20} />} title="ประวัติการซื้อ" hint={`ใช้ไปแล้ว ${money(spent)} เหรียญ · คงเหลือ ${money(data.balance)} เหรียญ`} />
      {!rows.length ? (
        <p className="note">ยังไม่มีรายการ</p>
      ) : (
        <div className="as-table-wrap">
          <table className="as-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>รายการ</th>
                <th>ประเภท</th>
                <th className="num">เหรียญ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n}>
                  <td>{displayDate(r.created_at)}</td>
                  <td>{r.reason === "topup" ? "เติมเหรียญ" : r.reason === "adjust" ? "ปรับยอดโดย Admin" : r.name}</td>
                  <td>{r.reason === "topup" ? "เติมเหรียญ" : kindLabel[r.kind] || r.kind}</td>
                  <td className={"num " + (r.delta < 0 ? "minus" : "plus")}>
                    {r.delta > 0 ? "+" : ""}
                    {money(r.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
