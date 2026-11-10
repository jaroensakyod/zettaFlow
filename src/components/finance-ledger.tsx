"use client";
// สรุปรายรับ / ค่าใช้จ่าย: pick a day, month or year → totals with their tax (VAT, หัก ณ ที่จ่าย), money in vs out for
// the same period, a breakdown by day/month and by category, and every row — click one to see it in full with its file.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Scale, Landmark, HandCoins, Wallet, Receipt, Search, FileText, Pencil, ExternalLink } from "lucide-react";
import { api, money, displayDate, Empty, Loading, Modal } from "./shared";
import { categoryLabel } from "@/lib/expense-categories";

type Expense = {
  id: string; date: string; code: string; name: string; category: string; payee: string; docType: string; docNo: string;
  base: number; vat: number; claimable: number; gross: number; wht: number; whtForm: string; net: number;
  status: string; pending: boolean; projectId: string; receiptId: string; notes: string;
  project: string; projectName: string; payState: PayState; payStatus: string;
};
const payTone = { ชำระแล้ว: "paid", รอชำระ: "waiting", ยังไม่ชำระ: "unpaid" } as const;
type Income = {
  id: string; kind: "payments" | "sales" | "invoices"; date: string; docNo: string; name: string; customer: string; method: string;
  reference: string; invoice: string; amount: number; vat: number; base: number; notes: string;
  project: string; projectName: string; payState: PayState; owed: number; dueDate: string;
};
type PayState = "ชำระแล้ว" | "รอชำระ" | "ยังไม่ชำระ";
/** Money actually received (an unpaid invoice row is only a reminder). */
const cash = (rows: Income[]) => rows.filter((r) => r.kind !== "invoices");
type Ledger = { from: string; to: string; expenses: Expense[]; income: Income[]; salesIncluded: boolean };
type Mode = "day" | "week" | "month" | "year";

