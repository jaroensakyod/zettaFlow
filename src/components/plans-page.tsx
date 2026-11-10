"use client";
// แพ็กเกจบริการ: the current package as a hero with its quota meters, then one colourful card per package. Clicking a
// card opens its full detail — price by month/year, quotas, the departments it unlocks, what every company gets free,
// support — with the pay buttons for the owner.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  X, Sprout, TrendingUp, Building, Crown, Workflow, FileText, MessagesSquare, Users, Headphones, Plug, Lock, Unlock, Check,
  Sparkles, Megaphone, ShoppingCart, Truck, Package, UserRound, Calculator, Receipt, Network, LayoutDashboard, CalendarDays,
  Bell, Building2, FolderOpen, ChevronRight, CreditCard, CalendarRange, BadgePercent, Mic, HardDrive,
} from "lucide-react";
import { money } from "./shared";
import type { Plan } from "@/lib/billing";

type Tone = { icon: typeof Sprout; tone: string; tagline: string; who: string };
const toneOf: Record<string, Tone> = {
  starter: { icon: Sprout, tone: "blue", tagline: "เริ่มต้นธุรกิจให้เป็นระบบ", who: "ร้านค้า / ทีมเล็ก 1–5 คน" },
  growth: { icon: TrendingUp, tone: "violet", tagline: "ขยายทีม เพิ่มงานอัตโนมัติ", who: "SME ที่กำลังโต 5–25 คน" },
  business: { icon: Building, tone: "orange", tagline: "หลายแผนก หลายสาขา", who: "บริษัทหลายแผนก" },
  enterprise: { icon: Crown, tone: "pink", tagline: "ไม่จำกัด พร้อมทีมดูแลเฉพาะ", who: "องค์กรขนาดใหญ่" },
};
const tone = (id: string) => toneOf[id] || toneOf.growth;
const n = (v: number | null, unit = "") => (v === null ? "ไม่จำกัด" : v.toLocaleString("th-TH") + unit);

/** What a paid package unlocks in แผนกของฉัน (see dept-menu.tsx). */
const unlocks = [
  { label: "การตลาด", icon: Megaphone, c: "pink" },
  { label: "เซลล์", icon: TrendingUp, c: "violet" },
  { label: "จัดซื้อ", icon: ShoppingCart, c: "orange" },
  { label: "คลังสินค้า", icon: Package, c: "blue" },
  { label: "ระบบ HR", icon: Users, c: "amber" },
];
const palette = ["green", "violet", "blue", "pink", "amber", "teal", "orange", "indigo"];
/** Free for every company, paid or not. */
const freeFeatures = [
  { label: "AI ผ่าน LINE (1 กลุ่ม)", icon: MessagesSquare },
  { label: "ระบบบัญชี", icon: Calculator },
  { label: "ลูกค้า & Supplier", icon: Truck },
  { label: "ภาษี", icon: Receipt },
  { label: "จัดการเอกสาร", icon: FolderOpen },
  { label: "โปรไฟล์บริษัท", icon: Building2 },
  { label: "เครือข่ายธุรกิจ", icon: Network },
  { label: "Dashboard ภาพรวม", icon: LayoutDashboard },
  { label: "ตารางงาน", icon: CalendarDays },
  { label: "แจ้งเตือน", icon: Bell },
  { label: "ระบบพนักงาน", icon: UserRound },
];

