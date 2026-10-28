"use client";
// บันทึกค่าใช้จ่าย: one page to key in an expense. General info, who is paid, an item table with per-row discounts,
// attachments and notes on the left; a live money summary on the right. "บันทึกแบบร่าง" keeps it in the review list,
// "บันทึกและส่งอนุมัติ" saves it, posts the journal and waits for the approver.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Building2, CalendarDays, ChevronDown, ChevronRight, CloudUpload, FileSpreadsheet, FileText, Folder, NotebookPen,
  Pencil, Plus, Printer, Save, Send, Tag, Trash2, Upload, User, UserRound, Wallet, X, Calculator, Paperclip, Sparkles,
} from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { departmentNames, docTypes, lineAmount, lineCategories, payeeTypes, type Line } from "@/lib/catalog";
import { computeExpense, FULL_TAX_INVOICE, awaitingReview } from "@/lib/tax";
import { api } from "./shared";
import { CategorySelect } from "./category-select";
import { uploadFile } from "./platform";
import { deptLabels } from "./home-dashboard";

type Option = { id: string; kind: string; name: string };
type Scan = {
  fields: { docType: string | null; docNo: string | null; date: string | null; payee: string | null; supplierId: string | null; taxId: string | null; phone: string | null; category: string | null; whtRate: string | null; vat: 0 | 7; discount: number };
  lines: Line[];
  slip: { transRef: string; bank: string } | null;
  notes: string;
  uncertain: string[];
  mismatch: { printed: number; rebuilt: number } | null;
};
type ScanReport = { file: string; scan?: Scan; error?: string; warning?: string };
const uncertainLabels: Record<string, string> = { vendor: "ผู้ขาย", taxId: "เลขผู้เสียภาษี", date: "วันที่", docNo: "เลขที่เอกสาร", total: "ยอดรวม", lines: "รายการ", vatMode: "VAT" };
type Overview = { expenses: Entity[]; costCenters: { code: string; name: string }[] };
type Row = Line & { key: number };
type Draft = {
  code: string;
  docType: string;
  projectId: string;
  date: string;
  docNo: string;
  category: string;
  costCenter: string;
  payStatus: string;
  approver: string;
  payeeType: (typeof payeeTypes)[number];
  supplierId: string;
  employeeId: string;
  payee: string;
  taxId: string;
  payeePhone: string;
  discount: number;
  discountType: "amount" | "percent";
  vat: 0 | 7;
  whtRate: string;
  notes: string;
  receiptId: string;
};

const docLabels: Record<string, string> = {
  ใบกำกับภาษีเต็มรูป: "ใบกำกับภาษี / ใบเสร็จรับเงิน",
  ใบกำกับภาษีอย่างย่อ: "ใบกำกับภาษีอย่างย่อ",
  ใบเสร็จ: "ใบเสร็จรับเงิน",
  ใบแจ้งหนี้: "ใบแจ้งหนี้",
};
const payLabels: Record<string, string> = { ยังไม่จ่าย: "ยังไม่ชำระ", โอนแล้ว: "ชำระแล้ว (โอน)", เงินสดย่อย: "ชำระด้วยเงินสดย่อย" };
const ACCEPT = "application/pdf,image/png,image/jpeg";
const MAX_FILE = 15_000_000;
const NOTE_MAX = 500;
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const two = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thaiStamp = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).replace(" เวลา", "");
let rowKey = 0;
const blankRow = (): Row => ({ key: ++rowKey, name: "", qty: 1, price: 0, unit: "", category: "", currency: "THB", discount: 0, discountType: "percent" });

