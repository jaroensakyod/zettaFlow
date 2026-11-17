"use client";
// เพิ่มสินค้า / บริการ / แพ็กเกจ: one form for the shared catalog (คลังสินค้า and ฝ่ายขาย). A summary card on top
// (type, name, price, promotion, status), then details with category and unit chips, the picture, price and profit,
// the promotion, what a package includes, and — for สินค้า only — where the stock is kept.
import { useState } from "react";
import { Barcode, Boxes, Camera, CheckCircle2, ChevronDown, Gift, ImagePlus, ListChecks, MapPin, Package, PauseCircle, Percent, Star, Tag, TrendingUp, Wand2, Wrench, X } from "lucide-react";
import { catalog, statusLabels } from "@/lib/catalog";
import { discountPercent, itemType, promoActive, type ItemType } from "@/lib/product-catalog";
import { FieldControl, photoUrl, shrinkPhoto, type Option } from "./records";
import { uploadFile } from "./platform";
import { api } from "./shared";

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
const used = ["name", "sku", "category", "unit", "cost", "price", "reorderLevel", "location", "status", "type", "image", "gallery", "description", "includes", "promoPrice", "promoLabel", "promoEnds"];
const fmt = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
export const MAX_PHOTOS = 10;
/**
 * จำนวนคงเหลือ typed in the form: stock only changes through รับเข้า / เบิกออก, so the difference is saved as one
 * movement and the warehouse history stays right.
 */
export async function syncStock(productId: string, before: number, after: unknown) {
  if (after === "" || after === undefined || after === null) return;
  const diff = Math.round(Number(after)) - Math.round(before);
  if (!Number.isFinite(diff) || diff === 0) return;
  await api("/stock", {
    method: "POST",
    body: {
      productId,
      type: diff > 0 ? "in" : "out",
      quantity: Math.abs(diff),
      // A reference is used once per product, so each adjustment gets its own time stamp.
      reference: (before ? "ปรับยอดจากหน้าสินค้า " : "ยอดตั้งต้น ") + new Date().toLocaleString("th-TH", { dateStyle: "short", timeStyle: "medium" }),
    },
  });
}
/** Every photo of an item, cover first ("image", then the comma-separated "gallery"). */
export const photosOf = (d: Record<string, unknown>) =>
  [String(d.image || ""), ...String(d.gallery || "").split(",")].map((x) => x.trim()).filter(Boolean);

