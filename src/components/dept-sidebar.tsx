"use client";
// Left sidebar on every department page: department name (back / switch), its pages with icons, groups with
// indented sub-pages, the current page highlighted, and an illustration card at the bottom.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { activeEntry, departmentMenu, sidebarOf, type DepartmentMenu } from "@/lib/departments";
import { MenuIcon, rememberDept } from "./dept-menu";

export function DepartmentSidebar({
  dept,
  view,
  navigate,
}: {
  dept: DepartmentMenu;
  /** Current page including its ?query, e.g. "expenses?filter=pending". */
  view: string;
  navigate: (view: string) => void;
}) {
  const [switching, setSwitching] = useState(false),
    ref = useRef<HTMLDivElement>(null);
  const current = activeEntry(dept, view);
  useEffect(() => {
    if (!switching) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setSwitching(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [switching]);
  const go = (to: string) => {
    rememberDept(dept.id);
    navigate(to);
  };
  return (
    <aside className={"dept-side tone-" + dept.tone} aria-label={"เมนู" + dept.title}>
      <div className="dept-side-head" ref={ref}>
        <button className="dept-side-back" aria-label="กลับไปหน้าแผนกทั้งหมด" onClick={() => navigate("departments")}>
          <ChevronLeft size={18} />
        </button>
        <button className="dept-side-title" aria-expanded={switching} onClick={() => setSwitching(!switching)}>
          <span>{dept.title}</span>
          <ChevronDown size={17} />
        </button>
        {switching && (
          <ul className="dept-side-switch" role="menu">
            {departmentMenu.map((d) => (
              <li key={d.id}>
                <button
                  role="menuitem"
                  className={d.id === dept.id ? "active" : ""}
                  onClick={() => {
                    setSwitching(false);
                    rememberDept(d.id);
                    navigate(d.overview);
                  }}
                >
                  <MenuIcon name={d.icon} size={16} />
                  {d.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <nav className="dept-side-nav">
        {sidebarOf(dept).map((item) => {
          const inGroup = item.children?.some((c) => c === current);
          return (
            <div key={item.label} className={"dept-side-group" + (inGroup ? " open" : "")}>
              <button
                className={"dept-side-item" + (item === current ? " active" : "") + (inGroup ? " parent" : "")}
                aria-current={item === current ? "page" : undefined}
                onClick={() => go(item.view)}
              >
                <MenuIcon name={item.icon} size={22} />
                <span>{item.label}</span>
              </button>
              {!!item.children?.length && (
                <div className="dept-side-sub">
                  {item.children.map((c) => (
                    <button
                      key={c.label}
                      className={"dept-side-item sub" + (c === current ? " active" : "")}
                      aria-current={c === current ? "page" : undefined}
                      onClick={() => go(c.view)}
                    >
                      <MenuIcon name={c.icon} size={16} />
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="dept-side-card">
        {dept.id === "accounting" ? (
          <Illustration />
        ) : (
          <span className="dept-side-badge" aria-hidden="true">
            <i />
            <i />
            <b>
              <MenuIcon name={dept.icon} size={34} />
            </b>
          </span>
        )}
        <strong>{dept.tagline?.[0] || dept.title}</strong>
        <span>{dept.tagline?.[1] || dept.subtitle}</span>
        <button aria-label={"ไปหน้าหลัก" + dept.title} onClick={() => go(dept.overview)}>
          <ChevronRight size={16} />
        </button>
      </div>
    </aside>
  );
}

// Documents, a calculator, coins and a small pie chart, coloured from the department tone.
function Illustration() {
  return (
    <svg className="dept-side-art" viewBox="0 0 180 120" aria-hidden="true">
      <defs>
        <linearGradient id="ds-calc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7b8cff" />
          <stop offset="1" stopColor="#4a3fd8" />
        </linearGradient>
        <linearGradient id="ds-coin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd56a" />
          <stop offset="1" stopColor="#f0a92a" />
        </linearGradient>
      </defs>
      <rect x="22" y="14" width="78" height="62" rx="9" fill="#ece9fb" transform="rotate(-10 61 45)" />
      <rect x="30" y="20" width="80" height="64" rx="9" fill="#fff" stroke="#e3defa" transform="rotate(-6 70 52)" />
      <g transform="rotate(-6 70 52)" fill="#d9d3f6">
        <rect x="40" y="32" width="40" height="5" rx="2.5" fill="var(--tone, #7c5ce0)" opacity=".55" />
        <rect x="40" y="44" width="56" height="4" rx="2" />
        <rect x="40" y="54" width="48" height="4" rx="2" />
        <rect x="40" y="64" width="34" height="4" rx="2" />
      </g>
      <path d="M128 10a16 16 0 1 1-16 16h16z" fill="#f2638f" />
      <path d="M128 26V10a16 16 0 0 0-16 16z" fill="#7c5ce0" />
      <g transform="rotate(12 128 74)">
        <rect x="104" y="38" width="48" height="66" rx="9" fill="url(#ds-calc)" />
        <rect x="111" y="45" width="34" height="12" rx="3" fill="#dfe4ff" />
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => <rect key={r + "-" + c} x={111 + c * 12} y={62 + r * 12} width="9" height="8" rx="2" fill="#fff" opacity=".92" />),
        )}
      </g>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <ellipse cx={30} cy={104 - i * 7} rx="16" ry="5.5" fill="#e09a1c" />
          <ellipse cx={30} cy={101 - i * 7} rx="16" ry="5.5" fill="url(#ds-coin)" />
        </g>
      ))}
      <ellipse cx={54} cy={108} rx="13" ry="4.5" fill="#e09a1c" />
      <ellipse cx={54} cy={105} rx="13" ry="4.5" fill="url(#ds-coin)" />
    </svg>
  );
}
