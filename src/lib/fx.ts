// Foreign-currency expenses: the document keeps its own currency and amount, and `amount` (what every
// total, report and journal uses) is stored in baht at the rate of the document date.

/** Currencies a document may be in. THB is the books' currency. */
export const currencies = ["THB", "USD", "EUR", "GBP", "JPY", "CNY", "SGD", "HKD", "AUD", "MYR", "KRW", "TWD"] as const;
export type Currency = (typeof currencies)[number];
const symbols: Partial<Record<string, string>> = { THB: "฿", USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", KRW: "₩" };

export const isForeign = (c: unknown) => typeof c === "string" && c !== "" && c !== "THB" && (currencies as readonly string[]).includes(c);

/** "$11.17", "€8.00", "SGD 12.50", "฿360.00". */
export function formatMoney(n: unknown, currency: unknown = "THB") {
  const c = String(currency || "THB");
  const v = (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbols[c] ? symbols[c] + v : c + " " + v;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const cache = new Map<string, number>();

/**
 * Baht per 1 unit of `currency` on `date` (YYYY-MM-DD), from the European Central Bank reference rates
 * (api.frankfurter.dev, no key). A weekend or holiday gets the last business day before it.
 */
export async function thbRate(currency: string, date?: string) {
  if (!isForeign(currency)) return 1;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= new Date().toISOString().slice(0, 10) ? date : "latest";
  const key = currency + "@" + day;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(`https://api.frankfurter.dev/v1/${day}?from=${currency}&to=THB`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw Error("ดึงอัตราแลกเปลี่ยนไม่สำเร็จ กรุณากรอกอัตราเอง");
  const rate = Number(((await res.json()) as { rates?: { THB?: number } }).rates?.THB);
  if (!(rate > 0)) throw Error("ไม่พบอัตราแลกเปลี่ยน " + currency + " กรุณากรอกอัตราเอง");
  cache.set(key, r4(rate));
  return r4(rate);
}

/**
 * Before an expense is saved: a foreign document keeps `amountForeign` in its own currency and `amount`
 * becomes baht (amountForeign × fxRate). The rate is looked up for the document date when not given.
 * A baht document drops the foreign fields.
 */
export async function applyFx(kind: string, input: unknown) {
  if (kind !== "expenses" || !input || typeof input !== "object") return input;
  const d = { ...(input as Record<string, unknown>) };
  if (!isForeign(d.currency)) {
    delete d.currency;
    delete d.amountForeign;
    delete d.fxRate;
    return d;
  }
  // Read from a chat or receipt where only one figure was found: that figure is the document's own amount.
  const foreign = Number(d.amountForeign ?? d.amount);
  if (!(foreign >= 0)) return d;
  const rate = Number(d.fxRate) > 0 ? r4(Number(d.fxRate)) : await thbRate(String(d.currency), String(d.date || ""));
  return { ...d, amountForeign: r2(foreign), fxRate: rate, amount: r2(foreign * rate) };
}
