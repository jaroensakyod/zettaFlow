"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Eye, FileBadge, Hash, ReceiptText, Search, Sparkles, Wallet, CircleCheck } from "lucide-react";
import type { Context } from "@/lib/types";
import type { ReceiptRow, ReceiptsData } from "@/lib/receipts";
import { api } from "./shared";

type Tab = ReceiptRow["kind"];
type Filter = "all" | "issued" | "pending";
const tabs: { key: Tab; label: string; en: string; icon: typeof ReceiptText }[] = [
  { key: "receipt", label: "ใบเสร็จรับเงิน", en: "Receipt", icon: ReceiptText },
  { key: "tax_invoice", label: "ใบกำกับภาษี", en: "Tax Invoice", icon: FileBadge },
];
const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thaiDate = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])} ${months[Number(m[2]) - 1]} ${Number(m[1]) + 543}` : "—";
};
const baht = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sampleUrl = (kind: Tab) => `/print/sample/${kind}`;

// Shown only while the company has no document of a kind yet (fictional companies, design sample values).
const sampleRows = (kind: Tab, today: string): ReceiptRow[] => {
  const ym = today.slice(0, 7),
    pre = kind === "receipt" ? "RC" : "TAX",
    y = today.slice(0, 4);
  const rows: [string | null, string, string, string, number][] =
    kind === "receipt"
      ? [
          [`${pre}-${y}-0028`, `${ym}-20`, "บริษัท ไบรท์โซลูชั่น จำกัด", "INV-2026-0014", 256800],
          [`${pre}-${y}-0027`, `${ym}-18`, "บริษัท สยามคอนเนค จำกัด", "INV-2026-0012", 85600],
          [`${pre}-${y}-0026`, `${ym}-11`, "ห้างหุ้นส่วนจำกัด กรีนเฮาส์ดีไซน์", "INV-2026-0010", 42800],
          [null, `${ym}-21`, "บริษัท นอร์ธสตาร์ เทคโนโลยี จำกัด", "INV-2026-0015", 128400],
        ]
      : [
          [`${pre}-${y}-0005`, `${ym}-20`, "บริษัท ไบรท์โซลูชั่น จำกัด", "INV-2026-0014", 256800],
          [`${pre}-${y}-0004`, `${ym}-15`, "บริษัท สยามคอนเนค จำกัด", "INV-2026-0012", 85600],
          [null, `${ym}-21`, "บริษัท นอร์ธสตาร์ เทคโนโลยี จำกัด", "INV-2026-0015", 128400],
        ];
  return rows.map(([number, date, customer, ref, amount], i) => ({
    kind,
    id: `sample-${kind}-${i}`,
    source: "invoice",
    number,
    issuedOn: number ? date : null,
    date,
    customer,
    ref,
    amount,
    url: sampleUrl(kind),
  }));
};

/** ใบเสร็จรับเงิน / ใบกำกับภาษี: everything issued or ready to issue, with print links and "ออกเลขที่". */
export function ReceiptsPage({ ctx, notify, navigate }: { ctx: Context; notify: (s: string) => void; navigate: (v: string) => void }) {
  const [data, setData] = useState<ReceiptsData | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<Tab>("receipt"),
    [filter, setFilter] = useState<Filter>("all"),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api("/receipt-docs"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const today = data?.today || new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const real = useMemo(() => (data?.rows || []).filter((r) => r.kind === tab), [data, tab]);
  const sample = !!data && real.length === 0;
  const all = sample ? sampleRows(tab, today) : real;
  const q = search.trim().toLowerCase();
  const rows = all.filter(
    (r) =>
      (filter === "all" || (filter === "issued") === !!r.number) &&
      (!q || [r.number, r.customer, r.ref].some((x) => (x || "").toLowerCase().includes(q))),
  );
  const month = today.slice(0, 7);
  const issuedThisMonth = all.filter((r) => r.number && (r.issuedOn || "").startsWith(month)).length,
    pending = all.filter((r) => !r.number).length,
    total = all.reduce((t, r) => t + r.amount, 0);
  const canIssue = !!data?.canIssue && ctx.member.role !== "viewer";
  const label = tabs.find((t) => t.key === tab)!.label;

  const issue = async (r: ReceiptRow) => {
    setBusy(r.id);
    try {
      // Same endpoint as the document's own "ออกเลขที่" button; success answers with a redirect to the document.
      const res = await fetch(r.url, { method: "POST", redirect: "manual" });
      if (res.type !== "opaqueredirect" && !res.ok) {
        const text = await res.text();
        throw new Error(/<p>([^<]+)<\/p>/.exec(text)?.[1] || "ออกเลขที่ไม่สำเร็จ");
      }
      await load();
      notify(`ออกเลขที่${label}แล้ว`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rc">
      <div className="rc-head">
        <div>
          <h1>ใบเสร็จรับเงิน</h1>
          <p>ออกใบเสร็จรับเงินจากการรับชำระ และใบกำกับภาษีจากใบแจ้งหนี้ · เลขที่เอกสารรันต่อเนื่องรายปี</p>
        </div>
        <div className="rc-actions">
          <button type="button" className="secondary" onClick={() => navigate("payments")}>
            <Wallet size={15} aria-hidden /> การรับชำระเงิน
          </button>
          <a className="rc-sample-link" href={sampleUrl(tab)} target="_blank" rel="noopener">
            <Eye size={15} aria-hidden /> ดูตัวอย่างเอกสาร
          </a>
        </div>
      </div>

      <div className="rc-tabs" role="tablist">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
              <Icon size={16} aria-hidden />
              {t.label} <em>{t.en}</em>
            </button>
          );
        })}
      </div>

      <div className="rc-tiles">
        <div className="rc-tile green">
          <span className="rc-tile-icon"><CircleCheck size={22} /></span>
          <div><small>ออกแล้วเดือนนี้</small><b>{issuedThisMonth}<em> ฉบับ</em></b></div>
        </div>
        <div className="rc-tile orange">
          <span className="rc-tile-icon"><Clock3 size={22} /></span>
          <div><small>รอออกเลขที่</small><b>{pending}<em> รายการ</em></b></div>
        </div>
        <div className="rc-tile violet">
          <span className="rc-tile-icon"><Wallet size={22} /></span>
          <div><small>ยอดรวม{label}</small><b>{baht(total)}<em> บาท</em></b></div>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="rc-card">
        {sample && (
          <div className="rc-sample-note">
            <span className="rc-badge"><Sparkles size={13} aria-hidden /> ตัวอย่าง</span>
            <p>ยังไม่มี{label}ของบริษัท — รายการด้านล่างเป็นตัวอย่าง (ข้อมูลสมมุติ) และจะหายไปเมื่อมีข้อมูลจริง {tab === "receipt" ? "บันทึกการรับชำระเงินหรือปิดใบแจ้งหนี้ที่ชำระครบ" : "สร้างใบแจ้งหนี้"} แล้วออกเลขที่ได้จากหน้านี้</p>
          </div>
        )}
        <div className="rc-tools">
          <label className="rc-search">
            <Search size={16} aria-hidden />
            <input aria-label={`ค้นหา${label}`} placeholder="ค้นหาเลขที่ ลูกค้า หรือเลขอ้างอิง" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="rc-filter" role="group" aria-label="สถานะ">
            {(
              [
                ["all", "ทั้งหมด"],
                ["issued", "ออกแล้ว"],
                ["pending", "รอออก"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {!data && !error ? (
          <p className="rc-empty">กำลังโหลด…</p>
        ) : (
          <div className="rc-table-wrap">
            <table className={"rc-table" + (sample ? " is-sample" : "")}>
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>วันที่</th>
                  <th>ลูกค้า</th>
                  <th>อ้างอิง</th>
                  <th className="num">จำนวนเงิน</th>
                  <th>สถานะ</th>
                  <th aria-label="การทำงาน" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.number ? <b className="rc-no">{r.number}</b> : <span className="rc-none">ยังไม่ออกเลข</span>}</td>
                    <td>{thaiDate(r.issuedOn || r.date)}</td>
                    <td className="rc-customer">{r.customer || "—"}</td>
                    <td>
                      <span className="rc-ref"><Hash size={12} aria-hidden />{r.ref || "—"}</span>
                    </td>
                    <td className="num">{baht(r.amount)}</td>
                    <td>
                      <span className={"rc-status " + (r.number ? "done" : "wait")}>{r.number ? "ออกแล้ว" : "รอออกเลขที่"}</span>
                    </td>
                    <td className="rc-row-actions">
                      <a href={r.url} target="_blank" rel="noopener" className="rc-btn">
                        <Eye size={14} aria-hidden /> {r.number ? "ดู/พิมพ์" : "ดูร่าง"}
                      </a>
                      {!r.number && canIssue && !sample && (
                        <button type="button" className="rc-btn primary" disabled={busy === r.id} onClick={() => issue(r)}>
                          {busy === r.id ? "กำลังออก…" : "ออกเลขที่"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={7} className="rc-empty">ไม่พบรายการที่ตรงกับการค้นหา</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
