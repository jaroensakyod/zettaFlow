"use client";
// ระบบบัญชี: drop receipts → AI fills each one (รอตรวจ) → a person checks it beside the original → save posts the journal
// and opens the next one. Summary cards for ภ.พ.30 / WHT, receipt list with filters, and project budget bars.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanLine, Upload, Receipt, Landmark, HandCoins, Clock, Plus, Trash2, Printer, Sparkles, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { expenseCategories, docTypes, payStatuses, departmentNames, type Line } from "@/lib/catalog";
import { computeExpense, vatModes, whtForm, linesTotal, linesMismatch, FULL_TAX_INVOICE, awaitingReview, type VatMode } from "@/lib/tax";
import { buildJournal, expenseAccount, type Account, type CostCenter } from "@/lib/ledger";
import { api, money, displayDate, Empty, Loading } from "./shared";
import { uploadFile } from "./platform";
import { deptLabels } from "./home-dashboard";

type Overview = {
  month: string;
  total: number;
  vat: number;
  wht: number;
  pending: number;
  expenses: Entity[];
  projects: { id: string; name: string; budget: number; spent: number }[];
  accounts: Account[];
  costCenters: CostCenter[];
};
type Option = { id: string; kind: string; name: string };
type Draft = Record<string, unknown> & { lines?: Line[] };
const tabs = ["ค่าใช้จ่าย", "รายรับ", "ภาษี", "สมุดรายวัน", "รายงาน"];
const filters = { all: "ทั้งหมด", pending: "รอตรวจ", saved: "บันทึกแล้ว" } as const;
const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const gross = (d: Record<string, unknown>) => computeExpense(Number(d.amount), (d.vatMode as VatMode) || "none", Number(d.whtRate) || 0, String(d.docType || "")).gross;

