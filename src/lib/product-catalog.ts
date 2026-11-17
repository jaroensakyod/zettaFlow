// One catalog for คลังสินค้า and ฝ่ายขาย: every `products` record is a สินค้า (with stock), a บริการ or a แพ็กเกจ
// (no stock), and may carry a promotion. These helpers read a record the same way on both pages.
export type ItemType = "product" | "service" | "package";
type Data = Record<string, unknown>;

export const itemType = (d: Data): ItemType => (d.type === "service" || d.type === "package" ? d.type : "product");
/** Only สินค้า keep stock; บริการ and แพ็กเกจ are always sellable. */
export const tracksStock = (d: Data) => itemType(d) === "product";

/** A promotion counts while its price is below the normal price and its end date (if any) has not passed. */
export function promoActive(d: Data, today = new Date().toISOString().slice(0, 10)) {
  const promo = Number(d.promoPrice),
    price = Number(d.price) || 0;
  if (!(promo > 0) || !(promo < price)) return false;
  return !d.promoEnds || String(d.promoEnds) >= today;
}
export const sellPrice = (d: Data, today?: string) => (promoActive(d, today) ? Number(d.promoPrice) : Number(d.price) || 0);
export const discountPercent = (d: Data) => {
  const price = Number(d.price) || 0;
  return price > 0 ? Math.round((1 - Number(d.promoPrice) / price) * 100) : 0;
};
/** สินค้าหมด / ใกล้หมด / พร้อมขาย; บริการ and แพ็กเกจ are always พร้อมขาย. */
export function stockState(d: Data): "out" | "low" | "ok" {
  if (!tracksStock(d)) return "ok";
  const stock = Number(d.stock) || 0;
  if (stock <= 0) return "out";
  return stock <= (Number(d.reorderLevel) || 0) ? "low" : "ok";
}
