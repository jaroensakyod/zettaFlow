"use client";
// แผนก mega menu: colour-coded department cards with 6 shortcuts each, a search box, and a tools row.
import { useMemo, useState } from "react";
import {
  AppWindow, ArrowLeftRight, Award, BadgePercent, BookOpen, Building2, Calculator, CalendarClock, CalendarDays,
  CalendarOff, Car, ChartNoAxesCombined, ChevronDown, ClipboardCheck, Clock, CreditCard, Files, FileText, Gauge,
  Gavel, Landmark, ListTodo, MapPin, Megaphone, MessageCircle, Monitor, Package, PackageMinus, PackagePlus, Receipt,
  ReceiptText, Scale, Search, ShieldAlert, ShieldCheck, ShoppingCart, Target, Truck, UserPlus, UserRound, Users,
  Wallet, Wrench, type LucideIcon,
} from "lucide-react";
import { departmentMenu, baseView } from "@/lib/departments";

const icons: Record<string, LucideIcon> = {
  AppWindow, ArrowLeftRight, Award, BadgePercent, BookOpen, Building2, Calculator, CalendarClock, CalendarDays,
  CalendarOff, Car, ChartNoAxesCombined, ClipboardCheck, Clock, CreditCard, Files, FileText, Gauge, Gavel, Landmark,
  ListTodo, MapPin, Megaphone, MessageCircle, Monitor, Package, PackageMinus, PackagePlus, Receipt, ReceiptText, Scale,
  ShieldAlert, ShieldCheck, ShoppingCart, Target, Truck, UserPlus, UserRound, Users, Wallet, Wrench,
};
export const MenuIcon = ({ name, size = 16 }: { name: string; size?: number }) => {
  const C = icons[name] || FileText;
  return <C size={size} />;
};

export function DepartmentMegaMenu({
  view,
  visible,
  navigate,
}: {
  view: string;
  visible: (key: string) => boolean;
  navigate: (view: string) => void;
}) {
  const [query, setQuery] = useState("");
  // Each department is its own dropdown: one open at a time; a search opens every match.
  const [openId, setOpenId] = useState("");
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
    <div className="dept-menu" role="menu">
      <div className="dept-menu-head">
        <div>
          <h2>เลือกแผนกเพื่อเข้าสู่ระบบงาน</h2>
          <p>จัดการทุกแผนกในองค์กร เชื่อมต่อข้อมูลกันแบบครบวงจร</p>
        </div>
        <label className="dept-menu-search">
          <Search size={16} />
          <input autoFocus placeholder="ค้นหาเมนูหรือฟีเจอร์…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="ค้นหาเมนู" />
        </label>
      </div>
      {!cards.length && <p className="dept-menu-empty">ไม่พบเมนู “{query}”</p>}
      {/* Same layout as the design: 5 departments on top, 4 below (one grid while searching). */}
      {(q ? [cards] : [cards.slice(0, 5), cards.slice(5)]).filter((r) => r.length).map((row, i) => (
        <div key={i} className={"dept-menu-grid" + (q ? "" : row.length === 5 ? " cols-5" : " cols-4")}>
          {row.map((d) => (
          <section key={d.id} className={"dept-menu-card tone-" + d.tone}>
            <button className="dept-menu-title" aria-expanded={!!q || openId === d.id} onClick={() => setOpenId(openId === d.id ? "" : d.id)}>
              <span className="dept-menu-icon">
                <MenuIcon name={d.icon} size={22} />
              </span>
              <span>
                <b>
                  {d.title} <small>({d.en})</small>
                </b>
                <em>{d.subtitle}</em>
              </span>
              <ChevronDown size={16} className={"dept-menu-arrow" + (q || openId === d.id ? " flip" : "")} />
            </button>
            {(q || openId === d.id) && (
            <ul>
              {d.items.map((i) => (
                <li key={i.label}>
                  <button className={baseView(i.view) === view ? "active" : ""} onClick={() => navigate(i.view)}>
                    <MenuIcon name={i.icon} size={15} />
                    {i.label}
                  </button>
                </li>
              ))}
            </ul>
            )}
          </section>
        ))}
        </div>
      ))}

    </div>
  );
}
