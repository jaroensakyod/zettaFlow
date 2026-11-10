"use client";
// รายรับ: money in, with its tax on the same page — ภาษีขาย (output VAT) from invoices, the ภ.พ.30 balance against
// ภาษีซื้อ from expenses, and what customers still owe. Below: the income records themselves (payments marked income).
import { useEffect, useState } from "react";
import { TrendingUp, Landmark, HandCoins, AlertTriangle, Plus, LayoutDashboard, Receipt, FileDigit, ChevronRight } from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { api, money, Empty, Loading } from "./shared";
import { Records } from "./records";
import { LinePending } from "./line-review";

type IncomeMonth = { month: string; income: number; invoiced: number; outVat: number; docs: number };
type Stage = { count: number; amount: number };
type IncomeReport = {
  months: IncomeMonth[];
  outstanding: number;
  openInvoices: number;
  overdue: number;
  overdueCount: number;
  invoices: number;
  pipeline: { quotesSent: Stage; quotesAccepted: Stage; ordersToInvoice: Stage } | null;
};
type TaxMonth = { month: string; vat: number };
const monthName = (m: string) => new Date(m + "-01").toLocaleDateString("th-TH", { month: "long", year: "numeric" });
const thisMonth = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);

/** Financial Center · รายรับ · ค่าใช้จ่าย — the same three places as the sidebar, on top of each page. */
export function FinanceTabs({ current, navigate, children }: { current: "finance" | "income" | "expenses"; navigate?: (v: string) => void; children?: React.ReactNode }) {
  const tabs = [
    ["finance", "ภาพรวม", LayoutDashboard],
    ["income", "รายรับ", TrendingUp],
    ["expenses", "ค่าใช้จ่าย", Receipt],
  ] as const;
  return (
    <div className="acc-tabs" role="tablist">
      {tabs.map(([v, label, Icon]) => (
        <button key={v} role="tab" aria-selected={current === v} className={current === v ? "active" : ""} onClick={() => current !== v && navigate?.(v)}>
          <Icon size={15} /> {label}
        </button>
      ))}
      {children}
    </div>
  );
}

