"use client";
// Choosing a LINE group's department: coloured cards with an icon each, instead of a plain drop-down.
// Works controlled (value / onChange) and inside a plain <form> (name → a hidden input).
import { useState } from "react";
import {
  BarChart3, Briefcase, Building2, CalendarHeart, Check, Code2, Database, Headset, Megaphone, Package, Palette, Scale,
  ShoppingCart, Users, Wallet, Wrench, CircleDashed, type LucideIcon,
} from "lucide-react";
import { deptThai } from "@/lib/line-message";

/** Icon and colour per department (also the สิทธิ์การใช้งาน rows). */
export const deptLook: Record<string, [LucideIcon, string]> = {
  Finance: [Wallet, "#16a34a"],
  HR: [Users, "#db2777"],
  Warehouse: [Package, "#2563eb"],
  Sales: [BarChart3, "#7c3aed"],
  Marketing: [Megaphone, "#e11d48"],
  IT: [Code2, "#0891b2"],
  Operations: [Wrench, "#ea580c"],
  Purchasing: [ShoppingCart, "#0d9488"],
  Legal: [Scale, "#475569"],
  Event: [CalendarHeart, "#c026d3"],
  Admin: [Building2, "#4f46e5"],
  Design: [Palette, "#f59e0b"],
  "Customer Service": [Headset, "#0ea5e9"],
  Data: [Database, "#6366f1"],
  "Business Development": [Briefcase, "#65a30d"],
};

export function DeptPicker({
  value,
  defaultValue = "",
  onChange,
  name,
  noneLabel = "ไม่ระบุ",
  noneHint = "เลือกทีหลังได้",
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  /** Inside a plain form: submitted as this field name. */
  name?: string;
  noneLabel?: string;
  noneHint?: string;
}) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const pick = (v: string) => (value === undefined && setOwn(v), onChange?.(v));
  const options: [string, string, LucideIcon, string][] = [
    ["", noneLabel, CircleDashed, "#8a86a3"],
    ...Object.entries(deptThai).map(([k, l]) => [k, l, ...(deptLook[k] || [Briefcase, "#7c3aed"])] as [string, string, LucideIcon, string]),
  ];
  return (
    <div className="dpk" role="radiogroup" aria-label="แผนก">
      {name && <input type="hidden" name={name} value={current} />}
      {options.map(([k, label, Icon, color]) => {
        const on = current === k;
        return (
          <button
            key={k || "none"}
            type="button"
            role="radio"
            aria-checked={on}
            className={"dpk-item" + (on ? " on" : "") + (k ? "" : " none")}
            style={{ "--dc": color } as React.CSSProperties}
            onClick={() => pick(k)}
          >
            <span className="dpk-icon">
              <Icon size={17} />
            </span>
            <span className="dpk-text">
              <b>{label.replace(/^ฝ่าย\s?/, "")}</b>
              {!k && <small>{noneHint}</small>}
            </span>
            {on && (
              <i className="dpk-check">
                <Check size={12} />
              </i>
            )}
          </button>
        );
      })}
    </div>
  );
}
