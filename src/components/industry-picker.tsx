"use client";
// Business-type filter for เครือข่ายธุรกิจ: a searchable, grouped picker (group list on the left, its types as chips on
// the right; typing ranks matches across every group).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  Building2, Check, ChevronDown, Search, Sprout, UtensilsCrossed, ShoppingBag, Factory, HardHat, Wrench, Megaphone, Cpu, Landmark,
  HeartPulse, GraduationCap, Plane, Truck, Car, Leaf, Shapes, X, Sparkles, type LucideIcon,
} from "lucide-react";
import { businessGroupOf, businessTypeGroups } from "@/lib/catalog";

/** One icon and colour per group, in catalog order. */
const groupLook: Record<string, [LucideIcon, string]> = {
  "เกษตร ประมง และปศุสัตว์": [Sprout, "#16a34a"],
  "อาหารและเครื่องดื่ม": [UtensilsCrossed, "#ea580c"],
  "ค้าปลีกและค้าส่ง": [ShoppingBag, "#db2777"],
  "การผลิตและอุตสาหกรรม": [Factory, "#475569"],
  "ก่อสร้าง อสังหาฯ และตกแต่ง": [HardHat, "#d97706"],
  "บริการทั่วไป": [Wrench, "#0891b2"],
  "อีเวนต์ การตลาด และสื่อ": [Megaphone, "#c026d3"],
  "เทคโนโลยีและดิจิทัล": [Cpu, "#2563eb"],
  "การเงิน ประกัน และวิชาชีพ": [Landmark, "#4f46e5"],
  "สุขภาพและความงาม": [HeartPulse, "#e11d48"],
  "การศึกษาและฝึกอบรม": [GraduationCap, "#7c3aed"],
  "ท่องเที่ยวและที่พัก": [Plane, "#0d9488"],
  "ขนส่งและโลจิสติกส์": [Truck, "#9333ea"],
  "ยานยนต์": [Car, "#dc2626"],
  "พลังงานและสิ่งแวดล้อม": [Leaf, "#65a30d"],
};
const look = (group: string): [LucideIcon, string] => groupLook[group] || [Shapes, "#6d28d9"];

type Option = { value: string; label: string; group: string; whole: boolean };
const allOptions: Option[] = businessTypeGroups.flatMap(([group, items]) => [
  { value: "group:" + group, label: "ทั้งหมวด" + group, group, whole: true },
  ...items.map((t) => ({ value: t, label: t, group, whole: false })),
]);
const words = (s: string) => s.toLowerCase().split(/[\s/()–\-,]+/).filter((w) => w.length > 1);

/** How well an option matches what was typed: exact start > word start > anywhere; a group-name hit counts too. */
function score(o: Option, q: string) {
  const label = o.label.toLowerCase(),
    group = o.group.toLowerCase();
  if (!q) return 0;
  if (label.startsWith(q) || (o.whole && group.startsWith(q))) return 100;
  if (words(o.label).some((w) => w.startsWith(q))) return 80;
  if (label.includes(q)) return 60;
  if (group.includes(q)) return o.whole ? 50 : 30;
  return 0;
}

export const industryLabel = (value: string) => (!value ? "ทุกประเภทธุรกิจ" : value.startsWith("group:") ? "ทั้งหมวด" + value.slice(6) : value);

/**
 * Business-type picker. As a filter (default) it offers "all" and whole groups; with `field` it fills a form field:
 * one exact type, "ไม่ระบุ" to clear, and the typed text itself when nothing in the list fits.
 */
