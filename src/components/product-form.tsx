"use client";
// เพิ่มสต็อกสินค้า: the product form in coloured sections — a summary card on top (name, SKU, cost / price / profit
// per unit, status), then the product's details with unit chips, price and profit, and where it is kept.
import { Barcode, CheckCircle2, MapPin, Package, PauseCircle, Tag, TrendingUp, Wand2 } from "lucide-react";
import { catalog, statusLabels } from "@/lib/catalog";
import { FieldControl, type Option } from "./records";

const units = ["ชิ้น", "กล่อง", "แพ็ค", "ขวด", "ถุง", "ชุด", "กก.", "ลิตร", "เมตร"];
const used = ["name", "sku", "category", "unit", "cost", "price", "reorderLevel", "location", "status"];
const fmt = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

export function ProductFields({ values, set, options }: { values: Record<string, unknown>; set: (k: string, v: unknown) => void; options: Option[] }) {
  const fields = catalog.products.fields;
  const control = (k: string) => {
    const f = fields.find((x) => x.key === k);
    return f ? <FieldControl key={k} field={f} value={values[k]} set={(v) => set(k, v)} options={options} department="Warehouse" /> : null;
  };
  const rest = fields.filter((f) => !used.includes(f.key) && !f.hidden).map((f) => f.key);
  const cost = Number(values.cost) || 0,
    price = Number(values.price) || 0,
    profit = price - cost,
    margin = price > 0 ? (profit / price) * 100 : 0;
  const status = String(values.status || "active");
  const unit = String(values.unit || "");
  const sku = () => {
    const d = new Date();
    const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    set("sku", "SKU-" + ymd + "-" + String(Math.floor(Math.random() * 1000)).padStart(3, "0"));
  };
  return (
    <>
      <section className="pf-hero">
        <div className="pf-hero-top">
          <span className="pf-hero-icon">
            <Package size={22} />
          </span>
          <div>
            <b>{String(values.name || "") || "สินค้าใหม่"}</b>
            <small>
              <Barcode size={13} /> {String(values.sku || "") || "ยังไม่มีรหัส SKU"}
              {unit && " · หน่วย " + unit}
            </small>
          </div>
        </div>
        <div className="pf-stats">
          <span>
            <small>ต้นทุน/หน่วย</small>
            <b>฿{fmt(cost)}</b>
          </span>
          <span>
            <small>ราคาขาย</small>
            <b>฿{fmt(price)}</b>
          </span>
          <span className={profit < 0 ? "loss" : ""}>
            <small>กำไร/หน่วย</small>
            <b>
              ฿{fmt(profit)} {price > 0 && <em>{fmt(margin)}%</em>}
            </b>
          </span>
        </div>
        <div className="sf-status two" role="radiogroup" aria-label="สถานะ">
          {[
            ["active", CheckCircle2, "green"],
            ["inactive", PauseCircle, "red"],
          ].map(([s, Icon, tone]) => {
            const I = Icon as typeof CheckCircle2;
            return (
              <button key={s as string} type="button" role="radio" aria-checked={status === s} className={"t-" + tone + (status === s ? " on" : "")} onClick={() => set("status", s)}>
                <I size={15} /> {statusLabels[s as string] || (s as string)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="ge-section tone-blue">
        <header>
          <span className="ge-icon">
            <Tag size={17} />
          </span>
          <div>
            <h3>ข้อมูลสินค้า</h3>
            <small>ชื่อ รหัส หมวดหมู่ และหน่วยนับ</small>
          </div>
          <button type="button" className="ge-copy" onClick={sku}>
            <Wand2 size={13} /> สร้างรหัส SKU
          </button>
        </header>
        <div className="form-grid">
          {control("name")}
          {control("sku")}
          {control("category")}
          {control("unit")}
        </div>
        <div className="pf-units" aria-label="หน่วยที่ใช้บ่อย">
          {units.map((u) => (
            <button key={u} type="button" className={unit === u ? "on" : ""} onClick={() => set("unit", u)}>
              {u}
            </button>
          ))}
        </div>
      </section>

      <section className="ge-section tone-green">
        <header>
          <span className="ge-icon">
            <TrendingUp size={17} />
          </span>
          <div>
            <h3>ราคาและกำไร</h3>
            <small>ระบบคำนวณกำไรต่อหน่วยให้อัตโนมัติ</small>
          </div>
          {price > 0 && <span className={"pf-margin" + (profit < 0 ? " loss" : "")}>กำไร {fmt(margin)}%</span>}
        </header>
        <div className="form-grid">
          {control("cost")}
          {control("price")}
        </div>
      </section>

      <section className="ge-section tone-orange">
        <header>
          <span className="ge-icon">
            <MapPin size={17} />
          </span>
          <div>
            <h3>คลังและการแจ้งเตือน</h3>
            <small>เมื่อคงเหลือถึงจุดแจ้งเตือน ระบบจะเตือนให้สั่งซื้อเพิ่ม</small>
          </div>
        </header>
        <div className="form-grid">
          {control("reorderLevel")}
          {control("location")}
          {rest.map(control)}
        </div>
      </section>
    </>
  );
}
