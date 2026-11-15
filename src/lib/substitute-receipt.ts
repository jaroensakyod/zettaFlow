// ใบรับรองแทนใบเสร็จรับเงิน (แบบ บก.111): for an expense paid where no receipt could be had (ตลาด รถรับจ้าง ร้านเล็ก),
// the employee who paid certifies it and the approver signs. Made from an expense record (its items, amount, who
// asked, who approved). Pure renderer here; the share route loads the record.
import { bahtText, thaiDate } from "./documents";

export type SubstituteModel = {
  company: { name: string; address?: string; taxId?: string; phone?: string };
  code: string;
  date: string;
  payee: string;
  lines: { day: string; text: string; amount: number }[];
  total: number;
  requester: string;
  approvers: { name: string; at: string }[];
  files: number;
  notes?: string;
};
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Model from an expense record's data (+ the LINE item's approval history). */
export function substituteModel(input: {
  company: { name: string; profile?: Record<string, unknown> };
  data: Record<string, unknown>;
  approvals?: { action?: string; name?: string; at?: string }[];
  files?: number;
}): SubstituteModel {
  const d = input.data,
    p = input.company.profile || {};
  const day = String(d.date || "").slice(0, 10);
  const items = Array.isArray(d.lines) ? (d.lines as { name?: string; qty?: number; unit?: string; price?: number }[]) : [];
  const priced = items.filter((x) => x?.name && Number(x.qty) * Number(x.price) > 0);
  const amount = Number(d.amount) || 0;
  const lines = priced.length
    ? priced.map((x) => ({ day, text: `${x.name} ${Number(x.qty).toLocaleString("en-US")}${x.unit ? " " + x.unit : ""} × ${money(Number(x.price))}`, amount: Number(x.qty) * Number(x.price) }))
    : [{ day, text: [String(d.name || "ค่าใช้จ่าย"), ...items.filter((x) => x?.name).map((x) => `${x.name} ${x.qty ?? ""}${x.unit ? " " + x.unit : ""}`)].join(" · "), amount }];
  const total = priced.length ? priced.reduce((s, x) => s + Number(x.qty) * Number(x.price), 0) : amount;
  const addr = [p.address, p.province, p.zip].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
  return {
    company: { name: String(p.name || input.company.name || ""), address: addr, taxId: String(p.taxId || ""), phone: String(p.phone || "") },
    code: String(d.code || ""),
    date: day,
    payee: String(d.payee || d.vendor || "").trim(),
    lines,
    total: Math.round(total * 100) / 100,
    requester: String(d.sourceSender || d.requestor || "").trim(),
    approvers: (input.approvals || []).filter((h) => h.action === "approve" && h.name).map((h) => ({ name: String(h.name), at: String(h.at || "") })),
    files: input.files || 0,
    notes: String(d.notes || "").trim() || undefined,
  };
}

/** The A4 page (prints from the browser; "บันทึกเป็น PDF" saves the file). */
export function renderSubstitute(m: SubstituteModel): string {
  const sign = (role: string, name: string, at: string) => `<div class="sig">
    <div class="line">ลงชื่อ ........................................</div>
    <div>( ${esc(name) || "..............................."} )</div>
    <div class="role">${esc(role)}</div>
    <div class="when">วันที่ ${at ? esc(thaiDate(at.slice(0, 10))) : "......../......../........"}</div>
  </div>`;
  const rows = m.lines
    .map(
      (l, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(thaiDate(l.day))}</td><td>${esc(l.text)}</td><td class="r">${money(l.amount)}</td></tr>`,
    )
    .join("");
  const blank = Array.from({ length: Math.max(0, 5 - m.lines.length) }, () => `<tr class="blank"><td></td><td></td><td></td><td></td></tr>`).join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ใบรับรองแทนใบเสร็จรับเงิน ${esc(m.code)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap">
<style>
*{box-sizing:border-box}body{margin:0;background:#eef0f5;font:15px/1.6 Sarabun,sans-serif;color:#1f2937}
.page{width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:18mm 16mm;box-shadow:0 4px 24px rgba(0,0,0,.08)}
h1{text-align:center;font-size:22px;margin:0 0 2px}.sub{text-align:center;color:#6b7280;font-size:13px;margin-bottom:14px}
.head{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px;font-size:14px}.head b{font-size:16px}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #9ca3af;padding:6px 8px;vertical-align:top}
th{background:#f3f4f6;font-weight:600}.c{text-align:center;white-space:nowrap}.r{text-align:right;white-space:nowrap}
tr.blank td{height:30px}.total td{font-weight:700}.words{background:#f9fafb}
.cert{margin:16px 0;text-indent:2.5em}.sigs{display:flex;justify-content:space-around;gap:24px;margin-top:36px;text-align:center}
.sig .line{margin-bottom:4px}.sig .role{font-weight:600}.sig .when{color:#6b7280;font-size:13px}
.meta{color:#6b7280;font-size:12.5px;margin-top:22px}
.bar{position:sticky;top:0;display:flex;justify-content:center;gap:8px;padding:10px;background:#1f2937}
.bar button{font:inherit;padding:6px 16px;border-radius:8px;border:0;background:#7c3aed;color:#fff;cursor:pointer}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;width:auto;min-height:auto}.bar{display:none}}
@media (max-width:820px){.page{width:auto;margin:0;padding:18px 14px}.head{flex-direction:column}}
</style></head><body>
<div class="bar"><button onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button></div>
<div class="page">
<h1>ใบรับรองแทนใบเสร็จรับเงิน</h1>
<div class="sub">ใช้เป็นหลักฐานรายจ่ายที่ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้</div>
<div class="head">
 <div><b>${esc(m.company.name)}</b>${m.company.address ? `<br>${esc(m.company.address)}` : ""}${m.company.taxId ? `<br>เลขประจำตัวผู้เสียภาษี ${esc(m.company.taxId)}` : ""}</div>
 <div style="text-align:right">เลขที่ <b>${esc(m.code || "-")}</b><br>วันที่ ${esc(thaiDate(m.date) || "-")}${m.payee ? `<br>ผู้รับเงิน/ร้านค้า: ${esc(m.payee)}` : ""}</div>
</div>
<table>
 <thead><tr><th style="width:44px">ลำดับ</th><th style="width:110px">วัน เดือน ปี</th><th>รายละเอียดรายจ่าย</th><th style="width:130px">จำนวนเงิน (บาท)</th></tr></thead>
 <tbody>${rows}${blank}
 <tr class="total"><td colspan="3" class="r">รวมทั้งสิ้น</td><td class="r">${money(m.total)}</td></tr>
 <tr class="words"><td colspan="4" class="c">( ${esc(bahtText(m.total))} )</td></tr></tbody>
</table>
<p class="cert">ข้าพเจ้า ${esc(m.requester) || "......................................................"} ขอรับรองว่า รายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้ และข้าพเจ้าได้จ่ายไปในงานของ${esc(m.company.name) || "บริษัท"} โดยแท้</p>
${m.notes ? `<p style="color:#4b5563;font-size:14px">หมายเหตุ: ${esc(m.notes)}</p>` : ""}
<div class="sigs">${sign("ผู้เบิกจ่าย", m.requester, m.date)}${sign("ผู้อนุมัติ", m.approvers.map((a) => a.name).join(", "), m.approvers.at(-1)?.at || "")}</div>
<div class="meta">ออกจาก EliteFlow · อ้างอิง ${esc(m.code || "-")}${m.files ? ` · มีหลักฐานแนบ ${m.files} ไฟล์ในระบบ` : ""}</div>
</div></body></html>`;
}