export function PlanCards({
  plans,
  current,
  paid,
  owner,
  onPay,
}: {
  plans: Plan[];
  current: string;
  paid: boolean;
  owner: boolean;
  onPay: (plan: string, cycle: "monthly" | "yearly") => void;
}) {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly"),
    [open, setOpen] = useState<Plan | null>(null),
    // Opened by pointing (closes when the pointer leaves) or pinned by a click / tap.
    [pinned, setPinned] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => (clearTimeout(openTimer.current), clearTimeout(closeTimer.current)), []);
  const hoverIn = (p: Plan) => (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(closeTimer.current);
    clearTimeout(openTimer.current);
    if (open && pinned) return;
    openTimer.current = setTimeout(() => {
      setOpen(p);
      setPinned(false);
    }, open ? 120 : 380);
  };
  const hoverOut = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(openTimer.current);
    if (pinned) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), 260);
  };
  const close = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    setOpen(null);
    setPinned(false);
  };
  const best = plans.find((p) => p.id === "growth")?.id || plans[Math.floor(plans.length / 2)]?.id;
  return (
    <section className="pk">
      <div className="pk-head">
        <div>
          <h2>
            <Sparkles size={20} /> เลือกแพ็กเกจที่ใช่สำหรับธุรกิจคุณ
          </h2>
          <p>ราคายังไม่รวม VAT 7% · เปลี่ยนหรือยกเลิกแพ็กเกจได้ทุกเมื่อ</p>
        </div>
        <div className="pk-cycle" role="tablist" aria-label="รอบการชำระ">
          <button role="tab" aria-selected={cycle === "monthly"} className={cycle === "monthly" ? "on" : ""} onClick={() => setCycle("monthly")}>
            รายเดือน
          </button>
          <button role="tab" aria-selected={cycle === "yearly"} className={cycle === "yearly" ? "on" : ""} onClick={() => setCycle("yearly")}>
            รายปี <em>ฟรี 2 เดือน</em>
          </button>
        </div>
      </div>
      <div className="pk-grid">
        {plans.map((p, i) => {
          const t = tone(p.id),
            mine = paid && p.id === current;
          const price = cycle === "yearly" ? Math.round(p.yearly / 12) : p.monthly;
          return (
            <button key={p.id} className={"pk-card tone-" + t.tone + (p.id === best ? " best" : "") + (mine ? " mine" : "")} style={{ "--i": i } as CSSProperties}
              onPointerEnter={hoverIn(p)}
              onPointerLeave={hoverOut}
              onClick={() => {
                clearTimeout(openTimer.current);
                setOpen(p);
                setPinned(true);
              }}
            >
              {p.id === best && (
                <span className="pk-ribbon">
                  <Crown size={13} /> แนะนำ
                </span>
              )}
              <span className="pk-top">
                <span className="pk-ico">
                  <t.icon size={22} />
                </span>
                <span>
                  <b>{p.name}</b>
                  <small>{t.tagline}</small>
                </span>
              </span>
              <span className="pk-price">
                <strong>฿{money(price)}</strong>
                <span>/เดือน</span>
              </span>
              <small className="pk-bill">{cycle === "yearly" ? `จ่ายรายปี ฿${money(p.yearly)} · ประหยัด ฿${money(p.monthly * 12 - p.yearly)}` : `หรือรายปี ฿${money(p.yearly)}`}</small>
              {/* The quotas as coloured tiles: the number first, what it is underneath. */}
              <span className="pk-stats">
                {[
                  { icon: MessagesSquare, v: p.line_groups === null ? "∞" : String(p.line_groups), l: "กลุ่ม LINE", c: "green" },
                  { icon: Sparkles, v: n(p.documents), l: "AI รายการ/เดือน", c: "violet" },
                  { icon: Mic, v: n(p.voice_minutes), l: "นาทีถอดเสียง", c: "pink" },
                  { icon: HardDrive, v: n(p.storage_gb), l: "GB พื้นที่", c: "blue" },
                  { icon: Users, v: p.users === null ? "∞" : String(p.users), l: "ผู้ใช้ (คน)", c: "amber" },
                ].map((x) => (
                  <span key={x.l} className={"pk-stat c-" + x.c}>
                    <x.icon size={15} />
                    <b>{x.v}</b>
                    <small>{x.l}</small>
                  </span>
                ))}
              </span>
              <span className="pk-unlock-bar">
                <Unlock size={14} /> ปลดล็อก การตลาด · เซลล์ · จัดซื้อ · คลัง · HR
              </span>
              {mine && (
                <span className="pk-more">
                  <Check size={15} /> แพ็กเกจของคุณ
                </span>
              )}
            </button>
          );
        })}
      </div>
      {open && (
        <PlanDetail
          key={open.id}
          plan={open}
          cycle={cycle}
          setCycle={setCycle}
          mine={paid && open.id === current}
          owner={owner}
          hover={!pinned}
          onEnter={() => clearTimeout(closeTimer.current)}
          onLeave={hoverOut}
          onPin={() => setPinned(true)}
          onClose={close}
          onPay={(c) => {
            close();
            onPay(open.id, c);
          }}
        />
      )}
    </section>
  );
}