const pad = (n: number) => String(n).padStart(2, "0");
const bangkokToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthsTh = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const r2 = (n: number) => Math.round(n * 100) / 100;
const weekdaysTh = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Monday of the week the date falls in (Thai weeks start on Monday). */
const monday = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return addDays(iso, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
};
const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${monthsTh[m - 1]}`;
};

function range(mode: Mode, anchor: string) {
  const [y, m] = anchor.split("-").map(Number);
  if (mode === "day") return { from: anchor, to: anchor };
  if (mode === "week") return { from: monday(anchor), to: addDays(monday(anchor), 6) };
  if (mode === "month") return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
function shift(mode: Mode, anchor: string, dir: number) {
  const [y, m, d] = anchor.split("-").map(Number);
  if (mode === "day") return new Date(Date.UTC(y, m - 1, d + dir)).toISOString().slice(0, 10);
  if (mode === "week") return addDays(anchor, dir * 7);
  if (mode === "month") {
    const t = new Date(Date.UTC(y, m - 1 + dir, 1));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
  }
  return `${y + dir}-${pad(m)}-01`;
}
function label(mode: Mode, anchor: string) {
  const [y, m, d] = anchor.split("-").map(Number);
  const be = y + 543;
  if (mode === "day") return `${d} ${monthsTh[m - 1]} ${be}`;
  if (mode === "week") {
    const a = monday(anchor),
      b = addDays(a, 6);
    return `${shortDate(a)} – ${shortDate(b)} ${Number(b.slice(0, 4)) + 543}`;
  }
  if (mode === "month") return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
  return "ปี " + be;
}

export function FinanceLedger({
  kind,
  navigate,
  extraCards,
}: {
  kind: "expenses" | "income";
  navigate: (v: string) => void;
  /** More summary cards after the standard ones (e.g. ลูกค้าค้างชำระ on รายรับ). */
  extraCards?: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("month"),
    [anchor, setAnchor] = useState(bangkokToday),
    [raw, setRaw] = useState<Ledger | null>(null),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [open, setOpen] = useState<Expense | Income | null>(null);
  const { from, to } = range(mode, anchor);
  // A single day is drawn against the rest of its week, so fetch the week and narrow the numbers to the day.
  const fetchRange = mode === "day" ? range("week", anchor) : { from, to };
  useEffect(() => {
    let live = true;
    setError("");
    api(`/ledger?from=${fetchRange.from}&to=${fetchRange.to}`)
      .then((d: Ledger) => live && setRaw(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [fetchRange.from, fetchRange.to]);
  const data = useMemo(
    () =>
      raw && {
        ...raw,
        expenses: raw.expenses.filter((r) => r.date >= from && r.date <= to),
        income: raw.income.filter((r) => r.date >= from && r.date <= to),
      },
    [raw, from, to],
  );

  const totals = useMemo(() => {
    const e = data?.expenses || [],
      i = cash(data?.income || []);
    const sum = <T,>(rows: T[], f: (r: T) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
    return {
      out: sum(e, (r) => r.gross),
      outBase: sum(e, (r) => r.base),
      inVat: sum(e, (r) => r.claimable),
      wht: sum(e, (r) => r.wht),
      paid: sum(e, (r) => r.net),
      pending: e.filter((r) => r.pending).length,
      in: sum(i, (r) => r.amount),
      outVat: sum(i, (r) => r.vat),
      inBase: sum(i, (r) => r.base),
    };
  }, [data]);

  // Bars: the days of the week (a day: its week, that day highlighted), each day of the month, or each month of the year.
  const bars = useMemo(() => {
    if (!raw) return [];
    const [y, m] = anchor.split("-").map(Number);
    const keys =
      mode === "week" || mode === "day"
        ? weekdaysTh.map((t, k) => {
            const key = addDays(monday(anchor), k);
            return { key, label: t + " " + Number(key.slice(8)) };
          })
        : mode === "month"
          ? Array.from({ length: lastDay(y, m) }, (_, k) => ({ key: `${y}-${pad(m)}-${pad(k + 1)}`, label: String(k + 1) }))
          : monthsTh.map((t, k) => ({ key: `${y}-${pad(k + 1)}`, label: t }));
    const len = mode === "year" ? 7 : 10;
    return keys.map((k) => ({
      ...k,
      on: mode === "day" && k.key === anchor,
      value:
        kind === "expenses"
          ? r2(raw.expenses.filter((r) => r.date.slice(0, len) === k.key).reduce((s, r) => s + r.gross, 0))
          : r2(cash(raw.income).filter((r) => r.date.slice(0, len) === k.key).reduce((s, r) => s + r.amount, 0)),
    }));
  }, [raw, mode, anchor, kind]);
  const modeName = { day: "รายวัน", week: "รายสัปดาห์", month: "รายเดือน", year: "รายปี" }[mode],
    barsBy = { day: "เทียบวันอื่นในสัปดาห์เดียวกัน", week: "แยกตามวัน (จันทร์–อาทิตย์)", month: "แยกตามวันในเดือน", year: "แยกตามเดือน" }[mode];
  const groups = useMemo(() => {
    const map = new Map<string, number>();
    if (kind === "expenses") for (const r of data?.expenses || []) map.set(r.category || "ไม่ระบุหมวด", (map.get(r.category || "ไม่ระบุหมวด") || 0) + r.gross);
    else for (const r of cash(data?.income || [])) map.set(r.customer || (r.kind === "sales" ? "ยอดขาย" : "ไม่ระบุลูกค้า"), (map.get(r.customer || (r.kind === "sales" ? "ยอดขาย" : "ไม่ระบุลูกค้า")) || 0) + r.amount);
    return [...map.entries()].map(([k, v]) => ({ k, v: r2(v) })).sort((a, b) => b.v - a.v).slice(0, 6);
  }, [data, kind]);

  const term = q.trim().toLowerCase();
  const expRows = (data?.expenses || []).filter((r) => !term || [r.name, r.code, r.category, r.payee, r.docNo, r.projectName, r.payState].join(" ").toLowerCase().includes(term));
  const incRows = (data?.income || []).filter((r) => !term || [r.name, r.docNo, r.customer, r.invoice, r.reference, r.method, r.project, r.payState].join(" ").toLowerCase().includes(term));
  const balance = r2(totals.in - totals.out);
  const max = Math.max(1, ...bars.map((b) => b.value)),
    gmax = Math.max(1, ...groups.map((g) => g.v));

  // Each card has its own colour so the eye can tell them apart at a glance.
  const cards: [React.ComponentType<{ size?: number }>, string, string, string, string][] =
    kind === "expenses"
      ? [
          [Receipt, "ค่าใช้จ่ายรวม", "฿" + money(totals.out), (data?.expenses.length || 0) + " รายการ", "pink"],
          [Landmark, "ภาษีซื้อขอคืนได้ (VAT)", "฿" + money(totals.inVat), "เฉพาะใบกำกับภาษีเต็มรูป", "blue"],
          [HandCoins, "หัก ณ ที่จ่าย", "฿" + money(totals.wht), "ภ.ง.ด.3 / ภ.ง.ด.53 ที่ต้องนำส่ง", "amber"],
          [Wallet, "จ่ายจริงสุทธิ", "฿" + money(totals.paid), totals.pending ? totals.pending + " รายการยังรอตรวจ" : "หลังหัก ณ ที่จ่าย", "violet"],
        ]
      : [
          [TrendingUp, "รายรับรวม", "฿" + money(totals.in), cash(data?.income || []).length + " รายการที่รับเงินแล้ว", "green"],
          [Landmark, "ภาษีขาย (VAT) ในยอดรับ", "฿" + money(totals.outVat), "จากใบแจ้งหนี้ที่อ้างอิง", "blue"],
          [Wallet, "รายรับก่อน VAT", "฿" + money(totals.inBase), "ยอดที่เป็นรายได้จริง", "teal"],
        ];

  return (
    <div className="fl">
      <div className="fl-bar">
        <div className="fc-seg" role="group" aria-label="ช่วงเวลา">
          {(
            [
              ["day", "รายวัน"],
              ["week", "รายสัปดาห์"],
              ["month", "รายเดือน"],
              ["year", "รายปี"],
            ] as const
          ).map(([m, t]) => (
            <button key={m} className={mode === m ? "on" : ""} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t}
            </button>
          ))}
        </div>
        <div className="fl-nav">
          <button className="fc-icon-btn" aria-label="ก่อนหน้า" onClick={() => setAnchor(shift(mode, anchor, -1))}>
            <ChevronLeft size={16} />
          </button>
          <b>{label(mode, anchor)}</b>
          <button className="fc-icon-btn" aria-label="ถัดไป" onClick={() => setAnchor(shift(mode, anchor, 1))}>
            <ChevronRight size={16} />
          </button>
          <input type="date" value={anchor} aria-label="เลือกวันที่" onChange={(e) => e.target.value && setAnchor(e.target.value)} />
        </div>
      </div>

      {/* Money in vs money out for the same period. */}
      <section className="card fl-overview" aria-label="ภาพรวมรายรับและรายจ่าย">
        <button className={"fl-ov in" + (kind === "income" ? " on" : "")} onClick={() => kind !== "income" && navigate("income")}>
          <TrendingUp size={18} />
          <span>รายรับ</span>
          <b>฿{money(totals.in)}</b>
        </button>
        <span className="fl-op">−</span>
        <button className={"fl-ov out" + (kind === "expenses" ? " on" : "")} onClick={() => kind !== "expenses" && navigate("expenses")}>
          <TrendingDown size={18} />
          <span>รายจ่าย</span>
          <b>฿{money(totals.out)}</b>
        </button>
        <span className="fl-op">=</span>
        <div className={"fl-ov net " + (balance < 0 ? "neg" : "pos")}>
          <Scale size={18} />
          <span>{balance < 0 ? "ขาดดุล" : "คงเหลือ"}</span>
          <b>฿{money(Math.abs(balance))}</b>
        </div>
      </section>

      <div className="fl-cards">
        {cards.map(([Ico, t, v, note, tone]) => (
          <div className={"fl-card " + tone} key={t}>
            <span className="fl-card-icon">
              <Ico size={22} />
            </span>
            <div>
              <small>{t}</small>
              <b>{v}</b>
              <em>{note}</em>
            </div>
          </div>
        ))}
        {extraCards}
      </div>

      {error && <p className="form-error">{error}</p>}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          {(
            <div className="fl-grid">
              <section className="card fl-chart">
                <h3>
                  {kind === "expenses" ? "ค่าใช้จ่าย" : "รายรับ"}
                  {modeName}
                  <span className={"fl-mode-chip " + kind}>{label(mode, anchor)}</span>
                </h3>
                <p className="fl-chart-sub">{barsBy}</p>
                <div className={"fl-bars " + kind + (mode === "month" ? " days" : "")}>
                  {bars.map((b) => (
                    <button
                      key={b.key}
                      className={b.on ? "on" : ""}
                      title={`${b.label}: ฿${money(b.value)}`}
                      onClick={() => {
                        if (mode === "year") {
                          setMode("month");
                          setAnchor(b.key + "-01");
                        } else {
                          setMode("day");
                          setAnchor(b.key);
                        }
                      }}
                    >
                      <i style={{ height: `${Math.max(b.value ? 4 : 0, (b.value / max) * 100)}%` }} />
                      <small>{b.label}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section className="card fl-groups">
                <h3>{kind === "expenses" ? "ตามหมวดค่าใช้จ่าย" : "ตามลูกค้า"}</h3>
                {!groups.length ? (
                  <p className="note">ยังไม่มีรายการในช่วงนี้</p>
                ) : (
                  <ul>
                    {groups.map((g) => (
                      <li key={g.k}>
                        <span>{kind === "expenses" ? categoryLabel(g.k) : g.k}</span>
                        <b>฿{money(g.v)}</b>
                        <i style={{ width: `${(g.v / gmax) * 100}%` }} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          <section className="card fl-list">
            <header>
              <h3>
                รายการ{kind === "expenses" ? "ค่าใช้จ่าย" : "รายรับ"} · {label(mode, anchor)}
              </h3>
              <label className="fl-search">
                <Search size={15} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหารายการ ผู้รับเงิน เลขที่เอกสาร…" />
              </label>
            </header>
            {kind === "expenses" ? (
              !expRows.length ? (
                <Empty title="ไม่มีค่าใช้จ่ายในช่วงนี้" />
              ) : (
                <div className="table-wrap">
                  <table className="fl-table">
                    <thead>
                      <tr>
                        <th>เลขที่เอกสาร</th>
                        <th>วันที่</th>
                        <th>รายการค่าใช้จ่าย</th>
                        <th>โปรเจกต์</th>
                        <th className="num">ยอดสุทธิ</th>
                        <th>สถานะการชำระ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expRows.map((r) => (
                        <tr key={r.id} className={"fl-row " + payTone[r.payState]} onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(r)}>
                          <td className="fl-docno">
                            {/* No document number yet: a short system reference (end of the id). */}
                            {r.code || r.docNo || <span className="fl-ref" title="เลขอ้างอิงในระบบ">#{r.id.slice(-8)}</span>}
                          </td>
                          <td>{displayDate(r.date)}</td>
                          <td className="primary-cell">
                            {r.name}
                            <small>
                              {r.category ? categoryLabel(r.category) : ""}
                              {r.pending && <span className="badge pending">รอตรวจ</span>}
                            </small>
                          </td>
                          <td className="fl-project">
                            {r.project ? (
                              <>
                                <b>{r.project}</b>
                                {r.projectName && r.projectName !== r.project && <small>{r.projectName}</small>}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="num strong">฿{money(r.net)}</td>
                          <td>
                            <span className={"fl-pay " + payTone[r.payState]}>{r.payState}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>รวม {expRows.length} รายการ</td>
                        <td className="num strong">฿{money(expRows.reduce((s, r) => s + r.net, 0))}</td>
                        <td>
                          ค้างชำระ ฿{money(expRows.filter((r) => r.payState !== "ชำระแล้ว").reduce((s, r) => s + r.net, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            ) : !incRows.length ? (
              <Empty title="ไม่มีรายรับในช่วงนี้" />
            ) : (
              <div className="table-wrap">
                <table className="fl-table">
                  <thead>
                    <tr>
                      <th>เลขที่เอกสาร</th>
                      <th>วันที่</th>
                      <th>รายการรายรับ</th>
                      <th>โปรเจกต์</th>
                      <th className="num">ยอดสุทธิ</th>
                      <th>สถานะการชำระ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incRows.map((r) => (
                      <tr key={r.kind + r.id} className={"fl-row " + payTone[r.payState]} onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(r)}>
                        <td className="fl-docno">{r.docNo.startsWith("#") ? <span className="fl-ref" title="เลขอ้างอิงในระบบ">{r.docNo}</span> : r.docNo}</td>
                        <td>{displayDate(r.date)}</td>
                        <td className="primary-cell">
                          {r.name}
                          <small>
                            {r.customer || (r.kind === "sales" ? "ยอดขาย" : r.kind === "invoices" ? "ใบแจ้งหนี้" : "รับชำระ")}
                            {r.kind === "invoices" && r.dueDate ? " · ครบกำหนด " + displayDate(r.dueDate) : ""}
                          </small>
                        </td>
                        <td className="fl-project">
                          {r.project ? (
                            <>
                              <b>{r.project}</b>
                              {r.projectName && r.projectName !== r.project && <small>{r.projectName}</small>}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="num strong">฿{money(r.kind === "invoices" ? r.owed : r.amount)}</td>
                        <td>
                          <span className={"fl-pay " + payTone[r.payState]}>{r.payState}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>รวม {incRows.length} รายการ</td>
                      <td className="num strong">฿{money(cash(incRows).reduce((s, r) => s + r.amount, 0))}</td>
                      <td>ค้างรับ ฿{money(incRows.reduce((s, r) => s + r.owed, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {kind === "income" && !data.salesIncluded && <p className="note">ยอดขายจากฝ่ายขายแสดงเฉพาะผู้ที่มีสิทธิ์ฝ่ายขาย</p>}
          </section>
        </>
      )}
      {open && <Detail row={open} kind={kind} navigate={navigate} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** One row in full, with the file the expense was recorded from. */
function Detail({ row, kind, navigate, onClose }: { row: Expense | Income; kind: "expenses" | "income"; navigate: (v: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<{ id: string; mime: string; name: string }[] | null>(null);
  useEffect(() => {
    api("/files?entity=" + row.id)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [row.id]);
  const e = kind === "expenses" ? (row as Expense) : null,
    i = kind === "income" ? (row as Income) : null;
  const main = e ? files?.find((f) => f.id === e.receiptId) || files?.[0] : files?.[0];
  const fields: [string, string][] = e
    ? [
        ["วันที่", displayDate(e.date)],
        ["เลขที่เอกสาร", e.code || e.docNo || "—"],
        ["หมวด", e.category ? categoryLabel(e.category) : "—"],
        ["ผู้รับเงิน", e.payee || "—"],
        ["ประเภทเอกสาร", e.docType || "—"],
        ["ยอดก่อน VAT", "฿" + money(e.base)],
        ["VAT", "฿" + money(e.vat) + (e.vat && !e.claimable ? " (ขอคืนไม่ได้)" : "")],
        ["ยอดรวม", "฿" + money(e.gross)],
        ["หัก ณ ที่จ่าย", e.wht ? "฿" + money(e.wht) + " · " + e.whtForm : "—"],
        ["จ่ายสุทธิ", "฿" + money(e.net)],
        ["โปรเจกต์", e.project ? e.project + (e.projectName && e.projectName !== e.project ? " · " + e.projectName : "") : "—"],
        ["การชำระ", e.payState + (e.payStatus ? " · " + e.payStatus : "")],
        ["สถานะ", e.pending ? "รอตรวจ" : "บันทึกแล้ว"],
        ["หมายเหตุ", e.notes || "—"],
      ]
    : [
        ["วันที่", displayDate(i!.date)],
        ["เลขที่เอกสาร", i!.docNo],
        ["ที่มา", i!.kind === "sales" ? "ยอดขาย (ฝ่ายขาย)" : i!.kind === "invoices" ? "ใบแจ้งหนี้ที่ยังไม่ได้รับเงิน" : "รับชำระเงิน"],
        ["โปรเจกต์", i!.project ? i!.project + (i!.projectName && i!.projectName !== i!.project ? " · " + i!.projectName : "") : "—"],
        ["สถานะการชำระ", i!.payState + (i!.owed ? " · ค้าง ฿" + money(i!.owed) : "") + (i!.dueDate ? " · ครบกำหนด " + displayDate(i!.dueDate) : "")],
        ["ลูกค้า", i!.customer || "—"],
        ["ใบแจ้งหนี้", i!.invoice || "—"],
        ["ช่องทาง", i!.method || "—"],
        ["เลขอ้างอิง", i!.reference || "—"],
        ["ยอดก่อน VAT", "฿" + money(i!.base)],
        ["VAT", "฿" + money(i!.vat)],
        ["รับเงิน", "฿" + money(i!.amount)],
        ["หมายเหตุ", i!.notes || "—"],
      ];
  return (
    <Modal title={row.name || "รายละเอียด"} onClose={onClose}>
      <div className="fl-detail">
        <dl>
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <figure>
          {files === null ? (
            <Loading />
          ) : !main ? (
            <div className="acc-noreceipt">
              <FileText size={28} />
              <span>ไม่มีไฟล์แนบ</span>
            </div>
          ) : main.mime === "application/pdf" ? (
            <object data={"/api/files/" + main.id} type="application/pdf" aria-label={main.name}>
              <a href={"/api/files/" + main.id} target="_blank" rel="noreferrer">
                เปิด {main.name}
              </a>
            </object>
          ) : main.mime.startsWith("image/") ? (
            <a href={"/api/files/" + main.id} target="_blank" rel="noreferrer">
              <img src={"/api/files/" + main.id} alt={main.name} />
            </a>
          ) : (
            <a href={"/api/files/" + main.id} target="_blank" rel="noreferrer">
              เปิด {main.name}
            </a>
          )}
          {!!files && files.length > 1 && (
            <figcaption>
              ไฟล์อื่น:{" "}
              {files
                .filter((f) => f !== main)
                .map((f) => (
                  <a key={f.id} href={"/api/files/" + f.id} target="_blank" rel="noreferrer">
                    {f.name}
                  </a>
                ))}
            </figcaption>
          )}
        </figure>
      </div>
      <div className="modal-footer">
        {e ? (
          <button
            className="secondary"
            onClick={() => {
              onClose();
              navigate(e.pending ? "expenses?filter=pending" : "expense-new?id=" + e.id);
            }}
          >
            {e.pending ? <ExternalLink size={15} /> : <Pencil size={15} />}
            {e.pending ? "ไปตรวจรายการ" : "แก้ไขรายการ"}
          </button>
        ) : (
          <button
            className="secondary"
            onClick={() => {
              onClose();
              navigate(i!.kind === "sales" ? "sales" : i!.kind === "invoices" ? "invoices" : "payments?direction=income");
            }}
          >
            <ExternalLink size={15} /> เปิดหน้า{i!.kind === "sales" ? "ยอดขาย" : i!.kind === "invoices" ? "ใบแจ้งหนี้" : "รับชำระเงิน"}
          </button>
        )}
        <button className="primary" onClick={onClose}>
          ปิด
        </button>
      </div>
    </Modal>
  );
}
