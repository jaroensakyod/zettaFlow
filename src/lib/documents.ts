/**
 * Printable business documents (A4): ใบเสนอราคา, ใบแจ้งหนี้, ใบกำกับภาษี, ใบเสร็จรับเงิน.
 * Server-built standalone HTML (like the 50 ทวิ certificate) — the browser prints it or saves it as PDF.
 * Tax invoices and receipts are issued from existing records (invoice / income payment) and get their own running
 * numbers (TAX-2026-0001, RC-2026-0001; migration 0043 issue_document). Every value is escaped.
 */
import { supabaseServer } from "./supabase/server";
import { demoRead, demoMutate } from "./demo";
import { assert, canRead, canWrite } from "./domain";
import { lineAmount, type Line } from "./catalog";
import { dbError, allEntities } from "./data";
import type { Context, Entity } from "./types";

export const docKinds = ["quotation", "invoice", "tax_invoice", "receipt"] as const;
export type DocKind = (typeof docKinds)[number];
export const isDocKind = (k: string): k is DocKind => (docKinds as readonly string[]).includes(k);
/** Where a record's document opens (the print route). */
export const docUrl = (kind: DocKind, id: string) => `/print/${kind}/${id}`;

// ---------- Thai text helpers ----------
const digitWords = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const placeWords = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
/** Reads a non-negative integer (as a digit string) the Thai way; "" for zero. `higher` = digits sit above this group. */
function readInt(s: string, higher = false): string {
  s = s.replace(/^0+/, "");
  if (!s) return "";
  if (s.length > 6) {
    const head = s.slice(0, -6),
      tail = s.slice(-6);
    return readInt(head, higher) + "ล้าน" + readInt(tail, true);
  }
  const n = s.length;
  let out = "";
  for (let i = 0; i < n; i++) {
    const d = Number(s[i]),
      p = n - 1 - i;
    if (!d) continue;
    if (p === 1 && d === 1) out += "สิบ";
    else if (p === 1 && d === 2) out += "ยี่สิบ";
    else if (p === 0 && d === 1 && (n > 1 || higher)) out += "เอ็ด";
    else out += digitWords[d] + placeWords[p];
  }
  return out;
}
/** Amount in Thai words, as required on tax invoices / receipts: 256800 → "สองแสนห้าหมื่นหกพันแปดร้อยบาทถ้วน". */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const neg = amount < 0;
  const satangTotal = Math.round(Math.abs(amount) * 100);
  const baht = Math.floor(satangTotal / 100),
    satang = satangTotal % 100;
  let out = baht ? readInt(String(baht)) + "บาท" : "";
  if (satang) out += readInt(String(satang)) + "สตางค์";
  else out = (out || "ศูนย์บาท") + "ถ้วน";
  return (neg ? "ลบ" : "") + out;
}
const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** 2026-11-06 → "6 พ.ย. 2569" (Buddhist year, as on Thai tax documents); "" for a blank/invalid date. */
export function thaiDate(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return `${Number(m[3])} ${thaiMonths[Number(m[2]) - 1] || ""} ${Number(m[1]) + 543}`;
}
const bangkokToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const daysBetween = (a: unknown, b: unknown) => {
  const x = Date.parse(String(a) + "T00:00:00Z"),
    y = Date.parse(String(b) + "T00:00:00Z");
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 864e5) : NaN;
};

