"use client";
// แผนก mega menu: colour-coded department cards with 6 shortcuts each, a search box, and a tools row.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type PointerEventHandler } from "react";
import {
  AppWindow, ArrowLeftRight, Award, BadgePercent, BookOpen, Building2, Calculator, CalendarClock, CalendarDays,
  CalendarOff, Car, ChartNoAxesCombined, ChevronDown, ClipboardCheck, Clock, CreditCard, Files, FileText, Gauge,
  Gavel, Landmark, ListTodo, MapPin, Megaphone, MessageCircle, Monitor, Package, PackageMinus, PackagePlus, Receipt,
  ReceiptText, Scale, Search, ShieldAlert, ShieldCheck, ShoppingCart, Target, Truck, UserPlus, UserRound, Users,
  Wallet, Wrench, FileSpreadsheet, FilePen, FileClock, FileChartColumn, FileDigit, ScrollText, BadgeDollarSign,
  ChartColumn, Settings, type LucideIcon,
} from "lucide-react";
import { departmentMenu, baseView } from "@/lib/departments";

const icons: Record<string, LucideIcon> = {
  AppWindow, ArrowLeftRight, Award, BadgePercent, BookOpen, Building2, Calculator, CalendarClock, CalendarDays,
  CalendarOff, Car, ChartNoAxesCombined, ClipboardCheck, Clock, CreditCard, Files, FileText, Gauge, Gavel, Landmark,
  ListTodo, MapPin, Megaphone, MessageCircle, Monitor, Package, PackageMinus, PackagePlus, Receipt, ReceiptText, Scale,
  ShieldAlert, ShieldCheck, ShoppingCart, Target, Truck, UserPlus, UserRound, Users, Wallet, Wrench,
  FileSpreadsheet, FilePen, FileClock, FileChartColumn, FileDigit, ScrollText, BadgeDollarSign, ChartColumn, Settings,
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

export function DepartmentMegaMenu({
  view,
  visible,
  navigate,
  closing = false,
  onPointerEnter,
  onPointerLeave,
}: {
  view: string;
  visible: (key: string) => boolean;
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
          {row.map((d, n) => (
          <section
            key={d.id}
            className={"dept-menu-card tone-" + d.tone + (q || openId === d.id ? " open" : "")}
            style={{ "--i": i * 5 + n } as CSSProperties}
            onPointerEnter={hoverOpen(d.id)}
            onPointerLeave={hoverClose}
          >
            {/* The title opens the department main page; the arrow toggles its list (pointing at the card does too). */}
            <div className="dept-menu-title">
              <button
                className="dept-menu-go"
                title={"ไปหน้า" + d.title}
                onClick={() => {
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
                  <em>{d.subtitle}</em>
                </span>
              </button>
              <button
                className="dept-menu-toggle"
                aria-label={"เมนูย่อย" + d.title}
                aria-expanded={!!q || openId === d.id}
                onClick={() => setOpenId(openId === d.id ? "" : d.id)}
              >
                <ChevronDown size={16} className={"dept-menu-arrow" + (q || openId === d.id ? " flip" : "")} />
              </button>
            </div>
            {/* Always rendered so it can animate; inert while closed so hidden links can't take focus. */}
            <div className="dept-menu-drop" inert={!q && openId !== d.id}>
            <ul>
              {d.items.map((i, k) => (
                <li key={i.label} style={{ "--k": k } as CSSProperties}>
                  <button className={baseView(i.view) === view ? "active" : ""} onClick={() => { rememberDept(d.id); navigate(i.view); }}>
                    <MenuIcon name={i.icon} size={15} />
                    {i.label}
                  </button>
                </li>
              ))}
            </ul>
            </div>
          </section>
        ))}
        </div>
      ))}

    </div>
  );
}
