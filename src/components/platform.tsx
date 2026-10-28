"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  LayoutGrid,
  Link2,
  Save,
  Trash2,
  Copy,
  Upload,
  ShieldCheck,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { api, Empty, Loading, Modal, money, displayDate, PasswordInput } from "./shared";
import { Donut } from "./dashboard-charts";
import type { Context, Role } from "@/lib/types";
import type { Widget, Layout } from "@/lib/platform";
import { addons, planPrice, type Plan, type Subscription, type Usage } from "@/lib/billing";

const roleNames: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  viewer: "Viewer",
};

export function WidgetView({ w }: { w: Widget }) {
  return (
    <>
      <small>{w.name}</small>
      <b>{w.label}</b>
      {w.type === "number" ? (
        <>
          <strong>{money(w.total)}</strong>
          <small>{w.count} รายการที่อนุมัติ</small>
        </>
      ) : (
        <Donut
          title="รายการ"
          items={Object.entries(w.buckets || {}).map(([label, value]) => ({
            label,
            value: Number(value),
          }))}
        />
      )}
    </>
  );
}

/** Auto-generated dashboard from Data Templates: drag to reorder, hide, per-widget role visibility, share links. */
export function WidgetBoard({
  ctx,
  notify,
}: {
  ctx: Context;
  notify: (s: string) => void;
}) {
  const owner = ctx.member.role === "owner";
  const [widgets, setWidgets] = useState<Widget[]>([]),
    [layout, setLayout] = useState<Layout>({ order: [], hidden: [], roles: {} }),
    [editing, setEditing] = useState(false),
    [drag, setDrag] = useState<string | null>(null),
    [sharing, setSharing] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = useCallback(
    async (edit = false) => {
      try {
        const d = await api("/dashboard" + (edit ? "?edit=true" : ""));
        setWidgets(d.widgets);
        setLayout(d.layout);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (loading) return <Loading />;
  if (!widgets.length && !editing) return null;
  const reorder = (from: string, to: string) => {
    const keys = widgets.map((w) => w.key);
    keys.splice(keys.indexOf(to), 0, ...keys.splice(keys.indexOf(from), 1));
    setWidgets(keys.map((k) => widgets.find((w) => w.key === k)!));
  };
  async function save() {
    try {
      await api("/dashboard", {
        method: "PATCH",
        body: { ...layout, order: widgets.map((w) => w.key) },
      });
      setEditing(false);
      await load();
      notify("บันทึกรูปแบบ Dashboard แล้ว");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="z-card">
      <div className="section-actions">
        <h2>Data Templates · Auto-Generated Dashboard</h2>
        {owner && (
          <div className="row-actions">
            {editing ? (
              <button className="primary" onClick={save}>
                <Save size={14} /> บันทึกรูปแบบ
              </button>
            ) : (
              <>
                <button className="secondary" onClick={() => setSharing(true)}>
                  <Link2 size={14} /> แชร์ Dashboard
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setEditing(true);
                    load(true);
                  }}
                >
                  <LayoutGrid size={14} /> จัดวาง Widget
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      {editing && (
        <p className="note">
          ลากการ์ดเพื่อสลับตำแหน่ง · ซ่อน/แสดง · เลือกบทบาทที่มองเห็น (ไม่เลือก = ทุกคนที่มีสิทธิ์แผนก)
        </p>
      )}
      <div className="widget-board">
        {widgets.map((w) => {
          const hidden = layout.hidden.includes(w.key);
          const roles = layout.roles[w.key] || [];
          return (
            <article
              key={w.key}
              className={
                "widget-card" +
                (editing ? " editing" : "") +
                (hidden ? " hidden-widget" : "")
              }
              draggable={editing}
              onDragStart={() => setDrag(w.key)}
              onDragOver={(e) => editing && e.preventDefault()}
              onDrop={() => {
                if (drag && drag !== w.key) reorder(drag, w.key);
                setDrag(null);
              }}
            >
              <WidgetView w={w} />
              {editing && (
                <div className="widget-tools">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={hidden ? "แสดง Widget" : "ซ่อน Widget"}
                    onClick={() =>
                      setLayout((l) => ({
                        ...l,
                        hidden: hidden
                          ? l.hidden.filter((k) => k !== w.key)
                          : [...l.hidden, w.key],
                      }))
                    }
                  >
                    {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  {(["manager", "staff", "viewer"] as Role[]).map((r) => (
                    <label key={r}>
                      <input
                        type="checkbox"
                        checked={roles.includes(r)}
                        onChange={(e) =>
                          setLayout((l) => {
                            const now = l.roles[w.key] || [];
                            const next = e.target.checked
                              ? [...now, r]
                              : now.filter((x) => x !== r);
                            return {
                              ...l,
                              roles: {
                                ...l.roles,
                                [w.key]: next.length ? ["owner", ...next.filter((x) => x !== "owner")] : [],
                              },
                            };
                          })
                        }
                      />
                      {roleNames[r]}
                    </label>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {sharing && (
        <ShareManager
          widgets={widgets}
          notify={notify}
          close={() => setSharing(false)}
        />
      )}
    </section>
  );
}

type ShareRow = {
  id: string;
  label: string;
  widget_keys: string[];
  expires_at: string;
  revoked_at: string | null;
  protected: boolean;
};
function ShareManager({
  widgets,
  notify,
  close,
}: {
  widgets: Widget[];
  notify: (s: string) => void;
  close: () => void;
}) {
  const [rows, setRows] = useState<ShareRow[]>([]),
    [keys, setKeys] = useState<string[]>(widgets.map((w) => w.key)),
    [link, setLink] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(() => api("/shares").then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <Modal title="แชร์ Dashboard ให้คนภายนอก" onClose={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const r = await api("/shares", {
              method: "POST",
              body: {
                label: f.get("label"),
                password: f.get("password"),
                days: Number(f.get("days")),
                widgetKeys: keys,
              },
            });
            setLink(r.url);
            await load();
            notify("สร้างลิงก์แชร์แล้ว");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            ชื่อลิงก์ (เช่น ชื่อพาร์ทเนอร์)
            <input name="label" maxLength={200} />
          </label>
          <label>
            รหัสผ่าน (ไม่บังคับ, อย่างน้อย 4 ตัว)
            <PasswordInput name="password" minLength={4} autoComplete="new-password" />
          </label>
          <label>
            หมดอายุใน
            <select name="days" defaultValue="7">
              {[1, 7, 30, 90, 365].map((d) => (
                <option key={d} value={d}>
                  {d} วัน
                </option>
              ))}
            </select>
          </label>
        </div>
        <h3 className="form-section-title">Widget ที่แชร์</h3>
        {widgets.map((w) => (
          <label key={w.key} className="check-row">
            <input
              type="checkbox"
              checked={keys.includes(w.key)}
              onChange={(e) =>
                setKeys((k) => (e.target.checked ? [...k, w.key] : k.filter((x) => x !== w.key)))
              }
            />
            {w.name} · {w.label}
          </label>
        ))}
        {link && (
          <div className="slip-result">
            <small>ลิงก์นี้แสดงครั้งเดียว คัดลอกเก็บไว้</small>
            <div className="row-actions">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className="secondary"
                onClick={() => navigator.clipboard?.writeText(link).then(() => notify("คัดลอกแล้ว"))}
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        )}
        <p className="form-error" role="alert">
          {error}
        </p>
        <div className="modal-footer">
          <button className="primary" disabled={busy || !keys.length}>
            <Link2 size={14} /> สร้างลิงก์
          </button>
        </div>
      </form>
      <h3 className="form-section-title">ลิงก์ที่สร้างแล้ว</h3>
      {!rows.length && <p className="note">ยังไม่มีลิงก์</p>}
      {rows.map((r) => {
        const expired = Date.parse(r.expires_at) < Date.now();
        return (
          <div key={r.id} className="section-actions">
            <span>
              {r.label || "ไม่มีชื่อ"} · {r.widget_keys.length} widget ·{" "}
              {r.protected ? "มีรหัสผ่าน" : "ไม่มีรหัส"} · หมดอายุ {displayDate(r.expires_at)}{" "}
              {r.revoked_at ? (
                <span className="status-pill bad">ยกเลิกแล้ว</span>
              ) : expired ? (
                <span className="status-pill bad">หมดอายุ</span>
              ) : (
                <span className="status-pill good">ใช้งานอยู่</span>
              )}
            </span>
            {!r.revoked_at && !expired && (
              <button
                className="icon-button"
                aria-label="ยกเลิกลิงก์"
                onClick={async () => {
                  await api("/shares/" + r.id, { method: "DELETE" });
                  await load();
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      })}
    </Modal>
  );
}

/**
 * Uploads a file and returns its attachment id. With Supabase the browser PUTs the file straight to storage through
 * a one-time URL (no hosting request-size cap, up to 15 MB); demo mode sends it through the server.
 */
export async function uploadFile(file: File, department: string, entityId?: string) {
  const meta = { name: file.name, mime: file.type, size: file.size, department, entityId: entityId || null };
  const ready: { direct: boolean; id?: string; url?: string } = await api("/files/direct", { method: "POST", body: meta });
  if (ready.direct) {
    const put = await fetch(ready.url!, { method: "PUT", headers: { "Content-Type": file.type, "x-upsert": "false" }, body: file });
    if (!put.ok) throw Error("อัปโหลดไฟล์ไม่สำเร็จ (" + put.status + ")");
    const done: { id: string } = await api("/files/direct/complete", { method: "POST", body: { ...meta, id: ready.id } });
    return done.id;
  }
  const upload = new FormData();
  upload.set("file", file);
  upload.set("department", department);
  if (entityId) upload.set("entity", entityId);
  const r = await fetch("/api/files", { method: "POST", body: upload });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d.id as string;
}

type BillingData = {
  subscription: Subscription;
  plan: Plan;
  plans: Plan[];
  active: boolean;
  usage: Usage;
  limits: Record<string, number | null>;
  overage: { documents: number; ocr: number; ai_runs: number; total: number };
  payments: {
    id: string;
    plan: string;
    cycle: string;
    amount: number;
    slip_ref: string | null;
    status: string;
    note?: string | null;
    created_at: string;
  }[];
  platformAdmin: boolean;
  entitlements: Record<string, boolean>;
};
const usageLabels: [keyof Usage, string][] = [
  ["workflows", "AI Workflows (Template)"],
  ["documents", "เอกสาร/เดือน"],
  ["line_groups", "กลุ่ม LINE"],
  ["users", "ผู้ใช้ Dashboard"],
];
/** Subscription status, quotas, overage and paying by bank slip. */
export function SubscriptionPanel({
  ctx,
  notify,
}: {
  ctx: Context;
  notify: (s: string) => void;
}) {
  const [data, setData] = useState<BillingData | null>(null),
    [error, setError] = useState(""),
    [pay, setPay] = useState<{ plan: string; cycle: "monthly" | "yearly" } | null>(null),
    [chosen, setChosen] = useState<string[]>([]),
    [extraUsers, setExtraUsers] = useState(0),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api("/billing")
        .then((d) => {
          setData(d);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!data) return error ? <p className="form-error">{error}</p> : <Loading />;
  const s = data.subscription;
  const daysLeft = Math.max(0, Math.ceil((Date.parse(s.trial_ends_at) - Date.now()) / 86400000));
  const owner = ctx.member.role === "owner";
  return (
    <>
      <section className="z-card">
        <div className="section-actions">
          <div>
            <h2>
              แพ็กเกจ {data.plan.name}{" "}
              <span className={"status-pill " + (data.active ? "good" : "bad")}>
                {s.status === "trial"
                  ? data.active
                    ? `ทดลองใช้ฟรี เหลือ ${daysLeft} วัน`
                    : "หมดช่วงทดลอง"
                  : s.status === "active"
                    ? "ใช้งานอยู่"
                    : s.status === "past_due"
                      ? "ค้างชำระ"
                      : "ยกเลิก"}
              </span>
            </h2>
            <small>
              {s.current_period_end
                ? "รอบบิลถึง " + displayDate(s.current_period_end)
                : "ทดลองใช้ 14 วัน ไม่ต้องใช้บัตรเครดิต"}
            </small>
          </div>
        </div>
        <div className="usage-grid">
          {usageLabels.map(([k, label]) => {
            const used = data.usage[k],
              limit = data.limits[k];
            const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
            return (
              <div className="widget-card" key={k}>
                <small>{label}</small>
                <strong>
                  {used.toLocaleString("th-TH")}
                  <small style={{ display: "inline" }}> / {limit ?? "ไม่จำกัด"}</small>
                </strong>
                {limit !== null && (
                  <div className={"meter" + (used > limit ? " over" : "")}>
                    <span style={{ width: pct + "%" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="note">
          AI เดือนนี้: อ่านรูป (OCR) {data.usage.ocr.toLocaleString("th-TH")} รูป · วิเคราะห์ PDF {data.usage.ai_runs.toLocaleString("th-TH")} ไฟล์
          {" "}({(data.usage as Usage & { pages?: number }).pages ?? 0} หน้า, สูงสุด 10 หน้า/ไฟล์)
        </p>
        {data.overage.total > 0 && (
          <p className="note">
            เกินโควตาเดือนนี้ (เรียกเก็บรอบถัดไป, ระบบยังทำงานต่อ): เอกสาร ฿{money(data.overage.documents)} · OCR ฿
            {money(data.overage.ocr)} · AI ฿{money(data.overage.ai_runs)} = <b>฿{money(data.overage.total)}</b>
          </p>
        )}
      </section>
      <div className="pricing-grid">
        {data.plans.map((p) => (
          <article className="card pricing-card" key={p.id}>
            <h3>{p.name}</h3>
            <strong>฿{money(p.monthly)}</strong>
            <small>/เดือน · ฿{money(p.yearly)}/ปี (ฟรี 2 เดือน) · ไม่รวม VAT 7%</small>
            <ul>
              <li>AI Workflows: {p.workflows ?? "ไม่จำกัด"}</li>
              <li>เอกสาร/เดือน: {p.documents?.toLocaleString("th-TH") ?? "ไม่จำกัด"}</li>
              <li>กลุ่ม LINE: {p.line_groups ?? "ไม่จำกัด"}</li>
              <li>ผู้ใช้ Dashboard: {p.users ?? "ไม่จำกัด"}</li>
              <li>API: {p.api} · Support: {p.support}</li>
            </ul>
            {owner && (
              <div className="row-actions">
                <button className="secondary" onClick={() => setPay({ plan: p.id, cycle: "monthly" })}>
                  ชำระรายเดือน
                </button>
                <button className="primary" onClick={() => setPay({ plan: p.id, cycle: "yearly" })}>
                  รายปี
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      <section className="z-card">
        <h2>Premium Add-ons</h2>
        <div className="usage-grid">
          {addons.map((a) => (
            <div className="widget-card" key={a.id}>
              <small>฿{money(a.price)}/{a.unit}</small>
              <b>{a.name}</b>
              <p className="note">{a.detail}</p>
              {a.id !== "extra_user" && (
                <span className={"status-pill " + (data.entitlements?.[a.id] ? "good" : "")}>
                  {data.entitlements?.[a.id]
                    ? s.status === "trial"
                      ? "เปิดให้ลองช่วงทดลอง"
                      : "เปิดใช้งานแล้ว"
                    : "ยังไม่ได้เปิด"}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="note">
          ส่วนเกินโควตา: เอกสาร ฿1/รายการ · OCR รูปภาพ ฿1.50/รูป · AI วิเคราะห์เอกสาร ฿2/ครั้ง · Setup &amp; Onboarding ครั้งเดียว ฿3,000–10,000 · ราคายังไม่รวม VAT 7% · เลือก Add-on ได้ตอนชำระแพ็กเกจ (รายปีได้ส่วนลด 2 เดือนเช่นกัน)
        </p>
      </section>
      {owner && !!data.payments.length && (
        <section className="z-card">
          <h2>ประวัติการชำระเงิน</h2>
          <table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>แพ็กเกจ</th>
                <th>ยอด (รวม VAT)</th>
                <th>Ref สลิป</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{displayDate(p.created_at)}</td>
                  <td>
                    {p.plan} / {p.cycle === "yearly" ? "ปี" : "เดือน"}
                  </td>
                  <td>฿{money(p.amount)}</td>
                  <td>{p.slip_ref}</td>
                  <td>
                    <span className={"status-pill " + (p.status === "verified" ? "good" : p.status === "rejected" ? "bad" : "")}>
                      {p.status === "verified" ? "ยืนยันแล้ว" : p.status === "rejected" ? "ไม่ผ่าน" : "รอตรวจสอบ"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {data.platformAdmin && <PlatformPayments notify={notify} changed={load} />}
      {pay && (
        <Modal title="ชำระด้วยการโอนเงิน" onClose={() => setPay(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const file = new FormData(e.currentTarget).get("file") as File;
              setBusy(true);
              setError("");
              try {
                const attachmentId = await uploadFile(file, "Finance");
                await api("/billing", {
                  method: "POST",
                  body: { ...pay, attachmentId, addons: chosen, extraUsers },
                });
                setPay(null);
                await load();
                notify("ส่งสลิปแล้ว ระบบจะเปิดใช้งานเมื่อทีมงานยืนยันยอด");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {(() => {
              const p = data.plans.find((x) => x.id === pay.plan)!;
              const price = planPrice(p.id, pay.cycle, { addons: chosen, extraUsers });
              return (
                <>
                  <h3 className="form-section-title">Add-on (ไม่บังคับ)</h3>
                  {addons
                    .filter((a) => a.id !== "extra_user")
                    .map((a) => (
                      <label key={a.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={chosen.includes(a.id)}
                          onChange={(e) =>
                            setChosen((c) => (e.target.checked ? [...c, a.id] : c.filter((x) => x !== a.id)))
                          }
                        />
                        {a.name} · ฿{money(a.price)}/เดือน
                      </label>
                    ))}
                  <label>
                    ผู้ใช้ Dashboard เพิ่ม (฿150/คน/เดือน)
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      value={extraUsers}
                      onChange={(e) => setExtraUsers(Math.max(0, Math.min(1000, Number(e.target.value) || 0)))}
                    />
                  </label>
                  <p>
                    {p.name} ({pay.cycle === "yearly" ? "รายปี" : "รายเดือน"}) ฿{money(price.base)} + VAT 7% ={" "}
                    <b>฿{money(price.total)}</b>
                  </p>
                </>
              );
            })()}
            <p className="note">
              โอนเข้าบัญชีบริษัท ZettaFlow AI แล้วอัปโหลดรูปสลิป (PNG/JPEG ไม่ครอป QR) ระบบตรวจ QR และกันสลิปซ้ำอัตโนมัติ
            </p>
            <label>
              รูปสลิป
              <input name="file" type="file" accept="image/png,image/jpeg" required />
            </label>
            <p className="form-error" role="alert">
              {error}
            </p>
            <div className="modal-footer">
              <button className="primary" disabled={busy}>
                <Upload size={14} /> ส่งสลิป
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function PlatformPayments({ notify, changed }: { notify: (s: string) => void; changed: () => void }) {
  const [rows, setRows] = useState<{ id: string; plan: string; cycle: string; amount: number; slip_ref: string; created_at: string; companies?: { name: string } }[]>([]);
  const load = useCallback(() => api("/billing/admin").then(setRows).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section className="z-card">
      <h2>
        <ShieldCheck size={16} /> ผู้ดูแลแพลตฟอร์ม · สลิปรอยืนยัน
      </h2>
      {!rows.length && <p className="note">ไม่มีรายการรอยืนยัน</p>}
      {rows.map((r) => (
        <div className="section-actions" key={r.id}>
          <span>
            {r.companies?.name} · {r.plan}/{r.cycle} · ฿{money(r.amount)} · Ref {r.slip_ref} · {displayDate(r.created_at)}
          </span>
          <div className="row-actions">
            {(["verified", "rejected"] as const).map((status) => (
              <button
                key={status}
                className={status === "verified" ? "primary" : "secondary"}
                onClick={async () => {
                  await api("/billing/admin/" + r.id, { method: "POST", body: { status } });
                  notify(status === "verified" ? "เปิดใช้งานแพ็กเกจแล้ว" : "ปฏิเสธรายการแล้ว");
                  await load();
                  changed();
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

/** Finance tool: verify a transfer slip QR, compare amount and block re-used slips. */
export function SlipChecker() {
  const [result, setResult] = useState<{ status: string; message: string; transRef?: string; bankName?: string } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="z-card">
      <h2>ตรวจสลิปโอนเงิน</h2>
      <p className="note">อ่าน QR บนสลิป ตรวจ checksum ธนาคาร เทียบยอด และกันการใช้สลิปซ้ำ</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          setResult(null);
          try {
            const attachmentId = await uploadFile(f.get("file") as File, "Finance");
            const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
            setResult(await api("/slips", { method: "POST", body: { attachmentId, amount: num("amount"), expected: num("expected") } }));
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            รูปสลิป
            <input name="file" type="file" accept="image/png,image/jpeg" required />
          </label>
          <label>
            ยอดในสลิป
            <input name="amount" type="number" step="0.01" min="0" />
          </label>
          <label>
            ยอดที่ต้องได้รับ
            <input name="expected" type="number" step="0.01" min="0" />
          </label>
        </div>
        <button className="primary" disabled={busy}>
          <ShieldCheck size={14} /> ตรวจสลิป
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {result && (
        <div className="slip-result">
          {result.status === "verified" ? <CheckCircle2 size={16} color="#1d7a43" /> : <XCircle size={16} color="#b42323" />}{" "}
          <b>{result.message}</b>
        </div>
      )}
    </section>
  );
}

type Group = { group_id: string; template_id: string; name: string; approve_keywords: string[] };
/** Map each LINE group to a department form and set its manager approval keywords. */
export function LineGroupSettings({ templates, groups, changed, notify }: { templates: { id: string; name: string; department: string }[]; groups: Group[]; changed: () => void; notify: (s: string) => void }) {
  const [error, setError] = useState("");
  if (!groups.length) return <Empty title="ยังไม่มีกลุ่ม LINE" />;
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      {groups.map((g) => (
        <form
          key={g.group_id}
          className="widget-card"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api("/integrations/" + encodeURIComponent(g.group_id), {
                method: "PATCH",
                body: {
                  name: f.get("name"),
                  templateId: f.get("templateId"),
                  keywords: String(f.get("keywords")).split(",").map((s) => s.trim()).filter(Boolean),
                },
              });
              notify("บันทึกการตั้งค่ากลุ่มแล้ว");
              changed();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <small>Group ID: {g.group_id}</small>
          <div className="form-grid">
            <label>
              ชื่อกลุ่ม
              <input name="name" defaultValue={g.name} placeholder="[ZettaFlow] การเงิน" />
            </label>
            <label>
              แผนก / ฟอร์ม
              <select name="templateId" defaultValue={g.template_id}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.department} · {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              คีย์เวิร์ดอนุมัติของผู้จัดการ (คั่นด้วย ,)
              <input name="keywords" defaultValue={g.approve_keywords?.join(", ")} required />
            </label>
          </div>
          <div className="row-actions">
            <button className="primary">
              <Save size={14} /> บันทึก
            </button>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                if (!confirm("ยกเลิกการเชื่อมกลุ่มนี้?")) return;
                await api("/integrations/" + encodeURIComponent(g.group_id), { method: "DELETE" }).catch((err) => setError(err.message));
                changed();
              }}
            >
              <Trash2 size={14} /> ยกเลิกการเชื่อม
            </button>
          </div>
        </form>
      ))}
    </>
  );
}