export function IncomePage({ ctx, notify, changed, navigate }: { ctx: Context; notify: (s: string) => void; changed: () => void; navigate: (v: string) => void }) {
  const [data, setData] = useState<IncomeReport | null>(null),
    [tax, setTax] = useState<TaxMonth[]>([]),
    [error, setError] = useState(""),
    [signal, setSignal] = useState(0),
    [tick, setTick] = useState(0);
  const writable = ctx.member.role !== "viewer";
  useEffect(() => {
    api("/income-report").then(setData).catch((e) => setError(e.message));
    api("/tax-report").then(setTax).catch(() => {});
  }, [tick]);
  const refresh = () => {
    setTick((t) => t + 1);
    changed();
  };
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <Loading />;
  const month = thisMonth(),
    now = data.months.find((m) => m.month === month) || { month, income: 0, invoiced: 0, outVat: 0, docs: 0 },
    inVat = tax.find((t) => t.month === month)?.vat || 0,
    vatDue = Math.round((now.outVat - inVat) * 100) / 100;
  return (
    <div className="acc income-page">
      <FinanceTabs current="income" navigate={navigate}>
        {writable && (
          <button className="primary acc-new" onClick={() => setSignal((n) => n + 1)}>
            <Plus size={16} /> บันทึกรายรับ
          </button>
        )}
      </FinanceTabs>
      <div className="expense-cards">
        {(
          [
            [TrendingUp, "รายรับเดือนนี้", "฿" + money(now.income)],
            [Landmark, "ภาษีขาย (ภ.พ.30) เดือนนี้", "฿" + money(now.outVat)],
            [HandCoins, "ลูกค้าค้างชำระ", "฿" + money(data.outstanding)],
            [AlertTriangle, "ใบแจ้งหนี้เกินกำหนด", data.overdueCount + " ใบ" + (data.overdue ? " · ฿" + money(data.overdue) : "")],
          ] as const
        ).map(([Ico, label, value]) => (
          <div className="card expense-card" key={label}>
            <small>
              <Ico size={15} /> {label}
            </small>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <SalesFlow data={data} month={now} navigate={navigate} />
      <section className="card income-vat">
        <Landmark size={18} />
        <span>
          <b>ภ.พ.30 เดือนนี้</b> ภาษีขาย ฿{money(now.outVat)} − ภาษีซื้อ ฿{money(inVat)} ={" "}
          <b className={vatDue > 0 ? "down" : "up"}>
            {vatDue > 0 ? "ต้องชำระ ฿" + money(vatDue) : vatDue < 0 ? "ขอคืน/ยกไป ฿" + money(-vatDue) : "฿0"}
          </b>
          <small>ภาษีขายคิดจากใบแจ้งหนี้ตามวันที่เอกสาร · ภาษีซื้อจากค่าใช้จ่ายที่ตรวจแล้ว · ยื่นภายในวันที่ 15 ของเดือนถัดไป (ออนไลน์)</small>
        </span>
        <button className="secondary" onClick={() => navigate("invoices")}>
          <FileDigit size={15} /> ใบแจ้งหนี้
        </button>
      </section>
      {!data.months.length ? (
        <Empty title="ยังไม่มีรายรับ" description="บันทึกรายรับ หรือออกใบแจ้งหนี้ ระบบจะสรุปยอดและภาษีขายให้รายเดือน" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>เดือน</th>
                <th>รายรับ</th>
                <th>ออกใบแจ้งหนี้</th>
                <th>ภาษีขาย (ภ.พ.30)</th>
                <th>ภาษีซื้อ</th>
                <th>ภาษีต้องชำระ</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => {
                const iv = tax.find((t) => t.month === m.month)?.vat || 0,
                  due = Math.round((m.outVat - iv) * 100) / 100;
                return (
                  <tr key={m.month}>
                    <td className="primary-cell">{monthName(m.month)}</td>
                    <td>฿{money(m.income)}</td>
                    <td>฿{money(m.invoiced)}</td>
                    <td>฿{money(m.outVat)}</td>
                    <td>฿{money(iv)}</td>
                    <td className={due > 0 ? "down" : ""}>{due < 0 ? "ขอคืน ฿" + money(-due) : "฿" + money(due)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="acc-table-title">รายการรายรับ</h2>
      <LinePending kind="payments" ctx={ctx} notify={notify} changed={refresh} />
      <Records
        kind="payments"
        ctx={ctx}
        notify={notify}
        changed={refresh}
        refresh={tick}
        only={{ label: "รายรับ", test: (e: Entity) => e.data.direction === "income" }}
        preset={{ direction: "income" }}
        addLabel="บันทึกรายรับ"
        newSignal={signal}
      />
    </div>
  );
}

/** ขั้นตอนการขาย: how many documents wait at each stage, each stage opens its page. */
function SalesFlow({ data, month, navigate }: { data: IncomeReport; month: IncomeMonth; navigate: (v: string) => void }) {
  const p = data.pipeline;
  const steps: [number, string, string, string, string][] = [
    [1, "ใบเสนอราคา", p ? p.quotesSent.count + " ใบ รอลูกค้าตอบ" : "—", p ? "฿" + money(p.quotesSent.amount) : "", "quotations"],
    [2, "ลูกค้ายืนยัน", p ? p.quotesAccepted.count + " ใบ รอเปิดคำสั่งซื้อ" : "—", p ? "฿" + money(p.quotesAccepted.amount) : "", "sales_orders"],
    [3, "ออกใบแจ้งหนี้", p ? p.ordersToInvoice.count + " คำสั่งซื้อ รอออกใบ" : "—", p ? "฿" + money(p.ordersToInvoice.amount) : "", "invoices"],
    [4, "รับชำระเงิน", data.openInvoices + " ใบ รอรับเงิน", "฿" + money(data.outstanding), "payments?direction=income"],
    [5, "ใบเสร็จรับเงิน", month.docs + " รายการ รับเงินเดือนนี้", "฿" + money(month.income), "receipts"],
  ];
  return (
    <section className="card sales-flow" aria-label="ขั้นตอนการขาย">
      <header>
        <b>ขั้นตอนการขาย</b>
        <small>ทำใบเสนอราคา → ลูกค้าตอบรับ (แนบไฟล์ที่ลูกค้าเซ็นในใบเสนอราคา) → แปลงเป็นคำสั่งซื้อ → ออกใบแจ้งหนี้ → รับเงิน → ออกใบเสร็จ</small>
      </header>
      <ol>
        {steps.map(([n, label, note, amount, view], i) => (
          <li key={n}>
            <button onClick={() => navigate(view)}>
              <i>{n}</i>
              <span>
                <b>{label}</b>
                <small>{note}</small>
                {amount && <em>{amount}</em>}
              </span>
            </button>
            {i < steps.length - 1 && <ChevronRight size={16} className="sales-flow-arrow" />}
          </li>
        ))}
      </ol>
      {!p && <p className="note">ตัวเลขใบเสนอราคาและคำสั่งซื้อแสดงเฉพาะผู้ที่มีสิทธิ์ฝ่ายขาย</p>}
    </section>
  );
}
