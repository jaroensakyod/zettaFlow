"use client";
// หลังบ้าน (platform admin console): a side menu of sections in EliteFlow's colours, a search over every company and
// user (Ctrl+K), and live numbers refreshed every 30 seconds. Phase 1: หน้าแรก, บริษัท, ผู้ใช้, แพ็กเกจและสิทธิ์ (who
// uses which package, give / revoke a package), plus the earlier tools (การเงิน, ซัพพอร์ต, โปรโมชัน, ประกาศ).
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity, BadgeDollarSign, Bell, Bot, Building2, CalendarClock, ChevronRight, Coins, Crown, Gift, House, Lock,
  Megaphone, MessageCircle, MessagesSquare, RefreshCw, Search, Settings, ShoppingBag, Sparkles, TriangleAlert, Undo2, Users, X,
  ReceiptText, CircleAlert, UserPlus, type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { api, Modal, Loading, Empty } from "./shared";
import { SupportInbox, ContentEditor } from "./engage";
import { AdminTopups } from "./coins";
import { PlatformPayments } from "./platform";
import { AiPage, HealthPage, LinePage } from "./admin-monitor";
import { AdsPage, ShopPage } from "./admin-shop";
import { SecurityPage, SettingsPage } from "./admin-settings";
import type { AdminCompany, AdminGrant, AdminUser, FeedItem, GrantKind, Overview, Via } from "@/lib/admin-console";

type Section = "home" | "companies" | "users" | "packages" | "finance" | "support" | "promos" | "announcements" | "line" | "ai" | "health" | "security" | "shop" | "ads" | "settings";
type Item = { key: Section; label: string; icon: LucideIcon; c: [string, string]; soon?: string };
const menu: { group: string; items: Item[] }[] = [
  { group: "ภาพรวม", items: [{ key: "home", label: "หน้าแรก", icon: House, c: ["#a855f7", "#6d28d9"] }] },
  {
    group: "ลูกค้า",
    items: [
      { key: "companies", label: "บริษัท", icon: Building2, c: ["#38bdf8", "#2563eb"] },
      { key: "users", label: "ผู้ใช้", icon: Users, c: ["#2dd4bf", "#0d9488"] },
    ],
  },
  {
    group: "รายได้",
    items: [
      { key: "packages", label: "แพ็กเกจและสิทธิ์", icon: Gift, c: ["#f472b6", "#db2777"] },
      { key: "finance", label: "การเงิน · สลิป", icon: BadgeDollarSign, c: ["#fbbf24", "#d97706"] },
    ],
  },
  {
    group: "ร้านค้า · โฆษณา",
    items: [
      { key: "shop", label: "App Shop · ราคา", icon: ShoppingBag, c: ["#34d399", "#059669"] },
      { key: "ads", label: "ตำแหน่งโฆษณา", icon: Megaphone, c: ["#fb923c", "#db2777"] },
      { key: "promos", label: "โปรโมชัน", icon: Sparkles, c: ["#c084fc", "#9333ea"] },
      { key: "announcements", label: "ประกาศป๊อปอัป", icon: Bell, c: ["#818cf8", "#4f46e5"] },
    ],
  },
  {
    group: "ระบบ",
    items: [
      { key: "line", label: "LINE Bot", icon: MessagesSquare, c: ["#4ade80", "#06c755"] },
      { key: "ai", label: "AI · ต้นทุน", icon: Bot, c: ["#c084fc", "#7c3aed"] },
      { key: "health", label: "สุขภาพระบบ", icon: Activity, c: ["#fb7185", "#e11d48"] },
      { key: "security", label: "ความปลอดภัย", icon: Lock, c: ["#94a3b8", "#475569"] },
    ],
  },
  {
    group: "ดูแล",
    items: [
      { key: "support", label: "ซัพพอร์ต", icon: MessageCircle, c: ["#60a5fa", "#4f46e5"] },
      { key: "settings", label: "ตั้งค่าแพลตฟอร์ม", icon: Settings, c: ["#a1a1aa", "#52525b"] },
    ],
  },
];
const allItems = menu.flatMap((g) => g.items);

const planColor: Record<string, [string, string]> = {
  free: ["#94a3b8", "#64748b"],
  starter: ["#38bdf8", "#2563eb"],
  growth: ["#a855f7", "#6d28d9"],
  business: ["#fb923c", "#ea580c"],
  enterprise: ["#f472b6", "#db2777"],
};
const planName: Record<string, string> = { free: "Free", starter: "Starter", growth: "Growth", business: "Business", enterprise: "Enterprise" };
const grantKinds: Record<GrantKind, string> = { trial: "ทดลองใช้", gift: "ของแถม / โปรโมชัน", partner: "พาร์ทเนอร์", compensation: "ชดเชย", offline: "จ่ายนอกระบบ" };
const viaLabel: Record<Via, string> = { paid: "จ่ายเอง", grant: "แอดมินมอบ", trial: "ทดลองใช้", free: "ฟรี" };
const grad = (c: [string, string]) => `linear-gradient(135deg, ${c[0]}, ${c[1]})`;
const baht = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH");
const thDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" }) : "—");
const ago = (s?: string | null) => {
  if (!s) return "—";
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  if (m < 1) return "เมื่อสักครู่";
  if (m < 60) return m + " นาที";
  if (m < 1440) return Math.round(m / 60) + " ชม.";
  return Math.round(m / 1440) + " วัน";
};
const daysLeft = (s?: string | null) => (s ? Math.ceil((Date.parse(s) - Date.now()) / 86400000) : null);
const initials = (s: string) => (s.trim()[0] || "?").toUpperCase();
const tint = (s: string) => {
  const colors = ["#7c3aed", "#2563eb", "#0d9488", "#ea580c", "#db2777", "#16a34a", "#d97706", "#4f46e5"];
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
};

