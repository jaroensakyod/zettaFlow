"use client";
// ดูในมุมมองลูกค้า (support-view.ts): the banner an admin sees while looking at a customer company read-only, the
// banner the customer's owner / manager sees while it happens (with a button to stop it), the list of past views in
// สมาชิกและสิทธิ์, and the dialog in หลังบ้าน that opens a view with a reason.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, History, LogOut, ShieldCheck, X } from "lucide-react";
import { api } from "./shared";
import type { SupportAccess, SupportView } from "@/lib/support-view";

const time = (s: string) => new Date(s).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const when = (s: string) => new Date(s).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
function useMinutesLeft(at?: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  return at ? Math.max(0, Math.ceil((Date.parse(at) - Date.now()) / 60000)) : 0;
}

/** Admin side: you are in a customer's company, read-only. */
export function SupportViewBanner({ support, company }: { support: SupportView; company: string }) {
  const left = useMinutesLeft(support.expires_at),
    [busy, setBusy] = useState(false);
  const leave = async () => {
    setBusy(true);
    await api("/admin/view", { method: "DELETE" }).catch(() => null);
    window.location.href = "/workspace/admin";
  };
  useEffect(() => {
    if (left <= 0) window.location.href = "/workspace/admin";
  }, [left]);
  return (
    <div className="sv-banner admin" role="status">
      <i>
        <Eye size={16} />
      </i>
      <span>
        <b>กำลังดู {company} ในมุมมองลูกค้า · อ่านอย่างเดียว</b>
        <small>
          เหตุผล: {support.reason} · เหลือ {left} นาที (ถึง {time(support.expires_at)}) · ลูกค้าเห็นว่าคุณเข้ามาดู
        </small>
      </span>
      <button onClick={leave} disabled={busy}>
        <LogOut size={14} /> ออกจากมุมมองลูกค้า
      </button>
    </div>
  );
}

/** Customer side: the EliteFlow team is looking right now. */
export function SupportWatchBanner({ watch, notify }: { watch: SupportAccess[]; notify: (s: string) => void }) {
  const [list, setList] = useState(watch);
  useEffect(() => setList(watch), [watch]);
  if (!list.length) return null;
  const a = list[0];
  const stop = async () => {
    if (!confirm("หยุดการเข้าดูของทีมงาน EliteFlow ตอนนี้?")) return;
    try {
      await api("/support-access/" + a.id, { method: "POST" });
      setList(list.slice(1));
      notify("หยุดการเข้าดูแล้ว");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <div className="sv-banner watch" role="status">
      <i>
        <ShieldCheck size={16} />
      </i>
      <span>
        <b>ทีมงาน EliteFlow กำลังดูข้อมูลบริษัทของคุณ (อ่านอย่างเดียว แก้ไขไม่ได้)</b>
        <small>
          {a.admin_email} · เหตุผล: {a.reason} · ถึง {time(a.expires_at)}
        </small>
      </span>
      <button onClick={stop}>
        <EyeOff size={14} /> หยุดการเข้าดู
      </button>
    </div>
  );
}

/** Past and current views, in สมาชิกและสิทธิ์ (owners and managers). */
export function SupportHistory({ notify }: { notify: (s: string) => void }) {
  const [rows, setRows] = useState<SupportAccess[] | null>(null);
  const load = () =>
    api("/support-access")
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  if (!rows) return null;
  const open = (a: SupportAccess) => !a.ended_at && Date.parse(a.expires_at) > Date.now();
  return (
    <section className="card sv-history">
      <div className="card-heading">
        <h2>
          <History size={18} /> การเข้าดูของทีมงาน EliteFlow
        </h2>
      </div>
      <p className="muted">
        ทีมงานเข้าดูข้อมูลได้เฉพาะเมื่อจำเป็น เช่น ช่วยแก้ปัญหาที่คุณแจ้ง ต้องระบุเหตุผลทุกครั้ง ดูได้อย่างเดียว แก้ไขไม่ได้ และหมดเวลาเองภายใน 2 ชั่วโมง
      </p>
      {rows.length ? (
        <div className="sv-rows">
          {rows.map((a) => (
            <div key={a.id} className={"sv-row" + (open(a) ? " live" : "")}>
              <i>{open(a) ? <Eye size={15} /> : <History size={15} />}</i>
              <span>
                <b>{a.reason}</b>
                <small>
                  {a.admin_email} · {when(a.started_at)} – {time(a.ended_at || a.expires_at)}
                  {a.ended_by ? " · ปิดโดย " + a.ended_by : ""}
                </small>
              </span>
              {open(a) ? (
                <button
                  className="danger"
                  onClick={async () => {
                    if (!confirm("หยุดการเข้าดูนี้?")) return;
                    try {
                      await api("/support-access/" + a.id, { method: "POST" });
                      notify("หยุดการเข้าดูแล้ว");
                      load();
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  หยุด
                </button>
              ) : (
                <em>จบแล้ว</em>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">ยังไม่เคยมีทีมงานเข้าดูข้อมูลบริษัทนี้</p>
      )}
    </section>
  );
}

/** หลังบ้าน: open a company read-only, with a reason the customer will see. */
export function OpenViewDialog({ company, close, notify }: { company: { id: string; name: string }; close: () => void; notify: (s: string) => void }) {
  const [reason, setReason] = useState(""),
    [minutes, setMinutes] = useState(30),
    [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await api("/admin/view", { method: "POST", body: { company_id: company.id, reason, minutes } });
      window.location.href = "/workspace/dashboard";
    } catch (e) {
      notify((e as Error).message);
      setBusy(false);
    }
  };
  return createPortal(
    <div className="sv-modal-wrap">
      <div className="ad-scrim" onClick={close} aria-hidden="true" />
      <div className="sv-modal" role="dialog" aria-label={"ดู " + company.name + " ในมุมมองลูกค้า"}>
        <button className="ad-close" onClick={close} aria-label="ปิด">
          <X size={18} />
        </button>
        <h3>
          <Eye size={18} /> ดู {company.name} ในมุมมองลูกค้า
        </h3>
        <ul>
          <li>อ่านอย่างเดียว แก้ไข บันทึก หรือส่งอะไรแทนลูกค้าไม่ได้</li>
          <li>ลูกค้า (เจ้าของและผู้จัดการ) เห็นชื่อคุณและเหตุผลทันที และกดหยุดได้</li>
          <li>ระบบบันทึกไว้ในประวัติของแอดมินและของลูกค้า</li>
        </ul>
        <label>
          <span>เหตุผล (ลูกค้าจะเห็นข้อความนี้)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} placeholder="เช่น ลูกค้าแจ้งว่าใบแจ้งหนี้คำนวณ VAT ผิด ขอให้ช่วยตรวจ" autoFocus />
        </label>
        <div className="sv-mins" role="group" aria-label="ระยะเวลา">
          {[15, 30, 60, 120].map((m) => (
            <button key={m} type="button" className={minutes === m ? "on" : ""} onClick={() => setMinutes(m)}>
              {m < 60 ? m + " นาที" : m / 60 + " ชม."}
            </button>
          ))}
        </div>
        <button className="ad-btn primary wide" onClick={go} disabled={busy || reason.trim().length < 5}>
          <Eye size={15} /> {busy ? "กำลังเปิด…" : "เปิดดูในมุมมองลูกค้า"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
