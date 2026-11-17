"use client";
// สินค้า · บริการ · แพ็กเกจ — one catalog shown in two places: คลังสินค้า (mode "warehouse": stock on every card and
// a stock table) and ฝ่ายขาย (mode "sales": what the company sells, prices and promotions). Both read and write the
// same `products` records, so whatever the warehouse adds is ready to sell at once.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Check, CheckCircle2, Flame, Images, LayoutGrid, Package, Plus, Search, Sparkles, Table2, Tag, TriangleAlert } from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { discountPercent, itemType, promoActive, stockState, type ItemType } from "@/lib/product-catalog";
import { catalog } from "@/lib/catalog";
import { api, Loading, Modal, money, displayDate } from "./shared";
import { photoUrl, Records, type Option } from "./records";
import { photosOf, ProductFields, typeLook } from "./product-form";

type Tab = "all" | ItemType | "promo" | "low";
const newSku = (type: ItemType) => {
  const d = new Date();
  return { product: "SKU", service: "SRV", package: "PKG" }[type] + "-" + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "-" + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
};
const blank = (type: ItemType = "product"): Record<string, unknown> => ({
  ...Object.fromEntries(catalog.products.fields.map((f) => [f.key, f.type === "number" && f.required ? 0 : ""])),
  status: "active",
  type,
  unit: { product: "ชิ้น", service: "ครั้ง", package: "แพ็กเกจ" }[type],
  sku: newSku(type),
});

