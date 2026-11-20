"use client";
// หลังบ้าน phase 3: App Shop prices and the ad manager (see admin-shop.ts). Prices are edited inline; a row turns
// purple while it has unsaved changes. Purchases charge the saved price immediately.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Ban, Check, Coins, Eye, Megaphone, MousePointerClick, Palette, Pause, Play, Puzzle, RotateCcw, Save, ShoppingBag, Smile, Store, Undo2 } from "lucide-react";
import { api, Loading } from "./shared";
import type { AdminAd, AdminAds, AdminShop, AdPackRow, ShopRow } from "@/lib/admin-shop";

const num = (n: number) => n.toLocaleString("th-TH");
const thDate = (s: string) => new Date(s).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
type Kind = "system" | "module" | "character" | "theme";
const kinds: { key: Kind; label: string; icon: typeof Store; c: [string, string] }[] = [
  { key: "system", label: "ระบบเสริม (รายเดือน)", icon: Puzzle, c: ["#34d399", "#059669"] },
  { key: "module", label: "ระบบแผนก (ซื้อครั้งเดียว)", icon: Store, c: ["#38bdf8", "#2563eb"] },
  { key: "character", label: "ผู้ช่วย AI (ตัวละคร)", icon: Smile, c: ["#f472b6", "#db2777"] },
  { key: "theme", label: "ธีมสี", icon: Palette, c: ["#c084fc", "#7c3aed"] },
];