function PlanDetail({
  plan: p,
  cycle,
  setCycle,
  mine,
  owner,
  hover,
  onEnter,
  onLeave,
  onPin,
  onClose,
  onPay,
}: {
  plan: Plan;
  cycle: "monthly" | "yearly";
  setCycle: (c: "monthly" | "yearly") => void;
  hover: boolean;
  onEnter: () => void;
  onLeave: (e: PointerEvent) => void;
  onPin: () => void;
  mine: boolean;
  owner: boolean;
  onClose: () => void;
  onPay: (c: "monthly" | "yearly") => void;
}) {
  const t = tone(p.id);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const base = cycle === "yearly" ? p.yearly : p.monthly;
  const quotas = [
    { icon: MessagesSquare, label: "กลุ่ม LINE", value: n(p.line_groups, " กลุ่ม"), c: "green" },
    { icon: Sparkles, label: "AI ประมวลผล / เดือน", value: n(p.documents, " รายการ"), c: "violet" },
    { icon: Mic, label: "ถอดเสียง / เดือน", value: n(p.voice_minutes, " นาที"), c: "pink" },
    { icon: HardDrive, label: "พื้นที่จัดเก็บ", value: n(p.storage_gb, " GB"), c: "blue" },
    { icon: Users, label: "ผู้ใช้", value: n(p.users, " คน"), c: "amber" },
    { icon: Workflow, label: "AI Workflows", value: n(p.workflows), c: "teal" },
  ];
  const services = [
    { icon: Headphones, label: "ซัพพอร์ต", value: p.support, c: "indigo" },
    { icon: Plug, label: "API", value: p.api === "—" ? "ไม่มี" : p.api === "Optional" ? "เสริมได้" : "มี", c: "teal" },
    { icon: FileText, label: "เกินโควตา", value: "฿1 / รายการ · ระบบไม่หยุด", c: "orange" },
  ];
  return (
    // While only pointed at, the backdrop lets the pointer through (back to the cards); a click pins it open.
    <div className={"pk-bg" + (hover ? " hover" : "")} onClick={onClose}>
      <div
        className={"pk-detail tone-" + t.tone}
        role="dialog"
        aria-modal={!hover}
        aria-label={"แพ็กเกจ " + p.name}
        onPointerEnter={onEnter}
        onPointerLeave={(e) => hover && onLeave(e)}
        onClick={(e) => {
          e.stopPropagation();
          if (hover) onPin();
        }}
      >
        <header className="pk-dhead">
          <button className="pk-x" aria-label="ปิด" onClick={onClose}>
            <X size={18} />
          </button>
          <span className="pk-ico big">
            <t.icon size={30} />
          </span>
          <div>
            <small>แพ็กเกจ</small>
            <h3>{p.name}</h3>
            <p>
              {t.tagline} · เหมาะกับ {t.who}
            </p>
          </div>
          <div className="pk-dprice">
            <strong>฿{money(base)}</strong>
            <span>{cycle === "yearly" ? "/ปี" : "/เดือน"}</span>
            <div className="pk-cycle small">
              <button className={cycle === "monthly" ? "on" : ""} onClick={() => setCycle("monthly")}>
                รายเดือน
              </button>
              <button className={cycle === "yearly" ? "on" : ""} onClick={() => setCycle("yearly")}>
                รายปี
              </button>
            </div>
          </div>
        </header>
        <div className="pk-body">
          {cycle === "yearly" && (
            <p className="pk-save">
              <BadgePercent size={16} /> จ่ายรายปีประหยัด <b>฿{money(p.monthly * 12 - p.yearly)}</b> (ฟรี 2 เดือน) · เฉลี่ย ฿{money(Math.round(p.yearly / 12))}/เดือน
            </p>
          )}
          <h4>
            <Sparkles size={16} /> โควตาการใช้งาน
          </h4>
          <div className="pk-quota">
            {quotas.map((q, i) => (
              <div key={q.label} className={"c-" + q.c} style={{ "--i": i } as CSSProperties}>
                <span>
                  <q.icon size={18} />
                </span>
                <small>{q.label}</small>
                <b>{q.value}</b>
              </div>
            ))}
          </div>
          <div className="pk-services">
            {services.map((x) => (
              <span key={x.label} className={"c-" + x.c}>
                <x.icon size={15} />
                <small>{x.label}</small>
                <b>{x.value}</b>
              </span>
            ))}
          </div>
          <h4>
            <Unlock size={16} /> ปลดล็อกระบบสำคัญในแผนกของฉัน
          </h4>
          <div className="pk-chips unlock">
            {unlocks.map((u, i) => (
              <span key={u.label} className={"c-" + u.c} style={{ "--i": i } as CSSProperties}>
                <u.icon size={15} /> {u.label}
              </span>
            ))}
          </div>
          <h4>
            <Check size={16} /> ใช้ได้ฟรีทุกบริษัท (รวมอยู่แล้ว)
          </h4>
          <div className="pk-chips free">
            {freeFeatures.map((f, i) => (
              <span key={f.label} className={"c-" + palette[i % palette.length]}>
                <f.icon size={14} /> {f.label}
              </span>
            ))}
          </div>
          <p className="pk-note">
            <Lock size={13} /> Event · IT · กฎหมาย จะเปิดให้ใช้ในเร็วๆ นี้ · เกินโควตาระบบยังทำงานต่อ คิดส่วนเกินรอบบิลถัดไป
          </p>
        </div>
        <footer className="pk-foot">
          <span>
            {p.name} {cycle === "yearly" ? "รายปี" : "รายเดือน"} ฿{money(base)} + VAT 7% = <b>฿{(Math.round(base * 107) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
          </span>
          {mine ? (
            <span className="pk-mine">
              <Check size={15} /> แพ็กเกจที่ใช้อยู่
            </span>
          ) : owner ? (
            <button className="pk-buy" onClick={() => onPay(cycle)}>
              {cycle === "yearly" ? <CalendarRange size={16} /> : <CreditCard size={16} />} เลือกแพ็กเกจนี้ · ชำระ{cycle === "yearly" ? "รายปี" : "รายเดือน"}
            </button>
          ) : (
            <span className="pk-mine muted">เจ้าของบริษัทเป็นผู้เลือกแพ็กเกจ</span>
          )}
        </footer>
      </div>
    </div>
  );
}
