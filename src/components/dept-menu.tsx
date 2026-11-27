"use client";
// แผนก mega menu: colour-coded department cards with 6 shortcuts each, a search box, and a tools row.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type PointerEventHandler } from "react";
import {
  AppWindow, ArrowLeftRight, Award, BadgePercent, BookOpen, Building2, Calculator, CalendarClock, CalendarDays,
  CalendarOff, Car, ChartNoAxesCombined, ChevronDown, ClipboardCheck, Clock, CreditCard, Files, FileText, Gauge,
  Gavel, Landmark, ListTodo, MapPin, Megaphone, MessageCircle, Monitor, Package, PackageMinus, PackagePlus, Receipt,
  ReceiptText, Scale, Search, ShieldAlert, ShieldCheck, ShoppingCart, Target, Truck, UserPlus, UserRound, Users,
  Wallet, Wrench, FileSpreadsheet, FilePen, FileClock, FileChartColumn, FileDigit, ScrollText, BadgeDollarSign,
  ChartColumn, Settings, TrendingUp, Store, Lock, ClipboardList, FolderKanban, Images, PackageX, Smile, Telescope, Handshake,
  Database, Headset, Palette, Briefcase, type LucideIcon,
} from "lucide-react";
import { departmentMenu, baseView } from "@/lib/departments";
import { subscriptionActive, type Subscription } from "@/lib/billing";
import { api } from "./shared";

// Which departments a package opens lives in lib/departments (the LINE worker checks it too).
import { departmentLocked, PACKAGE_DEPARTMENTS, SHOP_DEPARTMENTS } from "@/lib/departments";
export { FREE_DEPARTMENT, PACKAGE_DEPARTMENTS, departmentLocked } from "@/lib/departments";

const icons: Record<string, LucideIcon> = {
  AppWindow, ArrowLeftRight, Award, BadgePercent, BookOpen, Building2, Calculator, CalendarClock, CalendarDays,
  CalendarOff, Car, ChartNoAxesCombined, ClipboardCheck, Clock, CreditCard, Files, FileText, Gauge, Gavel, Landmark,
  ListTodo, MapPin, Megaphone, MessageCircle, Monitor, Package, PackageMinus, PackagePlus, Receipt, ReceiptText, Scale,
  ShieldAlert, ShieldCheck, ShoppingCart, Target, Truck, UserPlus, UserRound, Users, Wallet, Wrench,
  FileSpreadsheet, FilePen, FileClock, FileChartColumn, FileDigit, ScrollText, BadgeDollarSign, ChartColumn, Settings, TrendingUp, Store,
  ClipboardList, FolderKanban, Images, PackageX, Smile, Telescope, Handshake, Database, Headset, Palette, Briefcase,
};
/** The department the user last opened a page from; its sidebar wins when a page belongs to several. */
export const DEPT_KEY = "eliteflow-dept";
export const rememberDept = (id: string) => {
  try {
    sessionStorage.setItem(DEPT_KEY, id);
  } catch {}
};
export const MenuIcon = ({ name, size = 16 }: { name: string; size?: number }) => {
  const C = icons[name] || FileText;
  return <C size={size} />;
};

// Package departments open the package page; departments sold one by one open แผนก (buy there); the rest App Shop.
const unlockView = (id: string) => (PACKAGE_DEPARTMENTS.includes(id) ? "pricing" : SHOP_DEPARTMENTS.includes(id) ? "departments" : "store");
const lockText = (id: string) =>
  PACKAGE_DEPARTMENTS.includes(id) ? "ล็อกอยู่ · อัปเกรดแพ็กเกจเพื่อใช้งาน" : SHOP_DEPARTMENTS.includes(id) ? "ล็อกอยู่ · ซื้อระบบเพื่อใช้งาน" : "ล็อกอยู่ · เร็วๆ นี้";

