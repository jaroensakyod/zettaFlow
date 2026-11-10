"use client";
// แพ็กเกจบริการ: the current package as a hero with its quota meters, then one colourful card per package. Clicking a
// card opens its full detail — price by month/year, quotas, the departments it unlocks, what every company gets free,
// support — with the pay buttons for the owner.
import { useEffect, useState, type CSSProperties } from "react";
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
  { label: "การตลาด", icon: Megaphone },
  { label: "เซลล์", icon: TrendingUp },
  { label: "จัดซื้อ", icon: ShoppingCart },
  { label: "คลังสินค้า", icon: Package },
  { label: "ระบบ HR", icon: Users },
];
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
    [open, setOpen] = useState<Plan | null>(null);
  const best = plans.find((p) => p.id === "growth")?.id || plans[Math.floor(plans.length / 2)]?.id;
  return (
    <section className="pk">
      <div className="pk-head">
        <div>
          <h2>
            <Sparkles size={20} /> เลือกแพ็กเกจที่ใช่สำหรับธุรกิจคุณ
          </h2>
          <p>กดที่แพ็กเกจเพื่อดูรายละเอียดทั้งหมด · ราคายังไม่รวม VAT 7%</p>
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
            <button key={p.id} className={"pk-card tone-" + t.tone + (p.id === best ? " best" : "") + (mine ? " mine" : "")} style={{ "--i": i } as CSSProperties} onClick={() => setOpen(p)}>
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
              <span className="pk-list">
                <span>
                  <MessagesSquare size={15} /> {p.line_groups === null ? "LINE ไม่จำกัดกลุ่ม" : `${p.line_groups} LINE Groups`}
                </span>
                <span>
                  <Sparkles size={15} /> AI ประมวลผล {n(p.documents)} รายการ/เดือน
                </span>
                <span>
                  <Mic size={15} /> ถอดเสียง {n(p.voice_minutes)} นาที/เดือน
                </span>
                <span>
                  <HardDrive size={15} /> พื้นที่จัดเก็บ {n(p.storage_gb, " GB")}
                </span>
                <span>
                  <Users size={15} /> ผู้ใช้ {n(p.users, " คน")}
                </span>
                <span className="pk-unlock">
                  <Unlock size={15} /> ปลดล็อก 5 ระบบ
                </span>
              </span>
              <span className="pk-more">
                {mine ? (
                  <>
                    <Check size={15} /> แพ็กเกจของคุณ
                  </>
                ) : (
                  <>
                    ดูรายละเอียด <ChevronRight size={15} />
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {open && <PlanDetail plan={open} cycle={cycle} setCycle={setCycle} mine={paid && open.id === current} owner={owner} onClose={() => setOpen(null)} onPay={(c) => { setOpen(null); onPay(open.id, c); }} />}
    </section>
  );
}

function PlanDetail({
  plan: p,
  cycle,
  setCycle,
  mine,
  owner,
  onClose,
  onPay,
}: {
  plan: Plan;
  cycle: "monthly" | "yearly";
  setCycle: (c: "monthly" | "yearly") => void;
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
    { icon: MessagesSquare, label: "กลุ่ม LINE", value: n(p.line_groups, " กลุ่ม") },
    { icon: Sparkles, label: "AI ประมวลผล / เดือน", value: n(p.documents, " รายการ") },
    { icon: Mic, label: "ถอดเสียง / เดือน", value: n(p.voice_minutes, " นาที") },
    { icon: HardDrive, label: "พื้นที่จัดเก็บ", value: n(p.storage_gb, " GB") },
    { icon: Users, label: "ผู้ใช้", value: n(p.users, " คน") },
    { icon: Workflow, label: "AI Workflows", value: n(p.workflows) },
    { icon: Headphones, label: "ซัพพอร์ต", value: p.support },
    { icon: Plug, label: "API", value: p.api === "—" ? "ไม่มี" : p.api },
    { icon: FileText, label: "เกินโควตา", value: "฿1 / รายการ" },
  ];
  return (
    <div className="pk-bg" onClick={onClose}>
      <div className={"pk-detail tone-" + t.tone} role="dialog" aria-modal="true" aria-label={"แพ็กเกจ " + p.name} onClick={(e) => e.stopPropagation()}>
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
          <h4>โควตาการใช้งาน</h4>
          <div className="pk-quota">
            {quotas.map((q, i) => (
              <div key={q.label} style={{ "--i": i } as CSSProperties}>
                <span>
                  <q.icon size={18} />
                </span>
                <small>{q.label}</small>
                <b>{q.value}</b>
              </div>
            ))}
          </div>
          <h4>
            <Unlock size={16} /> ปลดล็อกระบบสำคัญในแผนกของฉัน
          </h4>
          <div className="pk-chips unlock">
            {unlocks.map((u, i) => (
              <span key={u.label} style={{ "--i": i } as CSSProperties}>
                <u.icon size={15} /> {u.label}
              </span>
            ))}
          </div>
          <h4>
            <Check size={16} /> ใช้ได้ฟรีทุกบริษัท (รวมอยู่แล้ว)
          </h4>
          <div className="pk-chips free">
            {freeFeatures.map((f) => (
              <span key={f.label}>
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
