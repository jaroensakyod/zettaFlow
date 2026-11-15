"use client";
// บันทึกรายรับ: one page to record money received, laid out like บันทึกค่าใช้จ่าย. General info and who paid on the
// left, a live summary of the invoice (total, received before, this payment, still owed) on the right, notes below.
// A payment cannot be edited after it is saved (archive it to cancel), so there is no draft: one save.
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, CalendarDays, Calculator, ChevronDown, ChevronRight, FileText, Hash, HandCoins, NotebookPen, Pencil, Printer, Save, Sparkles, UserRound, Wallet, X } from "lucide-react";
import type { Context } from "@/lib/types";
import { api } from "./shared";
import { Field, SectionTitle, SumRow, Thumb, Viewer, shrink, type FileItem } from "./expense-form";
import { uploadFile } from "./platform";
import { AiDropHero } from "./ai-drop";

type Invoice = { id: string; name: string; customerId: string; customer: string; date: string; dueDate: string; total: number; received: number; owed: number };
type Customer = { id: string; name: string; taxId: string; phone: string };
type FormData = { next: string; invoices: Invoice[]; customers: Customer[]; branches: { id: string; name: string }[] };

/** What AI read from one slip / cheque / payment advice (src/lib/income-scan.ts). */
type Scan = { payer: string | null; customerId: string | null; invoiceId: string | null; amount: number | null; date: string | null; reference: string | null; method: string | null; slip: { transRef: string; bank: string } | null; notes: string; uncertain: string[] };
type Report = { file: string; fileId: string; scan?: Scan; error?: string };
const uncertainLabels: Record<string, string> = { payer: "ผู้จ่าย", amount: "จำนวนเงิน", date: "วันที่", reference: "เลขอ้างอิง" };
const ACCEPT = "application/pdf,image/png,image/jpeg";
const MAX_FILE = 15_000_000;
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
    [stamp] = useState(() => new Date().toISOString()),
    [files, setFiles] = useState<FileItem[]>([]),
    [viewing, setViewing] = useState<FileItem | null>(null),
    [reports, setReports] = useState<Report[]>([]),
    [reading, setReading] = useState("");
  // Previews of files added here are local object URLs; free them when the page closes.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);
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

  // เอกสารแนบ: each file is shrunk (photos), uploaded, then AI reads it and fills what is still blank.
  // Nothing is saved until บันทึกรายรับ; the files are linked to the payment then.
  async function addFiles(list: File[]) {
    setError("");
    const ok = list.filter((f) => ACCEPT.includes(f.type));
    if (ok.length < list.length) setError("แนบได้เฉพาะ PDF, JPG, PNG");
    if (!ok.length) return;
    setBusy(true);
    for (const [i, original] of ok.entries()) {
      setReading(`AI กำลังอ่าน ${ok.length > 1 ? `${i + 1}/${ok.length} ` : ""}${original.name}`);
      try {
        const f = await shrink(original);
        if (f.size > MAX_FILE) throw Error(original.name + " ใหญ่เกิน 15MB");
        // The public demo stores nothing: AI reads the file sent with the request and it is listed but not kept.
        const attachmentId = ctx.demo ? await uploadFile(f, "Finance").catch(() => "") : await uploadFile(f, "Finance");
        const fileId = attachmentId || "local-" + Date.now() + i;
        const item: FileItem = { id: fileId, name: original.name, mime: f.type, src: URL.createObjectURL(f), linked: !attachmentId, local: !attachmentId };
        previews.current.push(item.src);
        setFiles((fs) => [...fs, item]);
        try {
          let scan: Scan;
          if (attachmentId) scan = await api("/income-scan", { method: "POST", body: { attachmentId } });
          else {
            const fd = new FormData();
            fd.set("file", f);
            const r = await fetch("/api/income-scan", { method: "POST", body: fd });
            scan = await r.json();
            if (!r.ok) throw Error((scan as unknown as { error: string }).error);
          }
          apply(scan);
          setReports((r) => [...r, { file: original.name, fileId, scan }]);
        } catch (e) {
          setReports((r) => [...r, { file: original.name, fileId, error: (e as Error).message }]);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setReading("");
    setBusy(false);
  }
  // Fields the person already filled are kept; AI fills the blanks (an invoice it found fills customer and amount).
  function apply(scan: Scan) {
    if (scan.invoiceId && !invoice && form?.invoices.some((i) => i.id === scan.invoiceId)) pickInvoice(scan.invoiceId);
    else if (scan.customerId && !customerId) setCustomerId(scan.customerId);
    if (scan.amount && (!amount || (!invoice && !scan.invoiceId))) setAmount(scan.amount);
    if (scan.date) setDate(scan.date);
    if (scan.reference && !reference) setReference(scan.reference.slice(0, 100));
    if (scan.method && METHODS.includes(scan.method)) setMethod(scan.method);
    if (!nameTouched && !invoice && !scan.invoiceId && scan.payer) setName("รับเงินจาก " + scan.payer);
    if (scan.notes && !notes) setNotes(scan.notes.slice(0, NOTE_MAX));
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
      const saved: { id: string } = await api("/entities/payments", { method: "POST", body: { data: body } });
      // Files uploaded before saving are linked to the payment now.
      for (const f of files.filter((x) => !x.linked && !x.local)) await api("/expense-files", { method: "POST", body: { attachmentId: f.id, entityId: saved.id } }).catch(() => {});
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

      <AiDropHero
        title="แนบไฟล์ทีเดียวจบ ให้ AI กรอกให้อัตโนมัติ"
        subtitle="แนบสลิปโอนเงิน เช็ค หรือหนังสือแจ้งชำระจากลูกค้า AI อ่านผู้จ่าย ยอดเงิน วันที่ เลขอ้างอิง และจับคู่ใบแจ้งหนี้ให้เอง เร็วกว่าพิมพ์เองหลายเท่า"
        docs={["สลิปโอนเงิน", "เช็ค", "หนังสือแจ้งชำระ", "ใบเสร็จรับเงิน"]}
        accept={ACCEPT}
        reading={reading}
        disabled={locked || !form}
        onFiles={addFiles}
      >
        {(!!reading || !!reports.length || !!files.length) && (
          <>
        {(!!reading || !!reports.length) && (
          <div className="exf-ai" aria-live="polite">
            {reading && (
              <p className="exf-ai-busy">
                <Sparkles size={15} /> {reading}…
              </p>
            )}
            {reports.map((r, i) => (
              <p key={i} className={r.error || r.scan?.uncertain.length ? "warn" : ""}>
                {(() => {
                  const file = files.find((x) => x.id === r.fileId);
                  return file ? <Thumb file={file} size="sm" onOpen={setViewing} /> : <Sparkles size={15} />;
                })()}
                <span>
                  <b>{r.file}</b>{" "}
                  {r.error
                    ? "AI อ่านไม่ได้: " + r.error
                    : [
                        r.scan!.amount ? "฿" + two(r.scan!.amount) : "ไม่พบยอดเงิน",
                        r.scan!.payer && "จาก " + r.scan!.payer,
                        r.scan!.invoiceId && "ตรงกับใบแจ้งหนี้ " + (form?.invoices.find((x) => x.id === r.scan!.invoiceId)?.name || ""),
                        r.scan!.slip && `สลิป ${r.scan!.slip.bank} เลขอ้างอิง ${r.scan!.slip.transRef}`,
                        r.scan!.notes,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                  {!!r.scan?.uncertain.length && <em> · ไม่แน่ใจ: {r.scan.uncertain.map((u) => uncertainLabels[u] || u).join(", ")} กรุณาตรวจ</em>}
                </span>
                <button type="button" className="exf-icon" aria-label="ปิดข้อความ" onClick={() => setReports((rs) => rs.filter((_, j) => j !== i))}>
                  <X size={14} />
                </button>
              </p>
            ))}
          </div>
        )}
        {!!files.length && (
          <ul className="exf-files">
            {files.map((f) => (
              <li key={f.id}>
                <Thumb file={f} size="sm" onOpen={setViewing} />
                <span>
                  {f.name}
                  {f.local ? <small> (โหมดตัวอย่าง ไม่ได้เก็บไฟล์)</small> : <small> · แนบเมื่อบันทึก</small>}
                </span>
                {!f.local && (
                  <button type="button" className="exf-icon" aria-label={"เอา " + f.name + " ออก"} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}>
                    <X size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
          </>
        )}
      </AiDropHero>

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

        <div className="exf-bottom one">
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
      {viewing && <Viewer file={viewing} files={files} onClose={() => setViewing(null)} onPick={setViewing} />}
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