export function DepartmentMegaMenu({
  view,
  visible,
  locked: noAccess = () => false,
  navigate,
  closing = false,
  onPointerEnter,
  onPointerLeave,
}: {
  view: string;
  visible: (key: string) => boolean;
  /** No ดู / ใช้งาน on this page (สิทธิ์การใช้งาน): listed with a lock, opens the lock screen. */
  locked?: (key: string) => boolean;
  navigate: (view: string) => void;
  closing?: boolean;
  onPointerEnter?: PointerEventHandler;
  onPointerLeave?: PointerEventHandler;
}) {
  const [query, setQuery] = useState("");
  // Each department is its own dropdown: one open at a time; a search opens every match.
  const [openId, setOpenId] = useState("");
  // A mouse opens a card just by pointing at it (touch still taps); a short delay lets the pointer cross gaps.
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const hoverOpen = (id: string) => (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(leaveTimer.current);
    setOpenId(id);
  };
  const hoverClose = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setOpenId(""), 140);
  };
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    api("/billing")
      .then((b: { subscription?: Subscription }) => setPaid(!!b.subscription && b.subscription.status === "active" && b.subscription.plan !== "free" && subscriptionActive(b.subscription)))
      .catch(() => setPaid(false));
  }, []);
  // Departments sold one by one: open once the company owns that system (App Shop).
  const [owned, setOwned] = useState<string[]>([]);
  useEffect(() => {
    api("/shop")
      .then((s: { modules?: { id: string; owned?: boolean }[] }) => setOwned((s.modules || []).filter((m) => m.owned).map((m) => m.id)))
      .catch(() => setOwned([]));
  }, []);
  const locked = (id: string) => departmentLocked(id, paid, owned);
  const q = query.trim().toLowerCase();
  const cards = useMemo(
    () =>
      departmentMenu
        .map((d) => ({
          ...d,
          items: d.items.filter(
            (i) => visible(baseView(i.view)) && (!q || (i.label + " " + d.title + " " + d.en).toLowerCase().includes(q)),
          ),
        }))
        .filter((d) => d.items.length),
    [q, visible],
  );
  return (
    <div
      className={"dept-menu" + (q ? " searching" : "") + (closing ? " closing" : "")}
      role="menu"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="dept-menu-head">
        <div>
          <h2>แผนกของฉัน</h2>
          <p>{paid ? "แพ็กเกจของคุณเปิดใช้ การตลาด · เซลล์ · จัดซื้อ · คลัง · HR แล้ว" : "บัญชีและการเงินใช้ได้ฟรี · อัปเกรดแพ็กเกจเพื่อปลดล็อก การตลาด · เซลล์ · จัดซื้อ · คลัง · HR"}</p>
        </div>
        <label className="dept-menu-search">
          <Search size={16} />
          <input autoFocus placeholder="ค้นหาเมนูหรือฟีเจอร์…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="ค้นหาเมนู" />
        </label>
      </div>
      {!cards.length && <p className="dept-menu-empty">ไม่พบเมนู “{query}”</p>}
      {/* One grid: 5 departments a row on wide screens, fewer on narrow ones without gaps. */}
      {[cards].filter((r) => r.length).map((row, i) => (
        <div key={i} className={"dept-menu-grid" + (q ? "" : " cols-5")}>
          {row.map((d, n) => {
          const lock = locked(d.id);
          const isOpen = !lock && (!!q || openId === d.id);
          return (
          <section
            key={d.id}
            className={"dept-menu-card tone-" + d.tone + (isOpen ? " open" : "") + (lock ? " locked" : "")}
            style={{ "--i": i * 5 + n } as CSSProperties}
            onPointerEnter={lock ? undefined : hoverOpen(d.id)}
            onPointerLeave={lock ? undefined : hoverClose}
          >
            {/* The title opens the department main page; the arrow toggles its list (pointing at the card does too). */}
            <div className="dept-menu-title">
              <button
                className="dept-menu-go"
                title={lock ? d.title + " · ล็อกอยู่" : "ไปหน้า" + d.title}
                onClick={() => {
                  if (lock) return navigate(unlockView(d.id));
                  rememberDept(d.id);
                  navigate(d.overview);
                }}
              >
                <span className="dept-menu-icon">
                  <MenuIcon name={d.icon} size={22} />
                </span>
                <span>
                  <b>
                    {d.title} <small>({d.en})</small>
                  </b>
                  <em>{lock ? lockText(d.id) : d.subtitle}</em>
                </span>
              </button>
              {lock ? (
                <button className="dept-menu-lock" aria-label={"ปลดล็อก" + d.title} onClick={() => navigate(unlockView(d.id))}>
                  <Lock size={15} />
                </button>
              ) : (
              <button
                className="dept-menu-toggle"
                aria-label={"เมนูย่อย" + d.title}
                aria-expanded={isOpen}
                onClick={() => setOpenId(openId === d.id ? "" : d.id)}
              >
                <ChevronDown size={16} className={"dept-menu-arrow" + (isOpen ? " flip" : "")} />
              </button>
              )}
            </div>
            {/* Always rendered so it can animate; inert while closed so hidden links can't take focus. */}
            <div className="dept-menu-drop" inert={!isOpen}>
            <ul>
              {d.items.map((i, k) => (
                <li key={i.label} style={{ "--k": k } as CSSProperties}>
                  <button className={baseView(i.view) === view ? "active" : ""} onClick={() => { rememberDept(d.id); navigate(i.view); }}>
                    <MenuIcon name={i.icon} size={15} />
                    {i.label}
                    {noAccess(baseView(i.view)) && <Lock size={12} className="lock-mark" aria-label="ล็อก" />}
                  </button>
                </li>
              ))}
            </ul>
            </div>
          </section>
          );
        })}
        </div>
      ))}

    </div>
  );
}
