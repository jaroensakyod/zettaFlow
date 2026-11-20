"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { freePlan, plans as billingPlans, type Plan } from "@/lib/billing";

// The packages from billing.ts, written as the poster lists them.
const forWho: Record<string, string> = { starter: "ร้านค้า / ทีมเล็ก", growth: "SME ที่กำลังโต", business: "บริษัทหลายแผนก", enterprise: "องค์กร / หลายบริษัท" };
const num = (v: number | null, unit: string, none: string) => (v === null ? none : v.toLocaleString("th-TH") + unit);
// Built from the packages as priced now (the pages pass what the platform admin set; otherwise the shipped numbers).
const cards = (paidPlans: Plan[], freeP: Plan) => {
const free = {
  id: "free",
  name: "Free",
  for: "เริ่มต้นใช้งานได้เลย",
  monthly: 0,
  yearly: 0,
  popular: false,
  free: true,
  rows: [
    "LINE 1 กลุ่ม",
    "ระบบบัญชีและการเงิน ครบทุกเมนู",
    "AI ประมวลผล " + num(freeP.documents, " รายการ/เดือน", "ไม่จำกัด"),
    "ผู้ใช้ " + num(freeP.users, " คน", "ไม่จำกัด"),
    "ใช้ได้ตลอด ไม่มีวันหมดอายุ",
  ],
};
const paid = paidPlans.map((p) => ({
  id: p.id as string,
  name: p.name,
  for: forWho[p.id] || "",
  monthly: p.monthly,
  yearly: p.yearly,
  popular: p.id === "growth",
  rows: [
    num(p.line_groups, " LINE Groups", "LINE ไม่จำกัดกลุ่ม"),
    "AI ประมวลผล " + num(p.documents, " รายการ/เดือน", "ไม่จำกัด"),
    "ถอดเสียง " + num(p.voice_minutes, " นาที/เดือน", "ไม่จำกัด"),
    "พื้นที่จัดเก็บ " + num(p.storage_gb, " GB", "ไม่จำกัด"),
    "ผู้ใช้ " + num(p.users, " คน", "ไม่จำกัด"),
    "ปลดล็อก การตลาด · เซลล์ · จัดซื้อ · คลัง · HR",
    ...(p.id === "enterprise" ? ["บริการตั้งค่า + ซัพพอร์ต Exclusive"] : []),
  ],
  free: false,
}));
return [free, ...paid];
};

export function PricingCards({ prices }: { prices?: { plans: Plan[]; free: Plan } }) {
  const plans = useMemo(() => cards(prices?.plans || billingPlans, prices?.free || freePlan), [prices]);
  const [yearly, setYearly] = useState(false);
  // Phones: the packages in one row to swipe; the one in the middle grows. Starts on the popular one.
  const row = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(plans.findIndex((p) => p.popular));
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const swipe = () => window.matchMedia("(max-width: 860px)").matches;
    const center = () => {
      if (!swipe()) return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0,
        gap = Infinity;
      [...el.children].forEach((c, i) => {
        const card = c as HTMLElement,
          d = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
        if (d < gap) (gap = d), (best = i);
      });
      setActive(best);
    };
    // The first time the row comes into view, open it on the popular package (once laid out as a swipe row).
    let opened = false;
    const io = new IntersectionObserver((e) => {
      if (opened || !e[0]?.isIntersecting || !swipe() || el.scrollWidth <= el.clientWidth) return;
      opened = true;
      const start = el.children[plans.findIndex((p) => p.popular)] as HTMLElement | undefined;
      if (start) el.scrollLeft = start.offsetLeft - (el.clientWidth - start.offsetWidth) / 2;
      center();
    }, { threshold: 0.3 });
    io.observe(el);
    center();
    el.addEventListener("scroll", center, { passive: true });
    window.addEventListener("resize", center);
    return () => {
      io.disconnect();
      el.removeEventListener("scroll", center);
      window.removeEventListener("resize", center);
    };
  }, [plans]);
  const go = (i: number) => {
    const el = row.current,
      card = el?.children[i] as HTMLElement | undefined;
    if (el && card) el.scrollTo({ left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2, behavior: "smooth" });
  };
  return (
    <>
      <div className="lp-toggle" role="group" aria-label="รอบการชำระ">
        <button className={!yearly ? "on" : ""} onClick={() => setYearly(false)}>
          รายเดือน
        </button>
        <button className={yearly ? "on" : ""} onClick={() => setYearly(true)}>
          รายปี <em>ฟรี 2 เดือน</em>
        </button>
      </div>
      <div className="lp-plans" ref={row}>
        {plans.map((p, i) => (
          <article key={p.name} className={"pl-" + p.id + (p.popular ? " popular" : p.free ? " free" : "") + (i === active ? " active" : "")}>
            {p.popular && <span className="lp-badge">ยอดนิยม</span>}
            <div className="lp-plan-band" aria-hidden />
            <h3>{p.name}</h3>
            <p className="lp-muted">{p.for}</p>
            <div className="lp-price">
              <strong>{p.free ? "ฟรี" : "฿" + (yearly ? p.yearly : p.monthly).toLocaleString("th-TH")}</strong>
              <span>{p.free ? "ตลอดไป" : "/" + (yearly ? "ปี" : "เดือน")}</span>
            </div>
            <ul>
              {p.rows.map((r) => (
                <li key={r}>
                  <Check size={16} /> {r}
                </li>
              ))}
            </ul>
            <Link href="/feed?signup=1" className="lp-btn plan-btn">
              {p.free ? "เริ่มใช้ฟรีเลย" : "เริ่มใช้งาน"} <ArrowRight size={16} />
            </Link>
          </article>
        ))}
      </div>
      <div className="lp-plan-dots" aria-hidden>
        {plans.map((p, i) => (
          <button key={p.name} type="button" tabIndex={-1} className={"pl-" + p.id + (i === active ? " on" : "")} onClick={() => go(i)} />
        ))}
      </div>
      <p className="lp-fine">ราคายังไม่รวม VAT 7% · ไม่ต้องใช้บัตรเครดิต · ยกเลิกได้ทุกเมื่อ · Setup &amp; Onboarding ครั้งเดียว ฿3,000–10,000</p>
      <p className="lp-fine">แพ็กเกจฟรีใช้ได้ตลอด ไม่ต้องใช้บัตรเครดิต · อัปเกรดเมื่อพร้อม ข้อมูลเดิมอยู่ครบ</p>
    </>
  );
}

