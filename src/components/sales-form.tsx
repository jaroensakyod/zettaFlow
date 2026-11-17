"use client";
// เพิ่มยอดขาย: the sales form in coloured sections instead of a plain grid — a big amount card on top with quick
// amounts and the status, then what was sold, who bought it, and the sales channel as tap-to-pick chips.
import {
  CalendarDays, CheckCircle2, CircleDashed, Globe, Handshake, MessageCircle, Music2, NotebookPen, Phone, ShoppingBag,
  Store, ThumbsUp, Users, XCircle, Wallet,
} from "lucide-react";
import { catalog, statusLabels } from "@/lib/catalog";
import { FieldControl, type Option } from "./records";

const channels: [string, React.ComponentType<{ size?: number }>, string][] = [
  ["หน้าร้าน", Store, "#7c3aed"],
  ["ออนไลน์", Globe, "#2563eb"],
  ["LINE", MessageCircle, "#06c755"],
  ["Facebook", ThumbsUp, "#1d4ed8"],
  ["Shopee", ShoppingBag, "#ea580c"],
  ["Lazada", ShoppingBag, "#4f46e5"],
  ["TikTok", Music2, "#111827"],
  ["โทรศัพท์", Phone, "#0d9488"],
  ["ตัวแทนขาย", Handshake, "#db2777"],
];
const statusLook: Record<string, [React.ComponentType<{ size?: number }>, string]> = {
  draft: [CircleDashed, "amber"],
  confirmed: [CheckCircle2, "green"],
  cancelled: [XCircle, "red"],
};
const quick = [100, 500, 1000, 5000];
const fmt = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function SalesFields({ values, set, options }: { values: Record<string, unknown>; set: (k: string, v: unknown) => void; options: Option[] }) {
  const fields = catalog.sales.fields;
  const field = (k: string) => fields.find((f) => f.key === k)!;
  const control = (k: string) => <FieldControl field={field(k)} value={values[k]} set={(v) => set(k, v)} options={options} department="Sales" />;
  const amount = Number(values.amount) || 0;
  const status = String(values.status || "draft");
  const channel = String(values.channel || "");
  return (
    <>
      <section className="sf-hero">
        <div className="sf-hero-top">
          <span className="sf-hero-icon">
            <Wallet size={20} />
          </span>
          <div>
            <small>ยอดขายรายการนี้</small>
            <b>฿{fmt(amount)}</b>
          </div>
        </div>
        <label className="sf-amount">
          <span>ยอดขาย (บาท) *</span>
          <span className="sf-amount-box">
            <i>฿</i>
            <input type="number" name="amount" min={0} step="0.01" required inputMode="decimal" value={String(values.amount ?? "")} onFocus={(e) => e.currentTarget.select()} onChange={(e) => set("amount", e.target.value === "" ? "" : Number(e.target.value))} />
          </span>
        </label>
        <div className="sf-quick" aria-label="เพิ่มยอดเร็ว">
          {quick.map((q) => (
            <button key={q} type="button" onClick={() => set("amount", Math.round((amount + q) * 100) / 100)}>
              +{fmt(q)}
            </button>
          ))}
          {amount > 0 && (
            <button type="button" className="clear" onClick={() => set("amount", 0)}>
              ล้าง
            </button>
          )}
        </div>
        <div className="sf-status" role="radiogroup" aria-label="สถานะ">
          {(field("status").options || []).map((s) => {
            const [Icon, tone] = statusLook[s] || [CircleDashed, "amber"];
            return (
              <button key={s} type="button" role="radio" aria-checked={status === s} className={"t-" + tone + (status === s ? " on" : "")} onClick={() => set("status", s)}>
                <Icon size={15} /> {statusLabels[s] || s}
              </button>
            );
          })}
        </div>
      </section>

      <section className="ge-section">
        <header>
          <span className="ge-icon">
            <ShoppingBag size={17} />
          </span>
          <div>
            <h3>ขายอะไร เมื่อไหร่</h3>
            <small>ชื่อรายการที่ขาย และวันที่ขาย</small>
          </div>
        </header>
        <div className="form-grid">
          {control("name")}
          {control("date")}
        </div>
      </section>

      <section className="ge-section tone-blue">
        <header>
          <span className="ge-icon">
            <Users size={17} />
          </span>
          <div>
            <h3>ลูกค้าและโครงการ</h3>
            <small>ไม่บังคับ · ช่วยให้รายงานยอดขายแยกตามลูกค้าและโครงการได้</small>
          </div>
        </header>
        <div className="form-grid">
          {control("customerId")}
          {control("projectId")}
        </div>
      </section>

      <section className="ge-section tone-pink">
        <header>
          <span className="ge-icon">
            <Store size={17} />
          </span>
          <div>
            <h3>ช่องทางการขาย</h3>
            <small>แตะเลือก หรือพิมพ์ช่องทางอื่นเอง</small>
          </div>
        </header>
        <div className="sf-channels" role="radiogroup" aria-label="ช่องทาง">
          {channels.map(([label, Icon, color]) => (
            <button key={label} type="button" role="radio" aria-checked={channel === label} className={channel === label ? "on" : ""} style={{ "--cc": color } as React.CSSProperties} onClick={() => set("channel", channel === label ? "" : label)}>
              <span>
                <Icon size={15} />
              </span>
              {label}
            </button>
          ))}
        </div>
        <label className="sf-channel-other">
          ช่องทาง (พิมพ์เองได้)
          <input name="channel" value={channel} maxLength={120} placeholder="เช่น งานแฟร์, ขายส่ง" onChange={(e) => set("channel", e.target.value)} />
        </label>
      </section>

      <section className="ge-section tone-teal">
        <header>
          <span className="ge-icon">
            <NotebookPen size={17} />
          </span>
          <div>
            <h3>รายละเอียด</h3>
            <small>สินค้า จำนวน ส่วนลด หรือหมายเหตุอื่นๆ</small>
          </div>
        </header>
        <div className="form-grid">{control("notes")}</div>
      </section>
      <p className="sf-foot">
        <CalendarDays size={13} /> บันทึกแล้วยอดขายเข้ารายงานและกราฟภาพรวมทันที
      </p>
    </>
  );
}
