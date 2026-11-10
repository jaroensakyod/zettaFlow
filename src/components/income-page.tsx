"use client";
// รายรับ: money in, with its tax on the same page — ภาษีขาย (output VAT) from invoices, the ภ.พ.30 balance against
// ภาษีซื้อ from expenses, what customers still owe, the sales flow, and the period summary with every income row.
import { useEffect, useState } from "react";
import { TrendingUp, Landmark, HandCoins, AlertTriangle, Plus, LayoutDashboard, Receipt, FileDigit, ChevronRight } from "lucide-react";
import type { Context } from "@/lib/types";
import { api, money, Loading } from "./shared";
import { FinanceLedger } from "./finance-ledger";

type IncomeMonth = { month: string; income: number; invoiced: number; outVat: number; docs: number };
type Stage = { count: number; amount: number };
type IncomeReport = {
  months: IncomeMonth[];
  outstanding: number;
  openInvoices: number;
  overdue: number;
  overdueCount: number;
  invoices: number;
  pipeline: { quotesSent: Stage; quotesAccepted: Stage; ordersToInvoice: Stage; ordersUnpaid: Stage } | null;
};
type TaxMonth = { month: string; vat: number };
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

export function IncomePage({ ctx, navigate }: { ctx: Context; navigate: (v: string) => void }) {
  const [data, setData] = useState<IncomeReport | null>(null),
    [tax, setTax] = useState<TaxMonth[]>([]),
    [error, setError] = useState("");
  const writable = ctx.member.role !== "viewer";
  useEffect(() => {
    api("/income-report").then(setData).catch((e) => setError(e.message));
    api("/tax-report").then(setTax).catch(() => {});
  }, []);
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
          <button className="primary acc-new" onClick={() => navigate("payments?direction=income&new=1")}>
            <Plus size={16} /> บันทึกรายรับ
          </button>
        )}
      </FinanceTabs>
      <SalesFlow data={data} month={now} navigate={navigate} />
      <FinanceLedger
        kind="income"
        navigate={navigate}
        extraCards={
          <>
            <div className="fl-card amber">
              <span className="fl-card-icon">
                <HandCoins size={22} />
              </span>
              <div>
                <small>ลูกค้าค้างชำระ (ทั้งหมด)</small>
                <b>฿{money(data.outstanding)}</b>
                <em>{data.openInvoices} ใบแจ้งหนี้รอรับเงิน</em>
              </div>
            </div>
          </>
        }
      />
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
      {!!data.overdueCount && (
        <p className="note income-overdue">
          <AlertTriangle size={14} /> ใบแจ้งหนี้เกินกำหนด {data.overdueCount} ใบ · ฿{money(data.overdue)} —{" "}
          <button className="fc-link" onClick={() => navigate("invoices")}>ดูใบแจ้งหนี้</button>
        </p>
      )}
    </div>
  );
}

/** ขั้นตอนการขาย: how many documents wait at each stage, each stage opens its page. */
function SalesFlow({ data, month, navigate }: { data: IncomeReport; month: IncomeMonth; navigate: (v: string) => void }) {
  const p = data.pipeline;
  const steps: [number, string, string, string, string][] = [
    [1, "ใบเสนอราคา", p ? p.quotesSent.count + " ใบ รอลูกค้าตอบ" : "—", p ? "฿" + money(p.quotesSent.amount) : "", "quotations"],
    [2, "คำสั่งซื้อ", p ? p.ordersUnpaid.count + " คำสั่งซื้อ ยังไม่ได้รับเงิน" : "—", p ? "฿" + money(p.ordersUnpaid.amount) : "", "sales_orders"],
    [3, "ใบแจ้งหนี้", p ? p.ordersToInvoice.count + p.quotesAccepted.count + " งาน รอออกใบแจ้งหนี้" : "—", p ? "฿" + money(p.ordersToInvoice.amount + p.quotesAccepted.amount) : "", "invoices"],
    [4, "รับชำระเงิน", data.openInvoices + " ใบแจ้งหนี้ รอรับเงิน", "฿" + money(data.outstanding), "payments?direction=income"],
    [5, "ใบเสร็จรับเงิน", month.docs + " รายการ รับเงินเดือนนี้", "฿" + money(month.income), "receipts"],
  ];
  return (
    <section className="card sales-flow" aria-label="ขั้นตอนการขาย">
      <header>
        <b>ขั้นตอนการขาย</b>
        <small>ใบเสนอราคา → ลูกค้าตอบรับ → เปิดคำสั่งซื้อ (แพ็กเกจ · แพลตฟอร์ม) → ออกใบแจ้งหนี้ → รับเงิน → เก็บใบเสร็จ</small>
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
      {!p && <p className="note">ตัวเลขใบเสนอราคาแสดงเฉพาะผู้ที่มีสิทธิ์ฝ่ายขาย</p>}
    </section>
  );
}
