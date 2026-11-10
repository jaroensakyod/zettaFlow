"use client";
// Add / edit a quotation on the document itself: the page looks like the printed ใบเสนอราคา (letterhead, customer box,
// info box, item table, totals, payment, conditions, contact, signatures) and every blank on it is a field — pick the
// customer and its details fill in, add items or packages, set discount and VAT, and see the total as you type.
import { useEffect, useMemo, useState } from "react";
import {
  X, Plus, Trash2, FileText, Calendar, Clock, User, Phone, Mail, Globe, Building2, Landmark, Layers, ClipboardList, Headphones,
  FolderKanban, Package, Save, Send, Printer, MessageCircle,
} from "lucide-react";
import type { QuoteForm } from "@/lib/quotes";
import { api, money, Loading } from "./shared";

type Item = { name: string; detail: string; qty: number; unit: string; price: number; discount: number };
const blank = (): Item => ({ name: "", detail: "", qty: 1, unit: "", price: 0, discount: 0 });
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const plus = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const thai = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][m - 1]} ${y + 543}`;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => x.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function QuoteEditor({ id, onClose, onSaved }: { id?: string; onClose: () => void; onSaved: (msg: string, id: string) => void }) {
  const [form, setForm] = useState<QuoteForm | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  // The quotation being written.
  const [v, setV] = useState({
    name: "", customerId: "", projectId: "", date: today(), validUntil: plus(today(), 14), owner: "", vatMode: "excluded", discount: 0, notes: "",
  });
  const [items, setItems] = useState<Item[]>([blank()]);
  useEffect(() => {
    api("/quotes/form" + (id ? "?id=" + id : ""))
      .then((f: QuoteForm) => {
        setForm(f);
        const d = f.quote?.data;
        if (!d) return;
        const str = (x: unknown) => (x === null || x === undefined ? "" : String(x));
        setV({
          name: str(d.name), customerId: str(d.customerId), projectId: str(d.projectId), date: str(d.date) || today(), validUntil: str(d.validUntil),
          owner: str(d.owner), vatMode: str(d.vatMode) || "excluded", discount: Number(d.discount) || 0, notes: str(d.notes),
        });
        const lines = Array.isArray(d.lines) ? (d.lines as { name: string; qty: number; price: number; unit?: string; discount?: number; discountType?: string }[]) : [];
        if (lines.length)
          setItems(
            lines.map((l) => {
              const [name, ...rest] = String(l.name || "").split(/\r?\n/);
              const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
              return { name, detail: rest.join(" ").trim(), qty: Number(l.qty) || 0, unit: l.unit || "", price: Number(l.price) || 0, discount: l.discountType === "percent" ? r2((gross * (Number(l.discount) || 0)) / 100) : Number(l.discount) || 0 };
            }),
          );
        else if (Number(d.subtotal)) setItems([{ ...blank(), name: str(d.name), price: Number(d.subtotal) }]);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const setItem = (i: number, patch: Partial<Item>) => setItems((list) => list.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const customer = form?.customers.find((c) => c.id === v.customerId);
  const totals = useMemo(() => {
    const gross = r2(items.reduce((s, it) => s + it.qty * it.price, 0));
    const lineOff = r2(items.reduce((s, it) => s + Math.min(it.discount, it.qty * it.price), 0));
    const off = r2(lineOff + v.discount);
    const after = Math.max(0, r2(gross - off));
    const vat = v.vatMode === "excluded" ? r2(after * 0.07) : v.vatMode === "included" ? r2(after - after / 1.07) : 0;
    const total = v.vatMode === "excluded" ? r2(after + vat) : after;
    return { gross, off, after, vat, total };
  }, [items, v.discount, v.vatMode]);

  if (!form)
    return (
      <div className="qe-overlay">{error ? <p className="form-error">{error}</p> : <Loading />}</div>
    );
  const c = form.company;
  const credit = customer?.creditDays;
  const term = credit === null || credit === undefined ? "ตามตกลง" : credit > 0 ? `ภายใน ${credit} วัน` : "ชำระทันที";
  const code = form.quote?.code || form.nextCode || "ออกเลขอัตโนมัติ";
  const autoNotes = [
    v.vatMode === "excluded" ? "ราคายังไม่รวมภาษีมูลค่าเพิ่ม (VAT) 7%" : v.vatMode === "included" ? "ราคารวมภาษีมูลค่าเพิ่ม (VAT) 7% แล้ว" : "",
    ...form.company.notes,
    v.validUntil ? `ใบเสนอราคานี้ยืนราคาถึงวันที่ ${thai(v.validUntil)}` : "",
  ].filter(Boolean);
  const conditions = [{ label: "การชำระเงิน", text: credit === null || credit === undefined ? "ตามที่ตกลงกับลูกค้า" : `ชำระเงิน${term} นับจากวันที่ส่งมอบ/วางบิล` }, ...c.conditions.map((x) => {
    const [label, ...rest] = x.split(/\s*:\s*/);
    return rest.length ? { label, text: rest.join(": ") } : { label: "", text: x };
  })];

  async function save(status: "ร่าง" | "ส่งแล้ว") {
    setError("");
    if (!v.customerId) return setError("เลือกลูกค้าก่อน");
    const rows = items.filter((it) => it.name.trim());
    if (!rows.length) return setError("ใส่รายการสินค้า / บริการอย่างน้อย 1 รายการ");
    setBusy(status);
    try {
      const data: Record<string, unknown> = {
        name: v.name.trim() || rows[0].name.trim(),
        customerId: v.customerId,
        projectId: v.projectId || undefined,
        date: v.date,
        validUntil: v.validUntil || undefined,
        // The item's รายละเอียด rides on its name's second line (what the printed document reads).
        lines: rows.map((it) => ({ name: it.name.trim() + (it.detail.trim() ? "\n" + it.detail.trim() : ""), qty: it.qty, price: it.price, ...(it.unit.trim() ? { unit: it.unit.trim() } : {}), ...(it.discount ? { discount: it.discount, discountType: "amount" } : {}) })),
        discount: v.discount || undefined,
        vatMode: v.vatMode,
        owner: v.owner.trim() || undefined,
        // Editing keeps the quotation's status (change it from the quotation window); a new one is ร่าง or ส่งแล้ว.
        status: form?.quote ? String(form.quote.data.status || "ร่าง") : status,
        notes: v.notes.trim() || undefined,
      };
      const saved: { id: string } = await api("/entities/quotations" + (form?.quote ? "/" + form.quote.id : ""), {
        method: form?.quote ? "PATCH" : "POST",
        body: { data, version: form?.quote?.version },
      });
      onSaved(form?.quote ? "บันทึกใบเสนอราคาแล้ว" : status === "ส่งแล้ว" ? "สร้างใบเสนอราคาแล้ว · สถานะส่งให้ลูกค้าแล้ว" : "บันทึกร่างใบเสนอราคาแล้ว", saved.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="qe-overlay" role="dialog" aria-modal="true" aria-label={form.quote ? "แก้ไขใบเสนอราคา" : "เพิ่มใบเสนอราคา"}>
      <div className="qe-toolbar">
        <b>{form.quote ? "แก้ไขใบเสนอราคา " + code : "เพิ่มใบเสนอราคา"}</b>
        <span className="qe-hint">กรอกบนเอกสารได้เลย · ช่องสีม่วงอ่อนคือช่องที่แก้ได้</span>
        <div>
          {form.quote && (
            <a className="secondary as-button" href={"/print/quotation/" + form.quote.id} target="_blank" rel="noreferrer">
              <Printer size={15} /> ดูเอกสารจริง
            </a>
          )}
          <button className="secondary" onClick={onClose}>
            <X size={15} /> ปิด
          </button>
          <button className="secondary" disabled={!!busy} onClick={() => save("ร่าง")}>
            <Save size={15} /> {busy === "ร่าง" ? "กำลังบันทึก…" : form.quote ? "บันทึก" : "บันทึกร่าง"}
          </button>
          {!form.quote && (
            <button className="primary" disabled={!!busy} onClick={() => save("ส่งแล้ว")}>
              <Send size={15} /> {busy === "ส่งแล้ว" ? "กำลังบันทึก…" : "บันทึก · ส่งให้ลูกค้าแล้ว"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="form-error qe-error">{error}</p>}

      <div className="qe-paper">
        {/* Letterhead + title */}
        <header className="qe-head">
          <div className="qe-company">
            <div className="qe-brand">
              {c.hasLogo ? <img src={"/api/feed/logo/" + c.id} alt="" /> : <span className="qe-mark">{c.name.replace(/^บริษัท\s*/, "").slice(0, 1)}</span>}
              <span>
                <b>{c.name}</b>
                {c.nameEn && <small>{c.nameEn}</small>}
              </span>
            </div>
            <p>{c.address || <span className="qe-missing">ยังไม่ได้ใส่ที่อยู่บริษัท</span>}</p>
            <p>
              เลขประจำตัวผู้เสียภาษี {c.taxId || "-"} {c.branch && <> · {c.branch}</>}
            </p>
            <p className="qe-contact-line">
              {c.phone && (
                <span>
                  <Phone size={13} /> {c.phone}
                </span>
              )}
              {c.email && (
                <span>
                  <Mail size={13} /> {c.email}
                </span>
              )}
              {c.website && (
                <span>
                  <Globe size={13} /> {c.website}
                </span>
              )}
            </p>
          </div>
          <div className="qe-title">
            <FileText size={34} />
            <span>
              <b>ใบเสนอราคา</b>
              <small>Quotation</small>
            </span>
          </div>
        </header>

        <div className="qe-row">
          {/* Customer: pick one, its details fill in */}
          <section className="qe-box qe-customer">
            <h4>
              <span className="qe-ico">
                <User size={16} />
              </span>
              ลูกค้า / Customer
            </h4>
            <select className="qe-input qe-pick" value={v.customerId} onChange={(e) => set({ customerId: e.target.value })}>
              <option value="">— เลือกลูกค้าจากรายชื่อในระบบ —</option>
              {form.customers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            {customer ? (
              <dl>
                <dt>ชื่อบริษัท</dt>
                <dd>
                  <b>{customer.name}</b>
                </dd>
                <dt>ที่อยู่</dt>
                <dd>{customer.address || "-"}</dd>
                <dt>เลขประจำตัวผู้เสียภาษี</dt>
                <dd>
                  {customer.taxId || "-"} {customer.branch && "· " + customer.branch}
                </dd>
                <dt>ผู้ติดต่อ</dt>
                <dd>
                  <b>{customer.contact || "-"}</b>
                </dd>
                <dd className="qe-span">
                  {customer.phone && (
                    <span>
                      <Phone size={13} /> {customer.phone}
                    </span>
                  )}
                  {customer.email && (
                    <span>
                      <Mail size={13} /> {customer.email}
                    </span>
                  )}
                </dd>
              </dl>
            ) : (
              <p className="qe-placeholder">เลือกลูกค้าแล้ว ที่อยู่ เลขผู้เสียภาษี และผู้ติดต่อจะขึ้นให้อัตโนมัติ</p>
            )}
          </section>

          {/* Quotation info */}
          <section className="qe-box qe-info">
            <div>
              <span>
                <FileText size={15} /> เลขที่ใบเสนอราคา
              </span>
              <b className="qe-code">{code}</b>
            </div>
            <div>
              <span>
                <Calendar size={15} /> วันที่เสนอราคา
              </span>
              <input type="date" className="qe-input" value={v.date} onChange={(e) => set({ date: e.target.value })} />
            </div>
            <div>
              <span>
                <Calendar size={15} /> ยืนยันราคาถึง
              </span>
              <span className="qe-valid">
                <input type="date" className="qe-input" value={v.validUntil} onChange={(e) => set({ validUntil: e.target.value })} />
                {[7, 14, 30].map((d) => (
                  <button key={d} type="button" className={v.validUntil === plus(v.date, d) ? "on" : ""} onClick={() => set({ validUntil: plus(v.date, d) })}>
                    {d} วัน
                  </button>
                ))}
              </span>
            </div>
            <div>
              <span>
                <Clock size={15} /> เงื่อนไขการชำระเงิน
              </span>
              <b>{customer ? term : "ตามเครดิตลูกค้า"}</b>
            </div>
            <div>
              <span>
                <User size={15} /> พนักงานขาย
              </span>
              <input className="qe-input" value={v.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="ชื่อพนักงานขาย" />
            </div>
            <div>
              <span>
                <User size={15} /> ผู้เสนอราคา
              </span>
              <b>{c.signerName || v.owner || "-"}</b>
            </div>
            {c.phone && (
              <div>
                <span>
                  <Phone size={15} /> โทรศัพท์
                </span>
                <b>{c.phone}</b>
              </div>
            )}
            {c.email && (
              <div>
                <span>
                  <Mail size={15} /> อีเมล
                </span>
                <b>{c.email}</b>
              </div>
            )}
          </section>
        </div>

        {/* What it is for */}
        <section className="qe-box qe-job">
          <label>
            <span>
              <FileText size={15} /> หัวข้องาน / รายละเอียด (เสนออะไร)
            </span>
            <input className="qe-input" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="เช่น ระบบ EliteFlow แพ็กเกจ Pro พร้อมติดตั้งและอบรม" maxLength={500} />
          </label>
          <label>
            <span>
              <FolderKanban size={15} /> โปรเจกต์ (ถ้ามี)
            </span>
            <select className="qe-input" value={v.projectId} onChange={(e) => set({ projectId: e.target.value })}>
              <option value="">— ไม่ระบุโปรเจกต์ —</option>
              {form.projects.map((pj) => (
                <option key={pj.id} value={pj.id}>
                  {pj.code ? pj.code + " · " : ""}
                  {pj.name}
                </option>
              ))}
            </select>
          </label>
        </section>

        {/* Items */}
        <div className="qe-table-wrap">
          <table className="qe-table">
            <thead>
              <tr>
                <th>#</th>
                <th>รายการสินค้า / บริการ</th>
                <th>รายละเอียด</th>
                <th>จำนวน</th>
                <th>หน่วย</th>
                <th>
                  ราคาต่อหน่วย
                  <small>(บาท)</small>
                </th>
                <th>
                  ส่วนลด
                  <small>(บาท)</small>
                </th>
                <th>
                  จำนวนเงิน
                  <small>(บาท)</small>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="qe-n">{i + 1}</td>
                  <td>
                    <input className="qe-input qe-strong" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="ชื่อสินค้า / บริการ" />
                  </td>
                  <td>
                    <textarea className="qe-input" rows={1} value={it.detail} onChange={(e) => setItem(i, { detail: e.target.value })} placeholder="รายละเอียดสั้นๆ" />
                  </td>
                  <td>
                    <input className="qe-input qe-num" type="number" min={0} step="any" value={it.qty} onChange={(e) => setItem(i, { qty: Math.max(0, Number(e.target.value) || 0) })} />
                  </td>
                  <td>
                    <input className="qe-input qe-unit" value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} placeholder="ชุด" maxLength={30} />
                  </td>
                  <td>
                    <input className="qe-input qe-num" type="number" min={0} step="0.01" value={it.price} onChange={(e) => setItem(i, { price: Math.max(0, Number(e.target.value) || 0) })} />
                  </td>
                  <td>
                    <input className="qe-input qe-num" type="number" min={0} step="0.01" value={it.discount || ""} placeholder="-" onChange={(e) => setItem(i, { discount: Math.max(0, Number(e.target.value) || 0) })} />
                  </td>
                  <td className="qe-amount">{fmt(Math.max(0, it.qty * it.price - it.discount))}</td>
                  <td>
                    <button className="qe-del" aria-label="ลบรายการ" disabled={items.length === 1} onClick={() => setItems((l) => l.filter((_, k) => k !== i))}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="qe-add">
            <button className="secondary" onClick={() => setItems((l) => [...l, blank()])}>
              <Plus size={15} /> เพิ่มรายการ
            </button>
            {!!form.packages.length && (
              <label className="qe-from-pkg">
                <Package size={15} />
                <select
                  value=""
                  onChange={(e) => {
                    const pk = form.packages.find((x) => x.id === e.target.value);
                    if (!pk) return;
                    setItems((l) => [...l.filter((x) => x.name.trim() || x.price), { ...blank(), name: pk.name, price: pk.price, unit: pk.type === "บริการ" ? "งาน" : pk.type === "แพ็กเกจ" ? "ชุด" : "ชิ้น" }]);
                  }}
                >
                  <option value="">+ เพิ่มจากสินค้า & แพ็กเกจ</option>
                  {form.packages.map((pk) => (
                    <option key={pk.id} value={pk.id}>
                      {pk.name} · ฿{money(pk.price)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="qe-row qe-bottom">
          {/* Notes */}
          <section className="qe-box qe-notes">
            <h4>
              <span className="qe-ico">
                <Layers size={16} />
              </span>
              หมายเหตุ
            </h4>
            <ul>
              {autoNotes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <textarea className="qe-input" rows={3} value={v.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={"หมายเหตุเพิ่มเติม (บรรทัดละข้อ) เช่น\nกำหนดการติดตั้งและอบรมตามที่ตกลงร่วมกัน"} />
          </section>
          {/* Totals */}
          <section className="qe-totals">
            <div>
              <span>ยอดรวมก่อนส่วนลด</span>
              <b>{fmt(totals.gross)}</b>
            </div>
            <div className="qe-off">
              <span>
                ส่วนลดรวม
                <small>
                  ส่วนลดท้ายบิล
                  <input className="qe-input qe-num" type="number" min={0} step="0.01" value={v.discount || ""} placeholder="0" onChange={(e) => set({ discount: Math.max(0, Number(e.target.value) || 0) })} />
                </small>
              </span>
              <b>{fmt(totals.off)}</b>
            </div>
            <div>
              <span>ยอดหลังหักส่วนลด</span>
              <b>{fmt(totals.after)}</b>
            </div>
            <div>
              <span>
                <select className="qe-input qe-vat" value={v.vatMode} onChange={(e) => set({ vatMode: e.target.value })}>
                  <option value="excluded">ภาษีมูลค่าเพิ่ม (VAT 7%) · บวกเพิ่ม</option>
                  <option value="included">ภาษีมูลค่าเพิ่ม (VAT 7%) · รวมในราคาแล้ว</option>
                  <option value="none">ไม่มี VAT</option>
                </select>
              </span>
              <b>{fmt(totals.vat)}</b>
            </div>
            <div className="qe-grand">
              <span>จำนวนเงินทั้งสิ้น</span>
              <b>{fmt(totals.total)} บาท</b>
            </div>
          </section>
        </div>

        <div className="qe-row qe-bottom">
          {/* Payment channel (from the company profile) */}
          <section className="qe-box qe-pay">
            <h4>
              <span className="qe-ico">
                <Landmark size={16} />
              </span>
              ช่องทางการชำระเงิน
            </h4>
            {c.bank || c.bankAccount ? (
              <dl>
                <dt>ธนาคาร</dt>
                <dd>
                  <b>{c.bank || "-"}</b>
                </dd>
                <dt>เลขที่บัญชี</dt>
                <dd>{c.bankAccount || "-"}</dd>
                <dt>ชื่อบัญชี</dt>
                <dd>{c.bankAccountName || c.name}</dd>
                <dt>ประเภทบัญชี</dt>
                <dd>{c.bankAccountType || "-"}</dd>
              </dl>
            ) : (
              <p className="qe-missing">ยังไม่ได้ตั้งบัญชีรับเงินในข้อมูลบริษัท</p>
            )}
            {c.promptPay && <p className="qe-qr">QR พร้อมเพย์ ({c.promptPay}) จะแสดงในเอกสารจริง</p>}
          </section>
          {/* Conditions */}
          <section className="qe-box qe-cond">
            <h4>
              <span className="qe-ico">
                <ClipboardList size={16} />
              </span>
              เงื่อนไขเพิ่มเติม
            </h4>
            <ol>
              {conditions.map((x, i) => (
                <li key={i}>
                  <i>{i + 1}</i>
                  {x.label && <b>{x.label}</b>}
                  <span>{x.label ? ": " + x.text : x.text}</span>
                </li>
              ))}
            </ol>
            <small className="qe-from">แก้เงื่อนไขได้ที่ ตั้งค่า › ข้อมูลบริษัท (ใช้กับทุกใบ)</small>
          </section>
        </div>

        <div className="qe-row qe-bottom">
          <section className="qe-box qe-sales">
            <h4>
              <span className="qe-ico">
                <Headphones size={16} />
              </span>
              ติดต่อฝ่ายขาย
            </h4>
            <p>
              <User size={14} /> {v.owner || c.signerName || "-"} (ฝ่ายขาย)
            </p>
            {c.phone && (
              <p>
                <Phone size={14} /> {c.phone}
              </p>
            )}
            {c.email && (
              <p>
                <Mail size={14} /> {c.email}
              </p>
            )}
            {c.line && (
              <p>
                <MessageCircle size={14} /> {c.line}
              </p>
            )}
          </section>
          <section className="qe-sign">
            {[
              ["ผู้เสนอราคา", c.signerName || v.owner, c.signerPosition || "ฝ่ายขาย"],
              ["ผู้อนุมัติ", c.approverName, c.approverPosition],
            ].map(([role, name, pos]) => (
              <div key={role}>
                <i />
                <b>{role}</b>
                <span>({name || "................................"})</span>
                <small>{pos}</small>
              </div>
            ))}
          </section>
        </div>
        <p className="qe-foot">
          <Building2 size={13} /> หัวกระดาษ บัญชีรับเงิน เงื่อนไข และผู้ลงนาม มาจาก ตั้งค่า › ข้อมูลบริษัท
        </p>
      </div>
    </div>
  );
}