function useData<T>(path: string, tick: number) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    api(path)
      .then((d) => live && (setData(d), setError("")))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [path, tick, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

// ---------- App Shop · ราคา ----------
export function ShopPage({ tick, notify }: { tick: number; notify: (s: string) => void }) {
  const { data, error, reload } = useData<AdminShop>("/admin/shop", tick),
    [kind, setKind] = useState<Kind>("system");
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <Loading />;
  const list = data.items.filter((x) => x.kind === kind),
    onSale = data.items.filter((x) => x.active && x.price > 0).length,
    buyers = data.items.reduce((a, x) => a + x.buyers, 0),
    changed = data.items.filter((x) => x.price !== x.base).length;
  return (
    <div className="ad-stack">
      <section className="ad-kpis">
        <Stat c="#059669" icon={ShoppingBag} label="รายการที่เปิดขาย" value={num(onSale)} sub={`ทั้งหมด ${data.items.length} รายการ`} />
        <Stat c="#2563eb" icon={Check} label="ยอดซื้อรวม" value={num(buyers)} sub="ครั้งที่บริษัทซื้อ" />
        <Stat c="#7c3aed" icon={Coins} label="ราคาที่ปรับจากค่าเริ่มต้น" value={num(changed)} sub="รายการ" />
        <Stat c="#d97706" icon={Megaphone} label="แพ็กโฆษณา" value={num(data.adPackages.length)} sub="ตั้งราคาในหน้าตำแหน่งโฆษณา" />
      </section>
      <section className="card ad-card">
        <div className="ad-tabs">
          {kinds.map((k) => (
            <button key={k.key} className={kind === k.key ? "on" : ""} style={{ "--g": `linear-gradient(135deg, ${k.c[0]}, ${k.c[1]})` } as CSSProperties} onClick={() => setKind(k.key)}>
              <i style={{ background: `linear-gradient(135deg, ${k.c[0]}, ${k.c[1]})` }}>
                <k.icon size={14} />
              </i>
              {k.label}
              <small>{data.items.filter((x) => x.kind === k.key).length}</small>
            </button>
          ))}
        </div>
        <p className="ad-hint" style={{ margin: "4px 0 12px" }}>
          แก้ราคาแล้วกดบันทึก ลูกค้าเห็นราคาใหม่และจ่ายตามราคานี้ทันที · ปิดการขายแล้วบริษัทที่ซื้อไปแล้วยังใช้ต่อได้
        </p>
        <div className="ad-prices">
          {list.map((x) => (
            <PriceRow key={x.id} row={x} notify={notify} saved={reload} />
          ))}
        </div>
      </section>
    </div>
  );
}
function PriceRow({ row, notify, saved }: { row: ShopRow; notify: (s: string) => void; saved: () => void }) {
  const [price, setPrice] = useState(String(row.price)),
    [active, setActive] = useState(row.active),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setPrice(String(row.price));
    setActive(row.active);
  }, [row.price, row.active]);
  const dirty = Number(price) !== row.price || active !== row.active,
    k = kinds.find((x) => x.key === row.kind) || kinds[0];
  const save = async () => {
    setBusy(true);
    try {
      await api("/admin/shop", { method: "POST", body: { kind: row.kind, id: row.id, price: Number(price), active } });
      notify(`บันทึกราคา ${row.name} แล้ว`);
      saved();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={"ad-price" + (dirty ? " dirty" : "") + (active ? "" : " off")}>
      <i style={{ background: `linear-gradient(135deg, ${k.c[0]}, ${k.c[1]})` }}>
        <k.icon size={16} />
      </i>
      <span className="ad-price-name">
        <b>{row.name}</b>
        <small>{row.group}</small>
      </span>
      <span className="ad-price-buyers">
        <b>{num(row.buyers)}</b>
        <small>บริษัทซื้อ</small>
      </span>
      <label className="ad-price-input">
        <Coins size={14} />
        <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 7))} aria-label={"ราคา " + row.name} />
        <small>เหรียญ{row.period === "month" ? " / เดือน" : ""}</small>
      </label>
      {row.price !== row.base && !dirty && <em className="ad-was">เดิม {num(row.base)}</em>}
      <button type="button" className={"ad-switch" + (active ? " on" : "")} onClick={() => setActive(!active)} aria-pressed={active} title={active ? "กำลังขาย · กดเพื่อปิดการขาย" : "ปิดการขาย · กดเพื่อเปิดขาย"}>
        <span />
        {active ? "เปิดขาย" : "ปิดขาย"}
      </button>
      <span className="ad-price-act">
        {dirty ? (
          <>
            <button className="ad-btn ghost" onClick={() => (setPrice(String(row.price)), setActive(row.active))} title="ยกเลิกการแก้ไข" aria-label="ยกเลิกการแก้ไข">
              <Undo2 size={14} />
            </button>
            <button className="ad-btn primary" onClick={save} disabled={busy || price === ""}>
              <Save size={14} /> {busy ? "กำลังบันทึก" : "บันทึก"}
            </button>
          </>
        ) : row.price !== row.base ? (
          <button className="ad-btn ghost" onClick={() => setPrice(String(row.base))} title="กลับไปราคาเริ่มต้น">
            <RotateCcw size={14} /> ราคาเริ่มต้น
          </button>
        ) : null}
      </span>
    </div>
  );
}