// ---------- PromptPay + QR code (no dependency) ----------
export function crc16(s: string) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
const tlv = (tag: string, value: string) => tag + String(value.length).padStart(2, "0") + value;
/** EMVCo PromptPay payload for a mobile number (0812345678), a 13-digit tax/citizen id, or a 15-digit e-wallet id. */
export function promptPayPayload(id: string, amount?: number): string | null {
  const digits = String(id || "").replace(/\D/g, "");
  let target: string;
  if (digits.length === 10 && digits.startsWith("0")) target = tlv("01", ("0066" + digits.slice(1)).padStart(13, "0"));
  else if (digits.length === 13) target = tlv("02", digits);
  else if (digits.length === 15) target = tlv("03", digits);
  else return null;
  const amt = amount && amount > 0 ? tlv("54", amount.toFixed(2)) : "";
  const body = tlv("00", "01") + tlv("01", amt ? "12" : "11") + tlv("29", tlv("00", "A000000677010111") + target) + tlv("53", "764") + amt + tlv("58", "TH") + "6304";
  return body + crc16(body);
}
// QR model 2, byte mode, error correction M, versions 1–10 (≤ 213 bytes) — enough for PromptPay payloads and URLs.
const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const EC_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const rawModules = (v: number) => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    r -= (25 * a - 10) * a - 55;
    if (v >= 7) r -= 36;
  }
  return r;
};
const dataCodewords = (v: number) => Math.floor(rawModules(v) / 8) - EC_PER_BLOCK[v] * EC_BLOCKS[v];
const gfMul = (x: number, y: number) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
};
function rsDivisor(degree: number) {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 2);
  }
  return r;
}
function rsRemainder(data: number[], div: number[]) {
  const r = new Array<number>(div.length).fill(0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((d, i) => (r[i] ^= gfMul(d, f)));
  }
  return r;
}
/** Dark/light module matrix ([row][col]) of a QR code for `text`. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  while (ver <= 10 && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
  assert(ver <= 10, "ข้อความยาวเกินสำหรับ QR", 400);
  const cap = dataCodewords(ver) * 8;
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  // Split into blocks, add Reed–Solomon codewords, interleave.
  const nBlocks = EC_BLOCKS[ver],
    ecLen = EC_PER_BLOCK[ver],
    raw = Math.floor(rawModules(ver) / 8),
    shortLen = Math.floor(raw / nBlocks),
    nShort = nBlocks - (raw % nBlocks),
    div = rsDivisor(ecLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - ecLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const block = [...dat];
    if (i < nShort) block.push(-1);
    blocks.push([...block, ...rsRemainder(dat, div)]);
  }
  const final: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b) => b[i] !== -1 && final.push(b[i]));
  // Function patterns.
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    mod[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx,
          y = cy + dy,
          d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2,
      step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2,
      pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
  }
  const drawFormat = (mask: number) => {
    const d = (0 << 3) | mask; // EC level M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412,
      bit = (i: number) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // reserve the format areas before placing data
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) === 1,
        a = size - 11 + (i % 3),
        c = Math.floor(i / 3);
      set(a, c, dark);
      set(c, a, dark);
    }
  }
  // Data in the zigzag order.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++)
      for (let j = 0; j < 2; j++) {
        const x = right - j,
          up = ((right + 1) & 2) === 0,
          y = up ? size - 1 - v : v;
        if (!fn[y][x] && i < final.length * 8) {
          mod[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
  // Pick the mask with the lowest penalty (runs, 2×2 blocks, balance).
  const masks: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const apply = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[m](x, y)) mod[y][x] = !mod[y][x];
  };
  const penalty = () => {
    let p = 0,
      dark = 0;
    for (let a = 0; a < size; a++) {
      let rr = 1,
        rc = 1;
      for (let b = 1; b < size; b++) {
        rr = mod[a][b] === mod[a][b - 1] ? rr + 1 : 1;
        rc = mod[b][a] === mod[b - 1][a] ? rc + 1 : 1;
        if (rr === 5) p += 3;
        else if (rr > 5) p++;
        if (rc === 5) p += 3;
        else if (rc > 5) p++;
      }
    }
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (mod[y][x]) dark++;
        if (x < size - 1 && y < size - 1 && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3;
      }
    return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0,
    bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    apply(m);
    drawFormat(m);
    const s = penalty();
    if (s < bestScore) [best, bestScore] = [m, s];
    apply(m);
  }
  apply(best);
  drawFormat(best);
  return mod;
}
/** QR code as inline SVG (4-module quiet zone). */
export function qrSvg(text: string, sizeMm = 26): string {
  const m = qrMatrix(text),
    n = m.length + 8;
  let d = "";
  m.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x + 4} ${y + 4}h1v1h-1z`)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
}

// ---------- View model ----------
type Rec = Record<string, unknown>;
export type DocLine = { name: string; detail: string; qty: number; unit: string; price: number; discount: number; amount: number };
export type DocTotals = { gross: number; discount: number; after: number; base: number; vatRate: number; vat: number; total: number; vatIncluded: boolean };
export type DocParty = { name: string; address: string; taxId: string; branch: string; contact: string; phone: string; email: string };
export type DocModel = {
  kind: DocKind;
  /** null = tax invoice / receipt not issued yet (preview). */
  number: string | null;
  info: { icon: string; label: string; value: string; strong?: boolean }[];
  company: Rec;
  customer: DocParty | null;
  lines: DocLine[];
  totals: DocTotals;
  /** Highlighted amount (receipt: the amount received). */
  amount: number;
  notesTitle: string;
  notes: string[];
  payment: { bank: string; account: string; accountName: string; accountType: string; promptPay: string | null; amount: number } | null;
  conditions: { label: string; text: string }[];
  contact: { name: string; position: string; phone: string; email: string; line: string; website: string };
  signatures: { role: string; name: string; position: string }[];
  /** Footer notes for the receipt (the design's หมายเหตุ box). */
  footerNotes: string[];
  /** Form target that issues the number (shown on previews). */
  issueAction?: string;
};
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const n = (v: unknown) => Number(v) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const splitLines = (v: unknown) => s(v).split(/\r?\n/).map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);

/** Item rows from a `lines` field; a name's second line onward becomes รายละเอียด. */
export function docLines(lines: unknown): DocLine[] {
  return (Array.isArray(lines) ? (lines as Line[]) : []).map((l) => {
    const [name, ...rest] = s(l.name).split(/\r?\n/);
    const gross = n(l.qty) * n(l.price),
      amount = lineAmount(l);
    return { name, detail: rest.join(" ").trim(), qty: n(l.qty), unit: s(l.unit), price: n(l.price), discount: r2(gross - amount), amount };
  });
}
/** Totals the same way as catalog docTotal (line discounts, bill discount, VAT mode excluded/included/none). */
export function lineTotals(lines: DocLine[], billDiscount: number, vatMode: unknown, rate = 7): DocTotals {
  const gross = r2(lines.reduce((t, l) => t + l.qty * l.price, 0)),
    sub = lines.reduce((t, l) => t + l.amount, 0),
    after = r2(Math.max(0, sub - billDiscount)),
    discount = r2(gross - after);
  if (vatMode === "included") {
    const base = r2(after / (1 + rate / 100));
    return { gross, discount, after, base, vatRate: rate, vat: r2(after - base), total: after, vatIncluded: true };
  }
  if (vatMode === "excluded") {
    const vat = r2((after * rate) / 100);
    return { gross, discount, after, base: after, vatRate: rate, vat, total: r2(after + vat), vatIncluded: false };
  }
  return { gross, discount, after, base: after, vatRate: 0, vat: 0, total: after, vatIncluded: false };
}
const party = (c: Entity | null | undefined): DocParty | null => {
  if (!c) return null;
  const d = c.data,
    company = s(d.company);
  return {
    name: company || s(d.name),
    address: s(d.address),
    taxId: s(d.taxId),
    branch: s(d.branch),
    contact: s(d.contact) || (company ? s(d.name) : ""),
    phone: s(d.phone),
    email: s(d.email),
  };
};
const payTerm = (days: number) => (Number.isFinite(days) && days > 0 ? `ภายใน ${days} วัน` : days === 0 ? "ชำระทันที" : "");

// ---------- Loading ----------
async function entity(ctx: Context, id: string | unknown): Promise<Entity | null> {
  const key = s(id);
  if (!/^[0-9a-f-]{36}$/i.test(key)) return null;
  let e: Entity | null | undefined;
  if (ctx.demo) e = (await demoRead()).entities.find((x) => x.id === key);
  else {
    const sb = await supabaseServer();
    const { data, error } = await sb.from("entities").select("*").eq("company_id", ctx.company.id).eq("id", key).maybeSingle();
    dbError(error);
    e = data as Entity | null;
  }
  return e && canRead(ctx, e.department) ? e : null;
}
/** The sales order an invoice was made from (convertData writes "ตามคำสั่งซื้อ SO-.. #abcd1234"). */
async function sourceOrder(ctx: Context, invoice: Entity) {
  const m = /#([0-9a-f]{8})\b/.exec(s(invoice.data.description));
  if (!m || !canRead(ctx, "Sales")) return null;
  return (await allEntities(ctx, "sales_orders")).find((e) => e.id.startsWith(m[1])) || null;
}
type Issued = { number: string; date: string };
const demoKey = (kind: DocKind, id: string) => `doc:${kind}:${id}`;
async function issuedNumber(ctx: Context, kind: DocKind, id: string): Promise<Issued | null> {
  if (ctx.demo) {
    const c = (await demoRead()).accounting?.counters || {},
      k = demoKey(kind, id);
    return c[k] ? demoIssued(kind, c[k], c[k + ":d"]) : null;
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("document_number", { p_company: ctx.company.id, p_kind: kind, p_entity: id });
  dbError(error);
  return data ? (data as Issued) : null;
}
const prefixOf = (kind: DocKind) => (kind === "tax_invoice" ? "TAX" : "RC");
const demoIssued = (kind: DocKind, seq: number, ymd: number): Issued => {
  const d = String(ymd);
  return { number: `${prefixOf(kind)}-${d.slice(0, 4)}-${String(seq).padStart(4, "0")}`, date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` };
};
/** Issues the tax invoice / receipt number for a record (idempotent: the same record keeps its number). */
export async function issueDocument(ctx: Context, kind: DocKind, id: string): Promise<Issued> {
  assert(kind === "tax_invoice" || kind === "receipt", "เอกสารนี้ไม่ต้องออกเลขที่", 400);
  assert(canWrite(ctx, "Finance"), "ไม่มีสิทธิ์ออกเอกสารการเงิน", 403);
  const e = await entity(ctx, id);
  assert(e && !e.archived_at, "ไม่พบเอกสาร", 404);
  if (kind === "tax_invoice") assert(e.kind === "invoices", "ออกใบกำกับภาษีได้จากใบแจ้งหนี้เท่านั้น");
  else
    assert(
      (e.kind === "payments" && e.data.direction === "income") || (e.kind === "invoices" && e.data.status === "paid"),
      "ออกใบเสร็จได้จากการรับชำระ หรือใบแจ้งหนี้ที่ชำระครบแล้ว",
    );
  if (ctx.demo)
    return demoMutate((st) => {
      const c = (st.accounting ||= { journals: [], wht: [], counters: {} }).counters,
        k = demoKey(kind, id);
      if (!c[k]) {
        const today = bangkokToday(),
          ck = `${prefixOf(kind)}:${today.slice(0, 4)}`;
        c[k] = c[ck] = (c[ck] || 0) + 1;
        c[k + ":d"] = Number(today.replace(/-/g, ""));
      }
      return demoIssued(kind, c[k], c[k + ":d"]);
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("issue_document", { p_company: ctx.company.id, p_kind: kind, p_entity: id });
  dbError(error);
  const issued = await issuedNumber(ctx, kind, id);
  assert(issued, "ออกเลขที่เอกสารไม่สำเร็จ", 500);
  return issued;
}

// ---------- Building each document ----------
type InvoiceParts = { lines: DocLine[]; totals: DocTotals; quotation: Entity | null; order: Entity | null };
async function invoiceParts(ctx: Context, inv: Entity): Promise<InvoiceParts> {
  const d = inv.data,
    base = n(d.subtotal),
    rate = n(d.vat),
    vat = r2((base * rate) / 100),
    total = d.total !== undefined ? n(d.total) : r2(base + vat);
  const order = await sourceOrder(ctx, inv);
  const quotation = order ? await entity(ctx, order.data.quotationId) : null;
  let lines = order ? docLines(order.data.lines) : [];
  let gross = base;
  // Show the order's item rows only when they add up to the invoice (line prices with VAT inside would not).
  if (order && lines.length && order.data.vatMode !== "included") {
    const t = lineTotals(lines, n(order.data.discount), "none");
    if (Math.abs(t.after - base) < 0.01) gross = t.gross;
    else lines = [];
  } else lines = [];
  if (!lines.length) {
    const [name, ...rest] = (s(d.description) || "ค่าสินค้า/บริการ").split(/\r?\n/);
    lines = [{ name, detail: rest.join(" ").trim(), qty: 1, unit: "", price: base, discount: 0, amount: base }];
  }
  return { lines, quotation, order, totals: { gross, discount: r2(gross - base), after: base, base, vatRate: rate, vat, total, vatIncluded: false } };
}

export type DocBuild = { record: Entity; customer: Entity | null; issued: Issued | null };
const docTitles: Record<DocKind, [string, string]> = {
  quotation: ["ใบเสนอราคา", "Quotation"],
  invoice: ["ใบแจ้งหนี้", "Invoice"],
  tax_invoice: ["ใบกำกับภาษี", "Tax Invoice"],
  receipt: ["ใบเสร็จรับเงิน", "Receipt"],
};

/** Loads the record and everything printed with it, then renders the A4 page. */
export async function documentHtml(ctx: Context, kind: DocKind, id: string): Promise<string> {
  return renderDocument(await documentModel(ctx, kind, id));
}
export async function documentModel(ctx: Context, kind: DocKind, id: string): Promise<DocModel> {
  const p = ctx.company.profile as Rec;
  const company: Rec = { ...p, name: s(p.name) || ctx.company.name };
  const rec = await entity(ctx, id);
  assert(rec, "ไม่พบเอกสาร", 404);
  const signer = s(p.signerName),
    contactBase = { phone: s(p.phone), email: s(p.email), line: s(p.line), website: s(p.website) };
  const extraConditions = splitLines(p.docConditions).map((x) => {
    const [label, ...rest] = x.split(/\s*:\s*/);
    return rest.length ? { label, text: rest.join(": ") } : { label: "", text: x };
  });
  const approver = { role: "ผู้อนุมัติ", name: s(p.approverName), position: s(p.approverPosition) };
  const bank = s(p.bank) || s(p.bankAccount) || s(p.promptPay)
    ? { bank: s(p.bank), account: s(p.bankAccount), accountName: s(p.bankAccountName) || s(company.name), accountType: s(p.bankAccountType), promptPay: s(p.promptPay) || null }
    : null;

  if (kind === "quotation") {
    assert(rec.kind === "quotations", "ไม่ใช่ใบเสนอราคา", 404);
    const d = rec.data,
      customer = await entity(ctx, d.customerId);
    let lines = docLines(d.lines);
    if (!lines.length) lines = [{ name: s(d.name) || "ค่าสินค้า/บริการ", detail: "", qty: 1, unit: "", price: n(d.subtotal), discount: 0, amount: n(d.subtotal) }];
    const totals = lineTotals(lines, n(d.discount), d.vatMode);
    const cd = customer?.data.creditDays;
    const term = cd === undefined || cd === null || cd === "" ? "" : payTerm(n(cd));
    const owner = s(d.owner);
    return {
      kind,
      number: s(d.code) || s(d.name),
      info: [
        { icon: "file", label: "เลขที่ใบเสนอราคา", value: s(d.code) || "-", strong: true },
        { icon: "calendar", label: "วันที่เสนอราคา", value: thaiDate(d.date) },
        { icon: "calendar", label: "ยืนราคาถึง", value: thaiDate(d.validUntil) || "-" },
        { icon: "clock", label: "เงื่อนไขการชำระเงิน", value: term || "-" },
        { icon: "user", label: "พนักงานขาย", value: owner || "-" },
        { icon: "user", label: "ผู้เสนอราคา", value: signer || owner || ctx.user.name || "-" },
        { icon: "phone", label: "โทรศัพท์", value: contactBase.phone || "-" },
        { icon: "mail", label: "อีเมล", value: contactBase.email || "-" },
      ],
      company,
      customer: party(customer),
      lines,
      totals,
      amount: totals.total,
      notesTitle: "หมายเหตุ",
      notes: [
        ...(d.vatMode === "excluded" ? ["ราคายังไม่รวมภาษีมูลค่าเพิ่ม (VAT) 7%"] : d.vatMode === "included" ? ["ราคารวมภาษีมูลค่าเพิ่ม (VAT) 7% แล้ว"] : []),
        ...splitLines(d.notes),
        ...splitLines(p.quotationNotes),
        ...(d.validUntil ? [`ใบเสนอราคานี้ยืนราคาถึงวันที่ ${thaiDate(d.validUntil)}`] : []),
      ],
      payment: bank && { ...bank, amount: totals.total },
      conditions: [...(term ? [{ label: "การชำระเงิน", text: `ชำระเงิน${term} นับจากวันที่ส่งมอบ/วางบิล` }] : []), ...extraConditions],
      contact: { name: owner || signer, position: "ฝ่ายขาย", ...contactBase },
      signatures: [{ role: "ผู้เสนอราคา", name: signer || owner, position: s(p.signerPosition) || (owner ? "ฝ่ายขาย" : "") }, approver],
      footerNotes: [],
    };
  }

  // Invoice-based documents.
  let invoice: Entity | null = null,
    payment: Entity | null = null;
  if (kind === "receipt" && rec.kind === "payments") {
    assert(rec.data.direction === "income", "ใบเสร็จออกได้เฉพาะการรับเงิน", 404);
    payment = rec;
    invoice = await entity(ctx, rec.data.invoiceId);
  } else {
    assert(rec.kind === "invoices", "ไม่ใช่ใบแจ้งหนี้", 404);
    invoice = rec;
  }
  const issued = kind === "tax_invoice" || kind === "receipt" ? await issuedNumber(ctx, kind, rec.id) : null;
  const customer = invoice ? await entity(ctx, invoice.data.customerId) : null;
  const parts = invoice
    ? await invoiceParts(ctx, invoice)
    : { lines: [] as DocLine[], quotation: null, order: null, totals: lineTotals([], 0, "none") };
  let { lines, totals } = parts;
  const inv = invoice?.data || {};
  const owner = s(parts.quotation?.data.owner);
  const due = n(inv.total) - n(inv.paid);
  const term = payTerm(daysBetween(inv.date, inv.dueDate));
  const contact = { name: owner || signer, position: "ฝ่ายขาย", ...contactBase };
  const issueAction = issued ? undefined : docUrl(kind, rec.id);

  if (kind === "invoice") {
    return {
      kind,
      number: s(inv.name),
      info: [
        { icon: "file", label: "เลขที่ใบแจ้งหนี้", value: s(inv.name) || "-", strong: true },
        { icon: "calendar", label: "วันที่ออกใบแจ้งหนี้", value: thaiDate(inv.date) },
        { icon: "calendar", label: "วันครบกำหนดชำระ", value: thaiDate(inv.dueDate) || "-" },
        { icon: "clock", label: "เงื่อนไขการชำระเงิน", value: term || "-" },
        { icon: "user", label: "พนักงานขาย", value: owner || "-" },
        { icon: "user", label: "ผู้ออกเอกสาร", value: signer || ctx.user.name || "-" },
      ],
      company,
      customer: party(customer),
      lines,
      totals,
      amount: totals.total,
      notesTitle: "หมายเหตุ",
      notes: [
        ...(totals.vatRate ? [`ราคารวมภาษีมูลค่าเพิ่ม (VAT ${totals.vatRate}%) แล้วในยอดสุทธิ`] : []),
        ...(n(inv.paid) > 0 ? [`รับชำระแล้ว ${money(n(inv.paid))} บาท คงค้าง ${money(due)} บาท`] : []),
        ...splitLines(p.invoiceNotes),
        ...(inv.dueDate ? [`กรุณาชำระเงินภายในวันที่ ${thaiDate(inv.dueDate)}`] : []),
      ],
      payment: bank && due > 0 ? { ...bank, amount: due } : null,
      conditions: [...(inv.dueDate ? [{ label: "การชำระเงิน", text: `ชำระเงิน${term ? term : ""} ภายในวันที่ ${thaiDate(inv.dueDate)}` }] : []), ...extraConditions],
      contact,
      signatures: [{ role: "ผู้วางบิล", name: signer || owner, position: s(p.signerPosition) }, { ...approver, role: "ผู้มีอำนาจอนุมัติ" }],
      footerNotes: [],
    };
  }
  if (kind === "tax_invoice") {
    return {
      kind,
      number: issued?.number || null,
      info: [
        { icon: "file", label: "เลขที่ใบกำกับภาษี", value: issued?.number || "ยังไม่ออกเลขที่", strong: true },
        { icon: "calendar", label: "วันที่ออกใบกำกับภาษี", value: thaiDate(issued?.date || bangkokToday()) },
        { icon: "calendar", label: "อ้างอิงใบเสนอราคา", value: s(parts.quotation?.data.code) || "-" },
        { icon: "clock", label: "เลขที่ใบแจ้งหนี้", value: s(inv.name) || "-" },
      ],
      company,
      customer: party(customer),
      lines,
      totals,
      amount: totals.total,
      notesTitle: "ข้อมูลภาษี",
      notes: ["เป็นใบกำกับภาษีแบบเต็มรูป", "ผู้ขายเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม", `อัตราภาษีมูลค่าเพิ่ม (VAT) ${totals.vatRate}%`, "สามารถนำไปใช้เป็นค่าใช้จ่ายทางภาษีได้"],
      payment: bank && due > 0 ? { ...bank, amount: due } : null,
      conditions: [
        { label: "", text: "กรุณาชำระตามยอดที่ระบุในใบกำกับภาษี" },
        ...(contactBase.phone ? [{ label: "", text: `หากมีข้อสงสัยติดต่อฝ่ายขาย ${contactBase.phone}` }] : []),
        ...extraConditions,
      ],
      contact,
      signatures: [{ role: "ผู้จัดทำใบกำกับภาษี", name: signer, position: s(p.signerPosition) }, approver],
      footerNotes: [],
      issueAction,
    };
  }
  // Receipt.
  const pay = payment?.data || {};
  let amount = payment ? n(pay.amount) : n(inv.total);
  if (payment && (!invoice || Math.abs(amount - totals.total) >= 0.01)) {
    // Part payment (or a payment without an invoice): one line for the amount received, VAT split out at the invoice rate.
    const rate = invoice ? n(inv.vat) : 0,
      base = r2(amount / (1 + rate / 100));
    const name = invoice ? `รับชำระตามใบแจ้งหนี้ ${s(inv.name)}${amount < totals.total ? " (ชำระบางส่วน)" : ""}` : s(pay.name) || "รับชำระเงิน";
    lines = [{ name, detail: s(pay.notes), qty: 1, unit: "", price: base, discount: 0, amount: base }];
    totals = { gross: base, discount: 0, after: base, base, vatRate: rate, vat: r2(amount - base), total: amount, vatIncluded: false };
  }
  amount = r2(amount);
  const method = s(pay.method);
  const paidOn = s(pay.date) || issued?.date || bangkokToday();
  return {
    kind,
    number: issued?.number || null,
    info: [
      { icon: "file", label: "เลขที่ใบเสร็จรับเงิน", value: issued?.number || "ยังไม่ออกเลขที่", strong: true },
      { icon: "calendar", label: "วันที่รับชำระเงิน", value: thaiDate(paidOn) },
      { icon: "calendar", label: "อ้างอิงใบแจ้งหนี้", value: s(inv.name) || "-" },
      { icon: "clock", label: "วิธีการชำระ", value: method || "-" },
    ],
    company,
    customer: party(customer),
    lines,
    totals,
    amount,
    notesTitle: "ข้อมูลการรับชำระเงิน",
    notes: [
      "ได้รับชำระเงินเรียบร้อยแล้ว",
      `วันที่รับเงิน : ${thaiDate(paidOn)}`,
      ...(method ? [`วิธีการชำระ : ${method}`] : []),
      ...(s(pay.reference) ? [`เลขที่อ้างอิง : ${s(pay.reference)}`] : []),
    ],
    payment: null,
    conditions: [],
    contact,
    signatures: [{ role: "ผู้รับเงิน", name: signer, position: s(p.signerPosition) }, approver],
    footerNotes: ["ใบเสร็จรับเงินนี้เป็นหลักฐานการชำระเงิน", "กรุณาเก็บไว้เป็นหลักฐานสำหรับการตรวจสอบ", ...splitLines(p.receiptNotes)],
    issueAction,
  };
}

// ---------- Rendering ----------
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 3 });
const icons: Record<string, string> = {
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  bank: '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h6"/>',
  headset: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
};
const icon = (name: string, cls = "i") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ""}</svg>`;
const themes: Record<DocKind, { c: string; dark: string; soft: string; line: string }> = {
  quotation: { c: "#2563eb", dark: "#1d4ed8", soft: "#eef4ff", line: "#c9dafd" },
  invoice: { c: "#e8366a", dark: "#c81e52", soft: "#fff0f4", line: "#f9c5d4" },
  tax_invoice: { c: "#f47b16", dark: "#d9650a", soft: "#fff5ec", line: "#fbd5b3" },
  receipt: { c: "#1fa34a", dark: "#15803d", soft: "#edf9f1", line: "#bfe8cc" },
};
const safeImage = (v: unknown) => {
  const x = s(v);
  return /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(x) || /^https:\/\/[^\s"'<>]+$/i.test(x) ? x : "";
};
const kv = (label: string, value: string, strong = false) =>
  `<div class="kv"><span>${esc(label)}</span><b>:</b><span class="${strong ? "strong" : ""}">${esc(value || "-")}</span></div>`;
const bullets = (items: string[]) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
const dots = "..............................";

/** The A4 page for a resolved document (pure: used by the print route, tests and samples). */
export function renderDocument(m: DocModel): string {
  const t = themes[m.kind],
    [titleTh, titleEn] = docTitles[m.kind],
    c = m.company;
  const logo = safeImage(c.logo);
  const companyName = s(c.name),
    nameEn = s(c.nameEn);
  const address = [s(c.address), s(c.province), s(c.zip)].filter(Boolean).join(" ");
  const cust = m.customer;
  const tot = m.totals;
  const draft = m.number === null;
  const title = `${titleTh} ${m.number || "(ตัวอย่าง)"}`;

  const header = `<header class="co">
  <div class="brand">${logo ? `<img src="${esc(logo)}" alt="">` : `<span class="mark">${esc((nameEn || companyName || "E").slice(0, 1).toUpperCase())}</span><span class="brand-name">${esc(nameEn || companyName)}</span>`}</div>
  <h2>${esc(companyName)}${nameEn ? ` (${esc(nameEn)})` : ""}</h2>
  ${address ? `<p>${esc(address)}</p>` : ""}
  <p>เลขประจำตัวผู้เสียภาษี ${esc(s(c.taxId) || "-")} <span class="sep">|</span> ${esc(s(c.branch) || "สำนักงานใหญ่")}</p>
  <p class="contacts">${s(c.phone) ? `<span>${icon("phone")}${esc(c.phone)}</span>` : ""}${s(c.email) ? `<span>${icon("mail")}${esc(c.email)}</span>` : ""}${s(c.website) ? `<span>${icon("globe")}${esc(c.website)}</span>` : ""}</p>