export function ProductCatalog({ ctx, mode, notify, changed }: { ctx: Context; mode: "warehouse" | "sales"; notify: (s: string) => void; changed: () => void }) {
  const [items, setItems] = useState<Entity[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [tab, setTab] = useState<Tab>("all"),
    [cat, setCat] = useState(""),
    [table, setTable] = useState(false),
    [editing, setEditing] = useState<Entity | "new" | null>(null),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [options, setOptions] = useState<Option[]>([]),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const writable = ctx.member.role !== "viewer";
  const load = useCallback(async () => {
    try {
      setItems(((await api("/catalog")) as { items: Entity[] }).items);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    api("/options").then(setOptions).catch(() => {});
  }, [load]);

  const categories = useMemo(() => [...new Set(items.map((e) => String(e.data.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")), [items]);
  const count = (t: Tab) => items.filter((e) => match(e, t)).length;
  function match(e: Entity, t: Tab) {
    if (t === "all") return true;
    if (t === "promo") return promoActive(e.data);
    if (t === "low") return stockState(e.data) !== "ok";
    return itemType(e.data) === t;
  }
  const shown = items.filter(
    (e) => match(e, tab) && (!cat || String(e.data.category || "").trim() === cat) && (!q || [e.data.name, e.data.sku, e.data.category, e.data.description].join(" ").toLowerCase().includes(q.toLowerCase())),
  );
  // ฝ่ายขาย: what is on sale first (promotions, then ready items), items no longer sold last.
  const sorted = [...shown].sort((a, b) => rank(a) - rank(b));
  function rank(e: Entity) {
    if (e.data.status === "inactive") return 3;
    if (promoActive(e.data)) return 0;
    return mode === "sales" && stockState(e.data) === "out" ? 2 : 1;
  }

  function open(item: Entity | "new", type?: ItemType) {
    setEditing(item);
    setFormError("");
    setValues(item === "new" ? blank(type) : { ...blank(itemType(item.data)), ...item.data });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const type = itemType(values);
      const data: Record<string, unknown> = { ...values, sku: String(values.sku || "").trim() || newSku(type) };
      if (type !== "product") data.reorderLevel = 0;
      const row = editing === "new" ? undefined : editing!;
      await api("/entities/products" + (row ? "/" + row.id : ""), { method: row ? "PATCH" : "POST", body: { data, version: row?.version } });
      notify((row ? "บันทึก" : "เพิ่ม") + typeLook[type][0] + "แล้ว" + (mode === "warehouse" ? " ฝ่ายขายเห็นทันที" : " คลังสินค้าเห็นทันที"));
      setEditing(null);
      await load();
      changed();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tabs: [Tab, string, React.ComponentType<{ size?: number }>][] = [
    ["all", "ทั้งหมด", LayoutGrid],
    ["product", "สินค้า", typeLook.product[1]],
    ["service", "บริการ", typeLook.service[1]],
    ["package", "แพ็กเกจ", typeLook.package[1]],
    ["promo", "โปรโมชัน", Flame],
    ...(mode === "warehouse" ? ([["low", "ใกล้หมด / หมด", TriangleAlert]] as [Tab, string, React.ComponentType<{ size?: number }>][]) : []),
  ];
  return (
    <div className={"pc pc-" + mode}>
      <section className="pc-hero">
        <div className="pc-hero-text">
          <span className="pc-hero-icon">{mode === "sales" ? <Sparkles size={22} /> : <Boxes size={22} />}</span>
          <div>
            <b>{mode === "sales" ? "สินค้าและบริการพร้อมขาย" : "คลังสินค้า บริการ และแพ็กเกจ"}</b>
            <small>
              {mode === "sales"
                ? "ข้อมูลชุดเดียวกับคลังสินค้า · เพิ่มหรือแก้ที่นี่ คลังก็อัปเดตทันที"
                : "เพิ่มครั้งเดียว ฝ่ายขายเห็นทันทีพร้อมราคาและโปรโมชัน"}
            </small>
          </div>
        </div>
        <div className="pc-stats">
          {(["product", "service", "package"] as ItemType[]).map((t) => {
            const [label, Icon] = typeLook[t];
            return (
              <button key={t} type="button" className={"t-" + t + (tab === t ? " on" : "")} onClick={() => setTab(tab === t ? "all" : t)}>
                <Icon size={16} />
                <b>{count(t)}</b>
                <small>{label}</small>
              </button>
            );
          })}
          <button type="button" className={"t-promo" + (tab === "promo" ? " on" : "")} onClick={() => setTab(tab === "promo" ? "all" : "promo")}>
            <Flame size={16} />
            <b>{count("promo")}</b>
            <small>โปรโมชัน</small>
          </button>
        </div>
      </section>

      <div className="pc-bar">
        <label className="pc-search">
          <Search size={16} />
          <input placeholder="ค้นหาชื่อ รหัส หรือหมวดหมู่" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {mode === "warehouse" && (
          <div className="pc-view" role="radiogroup" aria-label="มุมมอง">
            <button type="button" role="radio" aria-checked={!table} className={table ? "" : "on"} onClick={() => setTable(false)}>
              <LayoutGrid size={15} /> การ์ด
            </button>
            <button type="button" role="radio" aria-checked={table} className={table ? "on" : ""} onClick={() => setTable(true)}>
              <Table2 size={15} /> ตารางสต็อก
            </button>
          </div>
        )}
        {writable && (
          <div className="pc-add">
            {(Object.keys(typeLook) as ItemType[]).map((t) => {
              const [label, Icon] = typeLook[t];
              return (
                <button key={t} type="button" className={"t-" + t} onClick={() => open("new", t)}>
                  <Plus size={14} /> <Icon size={15} /> {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {table ? (
        <Records kind="products" ctx={ctx} notify={notify} changed={() => (load(), changed())} />
      ) : (
        <>
          <div className="pc-tabs" role="tablist">
            {tabs.map(([t, label, Icon]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={(tab === t ? "on " : "") + "t-" + t} onClick={() => setTab(t)}>
                <Icon size={14} /> {label} <em>{count(t)}</em>
              </button>
            ))}
          </div>
          {categories.length > 0 && (
            <div className="pc-cats" aria-label="หมวดหมู่">
              <Tag size={14} />
              <button type="button" className={cat ? "" : "on"} onClick={() => setCat("")}>
                ทุกหมวด
              </button>
              {categories.map((c) => (
                <button key={c} type="button" className={cat === c ? "on" : ""} onClick={() => setCat(cat === c ? "" : c)}>
                  {c}
                </button>
              ))}
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          {loading ? (
            <Loading />
          ) : !sorted.length ? (
            <div className="pc-empty">
              <Package size={34} />
              <b>{items.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีสินค้า บริการ หรือแพ็กเกจ"}</b>
              <small>{items.length ? "ลองเปลี่ยนคำค้นหรือหมวดหมู่" : "เริ่มเพิ่มรายการแรก แล้วฝ่ายขายจะเห็นทันที"}</small>
              {writable && !items.length && (
                <div className="pc-add">
                  {(Object.keys(typeLook) as ItemType[]).map((t) => (
                    <button key={t} type="button" className={"t-" + t} onClick={() => open("new", t)}>
                      <Plus size={14} /> {typeLook[t][0]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="pc-grid">
              {sorted.map((e) => (
                <Card key={e.id} e={e} mode={mode} onOpen={() => open(e)} />
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <Modal title={editing === "new" ? "เพิ่ม" + typeLook[itemType(values)][0] : "แก้ไข" + typeLook[itemType(values)][0]} onClose={() => setEditing(null)} className="ge-modal sf-modal pf-modal">
          <form onSubmit={save}>
            <fieldset disabled={!writable || busy}>
              <ProductFields values={values} set={(k, v) => setValues((s) => ({ ...s, [k]: v }))} options={options} categories={categories} />
            </fieldset>
            <p role="alert" className="form-error">
              {formError}
            </p>
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={() => setEditing(null)}>
                ปิด
              </button>
              {writable && (
                <button className="primary" disabled={busy}>
                  <Check size={15} />
                  {busy ? "กำลังบันทึก…" : "บันทึกข้อมูล"}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Card({ e, mode, onOpen }: { e: Entity; mode: "warehouse" | "sales"; onOpen: () => void }) {
  const d = e.data;
  const type = itemType(d);
  const [label, Icon] = typeLook[type];
  const promo = promoActive(d);
  const state = stockState(d);
  const off = d.status === "inactive";
  const includes = String(d.includes || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    <button type="button" className={"pc-card t-" + type + (off ? " off" : "") + (promo ? " promo" : "")} onClick={onOpen}>
      <span className="pc-media">
        {d.image ? <img src={photoUrl(d.image)} alt="" loading="lazy" /> : <Icon size={36} />}
        <em className="pc-type">
          <Icon size={12} /> {label}
        </em>
        {promo && (
          <em className="pc-ribbon">
            <Flame size={12} /> −{discountPercent(d)}%
          </em>
        )}
        {off && <em className="pc-offtag">หยุดขาย</em>}
        {photosOf(d).length > 1 && (
          <em className="pc-photos">
            <Images size={12} /> {photosOf(d).length}
          </em>
        )}
      </span>
      <span className="pc-body">
        {!!d.category && <small className="pc-cat">{String(d.category)}</small>}
        <b className="pc-name">{String(d.name || "—")}</b>
        <small className="pc-sku">{String(d.sku || "")}</small>
        {promo && !!d.promoLabel && (
          <span className="pc-promo">
            <Sparkles size={12} /> {String(d.promoLabel)}
            {!!d.promoEnds && <i> · ถึง {displayDate(String(d.promoEnds))}</i>}
          </span>
        )}
        {type === "package" && includes.length > 0 && (
          <span className="pc-incl">
            {includes.slice(0, 3).map((x) => (
              <i key={x}>
                <CheckCircle2 size={12} /> {x}
              </i>
            ))}
            {includes.length > 3 && <i className="more">+ อีก {includes.length - 3} รายการ</i>}
          </span>
        )}
        <span className="pc-foot">
          <span className="pc-price">
            <b>฿{money(promo ? d.promoPrice : d.price)}</b>
            {promo && <s>฿{money(d.price)}</s>}
            <small>/{String(d.unit || "หน่วย")}</small>
          </span>
          {type === "product" ? (
            <span className={"pc-stock s-" + state}>
              {mode === "warehouse" ? `คงเหลือ ${money(d.stock || 0)}` : state === "out" ? "สินค้าหมด" : state === "low" ? `เหลือ ${money(d.stock || 0)}` : "พร้อมขาย"}
            </span>
          ) : (
            <span className="pc-stock s-ok">พร้อมขาย</span>
          )}
        </span>
      </span>
    </button>
  );
}
