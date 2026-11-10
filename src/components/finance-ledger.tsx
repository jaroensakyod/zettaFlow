"use client";
// สรุปรายรับ / ค่าใช้จ่าย: pick a day, month or year → totals with their tax (VAT, หัก ณ ที่จ่าย), money in vs out for
// the same period, a breakdown by day/month and by category, and every row — click one to see it in full with its file.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Scale, Landmark, HandCoins, Wallet, Receipt, Search, FileText, Pencil, ExternalLink, CheckCircle2, AlertTriangle, Upload } from "lucide-react";
import { uploadFile } from "./platform";
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

type DetailFile = { id: string; name: string; mime: string; role: "slip" | "receipt" | "wht" | "other" };
const rolePrefix = { slip: "สลิป - ", receipt: "ใบเสร็จ - ", wht: "หัก ณ ที่จ่าย - " } as const;
const roleName = { slip: "สลิปโอนเงิน", receipt: "ใบเสร็จ", wht: "หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)", other: "ไฟล์แนบ" } as const;
type DetailInfo = {
  createdAt: string;
  updatedAt: string;
  recorder: string;
  line: { group: string; sender: string } | null;
  account: { bank: string; number: string; name: string; type: string; promptPay: string } | null;
  files: DetailFile[];
  receipt: { issued: { number: string; date: string } | null; url: string; hasFile: boolean; canIssue: boolean };
};
const dateTime = (s: string) =>
  s ? new Date(s).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "—";

