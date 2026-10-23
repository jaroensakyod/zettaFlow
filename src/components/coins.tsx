"use client";
// Coins: wallet badge, top-up by slip, department grid and the Module Store (buy once, no monthly fee).
import { useCallback, useEffect, useState } from "react";
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
  type LucideIcon,
} from "lucide-react";
import type { Context } from "@/lib/types";
import { api, money, displayDate, Empty, Modal } from "./shared";
import { uploadFile } from "./platform";

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
function useCoins() {
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

export function TopupDialog({ ctx, onClose }: { ctx: Context; onClose: () => void }) {
  const { data, reload } = useCoins();
  const [coins, setCoins] = useState(100),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  const pack = data?.packs.find((p) => p.coins === coins);
  const owner = ctx.member.role === "owner";
  const fullPrice = (data?.packs[0] ? data.packs[0].price / data.packs[0].coins : 10) * coins;
  return (
    <Modal title="เติมเหรียญ" onClose={onClose}>
      <div className="coin-balance">
        <span>เหรียญคงเหลือ</span>
        <b>{money(data?.balance ?? 0)} เหรียญ</b>
      </div>
      {!owner ? (
        <p className="note">เฉพาะเจ้าของบริษัทเติมเหรียญได้</p>
      ) : done ? (
        <div className="coin-done">
          <CheckCircle2 size={28} />
          <p>{done}</p>
          <button className="secondary" onClick={() => window.dispatchEvent(new Event("ef:support-open"))}>
            เปิดแชทกับ Admin
          </button>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file || !pack) return setError("แนบสลิปการโอนก่อน");
            setBusy(true);
            setError("");
            try {
              const attachmentId = await uploadFile(file, "Finance");
              const t = await api("/coins/topup", { method: "POST", body: { coins, attachmentId } });
              await api("/support", {
                method: "POST",
                body: { body: `ขอเติม ${coins} เหรียญ (${money(pack.price)} บาท) แนบสลิปแล้ว · Ref ${t.slip_ref}` },
              }).catch(() => {});
              setDone(`ส่งสลิปแล้ว รอ Admin ยืนยัน เหรียญ ${coins} เหรียญจะเข้าบัญชีอัตโนมัติ`);
              reload();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3 className="coin-step">1. เลือกจำนวนเหรียญ</h3>
          <div className="coin-packs">
            {data?.packs.map((p) => {
              const save = Math.round((1 - p.price / ((data.packs[0].price / data.packs[0].coins) * p.coins)) * 100);
              return (
                <button type="button" key={p.coins} className={"coin-pack" + (p.coins === coins ? " active" : "")} onClick={() => setCoins(p.coins)}>
                  <b>{p.coins} เหรียญ</b>
                  <small>{money(p.price)} บาท</small>
                  {save > 0 && <em>ประหยัด {save}%</em>}
                </button>
              );
            })}
          </div>
          <div className="coin-total">
            <span>ยอดที่ต้องโอน</span>
            <b>
              {money(pack?.price ?? 0)} บาท
              {pack && pack.price < fullPrice && <s>{money(fullPrice)}</s>}
            </b>
          </div>
          <h3 className="coin-step">2. โอนเงิน แล้วแนบสลิป</h3>
          <p className="muted">
            ยังไม่มีเลขบัญชีปลายทาง?{" "}
            <button type="button" className="link-button" onClick={() => window.dispatchEvent(new Event("ef:support-open"))}>
              ขอจาก Admin ในแชท
            </button>
          </p>
          <label>
            สลิปการโอน (รูป PNG/JPEG ที่เห็น QR ชัด)
            <input type="file" accept="image/png,image/jpeg" required onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <h3 className="coin-step">3. Admin ยืนยัน เหรียญเข้าบัญชีอัตโนมัติ</h3>
          <p className="muted">ระบบจะส่งข้อความแจ้ง Admin ในแชทให้ด้วย</p>
          <p role="alert" className="form-error">{error}</p>
          <button className="primary full" disabled={busy}>
            {busy ? "กำลังส่ง…" : "ส่งสลิปเติมเหรียญ"}
          </button>
        </form>
      )}
      {owner && !!data?.topups.length && (
        <div className="coin-history">
          <h3>ประวัติการเติม</h3>
          {data.topups.map((t) => (
            <div key={t.id}>
              <span>{t.coins} เหรียญ · ฿{money(t.amount)}</span>
              <small>{displayDate(t.created_at)}</small>
              <em className={"coin-status " + t.status}>{statusText[t.status] || t.status}</em>
            </div>
          ))}
        </div>
      )}
    </Modal>
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
