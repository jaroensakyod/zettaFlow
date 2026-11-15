"use client";
// รายรับ: money in, with its tax on the same page — ภาษีขาย (output VAT) from invoices, the ภ.พ.30 balance against
// ภาษีซื้อ from expenses, what customers still owe, the sales flow, and the period summary with every income row.
import { useEffect, useState, type ReactNode } from "react";
import { TrendingUp, Landmark, HandCoins, AlertTriangle, Plus, LayoutDashboard, Receipt, FileDigit, ChevronRight, FileText, ShoppingCart, Wallet, ScrollText } from "lucide-react";
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
          <button className="primary acc-new income" onClick={() => navigate("income-new")}>
            <Plus size={16} /> บันทึกรายรับ
          </button>
        )}
      </FinanceTabs>
      <SalesFlow />
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

/** ขั้นตอนการขาย: a slim strip that only shows the order of the steps (not buttons), each in its own colour. */
const salesSteps: [string, string, string, ReactNode][] = [
  ["ใบเสนอราคา", "ส่งให้ลูกค้า", "violet", <FileText key="i" size={15} />],
  ["คำสั่งซื้อ", "ลูกค้าตอบรับ", "blue", <ShoppingCart key="i" size={15} />],
  ["ใบแจ้งหนี้", "เรียกเก็บเงิน", "amber", <FileDigit key="i" size={15} />],
  ["รับชำระเงิน", "เงินเข้า", "teal", <Wallet key="i" size={15} />],
  ["ใบเสร็จรับเงิน", "ส่งหลักฐาน", "green", <ScrollText key="i" size={15} />],
];
function SalesFlow() {
  return (
    <section className="card sales-flow" aria-label="ขั้นตอนการขาย">
      <b className="sf-title">ขั้นตอนการขาย</b>
      <ol>
        {salesSteps.map(([label, hint, tone, icon], i) => (
          <li key={label} className={"sf-" + tone}>
            <span className="sf-step">
              <i>{i + 1}</i>
              <span className="sf-icon">{icon}</span>
              <span className="sf-text">
                <b>{label}</b>
                <small>{hint}</small>
              </span>
            </span>
            {i < salesSteps.length - 1 && <ChevronRight size={16} className="sales-flow-arrow" aria-hidden />}
          </li>
        ))}
      </ol>
    </section>
  );
}