</header>`;
  const badge = `<div class="badge">${icon(m.kind === "receipt" ? "receipt" : "file", "badge-i")}<div><strong>${esc(titleTh)}</strong><span>${esc(titleEn)}</span></div></div>`;
  const info = `<div class="info">${m.info
    .map((r) => `<div class="row">${icon(r.icon)}<span class="lbl">${esc(r.label)}</span><span class="${r.strong ? "pill" : "val"}">${esc(r.value || "-")}</span></div>`)
    .join("")}</div>`;
  const customer = `<section class="cust"><h3><span class="avatar">${icon("user")}</span>ลูกค้า <em>/ Customer</em></h3>${
    cust
      ? kv("ชื่อบริษัท", cust.name, true) +
        kv("ที่อยู่", cust.address) +
        kv("เลขประจำตัวผู้เสียภาษี", cust.taxId ? `${cust.taxId}${cust.branch ? ` (${cust.branch})` : ""}` : "") +
        kv("ผู้ติดต่อ", cust.contact, true) +
        `<p class="contacts">${cust.phone ? `<span>${icon("phone")}${esc(cust.phone)}</span>` : ""}${cust.email ? `<span>${icon("mail")}${esc(cust.email)}</span>` : ""}</p>`
      : `<p class="muted">ไม่ระบุลูกค้า</p>`
  }</section>`;
  const rows = m.lines
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td><td class="name">${esc(l.name)}</td><td class="detail">${esc(l.detail)}</td><td class="c">${qty(l.qty)}</td><td class="c">${esc(l.unit || "-")}</td><td class="n">${money(l.price)}</td><td class="n">${l.discount ? money(l.discount) : "–"}</td><td class="n">${money(l.amount)}</td></tr>`,
    )
    .join("");
  const table = `<table class="items"><thead><tr><th class="c">#</th><th>รายการสินค้า / บริการ</th><th>รายละเอียด</th><th class="c">จำนวน</th><th class="c">หน่วย</th><th class="n">ราคาต่อหน่วย<br><small>(บาท)</small></th><th class="n">ส่วนลด<br><small>(บาท)</small></th><th class="n">จำนวนเงิน<br><small>(บาท)</small></th></tr></thead><tbody>${rows}</tbody></table>`;
  const showVat = tot.vatRate > 0 || m.kind === "tax_invoice";
  const totals = `<div class="totals">
  <div><span>ยอดรวมก่อนส่วนลด</span><span>${money(tot.gross)}</span></div>
  <div class="disc"><span>ส่วนลดรวม</span><span>${money(tot.discount)}</span></div>
  <div><span>ยอดหลังหักส่วนลด</span><span>${money(tot.after)}</span></div>
  ${tot.vatIncluded ? `<div><span>มูลค่าสินค้า/บริการก่อนภาษี</span><span>${money(tot.base)}</span></div>` : ""}
  ${showVat ? `<div><span>ภาษีมูลค่าเพิ่ม (VAT ${tot.vatRate}%)${tot.vatIncluded ? " ที่รวมอยู่" : ""}</span><span>${money(tot.vat)}</span></div>` : ""}
  <div class="grand"><span>${m.kind === "receipt" ? "จำนวนเงินที่ได้รับ" : "จำนวนเงินทั้งสิ้น"}</span><span>${money(m.amount)} บาท</span></div>
  <p class="words">(${esc(bahtText(m.amount))})</p>
</div>`;
  const notes = m.notes.length
    ? `<section class="box notes">${`<h3>${icon(m.kind === "receipt" ? "check" : "layers")}${esc(m.notesTitle)}</h3>`}${bullets(m.notes)}</section>`
    : `<div></div>`;
  const pay = m.payment;
  const ppPayload = pay?.promptPay ? promptPayPayload(pay.promptPay, pay.amount) : null;
  const payBox = pay
    ? `<section class="box pay"><h3>${icon("bank")}ช่องทางการชำระเงิน</h3><div class="pay-body"><div class="pay-info">${
        pay.bank ? `<p class="bank-name">${icon("bank")}${esc(pay.bank)}</p>` : ""
      }${kv("เลขที่บัญชี", pay.account)}${kv("ชื่อบัญชี", pay.accountName)}${pay.accountType ? kv("ประเภทบัญชี", pay.accountType) : ""}${
        ppPayload && !pay.account ? kv("พร้อมเพย์", pay.promptPay || "") : ""
      }</div>${
        ppPayload
          ? `<div class="qr">${qrSvg(ppPayload, 20)}</div><div class="qr-cap"><b>QR Code สำหรับชำระเงิน</b><span>สแกนจ่ายผ่านพร้อมเพย์ ยอด ${money(pay.amount)} บาท</span><span>และส่งหลักฐานการชำระเงิน</span></div>`
          : ""
      }</div></section>`
    : "";
  const conditions = m.conditions.length
    ? `<section class="box cond"><h3>${icon("clipboard")}เงื่อนไขเพิ่มเติม</h3><ol>${m.conditions
        .map((x) => `<li>${x.label ? `<b>${esc(x.label)}</b><span>:</span>` : ""}<span>${esc(x.text)}</span></li>`)
        .join("")}</ol></section>`
    : "";
  const ct = m.contact;
  const contactBox = `<section class="box contact"><h3>${icon("headset")}${m.kind === "receipt" ? "ช่องทางการติดต่อ" : "ติดต่อฝ่ายขาย"}</h3>${
    m.kind === "receipt"
      ? `${ct.phone ? `<p>${icon("phone")}ฝ่ายขาย : ${esc(ct.phone)}</p>` : ""}${ct.email ? `<p>${icon("mail")}อีเมล : ${esc(ct.email)}</p>` : ""}${ct.website ? `<p>${icon("globe")}เว็บไซต์ : ${esc(ct.website)}</p>` : ""}`
      : `${ct.name ? `<p>${icon("user")}${esc(ct.name)}${ct.position ? ` (${esc(ct.position)})` : ""}</p>` : ""}${ct.phone ? `<p>${icon("phone")}${esc(ct.phone)}</p>` : ""}${ct.email ? `<p>${icon("mail")}${esc(ct.email)}</p>` : ""}${ct.line ? `<p>${icon("chat")}${esc(ct.line)}</p>` : ""}`
  }</section>`;
  const footerNotes = m.footerNotes.length ? `<section class="box notes">${`<h3>${icon("chat")}หมายเหตุ</h3>`}${bullets(m.footerNotes)}</section>` : "";
  let bottom: string;
  if (m.kind === "receipt") bottom = `<div class="grid2 avoid">${contactBox}${footerNotes}</div>`;
  else if (m.kind === "tax_invoice") bottom = `<div class="grid2 avoid">${payBox || "<div></div>"}${conditions || "<div></div>"}</div>`;
  else bottom = `${payBox ? `<div class="avoid">${payBox}</div>` : ""}<div class="grid2 cond-row avoid">${conditions || "<div></div>"}${contactBox}</div>`;
  const signs = `<div class="signs avoid">${m.signatures
    .map((g) => `<div class="sign"><div class="line"></div><b>${esc(g.role)}</b><span>(${esc(g.name || dots)})</span><span>${esc(g.position || "ตำแหน่ง " + dots)}</span><span class="date">วันที่ ......../......../........</span></div>`)
    .join("")}</div>`;
  const toolbar = `<div class="toolbar"><span>${esc(titleTh)}${draft ? " — ตัวอย่าง ยังไม่ออกเลขที่" : ""}</span>${
    draft && m.issueAction
      ? `<form method="post" action="${esc(m.issueAction)}"><button type="submit" class="primary">ออกเลขที่${esc(titleTh)}</button></form>`
      : ""
  }<button type="button" onclick="print()"${draft ? "" : ' class="primary"'}>พิมพ์ / บันทึกเป็น PDF</button></div>`;

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Prompt:wght@500;600;700&family=Sarabun:wght@400;500;600;700&display=swap">
<style>
:root{--c:${t.c};--dark:${t.dark};--soft:${t.soft};--line:${t.line};--violet:#6d3fe0;--lav:#f4f0fe;--ink:#1f2433;--mute:#5b6275}
*{box-sizing:border-box}
@page{size:A4;margin:7mm 0}
html,body{margin:0;background:#e8eaf0;color:var(--ink);font:9pt/1.36 "Sarabun","Noto Sans Thai","Leelawadee UI",Tahoma,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:210mm;min-height:297mm;margin:12px auto 24px;padding:8mm 10mm 7mm;background:#fff;box-shadow:0 4px 24px #0002;display:flex;flex-direction:column;gap:2.6mm}
h2,h3,.badge strong,.grand{font-family:"Prompt","Sarabun",sans-serif}
.i{width:3.2mm;height:3.2mm;flex:none;color:var(--violet);vertical-align:-0.6mm;margin-right:1.3mm}
.top{display:grid;grid-template-columns:1fr 74mm;gap:4mm;align-items:start}
.co .brand{display:flex;align-items:center;gap:2mm;min-height:11mm;margin-bottom:1.2mm}
.co .brand img{max-height:13mm;max-width:62mm;object-fit:contain}
.mark{display:grid;place-items:center;width:10mm;height:10mm;border-radius:3mm;background:linear-gradient(135deg,#8b5cf6,#4f46e5);color:#fff;font:700 14pt "Prompt",sans-serif}
.brand-name{font:700 15pt "Prompt",sans-serif;color:#3b2a8f}
.co h2{font-size:10pt;margin:0 0 .4mm;font-weight:600}
.co p{margin:0;color:var(--mute);font-size:8.3pt}
.sep{color:#bbb;margin:0 1mm}
.contacts{display:flex;flex-wrap:wrap;gap:.6mm 4mm;margin-top:.8mm!important}
.contacts span{display:inline-flex;align-items:center;color:var(--ink)}
.badge{display:flex;align-items:center;gap:3mm;background:linear-gradient(135deg,var(--c),var(--dark));color:#fff;border-radius:3.5mm;padding:2.4mm 4.5mm;box-shadow:0 2px 6px #0002}
.badge-i{width:10mm;height:10mm;padding:1.8mm;border-radius:2.5mm;background:#fff;color:var(--c);flex:none}
.badge strong{display:block;font-size:18pt;line-height:1.1;font-weight:700}
.badge span{display:block;font-size:10pt;opacity:.95}
.info{margin-top:2.4mm;border:1px solid var(--line);background:var(--soft);border-radius:3mm;padding:1.8mm 3mm}
.info .row{display:flex;align-items:center;padding:.35mm 0;font-size:8.5pt}
.info .i{color:var(--c)}
.info .lbl{flex:0 0 29mm;color:var(--mute)}
.info .val{font-weight:600}
.pill{font-weight:700;color:var(--dark);background:#fff;border:1px solid var(--line);border-radius:5mm;padding:0 3mm}
.cust{background:var(--lav);border-radius:3mm;padding:2.2mm 3mm;margin-top:2.2mm}
.cust h3{display:flex;align-items:center;margin:0 0 1mm;font-size:9.6pt;color:var(--violet)}
.cust h3 em{font-style:normal;font-weight:500;margin-left:1mm;color:var(--mute)}
.avatar{display:grid;place-items:center;width:6mm;height:6mm;border-radius:50%;background:#e4dafd;margin-right:2mm}
.avatar .i{margin:0}
.kv{display:grid;grid-template-columns:28mm 2.5mm 1fr;font-size:8.5pt}
.kv span:first-child{color:var(--mute)}
.kv .strong{font-weight:700}
.muted{color:var(--mute);margin:0}
table.items{width:100%;border-collapse:separate;border-spacing:0;font-size:8.4pt}
.items thead th{background:var(--c);color:#fff;font-weight:600;padding:1.2mm 1.5mm;text-align:left;line-height:1.15;vertical-align:middle}
.items thead th:first-child{border-radius:2mm 0 0 0}.items thead th:last-child{border-radius:0 2mm 0 0}
.items td{padding:1.1mm 1.5mm;border-bottom:1px solid #e6e8ef;vertical-align:top}
.items tbody tr:nth-child(even) td{background:#fafbfd}
.items .c{text-align:center}.items .n{text-align:right;white-space:nowrap}
.items .name{font-weight:700;width:30%}.items .detail{color:var(--mute);width:25%}
.items tr{break-inside:avoid}
.items small{font-weight:400;opacity:.9}
.mid{display:grid;grid-template-columns:1fr 78mm;gap:4mm;align-items:start}
.box{border-radius:3mm;padding:2mm 3mm;background:#f6f7fb;border:1px solid #e7e9f1}
.box h3{display:flex;align-items:center;margin:0 0 .8mm;font-size:9.2pt;color:var(--violet)}
.box ul,.box ol{margin:0;padding-left:4.5mm}.box li{margin:.15mm 0}
.notes{background:var(--lav);border-color:#e6defb}
.totals>div{display:flex;justify-content:space-between;padding:.4mm 1mm;font-size:8.9pt}
.totals>div span:last-child{font-weight:700}
.totals .disc span{color:var(--c)}
.totals .grand{margin-top:.8mm;background:linear-gradient(135deg,var(--c),var(--dark));color:#fff;border-radius:2.5mm;padding:1.7mm 3mm;font-size:11pt;font-weight:700}
.totals .words{margin:.8mm 1mm 0;text-align:right;font-size:8.4pt;color:var(--dark);font-weight:600}
.pay-body{display:flex;align-items:center;gap:4mm}
.pay-info{flex:1}
.bank-name{margin:0 0 .4mm;font-weight:700;display:flex;align-items:center}
.qr{flex:none;border:1px solid #e3e5ec;border-radius:2mm;padding:.6mm;background:#fff;line-height:0}
.qr-cap{flex:0 0 46mm;display:flex;flex-direction:column;font-size:8.4pt}
.qr-cap b{color:var(--c);font-size:9.2pt}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:4mm;align-items:stretch}
.cond-row{grid-template-columns:1.55fr 1fr}
.tax .grid2 .pay .pay-body{flex-wrap:wrap}.tax .grid2 .qr-cap{flex:1 1 30mm}
.cond li b{margin-right:1mm}.cond li span{margin-right:1mm}
.contact p{margin:.25mm 0;display:flex;align-items:center}
.signs{display:grid;grid-template-columns:1fr 1fr;margin-top:auto;padding-top:3mm}
.sign{display:flex;flex-direction:column;align-items:center;text-align:center;font-size:8.5pt;padding:0 6mm;line-height:1.3}
.sign+.sign{border-left:1px solid #d9dce5}
.sign .line{width:52mm;border-bottom:1px solid #444;height:9mm;margin-bottom:1mm}
.sign b{font-size:9.2pt}
.sign span{color:var(--mute)}
.sign .date{margin-top:.5mm;font-size:7.8pt}
.avoid{break-inside:avoid}
.draft::after{content:"ตัวอย่าง";position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font:700 64pt "Prompt",sans-serif;color:#0000000d;pointer-events:none}
.toolbar{position:sticky;top:0;z-index:5;display:flex;gap:8px;align-items:center;justify-content:center;padding:8px;background:#fff;box-shadow:0 1px 6px #0001;font:500 14px "Sarabun",sans-serif}
.toolbar span{margin-right:auto;padding-left:8px;color:var(--mute)}
.toolbar form{margin:0}
.toolbar button{font:600 14px "Sarabun",sans-serif;padding:7px 14px;border-radius:8px;border:1px solid #d5d8e2;background:#fff;cursor:pointer}
.toolbar button.primary{background:var(--c);border-color:var(--c);color:#fff}
@media print{html,body{background:#fff}.toolbar{display:none}.page{margin:0;padding:0 10mm;box-shadow:none;min-height:282mm}.draft::after{position:fixed}}
</style></head><body>
${toolbar}
<main class="page ${m.kind === "tax_invoice" ? "tax" : ""} ${draft ? "draft" : ""}">
<div class="top"><div>${header}${customer}</div><div>${badge}${info}</div></div>
${table}
<div class="mid avoid">${notes}${totals}</div>
${bottom}
${signs}
</main>
</body></html>`;
}
