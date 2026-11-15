"use client";
// บันทึกรายรับ: one page to record money received, laid out like บันทึกค่าใช้จ่าย. General info and who paid on the
// left, a live summary of the invoice (total, received before, this payment, still owed) on the right, notes below.
// A payment cannot be edited after it is saved (archive it to cancel), so there is no draft: one save.
import { useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, Calculator, ChevronDown, ChevronRight, FileText, Hash, HandCoins, NotebookPen, Pencil, Printer, Save, UserRound, Wallet, X } from "lucide-react";
import type { Context } from "@/lib/types";
import { api } from "./shared";
import { Field, SectionTitle, SumRow } from "./expense-form";

type Invoice = { id: string; name: string; customerId: string; customer: string; date: string; dueDate: string; total: number; received: number; owed: number };
type Customer = { id: string; name: string; taxId: string; phone: string };
type FormData = { next: string; invoices: Invoice[]; customers: Customer[]; branches: { id: string; name: string }[] };

const METHODS = ["โอนธนาคาร", "เงินสด", "บัตร", "อื่นๆ"];
const NOTE_MAX = 500;
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const two = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const thaiStamp = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).replace(" เวลา", "");

export function IncomeForm({
  ctx,
  invoiceId,
  navigate,
  notify,
  changed,
}: {
  ctx: Context;
  invoiceId: string | null;
  navigate: (view: string) => void;
  notify: (s: string) => void;
  changed: () => void;
}) {
  const [form, setForm] = useState<FormData | null>(null),
    [code, setCode] = useState(""),
    [editCode, setEditCode] = useState(false),
    [name, setName] = useState(""),
    [nameTouched, setNameTouched] = useState(false),
    [date, setDate] = useState(today()),
    [invoice, setInvoice] = useState(""),
    [customerId, setCustomerId] = useState(""),
    [branchId, setBranchId] = useState(""),
    [method, setMethod] = useState(METHODS[0]),
    [reference, setReference] = useState(""),
    [amount, setAmount] = useState(0),
    [notes, setNotes] = useState(""),
    [menu, setMenu] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stamp] = useState(() => new Date().toISOString());
  const writable = ctx.member.role !== "viewer" && (ctx.member.role === "owner" || ctx.member.departments.includes("Finance"));

  useEffect(() => {
    api("/income-form")
      .then((f: FormData) => {
        setForm(f);
        setCode(f.next);
        if (invoiceId && f.invoices.some((i) => i.id === invoiceId)) pickInvoice(invoiceId, f);
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inv = form?.invoices.find((i) => i.id === invoice) || null;
  const customer = form?.customers.find((c) => c.id === customerId) || null;
  // Open invoices first; the one picked stays in the list even when it is paid in full.
  const invoiceOptions = useMemo(() => (form?.invoices || []).filter((i) => i.owed > 0 || i.id === invoice), [form, invoice]);

  function pickInvoice(id: string, f = form) {
    setInvoice(id);
    const i = f?.invoices.find((x) => x.id === id);
    if (!i) return;
    if (i.customerId) setCustomerId(i.customerId);
    setAmount(i.owed);
    if (!nameTouched) setName("รับชำระ " + i.name);
  }

  const after = inv ? r2(Math.max(0, inv.owed - amount)) : 0;
  const over = inv ? amount > inv.owed + 0.001 : false;

  async function save(next?: "new") {
    setError("");
    if (!name.trim()) return setError("กรอกรายการรับเงิน");
    if (!(amount > 0)) return setError("จำนวนเงินที่รับต้องมากกว่า 0");
    if (over) return setError("ยอดที่รับเกินยอดคงค้างของใบแจ้งหนี้ (฿" + two(inv!.owed) + ")");
    setBusy(true);
    try {
      const data = { name: name.trim(), code: code.trim(), invoiceId: invoice, customerId, direction: "income", date, amount: r2(amount), method, reference: reference.trim(), notes: notes.trim(), branchId };
      const body = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== "" && v !== undefined && v !== null));
      await api("/entities/payments", { method: "POST", body: { data: body } });
      changed();
      notify("บันทึกรายรับแล้ว");
      navigate(next === "new" ? "income-new?n=" + Date.now() : "income");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setMenu(false);
    }
  }

  const locked = !writable || busy;
  return (
    <div className="exf inf">
      <nav className="exf-crumbs" aria-label="ตำแหน่งหน้า">
        <button onClick={() => navigate("income")}>บัญชีและการเงิน</button>
        <ChevronRight size={15} />
        <button onClick={() => navigate("income")}>รายรับ</button>
        <ChevronRight size={15} />
        <span aria-current="page">บันทึกรายรับ</span>
      </nav>
      <header className="exf-head">
        <span className="exf-head-icon">
          <HandCoins size={34} />
        </span>
        <div className="exf-head-title">
          <h1>บันทึกรายรับ</h1>
          <p>บันทึกเงินที่ได้รับจากลูกค้า ผูกกับใบแจ้งหนี้ แล้วออกใบเสร็จรับเงินได้</p>
        </div>
        <div className="exf-docno">
          <label htmlFor="inf-code">เลขที่เอกสาร</label>
          <div className="exf-docno-box">
            <input id="inf-code" value={code} readOnly={!editCode} maxLength={40} onChange={(e) => setCode(e.target.value)} />
            <button type="button" aria-label="แก้เลขที่เอกสาร" disabled={locked} onClick={() => setEditCode(!editCode)}>
              <Pencil size={15} />
            </button>
          </div>
          <dl>
            <dt>วันที่สร้าง :</dt>
            <dd>{thaiStamp(stamp)}</dd>
            <dt>สถานะ :</dt>
            <dd className="exf-status">
              <i />
              รอดำเนินการ
            </dd>
          </dl>
        </div>
        <button type="button" className="exf-print" onClick={() => window.print()}>
          <Printer size={17} /> พิมพ์แบบฟอร์ม
        </button>
      </header>

      <form className="exf-grid inf-grid" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="exf-card exf-general" disabled={locked}>
          <SectionTitle icon={<FileText size={22} />}>1. ข้อมูลทั่วไป</SectionTitle>
          <div className="exf-fields">
            <Field label="รายการรับเงิน" required icon={<Wallet size={18} />}>
              <input
                required
                value={name}
                maxLength={200}
                placeholder="เช่น รับชำระ INV-0001, ขายหน้าร้าน"
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
              />
            </Field>
            <Field label="ใบแจ้งหนี้" icon={<FileText size={18} />}>
              <select value={invoice} onChange={(e) => (e.target.value ? pickInvoice(e.target.value) : setInvoice(""))} className={invoice ? "" : "placeholder"}>
                <option value="">ไม่ผูกใบแจ้งหนี้ (รับเงินทั่วไป)</option>
                {invoiceOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.customer ? " · " + i.customer : ""} · ค้าง ฿{two(i.owed)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="วันที่รับเงิน" required icon={<CalendarDays size={18} />}>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="วิธีรับเงิน" required icon={<Wallet size={18} />}>
              <select required value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="เลขอ้างอิง" icon={<Hash size={18} />}>
              <input value={reference} maxLength={100} placeholder="เช่น เลขที่รายการโอน, เลขที่เช็ค" onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="สาขา" icon={<Building2 size={18} />}>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={branchId ? "" : "placeholder"}>
                <option value="">เลือกสาขา</option>
                {(form?.branches || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </fieldset>

        <section className="exf-card exf-summary" aria-label="สรุปยอดเงิน">
          <SectionTitle icon={<Calculator size={20} />}>4. สรุปยอดเงิน</SectionTitle>
          <fieldset disabled={locked}>
            <SumRow label="ยอดใบแจ้งหนี้" value={inv?.total || 0} />
            <SumRow label="รับชำระแล้วก่อนหน้า" value={inv?.received || 0} />
            <SumRow label="ยอดคงค้าง" value={inv?.owed || 0} accent />
            <SumRow label="จำนวนเงินที่รับครั้งนี้">
              <input type="number" min={0} step="any" aria-label="จำนวนเงินที่รับครั้งนี้" value={amount || ""} placeholder="0.00" onChange={(e) => setAmount(Number(e.target.value))} />
            </SumRow>
            <SumRow label="คงค้างหลังรับชำระ" value={after} />
          </fieldset>
          <div className="exf-total">
            <span>ยอดรับครั้งนี้</span>
            <b>
              {two(amount)} <small>฿</small>
            </b>
          </div>
          {over && <p className="exf-hint">ยอดที่รับเกินยอดคงค้างของใบแจ้งหนี้</p>}
          {inv && !over && after === 0 && amount > 0 && <p className="exf-net">ใบแจ้งหนี้นี้จะชำระครบ ออกใบเสร็จรับเงินได้หลังบันทึก</p>}
          {!inv && <p className="exf-hint">ไม่ได้ผูกใบแจ้งหนี้ ใส่จำนวนเงินที่รับได้เลย</p>}
        </section>

        <fieldset className="exf-card exf-payee" disabled={locked}>
          <SectionTitle icon={<UserRound size={22} />}>2. ผู้จ่ายเงิน (ลูกค้า)</SectionTitle>
          <div className="exf-payee-row">
            <div className="exf-payee-pick">
              <Field label="" icon={<UserRound size={18} />}>
                <select aria-label="ลูกค้า" value={customerId} disabled={!!inv?.customerId} onChange={(e) => setCustomerId(e.target.value)} className={customerId ? "" : "placeholder"}>
                  <option value="">เลือกลูกค้า</option>
                  {(form?.customers || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              {inv?.customerId && <small className="inf-note">ตามใบแจ้งหนี้ {inv.name}</small>}
            </div>
            <Field label="เลขประจำตัวผู้เสียภาษี">
              <input value={customer?.taxId || ""} readOnly placeholder="—" />
            </Field>
            <Field label="เบอร์โทร">
              <input value={customer?.phone || ""} readOnly placeholder="—" />
            </Field>
          </div>
        </fieldset>

        <div className="exf-bottom">
          <fieldset className="exf-card exf-notes" disabled={locked}>
            <SectionTitle icon={<NotebookPen size={22} />}>3. หมายเหตุ</SectionTitle>
            <div className="exf-note-box">
              <textarea aria-label="หมายเหตุ" value={notes} maxLength={NOTE_MAX} placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)" onChange={(e) => setNotes(e.target.value)} />
              <small>
                {notes.length}/{NOTE_MAX}
              </small>
            </div>
          </fieldset>
        </div>
      </form>

      {error && <p className="form-error exf-error">{error}</p>}
      {!writable && <p className="muted exf-error">ดูได้อย่างเดียว · บันทึกรายรับได้เฉพาะเจ้าของบริษัทหรือทีมบัญชี</p>}

      <footer className="exf-actions">
        <button type="button" className="exf-btn" onClick={() => navigate("income")}>
          <X size={18} /> ยกเลิก
        </button>
        <div className="exf-submit">
          <button type="button" className="exf-primary" disabled={locked || !form} onClick={() => save()}>
            <Save size={18} /> {busy ? "กำลังบันทึก…" : "บันทึกรายรับ"}
          </button>
          <button type="button" className="exf-primary exf-caret" aria-label="ตัวเลือกการบันทึก" aria-expanded={menu} disabled={locked || !form} onClick={() => setMenu(!menu)}>
            <ChevronDown size={18} />
          </button>
          {menu && (
            <div className="exf-menu" role="menu">
              <button role="menuitem" type="button" onClick={() => save("new")}>
                บันทึก แล้วสร้างรายการใหม่
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
