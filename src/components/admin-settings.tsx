"use client";
// หลังบ้าน phase 4: ความปลอดภัย (failed sign-ins, share links being guessed, admin action log, sensitive changes in
// customer companies) and ตั้งค่าแพลตฟอร์ม (package prices and limits, add-ons, coin packs, AI allowances, admin team,
// LINE alerts). See admin-settings.ts. Edited cards turn purple until saved, like App Shop prices.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  Bell,
  BellRing,
  Bot,
  Building2,
  Coins,
  Crown,
  Eye,
  History,
  Infinity as InfinityIcon,
  KeyRound,
  Link2,
  Lock,
  Package,
  Puzzle,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Undo2,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { api, Loading } from "./shared";
import type { AdminSecurity, AdminSettings } from "@/lib/admin-settings";
import type { Alerts, Catalog } from "@/lib/platform-settings";
import type { PlanNumbers } from "@/lib/billing";

const num = (n: number) => n.toLocaleString("th-TH");
const ago = (s: string) => {
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  if (m < 1) return "เมื่อสักครู่";
  if (m < 60) return m + " นาทีที่แล้ว";
  if (m < 1440) return Math.floor(m / 60) + " ชม.ที่แล้ว";
  return new Date(s).toLocaleDateString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};
const grad = (c: [string, string]) => `linear-gradient(135deg, ${c[0]}, ${c[1]})`;
const planColor: Record<string, [string, string]> = {
  free: ["#94a3b8", "#64748b"],
  starter: ["#38bdf8", "#2563eb"],
  growth: ["#a855f7", "#6d28d9"],
  business: ["#fb923c", "#ea580c"],
  enterprise: ["#f472b6", "#db2777"],
};

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
function Stat({ c, icon: Icon, label, value, sub, warn }: { c: string; icon: typeof Lock; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={"ad-kpi static" + (warn ? " warn" : "")} style={{ "--c": c } as CSSProperties}>
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
async function post(body: unknown, notify: (s: string) => void, ok: string) {
  try {
    const r = await api("/admin/settings", { method: "POST", body });
    notify(ok);
    return r as { ok: boolean; sent?: string };
  } catch (e) {
    notify((e as Error).message);
    return null;
  }
}

// ---------- ความปลอดภัย ----------
const actionLabel: Record<string, [string, string]> = {
  member_invited: ["เชิญสมาชิกใหม่", "#2563eb"],
  member_updated: ["เปลี่ยนสิทธิ์/ระงับสมาชิก", "#d97706"],
  share_created: ["สร้างลิงก์แชร์", "#7c3aed"],
  share_revoked: ["ยกเลิกลิงก์แชร์", "#64748b"],
  sample_data_cleared: ["ล้างข้อมูลตัวอย่าง", "#dc2626"],
  line_group_unlinked: ["ยกเลิกเชื่อมกลุ่ม LINE", "#dc2626"],
  line_approver_removed: ["นำผู้อนุมัติ LINE ออก", "#d97706"],
  company_updated: ["แก้ข้อมูลบริษัท", "#0891b2"],
  support_view_started: ["ทีมงานเปิดดูในมุมมองลูกค้า", "#ea580c"],
  support_access_ended: ["ลูกค้าหยุดการเข้าดูของทีมงาน", "#64748b"],
};
const adminAction = (a: string): [string, string, typeof Lock] => {
  if (a === "grant") return ["มอบแพ็กเกจ", "#16a34a", Package];
  if (a === "revoke") return ["ยกเลิกแพ็กเกจ", "#dc2626", Package];
  if (a === "support_view") return ["ดูในมุมมองลูกค้า", "#ea580c", Eye];
  if (a === "price") return ["ราคา App Shop", "#059669", Coins];
  if (a.startsWith("ad_")) return ["โฆษณา", "#ea580c", Bell];
  if (a.startsWith("setting_team")) return ["ทีมแอดมิน", "#7c3aed", UserCog];
  if (a.startsWith("setting_alerts") || a === "alert_test") return ["แจ้งเตือน LINE", "#06c755", BellRing];
  if (a.startsWith("setting_")) return ["ตั้งค่าแพลตฟอร์ม", "#2563eb", KeyRound];
  return [a, "#64748b", History];
};
export function SecurityPage({ tick, open, go }: { tick: number; open: (id: string) => void; go: (section: string) => void }) {
  const { data, error } = useData<AdminSecurity>("/admin/security", tick),
    [who, setWho] = useState(""),
    [q, setQ] = useState("");
  const log = useMemo(
    () => (data?.adminLog || []).filter((a) => (!who || a.by === who) && (!q || (a.text + a.by).toLowerCase().includes(q.toLowerCase()))),
    [data, who, q],
  );
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <Loading />;
  const t = data.totals,
    max = Math.max(1, ...data.hourly),
    admins = [...new Set(data.adminLog.map((a) => a.by).filter(Boolean))];
  return (
    <div className="ad-stack">
      <section className="ad-kpis">
        <Stat c="#dc2626" icon={KeyRound} label="เข้าสู่ระบบผิด 24 ชม." value={num(t.fails24)} sub={`7 วัน ${num(t.fails7)} ครั้ง`} />
        <Stat c="#d97706" icon={ShieldAlert} label="บัญชีน่าสงสัย" value={num(t.flagged)} sub="ผิดตั้งแต่ 5 ครั้งใน 24 ชม." warn={t.flagged > 0} />
        <Stat c="#7c3aed" icon={Link2} label="ลองเปิดลิงก์แชร์ 24 ชม." value={num(t.shareAttempts)} sub={`บล็อกอยู่ ${t.blockedLinks} ลิงก์ · ${t.blockedClients} เครื่อง`} warn={t.blockedLinks > 0} />
        <Stat c="#2563eb" icon={History} label="การกระทำของแอดมิน 7 วัน" value={num(t.adminActions7)} sub={`สมาชิกที่ถูกระงับ ${num(t.disabledUsers)} คน`} />
      </section>

      <section className="ad-sec-top">
        <div className="card ad-card">
          <h3 className="ad-h">
            <KeyRound size={17} /> เข้าสู่ระบบผิดรายชั่วโมง (24 ชม.)
          </h3>
          <div className="ad-hours" role="img" aria-label={`เข้าสู่ระบบผิด ${t.fails24} ครั้งใน 24 ชั่วโมง`}>
            {data.hourly.map((n, i) => (
              <span key={i} title={`${23 - i === 0 ? "ชั่วโมงนี้" : 23 - i + " ชม.ที่แล้ว"} · ${n} ครั้ง`}>
                <i style={{ height: (n / max) * 100 + "%", background: n >= 5 ? "linear-gradient(180deg,#f87171,#dc2626)" : "linear-gradient(180deg,#c4b5fd,#7c3aed)" }} />
              </span>
            ))}
          </div>
          <div className="ad-hours-axis">
            <small>24 ชม.ก่อน</small>
            <small>12 ชม.</small>
            <small>ตอนนี้</small>
          </div>
        </div>
        <div className="card ad-card">
          <h3 className="ad-h">
            <ShieldCheck size={17} /> ใครเข้าหลังบ้านได้
            <button onClick={() => go("settings")}>จัดการทีม</button>
          </h3>
          <div className="ad-team-mini">
            {data.team.map((m) => (
              <span key={m.email} className={"ad-trole " + m.role}>
                {m.role === "owner" ? <Crown size={13} /> : m.role === "admin" ? <UserCog size={13} /> : <Eye size={13} />}
                <b>{m.name || m.email}</b>
                <small>{m.role === "owner" ? "เจ้าของระบบ" : m.role === "admin" ? "ผู้ดูแล" : "ดูอย่างเดียว"}</small>
              </span>
            ))}
          </div>
          <p className="ad-hint">ลิงก์แชร์ถูกบล็อกอัตโนมัติเมื่อใส่รหัสผิด 5 ครั้งใน 15 นาทีจากเครื่องเดียว หรือ 20 ครั้งรวมทุกเครื่อง</p>
        </div>
      </section>

      <section className="card ad-card">
        <h3 className="ad-h">
          <KeyRound size={17} /> เข้าสู่ระบบผิด (7 วัน)
        </h3>
        {data.logins.length ? (
          <div className="ad-sec-list">
            {data.logins.map((l) => (
              <div key={l.email} className={"ad-sec-row" + (l.count24 >= 5 ? " hot" : "")}>
                <i>{l.count24 >= 5 ? <AlertTriangle size={16} /> : <KeyRound size={16} />}</i>
                <span className="ad-sec-main">
                  <b>{l.email}</b>
                  <small>
                    {l.company || "ไม่พบบัญชีในระบบ"} · {l.reason}
                  </small>
                </span>
                <span className="ad-sec-n">
                  <b>{num(l.count24)}</b>
                  <small>24 ชม.</small>
                </span>
                <span className="ad-sec-n">
                  <b>{num(l.count)}</b>
                  <small>7 วัน</small>
                </span>
                <span className="ad-sec-n">
                  <b>{num(l.ips)}</b>
                  <small>เครือข่าย</small>
                </span>
                <small className="ad-sec-when">{ago(l.last)}</small>
                {l.count24 >= 5 && <em className="ad-flag">น่าสงสัย</em>}
              </div>
            ))}
          </div>
        ) : (
          <p className="ad-empty">ไม่มีการเข้าสู่ระบบผิดใน 7 วัน</p>
        )}
      </section>

      <section className="card ad-card">
        <h3 className="ad-h">
          <Link2 size={17} /> ลิงก์แชร์ที่มีคนลองเดารหัส (24 ชม.)
        </h3>
        {data.shares.length ? (
          <div className="ad-sec-list">
            {data.shares.map((s) => (
              <div key={s.token} className={"ad-sec-row" + (s.blocked ? " hot" : "")}>
                <i>
                  <Link2 size={16} />
                </i>
                <span className="ad-sec-main">
                  <b>{s.label}</b>
                  <small>
                    {s.company} · ลิงก์ …{s.token}
                    {s.revoked ? " · ยกเลิกแล้ว" : ""}
                  </small>
                </span>
                <span className="ad-sec-n">
                  <b>{num(s.attempts)}</b>
                  <small>ครั้ง</small>
                </span>
                <span className="ad-sec-n">
                  <b>{num(s.clients)}</b>
                  <small>เครื่อง</small>
                </span>
                <small className="ad-sec-when">{ago(s.last)}</small>
                {s.blocked ? <em className="ad-flag">บล็อกอยู่</em> : <em className="ad-flag calm">เฝ้าดู</em>}
              </div>
            ))}
          </div>
        ) : (
          <p className="ad-empty">ไม่มีใครลองเดารหัสลิงก์แชร์ใน 24 ชม.</p>
        )}
      </section>

      <section className="card ad-card">
        <h3 className="ad-h">
          <History size={17} /> ประวัติการกระทำของแอดมิน
        </h3>
        <div className="ad-filters" style={{ marginBottom: 10 }}>
          <label className="ad-search ad-sec-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาการกระทำ" aria-label="ค้นหาการกระทำ" />
          </label>
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="แอดมิน">
            <option value="">แอดมินทุกคน</option>
            {admins.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        {log.length ? (
          <div className="ad-sec-list">
            {log.slice(0, 80).map((a, i) => {
              const [label, c, Icon] = adminAction(a.action);
              return (
                <div key={i} className="ad-sec-row log">
                  <i style={{ background: c }}>
                    <Icon size={15} />
                  </i>
                  <span className="ad-sec-main">
                    <b>{a.text}</b>
                    <small>
                      <em style={{ color: c }}>{label}</em> · {a.by || "ระบบ"}
                    </small>
                  </span>
                  <small className="ad-sec-when">{ago(a.at)}</small>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="ad-empty">ยังไม่มีการกระทำของแอดมิน{q || who ? "ที่ตรงกับตัวกรอง" : ""}</p>
        )}
      </section>

      <section className="card ad-card">
        <h3 className="ad-h">
          <Building2 size={17} /> การเปลี่ยนแปลงสำคัญในบริษัทลูกค้า (7 วัน)
        </h3>
        <p className="ad-hint" style={{ margin: "-4px 0 10px" }}>
          เห็นเฉพาะชนิดของการกระทำ ไม่เห็นข้อมูลธุรกิจของลูกค้า
        </p>
        {data.customer.length ? (
          <div className="ad-sec-list">
            {data.customer.map((a, i) => {
              const [label, c] = actionLabel[a.action] || [a.action, "#64748b"];
              return (
                <button key={i} className="ad-sec-row log" onClick={() => open(a.company_id)}>
                  <i style={{ background: c }}>
                    <Building2 size={15} />
                  </i>
                  <span className="ad-sec-main">
                    <b>{a.company}</b>
                    <small>
                      <em style={{ color: c }}>{label}</em>
                      {a.target && !/^[0-9a-f-]{36}$/i.test(a.target) ? " · " + a.target : ""}
                    </small>
                  </span>
                  <small className="ad-sec-when">{ago(a.at)}</small>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="ad-empty">ไม่มีการเปลี่ยนแปลงสำคัญใน 7 วัน</p>
        )}
      </section>
    </div>
  );
}

// ---------- ตั้งค่าแพลตฟอร์ม ----------
type Tab = "plans" | "addons" | "coins" | "ai" | "team" | "alerts";
const tabs: { key: Tab; label: string; icon: typeof Lock; c: [string, string] }[] = [
  { key: "plans", label: "แพ็กเกจ", icon: Package, c: ["#a855f7", "#6d28d9"] },
  { key: "addons", label: "Add-on รายเดือน", icon: Puzzle, c: ["#34d399", "#059669"] },
  { key: "coins", label: "แพ็กเหรียญ", icon: Coins, c: ["#fbbf24", "#d97706"] },
  { key: "ai", label: "ลิมิตฟรี / ทดลองใช้", icon: Bot, c: ["#38bdf8", "#2563eb"] },
  { key: "team", label: "ทีมแอดมิน", icon: Users, c: ["#f472b6", "#db2777"] },
  { key: "alerts", label: "แจ้งเตือน LINE", icon: BellRing, c: ["#4ade80", "#06c755"] },
];
export function SettingsPage({ tick, notify }: { tick: number; notify: (s: string) => void }) {
  const { data, error, reload } = useData<AdminSettings>("/admin/settings", tick),
    [tab, setTab] = useState<Tab>("plans");
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <Loading />;
  const readOnly = data.role === "viewer";
  return (
    <div className="ad-stack">
      {readOnly && (
        <p className="ad-readonly">
          <Eye size={15} /> บัญชีของคุณดูได้อย่างเดียว แก้ไขการตั้งค่าไม่ได้
        </p>
      )}
      <section className="card ad-card">
        <div className="ad-tabs">
          {tabs.map((k) => (
            <button key={k.key} className={tab === k.key ? "on" : ""} style={{ "--g": grad(k.c) } as CSSProperties} onClick={() => setTab(k.key)}>
              <i style={{ background: grad(k.c) }}>
                <k.icon size={14} />
              </i>
              {k.label}
            </button>
          ))}
        </div>
      </section>
      <fieldset className="ad-fs" disabled={readOnly}>
        {tab === "plans" && <PlansTab data={data} notify={notify} saved={reload} />}
        {tab === "addons" && <AddonsTab c={data.catalog} d={data.defaults} notify={notify} saved={reload} />}
        {tab === "coins" && <CoinsTab c={data.catalog} d={data.defaults} notify={notify} saved={reload} />}
        {tab === "ai" && <AiTab c={data.catalog} d={data.defaults} notify={notify} saved={reload} />}
        {tab === "team" && <TeamTab data={data} notify={notify} saved={reload} />}
        {tab === "alerts" && <AlertsTab data={data} notify={notify} saved={reload} />}
      </fieldset>
    </div>
  );
}

const limitFields: { key: keyof PlanNumbers; label: string; unit: string }[] = [
  { key: "documents", label: "AI ประมวลผล", unit: "รายการ/เดือน" },
  { key: "users", label: "ผู้ใช้", unit: "คน" },
  { key: "line_groups", label: "กลุ่ม LINE", unit: "กลุ่ม" },
  { key: "workflows", label: "AI Workflows", unit: "ฟอร์ม" },
  { key: "voice_minutes", label: "ถอดเสียง", unit: "นาที/เดือน" },
  { key: "storage_gb", label: "พื้นที่จัดเก็บ", unit: "GB" },
];
type PlanRow = Catalog["plans"][number];
function PlansTab({ data, notify, saved }: { data: AdminSettings; notify: (s: string) => void; saved: () => void }) {
  return (
    <section className="card ad-card">
      <h3 className="ad-h">
        <Package size={17} /> ราคาและลิมิตของแต่ละแพ็กเกจ
      </h3>
      <p className="ad-hint" style={{ margin: "-4px 0 14px" }}>
        ราคายังไม่รวม VAT · รายปีปกติ = 10 เดือน (ฟรี 2 เดือน) · ราคาใหม่ใช้กับการจ่ายครั้งถัดไป บริษัทที่จ่ายแล้วใช้ต่อจนครบรอบ · ลิมิตใหม่มีผลทันที
      </p>
      <div className="ad-plan-eds">
        {data.catalog.plans.map((p) => (
          <PlanEditor key={p.id} row={p} base={data.defaults.plans.find((x) => x.id === p.id) || p} notify={notify} saved={saved} />
        ))}
      </div>
    </section>
  );
}
const same = (a: PlanRow, b: PlanRow) => (["monthly", "yearly", ...limitFields.map((f) => f.key)] as (keyof PlanNumbers)[]).every((k) => a[k] === b[k]);
function PlanEditor({ row, base, notify, saved }: { row: PlanRow; base: PlanRow; notify: (s: string) => void; saved: () => void }) {
  const [v, setV] = useState(row),
    [busy, setBusy] = useState(false);
  useEffect(() => setV(row), [row]);
  const dirty = !same(v, row),
    free = row.id === "free",
    c = planColor[row.id] || planColor.free;
  const set = (k: keyof PlanNumbers, x: number | null) => setV((o) => ({ ...o, [k]: x }));
  const save = async () => {
    setBusy(true);
    const { name: _n, ...n } = v;
    if (await post({ section: "plan", ...n }, notify, `บันทึกแพ็กเกจ ${row.name} แล้ว`)) saved();
    setBusy(false);
  };
  return (
    <div className={"ad-plan-ed" + (dirty ? " dirty" : "")}>
      <header style={{ background: grad(c) }}>
        <b>{row.name}</b>
        <small>{free ? "ใช้ฟรีตลอด" : `฿${num(v.monthly)}/เดือน`}</small>
      </header>
      {!free && (
        <div className="ad-two">
          <Money label="ราคา/เดือน" value={v.monthly} base={base.monthly} onChange={(x) => set("monthly", x ?? 0)} />
          <Money label="ราคา/ปี" value={v.yearly} base={base.yearly} onChange={(x) => set("yearly", x ?? 0)} hint={v.monthly ? `= ${(v.yearly / v.monthly).toFixed(1)} เดือน` : ""} />
        </div>
      )}
      <div className="ad-limits">
        {limitFields.map((f) => (
          <Limit key={f.key} label={f.label} unit={f.unit} value={v[f.key] as number | null} base={base[f.key] as number | null} onChange={(x) => set(f.key, x)} />
        ))}
      </div>
      <footer>
        {dirty ? (
          <>
            <button className="ad-btn ghost" onClick={() => setV(row)} title="ยกเลิกการแก้ไข" aria-label="ยกเลิกการแก้ไข">
              <Undo2 size={14} />
            </button>
            <button className="ad-btn primary" onClick={save} disabled={busy}>
              <Save size={14} /> {busy ? "กำลังบันทึก" : "บันทึก"}
            </button>
          </>
        ) : !same(row, base) ? (
          <button className="ad-btn ghost" onClick={() => setV({ ...base, name: row.name })}>
            <RotateCcw size={14} /> ค่าเริ่มต้น
          </button>
        ) : (
          <small className="ad-muted">ค่าเริ่มต้น</small>
        )}
      </footer>
    </div>
  );
}
function Money({ label, value, base, onChange, hint, unit = "฿" }: { label: string; value: number; base?: number; onChange: (x: number | null) => void; hint?: string; unit?: string }) {
  return (
    <label className="ad-num">
      <small>{label}</small>
      <span>
        <em>{unit}</em>
        <input inputMode="decimal" value={String(value)} onChange={(e) => onChange(Number(e.target.value.replace(/[^\d.]/g, "").slice(0, 9)) || 0)} aria-label={label} />
      </span>
      {(hint || (base !== undefined && base !== value)) && <i>{hint || `เดิม ${num(base!)}`}</i>}
    </label>
  );
}
function Limit({ label, unit, value, base, onChange }: { label: string; unit: string; value: number | null; base: number | null; onChange: (x: number | null) => void }) {
  const none = value === null;
  return (
    <label className={"ad-num" + (none ? " none" : "")}>
      <small>{label}</small>
      <span>
        <input inputMode="numeric" value={none ? "" : String(value)} placeholder="ไม่จำกัด" onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "").slice(0, 8)))} aria-label={label} />
        <button type="button" className={none ? "on" : ""} onClick={() => onChange(none ? base ?? 0 : null)} title={none ? "กำหนดจำนวน" : "ไม่จำกัด"} aria-label={label + (none ? " กำหนดจำนวน" : " ไม่จำกัด")}>
          <InfinityIcon size={14} />
        </button>
      </span>
      <i>{base !== value ? `เดิม ${base === null ? "ไม่จำกัด" : num(base)} · ${unit}` : unit}</i>
    </label>
  );
}

/** One editable number with save / undo, for add-ons, coin packs and allowances. */
function NumRow({ icon, title, sub, value, base, unit, onSave, prefix }: { icon: ReactNode; title: string; sub?: string; value: number; base: number; unit: string; prefix?: string; onSave: (x: number) => Promise<unknown> }) {
  const [v, setV] = useState(String(value)),
    [busy, setBusy] = useState(false);
  useEffect(() => setV(String(value)), [value]);
  const dirty = Number(v) !== value;
  return (
    <div className={"ad-numrow" + (dirty ? " dirty" : "")}>
      <i>{icon}</i>
      <span className="ad-price-name">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      <label className="ad-price-input">
        {prefix && <em>{prefix}</em>}
        <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))} aria-label={title} />
        <small>{unit}</small>
      </label>
      <span className="ad-price-act">
        {dirty ? (
          <>
            <button className="ad-btn ghost" onClick={() => setV(String(value))} aria-label="ยกเลิกการแก้ไข" title="ยกเลิกการแก้ไข">
              <Undo2 size={14} />
            </button>
            <button
              className="ad-btn primary"
              disabled={busy || v === ""}
              onClick={async () => {
                setBusy(true);
                await onSave(Number(v));
                setBusy(false);
              }}
            >
              <Save size={14} /> {busy ? "กำลังบันทึก" : "บันทึก"}
            </button>
          </>
        ) : value !== base ? (
          <button className="ad-btn ghost" onClick={() => setV(String(base))} title="กลับไปค่าเริ่มต้น">
            <RotateCcw size={14} /> เดิม {num(base)}
          </button>
        ) : null}
      </span>
    </div>
  );
}
function AddonsTab({ c, d, notify, saved }: { c: Catalog; d: Catalog; notify: (s: string) => void; saved: () => void }) {
  return (
    <section className="card ad-card">
      <h3 className="ad-h">
        <Puzzle size={17} /> ราคา Add-on รายเดือน (บาท)
      </h3>
      <p className="ad-hint" style={{ margin: "-4px 0 12px" }}>
        ลูกค้าเลือกได้ตอนจ่ายแพ็กเกจ · รายปีคิด 10 เดือน · ยังไม่รวม VAT
      </p>
      <div className="ad-prices">
        {c.addons.map((a) => (
          <NumRow
            key={a.id}
            icon={<Puzzle size={16} />}
            title={a.name}
            sub={a.per_unit ? "คิดต่อผู้ใช้ที่เพิ่ม" : "ต่อบริษัท"}
            value={a.price}
            base={d.addons.find((x) => x.id === a.id)?.price ?? a.price}
            prefix="฿"
            unit={a.per_unit ? "/ผู้ใช้/เดือน" : "/เดือน"}
            onSave={async (price) => (await post({ section: "addon", id: a.id, price }, notify, `บันทึกราคา ${a.name} แล้ว`)) && saved()}
          />
        ))}
      </div>
    </section>
  );
}
function CoinsTab({ c, d, notify, saved }: { c: Catalog; d: Catalog; notify: (s: string) => void; saved: () => void }) {
  return (
    <section className="card ad-card">
      <h3 className="ad-h">
        <Coins size={17} /> แพ็กเหรียญที่ลูกค้าเติม
      </h3>
      <p className="ad-hint" style={{ margin: "-4px 0 12px" }}>
        ลูกค้าโอนตามราคานี้แล้วแนบสลิป · เหรียญใช้ซื้อระบบใน App Shop และลงโฆษณา
      </p>
      <div className="ad-prices">
        {c.coinPacks.map((p) => (
          <NumRow
            key={p.coins}
            icon={<b className="ad-coin">{p.coins}</b>}
            title={`${num(p.coins)} เหรียญ`}
            sub={`เหรียญละ ฿${(p.price / p.coins).toFixed(2)}`}
            value={p.price}
            base={d.coinPacks.find((x) => x.coins === p.coins)?.price ?? p.price}
            prefix="฿"
            unit="ต่อแพ็ก"
            onSave={async (price) => (await post({ section: "coinpack", coins: p.coins, price }, notify, `บันทึกราคาแพ็ก ${p.coins} เหรียญแล้ว`)) && saved()}
          />
        ))}
      </div>
    </section>
  );
}
function AiTab({ c, d, notify, saved }: { c: Catalog; d: Catalog; notify: (s: string) => void; saved: () => void }) {
  const block = (section: "freeAi" | "trial", title: string, hint: string, color: [string, string]) => (
    <section className="card ad-card">
      <h3 className="ad-h">
        <Bot size={17} /> {title}
      </h3>
      <p className="ad-hint" style={{ margin: "-4px 0 12px" }}>
        {hint}
      </p>
      <div className="ad-prices">
        {c[section].map((x) => (
          <NumRow
            key={x.resource}
            icon={<Bot size={16} style={{ color: "#fff" }} />}
            title={x.label}
            value={x.amount}
            base={d[section].find((y) => y.resource === x.resource)?.amount ?? x.amount}
            unit={section === "trial" ? "ตลอดช่วงทดลอง" : "ต่อเดือน"}
            onSave={async (amount) => (await post({ section, resource: x.resource, amount }, notify, `บันทึก${x.label}แล้ว`)) && saved()}
          />
        ))}
      </div>
      <style>{`.ad-ai-${section} .ad-numrow > i { background: ${grad(color)}; }`}</style>
    </section>
  );
  return (
    <div className="ad-stack">
      <div className="ad-ai-freeAi">{block("freeAi", "AI ของแพ็กเกจ Free (ต่อเดือน)", "บริษัทที่ใช้ฟรีใช้ AI ได้เท่านี้ต่อเดือน ครบแล้วระบบชวนอัปเกรด", ["#94a3b8", "#64748b"])}</div>
      <div className="ad-ai-trial">{block("trial", "ลิมิตช่วงทดลองใช้", "ใช้แทนลิมิตของแพ็กเกจระหว่างทดลองใช้ เพื่อไม่ให้ใช้เกินกว่าที่ควร", ["#38bdf8", "#2563eb"])}</div>
    </div>
  );
}
function TeamTab({ data, notify, saved }: { data: AdminSettings; notify: (s: string) => void; saved: () => void }) {
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [role, setRole] = useState<"admin" | "viewer">("viewer"),
    [busy, setBusy] = useState(false);
  const owner = data.role === "owner";
  const change = async (body: { email: string; role: "admin" | "viewer" | "remove"; name?: string }, ok: string) => {
    setBusy(true);
    const r = await post({ section: "team", ...body }, notify, ok);
    setBusy(false);
    if (r) saved();
    return r;
  };
  return (
    <section className="card ad-card">
      <h3 className="ad-h">
        <Users size={17} /> ทีมแอดมิน
      </h3>
      <div className="ad-roles">
        <span>
          <Crown size={14} /> <b>เจ้าของระบบ</b> ทำได้ทุกอย่าง รวมถึงจัดการทีม (ตั้งใน PLATFORM_ADMIN_EMAILS บนเซิร์ฟเวอร์)
        </span>
        <span>
          <UserCog size={14} /> <b>ผู้ดูแล</b> แก้ราคา มอบแพ็กเกจ ตรวจสลิป ตอบลูกค้า จัดการโฆษณา
        </span>
        <span>
          <Eye size={14} /> <b>ดูอย่างเดียว</b> เปิดดูหลังบ้านได้ทุกหน้า แต่แก้ไขอะไรไม่ได้
        </span>
      </div>
      <div className="ad-sec-list" style={{ marginTop: 12 }}>
        {data.owners.map((e) => (
          <div key={e} className="ad-sec-row log">
            <i style={{ background: grad(["#fbbf24", "#d97706"]) }}>
              <Crown size={15} />
            </i>
            <span className="ad-sec-main">
              <b>{e}</b>
              <small>เจ้าของระบบ{e === data.me ? " · คุณ" : ""}</small>
            </span>
            <Lock size={14} className="ad-muted" />
          </div>
        ))}
        {data.catalog.team.map((m) => (
          <div key={m.email} className="ad-sec-row log">
            <i style={{ background: m.role === "admin" ? grad(["#a855f7", "#6d28d9"]) : grad(["#94a3b8", "#64748b"]) }}>{m.role === "admin" ? <UserCog size={15} /> : <Eye size={15} />}</i>
            <span className="ad-sec-main">
              <b>{m.name || m.email}</b>
              <small>
                {m.name ? m.email + " · " : ""}เพิ่มโดย {m.added_by || "—"}
              </small>
            </span>
            <select value={m.role} disabled={!owner || busy} onChange={(e) => change({ email: m.email, role: e.target.value as "admin" | "viewer" }, "เปลี่ยนสิทธิ์แล้ว")} aria-label={"สิทธิ์ของ " + m.email}>
              <option value="admin">ผู้ดูแล</option>
              <option value="viewer">ดูอย่างเดียว</option>
            </select>
            <button className="ad-btn danger" disabled={!owner || busy} onClick={() => confirm(`นำ ${m.email} ออกจากทีมแอดมิน?`) && change({ email: m.email, role: "remove" }, "นำออกจากทีมแล้ว")} aria-label={"นำ " + m.email + " ออก"}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {owner ? (
        <form
          className="ad-team-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await change({ email, role, name }, `เพิ่ม ${email} เข้าทีมแล้ว`)) (setEmail(""), setName(""));
          }}
        >
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="อีเมลที่ใช้เข้าสู่ระบบ" aria-label="อีเมล" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ (ไม่บังคับ)" aria-label="ชื่อ" maxLength={60} />
          <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "viewer")} aria-label="สิทธิ์">
            <option value="viewer">ดูอย่างเดียว</option>
            <option value="admin">ผู้ดูแล</option>
          </select>
          <button className="ad-btn primary" disabled={busy || !email}>
            <UserPlus size={14} /> เพิ่มเข้าทีม
          </button>
        </form>
      ) : (
        <p className="ad-hint">เฉพาะเจ้าของระบบที่เพิ่มหรือนำคนออกจากทีมได้</p>
      )}
      <p className="ad-hint">คนที่เพิ่มต้องมีบัญชี EliteFlow ด้วยอีเมลนี้ แล้วเปิด /workspace/admin ได้ภายใน 1 นาที</p>
    </section>
  );
}
const alertEvents: { key: keyof Alerts["events"]; label: string; sub: string; icon: typeof Lock }[] = [
  { key: "signup", label: "บริษัทใหม่สมัคร", sub: "ทุกครั้งที่มีคนสร้างบริษัท", icon: Building2 },
  { key: "payment", label: "การชำระแพ็กเกจ", sub: "สลิปรอตรวจ และจ่ายสำเร็จอัตโนมัติ", icon: Package },
  { key: "topup", label: "เติมเหรียญรอตรวจ", sub: "ลูกค้าแนบสลิปเติมเหรียญ", icon: Coins },
  { key: "support", label: "ข้อความถึงทีมงาน", sub: "แชทซัพพอร์ต แจ้งปัญหา ข้อเสนอแนะ", icon: Bell },
  { key: "health", label: "ระบบมีปัญหา", sub: "สรุปวันละครั้ง เมื่อมีงาน AI ล้มเหลวหรือส่ง LINE ไม่ได้", icon: AlertTriangle },
];
function AlertsTab({ data, notify, saved }: { data: AdminSettings; notify: (s: string) => void; saved: () => void }) {
  const [v, setV] = useState<Alerts>(data.catalog.alerts),
    [busy, setBusy] = useState(false);
  useEffect(() => setV(data.catalog.alerts), [data.catalog.alerts]);
  const dirty = JSON.stringify(v) !== JSON.stringify(data.catalog.alerts);
  const save = async () => {
    setBusy(true);
    if (await post({ section: "alerts", ...v }, notify, "บันทึกการแจ้งเตือนแล้ว")) saved();
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    const r = await post({ section: "testAlert" }, notify, "ส่งข้อความทดสอบแล้ว ดูใน LINE ได้เลย");
    if (r?.sent === "demo") notify("โหมดตัวอย่าง: บันทึกการทดสอบแล้ว (ไม่ได้ส่ง LINE จริง)");
    setBusy(false);
  };
  const known = data.lineTargets.some((t) => t.id === v.to);
  return (
    <section className={"card ad-card ad-alerts" + (dirty ? " dirty" : "")}>
      <h3 className="ad-h">
        <BellRing size={17} /> แจ้งเตือนทีมงานทาง LINE
      </h3>
      {!data.lineReady && (
        <p className="ad-readonly warn">
          <AlertTriangle size={15} /> เซิร์ฟเวอร์ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN จึงยังส่งแจ้งเตือนไม่ได้
        </p>
      )}
      <div className="ad-field">
        <span>ส่งไปที่</span>
        {data.lineTargets.length > 0 && (
          <div className="ad-chips">
            {data.lineTargets.map((t) => (
              <button key={t.id} type="button" className={v.to === t.id ? "on" : ""} style={{ "--pc": "#06c755" } as CSSProperties} onClick={() => setV({ ...v, to: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <input value={v.to} onChange={(e) => setV({ ...v, to: e.target.value.trim() })} placeholder="LINE ID ของกลุ่ม (C…) หรือผู้ใช้ (U…) · เว้นว่าง = ปิดแจ้งเตือน" aria-label="LINE ID" spellCheck={false} />
        <small className="ad-muted">
          {known ? "กลุ่ม LINE ของบริษัท EliteFlow" : "เชิญบอท EliteFlow เข้ากลุ่ม LINE ของทีมงานแล้วเชื่อมกับบริษัทของแพลตฟอร์ม กลุ่มจะขึ้นให้เลือกด้านบน"}
        </small>
      </div>
      <div className="ad-events">
        {alertEvents.map((e) => (
          <button key={e.key} type="button" className={"ad-event" + (v.events[e.key] ? " on" : "")} onClick={() => setV({ ...v, events: { ...v.events, [e.key]: !v.events[e.key] } })} aria-pressed={v.events[e.key]}>
            <i>
              <e.icon size={16} />
            </i>
            <span>
              <b>{e.label}</b>
              <small>{e.sub}</small>
            </span>
            <span className={"ad-switch" + (v.events[e.key] ? " on" : "")}>
              <span />
            </span>
          </button>
        ))}
      </div>
      <div className="ad-actions">
        <button className="ad-btn ghost" onClick={test} disabled={busy || dirty || !data.catalog.alerts.to} title={dirty ? "บันทึกก่อนแล้วค่อยทดสอบ" : ""}>
          <Send size={14} /> ส่งทดสอบ
        </button>
        {dirty && (
          <button className="ad-btn ghost" onClick={() => setV(data.catalog.alerts)}>
            <Undo2 size={14} /> ยกเลิก
          </button>
        )}
        <button className="ad-btn primary" onClick={save} disabled={busy || !dirty}>
          <Save size={14} /> บันทึก
        </button>
      </div>
    </section>
  );
}
