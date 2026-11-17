"use client";
// เพิ่มสินค้า / บริการ / แพ็กเกจ: one form for the shared catalog (คลังสินค้า and ฝ่ายขาย). A summary card on top
// (type, name, price, promotion, status), then details with category and unit chips, the picture, price and profit,
// the promotion, what a package includes, and — for สินค้า only — where the stock is kept.
import { Barcode, Boxes, CheckCircle2, Gift, ListChecks, MapPin, Package, PauseCircle, Percent, Tag, TrendingUp, Wand2, Wrench } from "lucide-react";
import { catalog, statusLabels } from "@/lib/catalog";
import { discountPercent, itemType, promoActive, type ItemType } from "@/lib/product-catalog";
import { FieldControl, type Option } from "./records";

export const typeLook: Record<ItemType, [string, React.ComponentType<{ size?: number }>, string]> = {
  product: ["สินค้า", Package, "blue"],
  service: ["บริการ", Wrench, "teal"],
  package: ["แพ็กเกจ", Gift, "pink"],
};
const unitsFor: Record<ItemType, string[]> = {
  product: ["ชิ้น", "กล่อง", "แพ็ค", "ขวด", "ถุง", "ชุด", "กก.", "ลิตร", "เมตร"],
  service: ["ครั้ง", "ชั่วโมง", "วัน", "เดือน", "งาน", "โปรเจกต์"],
  package: ["แพ็กเกจ", "ชุด", "เดือน", "ปี"],
};
const used = ["name", "sku", "category", "unit", "cost", "price", "reorderLevel", "location", "status", "type", "image", "description", "includes", "promoPrice", "promoLabel", "promoEnds"];
const fmt = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