/** One row in full: what it was, project, who paid / was paid and how, the slip, the receipt, and who recorded it. */
function Detail({ row, kind, navigate, onClose }: { row: Expense | Income; kind: "expenses" | "income"; navigate: (v: string) => void; onClose: () => void }) {
  const [info, setInfo] = useState<DetailInfo | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [tick, setTick] = useState(0),
    [view, setView] = useState<DetailFile | null>(null);
  const e = kind === "expenses" ? (row as Expense) : null,
    i = kind === "income" ? (row as Income) : null;
  const sourceKind = e ? "expenses" : i!.kind;
  useEffect(() => {
    api(`/ledger/detail?kind=${sourceKind}&id=${row.id}`)
      .then((d: DetailInfo) => {
        setInfo(d);
        setView((v) => (v && d.files.some((f) => f.id === v.id) ? v : d.files.find((f) => f.role === "slip") || d.files.find((f) => f.role === "receipt") || d.files[0] || null));
      })
      .catch((err) => setError(err.message));
  }, [sourceKind, row.id, tick]);

  async function attach(file: File, role: "slip" | "receipt" | "wht") {
    setBusy(role);
    setError("");
    try {
      const named = new File([file], rolePrefix[role] + file.name, { type: file.type });
      await uploadFile(named, "Finance", row.id);
      setTick((t) => t + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  const state = e ? e.payState : i!.payState;
  const amount = e ? e.net : i!.kind === "invoices" ? i!.owed : i!.amount;
  const docNo = e ? e.code || e.docNo || "#" + e.id.slice(-8) : i!.docNo;
  const project = (e || i)!.project ? (e || i)!.project + ((e || i)!.projectName && (e || i)!.projectName !== (e || i)!.project ? " · " + (e || i)!.projectName : "") : "—";
  const acct = info?.account;
  const accountText = !i
    ? ""
    : i.method === "เงินสด"
      ? "เงินสด"
      : acct && (acct.bank || acct.number)
        ? [acct.bank, acct.number, acct.type && "(" + acct.type + ")"].filter(Boolean).join(" ") + (acct.name ? " · " + acct.name : "")
        : acct?.promptPay
          ? "พร้อมเพย์ " + acct.promptPay
          : "ยังไม่ได้ตั้งบัญชีบริษัท";

  const facts: [string, React.ReactNode][] = e
    ? [
        ["วันที่จ่าย", displayDate(e.date)],
        ["รายการ", e.name],
        ["หมวดค่าใช้จ่าย", e.category ? categoryLabel(e.category) : "—"],
        ["โปรเจกต์", project],
        ["จ่ายให้", e.payee || "—"],
        ["ช่องทางการจ่าย", e.payStatus || "—"],
        ["ประเภทเอกสาร", e.docType || "—"],
        ["เลขที่เอกสารผู้ขาย", e.docNo || "—"],
      ]
    : [
        [i!.kind === "invoices" ? "วันที่ออกใบแจ้งหนี้" : "วันที่ได้รับชำระ", displayDate(i!.date)],
        ["รายการ", i!.name],
        ["โปรเจกต์", project],
        ["ชำระมาจาก", i!.customer || "—"],
        ["ใบแจ้งหนี้", i!.invoice || "—"],
        ["ช่องทางการเงิน", i!.kind === "sales" ? i!.method || "ยอดขาย" : i!.method || "—"],
        ["เลขอ้างอิงการโอน", i!.reference || "—"],
        ["เข้าบัญชี", accountText],
        ...(i!.kind === "invoices" ? ([["ครบกำหนดชำระ", displayDate(i!.dueDate)]] as [string, React.ReactNode][]) : []),
      ];
  const money3: [string, number, string?][] = e
    ? [
        ["ยอดก่อน VAT", e.base],
        ["VAT", e.vat, e.vat && !e.claimable ? "ขอคืนไม่ได้" : undefined],
        ["หัก ณ ที่จ่าย", -e.wht, e.whtForm || undefined],
        ["จ่ายสุทธิ", e.net],
      ]
    : [
        ["ยอดก่อน VAT", i!.base],
        ["VAT", i!.vat],
        [i!.kind === "invoices" ? "ยอดค้างรับ" : "รับเงินสุทธิ", amount],
      ];
  const slip = info?.files.find((f) => f.role === "slip");
  const showsSlip = !e && i!.kind !== "invoices";

  return (
    // Title says what the money was for: the job (project) when there is one, else the item itself.
    <Modal
      title={(() => {
        const job = (e || i)!.projectName || (e || i)!.project;
        if (e) return job ? "ค่าใช้จ่ายของงาน " + job : "ค่าใช้จ่าย · " + row.name;
        if (i!.kind === "invoices") return job ? "ใบแจ้งหนี้ค้างรับ · งาน " + job : "ใบแจ้งหนี้ค้างรับ · " + row.name;
        return job ? "รายรับจากงาน " + job : "รายรับจาก " + row.name;
      })()}
      onClose={onClose}
    >
      <div className={"fd fd-" + payTone[state]}>
        <header className="fd-head">
          <div>
            <small>{e ? "จ่ายสุทธิ" : i!.kind === "invoices" ? "ยอดค้างรับ" : "รับเงิน"}</small>
            <b>฿{money(amount)}</b>
            <span>
              {docNo} · {row.name}
            </span>
          </div>
          <span className={"fl-pay " + payTone[state]}>{state}</span>
        </header>

        <div className="fd-grid">
          <div className="fd-col">
            <section className="fd-card">
              <h4>{e ? "ข้อมูลการจ่าย" : "ข้อมูลการรับชำระ"}</h4>
              <dl>
                {facts.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="fd-card">
              <h4>ยอดเงิน</h4>
              <dl className="fd-money">
                {money3.map(([k, v, note]) => (
                  <div key={k} className={k.includes("สุทธิ") || k === "ยอดค้างรับ" ? "total" : ""}>
                    <dt>
                      {k}
                      {note && <small> · {note}</small>}
                    </dt>
                    <dd>{v < 0 ? "−฿" + money(-v) : "฿" + money(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="fd-card">
              <h4>ผู้ดำเนินการ</h4>
              <dl>
                <div>
                  <dt>บันทึกโดย</dt>
                  <dd>{info ? info.recorder || (info.line ? "ระบบ (จาก LINE)" : "—") : "…"}</dd>
                </div>
                {info?.line && (
                  <div>
                    <dt>ที่มา</dt>
                    <dd>
                      LINE{info.line.group ? " · กลุ่ม " + info.line.group : ""}
                      {info.line.sender ? " · ส่งโดย " + info.line.sender : ""}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>บันทึกเมื่อ</dt>
                  <dd>{info ? dateTime(info.createdAt) : "…"}</dd>
                </div>
                {info && info.updatedAt && info.updatedAt !== info.createdAt && (
                  <div>
                    <dt>แก้ไขล่าสุด</dt>
                    <dd>{dateTime(info.updatedAt)}</dd>
                  </div>
                )}
              </dl>
            </section>
          </div>

          <div className="fd-col">
            {/* Documents we must receive and keep: from the customer (income) or from the payee (expense). */}
            {(() => {
              const slots: { role: "receipt" | "wht"; label: string; hint: string; required: boolean }[] = e
                ? [{ role: "receipt", label: "ใบเสร็จ / ใบกำกับภาษี", hint: "จากผู้รับเงิน", required: true }]
                : [
                    { role: "receipt", label: "ใบเสร็จ / หลักฐานรับเงิน", hint: "ที่ลูกค้าส่งมา", required: true },
                    { role: "wht", label: "หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)", hint: "ถ้าลูกค้าหักภาษี ณ ที่จ่ายไว้", required: false },
                  ];
              const have = (r: "receipt" | "wht") => (info?.files || []).filter((f) => f.role === r);
              const missing = slots.filter((x) => x.required && !have(x.role).length).length;
              return (
                <section className={"fd-card fd-receipt " + (info ? (missing ? "warn" : "ok") : "")}>
                  <h4>{e ? "เอกสารจากผู้รับเงิน" : "เอกสารที่ต้องได้รับจากลูกค้า"}</h4>
                  {info && (
                    <p className={"fd-status " + (missing ? "warn" : "ok")}>
                      {missing ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                      {missing
                        ? e
                          ? "ยังไม่ได้รับใบเสร็จ"
                          : "ยังไม่ได้รับใบเสร็จ"
                        : "ได้รับเอกสารครบแล้ว"}
                    </p>
                  )}
                  <ul className="fd-slots">
                    {slots.map((slot) => {
                      const got = have(slot.role);
                      return (
                        <li key={slot.role} className={got.length ? "got" : slot.required ? "need" : "opt"}>
                          <div className="fd-slot-head">
                            {got.length ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                            <span>
                              <b>{slot.label}</b>
                              <small>{got.length ? "ได้รับแล้ว " + got.length + " ไฟล์" : (slot.required ? "ยังไม่ได้รับ · " : "ไม่บังคับ · ") + slot.hint}</small>
                            </span>
                            <label className={"secondary as-button" + (busy === slot.role ? " busy" : "")}>
                              <Upload size={14} /> {busy === slot.role ? "กำลังแนบ…" : got.length ? "แนบเพิ่ม" : "แนบไฟล์"}
                              <input type="file" className="sr-only" accept="image/*,application/pdf" disabled={!!busy} onChange={(ev) => {
                                const f = ev.target.files?.[0];
                                ev.target.value = "";
                                if (f) attach(f, slot.role);
                              }} />
                            </label>
                          </div>
                          {!!got.length && (
                            <div className="fd-slot-files">
                              {got.map((f) => (
                                <button key={f.id} className={view?.id === f.id ? "on" : ""} onClick={() => setView(f)}>
                                  <FileText size={14} /> {f.name.replace(/^(ใบเสร็จ|หัก ณ ที่จ่าย|สลิป) - /, "")}
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })()}

            {showsSlip && (
              <section className={"fd-card " + (slip ? "" : "fd-receipt warn")}>
                <h4>สลิปโอนเงิน</h4>
                {!info ? null : slip ? (
                  <p className="fd-status ok">
                    <CheckCircle2 size={18} /> แนบสลิปแล้ว
                  </p>
                ) : (
                  <p className="fd-status warn">
                    <AlertTriangle size={18} /> ยังไม่มีสลิป
                  </p>
                )}
                <div className="fd-actions">
                  {slip && (
                    <button className={"secondary" + (view?.id === slip.id ? " on" : "")} onClick={() => setView(slip)}>
                      <FileText size={15} /> ดูสลิป
                    </button>
                  )}
                  <label className={"secondary as-button" + (busy === "slip" ? " busy" : "")}>
                    <Upload size={15} /> {busy === "slip" ? "กำลังแนบ…" : slip ? "แนบสลิปเพิ่ม" : "แนบสลิป"}
                    <input type="file" className="sr-only" accept="image/*,application/pdf" disabled={!!busy} onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      ev.target.value = "";
                      if (f) attach(f, "slip");
                    }} />
                  </label>
                </div>
              </section>
            )}

            <figure className="fd-preview">
              {!info ? (
                <Loading />
              ) : !view ? (
                <div className="acc-noreceipt">
                  <FileText size={28} />
                  <span>{showsSlip ? "ยังไม่มีสลิปหรือใบเสร็จแนบ" : "ยังไม่มีไฟล์แนบ"}</span>
                </div>
              ) : view.mime === "application/pdf" ? (
                <object data={"/api/files/" + view.id} type="application/pdf" aria-label={view.name}>
                  <a href={"/api/files/" + view.id} target="_blank" rel="noreferrer">เปิด {view.name}</a>
                </object>
              ) : view.mime.startsWith("image/") ? (
                <a href={"/api/files/" + view.id} target="_blank" rel="noreferrer" title="เปิดภาพเต็ม">
                  <img src={"/api/files/" + view.id} alt={view.name} />
                </a>
              ) : (
                <a href={"/api/files/" + view.id} target="_blank" rel="noreferrer">เปิด {view.name}</a>
              )}
              {view && <figcaption>{roleName[view.role]} · {view.name}</figcaption>}
            </figure>
            {!!info && info.files.filter((f) => f.role === "other").length > 0 && (
              <ul className="fd-files">
                {info.files
                  .filter((f) => f.role === "other")
                  .map((f) => (
                    <li key={f.id}>
                      <button className={view?.id === f.id ? "on" : ""} onClick={() => setView(f)}>
                        <FileText size={15} /> {f.name}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
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
