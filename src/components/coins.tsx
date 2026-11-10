"use client";
// Coins: wallet badge, top-up by slip, department grid and the Module Store (buy once, no monthly fee).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Coins,
  Wallet,
  Megaphone,
  Users,
  Monitor,
  Headset,
  ChartNoAxesCombined,
  Scale,
  Package,
  CalendarDays,
  Store,
  BadgeDollarSign,
  Palette,
  Bot,
  CheckCircle2,
  ShieldCheck,
  Lock,
  Gift,
  Zap,
  Infinity as InfinityIcon,
  Crown,
  QrCode,
  Landmark,
  CreditCard,
  Upload,
  ImageUp,
  Timer,
  Info,
  Flame,
  Check,
  X,
  Sparkles,
  CircleCheck,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import type { Context } from "@/lib/types";
import { api, money, displayDate, Empty, Modal } from "./shared";
import { uploadFile } from "./platform";
import { promptPayPayload, qrMatrix, qrSvgPath } from "@/lib/promptpay";

type StoreModule = { id: string; department: string; name: string; description: string; price_coins: number; features: string[]; view: string; owned: boolean };
type Topup = { id: string; coins: number; amount: number; slip_ref: string; status: string; created_at: string; company?: string };
type StoreData = { balance: number; packs: { coins: number; price: number }[]; modules: StoreModule[]; topups: Topup[] };

const icons: Record<string, LucideIcon> = {
  accounting: Wallet,
  marketing: Megaphone,
  hr: Users,
  it: Monitor,
  customer_service: Headset,
  data: ChartNoAxesCombined,
  legal: Scale,
  inventory: Package,
  event: CalendarDays,
};
const statusText: Record<string, string> = { pending: "รอ Admin ยืนยัน", verified: "เหรียญเข้าแล้ว", rejected: "ไม่ผ่าน" };

/** Shared store state; screens refresh each other through the "ef:coins" event. */
export function useCoins() {
  const [data, setData] = useState<StoreData | null>(null);
  const load = useCallback(() => api("/coins").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    window.addEventListener("ef:coins", load);
    return () => window.removeEventListener("ef:coins", load);
  }, [load]);
  return { data, reload: () => window.dispatchEvent(new Event("ef:coins")) };
}

export function CoinBadge({ ctx }: { ctx: Context }) {
  const { data } = useCoins();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="coin-badge" title="เหรียญของบริษัท · เติมเหรียญ" onClick={() => setOpen(true)}>
        <Coins size={16} />
        <b>{money(data?.balance ?? 0)}</b> เหรียญ
        {ctx.member.role === "owner" && <span>· เติม</span>}
      </button>
      {open && <TopupDialog ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

// Platform payee for top-ups (all optional; without them the dialog asks the owner to get the account from Admin in chat).
const payee = {
  promptPay: process.env.NEXT_PUBLIC_TOPUP_PROMPTPAY_ID || "",
  name: process.env.NEXT_PUBLIC_TOPUP_ACCOUNT_NAME || "",
  bank: process.env.NEXT_PUBLIC_TOPUP_BANK_NAME || "",
  account: process.env.NEXT_PUBLIC_TOPUP_BANK_ACCOUNT || "",
};
const QR_MINUTES = 15;
type PayMethod = "qr" | "bank" | "card";
const methodLabel: Record<PayMethod, string> = { qr: "สแกน QR PromptPay", bank: "โอนเงินผ่านธนาคาร", card: "บัตรเครดิต/เดบิต" };
const openSupport = () => window.dispatchEvent(new Event("ef:support-open"));
const isSlipImage = (f: File) => /^image\/(png|jpe?g)$/.test(f.type);

/** Coin stack art for a pack card: more coins for bigger packs. */
function CoinStack({ count, gift }: { count: number; gift?: boolean }) {
  return (
    <span className="tu-stack" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className="tu-coin" style={{ "--i": i } as React.CSSProperties}>
          E
        </i>
      ))}
      {gift && <Gift className="tu-gift" size={30} />}
    </span>
  );
}

/** PromptPay QR for the exact amount, rendered as SVG (null when no PromptPay ID is configured). */
function PromptPayQr({ amount }: { amount: number }) {
  const qr = useMemo(() => {
    if (!payee.promptPay) return null;
    try {
      const m = qrMatrix(promptPayPayload(payee.promptPay, amount));
      return { path: qrSvgPath(m), size: m.length + 8 };
    } catch {
      return null;
    }
  }, [amount]);
  if (!qr) return null;
  return (
    <svg className="tu-qr-img" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label={`QR PromptPay ${amount} บาท`}>
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#19182b" />
    </svg>
  );
}