function PlanChip({ plan }: { plan: string }) {
  return (
    <span className="ad-plan" style={{ background: grad(planColor[plan] || planColor.free) }}>
      {plan !== "free" && <Crown size={11} />} {planName[plan] || plan}
    </span>
  );
}
function ViaChip({ c }: { c: AdminCompany }) {
  return <span className={"ad-via v-" + c.via}>{c.via === "grant" && c.grant_kind ? "แอดมินมอบ · " + grantKinds[c.grant_kind] : viaLabel[c.via]}</span>;
}
function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span className="ad-av" style={{ width: size, height: size, background: tint(name) }}>
      {initials(name)}
    </span>
  );
}
function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values),
    pts = values.map((v, i) => `${(i / (values.length - 1)) * 90},${28 - (v / max) * 24}`).join(" ");
  return (
    <svg width="90" height="30" viewBox="0 0 90 30" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={pts} />
    </svg>
  );
}
function Change({ now, prev, invert = false, unit = "" }: { now: number; prev: number; invert?: boolean; unit?: string }) {
  if (!prev && !now) return null;
  const pct = prev ? Math.round(((now - prev) / prev) * 100) : 100,
    up = now >= prev,
    good = invert ? !up : up;
  return (
    <em className={"ad-chg " + (good ? "up" : "dn")}>
      {up ? "▲" : "▼"} {unit ? Math.abs(now - prev) + unit : Math.abs(pct) + "%"}
    </em>
  );
}

