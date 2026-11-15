// "@บอท สรุปค่าใช้จ่ายเดือนนี้" in LINE: totals by category and by person, the biggest items, what still waits,
// and a file (CSV, opens in Excel / Google Sheets) of every expense in the period. Pure helpers (tested); the
// webhook asks the database (line_expense_summary) and the share route builds the file.

const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
/** Today in Bangkok as a UTC-midnight date. */
function bangkokToday(now: Date) {
  const t = new Date(now.getTime() + 7 * 3600_000);
  return utc(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

export type Period = { from: string; to: string; label: string };
/**
 * "สรุปค่าใช้จ่ายเดือนนี้" / "สรุปรายจ่ายเดือนที่แล้ว" / "สรุปค่าใช้จ่าย ต.ค." / "สรุปค่าใช้จ่ายปีนี้" / "สรุปค่าใช้จ่ายวันนี้" /
 * "สรุปค่าใช้จ่ายสัปดาห์นี้" → the period; null when the message is not asking for an expense summary.
 */
export function summaryRequest(text: string, now = new Date()): Period | null {
  const t = text.trim();
  if (!/^(ขอ)?\s*สรุป\s*(ค่าใช้จ่าย|รายจ่าย|การใช้จ่าย|ยอดใช้จ่าย)/.test(t) && !/^(ขอ)?\s*(ค่าใช้จ่าย|รายจ่าย)\s*(เดือน|ปี|วัน|สัปดาห์)/.test(t)) return null;
  const today = bangkokToday(now),
    y = today.getUTCFullYear(),
    m = today.getUTCMonth();
  const month = (yy: number, mm: number): Period => ({
    from: iso(utc(yy, mm, 1)),
    to: iso(utc(yy, mm + 1, 0)),
    label: `${TH_MONTHS[((mm % 12) + 12) % 12]} ${utc(yy, mm, 1).getUTCFullYear() + 543}`,
  });
  if (/เดือน(ที่แล้ว|ก่อน)/.test(t)) return month(y, m - 1);
  if (/ปี(นี้)?/.test(t) && !/เดือน/.test(t)) return { from: iso(utc(y, 0, 1)), to: iso(utc(y, 11, 31)), label: `ปี ${y + 543}` };
  if (/วันนี้/.test(t)) return { from: iso(today), to: iso(today), label: "วันนี้" };
  if (/สัปดาห์|อาทิตย์/.test(t)) {
    const start = utc(y, m, today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    return { from: iso(start), to: iso(today), label: "สัปดาห์นี้" };
  }
  // A named month: "ต.ค.", "ตุลาคม" (this year, or last year when it has not come yet)
  for (let i = 0; i < 12; i++)
    if (t.includes(TH_MONTHS[i]) || t.includes(TH_SHORT[i]) || t.includes(TH_SHORT[i].replace(/\./g, ""))) return month(i > m ? y - 1 : y, i);
  return month(y, m);
}

export type Summary = {
  company: string;
  count: number;
  total: number;
  byCategory: { name: string; amount: number; count: number }[];
  byPerson: { name: string; amount: number; count: number }[];
  top: { name: string; amount: number; code: string | null; day: string | null }[];
  waitingSlip: { count: number; amount: number };
  inReview: number;
};
const baht = (n: number) => "฿" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The summary card: total, by category, by person, biggest items, what waits; buttons for the file and the web page. */
export function summaryCard(s: Summary, period: Period, links: { file?: string; web?: string }) {
  const row = (l: string, v: string, bold = false) => ({
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: l, size: "sm", color: "#5d5a78", flex: 6, wrap: true },
      { type: "text", text: v, size: "sm", color: "#2c2550", flex: 4, align: "end", weight: bold ? "bold" : "regular" },
    ],
  });
  const title = (t: string) => ({ type: "text", text: t, size: "xs", color: "#8a86a3", margin: "md", weight: "bold" });
  const total = s.total;
  const pct = (n: number) => (total ? ` (${Math.round((n / total) * 100)}%)` : "");
  const footer = [
    ...(links.file ? [{ type: "button", style: "primary", color: "#16a34a", height: "sm", action: { type: "uri", label: "⬇️ ดาวน์โหลดไฟล์ Excel", uri: links.file } }] : []),
    ...(links.web ? [{ type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "เปิดในเว็บ", uri: links.web } }] : []),
  ];
  const alt = [`📊 สรุปค่าใช้จ่าย ${period.label}: ${baht(total)} (${s.count} รายการ)`, ...s.byCategory.slice(0, 4).map((c) => `• ${c.name} ${baht(c.amount)}`)].join("\n");
  return {
    type: "flex",
    altText: alt.slice(0, 380),
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#ecfdf5",
        paddingAll: "12px",
        contents: [
          { type: "text", text: `📊 สรุปค่าใช้จ่าย · ${period.label}`, size: "xs", color: "#047857", weight: "bold" },
          { type: "text", text: baht(total), size: "xxl", weight: "bold", color: "#065f46" },
          { type: "text", text: `${s.count} รายการ · ${s.company}`, size: "xs", color: "#5d5a78", wrap: true },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: s.count
          ? [
              title("ตามหมวดหมู่"),
              ...s.byCategory.slice(0, 6).map((c) => row(c.name + pct(c.amount), baht(c.amount))),
              title("ตามผู้เบิก"),
              ...s.byPerson.slice(0, 5).map((p) => row(`${p.name} · ${p.count} รายการ`, baht(p.amount))),
              title("รายการใหญ่สุด"),
              ...s.top.slice(0, 3).map((x) => row((x.code ? x.code + " " : "") + x.name, baht(x.amount))),
              ...(s.waitingSlip.count || s.inReview
                ? [
                    { type: "separator", margin: "md" },
                    ...(s.inReview ? [row(`⏳ รออนุมัติ ${s.inReview} รายการ`, "")] : []),
                    ...(s.waitingSlip.count ? [row(`🧾 อนุมัติแล้วรอสลิป ${s.waitingSlip.count} รายการ`, baht(s.waitingSlip.amount))] : []),
                  ]
                : []),
            ]
          : [{ type: "text", text: "ยังไม่มีค่าใช้จ่ายที่บันทึกในช่วงนี้ค่ะ", size: "sm", color: "#5d5a78", wrap: true }],
      },
      ...(footer.length ? { footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: footer } } : {}),
    },
  };
}

export type ExpenseRow = { code?: string; date?: string; name?: string; category?: string; payee?: string; who?: string; amount?: number; payStatus?: string; status?: string; source?: string };
const cell = (v: unknown) => {
  const s = String(v ?? "");
  // Never let a cell start a formula when opened in Excel / Sheets.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** CSV with a UTF-8 BOM so Excel shows Thai correctly; Google Sheets imports it as is. */
export function expenseCsv(rows: ExpenseRow[], period: Period, company: string) {
  const head = ["เลขที่", "วันที่", "รายการ", "หมวดหมู่", "ผู้รับเงิน/ร้านค้า", "ผู้เบิก", "จำนวนเงิน (บาท)", "การชำระ", "สถานะ", "ที่มา"];
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const lines = [
    [`สรุปค่าใช้จ่าย ${period.label}`, company].map(cell).join(","),
    head.map(cell).join(","),
    ...rows.map((r) => [r.code, r.date, r.name, r.category, r.payee, r.who, Number(r.amount || 0).toFixed(2), r.payStatus, r.status, r.source].map(cell).join(",")),
    ["", "", "", "", "", "รวม", total.toFixed(2)].map(cell).join(","),
  ];
  return "﻿" + lines.join("\r\n") + "\r\n";
}