export function ProductFields({
  values,
  set,
  options,
  categories = [],
}: {
  values: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  options: Option[];
  /** Categories already used in the catalog, offered as chips. */
  categories?: string[];
}) {
  const fields = catalog.products.fields;
  const control = (k: string) => {
    const f = fields.find((x) => x.key === k);
    return f ? <FieldControl key={k} field={f} value={values[k]} set={(v) => set(k, v)} options={options} department="Warehouse" /> : null;
  };
  const rest = fields.filter((f) => !used.includes(f.key) && !f.hidden).map((f) => f.key);
  const type = itemType(values);
  const [typeName, TypeIcon] = typeLook[type];
  const cost = Number(values.cost) || 0,
    price = Number(values.price) || 0,
    profit = price - cost,
    margin = price > 0 ? (profit / price) * 100 : 0;
  const promo = promoActive(values);
  const status = String(values.status || "active");
  const unit = String(values.unit || "");
  const category = String(values.category || "");
  const sku = () => {
    const d = new Date();
    const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    set("sku", { product: "SKU", service: "SRV", package: "PKG" }[type] + "-" + ymd + "-" + String(Math.floor(Math.random() * 1000)).padStart(3, "0"));
  };
  const pickType = (t: ItemType) => {
    set("type", t);
    // บริการ / แพ็กเกจ keep no stock: no alert level, and a unit that fits.
    if (t !== "product") set("reorderLevel", 0);
    if (!unit || !unitsFor[t].includes(unit)) set("unit", unitsFor[t][0]);
  };
  const promoBy = (pct: number) => price > 0 && set("promoPrice", Math.round(price * (1 - pct / 100)));
  return (
    <>
      <section className={"pf-hero t-" + type}>
        <div className="pf-types" role="radiogroup" aria-label="ประเภท">
          {(Object.keys(typeLook) as ItemType[]).map((t) => {
            const [label, Icon] = typeLook[t];
            return (
              <button key={t} type="button" role="radio" aria-checked={type === t} className={type === t ? "on" : ""} onClick={() => pickType(t)}>
                <Icon size={16} /> {label}
              </button>
            );
          })}
        </div>
        <div className="pf-hero-top">
          <span className="pf-hero-icon">
            <TypeIcon size={22} />
          </span>
          <div>
            <b>{String(values.name || "") || typeName + "ใหม่"}</b>
            <small>
              <Barcode size={13} /> {String(values.sku || "") || "ยังไม่มีรหัส"}
              {category && " · " + category}
              {unit && " · ต่อ" + unit}
            </small>
          </div>
        </div>
        <div className="pf-stats">
          <span>
            <small>ต้นทุน/หน่วย</small>
            <b>฿{fmt(cost)}</b>
          </span>
          <span>
            <small>{promo ? "ราคาโปร" : "ราคาขาย"}</small>
            <b>
              ฿{fmt(promo ? Number(values.promoPrice) : price)} {promo && <s>฿{fmt(price)}</s>}
            </b>
          </span>
          <span className={profit < 0 ? "loss" : ""}>
            <small>กำไร/หน่วย</small>
            <b>
              ฿{fmt(profit)} {price > 0 && <em>{fmt(margin)}%</em>}
            </b>
          </span>
        </div>
        <div className="sf-status two" role="radiogroup" aria-label="สถานะ">
          {(
            [
              ["active", CheckCircle2, "green"],
              ["inactive", PauseCircle, "red"],
            ] as const
          ).map(([s, Icon, tone]) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} className={"t-" + tone + (status === s ? " on" : "")} onClick={() => set("status", s)}>
              <Icon size={15} /> {s === "active" ? "พร้อมขาย" : statusLabels[s]}
            </button>
          ))}
        </div>
      </section>

      <section className="ge-section tone-blue">
        <header>
          <span className="ge-icon">
            <Tag size={17} />
          </span>
          <div>
            <h3>ข้อมูล{typeName}</h3>
            <small>ชื่อ รหัส หมวดหมู่ หน่วย รูป และรายละเอียด</small>
          </div>
          <button type="button" className="ge-copy" onClick={sku}>
            <Wand2 size={13} /> สร้างรหัส
          </button>
        </header>
        <div className="form-grid">
          {control("name")}
          {control("sku")}
          {control("category")}
          {control("unit")}
        </div>
        {categories.length > 0 && (
          <div className="pf-chips" aria-label="หมวดหมู่ที่มีอยู่">
            <small>หมวดหมู่:</small>
            {categories.map((c) => (
              <button key={c} type="button" className={category === c ? "on" : ""} onClick={() => set("category", category === c ? "" : c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <div className="pf-chips" aria-label="หน่วยที่ใช้บ่อย">
          <small>หน่วย:</small>
          {unitsFor[type].map((u) => (
            <button key={u} type="button" className={unit === u ? "on" : ""} onClick={() => set("unit", u)}>
              {u}
            </button>
          ))}
        </div>
        <div className="form-grid pf-media">
          {control("image")}
          {control("description")}
        </div>
      </section>

      {type === "package" && (
        <section className="ge-section tone-pink">
          <header>
            <span className="ge-icon">
              <ListChecks size={17} />
            </span>
            <div>
              <h3>สิ่งที่รวมในแพ็กเกจ</h3>
              <small>บรรทัดละหนึ่งรายการ เช่น “ถ่ายภาพ 50 รูป”, “ตกแต่งบูธ 1 ชุด”</small>
            </div>
          </header>
          <div className="form-grid">{control("includes")}</div>
        </section>
      )}

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

      <section className="ge-section tone-pink pf-promo">
        <header>
          <span className="ge-icon">
            <Percent size={17} />
          </span>
          <div>
            <h3>โปรโมชัน</h3>
            <small>ไม่บังคับ · ฝ่ายขายจะเห็นราคาโปรและป้ายลดราคาทันที</small>
          </div>
          {promo && <span className="pf-margin promo">ลด {discountPercent(values)}%</span>}
        </header>
        <div className="pf-chips">
          <small>ลดเร็ว:</small>
          {[10, 15, 20, 30, 50].map((p) => (
            <button key={p} type="button" disabled={!price} onClick={() => promoBy(p)}>
              −{p}%
            </button>
          ))}
          {!!values.promoPrice && (
            <button type="button" className="clear" onClick={() => (set("promoPrice", ""), set("promoLabel", ""), set("promoEnds", ""))}>
              ยกเลิกโปร
            </button>
          )}
        </div>
        <div className="form-grid">
          {control("promoPrice")}
          {control("promoLabel")}
          {control("promoEnds")}
        </div>
        {!!values.promoPrice && !promo && <p className="pf-warn">ราคาโปรต้องต่ำกว่าราคาขาย และยังไม่หมดเขต ถึงจะแสดงเป็นโปรโมชัน</p>}
      </section>

      {type === "product" ? (
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
      ) : (
        rest.length > 0 && (
          <section className="ge-section tone-slate">
            <header>
              <span className="ge-icon">
                <Boxes size={17} />
              </span>
              <div>
                <h3>ข้อมูลเพิ่มเติม</h3>
                <small>{typeName}ไม่มีสต็อก จึงพร้อมขายเสมอ</small>
              </div>
            </header>
            <div className="form-grid">{rest.map(control)}</div>
          </section>
        )
      )}
    </>
  );
}
