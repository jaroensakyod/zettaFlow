// The buyer's ใบแจ้งหนี้ / ใบเสร็จรับเงิน for a package bought from EliteFlow, opened from a signed link (LINE, web).
// Issuer: EliteFlow's company profile; customer: the buying company's profile; one line for the package and its period.
import { bahtText, thaiDate } from "./documents";
import { planById } from "./billing";
import { saleAmounts, type SaleRecords } from "./package-sale";

export type PackageDoc = {
  kind: "inv" | "rc";
  issuer: { name: string; address: string; taxId: string; phone: string };
  customer: { name: string; address: string; taxId: string };
  plan: string;
  cycle: "monthly" | "yearly";
  /** What was paid, VAT included (add-ons too). */
  amount: number;
  ref: string | null;
  records: Pick<SaleRecords, "invoiceNo" | "receiptNo" | "paidAt" | "start" | "end">;
};
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** Name, address, tax ID and phone from a company row's profile. */
export function party(c: { name?: unknown; profile?: unknown } | null | undefined) {
  const p = (c?.profile || {}) as Record<string, unknown>;
  return { name: str(p.name) || str(c?.name), address: str(p.address), taxId: str(p.taxId), phone: str(p.phone) };
}

export function renderPackageDoc(d: PackageDoc): string {
  const plan = planById(d.plan),
    price = saleAmounts(d.amount),
    receipt = d.kind === "rc",
    title = receipt ? "ใบเสร็จรับเงิน" : "ใบแจ้งหนี้",
    no = receipt ? d.records.receiptNo : d.records.invoiceNo,
    cycle = d.cycle === "yearly" ? "รายปี" : "รายเดือน";
  const who = (label: string, x: { name: string; address: string; taxId: string; phone?: string }) =>
    `<div class="who"><small>${label}</small><b>${esc(x.name) || "-"}</b>${x.address ? `<div>${esc(x.address)}</div>` : ""}${x.taxId ? `<div>เลขประจำตัวผู้เสียภาษี ${esc(x.taxId)}</div>` : ""}${x.phone ? `<div>โทร ${esc(x.phone)}</div>` : ""}</div>`;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} ${esc(no)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap">
<style>
*{box-sizing:border-box}body{margin:0;background:#eef0f5;font:15px/1.6 Sarabun,sans-serif;color:#1f2937}
.page{width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:16mm 16mm;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid #7c3aed;padding-bottom:12px}
.brand{font-size:24px;font-weight:700;color:#7c3aed}.title{text-align:right}.title h1{margin:0;font-size:26px;color:#1f2937}
.title div{color:#6b7280;font-size:14px}.paid{display:inline-block;margin-top:6px;padding:2px 12px;border-radius:99px;background:#dcfce7;color:#15803d;font-weight:700}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.who{padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;font-size:14px}
.who small{display:block;color:#7c3aed;font-weight:700}.who b{font-size:16px}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border-bottom:1px solid #e5e7eb;padding:9px 8px;text-align:left;vertical-align:top}
th{background:#f5f3ff;color:#5b21b6;font-weight:700}.r{text-align:right;white-space:nowrap}
.sum{margin-left:auto;width:min(320px,100%)}.sum td{border:0;padding:4px 8px}.sum .total td{font-size:18px;font-weight:700;border-top:2px solid #1f2937}
.words{margin-top:6px;padding:8px 12px;background:#f9fafb;border-radius:8px;font-size:14px}
.note{margin-top:18px;font-size:13px;color:#6b7280}
.bar{position:sticky;top:0;display:flex;justify-content:center;gap:8px;padding:10px;background:#1f2937}
.bar button{font:inherit;padding:6px 16px;border-radius:8px;border:0;background:#7c3aed;color:#fff;cursor:pointer}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;width:auto;min-height:auto}.bar{display:none}}
@media (max-width:820px){.page{width:auto;margin:0;padding:18px 14px}.parties{grid-template-columns:1fr}.top{flex-direction:column}.title{text-align:left}}
</style></head><body>
<div class="bar"><button onclick="print()">พิมพ์ / บันทึก PDF</button></div>
<div class="page">
<div class="top"><div><div class="brand">EliteFlow</div><div>${esc(d.issuer.name)}</div></div>
<div class="title"><h1>${title}</h1><div>เลขที่ ${esc(no)}</div><div>วันที่ ${esc(thaiDate(d.records.paidAt))}</div>${receipt ? `<div class="paid">ชำระแล้ว</div>` : ""}</div></div>
<div class="parties">${who("ผู้ขาย / ผู้ออกเอกสาร", d.issuer)}${who("ลูกค้า", d.customer)}</div>
<table><thead><tr><th>รายการ</th><th class="r">จำนวนเงิน (บาท)</th></tr></thead><tbody>
<tr><td><b>แพ็กเกจ EliteFlow ${esc(plan.name)} (${cycle})</b><div>ระยะเวลาใช้งาน ${esc(thaiDate(d.records.start))} – ${esc(thaiDate(d.records.end))}</div></td><td class="r">${money(price.base)}</td></tr>
</tbody></table>
<table class="sum"><tr><td>มูลค่าก่อนภาษี</td><td class="r">${money(price.base)}</td></tr><tr><td>ภาษีมูลค่าเพิ่ม 7%</td><td class="r">${money(price.vat)}</td></tr>
<tr class="total"><td>รวมทั้งสิ้น</td><td class="r">${money(price.total)}</td></tr></table>
<div class="words">(${esc(bahtText(price.total))})</div>
<div class="note">${receipt ? `ได้รับเงินแล้วด้วยการโอนเงิน เมื่อ ${esc(thaiDate(d.records.paidAt))}${d.ref ? ` · เลขอ้างอิง ${esc(d.ref)}` : ""} · อ้างอิงใบแจ้งหนี้ ${esc(d.records.invoiceNo)}` : `ครบกำหนดชำระ ${esc(thaiDate(d.records.paidAt))}`}<br>เอกสารนี้ออกโดยระบบ EliteFlow อัตโนมัติ</div>
</div></body></html>`;
}