export function ExpenseForm({
  ctx,
  id,
  navigate,
  notify,
  changed,
}: {
  ctx: Context;
  id: string | null;
  navigate: (view: string) => void;
  notify: (s: string) => void;
  changed: () => void;
}) {
  const [entity, setEntity] = useState<Entity | null>(null),
    [overview, setOverview] = useState<Overview | null>(null),
    [options, setOptions] = useState<Option[]>([]),
    [approvers, setApprovers] = useState<string[]>([]),
    [d, setD] = useState<Draft>({
      code: "",
      docType: FULL_TAX_INVOICE,
      projectId: "",
      date: today(),
      docNo: "",
      category: "",
      costCenter: "",
      payStatus: "ยังไม่จ่าย",
      approver: "",
      payeeType: payeeTypes[0],
      supplierId: "",
      employeeId: "",
      payee: "",
      taxId: "",
      payeePhone: "",
      discount: 0,
      discountType: "amount",
      vat: 7,
      whtRate: "0",
      notes: "",
      receiptId: "",
    }),
    [rows, setRows] = useState<Row[]>([blankRow()]),
    [editCode, setEditCode] = useState(false),
    [files, setFiles] = useState<{ id: string; name: string; linked: boolean; local?: boolean }[]>([]),
    [reports, setReports] = useState<ScanReport[]>([]),
    [reading, setReading] = useState(""),
    [addingSupplier, setAddingSupplier] = useState(false),
    [newSupplier, setNewSupplier] = useState(""),
    [menu, setMenu] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [drag, setDrag] = useState(false),
    formRef = useRef<HTMLFormElement>(null),
    importRef = useRef<HTMLInputElement>(null),
    attachRef = useRef<HTMLInputElement>(null);
  const writable = ctx.member.role !== "viewer" && (ctx.member.role === "owner" || ctx.member.departments.includes("Finance"));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  // Latest form values for the file loop, which spans several renders.
  const dRef = useRef(d);
  dRef.current = d;
  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Load lists, the expense being edited (if any) and work out the next EXP number.
  useEffect(() => {
    api("/options").then(setOptions).catch(() => {});
    api("/team")
      .then((t: { members: { name: string; role: string; disabled?: boolean }[] }) =>
        setApprovers(t.members.filter((m) => !m.disabled && (m.role === "owner" || m.role === "manager")).map((m) => m.name)),
      )
      .catch(() => setApprovers([]));
    api("/receipts")
      .then((o: Overview) => {
        setOverview(o);
        const found = id ? o.expenses.find((e) => e.id === id) : null;
        if (found) {
          setEntity(found);
          const x = found.data;
          setD((cur) => ({
            ...cur,
            code: String(x.code || ""),
            docType: String(x.docType || FULL_TAX_INVOICE),
            projectId: String(x.projectId || ""),
            date: String(x.date || today()),
            docNo: String(x.docNo || ""),
            category: String(x.category || ""),
            costCenter: String(x.costCenter || ""),
            payStatus: String(x.payStatus || "ยังไม่จ่าย"),
            approver: String(x.approver || ""),
            payeeType: (payeeTypes as readonly string[]).includes(String(x.payeeType)) ? (x.payeeType as Draft["payeeType"]) : x.employeeId ? payeeTypes[2] : x.supplierId || !x.payee ? payeeTypes[0] : payeeTypes[1],
            supplierId: String(x.supplierId || ""),
            employeeId: String(x.employeeId || ""),
            payee: String(x.payee || ""),
            taxId: String(x.taxId || ""),
            payeePhone: String(x.payeePhone || ""),
            discount: Number(x.discount) || 0,
            discountType: x.discountType === "percent" ? "percent" : "amount",
            vat: x.vatMode === "none" ? 0 : 7,
            whtRate: String(x.whtRate || "0"),
            notes: String(x.notes || ""),
            receiptId: String(x.receiptId || ""),
          }));
          const lines = Array.isArray(x.lines) ? (x.lines as Line[]) : [];
          setRows(
            lines.length
              ? lines.map((l) => ({ ...blankRow(), ...l }))
              : // An expense saved without items (e.g. read by AI from a receipt): one row carrying the document amount.
                [{ ...blankRow(), name: String(x.name || ""), category: "", price: x.vatMode === "included" ? computeExpense(Number(x.amount), "included").base : Number(x.amount) || 0 }],
          );
          api("/files?entity=" + found.id)
            .then((f: { id: string; name: string }[]) => setFiles(f.map((x) => ({ ...x, linked: true }))))
            .catch(() => {});
        } else {
          const prefix = "EXP-" + today().replace(/-/g, "") + "-";
          const n = o.expenses.filter((e) => String(e.data.code || "").startsWith(prefix)).length + 1;
          setD((cur) => ({ ...cur, code: prefix + String(n).padStart(3, "0") }));
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  const suppliers = options.filter((o) => o.kind === "suppliers"),
    employees = options.filter((o) => o.kind === "employees"),
    projects = options.filter((o) => o.kind === "projects");

  // Money: rows (after their own discount) → bill discount → VAT → withholding tax.
  const sums = useMemo(() => {
    const subtotal = rows.reduce((s, r) => s + lineAmount(r), 0);
    const off = d.discountType === "percent" ? (subtotal * (Number(d.discount) || 0)) / 100 : Number(d.discount) || 0;
    const after = Math.max(0, Math.round((subtotal - off) * 100) / 100);
    const calc = computeExpense(after, d.vat ? "excluded" : "none", Number(d.whtRate) || 0, d.docType);
    return { subtotal, off, after, ...calc };
  }, [rows, d.discount, d.discountType, d.vat, d.whtRate, d.docType]);

  // Picking a supplier or employee fills in tax id and phone from their record.
  async function pickParty(kind: "suppliers" | "employees", optionId: string) {
    const o = options.find((x) => x.id === optionId);
    if (kind === "suppliers") set("supplierId", optionId);
    else set("employeeId", optionId);
    set("payee", o?.name || "");
    if (!o) return;
    try {
      const r: { rows: Entity[] } = await api(`/entities/${kind}?q=${encodeURIComponent(o.name)}`);
      const rec = r.rows.find((x) => x.id === optionId);
      if (rec) setD((x) => ({ ...x, taxId: String(rec.data.taxId || rec.data.idCard || x.taxId || ""), payeePhone: String(rec.data.phone || x.payeePhone || "") }));
    } catch {}
  }

  async function createSupplier() {
    const name = newSupplier.trim();
    if (!name) return;
    setBusy("supplier");
    try {
      const rec: Entity = await api("/entities/suppliers", {
        method: "POST",
        body: { data: { name, status: "active", type: "นิติบุคคล", ...(d.taxId && { taxId: d.taxId }), ...(d.payeePhone && { phone: d.payeePhone }) } },
      });
      setOptions((os) => [{ id: rec.id, kind: "suppliers", name }, ...os]);
      setD((x) => ({ ...x, supplierId: rec.id, payee: name }));
      setAddingSupplier(false);
      setNewSupplier("");
      notify("เพิ่ม Supplier แล้ว");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  // นำเข้าจากไฟล์ / เอกสารแนบ: each file is shrunk (photos), uploaded and attached, then AI reads it and its rows
  // are added to this form. Nothing is saved until the user presses a save button.
  async function addFiles(list: File[]) {
    setError("");
    const ok = list.filter((f) => ACCEPT.includes(f.type));
    if (ok.length < list.length) setError("แนบได้เฉพาะ PDF, JPG, PNG");
    if (!ok.length) return;
    setBusy("scan");
    let fresh = rows.every((r) => !r.name.trim() && !r.price);
    for (const [i, original] of ok.entries()) {
      setReading(`AI กำลังอ่าน ${ok.length > 1 ? `${i + 1}/${ok.length} ` : ""}${original.name}`);
      try {
        const f = await shrink(original);
        if (f.size > MAX_FILE) throw Error(original.name + " ใหญ่เกิน 15MB");
        let attachmentId = "";
        // The public demo stores nothing: AI reads the file sent with the request and it is listed but not kept.
        if (ctx.demo) attachmentId = await uploadFile(f, "Finance", entity?.id).catch(() => "");
        else attachmentId = await uploadFile(f, "Finance", entity?.id);
        setFiles((fs) => [...fs, attachmentId ? { id: attachmentId, name: original.name, linked: !!entity } : { id: "local-" + Date.now() + i, name: original.name, linked: true, local: true }]);
        if (attachmentId) setD((x) => (x.receiptId ? x : { ...x, receiptId: attachmentId }));
        try {
          let scan: Scan;
          if (attachmentId) scan = await api("/expense-scan", { method: "POST", body: { attachmentId } });
          else {
            const form = new FormData();
            form.set("file", f);
            const r = await fetch("/api/expense-scan", { method: "POST", body: form });
            scan = await r.json();
            if (!r.ok) throw Error((scan as unknown as { error: string }).error);
          }
          const warning = apply(scan, fresh);
          if (scan.lines.length) fresh = false;
          setReports((r) => [...r, { file: original.name, scan, warning }]);
        } catch (e) {
          setReports((r) => [...r, { file: original.name, error: (e as Error).message }]);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setReading("");
    setBusy("");
  }

  // Rows are appended (or replace the empty starter row); header fields are only filled when still blank,
  // except on a fresh form, where the first document also sets its type, date and VAT.
  function apply(scan: Scan, fresh: boolean): string | undefined {
    const f = scan.fields,
      cur = dRef.current,
      noPayee = !cur.supplierId && !cur.employeeId && !cur.payee;
    if (scan.lines.length)
      setRows((rs) => [...rs.filter((r) => r.name.trim() || r.price), ...scan.lines.map((l) => ({ ...blankRow(), ...l }))]);
    setD((x) => {
      const n = { ...x };
      if (f.docType && fresh) n.docType = f.docType;
      if (f.date && (fresh || !x.date)) n.date = f.date;
      if (fresh) n.vat = f.vat;
      if (f.docNo && !x.docNo) n.docNo = f.docNo;
      if (f.category && !x.category) n.category = f.category;
      if (f.whtRate && x.whtRate === "0") n.whtRate = f.whtRate;
      if (f.discount && !x.discount) {
        n.discount = f.discount;
        n.discountType = "amount";
      }
      if (noPayee && (f.supplierId || f.payee)) {
        n.payeeType = payeeTypes[0];
        n.supplierId = f.supplierId || "";
        n.payee = f.payee || "";
      }
      if (f.taxId && !x.taxId) n.taxId = f.taxId;
      if (f.phone && !x.payeePhone) n.payeePhone = f.phone;
      return n;
    });
    // A seller that is not in the directory yet: offer to add it with the name already typed.
    if (noPayee && f.payee && !f.supplierId) {
      setNewSupplier(f.payee);
      setAddingSupplier(true);
    }
    // One expense has one VAT rate; a document with a different one should be its own expense.
    if (!fresh && scan.lines.length && f.vat !== cur.vat)
      return f.vat
        ? "เอกสารนี้มี VAT 7% แต่ฟอร์มนี้ไม่คิด VAT ควรแยกบันทึกเป็นอีกรายการ"
        : "เอกสารนี้ไม่มี VAT แต่ฟอร์มนี้คิด VAT 7% ควรแยกบันทึกเป็นอีกรายการ หรือลบรายการนี้ออก";
  }

  async function save(submit: boolean, next: "list" | "new" = "list") {
    setError("");
    if (!formRef.current?.reportValidity()) return;
    const items = rows.filter((r) => r.name.trim());
    if (!items.length) return setError("ใส่รายการค่าใช้จ่ายอย่างน้อย 1 รายการ");
    if (!d.category) return setError("เลือกหมวดหมู่หลัก");
    setBusy(submit ? "submit" : "draft");
    try {
      const name = items[0].name.trim() + (items.length > 1 ? ` และอีก ${items.length - 1} รายการ` : "");
      const data: Record<string, unknown> = {
        name: name.slice(0, 200),
        code: d.code,
        docType: d.docType,
        projectId: d.projectId,
        date: d.date,
        docNo: d.docNo,
        category: d.category,
        costCenter: d.costCenter,
        payStatus: d.payStatus,
        approver: d.approver,
        payeeType: d.payeeType,
        supplierId: d.payeeType === payeeTypes[0] ? d.supplierId : "",
        employeeId: d.payeeType === payeeTypes[2] ? d.employeeId : "",
        payee: d.payee,
        taxId: d.taxId,
        payeePhone: d.payeePhone,
        lines: items.map(({ key: _key, ...l }) => ({
          ...l,
          name: l.name.trim(),
          qty: Number(l.qty) || 0,
          price: Number(l.price) || 0,
          discount: Number(l.discount) || 0,
          unit: l.unit?.trim() || undefined,
          category: l.category || undefined,
        })),
        discount: Number(d.discount) || 0,
        discountType: d.discountType,
        amount: sums.after,
        vatMode: d.vat ? "excluded" : "none",
        whtRate: d.whtRate,
        receiptId: d.receiptId,
        notes: d.notes.trim(),
        status: entity && !awaitingReview(entity.data) ? entity.data.status : "pending",
        reviewStatus: submit ? "บันทึกแล้ว" : "รอตรวจ",
      };
      const body = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== "" && v !== undefined && v !== null));
      const saved: Entity = entity
        ? await api("/entities/expenses/" + entity.id, { method: "PATCH", body: { data: body, version: entity.version } })
        : await api("/entities/expenses", { method: "POST", body: { data: body } });
      // Files uploaded before the first save are linked to the expense now.
      const unlinked = files.filter((f) => !f.linked && !f.local);
      for (const f of unlinked) await api("/expense-files", { method: "POST", body: { attachmentId: f.id, entityId: saved.id } });
      if (unlinked.length) setFiles((fs) => fs.map((f) => ({ ...f, linked: true })));
      if (submit) await api("/accounting/post/" + saved.id, { method: "POST" });
      changed();
      notify(submit ? "บันทึกและส่งอนุมัติแล้ว" : "บันทึกแบบร่างแล้ว");
      if (!submit) {
        setEntity(saved);
        if (!entity) navigate("expense-new?id=" + saved.id);
      } else navigate(next === "new" ? "expense-new?n=" + Date.now() : "expenses");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      setMenu(false);
    }
  }

  const status = !entity
    ? "รอดำเนินการ"
    : awaitingReview(entity.data)
      ? "แบบร่าง"
      : ({ pending: "รออนุมัติ", approved: "อนุมัติแล้ว", paid: "จ่ายแล้ว", rejected: "ไม่อนุมัติ" } as Record<string, string>)[String(entity.data.status)] || "รอดำเนินการ";
  const locked = !writable || !!busy;
  const costCenters = [...(overview?.costCenters || []).map((c) => ({ value: c.code, label: c.name })), ...departmentNames.map((n) => ({ value: n, label: deptLabels[n] || n }))];

  return (
    <div className="exf">
      <nav className="exf-crumbs" aria-label="ตำแหน่งหน้า">
        <button onClick={() => navigate("expenses")}>บัญชีและการเงิน</button>
        <ChevronRight size={15} />
        <button onClick={() => navigate("expenses")}>ค่าใช้จ่าย</button>
        <ChevronRight size={15} />
        <span aria-current="page">บันทึกค่าใช้จ่าย</span>
      </nav>
      <header className="exf-head">
        <span className="exf-head-icon">
          <FileSpreadsheet size={34} />
        </span>
        <div className="exf-head-title">
          <h1>บันทึกค่าใช้จ่าย</h1>
          <p>กรอกข้อมูลค่าใช้จ่าย เพื่ออนุมัติและบันทึกเข้าระบบ</p>
        </div>
        <div className="exf-docno">
          <label htmlFor="exf-code">เลขที่เอกสาร</label>
          <div className="exf-docno-box">
            <input id="exf-code" value={d.code} readOnly={!editCode} maxLength={40} onChange={(e) => set("code", e.target.value)} />
            <button type="button" aria-label="แก้เลขที่เอกสาร" disabled={locked} onClick={() => setEditCode(!editCode)}>
              <Pencil size={15} />
            </button>
          </div>
          <dl>
            <dt>วันที่สร้าง :</dt>
            <dd>{thaiStamp(entity?.created_at || new Date().toISOString())}</dd>
            <dt>สถานะ :</dt>
            <dd className="exf-status">
              <i />
              {status}
            </dd>
          </dl>
        </div>
        <button type="button" className="exf-print" onClick={() => window.print()}>
          <Printer size={17} /> พิมพ์แบบฟอร์ม
        </button>
      </header>

      <form ref={formRef} className="exf-grid" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="exf-card exf-general" disabled={locked}>
          <SectionTitle icon={<FileText size={22} />}>1. ข้อมูลทั่วไป</SectionTitle>
          <div className="exf-fields">
            <Field label="ประเภทเอกสาร" required icon={<FileText size={18} />}>
              <select required value={d.docType} onChange={(e) => set("docType", e.target.value)}>
                {docTypes.map((t) => (
                  <option key={t} value={t}>
                    {docLabels[t] || t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="โครงการ" icon={<Folder size={18} />}>
              <select value={d.projectId} onChange={(e) => set("projectId", e.target.value)} className={d.projectId ? "" : "placeholder"}>
                <option value="">เลือกโครงการ</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="วันที่เอกสาร" required icon={<CalendarDays size={18} />}>
              <input type="date" required value={d.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label="เลขที่เอกสารอ้างอิง">
              <input value={d.docNo} maxLength={100} placeholder="เช่น INV-20261028, BILL-001" onChange={(e) => set("docNo", e.target.value)} />
            </Field>
            <Field label="หมวดหมู่หลัก" required icon={<Tag size={18} />}>
              <CategorySelect required value={d.category} onChange={(v) => set("category", v)} className={d.category ? "" : "placeholder"} />
            </Field>
            <Field label="ศูนย์ต้นทุน" icon={<Building2 size={18} />}>
              <select value={d.costCenter} onChange={(e) => set("costCenter", e.target.value)} className={d.costCenter ? "" : "placeholder"}>
                <option value="">เลือกศูนย์ต้นทุน</option>
                {costCenters.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="การชำระเงิน" icon={<Wallet size={18} />}>
              <select value={d.payStatus} onChange={(e) => set("payStatus", e.target.value)}>
                {Object.entries(payLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ผู้อนุมัติ" icon={<User size={18} />}>
              <select value={d.approver} onChange={(e) => set("approver", e.target.value)} className={d.approver ? "" : "placeholder"}>
                <option value="">เลือกผู้อนุมัติ</option>
                {[...new Set([...approvers, ...(d.approver ? [d.approver] : [])])].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
          </div>
        </fieldset>

        <section className="exf-card exf-summary" aria-label="สรุปยอดเงิน">
          <SectionTitle icon={<Calculator size={20} />}>6. สรุปยอดเงิน</SectionTitle>
          <fieldset disabled={locked}>
            <SumRow label="ยอดรวมก่อนภาษี" value={sums.subtotal} />
            <SumRow
              label="ส่วนลด"
              extra={
                <span className="exf-mini-select">
                  <select aria-label="ประเภทส่วนลด" value={d.discountType} onChange={(e) => set("discountType", e.target.value as Draft["discountType"])}>
                    <option value="amount">จำนวนเงิน</option>
                    <option value="percent">เปอร์เซ็นต์</option>
                  </select>
                  <ChevronDown size={14} />
                </span>
              }
            >
              <input
                type="number"
                min={0}
                step="any"
                aria-label="ส่วนลด"
                value={d.discount || ""}
                placeholder="0.00"
                onChange={(e) => set("discount", Number(e.target.value))}
              />
            </SumRow>
            <SumRow label="ยอดหลังหักส่วนลด" value={sums.after} />
            <SumRow
              label={
                <>
                  ภาษีมูลค่าเพิ่ม <small>(VAT)</small>
                </>
              }
              extra={
                <span className="exf-mini-select narrow">
                  <select aria-label="อัตรา VAT" value={d.vat} onChange={(e) => set("vat", Number(e.target.value) as 0 | 7)}>
                    <option value={7}>7%</option>
                    <option value={0}>0%</option>
                  </select>
                </span>
              }
              value={sums.vat}
            />
            <SumRow label="ยอดรวมภาษี" value={sums.gross} accent />
            <SumRow
              label="หัก ณ ที่จ่าย (%)"
              extra={
                <span className="exf-mini-select narrow">
                  <select aria-label="อัตราหัก ณ ที่จ่าย" value={d.whtRate} onChange={(e) => set("whtRate", e.target.value)}>
                    {["0", "1", "2", "3", "5"].map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </span>
              }
              value={sums.wht}
            />
            <SumRow label="จำนวนเงินหัก ณ ที่จ่าย" value={sums.wht} />
          </fieldset>
          <div className="exf-total">
            <span>ยอดรวมทั้งสิ้น</span>
            <b>
              {two(sums.gross)} <small>฿</small>
            </b>
          </div>
          {sums.wht > 0 && (
            <p className="exf-net">
              ยอดที่ต้องจ่ายจริงหลังหัก ณ ที่จ่าย <b>{two(sums.net)} ฿</b>
            </p>
          )}
          {sums.vat > 0 && d.docType !== FULL_TAX_INVOICE && <p className="exf-hint">เอกสารนี้ไม่ใช่ใบกำกับภาษีเต็มรูป ขอคืน VAT ไม่ได้ ระบบจะรวม VAT เป็นค่าใช้จ่าย</p>}
        </section>

        <fieldset className="exf-card exf-payee" disabled={locked}>
          <SectionTitle icon={<UserRound size={22} />}>2. ผู้รับเงิน / ผู้ขาย (Supplier)</SectionTitle>
          <div className="exf-segment" role="radiogroup" aria-label="ประเภทผู้รับเงิน">
            {payeeTypes.map((t) => (
              <label key={t} className={d.payeeType === t ? "active" : ""}>
                <input type="radio" name="payeeType" checked={d.payeeType === t} onChange={() => setD((x) => ({ ...x, payeeType: t, supplierId: "", employeeId: "", payee: "" }))} />
                <i />
                {t}
              </label>
            ))}
          </div>
          <div className="exf-payee-row">
            <div className="exf-payee-pick">
              {d.payeeType === payeeTypes[0] ? (
                <Field label="" icon={<Building2 size={18} />}>
                  <select aria-label="ผู้ขาย / Supplier" value={d.supplierId} onChange={(e) => pickParty("suppliers", e.target.value)} className={d.supplierId ? "" : "placeholder"}>
                    <option value="">เลือกผู้ขาย / Supplier</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : d.payeeType === payeeTypes[2] ? (
                <Field label="" icon={<UserRound size={18} />}>
                  <select aria-label="พนักงาน" value={d.employeeId} onChange={(e) => pickParty("employees", e.target.value)} className={d.employeeId ? "" : "placeholder"}>
                    <option value="">เลือกพนักงาน</option>
                    {employees.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="" icon={<User size={18} />}>
                  <input aria-label="ชื่อผู้รับเงิน" value={d.payee} maxLength={200} placeholder="ชื่อ-นามสกุลผู้รับเงิน" onChange={(e) => set("payee", e.target.value)} />
                </Field>
              )}
              {d.payeeType === payeeTypes[0] &&
                (addingSupplier ? (
                  <span className="exf-new-supplier">
                    <input autoFocus value={newSupplier} maxLength={200} placeholder="ชื่อ Supplier ใหม่" onChange={(e) => setNewSupplier(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), createSupplier())} />
                    <button type="button" className="exf-link" disabled={!newSupplier.trim() || busy === "supplier"} onClick={createSupplier}>
                      บันทึก
                    </button>
                    <button type="button" className="exf-icon" aria-label="ยกเลิก" onClick={() => setAddingSupplier(false)}>
                      <X size={15} />
                    </button>
                  </span>
                ) : (
                  <button type="button" className="exf-link" onClick={() => setAddingSupplier(true)}>
                    <Plus size={15} /> เพิ่ม Supplier ใหม่
                  </button>
                ))}
            </div>
            <Field label="เลขประจำตัวผู้เสียภาษี">
              <input value={d.taxId} maxLength={20} inputMode="numeric" placeholder="เช่น 0105555123456" onChange={(e) => set("taxId", e.target.value)} />
            </Field>
            <Field label="เบอร์โทร">
              <input type="tel" value={d.payeePhone} maxLength={30} placeholder="เช่น 081-234-5678" onChange={(e) => set("payeePhone", e.target.value)} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="exf-card exf-items" disabled={locked}>
          {/* Import (AI reads receipts / slips into rows) and add-row live with the item table they fill. */}
          <div className="exf-card-head">
            <SectionTitle icon={<FileSpreadsheet size={22} />}>3. รายละเอียดค่าใช้จ่าย</SectionTitle>
            <div className="exf-head-actions">
              <button type="button" className="exf-outline" disabled={locked} onClick={() => importRef.current?.click()}>
                <Upload size={16} /> {busy === "scan" ? "AI กำลังอ่าน…" : "นำเข้าจากไฟล์"}
              </button>
              <input ref={importRef} type="file" hidden multiple accept={ACCEPT} onChange={(e) => {
                const list = [...(e.target.files || [])];
                e.target.value = "";
                addFiles(list);
              }} />
              <button type="button" className="exf-outline" onClick={() => setRows((rs) => [...rs, blankRow()])}>
                <Plus size={16} /> เพิ่มรายการ
              </button>
            </div>
          </div>
          {(!!reading || !!reports.length) && (
            <div className="exf-ai" aria-live="polite">
              {reading && (
                <p className="exf-ai-busy">
                  <Sparkles size={15} /> {reading}…
                </p>
              )}
              {reports.map((r, i) => (
                <p key={i} className={r.error || r.warning || r.scan?.mismatch || r.scan?.uncertain.length ? "warn" : ""}>
                  <Sparkles size={15} />
                  <span>
                    <b>{r.file}</b>{" "}
                    {r.error
                      ? "AI อ่านไม่ได้: " + r.error
                      : (r.scan!.lines.length ? `เพิ่ม ${r.scan!.lines.length} รายการ` : "ไม่พบรายการ") +
                        (r.scan!.slip ? ` · สลิปโอนเงิน ${r.scan!.slip.bank} เลขอ้างอิง ${r.scan!.slip.transRef}` : "") +
                        (r.scan!.notes ? " · " + r.scan!.notes : "")}
                    {r.scan?.mismatch && <em> · ยอดรวมที่อ่านได้ {two(r.scan.mismatch.rebuilt)} ไม่ตรงกับยอดบนเอกสาร {two(r.scan.mismatch.printed)} กรุณาตรวจ</em>}
                    {!!r.scan?.uncertain.length && <em> · ไม่แน่ใจ: {r.scan.uncertain.map((u) => uncertainLabels[u] || u).join(", ")}</em>}
                    {r.warning && <em> · {r.warning}</em>}
                  </span>
                  <button type="button" className="exf-icon" aria-label="ปิดข้อความ" onClick={() => setReports((rs) => rs.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                </p>
              ))}
            </div>
          )}
          <div className="exf-table-wrap">
            <table className="exf-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>
                    รายการค่าใช้จ่าย <em>*</em>
                  </th>
                  <th>
                    หมวดหมู่ <em>*</em>
                  </th>
                  <th>หน่วย</th>
                  <th>
                    จำนวน <em>*</em>
                  </th>
                  <th>
                    หน่วยเงิน <em>*</em>
                  </th>
                  <th>ราคา/หน่วย (฿)</th>
                  <th>ส่วนลด</th>
                  <th>จำนวนเงิน (฿)</th>
                  <th>
                    <button type="button" className="exf-icon" aria-label="ล้างรายการทั้งหมด" onClick={() => setRows([blankRow()])}>
                      <Trash2 size={17} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td>{i + 1}</td>
                    <td>
                      <input aria-label={`รายการที่ ${i + 1}`} required={i === 0 || !!r.price} value={r.name} maxLength={500} onChange={(e) => setRow(r.key, { name: e.target.value })} />
                    </td>
                    <td>
                      <select aria-label="หมวดหมู่" required={!!r.name} value={r.category || ""} onChange={(e) => setRow(r.key, { category: e.target.value })} className={r.category ? "" : "placeholder"}>
                        <option value="">เลือก</option>
                        {lineCategories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input aria-label="หน่วย" value={r.unit || ""} maxLength={30} onChange={(e) => setRow(r.key, { unit: e.target.value })} />
                    </td>
                    <td>
                      <input aria-label="จำนวน" type="number" required min={0} step="any" value={r.qty} onChange={(e) => setRow(r.key, { qty: Number(e.target.value) })} />
                    </td>
                    <td>
                      <select aria-label="หน่วยเงิน" required value={r.currency || "THB"} onChange={(e) => setRow(r.key, { currency: e.target.value })}>
                        <option>THB</option>
                      </select>
                    </td>
                    <td>
                      <input aria-label="ราคาต่อหน่วย" className="num" type="number" step="any" min={0} value={r.price || ""} placeholder="0.00" onChange={(e) => setRow(r.key, { price: Number(e.target.value) })} />
                    </td>
                    <td>
                      <span className="exf-discount">
                        <input aria-label="ส่วนลด" type="number" min={0} step="any" value={r.discount || ""} placeholder="0" onChange={(e) => setRow(r.key, { discount: Number(e.target.value) })} />
                        <select aria-label="หน่วยส่วนลด" value={r.discountType || "percent"} onChange={(e) => setRow(r.key, { discountType: e.target.value as Row["discountType"] })}>
                          <option value="percent">%</option>
                          <option value="amount">฿</option>
                        </select>
                      </span>
                    </td>
                    <td>
                      <output className="num">{two(lineAmount(r))}</output>
                    </td>
                    <td>
                      <button type="button" className="exf-icon" aria-label={`ลบรายการที่ ${i + 1}`} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankRow()]))}>
                        <Trash2 size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>

        <div className="exf-bottom">
        <fieldset className="exf-card exf-attach" disabled={locked}>
          <SectionTitle icon={<FileText size={22} />}>4. เอกสารแนบ</SectionTitle>
          <div>
            <label
              className={"exf-drop" + (drag ? " drag" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                addFiles([...e.dataTransfer.files]);
              }}
            >
              <CloudUpload size={30} />
              <span>
                {reading || "ลากไฟล์มาวางที่นี่ หรือ"} {!reading && <b>คลิกเพื่ออัปโหลด</b>}
              </span>
              <small>PDF, JPG, PNG ไม่เกิน 15MB · AI อ่านใบเสร็จ/สลิปแล้วเพิ่มรายการให้อัตโนมัติ</small>
              <input ref={attachRef} type="file" hidden multiple accept={ACCEPT} onChange={(e) => {
                const list = [...(e.target.files || [])];
                e.target.value = "";
                addFiles(list);
              }} />
            </label>
            {!!files.length && (
              <ul className="exf-files">
                {files.map((f) => (
                  <li key={f.id}>
                    <Paperclip size={13} />
                    {f.local ? (
                      <span>
                        {f.name} <small>(โหมดตัวอย่าง ไม่ได้เก็บไฟล์)</small>
                      </span>
                    ) : (
                      <a href={"/api/files/" + f.id} target="_blank" rel="noreferrer">
                        {f.name}
                      </a>
                    )}
                    {!f.linked && <small>แนบเมื่อบันทึก</small>}
                    {!f.linked && (
                      <button type="button" className="exf-icon" aria-label={"เอา " + f.name + " ออก"} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}>
                        <X size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </fieldset>

        <fieldset className="exf-card exf-notes" disabled={locked}>
          <SectionTitle icon={<NotebookPen size={22} />}>5. หมายเหตุ</SectionTitle>
          <div className="exf-note-box">
            <textarea aria-label="หมายเหตุ" value={d.notes} maxLength={NOTE_MAX} placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)" onChange={(e) => set("notes", e.target.value)} />
            <small>
              {d.notes.length}/{NOTE_MAX}
            </small>
          </div>
        </fieldset>
        </div>
      </form>

      {error && <p className="form-error exf-error">{error}</p>}
      {!writable && <p className="muted exf-error">ดูได้อย่างเดียว · บันทึกค่าใช้จ่ายได้เฉพาะเจ้าของบริษัทหรือทีมบัญชี</p>}

      <footer className="exf-actions">
        <button type="button" className="exf-btn" onClick={() => navigate("expenses")}>
          <X size={18} /> ยกเลิก
        </button>
        <button type="button" className="exf-btn" disabled={locked} onClick={() => save(false)}>
          <Save size={18} /> {busy === "draft" ? "กำลังบันทึก…" : "บันทึกแบบร่าง"}
        </button>
        <div className="exf-submit">
          <button type="button" className="exf-primary" disabled={locked} onClick={() => save(true)}>
            <Send size={18} /> {busy === "submit" ? "กำลังบันทึก…" : "บันทึกและส่งอนุมัติ"}
          </button>
          <button type="button" className="exf-primary exf-caret" aria-label="ตัวเลือกการบันทึก" aria-expanded={menu} disabled={locked} onClick={() => setMenu(!menu)}>
            <ChevronDown size={18} />
          </button>
          {menu && (
            <div className="exf-menu" role="menu">
              <button role="menuitem" type="button" onClick={() => save(true, "new")}>
                บันทึกและส่งอนุมัติ แล้วสร้างรายการใหม่
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

/** Photos are scaled to at most 1600px and re-saved as JPEG: smaller uploads and fewer AI image tokens, text stays readable. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap === "undefined") return file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 600000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}


function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="exf-title">
      <span>{icon}</span>
      {children}
    </h2>
  );
}

function Field({ label, required, icon, children }: { label: string; required?: boolean; icon?: ReactNode; children: ReactNode }) {
  return (
    <label className={"exf-field" + (icon ? " with-icon" : "")}>
      {label && (
        <span className="exf-label">
          {label} {required && <em>*</em>}
        </span>
      )}
      <span className="exf-control">
        {icon && <span className="exf-control-icon">{icon}</span>}
        {children}
        {["select", CategorySelect].includes((children as { type?: unknown })?.type as string) && <ChevronDown className="exf-chev" size={17} />}
      </span>
    </label>
  );
}

function SumRow({ label, extra, value, accent, children }: { label: ReactNode; extra?: ReactNode; value?: number; accent?: boolean; children?: ReactNode }) {
  return (
    <div className="exf-sum-row">
      <span className="exf-sum-label">{label}</span>
      {extra || <span />}
      <span className="exf-sum-box">{children ?? <output>{two(value || 0)}</output>}</span>
      <span className={"exf-baht" + (accent ? " accent" : "")}>฿</span>
    </div>
  );
}
