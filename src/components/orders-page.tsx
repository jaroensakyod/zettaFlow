"use client";
// คำสั่งซื้อ: who ordered which package on which platform, the total, and whether it is paid. Open an order to see it in
// full; record the payment (who paid, when, how, reference + slip) right there — that also books the income for รายรับ.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Search, ShoppingCart, CheckCircle2, Clock, AlertTriangle, Store, Package, User, CalendarDays, Truck, FileText,
  FolderKanban, Hash, CreditCard, Upload, Wallet, Settings2,
} from "lucide-react";
import type { Context } from "@/lib/types";
import type { OrdersData, OrderRow, PayState } from "@/lib/orders";
import { api, money, displayDate, Empty, Loading, Modal } from "./shared";
import { uploadFile } from "./platform";

const payTone = { ชำระแล้ว: "paid", รอชำระ: "waiting", ยังไม่ชำระ: "unpaid" } as const;
const payMethods = ["โอนธนาคาร", "พร้อมเพย์", "บัตรเครดิต/เดบิต", "เงินสด", "เก็บเงินปลายทาง (COD)", "ชำระผ่านแพลตฟอร์ม"];
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
// One colour per platform, in the order they were added.
const platformColors = ["#7c3aed", "#ee4d2d", "#0f146d", "#111827", "#06c755", "#0ea5e9", "#f59e0b", "#db2777"];