export function TopupDialog({ ctx, onClose }: { ctx: Context; onClose: () => void }) {
  const { data, reload } = useCoins();
  const [coins, setCoins] = useState(100),
    [method, setMethod] = useState<PayMethod>("qr"),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [dragging, setDragging] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(""),
    [deadline, setDeadline] = useState(() => Date.now() + QR_MINUTES * 60_000),
    [now, setNow] = useState(() => Date.now());
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  const owner = ctx.member.role === "owner";
  const packs = data?.packs ?? [];
  const pack = packs.find((p) => p.coins === coins);
  // Base rate = smallest pack's price per coin (10 บาท today); bigger packs are cheaper per coin.
  const baseRate = packs[0] ? packs[0].price / packs[0].coins : 10;
  const price = pack?.price ?? 0,
    fullPrice = baseRate * coins,
    discount = Math.max(0, fullPrice - price),
    savePct = (p: { coins: number; price: number }) => Math.round((1 - p.price / (baseRate * p.coins)) * 100);
  const rate = pack ? pack.price / pack.coins : baseRate;
  const left = Math.max(0, deadline - now);
  const expired = left === 0;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const d = dialog.current;
    d?.showModal();
    return () => {
      d?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (method !== "qr" || !payee.promptPay || done) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [method, done]);
  useEffect(() => {
    if (!file) return setPreview("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const newQr = () => {
    setDeadline(Date.now() + QR_MINUTES * 60_000);
    setNow(Date.now());
  };
  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!isSlipImage(f)) return setError("รองรับเฉพาะรูปสลิป PNG, JPG หรือ JPEG");
    setFile(f);
    setError("");
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pack) return;
    if (!file) return setError("แนบสลิปการโอนก่อน");
    setBusy(true);
    setError("");
    try {
      const attachmentId = await uploadFile(file, "Finance");
      const t = await api("/coins/topup", { method: "POST", body: { coins, attachmentId } });
      await api("/support", {
        method: "POST",
        body: { body: `ขอเติม ${coins} เหรียญ (${money(pack.price)} บาท) ผ่าน${methodLabel[method]} แนบสลิปแล้ว · Ref ${t.slip_ref}` },
      }).catch(() => {});
      setDone(`ส่งสลิปแล้ว รอ Admin ยืนยัน เหรียญ ${coins} เหรียญจะเข้าบัญชีอัตโนมัติ`);
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mm = String(Math.floor(left / 60_000)).padStart(2, "0"),
    ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");
  const askAdmin = (
    <button type="button" className="link-button" onClick={openSupport}>
      ขอจาก Admin ในแชท
    </button>
  );

  return (
    <dialog
      ref={dialog}
      className="modal tu-modal"
      aria-label="เติมเหรียญ EliteFlow Coins"
      onCancel={onClose}
      onPaste={(e) => {
        if (!owner || done) return;
        const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith("image/"));
        if (f) {
          e.preventDefault();
          pick(f);
        }
      }}
    >
      <button type="button" className="tu-close icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง">
        <X size={20} />
      </button>
      <form className="tu-grid" onSubmit={submit}>
        <div className="tu-main">
          <header className="tu-hero">
            <div>
              <span className="tu-brand">
                <Sparkles size={14} /> EliteFlow
              </span>
              <h2>เติมเหรียญ EliteFlow Coins</h2>
              <p>ใช้ซื้อระบบเสริม • ธีม • AI Characters • ฟังก์ชันพิเศษ และบริการอื่น ๆ ใน EliteFlow</p>
            </div>
            <span className="tu-hero-art" aria-hidden>
              <span className="tu-bot">
                <Bot size={46} />
              </span>
              <i className="tu-coin tu-float a">E</i>
              <i className="tu-coin tu-float b">E</i>
            </span>
          </header>

          <div className="tu-info">
            <div className="tu-rate">
              <span className="tu-rate-label">
                <i className="tu-coin sm">E</i> อัตราแลกเปลี่ยน
              </span>
              <b>1 เหรียญ (Coin) = {rate.toFixed(2)} บาท</b>
            </div>
            <div className="tu-note">
              <Info size={18} />
              <span>
                <b>ยิ่งเติมมาก ยิ่งคุ้ม</b>
                <small>
                  ราคาปกติ {baseRate.toFixed(2)} บาท/เหรียญ · ใช้ได้ทันที <b>ไม่มีวันหมดอายุ*</b>
                </small>
              </span>
            </div>
          </div>

          <div className="tu-balance">
            <span>เหรียญคงเหลือ</span>
            <b>{money(data?.balance ?? 0)} เหรียญ</b>
          </div>

          {!owner ? (
            <p className="note">เฉพาะเจ้าของบริษัทเติมเหรียญได้</p>
          ) : done ? (
            <div className="coin-done tu-done">
              <CheckCircle2 size={32} />
              <p>{done}</p>
              <button type="button" className="secondary" onClick={openSupport}>
                <MessageCircle size={15} /> เปิดแชทกับ Admin
              </button>
            </div>
          ) : (
            <>
              <h3 className="tu-step">
                <span>1</span> เลือกจำนวนเหรียญที่ต้องการเติม
              </h3>
              <div className="tu-packs" role="radiogroup" aria-label="จำนวนเหรียญ">
                {packs.map((p, i) => {
                  const save = savePct(p);
                  const active = p.coins === coins;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      key={p.coins}
                      className={"tu-pack" + (active ? " active" : "")}
                      onClick={() => {
                        setCoins(p.coins);
                        newQr();
                      }}
                    >
                      <span>
                        <b>{money(p.coins)} เหรียญ</b>
                        <small>{money(p.price)} บาท</small>
                        {save > 0 && (
                          <em>
                            <Flame size={12} /> ประหยัด {save}%
                          </em>
                        )}
                      </span>
                      <CoinStack count={Math.min(i + 1, 4)} gift={i === packs.length - 1 && packs.length > 2} />
                      {active && (
                        <span className="tu-check" aria-hidden>
                          <Check size={14} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="tu-perks">
                <span className="tu-perks-title">
                  <Gift size={18} /> สิทธิพิเศษเมื่อเติมเหรียญ
                </span>
                <span>
                  <Zap size={16} />
                  <span>
                    <b>ใช้งานได้ทันที</b>
                    <small>หลัง Admin ยืนยันการชำระเงิน</small>
                  </span>
                </span>
                <span>
                  <InfinityIcon size={16} />
                  <span>
                    <b>ไม่มีวันหมดอายุ*</b>
                    <small>ใช้ได้จนกว่าจะหมด</small>
                  </span>
                </span>
                <span>
                  <Crown size={16} />
                  <span>
                    <b>ใช้ได้กับทุกบริการ</b>
                    <small>ใน EliteFlow</small>
                  </span>
                </span>
              </div>

              <h3 className="tu-step">
                <span>2</span> โอนเงินแล้วแนบสลิป
              </h3>
              <p className="tu-sub">
                {payee.promptPay || payee.account ? "ชำระตามช่องทางที่เลือกด้านขวา แล้วแนบสลิปที่นี่" : <>ยังไม่มีเลขบัญชีปลายทาง? {askAdmin}</>}
              </p>
              <div
                className={"tu-drop" + (dragging ? " over" : "") + (file ? " has-file" : "")}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pick(e.dataTransfer.files[0]);
                }}
              >
                {preview ? <img src={preview} alt="สลิปที่แนบ" className="tu-thumb" /> : <ImageUp size={26} className="tu-drop-icon" />}
                <span>
                  <b>{file ? file.name : "อัปโหลดสลิปการโอนเงิน"}</b>
                  <small>{file ? "แนบแล้ว · เปลี่ยนไฟล์ได้" : "เลือกรูปภาพ (PNG, JPG, JPEG) ลากมาวาง หรือกด Ctrl+V ที่นี่ · ให้เห็น QR บนสลิปชัด"}</small>
                </span>
                <button type="button" className="secondary tu-pick" onClick={() => input.current?.click()}>
                  <Upload size={15} /> เลือกไฟล์
                </button>
                <input
                  ref={input}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    pick(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>

              <h3 className="tu-step">
                <span>3</span> เมื่อชำระเงินแล้ว
              </h3>
              <p className="tu-sub">Admin จะตรวจสอบการชำระเงิน และเครดิตเหรียญเข้าบัญชีของคุณโดยอัตโนมัติ (ระบบแจ้ง Admin ในแชทให้ด้วย)</p>
              <p className="tu-foot">* เหรียญไม่มีวันหมดอายุตราบที่บัญชีบริษัทยังใช้งานอยู่</p>
            </>
          )}
        </div>

        {owner && !done && (
          <aside className="tu-side">
            <section className="tu-summary">
              <h3>สรุปการเติมเหรียญ</h3>
              <div>
                <span>จำนวนเหรียญ</span>
                <b>{money(coins)} เหรียญ</b>
              </div>
              <hr />
              <div className="muted">
                <span>มูลค่าปกติ</span>
                <s>{money(fullPrice)} บาท</s>
              </div>
              <div className="tu-discount">
                <span>ส่วนลด ({pack ? savePct(pack) : 0}%)</span>
                <b>-{money(discount)} บาท</b>
              </div>
              <div className="tu-net">
                <span>ยอดชำระสุทธิ</span>
                <b>{money(price)} บาท</b>
              </div>
            </section>

            <h3 className="tu-side-title">เลือกช่องทางการชำระเงิน</h3>
            <div className="tu-methods" role="radiogroup" aria-label="ช่องทางการชำระเงิน">
              {(
                [
                  ["qr", QrCode, "สแกน QR Code", "ชำระผ่านแอปธนาคาร (แนะนำ)"],
                  ["bank", Landmark, "โอนเงินผ่านธนาคาร", "(แนบสลิปยืนยัน)"],
                  ["card", CreditCard, "บัตรเครดิต / เดบิต", "เร็วๆ นี้"],
                ] as const
              ).map(([id, Ico, label, sub]) => (
                <label key={id} className={"tu-method" + (method === id ? " active" : "") + (id === "card" ? " disabled" : "")}>
                  <input type="radio" name="tu-method" value={id} checked={method === id} disabled={id === "card"} onChange={() => setMethod(id)} />
                  <Ico size={20} />
                  <span>
                    <b>{label}</b>
                    <small>{sub}</small>
                  </span>
                  {id === "card" && (
                    <span className="tu-cards" aria-label="VISA Mastercard JCB">
                      <i className="visa">VISA</i>
                      <i className="mc" />
                      <i className="jcb">JCB</i>
                    </span>
                  )}
                </label>
              ))}
            </div>

            <section className="tu-pay">
              {method === "qr" &&
                (payee.promptPay ? (
                  <div className="tu-qr">
                    <div className="tu-qr-box">
                      <PromptPayQr amount={price} />
                      {expired && (
                        <button type="button" className="tu-qr-expired" onClick={newQr}>
                          หมดเวลา – สร้าง QR ใหม่
                        </button>
                      )}
                    </div>
                    <div>
                      <b>สแกนเพื่อชำระเงิน</b>
                      {payee.name && <small>{payee.name}</small>}
                      <small>จำนวนเงิน</small>
                      <strong>{price.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</strong>
                      <span className={"tu-timer" + (expired ? " over" : "")}>
                        <Timer size={15} />
                        {expired ? (
                          <span>หมดเวลา</span>
                        ) : (
                          <span>
                            กรุณาชำระภายใน <b>{mm}:{ss} นาที</b>
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="tu-ask">
                    <QrCode size={18} /> ยังไม่เปิดใช้ QR อัตโนมัติ — ขอเลขบัญชี/QR จาก Admin ในแชท {askAdmin}
                  </p>
                ))}
              {method === "bank" &&
                (payee.account ? (
                  <dl className="tu-bank">
                    {payee.bank && (
                      <>
                        <dt>ธนาคาร</dt>
                        <dd>{payee.bank}</dd>
                      </>
                    )}
                    <dt>เลขบัญชี</dt>
                    <dd>
                      <b>{payee.account}</b>
                    </dd>
                    {payee.name && (
                      <>
                        <dt>ชื่อบัญชี</dt>
                        <dd>{payee.name}</dd>
                      </>
                    )}
                    <dt>ยอดโอน</dt>
                    <dd>
                      <b>{money(price)} บาท</b>
                    </dd>
                  </dl>
                ) : (
                  <p className="tu-ask">
                    <Landmark size={18} /> ขอเลขบัญชีปลายทางจาก Admin ในแชท {askAdmin}
                  </p>
                ))}
            </section>

            <p role="alert" className="form-error">
              {error}
            </p>
            <button className="primary full tu-submit" disabled={busy || !pack}>
              <CircleCheck size={18} /> {busy ? "กำลังส่ง…" : file ? "ยืนยันการเติมเหรียญ" : "แนบสลิปแล้วยืนยันการเติมเหรียญ"}
            </button>
          </aside>
        )}
      </form>

      {owner && !!data?.topups.length && (
        <div className="coin-history tu-history">
          <h3>ประวัติการเติม</h3>
          {data.topups.map((t) => (
            <div key={t.id}>
              <span>
                {t.coins} เหรียญ · ฿{money(t.amount)}
              </span>
              <small>{displayDate(t.created_at)}</small>
              <em className={"coin-status " + t.status}>{statusText[t.status] || t.status}</em>
            </div>
          ))}
        </div>
      )}
    </dialog>
  );
}

/** "แผนกทั้งหมด": each department card opens its tools once bought, otherwise points to the store. */
export function Departments({ ctx, navigate }: { ctx: Context; navigate: (v: string) => void }) {
  const { data } = useCoins();
  if (!data) return null;
  const none = !data.modules.some((m) => m.owned);
  return (
    <>
      <div className="dept-grid">
        {data.modules.map((m) => {
          const Ico = icons[m.id] || Store;
          return (
            <button key={m.id} className={"dept-card" + (m.owned ? " owned" : "")} onClick={() => navigate(m.owned ? m.view : "store")}>
              <span className={"dept-icon dept-" + m.id}>
                <Ico size={18} />
              </span>
              <span>
                <b>{m.name.replace(/^ระบบ\s*/, "")}</b>
                <small>{m.description}</small>
                <em>{m.owned ? "เปิดใช้งานแล้ว" : "ยังไม่ได้เปิดใช้"}</em>
              </span>
            </button>
          );
        })}
      </div>
      {none && (
        <div className="dept-banner">
          <div>
            <b>ยังไม่ได้เปิดใช้ระบบไหนเลย</b>
            <small>เลือกซื้อระบบของแผนกที่ต้องการได้ใน Module Store ซื้อครั้งเดียว ใช้ได้ตลอด</small>
          </div>
          <button className="primary" onClick={() => navigate("store")}>
            ไปที่ Module Store
          </button>
        </div>
      )}
      <h2 className="dept-more">เพิ่มเติม</h2>
      <div className="dept-grid small">
        {(
          [
            ["store", "Module Store", "ซื้อระบบด้วยเหรียญ", Store, true],
            ["pricing", "แพ็กเกจ", "ระบบ Subscription", BadgeDollarSign, true],
            ["", "Theme Store", "ธีมตกแต่งระบบ", Palette, false],
            ["", "AI Assistant", "ผู้ช่วย AI 3D", Bot, false],
          ] as const
        ).map(([view, label, sub, Ico, live]) => (
          <button key={label} className="dept-card" disabled={!live} onClick={() => live && navigate(view)}>
            <span className="dept-icon">
              <Ico size={18} />
            </span>
            <span>
              <b>{label}</b>
              <small>{sub}</small>
              {!live && <em>เร็วๆ นี้</em>}
            </span>
          </button>
        ))}
      </div>
      {ctx.member.role !== "owner" && <p className="note">เจ้าของบริษัทเป็นผู้ซื้อระบบเพิ่มได้</p>}
    </>
  );
}

export function CoinStore({ ctx, notify, navigate }: { ctx: Context; notify: (s: string) => void; navigate: (v: string) => void }) {
  const { data, reload } = useCoins();
  const [tab, setTab] = useState<"all" | "new" | "owned">("all"),
    [sort, setSort] = useState("ordinal"),
    [confirm, setConfirm] = useState<StoreModule | null>(null),
    [topup, setTopup] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!data) return null;
  const owned = data.modules.filter((m) => m.owned).length;
  const list = data.modules
    .filter((m) => (tab === "all" ? true : tab === "owned" ? m.owned : !m.owned))
    .sort((a, b) => (sort === "price" ? a.price_coins - b.price_coins : 0));
  return (
    <>
      <div className="store-head card">
        <div>
          <h2>Module Store</h2>
          <p className="muted">เลือกระบบงานที่ต้องการ ซื้อด้วยเหรียญ</p>
          <b>ซื้อครั้งเดียวใช้ได้ตลอด ไม่มีรายเดือน</b>
        </div>
        <div className="store-stat">
          <small>ระบบที่เปิดใช้</small>
          <b>
            {owned} <span>จาก {data.modules.length}</span>
          </b>
        </div>
        <div className="store-stat coin">
          <small>เหรียญคงเหลือ</small>
          <b>{money(data.balance)}</b>
        </div>
        <button className="primary" onClick={() => setTopup(true)}>
          + เติมเหรียญ
        </button>
      </div>
      <div className="section-actions">
        <div className="row-actions">
          {(
            [
              ["all", `ทั้งหมด ${data.modules.length}`],
              ["new", `ยังไม่ได้ซื้อ ${data.modules.length - owned}`],
              ["owned", `ซื้อแล้ว ${owned}`],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={tab === k ? "primary" : "secondary"} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <label className="inline-select">
          เรียง
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="ordinal">ทุกหมวด</option>
            <option value="price">ราคาน้อย → มาก</option>
          </select>
        </label>
      </div>
      {!list.length && <Empty title="ไม่มีระบบในหมวดนี้" />}
      <div className="template-grid">
        {list.map((m) => {
          const Ico = icons[m.id] || Store;
          return (
            <article className="card store-card module-card" key={m.id}>
              <span className={"dept-icon dept-" + m.id}>
                <Ico size={18} />
              </span>
              <small className="muted">{m.department}</small>
              <h2>{m.name}</h2>
              <p>{m.description}</p>
              <ul>
                {m.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <div className="module-foot">
                <b>{m.price_coins} เหรียญ</b>
                {m.owned ? (
                  <button className="secondary" onClick={() => navigate(m.view)}>
                    <CheckCircle2 size={15} /> เปิดใช้งาน
                  </button>
                ) : (
                  <button className="primary" disabled={ctx.member.role !== "owner"} title={ctx.member.role !== "owner" ? "เฉพาะเจ้าของบริษัท" : ""} onClick={() => { setError(""); setConfirm(m); }}>
                    {ctx.member.role !== "owner" && <Lock size={14} />} ซื้อระบบนี้
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {confirm && (
        <Modal title={"ซื้อ" + confirm.name} onClose={() => setConfirm(null)}>
          <p>
            ใช้ <b>{confirm.price_coins} เหรียญ</b> จากที่มี {money(data.balance)} เหรียญ · ซื้อครั้งเดียวใช้ได้ตลอด
          </p>
          {data.balance < confirm.price_coins ? (
            <>
              <p className="form-error">เหรียญไม่พอ ต้องเติมอีก {confirm.price_coins - data.balance} เหรียญ</p>
              <button className="primary full" onClick={() => { setConfirm(null); setTopup(true); }}>
                เติมเหรียญ
              </button>
            </>
          ) : (
            <>
              <p role="alert" className="form-error">{error}</p>
              <button
                className="primary full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/coins/buy/" + confirm.id, { method: "POST", body: {} });
                    notify("เปิดใช้" + confirm.name + "แล้ว");
                    setConfirm(null);
                    reload();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                ยืนยันซื้อ {confirm.price_coins} เหรียญ
              </button>
            </>
          )}
        </Modal>
      )}
      {topup && <TopupDialog ctx={ctx} onClose={() => setTopup(false)} />}
    </>
  );
}

/** Admin Console: confirm coin top-ups. */
export function AdminTopups({ notify }: { notify: (s: string) => void }) {
  const [rows, setRows] = useState<Topup[]>([]);
  const load = useCallback(() => api("/coins/admin").then(setRows).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section className="z-card">
      <h2>
        <ShieldCheck size={16} /> คำขอเติมเหรียญรอยืนยัน
      </h2>
      {!rows.length && <p className="note">ไม่มีคำขอเติมเหรียญ</p>}
      {rows.map((r) => (
        <div className="section-actions" key={r.id}>
          <span>
            {r.company} · {r.coins} เหรียญ · ฿{money(r.amount)} · Ref {r.slip_ref} · {displayDate(r.created_at)}
          </span>
          <div className="row-actions">
            {(["verified", "rejected"] as const).map((status) => (
              <button
                key={status}
                className={status === "verified" ? "primary" : "secondary"}
                onClick={async () => {
                  try {
                    await api("/coins/admin/" + r.id, { method: "POST", body: { status } });
                    notify(status === "verified" ? "เติมเหรียญให้ลูกค้าแล้ว" : "ปฏิเสธรายการแล้ว");
                    await load();
                    window.dispatchEvent(new Event("ef:coins"));
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                {status === "verified" ? "ยืนยันยอดเข้า" : "ไม่ผ่าน"}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