export function Accounting({ ctx, notify, changed }: { ctx: Context; notify: (s: string) => void; changed: () => void }) {
  const [data, setData] = useState<Overview | null>(null),
    [options, setOptions] = useState<Option[]>([]),
    [filter, setFilter] = useState<keyof typeof filters>("pending"),
    [project, setProject] = useState(""),
    [selected, setSelected] = useState<Entity | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [receipt, setReceipt] = useState<{ id: string; mime: string; name: string } | null>(null),
    [wht, setWht] = useState(false),
    [queue, setQueue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [drag, setDrag] = useState(false),
    formRef = useRef<HTMLFormElement>(null);
  const writable = ctx.member.role !== "viewer" && (ctx.member.role === "owner" || ctx.member.departments.includes("Finance"));
  const load = useCallback(async () => {
    try {
      const d: Overview = await api("/receipts");
      setData(d);
      return d;
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    api("/options").then(setOptions).catch(() => {});
  }, [load]);

  const open = useCallback(async (e: Entity | null) => {
    setSelected(e);
    setDraft(e ? { ...e.data, lines: Array.isArray(e.data.lines) ? (e.data.lines as Line[]) : [] } : null);
    setReceipt(null);
    setWht(false);
    setError("");
    if (!e) return;
    api("/files?entity=" + e.id)
      .then((files: { id: string; mime: string; name: string }[]) => setReceipt(files.find((f) => f.id === e.data.receiptId) || files[0] || null))
      .catch(() => {});
    if (!awaitingReview(e.data)) api("/accounting/books/" + e.id).then((b) => setWht(!!b.wht)).catch(() => {});
  }, []);

  const rows = useMemo(
    () =>
      (data?.expenses || []).filter(
        (e) => (filter === "all" || (filter === "pending") === awaitingReview(e.data)) && (!project || e.data.projectId === project),
      ),
    [data, filter, project],
  );
  // Open the first waiting receipt when the page loads.
  useEffect(() => {
    if (data && !selected) {
      const first = data.expenses.find((e) => awaitingReview(e.data));
      if (first) open(first);
    }
  }, [data, selected, open]);

  async function addFiles(files: File[]) {
    setError("");
    let first: Entity | null = null,
      failed = 0;
    for (const [i, f] of files.entries()) {
      setQueue(`AI กำลังอ่าน ${i + 1}/${files.length}: ${f.name}`);
      try {
        const id = await uploadFile(f, "Finance");
        const r: { entity: Entity; error: string } = await api("/receipts", { method: "POST", body: { attachmentId: id } });
        if (r.error) failed++;
        first ||= r.entity;
      } catch (e) {
        failed++;
        setError(f.name + ": " + (e as Error).message);
      }
    }
    setQueue("");
    notify(`ส่งเข้าระบบ ${files.length} ใบ` + (failed ? ` · ${failed} ใบต้องกรอกเอง` : ""));
    setFilter("pending");
    await load();
    if (first) open(first);
    changed();
  }

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d!, [k]: v }));
  const setLine = (i: number, patch: Partial<Line>) =>
    setDraft((d) => ({ ...d!, lines: d!.lines!.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const accounts = data?.accounts || [];
  const calc = draft ? computeExpense(Number(draft.amount), (draft.vatMode as VatMode) || "none", Number(draft.whtRate) || 0, String(draft.docType || "")) : null;
  const journal = draft ? buildJournal(draft, accounts) : null;
  const unsure = new Set(String(draft?.aiUncertain || "").split(",").filter(Boolean));
  const flag = (k: string) => (unsure.has(k) ? "ai-unsure" : undefined);
  const suppliers = options.filter((o) => o.kind === "suppliers"),
    projects = options.filter((o) => o.kind === "projects");
  const budget = data?.projects.find((p) => p.id === draft?.projectId);
  const already = budget && selected?.data.projectId === budget.id && selected.data.status !== "rejected" ? gross(selected.data) : 0;
  const accountName = (code: string) => accounts.find((a) => a.code === code)?.name || code;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !draft) return;
    setBusy(true);
    setError("");
    try {
      const body = Object.fromEntries(Object.entries({ ...draft, amount: Number(draft.amount) || 0 } as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null && v !== undefined));
      if (!draft.lines?.length) delete body.lines;
      await api("/entities/expenses/" + selected.id, { method: "PATCH", body: { data: body, version: selected.version } });
      await api("/accounting/post/" + selected.id, { method: "POST" });
      notify("บันทึกและลงบัญชีแล้ว");
      const fresh = await load();
      const next = fresh?.expenses.find((x) => awaitingReview(x.data) && x.id !== selected.id);
      if (next) open(next);
      else open(fresh?.expenses.find((x) => x.id === selected.id) || null);
      changed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="form-error">{error}</p> : <Loading />;
  return (
    <div className="acc">
      <div className="acc-tabs" role="tablist">
        {tabs.map((t, i) => (
          <button key={t} role="tab" aria-selected={i === 0} className={i === 0 ? "active" : ""} disabled={i > 0}>
            {t}
            {i > 0 && <em>เร็วๆ นี้</em>}
          </button>
        ))}
      </div>
      <div className="expense-cards">
        {(
          [
            [Receipt, "ค่าใช้จ่ายเดือนนี้", "฿" + money(data.total)],
            [Landmark, "ภาษีซื้อขอคืนได้ (ภ.พ.30)", "฿" + money(data.vat)],
            [HandCoins, "หัก ณ ที่จ่ายค้างนำส่ง", "฿" + money(data.wht)],
            [Clock, "ใบที่รอตรวจ", data.pending + " ใบ"],
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
      <div className="acc-grid">
        <aside className="acc-side">
          {writable && (
            <label
              className={"receipt-drop card" + (queue ? " busy" : "") + (drag ? " drag" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const files = [...e.dataTransfer.files].filter((f) => ACCEPT.includes(f.type));
                if (files.length && !queue) addFiles(files);
              }}
            >
              <ScanLine size={24} />
              <span>
                <b>{queue || "ลากใบเสร็จมาวาง หรือถ่ายรูป"}</b>
                <small>JPG, PNG, PDF · หลายใบพร้อมกันได้ · ส่งรูปให้น้องโฟลว์ในแชทก็ได้</small>
              </span>
              <span className="secondary as-button">
                <Upload size={15} /> เลือกไฟล์
              </span>
              <input
                type="file"
                multiple
                className="file-hidden"
                disabled={!!queue}
                accept={ACCEPT}
                onChange={(e) => {
                  const files = [...(e.target.files || [])];
                  e.target.value = "";
                  if (files.length) addFiles(files);
                }}
              />
            </label>
          )}
          <section className="card acc-list">
            <div className="acc-filters">
              {(Object.keys(filters) as (keyof typeof filters)[]).map((k) => (
                <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>
                  {filters[k]}
                  {k === "pending" && !!data.pending && <i>{data.pending}</i>}
                </button>
              ))}
            </div>
            {project && (
              <button className="acc-chip" onClick={() => setProject("")}>
                โปรเจกต์: {data.projects.find((p) => p.id === project)?.name} ✕
              </button>
            )}
            {!rows.length ? (
              <Empty title={filter === "pending" ? "ไม่มีใบที่รอตรวจ" : "ยังไม่มีใบเสร็จ"} description="ส่งใบเสร็จเข้าระบบแล้ว AI จะกรอกข้อมูลให้ตรวจ" />
            ) : (
              <ul>
                {rows.map((e) => (
                  <li key={e.id}>
                    <button className={selected?.id === e.id ? "active" : ""} onClick={() => open(e)}>
                      <span>
                        <b>{String(e.data.payee || e.data.name)}</b>
                        <small>
                          {displayDate(e.data.date)} · {String(e.data.category)}
                          {!!e.data.projectId && " · " + (projects.find((p) => p.id === e.data.projectId)?.name || "โปรเจกต์")}
                        </small>
                      </span>
                      <span>
                        <b>฿{money(gross(e.data))}</b>
                        <em className={awaitingReview(e.data) ? "wait" : "done"}>{awaitingReview(e.data) ? "รอตรวจ" : "บันทึกแล้ว"}</em>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!!data.projects.length && (
            <section className="card acc-budgets">
              <h3>ค่าใช้จ่ายตามโปรเจกต์</h3>
              {data.projects.map((p) => {
                const pct = p.budget ? (p.spent / p.budget) * 100 : 0,
                  tone = p.budget && pct > 100 ? "over" : pct >= 90 ? "near" : "";
                return (
                  <button key={p.id} className={"acc-budget " + tone + (project === p.id ? " active" : "")} onClick={() => setProject(project === p.id ? "" : p.id)}>
                    <span>
                      <b>{p.name}</b>
                      {tone && <em>{tone === "over" ? "เกินงบ" : "ใกล้เต็มงบ"}</em>}
                    </span>
                    <small>
                      ฿{money(p.spent)} {p.budget ? `/ ฿${money(p.budget)} (${Math.round(pct)}%)` : "· ไม่ได้ตั้งงบ"}
                    </small>
                    {!!p.budget && (
                      <i>
                        <span style={{ width: Math.min(100, pct) + "%" }} />
                      </i>
                    )}
                  </button>
                );
              })}
            </section>
          )}
        </aside>
        <section className="card acc-review">
          {!selected || !draft || !calc || !journal ? (
            <Empty title="เลือกใบเสร็จเพื่อตรวจ" description="ใบที่ AI อ่านแล้วจะอยู่ในแท็บรอตรวจ" />
          ) : (
            <>
              <header className="acc-review-head">
                <div>
                  <h2>{String(draft.payee || draft.name || "ใบเสร็จ")}</h2>
                  <small>
                    {awaitingReview(selected.data) ? "รอตรวจ" : "บันทึกแล้ว"}
                    {draft.supplierId ? " · Supplier ในทะเบียน" : ""}
                  </small>
                </div>
                {wht && (
                  <a className="secondary as-button" href={"/api/wht/" + selected.id} target="_blank" rel="noreferrer">
                    <Printer size={15} /> พิมพ์ 50 ทวิ
                  </a>
                )}
              </header>
              {!!draft.aiNotes && awaitingReview(selected.data) && (
                <p className="acc-ai">
                  <Sparkles size={15} /> {String(draft.aiNotes)}
                  {!!unsure.size && <span> · ช่องกรอบสีส้มคือช่องที่ AI ไม่แน่ใจ</span>}
                </p>
              )}
              <div className="acc-review-body">
                <figure className="acc-receipt">
                  {!receipt ? (
                    <div className="acc-noreceipt">
                      <FileText size={28} />
                      ไม่มีไฟล์ใบเสร็จ
                    </div>
                  ) : receipt.mime === "application/pdf" ? (
                    <object data={"/api/files/" + receipt.id} type="application/pdf" aria-label={receipt.name}>
                      <a href={"/api/files/" + receipt.id} target="_blank" rel="noreferrer">
                        เปิด {receipt.name}
                      </a>
                    </object>
                  ) : (
                    <a href={"/api/files/" + receipt.id} target="_blank" rel="noreferrer">
                      <img src={"/api/files/" + receipt.id} alt={"ใบเสร็จ " + receipt.name} />
                    </a>
                  )}
                </figure>
                <form ref={formRef} className="expense-form acc-form" onSubmit={save}>
                  <fieldset disabled={!writable || busy}>
                    <legend>1. ข้อมูลเอกสาร</legend>
                    <label className={flag("docType")}>
                      ประเภทเอกสาร
                      <select value={String(draft.docType || "")} onChange={(e) => set("docType", e.target.value)}>
                        <option value="">—</option>
                        {docTypes.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                    <label className={flag("docNo")}>
                      เลขที่เอกสาร
                      <input value={String(draft.docNo || "")} maxLength={100} onChange={(e) => set("docNo", e.target.value)} />
                    </label>
                    <label className={flag("date")}>
                      วันที่
                      <input type="date" required value={String(draft.date || "")} onChange={(e) => set("date", e.target.value)} />
                    </label>
                    <label className={flag("payee")}>
                      ผู้ขาย
                      <input value={String(draft.payee || "")} maxLength={200} onChange={(e) => set("payee", e.target.value)} />
                    </label>
                    <label className={flag("taxId")}>
                      เลขผู้เสียภาษีผู้ขาย
                      <input value={String(draft.taxId || "")} maxLength={20} inputMode="numeric" onChange={(e) => set("taxId", e.target.value)} />
                    </label>
                    <label>
                      Supplier ในทะเบียน
                      <select value={String(draft.supplierId || "")} onChange={(e) => set("supplierId", e.target.value)}>
                        <option value="">— ไม่ผูก —</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="wide">
                      รายการ
                      <input required value={String(draft.name || "")} maxLength={200} onChange={(e) => set("name", e.target.value)} />
                    </label>
                  </fieldset>
                  <fieldset disabled={!writable || busy}>
                    <legend>2. หมวดบัญชีและโปรเจกต์</legend>
                    <label className={flag("category")}>
                      หมวดค่าใช้จ่าย
                      <select required value={String(draft.category || "อื่นๆ")} onChange={(e) => set("category", e.target.value)}>
                        {expenseCategories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      รหัสผังบัญชี
                      <select value={expenseAccount(draft, accounts)} onChange={(e) => set("accountCode", e.target.value)}>
                        {accounts
                          .filter((a) => a.type === "expense" || a.category)
                          .map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.code} {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      ศูนย์ต้นทุน (แผนก / สาขา)
                      <select value={String(draft.costCenter || "")} onChange={(e) => set("costCenter", e.target.value)}>
                        <option value="">— ไม่ระบุ —</option>
                        {data.costCenters.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                        {departmentNames.map((d) => (
                          <option key={d} value={d}>
                            {deptLabels[d] || d}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={flag("projectId")}>
                      โปรเจกต์
                      <select value={String(draft.projectId || "")} onChange={(e) => set("projectId", e.target.value)}>
                        <option value="">— ไม่ระบุ —</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {budget && budget.budget > 0 && (
                      <dl className="expense-calc wide acc-budget-calc">
                        <dt>งบโปรเจกต์</dt>
                        <dd>฿{money(budget.budget)}</dd>
                        <dt>ใช้ไปแล้ว</dt>
                        <dd>฿{money(budget.spent - already)}</dd>
                        <dt>รายการนี้</dt>
                        <dd>฿{money(calc.gross)}</dd>
                        <dt>
                          <b>งบคงเหลือ</b>
                        </dt>
                        <dd className={budget.budget - budget.spent + already - calc.gross < 0 ? "neg" : ""}>
                          <b>฿{money(budget.budget - budget.spent + already - calc.gross)}</b>
                        </dd>
                      </dl>
                    )}
                  </fieldset>
                  <fieldset disabled={!writable || busy} className={"acc-lines " + (flag("lines") || "")}>
                    <legend>3. รายการ</legend>
                    <div className="wide acc-lines-table">
                      {draft.lines!.map((l, i) => (
                        <div key={i} className="acc-line">
                          <input aria-label="ชื่อรายการ" required value={l.name} maxLength={500} onChange={(e) => setLine(i, { name: e.target.value })} />
                          <input aria-label="จำนวน" type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
                          <input aria-label="ราคาต่อหน่วย" type="number" step="any" value={l.price} onChange={(e) => setLine(i, { price: Number(e.target.value) })} />
                          <span>฿{money((Number(l.qty) || 0) * (Number(l.price) || 0))}</span>
                          <button type="button" className="icon-button" aria-label="ลบรายการ" onClick={() => set("lines", draft.lines!.filter((_, j) => j !== i))}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                      <button type="button" className="text-button" onClick={() => set("lines", [...draft.lines!, { name: "", qty: 1, price: 0 }])}>
                        <Plus size={14} /> เพิ่มรายการ
                      </button>
                      {!!draft.lines!.length && <small>รวมตามรายการ ฿{money(linesTotal(draft.lines))}</small>}
                    </div>
                  </fieldset>
                  <fieldset disabled={!writable || busy}>
                    <legend>4. VAT และหัก ณ ที่จ่าย</legend>
                    <label className={flag("amount")}>
                      ยอดตามเอกสาร
                      <input type="number" step="any" min={0} required value={String(draft.amount ?? "")} onChange={(e) => set("amount", e.target.value)} />
                    </label>
                    <label className={flag("vatMode")}>
                      ราคาในเอกสาร
                      <select value={String(draft.vatMode || "none")} onChange={(e) => set("vatMode", e.target.value)}>
                        {Object.entries(vatModes).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={flag("whtRate")}>
                      หัก ณ ที่จ่าย
                      <select value={String(draft.whtRate || "0")} onChange={(e) => set("whtRate", e.target.value)}>
                        {["0", "1", "2", "3", "5"].map((r) => (
                          <option key={r} value={r}>
                            {r === "0" ? "ไม่หัก" : r + "%"}
                          </option>
                        ))}
                      </select>
                    </label>
                    {Number(draft.whtRate) > 0 && (
                      <p className="wide acc-hint">ต้องยื่น {whtForm(String(draft.taxId || ""), Number(draft.whtRate))} และระบบออกหนังสือ 50 ทวิ ให้เมื่อบันทึก</p>
                    )}
                    {calc.vat > 0 && draft.docType !== FULL_TAX_INVOICE && (
                      <p className="wide acc-hint">เอกสารนี้ไม่ใช่ใบกำกับภาษีเต็มรูป ขอคืน VAT ไม่ได้ ระบบรวม VAT ฿{money(calc.vat)} เข้าเป็นค่าใช้จ่าย</p>
                    )}
                    <dl className="expense-calc wide">
                      <dt>ก่อน VAT</dt>
                      <dd>฿{money(calc.base)}</dd>
                      <dt>VAT 7%</dt>
                      <dd>฿{money(calc.vat)}</dd>
                      <dt>ยอดรวม</dt>
                      <dd>฿{money(calc.gross)}</dd>
                      <dt>หัก ณ ที่จ่าย</dt>
                      <dd>−฿{money(calc.wht)}</dd>
                      <dt>
                        <b>ยอดที่ต้องจ่ายจริง</b>
                      </dt>
                      <dd>
                        <b>฿{money(calc.net)}</b>
                      </dd>
                    </dl>
                    {linesMismatch(draft.lines, Number(draft.amount)) && (
                      <p className="wide acc-warn">
                        <AlertTriangle size={15} /> ยอดรวมตามรายการ ฿{money(linesTotal(draft.lines))} ไม่ตรงกับยอดในใบเสร็จ ฿{money(Number(draft.amount))}
                      </p>
                    )}
                  </fieldset>
                  <fieldset disabled={!writable || busy}>
                    <legend>5. การชำระเงิน</legend>
                    <div className="wide acc-pay">
                      {payStatuses.map((p) => (
                        <label key={p} className={draft.payStatus === p ? "active" : ""}>
                          <input type="radio" name="payStatus" checked={draft.payStatus === p} onChange={() => set("payStatus", p)} />
                          {p === "โอนแล้ว" ? "จ่ายแล้ว (โอน)" : p === "เงินสดย่อย" ? "จ่ายด้วยเงินสดย่อย" : "ยังไม่จ่าย (ตั้งเจ้าหนี้)"}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>6. รายการบัญชี</legend>
                    <table className="wide acc-journal">
                      <thead>
                        <tr>
                          <th>บัญชี</th>
                          <th>เดบิต</th>
                          <th>เครดิต</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journal.lines.map((l) => (
                          <tr key={l.account + l.debit + l.credit}>
                            <td>
                              {l.account} {accountName(l.account)}
                            </td>
                            <td>{l.debit ? money(l.debit) : ""}</td>
                            <td>{l.credit ? money(l.credit) : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className={"wide " + (journal.balanced ? "acc-ok" : "acc-warn")}>
                      {journal.balanced ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                      {journal.balanced ? "เดบิตเท่ากับเครดิต" : "ยังลงบัญชีไม่ได้ ใส่ยอดเงินก่อน"}
                      {!!draft.projectId && " · ทุกบรรทัดติดแท็กโปรเจกต์"}
                    </p>
                  </fieldset>
                  {error && <p className="form-error">{error}</p>}
                  {writable && (
                    <button className="primary full" disabled={busy || !journal.balanced}>
                      {busy ? "กำลังบันทึก…" : awaitingReview(selected.data) ? "บันทึกและลงบัญชี" : "บันทึกการแก้ไขและลงบัญชีใหม่"}
                    </button>
                  )}
                </form>
              </div>
            </>
          )}
        </section>
      </div>
      <p className="muted acc-foot">รหัสผังบัญชีและอัตราภาษีเป็นค่าเริ่มต้น ควรให้นักบัญชีของบริษัทตรวจก่อนใช้จริง</p>
    </div>
  );
}