export function OrdersPage({ ctx, notify, navigate }: { ctx: Context; notify: (s: string) => void; navigate: (v: string) => void }) {
  const [data, setData] = useState<OrdersData | null>(null),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [pay, setPay] = useState<PayState | "">(""),
    [platform, setPlatform] = useState(""),
    [open, setOpen] = useState<OrderRow | null>(null),
    [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    try {
      const d: OrdersData = await api("/orders");
      setData(d);
      setOpen((o) => (o ? d.orders.find((x) => x.id === o.id) || null : null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const colorOf = useMemo(() => {
    const m = new Map((data?.platforms || []).map((p, i) => [p.id, platformColors[i % platformColors.length]]));
    return (id: string) => m.get(id) || "#9ca3af";
  }, [data]);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <Loading />;
  const writable = ctx.member.role !== "viewer";
  const term = q.trim().toLowerCase();
  const base = data.orders.filter(
    (o) => o.status !== "ยกเลิก" && (!platform || o.platformId === platform) && (!term || [o.code, o.name, o.customer, o.platform, o.package, o.payerName, o.payReference].join(" ").toLowerCase().includes(term)),
  );
  const rows = base.filter((o) => !pay || o.payState === pay);
  const sum = (list: OrderRow[]) => list.reduce((s, o) => s + o.total, 0);
  const by = (st: PayState) => base.filter((o) => o.payState === st);
  const cards: [React.ComponentType<{ size?: number }>, string, string, string, string][] = [
    [ShoppingCart, "คำสั่งซื้อทั้งหมด", "฿" + money(sum(base)), base.length + " คำสั่งซื้อ", "violet"],
    [CheckCircle2, "ชำระแล้ว", "฿" + money(sum(by("ชำระแล้ว"))), by("ชำระแล้ว").length + " คำสั่งซื้อ", "green"],
    [Clock, "รอชำระ", "฿" + money(sum(by("รอชำระ"))), by("รอชำระ").length + " คำสั่งซื้อ", "blue"],
    [AlertTriangle, "ยังไม่ชำระ", "฿" + money(sum(by("ยังไม่ชำระ"))), by("ยังไม่ชำระ").length + " คำสั่งซื้อ", "amber"],
  ];
  const perPlatform = data.platforms
    .map((p) => {
      const list = data.orders.filter((o) => o.platformId === p.id && o.status !== "ยกเลิก");
      return { ...p, count: list.length, amount: sum(list) };
    })
    .filter((p) => p.count || p.status === "active");

  return (
    <div className="op">
      <div className="op-bar">
        {writable && (
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> สร้างคำสั่งซื้อ
          </button>
        )}
        <button className="secondary" onClick={() => navigate("sales_packages")}>
          <Package size={15} /> สินค้า & แพ็กเกจ ({data.packages.length})
        </button>
        <button className="secondary" onClick={() => navigate("sales_platforms")}>
          <Settings2 size={15} /> แพลตฟอร์มการขาย ({data.platforms.length})
        </button>
        <button className="secondary" onClick={() => navigate("sales_orders?manage=1")}>
          <FileText size={15} /> จัดการ / แก้ไขรายการ
        </button>
      </div>

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
      </div>

      {/* Sales per platform; click one to see only its orders. */}
      <section className="card op-platforms">
        <h3>ยอดขายตามแพลตฟอร์ม</h3>
        {!perPlatform.length ? (
          <p className="note">
            ยังไม่มีแพลตฟอร์ม —{" "}
            <button className="fc-link" onClick={() => navigate("sales_platforms")}>
              เพิ่มแพลตฟอร์มการขาย
            </button>
          </p>
        ) : (
          <div className="op-platform-list">
            {perPlatform.map((p) => (
              <button key={p.id} className={platform === p.id ? "on" : ""} style={{ ["--pc" as string]: colorOf(p.id) }} onClick={() => setPlatform(platform === p.id ? "" : p.id)}>
                <i />
                <span>
                  <b>{p.name}</b>
                  <small>
                    {p.type}
                    {p.feePercent ? " · ค่าธรรมเนียม " + p.feePercent + "%" : ""}
                  </small>
                </span>
                <em>
                  ฿{money(p.amount)}
                  <small>{p.count} คำสั่งซื้อ</small>
                </em>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card fl-list">
        <header>
          <h3>
            รายการคำสั่งซื้อ
            {platform && <span className="op-chip" style={{ ["--pc" as string]: colorOf(platform) }}>{data.platforms.find((p) => p.id === platform)?.name} ✕</span>}
          </h3>
          <div className="fl-pay-filter" role="group" aria-label="กรองตามสถานะการชำระ">
            {(["", "ชำระแล้ว", "รอชำระ", "ยังไม่ชำระ"] as const).map((st) => (
              <button key={st || "all"} className={(pay === st ? "on " : "") + (st ? payTone[st] : "all")} aria-pressed={pay === st} onClick={() => setPay(st)}>
                {st || "ทั้งหมด"}
                <i>{st ? by(st).length : base.length}</i>
              </button>
            ))}
          </div>
          <label className="fl-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเลขที่ ลูกค้า แพ็กเกจ ผู้ชำระ…" />
          </label>
        </header>
        {platform && (
          <button className="fc-link op-clear" onClick={() => setPlatform("")}>
            แสดงทุกแพลตฟอร์ม
          </button>
        )}
        {!rows.length ? (
          <Empty title={data.orders.length ? "ไม่พบคำสั่งซื้อตามเงื่อนไข" : "ยังไม่มีคำสั่งซื้อ"} description={data.orders.length ? undefined : "กด “สร้างคำสั่งซื้อ” หรือแปลงจากใบเสนอราคาที่ลูกค้าตอบรับ"} />
        ) : (
          <div className="table-wrap">
            <table className="fl-table">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>วันที่สั่ง</th>
                  <th>ผู้สั่ง</th>
                  <th>แพลตฟอร์ม</th>
                  <th>สินค้า / แพ็กเกจ</th>
                  <th className="num">ยอดสุทธิ</th>
                  <th>สถานะการชำระ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className={"fl-row " + payTone[o.payState]} onClick={() => setOpen(o)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(o)}>
                    <td className="fl-docno">{o.code}</td>
                    <td>{displayDate(o.date)}</td>
                    <td className="primary-cell">
                      {o.customer || "—"}
                      {o.payState === "ชำระแล้ว" && o.payerName && <small>ชำระโดย {o.payerName}</small>}
                    </td>
                    <td>{o.platform ? <span className="op-chip" style={{ ["--pc" as string]: colorOf(o.platformId) }}>{o.platform}</span> : "—"}</td>
                    <td className="primary-cell">
                      {o.package || o.items[0]?.name || o.name}
                      <small>{o.items.length ? o.items.map((i) => i.qty + " × ฿" + money(i.price)).join(" · ") : ""}</small>
                    </td>
                    <td className="num strong">฿{money(o.total)}</td>
                    <td>
                      <span className={"fl-pay " + payTone[o.payState]}>{o.payState}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>รวม {rows.length} คำสั่งซื้อ</td>
                  <td className="num strong">฿{money(sum(rows))}</td>
                  <td>ค้างรับ ฿{money(sum(rows.filter((o) => o.payState !== "ชำระแล้ว")))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {open && <OrderDetail order={open} data={data} color={colorOf(open.platformId)} notify={notify} navigate={navigate} reload={load} onClose={() => setOpen(null)} />}
      {creating && (
        <CreateOrder
          data={data}
          onClose={() => setCreating(false)}
          onSaved={async (msg) => {
            setCreating(false);
            notify(msg);
            await load();
          }}
        />
      )}
    </div>
  );
}

type FileInfo = { id: string; name: string; mime: string; role: string };
type Detail = { createdAt: string; recorder: string; files: FileInfo[] };

function OrderDetail({ order: o, data, color, notify, navigate, reload, onClose }: { order: OrderRow; data: OrdersData; color: string; notify: (s: string) => void; navigate: (v: string) => void; reload: () => Promise<void>; onClose: () => void }) {
  const [info, setInfo] = useState<Detail | null>(null),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [form, setForm] = useState({ payerName: o.customer, paidAt: today(), payMethod: o.platform ? "ชำระผ่านแพลตฟอร์ม" : "โอนธนาคาร", payReference: "" }),
    [slip, setSlip] = useState<File | null>(null),
    [view, setView] = useState<FileInfo | null>(null);
  useEffect(() => {
    api(`/ledger/detail?kind=sales_orders&id=${o.id}`)
      .then((d: Detail) => {
        setInfo(d);
        setView((v) => (v && d.files.some((f) => f.id === v.id) ? v : d.files.find((f) => f.role === "slip") || d.files[0] || null));
      })
      .catch(() => setInfo({ createdAt: "", recorder: "", files: [] }));
  }, [o.id, tick]);
  const paid = o.payState === "ชำระแล้ว";
  const slipFile = info?.files.find((f) => f.role === "slip");

  async function attachSlip(file: File) {
    await uploadFile(new File([file], "สลิป - " + file.name, { type: file.type }), "Sales", o.id);
  }
  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    setBusy("pay");
    setError("");
    try {
      await api(`/orders/${o.id}/pay`, { method: "POST", body: form });
      if (slip) await attachSlip(slip);
      notify("บันทึกการชำระแล้ว · เพิ่มในรายรับแล้ว");
      await reload();
      setTick((t) => t + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function setWaiting(payStatus: "ยังไม่ชำระ" | "รอชำระ") {
    setBusy("status");
    try {
      await api(`/orders/${o.id}/status`, { method: "POST", body: { payStatus } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function uploadSlip(file: File) {
    setBusy("slip");
    try {
      await attachSlip(file);
      setTick((t) => t + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const facts: [string, React.ReactNode, React.ComponentType<{ size?: number }>, boolean?][] = [
    ["ผู้สั่ง (ลูกค้า)", o.customer || "—", User, true],
    ["แพลตฟอร์มที่ขาย", o.platform ? <span className="op-chip" style={{ ["--pc" as string]: color }}>{o.platform}{o.platformType ? " · " + o.platformType : ""}</span> : "—", Store, true],
    ["สินค้า / แพ็กเกจ", o.package ? o.package + (o.packageType ? " (" + o.packageType + ")" : "") : "—", Package, true],
    ["วันที่สั่ง", displayDate(o.date), CalendarDays],
    ["กำหนดส่ง", o.deliveryDate ? displayDate(o.deliveryDate) : "—", Truck],
    ["สถานะงาน", o.status || "—", Clock],
    ["อ้างอิงใบเสนอราคา", o.quotation || "—", FileText],
    ["โปรเจกต์", o.project || "—", FolderKanban, true],
  ];
  return (
    <Modal title={`คำสั่งซื้อ ${o.code}${o.customer ? " · " + o.customer : ""}`} onClose={onClose}>
      <div className={"fd fd-" + payTone[o.payState]}>
        <header className="fd-head">
          <div>
            <small>ยอดสุทธิ</small>
            <b>฿{money(o.total)}</b>
            <span>
              {o.package || o.name}
              {o.platform ? " · " + o.platform : ""}
            </span>
          </div>
          <span className={"fl-pay " + payTone[o.payState]}>{o.payState}</span>
        </header>
        <div className="fd-grid">
          <div className="fd-col">
            <section className="fd-card fd-info">
              <h4>ข้อมูลคำสั่งซื้อ</h4>
              <div className="fd-facts">
                {facts.map(([label, value, Icon, wide]) => (
                  <div key={label} className={"fd-fact" + (wide ? " wide" : "") + (value === "—" ? " empty" : "")}>
                    <span className="fd-fact-icon">
                      <Icon size={16} />
                    </span>
                    <span className="fd-fact-text">
                      <small>{label}</small>
                      <b>{value}</b>
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <section className="fd-card fd-sum">
              <h4>รายการสินค้า</h4>
              {o.items.map((i, k) => (
                <div key={k} className="fd-sum-row">
                  <span>
                    {i.name}
                    <small>
                      {i.qty} × ฿{money(i.price)}
                    </small>
                  </span>
                  <b>฿{money(i.qty * i.price)}</b>
                </div>
              ))}
              <div className={"fd-sum-total " + payTone[o.payState]}>
                <span>ยอดสุทธิ (รวมส่วนลด / VAT)</span>
                <b>฿{money(o.total)}</b>
              </div>
            </section>
            {info?.recorder && (
              <section className="fd-card fd-who">
                <h4>ผู้บันทึก</h4>
                <div className="fd-who-row">
                  <span className="fd-avatar">{info.recorder.charAt(0).toUpperCase()}</span>
                  <span>
                    <b>{info.recorder}</b>
                  </span>
                </div>
              </section>
            )}
          </div>

          <div className="fd-col">
            {paid ? (
              <section className="fd-card fd-receipt ok">
                <h4>การชำระเงิน</h4>
                <p className="fd-status ok">
                  <CheckCircle2 size={18} /> ชำระแล้ว
                </p>
                <div className="fd-facts">
                  {(
                    [
                      ["ผู้ชำระ", o.payerName || "—", User, true],
                      ["วันที่ชำระ", o.paidAt ? displayDate(o.paidAt) : "—", CalendarDays],
                      ["ช่องทางชำระ", o.payMethod || "—", CreditCard],
                      ["เลขอ้างอิง", o.payReference || "—", Hash, true],
                    ] as [string, string, React.ComponentType<{ size?: number }>, boolean?][]
                  ).map(([label, value, Icon, wide]) => (
                    <div key={label} className={"fd-fact" + (wide ? " wide" : "") + (value === "—" ? " empty" : "")}>
                      <span className="fd-fact-icon">
                        <Icon size={16} />
                      </span>
                      <span className="fd-fact-text">
                        <small>{label}</small>
                        <b>{value}</b>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="fd-actions op-slip">
                  <span className={"fd-status " + (slipFile ? "ok" : "warn")}>
                    {slipFile ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    {slipFile ? "แนบสลิปแล้ว" : "ยังไม่มีสลิป"}
                  </span>
                  <label className={"secondary as-button" + (busy === "slip" ? " busy" : "")}>
                    <Upload size={14} /> {busy === "slip" ? "กำลังแนบ…" : slipFile ? "แนบเพิ่ม" : "แนบสลิป"}
                    <input type="file" className="sr-only" accept="image/*,application/pdf" disabled={!!busy} onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      ev.target.value = "";
                      if (f) uploadSlip(f);
                    }} />
                  </label>
                  <button className="secondary" onClick={() => navigate("income")}>
                    <Wallet size={14} /> ดูในรายรับ
                  </button>
                </div>
              </section>
            ) : (
              <section className="fd-card fd-receipt warn">
                <h4>การชำระเงิน</h4>
                <div className="op-wait">
                  {(["ยังไม่ชำระ", "รอชำระ"] as const).map((st) => (
                    <button key={st} className={(o.payState === st ? "on " : "") + payTone[st]} disabled={!!busy || !data.canPay} onClick={() => o.payState !== st && setWaiting(st)}>
                      {st}
                    </button>
                  ))}
                </div>
                {data.canPay ? (
                  <form className="op-pay" onSubmit={recordPayment}>
                    <b>บันทึกการชำระ</b>
                    <label>
                      ผู้ชำระ
                      <input required value={form.payerName} onChange={(e) => setForm({ ...form, payerName: e.target.value })} placeholder="ชื่อผู้โอน / บริษัท" />
                    </label>
                    <div className="op-pay-2">
                      <label>
                        วันที่ชำระ
                        <input type="date" required value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />
                      </label>
                      <label>
                        ช่องทาง
                        <select value={form.payMethod} onChange={(e) => setForm({ ...form, payMethod: e.target.value })}>
                          {payMethods.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      เลขอ้างอิง / เลขที่คำสั่งซื้อบนแพลตฟอร์ม
                      <input value={form.payReference} onChange={(e) => setForm({ ...form, payReference: e.target.value })} placeholder="เช่น เลขที่สลิป หรือ Order ID" />
                    </label>
                    <label className={"secondary as-button op-file" + (slip ? " has" : "")}>
                      <Upload size={14} /> {slip ? "สลิป: " + slip.name : "แนบสลิป (ถ้ามี)"}
                      <input type="file" className="sr-only" accept="image/*,application/pdf" onChange={(ev) => setSlip(ev.target.files?.[0] || null)} />
                    </label>
                    <button className="primary" disabled={!!busy}>
                      <CheckCircle2 size={16} /> {busy === "pay" ? "กำลังบันทึก…" : "ยืนยันว่าได้รับเงินแล้ว ฿" + money(o.total)}
                    </button>
                  </form>
                ) : (
                  <p className="note">ต้องมีสิทธิ์ฝ่ายขายและฝ่ายการเงินจึงบันทึกการชำระได้</p>
                )}
              </section>
            )}
            <figure className="fd-preview">
              {!info ? (
                <Loading />
              ) : !view ? (
                <div className="acc-noreceipt">
                  <FileText size={28} />
                  <span>ยังไม่มีสลิปแนบ</span>
                </div>
              ) : view.mime === "application/pdf" ? (
                <object data={"/api/files/" + view.id} type="application/pdf" aria-label={view.name} />
              ) : view.mime.startsWith("image/") ? (
                <a href={"/api/files/" + view.id} target="_blank" rel="noreferrer">
                  <img src={"/api/files/" + view.id} alt={view.name} />
                </a>
              ) : (
                <a href={"/api/files/" + view.id} target="_blank" rel="noreferrer">
                  เปิด {view.name}
                </a>
              )}
              {view && <figcaption>{view.name}</figcaption>}
            </figure>
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>
      <div className="modal-footer">
        <button className="secondary" onClick={() => navigate("sales_orders?manage=1")}>
          แก้ไข / จัดการคำสั่งซื้อ
        </button>
        {["รอดำเนินการ", "กำลังจัดส่ง", "ส่งแล้ว"].includes(o.status) && (
          <button
            className="secondary"
            disabled={!!busy}
            onClick={async () => {
              setBusy("invoice");
              try {
                await api("/convert/sales_orders/" + o.id, { method: "POST", body: { to: "invoices" } });
                notify("ออกใบแจ้งหนี้แล้ว · ดูได้ที่หน้าใบแจ้งหนี้");
                await reload();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            <FileText size={15} /> ออกใบแจ้งหนี้
          </button>
        )}
        <button className="primary" onClick={onClose}>
          ปิด
        </button>
      </div>
    </Modal>
  );
}

/** New order: customer → platform → package (its price fills in) → qty; optionally paid already. */
function CreateOrder({ data, onClose, onSaved }: { data: OrdersData; onClose: () => void; onSaved: (msg: string) => void }) {
  const [v, setV] = useState({
    customerId: "", platformId: "", packageId: "", qty: 1, price: 0, discount: 0, vatMode: "included", date: today(), deliveryDate: "", notes: "",
    payStatus: "ยังไม่ชำระ", payerName: "", paidAt: today(), payMethod: "โอนธนาคาร", payReference: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const packages = data.packages.filter((p) => p.status !== "inactive" && (!v.platformId || !p.platformId || p.platformId === v.platformId));
  const pkg = data.packages.find((p) => p.id === v.packageId);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const sub = Math.max(0, v.qty * v.price - v.discount),
    total = v.vatMode === "excluded" ? Math.round(sub * 107) / 100 : sub;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const name = (pkg?.name || "คำสั่งซื้อ") + (v.qty > 1 ? " × " + v.qty : "");
      const saved: { id: string } = await api("/entities/sales_orders", {
        method: "POST",
        body: {
          data: {
            name, customerId: v.customerId, platformId: v.platformId || undefined, packageId: v.packageId || undefined, date: v.date,
            deliveryDate: v.deliveryDate || undefined, lines: [{ name: pkg?.name || name, qty: v.qty, price: v.price }], discount: v.discount || undefined,
            vatMode: v.vatMode, status: "รอดำเนินการ", payStatus: v.payStatus === "ชำระแล้ว" ? "ยังไม่ชำระ" : v.payStatus, notes: v.notes || undefined,
          },
        },
      });
      if (v.payStatus === "ชำระแล้ว")
        await api(`/orders/${saved.id}/pay`, { method: "POST", body: { payerName: v.payerName || data.customers.find((c) => c.id === v.customerId)?.name || "ลูกค้า", paidAt: v.paidAt, payMethod: v.payMethod, payReference: v.payReference } });
      onSaved(v.payStatus === "ชำระแล้ว" ? "สร้างคำสั่งซื้อและบันทึกการชำระแล้ว" : "สร้างคำสั่งซื้อแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="สร้างคำสั่งซื้อ" onClose={onClose}>
      <form className="op-create" onSubmit={save}>
        <div className="form-grid">
          <label>
            ลูกค้า (ผู้สั่ง) *
            <select required value={v.customerId} onChange={(e) => set({ customerId: e.target.value, payerName: data.customers.find((c) => c.id === e.target.value)?.name || "" })}>
              <option value="">เลือกลูกค้า</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            แพลตฟอร์มที่ขาย
            <select value={v.platformId} onChange={(e) => set({ platformId: e.target.value, packageId: "", price: 0, payMethod: e.target.value ? "ชำระผ่านแพลตฟอร์ม" : "โอนธนาคาร" })}>
              <option value="">ไม่ระบุ / ขายตรง</option>
              {data.platforms.filter((p) => p.status !== "inactive").map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            สินค้า / แพ็กเกจ *
            <select required value={v.packageId} onChange={(e) => set({ packageId: e.target.value, price: data.packages.find((p) => p.id === e.target.value)?.price || 0 })}>
              <option value="">{packages.length ? "เลือกสินค้าหรือแพ็กเกจ" : "ยังไม่มีแพ็กเกจสำหรับแพลตฟอร์มนี้"}</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · ฿{money(p.price)}
                </option>
              ))}
            </select>
          </label>
          <label>
            จำนวน
            <input type="number" min={1} required value={v.qty} onChange={(e) => set({ qty: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label>
            ราคาต่อหน่วย (บาท)
            <input type="number" min={0} step="0.01" required value={v.price} onChange={(e) => set({ price: Number(e.target.value) || 0 })} />
          </label>
          <label>
            ส่วนลด (บาท)
            <input type="number" min={0} step="0.01" value={v.discount} onChange={(e) => set({ discount: Number(e.target.value) || 0 })} />
          </label>
          <label>
            VAT
            <select value={v.vatMode} onChange={(e) => set({ vatMode: e.target.value })}>
              <option value="included">ราคารวม VAT แล้ว</option>
              <option value="excluded">ยังไม่รวม VAT (+7%)</option>
              <option value="none">ไม่มี VAT</option>
            </select>
          </label>
          <label>
            วันที่สั่ง
            <input type="date" required value={v.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
          <label>
            กำหนดส่ง
            <input type="date" value={v.deliveryDate} onChange={(e) => set({ deliveryDate: e.target.value })} />
          </label>
          <label>
            สถานะการชำระ
            <select value={v.payStatus} onChange={(e) => set({ payStatus: e.target.value })}>
              <option>ยังไม่ชำระ</option>
              <option>รอชำระ</option>
              {data.canPay && <option>ชำระแล้ว</option>}
            </select>
          </label>
          {v.payStatus === "ชำระแล้ว" && (
            <>
              <label>
                ผู้ชำระ
                <input value={v.payerName} onChange={(e) => set({ payerName: e.target.value })} />
              </label>
              <label>
                วันที่ชำระ
                <input type="date" value={v.paidAt} onChange={(e) => set({ paidAt: e.target.value })} />
              </label>
              <label>
                ช่องทางชำระ
                <select value={v.payMethod} onChange={(e) => set({ payMethod: e.target.value })}>
                  {payMethods.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                เลขอ้างอิง
                <input value={v.payReference} onChange={(e) => set({ payReference: e.target.value })} />
              </label>
            </>
          )}
          <label className="wide">
            หมายเหตุ
            <textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </div>
        <p className="op-total">
          ยอดสุทธิ <b>฿{money(total)}</b>
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "กำลังบันทึก…" : "สร้างคำสั่งซื้อ"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