/** รูปสินค้า: up to ten photos. The first is the cover the catalog shows; tap ★ to make another the cover. */
function PhotoGallery({ values, set }: { values: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  const photos = photosOf(values);
  const [busy, setBusy] = useState(0),
    [error, setError] = useState("");
  const save = (list: string[]) => {
    set("image", list[0] || "");
    set("gallery", list.slice(1).join(","));
  };
  const add = async (files: File[]) => {
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) setError("ใส่ได้สูงสุด " + MAX_PHOTOS + " รูป");
    else setError("");
    const pick = files.slice(0, Math.max(0, room));
    if (!pick.length) return;
    setBusy(pick.length);
    const ids: string[] = [];
    for (const f of pick) {
      try {
        ids.push(await uploadFile(await shrinkPhoto(f), "Warehouse"));
      } catch (err) {
        setError((err as Error).message);
      }
      setBusy((n) => n - 1);
    }
    if (ids.length) save([...photos, ...ids].slice(0, MAX_PHOTOS));
  };
  return (
    <div className="pf-gallery">
      <div className="pf-gallery-head">
        <b>
          <Camera size={15} /> รูปสินค้า
        </b>
        <small>
          {photos.length}/{MAX_PHOTOS} รูป · รูปแรกคือรูปปก
        </small>
      </div>
      <div className="pf-gallery-grid">
        {photos.map((id, i) => (
          <figure key={id} className={i === 0 ? "cover" : ""}>
            <img src={photoUrl(id)} alt={"รูปที่ " + (i + 1)} />
            {i === 0 ? (
              <em>รูปปก</em>
            ) : (
              <button type="button" className="star" aria-label={"ตั้งรูปที่ " + (i + 1) + " เป็นรูปปก"} title="ตั้งเป็นรูปปก" onClick={() => save([id, ...photos.filter((x) => x !== id)])}>
                <Star size={13} />
              </button>
            )}
            <button type="button" className="del" aria-label={"ลบรูปที่ " + (i + 1)} onClick={() => save(photos.filter((x) => x !== id))}>
              <X size={13} />
            </button>
          </figure>
        ))}
        {photos.length < MAX_PHOTOS && (
          <label className={"pf-gallery-add" + (photos.length ? "" : " first")}>
            <ImagePlus size={photos.length ? 22 : 28} />
            <span>{busy ? "กำลังอัปโหลด " + busy + " รูป…" : photos.length ? "เพิ่มรูป" : "เพิ่มรูปสินค้า"}</span>
            {!photos.length && !busy && <small>เลือกได้หลายรูปพร้อมกัน · PNG, JPG, WebP</small>}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="sr-only"
              disabled={!!busy}
              onChange={(e) => {
                const files = [...(e.target.files || [])];
                e.target.value = "";
                add(files);
              }}
            />
          </label>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

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
  const [unitOpen, setUnitOpen] = useState(false);
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
            <small>รูป ชื่อ รหัส หมวดหมู่ หน่วย และรายละเอียด</small>
          </div>
          <button type="button" className="ge-copy" onClick={sku}>
            <Wand2 size={13} /> สร้างรหัส
          </button>
        </header>
        <PhotoGallery values={values} set={set} />
        <div className="form-grid">
          {control("name")}
          {control("sku")}
          {control("category")}
          <label htmlFor="field-unit">
            หน่วย<span className="required"> *</span>
            <span className={"pf-select" + (unitOpen ? " open" : "")}>
              <input id="field-unit" name="unit" required autoComplete="off" placeholder="เลือกหรือพิมพ์หน่วยเอง" value={unit} onChange={(e) => set("unit", e.target.value)} onFocus={() => setUnitOpen(true)} onBlur={() => setTimeout(() => setUnitOpen(false), 150)} />
              <button type="button" className="pf-select-toggle" aria-label="เลือกหน่วย" aria-expanded={unitOpen} onClick={() => setUnitOpen((v) => !v)}>
                <ChevronDown size={16} />
              </button>
              {unitOpen && (
                <span className="pf-select-menu" role="listbox">
                  {unitsFor[type].map((u) => (
                    <button key={u} type="button" role="option" aria-selected={unit === u} className={unit === u ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => (set("unit", u), setUnitOpen(false))}>
                      {u}
                    </button>
                  ))}
                  <small>หรือพิมพ์หน่วยอื่นในช่องได้เลย</small>
                </span>
              )}
            </span>
          </label>
          {type === "product" && (
            <label htmlFor="field-stock" className="pf-qty">
              จำนวนคงเหลือ
              <span className="pf-qty-box">
                <button type="button" aria-label="ลดจำนวน" onClick={() => set("stock", Math.max(0, (Number(values.stock) || 0) - 1))}>
                  −
                </button>
                <input id="field-stock" type="number" min={0} step={1} inputMode="numeric" placeholder="0" value={values.stock === undefined || values.stock === null ? "" : String(values.stock)} onChange={(e) => set("stock", e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value))))} />
                <button type="button" aria-label="เพิ่มจำนวน" onClick={() => set("stock", (Number(values.stock) || 0) + 1)}>
                  +
                </button>
                <em>{unit || "หน่วย"}</em>
              </span>
              <small>แก้ตัวเลขได้เลย ระบบบันทึกเป็นรายการรับเข้า / เบิกออกให้อัตโนมัติ</small>
            </label>
          )}
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
        <div className="form-grid">{control("description")}</div>
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