function Stat({ c, icon: Icon, label, value, sub }: { c: string; icon: typeof Store; label: string; value: string; sub?: string }) {
  return (
    <div className="ad-kpi static" style={{ "--c": c } as CSSProperties}>
      <span className="ad-kpi-h">
        <i>
          <Icon size={16} />
        </i>
        {label}
      </span>
      <span className="ad-kpi-v">
        <b>{value}</b>
      </span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

// ---------- ตำแหน่งโฆษณา ----------
const toneColor: Record<string, [string, string]> = { violet: ["#a855f7", "#6d28d9"], pink: ["#f472b6", "#db2777"], blue: ["#38bdf8", "#2563eb"], green: ["#4ade80", "#16a34a"] };
export function AdsPage({ tick, notify, open }: { tick: number; notify: (s: string) => void; open: (id: string) => void }) {
  const ads = useData<AdminAds>("/admin/ads", tick),
    shop = useData<AdminShop>("/admin/shop", tick),
    [show, setShow] = useState<"live" | "paused" | "ended" | "all">("live");
  const now = Date.now(),
    list = useMemo(
      () =>
        (ads.data?.ads || []).filter((a) => {
          const ended = a.status === "removed" || Date.parse(a.ends_at) <= now;
          return show === "all" || (show === "ended" ? ended : !ended && a.status === (show === "live" ? "active" : "paused"));
        }),
      [ads.data, show, now],
    );
  if (ads.error) return <p className="form-error">{ads.error}</p>;
  if (!ads.data) return <Loading />;
  const t = ads.data.totals;
  const setStatus = async (a: AdminAd, status: AdminAd["status"]) => {
    if (status === "removed" && !confirm(`นำโฆษณา “${a.title}” ของ ${a.company} ออก?\nโฆษณาจะหยุดแสดงทันทีและเจ้าของเปิดกลับเองไม่ได้`)) return;
    try {
      await api("/admin/ads/" + a.id, { method: "POST", body: { status } });
      notify(status === "removed" ? "นำโฆษณาออกแล้ว" : status === "paused" ? "หยุดโฆษณาชั่วคราวแล้ว" : "เปิดโฆษณาอีกครั้งแล้ว");
      ads.reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const pc = ["linear-gradient(135deg, #fb923c, #ea580c)", "linear-gradient(135deg, #f472b6, #db2777)", "linear-gradient(135deg, #a855f7, #6d28d9)"];
  return (
    <div className="ad-stack">
      <section className="ad-kpis">
        <Stat c="#16a34a" icon={Play} label="กำลังแสดง" value={num(t.live)} sub={`หยุดชั่วคราว ${t.paused}`} />
        <Stat c="#d97706" icon={Coins} label="เหรียญจากโฆษณา 30 วัน" value={num(t.coins30)} sub="เหรียญที่ลูกค้าจ่าย" />
        <Stat c="#2563eb" icon={Eye} label="ยอดเห็นทั้งหมด" value={num(t.views)} sub={`คลิก ${num(t.clicks)}`} />
        <Stat c="#db2777" icon={MousePointerClick} label="อัตราคลิก (CTR)" value={t.views ? ((t.clicks / t.views) * 100).toFixed(1) + "%" : "—"} sub="คลิก ÷ เห็น" />
      </section>

      <section className="card ad-card">
        <h3 className="ad-h">
          <Megaphone size={17} /> ตำแหน่งที่โฆษณาแสดง
        </h3>
        <div className="ad-places">
          {ads.data.placements.map((p, i) => (
            <div key={p.key}>
              <i style={{ background: pc[i % 3] }}>{i + 1}</i>
              <span>
                <b>{p.name}</b>
                <small>{p.where}</small>
              </span>
              <em>{p.showing ? `แสดงอยู่ ${p.showing}` : "ว่าง"}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="card ad-card">
        <h3 className="ad-h">
          <Coins size={17} /> ราคาแพ็กโฆษณา
        </h3>
        {shop.data ? (
          <div className="ad-packs">
            {shop.data.adPackages.map((p) => (
              <PackEditor key={p.id} p={p} notify={notify} saved={shop.reload} />
            ))}
          </div>
        ) : (
          <Loading />
        )}
      </section>

      <section className="card ad-card">
        <h3 className="ad-h">
          <Megaphone size={17} /> โฆษณาทั้งหมด
          <span className="ad-seg">
            {(
              [
                ["live", "กำลังแสดง"],
                ["paused", "หยุดชั่วคราว"],
                ["ended", "จบแล้ว / นำออก"],
                ["all", "ทั้งหมด"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>
                {l}
              </button>
            ))}
          </span>
        </h3>
        {list.length ? (
          <div className="ad-adlist">
            {list.map((a) => {
              const ended = a.status === "removed" || Date.parse(a.ends_at) <= now,
                ctr = a.views ? ((a.clicks / a.views) * 100).toFixed(1) : "0.0",
                c = toneColor[a.tone] || toneColor.violet;
              return (
                <div key={a.id} className={"ad-ad" + (ended ? " off" : "")}>
                  <span className="ad-ad-swatch" style={{ background: `linear-gradient(135deg, ${c[0]}, ${c[1]})` }}>
                    <Megaphone size={16} />
                  </span>
                  <span className="ad-ad-main">
                    <b>{a.title}</b>
                    <button className="ad-link" onClick={() => open(a.company_id)}>
                      {a.company}
                    </button>
                    <small>
                      {thDate(a.starts_at)} – {thDate(a.ends_at)} · {a.coins} เหรียญ{a.target_industry ? " · เจาะกลุ่ม " + a.target_industry : ""}
                    </small>
                  </span>
                  <span className="ad-ad-stats">
                    <span>
                      <b>{num(a.views)}</b>
                      <small>เห็น</small>
                    </span>
                    <span>
                      <b>{num(a.clicks)}</b>
                      <small>คลิก</small>
                    </span>
                    <span>
                      <b>{ctr}%</b>
                      <small>CTR</small>
                    </span>
                  </span>
                  <span className={"ad-role " + (a.status === "removed" ? "r-off" : ended ? "" : a.status === "active" ? "r-manager" : "r-pending")}>
                    {a.status === "removed" ? "นำออกแล้ว" : ended ? "หมดเวลา" : a.status === "active" ? "กำลังแสดง" : "หยุดชั่วคราว"}
                  </span>
                  {!ended && (
                    <span className="ad-ad-act">
                      {a.status === "active" ? (
                        <button className="ad-btn ghost" onClick={() => setStatus(a, "paused")}>
                          <Pause size={14} /> หยุด
                        </button>
                      ) : (
                        <button className="ad-btn ghost" onClick={() => setStatus(a, "active")}>
                          <Play size={14} /> เปิด
                        </button>
                      )}
                      <button className="ad-btn ghost danger" onClick={() => setStatus(a, "removed")}>
                        <Ban size={14} /> นำออก
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="ad-empty">ไม่มีโฆษณาในหมวดนี้</p>
        )}
      </section>
    </div>
  );
}
function PackEditor({ p, notify, saved }: { p: AdPackRow; notify: (s: string) => void; saved: () => void }) {
  const [name, setName] = useState(p.name),
    [days, setDays] = useState(String(p.days)),
    [coins, setCoins] = useState(String(p.coins)),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(p.name);
    setDays(String(p.days));
    setCoins(String(p.coins));
  }, [p.name, p.days, p.coins]);
  const dirty = name !== p.name || Number(days) !== p.days || Number(coins) !== p.coins,
    perDay = Number(days) ? Math.round((Number(coins) / Number(days)) * 10) / 10 : 0;
  const save = async () => {
    setBusy(true);
    try {
      await api("/admin/shop", { method: "POST", body: { kind: "adpack", id: p.id, price: Number(coins), days: Number(days), name: name.trim() } });
      notify("บันทึกแพ็กโฆษณา " + name + " แล้ว");
      saved();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={"ad-pack" + (dirty ? " dirty" : "")}>
      <label>
        <small>ชื่อแพ็ก</small>
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="two">
        <label>
          <small>จำนวนวัน</small>
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 3))} />
        </label>
        <label>
          <small>ราคา (เหรียญ)</small>
          <input inputMode="numeric" value={coins} onChange={(e) => setCoins(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </label>
      </div>
      <p>
        ≈ {perDay} เหรียญ / วัน · ขายไปแล้ว <b>{num(p.sold)}</b> ครั้ง
      </p>
      <button className="ad-btn primary wide" onClick={save} disabled={!dirty || busy || !name.trim() || !Number(days) || !Number(coins)}>
        <Save size={14} /> {busy ? "กำลังบันทึก" : dirty ? "บันทึกราคา" : "ยังไม่ได้แก้ไข"}
      </button>
    </div>
  );
}