const faqs = [
  ["พนักงานต้องเปลี่ยนวิธีใช้ LINE ไหม?", "ไม่ต้องเลย LINE ของพนักงานเหมือนเดิม 100% แค่เพิ่มบอท EliteFlow เข้าไปในกลุ่ม แล้วส่งข้อความ รูป หรือไฟล์ตามปกติ"],
  ["ถ้าข้อมูลที่ส่งมาไม่ครบ จะเกิดอะไรขึ้น?", "AI ตรวจกับฟอร์มที่คุณกำหนด ถ้าขาดช่องไหนบอทจะทวงถามในกลุ่มทันที และเตือนซ้ำอัตโนมัติจนกว่าจะครบ"],
  ["ผู้จัดการอนุมัติงานยังไง?", "พิมพ์คีย์เวิร์ดที่ตั้งไว้ในแชท เช่น “อนุมัติปล่อยของ” ระบบจะอนุมัติและแตกงานต่อให้ทุกทีมที่เกี่ยวข้องทันที"],
  ["แชร์ Dashboard ให้คนนอกได้ไหม?", "ได้ สร้างลิงก์ที่ตั้งรหัสผ่านและวันหมดอายุได้ และเลือกได้ว่าจะให้เห็นกราฟไหนบ้าง"],
  ["ข้อมูลปลอดภัยแค่ไหน?", "แต่ละบริษัทแยกข้อมูลกันด้วย Row-Level Security เข้ารหัสระหว่างส่งและจัดเก็บ มีสิทธิ์ตามบทบาท และบันทึก Audit Log ทุกการกระทำ"],
];
export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="lp-faq">
      {faqs.map(([q, a], i) => (
        <div key={q} className={open === i ? "open" : ""}>
          <button aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
            {q}
            <ChevronDown size={18} />
          </button>
          <p>{a}</p>
        </div>
      ))}
    </div>
  );
}

type PromoItem = { id: string; title: string; body: string; cta_label: string; cta_url: string; tone: string };
/** Live promotions managed in the Admin Console. Renders nothing when there are none. */
export function PromoStrip() {
  const [items, setItems] = useState<PromoItem[]>([]);
  const [i, setI] = useState(0);
  useEffect(() => {
    fetch("/api/public-content", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { promos: [] }))
      .then((d) => setItems((d.promos || []).filter((p: { placement?: string }) => p.placement !== "feed")))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % items.length), 6000);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length) return null;
  const p = items[i % items.length];
  return (
    <div className={"lp-promo " + p.tone} role="region" aria-label="โปรโมชัน">
      <span className="lp-promo-tag">โปรโมชัน</span>
      <b>{p.title}</b>
      {p.body && <span className="lp-promo-body">{p.body}</span>}
      {p.cta_label && p.cta_url && (
        <a href={p.cta_url} className="lp-promo-cta">
          {p.cta_label} <ArrowRight size={14} />
        </a>
      )}
      {items.length > 1 && (
        <span className="lp-promo-dots" aria-hidden>
          {items.map((x, n) => (
            <i key={x.id} className={n === i % items.length ? "on" : ""} />
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * A row of cards that scrolls itself when it does not fit (phones): one card at a time every few seconds, back to
 * the start at the end; the card in the middle is marked active. Stops while touched or hovered, resumes after.
 */
export function AutoRow({ className, children, every = 3200 }: { className: string; children: React.ReactNode; every?: number }) {
  const row = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    let held = false,
      resume = 0;
    const cards = () => [...el.children] as HTMLElement[];
    const middle = () => {
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0,
        gap = Infinity;
      cards().forEach((c, i) => {
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (d < gap) (gap = d), (best = i);
      });
      setActive(best);
      return best;
    };
    const hold = () => {
      held = true;
      window.clearTimeout(resume);
    };
    const release = () => {
      window.clearTimeout(resume);
      resume = window.setTimeout(() => (held = false), 4000);
    };
    const tick = window.setInterval(() => {
      if (held || el.scrollWidth <= el.clientWidth + 4 || document.hidden) return;
      const list = cards(),
        next = (middle() + 1) % list.length,
        c = list[next];
      el.scrollTo({ left: next === 0 ? 0 : c.offsetLeft - (el.clientWidth - c.offsetWidth) / 2, behavior: "smooth" });
    }, every);
    el.addEventListener("scroll", middle, { passive: true });
    el.addEventListener("pointerdown", hold);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointerleave", release);
    el.addEventListener("touchstart", hold, { passive: true });
    el.addEventListener("touchend", release);
    middle();
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(resume);
      el.removeEventListener("scroll", middle);
      el.removeEventListener("pointerdown", hold);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointerleave", release);
      el.removeEventListener("touchstart", hold);
      el.removeEventListener("touchend", release);
    };
  }, [every]);
  return (
    <div className={className} ref={row} data-active={active}>
      {Array.isArray(children)
        ? children.map((c, i) => (
            <div key={i} className={"auto-item" + (i === active ? " on" : "")}>
              {c}
            </div>
          ))
        : children}
    </div>
  );
}
