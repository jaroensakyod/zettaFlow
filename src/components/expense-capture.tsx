"use client";
// Accounting: upload a receipt → AI fills the expense → the user checks it → save. Summary cards on top.
import { useCallback, useEffect, useState } from "react";
import { ScanLine, Upload, Receipt, Landmark, HandCoins, Clock } from "lucide-react";
import type { Context } from "@/lib/types";
import { computeExpense, vatModes, whtForm, type VatMode } from "@/lib/tax";
import { api, money, Modal } from "./shared";
import { uploadFile } from "./platform";

type Overview = { month: string; total: number; vat: number; wht: number; pending: number; byProject: Record<string, number> };
type Option = { id: string; kind: string; name: string };
const categories = ["ค่ามัดจำ", "ค่าเช่า", "ค่าไฟฟ้า", "ค่าบริการ", "ค่าพรม", "บุคลากร", "จัดซื้อ", "ขนส่ง", "การตลาด", "อื่นๆ"];
const docTypes = ["ใบกำกับภาษี", "บิลเงินสด", "ใบเสร็จ", "ใบแจ้งหนี้"];

export function ExpenseCapture({ ctx, notify, changed }: { ctx: Context; notify: (s: string) => void; changed: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null),
    [options, setOptions] = useState<Option[]>([]),
    [draft, setDraft] = useState<Record<string, string | number> | null>(null),
    [missing, setMissing] = useState<string[]>([]),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const load = useCallback(() => api("/receipts").then(setOverview).catch(() => {}), []);
  useEffect(() => {
    load();
    api("/options").then(setOptions).catch(() => {});
  }, [load]);
  const canWrite = ctx.member.role !== "viewer" && (ctx.member.role === "owner" || ctx.member.departments.includes("Finance"));
  const projects = options.filter((o) => o.kind === "projects"),
    suppliers = options.filter((o) => o.kind === "suppliers");
  const calc = draft ? computeExpense(Number(draft.amount), (draft.vatMode as VatMode) || "none", Number(draft.whtRate) || 0) : null;
  const set = (k: string, v: string | number) => setDraft((d) => ({ ...d!, [k]: v }));

  async function read(f: File) {
    setError("");
    setBusy("กำลังอัปโหลด…");
    try {
      const id = await uploadFile(f, "Finance");
      setFile(f);
      setBusy("AI กำลังอ่านเอกสาร…");
      const r = await api("/receipts", { method: "POST", body: { attachmentId: id } });
      const supplier = suppliers.find((s) => r.draft.payee && s.name.includes(String(r.draft.payee).slice(0, 12)));
      setDraft({ ...r.draft, supplierId: supplier?.id || "", projectId: "", payStatus: "รอจ่าย" });
      setMissing(r.missing || []);
    } catch (e) {
      // AI not configured or unreadable: still let the user key it in by hand.
      setError((e as Error).message);
      setDraft({ name: "", payee: "", category: "อื่นๆ", date: new Date().toISOString().slice(0, 10), amount: "", vatMode: "none", whtRate: "0", status: "pending", payStatus: "รอจ่าย" });
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!draft) return;
    setBusy("กำลังบันทึก…");
    setError("");
    try {
      const data = { ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== "")), amount: Number(draft.amount) };
      const row = await api("/entities/expenses", { method: "POST", body: { data } });
      // Keep the receipt with the saved expense so it shows in that record's documents.
      if (file && row?.id) {
        const form = new FormData();
        form.set("file", file);
        form.set("department", "Finance");
        form.set("entity", row.id);
        await fetch("/api/files", { method: "POST", body: form }).catch(() => {});
      }
      notify("บันทึกค่าใช้จ่ายแล้ว");
      setDraft(null);
      setFile(null);
      load();
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className="expense-cards">
        {(
          [
            [Receipt, "ค่าใช้จ่ายเดือนนี้", overview?.total],
            [Landmark, "ภาษีซื้อขอคืนได้ (ภ.พ.30)", overview?.vat],
            [HandCoins, "หัก ณ ที่จ่ายต้องนำส่ง", overview?.wht],
          ] as const
        ).map(([Ico, label, value]) => (
          <div className="card expense-card" key={label}>
            <small>
              <Ico size={15} /> {label}
            </small>
            <b>฿{money(value ?? 0)}</b>
          </div>
        ))}
        <div className="card expense-card">
          <small>
            <Clock size={15} /> รอตรวจสอบ
          </small>
          <b>{overview?.pending ?? 0} รายการ</b>
        </div>
      </div>
      {canWrite && (
        <label className={"receipt-drop card" + (busy ? " busy" : "")}>
          <ScanLine size={26} />
          <span>
            <b>{busy || "อัปโหลดใบเสร็จ / ใบกำกับภาษี ให้ AI อ่าน"}</b>
            <small>JPG, PNG หรือ PDF · AI ดึงผู้ขาย เลขผู้เสียภาษี เลขที่เอกสาร วันที่ ยอด VAT และหัก ณ ที่จ่าย แล้วให้คุณตรวจก่อนบันทึก</small>
          </span>
          <span className="secondary as-button">
            <Upload size={15} /> เลือกไฟล์
          </span>
          <input
            type="file"
            className="file-hidden"
            disabled={!!busy}
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) read(f);
            }}
          />
        </label>
      )}
      {error && !draft && <p className="form-error">{error}</p>}
      {draft && calc && (
        <Modal title="ตรวจข้อมูลก่อนบันทึก" onClose={() => setDraft(null)}>
          {error && <p className="note">{error} · กรอกข้อมูลเองได้</p>}
          {!!missing.length && <p className="note">AI อ่านไม่ได้: {missing.join(", ")}</p>}
          {file && <p className="muted">ไฟล์: {file.name}</p>}
          <form
            className="expense-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset>
              <legend>1. ข้อมูลเอกสาร</legend>
              <label>
                ประเภทเอกสาร
                <select value={draft.docType || ""} onChange={(e) => set("docType", e.target.value)}>
                  <option value="">—</option>
                  {docTypes.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label>
                เลขที่เอกสาร
                <input value={draft.docNo || ""} maxLength={100} onChange={(e) => set("docNo", e.target.value)} />
              </label>
              <label>
                วันที่
                <input type="date" required value={draft.date || ""} onChange={(e) => set("date", e.target.value)} />
              </label>
              <label>
                ผู้ขาย / ผู้รับเงิน
                <input value={draft.payee || ""} maxLength={200} onChange={(e) => set("payee", e.target.value)} />
              </label>
              <label>
                เลขผู้เสียภาษีผู้ขาย
                <input value={draft.taxId || ""} maxLength={20} inputMode="numeric" onChange={(e) => set("taxId", e.target.value)} />
              </label>
              <label>
                Supplier ในระบบ
                <select value={draft.supplierId || ""} onChange={(e) => set("supplierId", e.target.value)}>
                  <option value="">— ไม่ผูก —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </fieldset>
            <fieldset>
              <legend>2. หมวดและโปรเจกต์</legend>
              <label className="wide">
                รายการ
                <input required value={draft.name || ""} maxLength={200} onChange={(e) => set("name", e.target.value)} />
              </label>
              <label>
                หมวดหมู่
                <select required value={draft.category || "อื่นๆ"} onChange={(e) => set("category", e.target.value)}>
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label>
                โปรเจกต์
                <select value={draft.projectId || ""} onChange={(e) => set("projectId", e.target.value)}>
                  <option value="">— ไม่ระบุ —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </fieldset>
            <fieldset>
              <legend>3. ยอดเงินและภาษี</legend>
              <label>
                ยอดตามเอกสาร
                <input type="number" step="any" min={0} required value={draft.amount} onChange={(e) => set("amount", e.target.value)} />
              </label>
              <label>
                VAT
                <select value={draft.vatMode || "none"} onChange={(e) => set("vatMode", e.target.value)}>
                  {Object.entries(vatModes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label>
                หัก ณ ที่จ่าย
                <select value={String(draft.whtRate || "0")} onChange={(e) => set("whtRate", e.target.value)}>
                  {["0", "1", "2", "3", "5"].map((r) => <option key={r} value={r}>{r === "0" ? "ไม่หัก" : r + "%"}</option>)}
                </select>
              </label>
              <dl className="expense-calc wide">
                <dt>ก่อน VAT</dt><dd>฿{money(calc.base)}</dd>
                <dt>VAT 7%</dt><dd>฿{money(calc.vat)}</dd>
                <dt>รวม</dt><dd>฿{money(calc.gross)}</dd>
                <dt>หัก ณ ที่จ่าย {whtForm(String(draft.taxId || ""), Number(draft.whtRate)) && "(" + whtForm(String(draft.taxId || ""), Number(draft.whtRate)) + ")"}</dt><dd>−฿{money(calc.wht)}</dd>
                <dt><b>ยอดจ่ายจริง</b></dt><dd><b>฿{money(calc.net)}</b></dd>
              </dl>
            </fieldset>
            <fieldset>
              <legend>4–6. การชำระและอนุมัติ</legend>
              <label>
                การชำระ
                <select value={draft.payStatus || "รอจ่าย"} onChange={(e) => set("payStatus", e.target.value)}>
                  {["รอจ่าย", "จ่ายแล้ว", "จ่ายบางส่วน"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label>
                สถานะ
                <select value={draft.status || "pending"} onChange={(e) => set("status", e.target.value)}>
                  <option value="pending">รอตรวจสอบ</option>
                  {["owner", "manager"].includes(ctx.member.role) && <option value="approved">อนุมัติแล้ว</option>}
                </select>
              </label>
              <label className="wide">
                หมายเหตุ
                <textarea value={draft.notes || ""} maxLength={2000} onChange={(e) => set("notes", e.target.value)} />
              </label>
            </fieldset>
            <button className="primary full" disabled={!!busy}>{busy || "บันทึกค่าใช้จ่าย"}</button>
          </form>
        </Modal>
      )}
    </>
  );
}