export function IndustryPicker({
  value,
  onChange,
  field = false,
  placeholder = "เลือกประเภทธุรกิจ",
  allLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  field?: boolean;
  placeholder?: string;
  /** Filter mode: text of the "everything" choice (default ทุกประเภทธุรกิจ). */
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [group, setGroup] = useState(businessGroupOf(value) || (value.startsWith("group:") ? value.slice(6) : businessTypeGroups[0][0])),
    [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const query = q.trim().toLowerCase();
  const results = useMemo(
    () =>
      query
        ? allOptions
            .map((o) => ({ o, s: score(o, query) }))
            .filter((r) => r.s > 0 && !(field && r.o.whole))
            .sort((a, b) => b.s - a.s || a.o.label.length - b.o.label.length)
            .slice(0, 40)
            .map((r) => r.o)
        : [],
    [query],
  );
  useEffect(() => {
    if (!open) return;
    const g = value.startsWith("group:") ? value.slice(6) : businessGroupOf(value);
    if (g) setGroup(g);
    input.current?.focus();
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // Inside a modal: close only the picker, not the dialog.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
    if (field && e.key === "Enter" && !results.length && q.trim()) (e.preventDefault(), pick(q.trim()));
    if (!results.length) return;
    if (e.key === "ArrowDown") (e.preventDefault(), setCursor((c) => Math.min(results.length - 1, c + 1)));
    if (e.key === "ArrowUp") (e.preventDefault(), setCursor((c) => Math.max(0, c - 1)));
    if (e.key === "Enter") (e.preventDefault(), pick(results[cursor].value));
  };
  const [Icon, color] = value ? look(value.startsWith("group:") ? value.slice(6) : businessGroupOf(value)) : [Building2, "#6d28d9"];
  const items = businessTypeGroups.find(([g]) => g === group)?.[1] || [];
  return (
    <div className={"ip" + (field ? " ip-field" : "")} ref={box}>
      <button type="button" className={"ip-trigger" + (value ? " set" : "") + (field ? " field" : "")} style={{ "--ic": color } as CSSProperties} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon size={15} />
        <span>{field ? value || placeholder : !value && allLabel ? allLabel : industryLabel(value)}</span>
        <ChevronDown size={14} className={open ? "flip" : ""} />
      </button>
      {open && (
        <div className="ip-pop" role="dialog" aria-label="เลือกประเภทธุรกิจ">
          <label className="ip-search">
            <Search size={15} />
            <input
              ref={input}
              value={q}
              placeholder="พิมพ์ค้นหาประเภทธุรกิจ เช่น คาเฟ่, ก่อสร้าง, บัญชี"
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKey}
            />
            {q && (
              <button type="button" aria-label="ล้างคำค้น" onClick={() => setQ("")}>
                <X size={14} />
              </button>
            )}
          </label>
          {query ? (
            <div className="ip-results">
              {results.length ? (
                results.map((o, i) => {
                  const [GI, gc] = look(o.group);
                  return (
                    <button
                      type="button"
                      key={o.value}
                      className={"ip-result" + (i === cursor ? " on" : "") + (o.value === value ? " picked" : "")}
                      style={{ "--ic": gc } as CSSProperties}
                      onPointerEnter={() => setCursor(i)}
                      onClick={() => pick(o.value)}
                    >
                      <span className="ip-dot">
                        <GI size={14} />
                      </span>
                      <span>
                        <b>{o.whole ? "ทั้งหมวด" : o.label}</b>
                        <small>{o.group}</small>
                      </span>
                      {o.value === value && <Check size={15} />}
                    </button>
                  );
                })
              ) : field ? (
                <button type="button" className="ip-custom" onClick={() => pick(q.trim())}>
                  <Check size={15} /> ใช้ “{q.trim()}” เป็นประเภทธุรกิจ
                </button>
              ) : (
                <p className="ip-empty">ไม่พบประเภทที่ตรงกับ “{q}”</p>
              )}
            </div>
          ) : (
            <div className="ip-body">
              <div className="ip-groups">
                <button type="button" className={"ip-group" + (!value ? " picked" : "")} style={{ "--ic": "#6d28d9" } as CSSProperties} onClick={() => pick("")}>
                  <Sparkles size={15} /> {field ? "ไม่ระบุ" : allLabel || "ทุกประเภทธุรกิจ"}
                </button>
                {businessTypeGroups.map(([g]) => {
                  const [GI, gc] = look(g);
                  return (
                    <button
                      type="button"
                      key={g}
                      className={"ip-group" + (g === group ? " on" : "")}
                      style={{ "--ic": gc } as CSSProperties}
                      onPointerEnter={() => setGroup(g)}
                      onFocus={() => setGroup(g)}
                      onClick={() => setGroup(g)}
                    >
                      <GI size={15} /> {g}
                    </button>
                  );
                })}
              </div>
              <div className="ip-types" style={{ "--ic": look(group)[1] } as CSSProperties} key={group}>
                <h4>
                  {(() => {
                    const GI = look(group)[0];
                    return <GI size={16} />;
                  })()}
                  {group}
                </h4>
                {!field && (
                  <button type="button" className={"ip-chip whole" + (value === "group:" + group ? " picked" : "")} onClick={() => pick("group:" + group)}>
                    ดูทั้งหมวด
                  </button>
                )}
                <div className="ip-chips">
                  {items.map((t) => (
                    <button type="button" key={t} className={"ip-chip" + (t === value ? " picked" : "")} onClick={() => pick(t)}>
                      {t === value && <Check size={13} />} {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