export function AdminApp({ notify }: { notify: (s: string) => void }) {
  const [section, setSection] = useState<Section>("home"),
    [range, setRange] = useState(30),
    [overview, setOverview] = useState<Overview | null>(null),
    [companies, setCompanies] = useState<AdminCompany[] | null>(null),
    [error, setError] = useState(""),
    [searching, setSearching] = useState(false),
    [openCompany, setOpenCompany] = useState<string | null>(null),
    [granting, setGranting] = useState<AdminCompany | null | "pick">(null),
    [planFilter, setPlanFilter] = useState(""),
    [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    Promise.all([api("/admin/overview?range=" + range), api("/admin/companies")])
      .then(([o, c]) => {
        if (!live) return;
        setOverview(o);
        setCompanies(c);
        setError("");
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [range, tick]);
  // Live: refresh every 30 seconds while the page is open.
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && refresh(), 30000);
    return () => window.clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Captured first, so the workspace's own Ctrl+K tool search stays closed on this page.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const go = (s: Section, plan = "") => {
    setSection(s);
    setPlanFilter(plan);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const badges: Partial<Record<Section, number>> = overview
    ? {
        home: Object.values(overview.todo).reduce((a, b) => a + b, 0),
        finance: overview.todo.slips + overview.todo.topups,
        support: overview.todo.support,
        packages: overview.todo.grantsEnding,
        health: overview.todo.failed,
      }
    : {};
  const current = allItems.find((i) => i.key === section)!;
  return (
    <div className="ad">
      <nav className="ad-side" aria-label="เมนูหลังบ้าน">
        <div className="ad-brand">
          <span className="ad-logo">
            <Crown size={16} />
          </span>
          <b>หลังบ้าน</b>
          <em>ADMIN</em>
        </div>
        {menu.map((g) => (
          <div key={g.group} className="ad-group">
            <span>{g.group}</span>
            {g.items.map((i) => (
              <button key={i.key} className={"ad-item" + (section === i.key ? " on" : "")} onClick={() => go(i.key)} aria-current={section === i.key ? "page" : undefined}>
                <i style={{ background: grad(i.c) }}>
                  <i.icon size={15} />
                </i>
                <span>{i.label}</span>
                {i.soon ? <small className="ad-soon">เร็วๆ นี้</small> : badges[i.key] ? <b>{badges[i.key]}</b> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="ad-main">
        <div className="ad-bar">
          <button className="ad-search" onClick={() => setSearching(true)}>
            <Search size={16} />
            <span className="long">ค้นหาบริษัท อีเมล ชื่อผู้ใช้…</span>
            <span className="short">ค้นหา…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="ad-range" role="group" aria-label="ช่วงเวลา">
            {[
              [1, "วันนี้"],
              [7, "7 วัน"],
              [30, "30 วัน"],
              [365, "ปีนี้"],
            ].map(([d, l]) => (
              <button key={d} className={range === d ? "on" : ""} onClick={() => setRange(Number(d))}>
                {l}
              </button>
            ))}
          </div>
          <button className="ad-live" onClick={refresh} title="รีเฟรชตอนนี้">
            <i />
            Live
            <RefreshCw size={13} />
          </button>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {section !== "home" && (
          <header className="ad-title">
            <i style={{ background: grad(current.c) }}>
              <current.icon size={20} />
            </i>
            <div>
              <h1>{current.label}</h1>
              {current.soon && <p>{current.soon}</p>}
            </div>
          </header>
        )}

        {section === "home" &&
          (overview && companies ? (
            <Home o={overview} companies={companies} go={go} openCompany={setOpenCompany} />
          ) : (
            <section className="card">
              <Loading />
            </section>
          ))}
        {section === "companies" && (companies ? <CompanyList companies={companies} open={setOpenCompany} grant={setGranting} initialPlan={planFilter} /> : <Loading />)}
        {section === "users" && <UserList open={setOpenCompany} />}
        {section === "packages" &&
          (overview && companies ? (
            <Packages o={overview} companies={companies} grant={setGranting} open={setOpenCompany} notify={notify} changed={refresh} tick={tick} initialPlan={planFilter} />
          ) : (
            <Loading />
          ))}
        {section === "finance" && (
          <div className="ad-stack">
            <PlatformPayments notify={notify} changed={refresh} />
            <AdminTopups notify={notify} />
          </div>
        )}
        {section === "shop" && <ShopPage tick={tick} notify={notify} />}
        {section === "security" && <SecurityPage tick={tick} open={setOpenCompany} go={(s) => go(s as Section)} />}
        {section === "settings" && <SettingsPage tick={tick} notify={notify} />}
        {section === "ads" && <AdsPage tick={tick} notify={notify} open={setOpenCompany} />}
        {section === "ai" && <AiPage range={range} tick={tick} open={setOpenCompany} />}
        {section === "line" && <LinePage range={range} tick={tick} open={setOpenCompany} />}
        {section === "health" && <HealthPage tick={tick} open={setOpenCompany} />}
        {section === "support" && <SupportInbox notify={notify} />}
        {section === "promos" && <ContentEditor kind="promos" notify={notify} />}
        {section === "announcements" && <ContentEditor kind="announcements" notify={notify} />}
        {current.soon && <Soon item={current} />}
      </div>

      {searching && companies && <SearchPalette companies={companies} close={() => setSearching(false)} open={(id) => (setSearching(false), setOpenCompany(id))} />}
      {openCompany && (
        <CompanyDrawer
          id={openCompany}
          tick={tick}
          close={() => setOpenCompany(null)}
          grant={(c) => setGranting(c)}
          notify={notify}
          changed={refresh}
        />
      )}
      {granting && companies && (
        <GrantDialog
          companies={companies}
          initial={granting === "pick" ? null : granting}
          close={() => setGranting(null)}
          done={() => {
            setGranting(null);
            refresh();
            notify("มอบแพ็กเกจแล้ว");
          }}
        />
      )}
    </div>
  );
}

// ---------- หน้าแรก ----------
function Home({ o, companies, go, openCompany }: { o: Overview; companies: AdminCompany[]; go: (s: Section, plan?: string) => void; openCompany: (id: string) => void }) {
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Bangkok" })),
    greet = hour < 12 ? "สวัสดีตอนเช้า" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น",
    todo = [
      { n: o.todo.slips + o.todo.topups, label: "สลิปรอตรวจ", icon: ReceiptText, c: ["#fb7185", "#e11d48"] as [string, string], to: "finance" as Section },
      { n: o.todo.support, label: "แชทยังไม่ตอบ", icon: MessageCircle, c: ["#60a5fa", "#4f46e5"] as [string, string], to: "support" as Section },
      { n: o.todo.expiring, label: "หมดอายุใน 7 วัน", icon: CalendarClock, c: ["#fbbf24", "#d97706"] as [string, string], to: "companies" as Section },
      { n: o.todo.failed, label: "งานล้มเหลว 24 ชม.", icon: TriangleAlert, c: ["#f87171", "#b91c1c"] as [string, string], to: "health" as Section },
      { n: o.todo.grantsEnding, label: "สิทธิ์ที่มอบใกล้หมด", icon: Gift, c: ["#f472b6", "#db2777"] as [string, string], to: "packages" as Section },
    ].filter((t, i) => t.n > 0 || i < 3),
    total = todo.reduce((a, t) => a + t.n, 0),
    paid = o.series.map((s) => s.paid);
  const expiring = companies
    .filter((c) => c.plan !== "free" && c.period_end && (daysLeft(c.period_end) ?? 99) <= 7 && (daysLeft(c.period_end) ?? 0) > 0)
    .sort((a, b) => String(a.period_end).localeCompare(String(b.period_end)))
    .slice(0, 5);
  return (
    <div className="ad-stack">
      <section className="ad-hello">
        <span className="ad-hello-av">
          <Crown size={26} />
        </span>
        <div>
          <h1>{greet} แอดมิน 👋</h1>
          <p>
            {new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" })} ·{" "}
            {total ? `มี ${total} เรื่องรอคุณจัดการ` : "ไม่มีเรื่องค้าง เยี่ยมมาก"}
          </p>
        </div>
        <div className="ad-todo">
          {todo.map((t) => (
            <button key={t.label} className={"ad-tk" + (t.n ? "" : " zero")} onClick={() => go(t.to)}>
              <i style={{ background: grad(t.c) }}>
                <t.icon size={16} />
              </i>
              <span>
                <small>{t.label}</small>
                <b>{t.n}</b>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="ad-kpis">
        <button className="ad-kpi" style={{ "--c": "#7c3aed" } as CSSProperties} onClick={() => go("companies")}>
          <span className="ad-kpi-h">
            <i>
              <Building2 size={16} />
            </i>
            บริษัททั้งหมด
            <Change now={o.totals.newCompanies} prev={o.totals.newPrev} />
          </span>
          <span className="ad-kpi-v">
            <b>{o.totals.companies.toLocaleString("th-TH")}</b>
            <Spark values={o.growth.companies} color="#7c3aed" />
          </span>
          <small>สมัครใหม่ {o.totals.newCompanies} ในช่วงนี้</small>
        </button>
        <button className="ad-kpi" style={{ "--c": "#16a34a" } as CSSProperties} onClick={() => go("packages")}>
          <span className="ad-kpi-h">
            <i>
              <BadgeDollarSign size={16} />
            </i>
            ลูกค้าจ่ายเงิน
          </span>
          <span className="ad-kpi-v">
            <b>{o.totals.paid}</b>
            <Spark values={o.growth.paid} color="#16a34a" />
          </span>
          <small>ทดลองใช้อยู่ {o.totals.trial} บริษัท</small>
        </button>
        <button className="ad-kpi" style={{ "--c": "#2563eb" } as CSSProperties} onClick={() => go("users")}>
          <span className="ad-kpi-h">
            <i>
              <Users size={16} />
            </i>
            ผู้ใช้ทั้งหมด
          </span>
          <span className="ad-kpi-v">
            <b>{o.totals.users.toLocaleString("th-TH")}</b>
          </span>
          <small>ทำรายการวันนี้ {o.totals.activeToday} คน</small>
        </button>
        <button className="ad-kpi" style={{ "--c": "#e11d48" } as CSSProperties} onClick={() => go("ai")}>
          <span className="ad-kpi-h">
            <i>
              <Bot size={16} />
            </i>
            ค่า AI เดือนนี้
            <Change now={o.ai.month} prev={o.ai.prevMonth} invert />
          </span>
          <span className="ad-kpi-v">
            <b>${o.ai.month.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b>
          </span>
          <small>เดือนก่อน ${o.ai.prevMonth.toLocaleString("en-US", { maximumFractionDigits: 2 })}</small>
        </button>
      </section>

      <section className="card ad-card">
        <h3 className="ad-h">
          <Gift size={17} /> ใครใช้แพ็กเกจอะไร
          <button onClick={() => go("packages")}>
            ดูทั้งหมด <ChevronRight size={14} />
          </button>
        </h3>
        <PlanCards o={o} pick={(p) => go("companies", p)} />
      </section>

      <div className="ad-row">
        <section className="card ad-card">
          <h3 className="ad-h">
            <Activity size={17} /> สมัครใหม่ และ ลูกค้าจ่ายเงิน
            <span className="ad-legend">
              <i style={{ background: "#7c3aed" }} /> สมัคร <i style={{ background: "#16a34a" }} /> จ่ายเงิน
            </span>
          </h3>
          <Chart series={o.series} />
          <div className="ad-mini">
            <div style={{ "--b": "#f3eefe", "--t": "#6d28d9" } as CSSProperties}>
              <small>สมัครใหม่</small>
              <b>{o.totals.newCompanies}</b>
            </div>
            <div style={{ "--b": "#dcfce7", "--t": "#15803d" } as CSSProperties}>
              <small>ชำระเงิน</small>
              <b>{paid.reduce((a, b) => a + b, 0)}</b>
            </div>
            <div style={{ "--b": "#fef3c7", "--t": "#b45309" } as CSSProperties}>
              <small>รายได้ช่วงนี้</small>
              <b>{baht(o.revenue.range)}</b>
            </div>
          </div>
        </section>
        <div className="ad-stack">
          <section className="ad-mrr">
            <small>รายได้ต่อเดือน (MRR)</small>
            <b>{baht(o.mrr)}</b>
            <span className="ad-pill">รายปีประมาณ {baht(o.mrr * 12)}</span>
            <div>
              <span>วันนี้ {baht(o.revenue.today)}</span>
              <span>ช่วงก่อน {baht(o.revenue.prev)}</span>
            </div>
          </section>
          <section className="card ad-card">
            <h3 className="ad-h">
              <CalendarClock size={17} /> ใกล้หมดอายุ
            </h3>
            {expiring.length ? (
              <div className="ad-list">
                {expiring.map((c) => (
                  <button key={c.id} onClick={() => openCompany(c.id)}>
                    <Avatar name={c.name} size={30} />
                    <span>
                      <b>{c.name}</b>
                      <small>
                        <PlanChip plan={c.plan} /> {thDate(c.period_end)}
                      </small>
                    </span>
                    <em className="ad-due">อีก {daysLeft(c.period_end)} วัน</em>
                  </button>
                ))}
              </div>
            ) : (
              <p className="ad-empty">ไม่มีลูกค้าที่จะหมดอายุใน 7 วัน</p>
            )}
          </section>
        </div>
      </div>

      <section className="card ad-card">
        <h3 className="ad-h">
          <Activity size={17} /> เหตุการณ์ล่าสุด
        </h3>
        <Feed items={o.feed} open={openCompany} />
      </section>
    </div>
  );
}

function PlanCards({ o, pick }: { o: Overview; pick: (plan: string) => void }) {
  return (
    <div className="ad-plans">
      {o.plans.map((p) => (
        <button key={p.id} className="ad-pl" style={{ background: grad(planColor[p.id]) }} onClick={() => pick(p.id)}>
          <small>
            {p.name}
            {p.id === "growth" ? " · ยอดนิยม" : ""}
          </small>
          <b>{p.companies.toLocaleString("th-TH")}</b>
          <i>{p.id === "free" ? "บริษัท" : baht(p.mrr) + " / เดือน"}</i>
        </button>
      ))}
    </div>
  );
}

function Chart({ series }: { series: Overview["series"] }) {
  const n = series.length,
    max = Math.max(1, ...series.map((s) => Math.max(s.signups, s.paid))),
    every = Math.ceil(n / 10);
  return (
    <div className="ad-bars" role="img" aria-label="กราฟสมัครใหม่และลูกค้าจ่ายเงิน">
      {series.map((s, i) => (
        <div key={s.day} className="ad-bcol" title={`${s.label}: สมัคร ${s.signups} · จ่ายเงิน ${s.paid}`}>
          <div className="ad-bpair">
            <i className="sg" style={{ height: (s.signups / max) * 100 + "%" }} />
            <i className="pd" style={{ height: (s.paid / max) * 100 + "%" }} />
          </div>
          <small>{i % every === 0 || i === n - 1 ? s.label : ""}</small>
        </div>
      ))}
    </div>
  );
}

const feedLook: Record<FeedItem["kind"], [LucideIcon, string]> = {
  signup: [UserPlus, "#7c3aed"],
  paid: [BadgeDollarSign, "#16a34a"],
  pending: [ReceiptText, "#d97706"],
  grant: [Gift, "#db2777"],
  revoke: [Undo2, "#64748b"],
  failed: [CircleAlert, "#e11d48"],
  support: [MessageCircle, "#4f46e5"],
};
function Feed({ items, open }: { items: FeedItem[]; open: (id: string) => void }) {
  if (!items.length) return <p className="ad-empty">ยังไม่มีเหตุการณ์</p>;
  return (
    <div className="ad-feed">
      {items.map((f, i) => {
        const [Icon, color] = feedLook[f.kind];
        return (
          <button key={i} onClick={() => f.company_id && open(f.company_id)}>
            <i style={{ background: color }}>
              <Icon size={14} />
            </i>
            <span>{f.text}</span>
            <small>{ago(f.at)}</small>
          </button>
        );
      })}
    </div>
  );
}

// ---------- บริษัท ----------
function CompanyList({ companies, open, grant, initialPlan = "" }: { companies: AdminCompany[]; open: (id: string) => void; grant: (c: AdminCompany) => void; initialPlan?: string }) {
  const [q, setQ] = useState(""),
    [plan, setPlan] = useState(initialPlan),
    [via, setVia] = useState(""),
    [sort, setSort] = useState<"new" | "expire" | "name">("new");
  useEffect(() => setPlan(initialPlan), [initialPlan]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return companies
      .filter((c) => (!plan || c.plan === plan) && (!via || c.via === via) && (!s || [c.name, c.owner_email, c.owner_name, c.industry, c.province, c.id].join(" ").toLowerCase().includes(s)))
      .sort((a, b) =>
        sort === "name" ? a.name.localeCompare(b.name, "th") : sort === "expire" ? String(a.period_end || "9").localeCompare(String(b.period_end || "9")) : b.created_at.localeCompare(a.created_at),
      );
  }, [companies, q, plan, via, sort]);
  return (
    <section className="card ad-card">
      <div className="ad-filters">
        <label className="ad-find">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อบริษัท อีเมลเจ้าของ จังหวัด…" />
        </label>
        <div className="ad-chips">
          <button className={!plan ? "on" : ""} onClick={() => setPlan("")}>
            ทุกแพ็กเกจ
          </button>
          {Object.keys(planName).map((p) => (
            <button key={p} className={plan === p ? "on" : ""} style={{ "--pc": planColor[p][1] } as CSSProperties} onClick={() => setPlan(plan === p ? "" : p)}>
              {planName[p]} <small>{companies.filter((c) => c.plan === p).length}</small>
            </button>
          ))}
        </div>
        <select value={via} onChange={(e) => setVia(e.target.value)} aria-label="ได้แพ็กเกจมาจาก">
          <option value="">ได้มาจาก: ทั้งหมด</option>
          {(Object.keys(viaLabel) as Via[]).map((v) => (
            <option key={v} value={v}>
              {viaLabel[v]}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="เรียงตาม">
          <option value="new">สมัครล่าสุด</option>
          <option value="expire">ใกล้หมดอายุ</option>
          <option value="name">ชื่อ ก-ฮ</option>
        </select>
      </div>
      <p className="ad-count">
        {list.length.toLocaleString("th-TH")} บริษัท{companies.length !== list.length ? ` จาก ${companies.length.toLocaleString("th-TH")}` : ""}
      </p>
      {list.length ? (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>บริษัท</th>
                <th>แพ็กเกจ</th>
                <th>ได้มาจาก</th>
                <th>ผู้ใช้</th>
                <th>หมดอายุ</th>
                <th>สมัครเมื่อ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} onClick={() => open(c.id)}>
                  <td>
                    <span className="ad-co">
                      <Avatar name={c.name} />
                      <span>
                        <b>{c.name}</b>
                        <small>{c.owner_email || c.industry || "—"}</small>
                      </span>
                    </span>
                  </td>
                  <td data-label="แพ็กเกจ">
                    <PlanChip plan={c.plan} />
                  </td>
                  <td data-label="ได้มาจาก">
                    <ViaChip c={c} />
                  </td>
                  <td data-label="ผู้ใช้">
                    <Seats c={c} />
                  </td>
                  <td data-label="หมดอายุ">
                    <Expiry at={c.period_end} />
                  </td>
                  <td data-label="สมัครเมื่อ">{thDate(c.created_at)}</td>
                  <td>
                    <button
                      className="ad-btn ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        grant(c);
                      }}
                    >
                      <Gift size={14} /> มอบแพ็กเกจ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="ไม่พบบริษัทที่ตรงกับตัวกรอง" />
      )}
    </section>
  );
}
function Seats({ c }: { c: AdminCompany }) {
  const pct = c.users_limit ? Math.min(100, Math.round((c.members / c.users_limit) * 100)) : 30;
  return (
    <span className="ad-seats">
      <span className="ad-bar-track">
        <i style={{ width: pct + "%", background: pct >= 100 ? "#e11d48" : (planColor[c.plan] || planColor.free)[1] }} />
      </span>
      <small>
        {c.members} / {c.users_limit ?? "∞"} คน
      </small>
    </span>
  );
}
function Expiry({ at }: { at: string | null }) {
  const d = daysLeft(at);
  if (d === null) return <span className="ad-muted">ไม่มีวันหมด</span>;
  return <span className={d <= 0 ? "ad-due late" : d <= 7 ? "ad-due" : ""}>{d <= 0 ? "หมดแล้ว" : d <= 7 ? `อีก ${d} วัน` : thDate(at)}</span>;
}

// ---------- ผู้ใช้ ----------
function UserList({ open }: { open: (id: string) => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null),
    [q, setQ] = useState(""),
    [role, setRole] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api("/admin/users")
      .then(setUsers)
      .catch((e) => setError((e as Error).message));
  }, []);
  if (error) return <p className="form-error">{error}</p>;
  if (!users) return <Loading />;
  const s = q.trim().toLowerCase(),
    list = users.filter((u) => (!role || u.role === role) && (!s || [u.email, u.name, u.company].join(" ").toLowerCase().includes(s)));
  const roles: Record<string, string> = { owner: "เจ้าของ", manager: "ผู้จัดการ", staff: "พนักงาน", viewer: "ผู้ชม" };
  return (
    <section className="card ad-card">
      <div className="ad-filters">
        <label className="ad-find">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาอีเมล ชื่อ หรือบริษัท…" />
        </label>
        <div className="ad-chips">
          <button className={!role ? "on" : ""} onClick={() => setRole("")}>
            ทุกบทบาท
          </button>
          {Object.entries(roles).map(([k, l]) => (
            <button key={k} className={role === k ? "on" : ""} onClick={() => setRole(role === k ? "" : k)}>
              {l} <small>{users.filter((u) => u.role === k).length}</small>
            </button>
          ))}
        </div>
      </div>
      <p className="ad-count">{list.length.toLocaleString("th-TH")} ผู้ใช้</p>
      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th>ผู้ใช้</th>
              <th>บริษัท</th>
              <th>บทบาท</th>
              <th>สมัครเมื่อ</th>
              <th>เข้าระบบล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 500).map((u) => (
              <tr key={u.company_id + u.user_id} onClick={() => open(u.company_id)}>
                <td>
                  <span className="ad-co">
                    <Avatar name={u.name || u.email} size={30} />
                    <span>
                      <b>{u.name || u.email.split("@")[0]}</b>
                      <small>{u.email}</small>
                    </span>
                  </span>
                </td>
                <td data-label="บริษัท">{u.company}</td>
                <td data-label="บทบาท">
                  <span className={"ad-role r-" + u.role}>{roles[u.role] || u.role}</span>
                  {u.disabled && <span className="ad-role r-off">ระงับ</span>}
                </td>
                <td data-label="สมัครเมื่อ">{thDate(u.created_at)}</td>
                <td data-label="เข้าระบบล่าสุด">{u.last_sign_in_at ? ago(u.last_sign_in_at) + (ago(u.last_sign_in_at).match(/^\d/) ? "ที่แล้ว" : "") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > 500 && <p className="ad-count">แสดง 500 รายการแรก ใช้ช่องค้นหาเพื่อหาคนที่ต้องการ</p>}
    </section>
  );
}

// ---------- แพ็กเกจและสิทธิ์ ----------
function Packages({
  o,
  companies,
  grant,
  open,
  notify,
  changed,
  tick,
  initialPlan,
}: {
  o: Overview;
  companies: AdminCompany[];
  grant: (c: AdminCompany | "pick") => void;
  open: (id: string) => void;
  notify: (s: string) => void;
  changed: () => void;
  tick: number;
  initialPlan: string;
}) {
  const [grants, setGrants] = useState<AdminGrant[] | null>(null),
    [show, setShow] = useState<"active" | "all">("active");
  useEffect(() => {
    api("/admin/grants")
      .then(setGrants)
      .catch(() => setGrants([]));
  }, [tick]);
  const revoke = async (g: AdminGrant) => {
    if (!confirm(`ยกเลิกแพ็กเกจ ${planName[g.plan]} ที่มอบให้ ${g.company}?\nบริษัทจะกลับไปใช้แพ็กเกจเดิมก่อนได้รับสิทธิ์ ข้อมูลไม่หาย`)) return;
    try {
      await api("/admin/grants/" + g.id, { method: "DELETE" });
      notify("ยกเลิกสิทธิ์แล้ว");
      changed();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const now = Date.now(),
    shown = (grants || []).filter((g) => show === "all" || (!g.revoked_at && Date.parse(g.ends_at) > now)),
    granted = companies.filter((c) => c.via === "grant").length,
    value = (grants || []).filter((g) => !g.revoked_at).reduce((a, g) => a + priceOf(g.plan) * (g.days / 30), 0);
  return (
    <div className="ad-stack">
      <section className="card ad-card">
        <h3 className="ad-h">
          <Crown size={17} /> ใครใช้แพ็กเกจอะไร
          <button className="ad-btn primary" onClick={() => grant("pick")}>
            <Gift size={15} /> มอบแพ็กเกจ
          </button>
        </h3>
        <PlanCards o={o} pick={() => undefined} />
        <div className="ad-mini" style={{ marginTop: 14 }}>
          <div style={{ "--b": "#dcfce7", "--t": "#15803d" } as CSSProperties}>
            <small>จ่ายเอง</small>
            <b>{companies.filter((c) => c.via === "paid").length}</b>
          </div>
          <div style={{ "--b": "#fce7f3", "--t": "#be185d" } as CSSProperties}>
            <small>แอดมินมอบ</small>
            <b>{granted}</b>
          </div>
          <div style={{ "--b": "#e0f2fe", "--t": "#0369a1" } as CSSProperties}>
            <small>ทดลองใช้</small>
            <b>{companies.filter((c) => c.via === "trial").length}</b>
          </div>
          <div style={{ "--b": "#f1f5f9", "--t": "#475569" } as CSSProperties}>
            <small>มูลค่าที่มอบทั้งหมด</small>
            <b>{baht(value)}</b>
          </div>
        </div>
      </section>
      <CompanyList companies={companies} open={open} grant={grant} initialPlan={initialPlan} />
      <section className="card ad-card">
        <h3 className="ad-h">
          <Gift size={17} /> ประวัติการมอบแพ็กเกจ
          <span className="ad-seg">
            <button className={show === "active" ? "on" : ""} onClick={() => setShow("active")}>
              กำลังใช้
            </button>
            <button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>
              ทั้งหมด
            </button>
          </span>
        </h3>
        {!grants ? (
          <Loading />
        ) : shown.length ? (
          <div className="ad-grants">
            {shown.map((g) => (
              <GrantRow key={g.id} g={g} open={open} revoke={revoke} />
            ))}
          </div>
        ) : (
          <p className="ad-empty">{show === "active" ? "ยังไม่มีสิทธิ์ที่มอบและยังใช้อยู่" : "ยังไม่เคยมอบแพ็กเกจ"}</p>
        )}
      </section>
    </div>
  );
}
const priceOf = (plan: string) => ({ starter: 2590, growth: 3590, business: 5990, enterprise: 9990 })[plan as "starter"] || 0;
function GrantRow({ g, open, revoke }: { g: AdminGrant; open?: (id: string) => void; revoke: (g: AdminGrant) => void }) {
  const live = !g.revoked_at && Date.parse(g.ends_at) > Date.now(),
    d = daysLeft(g.ends_at);
  return (
    <div className={"ad-grant" + (live ? "" : " off")}>
      <button className="ad-grant-co" onClick={() => open?.(g.company_id)}>
        <Avatar name={g.company || "?"} size={36} />
        <span>
          <b>{g.company || "บริษัท"}</b>
          <small>
            {grantKinds[g.kind]} · {g.days} วัน{g.extra_users ? ` · +${g.extra_users} ผู้ใช้` : ""}
          </small>
        </span>
      </button>
      <PlanChip plan={g.plan} />
      <span className="ad-grant-why" title={g.reason}>
        “{g.reason}”<small>โดย {g.granted_by} · {thDate(g.created_at)}</small>
      </span>
      <span className="ad-grant-end">
        {g.revoked_at ? (
          <span className="ad-muted">ยกเลิกแล้ว {thDate(g.revoked_at)}</span>
        ) : live ? (
          <span className={d !== null && d <= 7 ? "ad-due" : ""}>ถึง {thDate(g.ends_at)}</span>
        ) : (
          <span className="ad-muted">หมดแล้ว {thDate(g.ends_at)}</span>
        )}
      </span>
      {live && (
        <button className="ad-btn ghost danger" onClick={() => revoke(g)}>
          <Undo2 size={14} /> ยกเลิก
        </button>
      )}
    </div>
  );
}

function GrantDialog({ companies, initial, close, done }: { companies: AdminCompany[]; initial: AdminCompany | null; close: () => void; done: () => void }) {
  const [company, setCompany] = useState<AdminCompany | null>(initial),
    [q, setQ] = useState(""),
    [plan, setPlan] = useState<string>(initial && initial.plan !== "free" ? initial.plan : "growth"),
    [days, setDays] = useState(30),
    [custom, setCustom] = useState(""),
    [kind, setKind] = useState<GrantKind>("trial"),
    [extra, setExtra] = useState(0),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const s = q.trim().toLowerCase(),
    matches = s ? companies.filter((c) => [c.name, c.owner_email, c.owner_name].join(" ").toLowerCase().includes(s)).slice(0, 8) : companies.slice(0, 6),
    total = custom ? Number(custom) || 0 : days,
    ends = new Date(Date.now() + total * 86400000);
  const save = async () => {
    if (!company) return setError("เลือกบริษัทก่อน");
    if (!(total >= 1 && total <= 3660)) return setError("ระยะเวลาต้องอยู่ระหว่าง 1–3,660 วัน");
    if (!reason.trim()) return setError("ใส่เหตุผลที่มอบแพ็กเกจ");
    setBusy(true);
    setError("");
    try {
      await api("/admin/grants", { method: "POST", body: { company_id: company.id, plan, kind, days: total, extra_users: extra, reason: reason.trim() } });
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="มอบแพ็กเกจ" onClose={close} className="ad-modal">
      <div className="ad-form">
        <div className="ad-field">
          <span>บริษัท</span>
          {company ? (
            <div className="ad-picked">
              <Avatar name={company.name} />
              <span>
                <b>{company.name}</b>
                <small>
                  ตอนนี้: <PlanChip plan={company.plan} /> {company.owner_email}
                </small>
              </span>
              {!initial && (
                <button className="ad-btn ghost" onClick={() => setCompany(null)}>
                  เปลี่ยน
                </button>
              )}
            </div>
          ) : (
            <div className="ad-pick">
              <label className="ad-find">
                <Search size={15} />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์ชื่อบริษัทหรืออีเมลเจ้าของ" />
              </label>
              {matches.map((c) => (
                <button key={c.id} onClick={() => setCompany(c)}>
                  <Avatar name={c.name} size={28} />
                  <span>
                    <b>{c.name}</b>
                    <small>{c.owner_email}</small>
                  </span>
                  <PlanChip plan={c.plan} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="ad-field">
          <span>แพ็กเกจ</span>
          <div className="ad-opts plans">
            {["starter", "growth", "business", "enterprise"].map((p) => (
              <button key={p} className={plan === p ? "on" : ""} style={{ "--pc": planColor[p][1], "--pg": grad(planColor[p]) } as CSSProperties} onClick={() => setPlan(p)}>
                <Crown size={14} /> {planName[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="ad-field">
          <span>ระยะเวลา</span>
          <div className="ad-opts">
            {[
              [7, "7 วัน"],
              [14, "14 วัน"],
              [30, "1 เดือน"],
              [90, "3 เดือน"],
              [365, "1 ปี"],
            ].map(([d, l]) => (
              <button key={d} className={!custom && days === d ? "on" : ""} onClick={() => (setDays(Number(d)), setCustom(""))}>
                {l}
              </button>
            ))}
            <label className={"ad-custom" + (custom ? " on" : "")}>
              <input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="กำหนดเอง" />
              วัน
            </label>
          </div>
          <small className="ad-hint">ใช้ได้ถึงประมาณ {ends.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })} (ถ้าเป็นแพ็กเกจเดิมที่ยังไม่หมด จะต่อจากวันหมดเดิม)</small>
        </div>
        <div className="ad-field">
          <span>ประเภท</span>
          <div className="ad-opts">
            {(Object.keys(grantKinds) as GrantKind[]).map((k) => (
              <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                {grantKinds[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="ad-field two">
          <label>
            <span>เพิ่มที่นั่งผู้ใช้ (ไม่บังคับ)</span>
            <input type="number" min={0} max={1000} value={extra} onChange={(e) => setExtra(Math.max(0, Math.min(1000, Number(e.target.value) || 0)))} />
          </label>
          <label>
            <span>เหตุผล *</span>
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้าพาร์ทเนอร์ ทดลองใช้ก่อนตัดสินใจ" />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="ad-actions">
          <button className="ad-btn ghost" onClick={close}>
            ยกเลิก
          </button>
          <button className="ad-btn primary" onClick={save} disabled={busy}>
            <Gift size={15} /> {busy ? "กำลังมอบ…" : `มอบ ${planName[plan]} ${total} วัน`}
          </button>
        </div>
        <p className="ad-hint">ลูกค้าเปลี่ยนเป็นแพ็กเกจนี้ทันที และระบบบันทึกว่าใครมอบ เมื่อไร เพราะอะไร ยกเลิกได้ภายหลัง (กลับไปแพ็กเกจเดิม ข้อมูลไม่หาย)</p>
      </div>
    </Modal>
  );
}

// ---------- รายละเอียดบริษัท ----------
function CompanyDrawer({
  id,
  tick,
  close,
  grant,
  notify,
  changed,
}: {
  id: string;
  tick: number;
  close: () => void;
  grant: (c: AdminCompany) => void;
  notify: (s: string) => void;
  changed: () => void;
}) {
  const [data, setData] = useState<{ company: AdminCompany; members: { email: string; name: string; role: string; disabled: boolean; user_id: string }[]; grants: AdminGrant[]; payments: { id: string; amount: number; status: string; created_at: string; plan: string }[] } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/admin/companies/" + id)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [id, tick]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    document.body.classList.add("ad-lock");
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.classList.remove("ad-lock");
    };
  }, [close]);
  const revoke = async (g: AdminGrant) => {
    if (!confirm(`ยกเลิกแพ็กเกจ ${planName[g.plan]} ที่มอบให้?`)) return;
    try {
      await api("/admin/grants/" + g.id, { method: "DELETE" });
      notify("ยกเลิกสิทธิ์แล้ว");
      changed();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const c = data?.company;
  const roles: Record<string, string> = { owner: "เจ้าของ", manager: "ผู้จัดการ", staff: "พนักงาน", viewer: "ผู้ชม" };
  // On <body>: the workspace's animated page would otherwise trap position: fixed.
  return createPortal(
    <>
      <div className="ad-scrim" onClick={close} aria-hidden="true" />
      <aside className="ad-drawer" role="dialog" aria-label="รายละเอียดบริษัท">
        <button className="ad-close" onClick={close} aria-label="ปิด">
          <X size={18} />
        </button>
        {error ? (
          <p className="form-error">{error}</p>
        ) : !c || !data ? (
          <Loading />
        ) : (
          <>
            <div className="ad-dhead" style={{ background: `linear-gradient(135deg, ${planColor[c.plan][0]}33, #fff 70%)` }}>
              <Avatar name={c.name} size={56} />
              <div>
                <h2>{c.name}</h2>
                <p>{[c.industry, c.province].filter(Boolean).join(" · ") || "—"}</p>
                <div className="ad-dtags">
                  <PlanChip plan={c.plan} />
                  <ViaChip c={c} />
                </div>
              </div>
            </div>
            <div className="ad-dgrid">
              <Info label="เจ้าของ" value={c.owner_name || "—"} sub={c.owner_email} />
              <Info label="หมดอายุ" value={<Expiry at={c.period_end} />} sub={c.plan === "free" ? "แพ็กเกจฟรี" : c.cycle === "yearly" ? "รายปี" : "รายเดือน"} />
              <Info label="ผู้ใช้" value={<Seats c={c} />} />
              <Info label="สมัครเมื่อ" value={thDate(c.created_at)} sub={ago(c.created_at) + "ที่แล้ว"} />
            </div>
            <button className="ad-btn primary wide" onClick={() => grant(c)}>
              <Gift size={15} /> มอบแพ็กเกจให้บริษัทนี้
            </button>

            <h3 className="ad-h small">
              <Users size={16} /> สมาชิก ({data.members.length})
            </h3>
            <div className="ad-list">
              {data.members.map((m) => (
                <div key={m.user_id} className="ad-member">
                  <Avatar name={m.name || m.email} size={30} />
                  <span>
                    <b>{m.name || m.email.split("@")[0]}</b>
                    <small>{m.email}</small>
                  </span>
                  <span className={"ad-role r-" + (m.disabled ? "off" : m.role)}>{m.disabled ? "ระงับ" : roles[m.role] || m.role}</span>
                </div>
              ))}
            </div>

            <h3 className="ad-h small">
              <Gift size={16} /> แพ็กเกจที่แอดมินมอบ
            </h3>
            {data.grants.length ? (
              <div className="ad-grants compact">
                {data.grants.map((g) => (
                  <GrantRow key={g.id} g={{ ...g, company: c.name }} revoke={revoke} />
                ))}
              </div>
            ) : (
              <p className="ad-empty">ยังไม่เคยได้รับแพ็กเกจจากแอดมิน</p>
            )}

            <h3 className="ad-h small">
              <BadgeDollarSign size={16} /> ประวัติการชำระเงิน
            </h3>
            {data.payments.length ? (
              <div className="ad-list">
                {data.payments.map((p) => (
                  <div key={p.id} className="ad-member">
                    <i className="ad-pay" style={{ background: p.status === "verified" ? "#16a34a" : p.status === "pending" ? "#d97706" : "#94a3b8" }}>
                      <Coins size={14} />
                    </i>
                    <span>
                      <b>
                        {planName[p.plan] || p.plan} · {baht(Number(p.amount))}
                      </b>
                      <small>{thDate(p.created_at)}</small>
                    </span>
                    <span className={"ad-role r-" + (p.status === "verified" ? "manager" : p.status === "pending" ? "pending" : "off")}>
                      {p.status === "verified" ? "ยืนยันแล้ว" : p.status === "pending" ? "รอตรวจ" : "ปฏิเสธ"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="ad-empty">ยังไม่มีการชำระเงิน</p>
            )}
            <p className="ad-hint">หลังบ้านแสดงเฉพาะข้อมูลบัญชีและการใช้งาน ไม่แสดงข้อมูลธุรกิจภายในของลูกค้า</p>
          </>
        )}
      </aside>
    </>,
    document.body,
  );
}
function Info({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="ad-info">
      <small>{label}</small>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

// ---------- ค้นหา (Ctrl+K) ----------
function SearchPalette({ companies, close, open }: { companies: AdminCompany[]; close: () => void; open: (id: string) => void }) {
  const [q, setQ] = useState(""),
    [users, setUsers] = useState<AdminUser[]>([]),
    [cursor, setCursor] = useState(0);
  useEffect(() => {
    api("/admin/users")
      .then(setUsers)
      .catch(() => undefined);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [close]);
  const s = q.trim().toLowerCase(),
    hits = s
      ? [
          ...companies.filter((c) => [c.name, c.owner_email, c.owner_name, c.industry, c.province, c.id].join(" ").toLowerCase().includes(s)).map((c) => ({ id: c.id, title: c.name, sub: c.owner_email || c.industry, plan: c.plan, user: false })),
          ...users
            .filter((u) => [u.email, u.name].join(" ").toLowerCase().includes(s))
            .map((u) => ({ id: u.company_id, title: u.name || u.email, sub: u.email + " · " + u.company, plan: "", user: true })),
        ].slice(0, 12)
      : [];
  return createPortal(
    <div className="ad-palette-wrap" onClick={close}>
      <div className="ad-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="ค้นหา">
        <label className="ad-find big">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            onChange={(e) => (setQ(e.target.value), setCursor(0))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setCursor((c) => Math.min(hits.length - 1, c + 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setCursor((c) => Math.max(0, c - 1)));
              if (e.key === "Enter" && hits[cursor]) open(hits[cursor].id);
            }}
            placeholder="ค้นหาบริษัท อีเมล ชื่อผู้ใช้ จังหวัด…"
          />
          <kbd>Esc</kbd>
        </label>
        {s ? (
          hits.length ? (
            <div className="ad-hits">
              {hits.map((h, i) => (
                <button key={i} className={i === cursor ? "on" : ""} onMouseEnter={() => setCursor(i)} onClick={() => open(h.id)}>
                  {h.user ? (
                    <i className="ad-hit-ic">
                      <Users size={15} />
                    </i>
                  ) : (
                    <Avatar name={h.title} size={30} />
                  )}
                  <span>
                    <b>{h.title}</b>
                    <small>{h.sub}</small>
                  </span>
                  {h.plan && <PlanChip plan={h.plan} />}
                </button>
              ))}
            </div>
          ) : (
            <p className="ad-empty">ไม่พบ “{q}”</p>
          )
        ) : (
          <p className="ad-empty">พิมพ์อย่างน้อย 1 ตัวอักษร · ↑↓ เลือก · Enter เปิด</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Soon({ item }: { item: Item }) {
  return (
    <section className="card ad-card ad-soon-card">
      <i style={{ background: grad(item.c) }}>
        <item.icon size={30} />
      </i>
      <h2>{item.label} · กำลังพัฒนา</h2>
      <p>{item.soon}</p>
      <span className="ad-soon">อยู่ในแผนเฟสถัดไป</span>
    </section>
  );
}
