"use client";
// Full employee profile: cover + photo, tenure / KPI / tasks / leave left, and tabs for overview, documents,
// work history (timeline) and approval rights. Opened from the employee list (ดูโปรไฟล์เต็ม).
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Camera, MessageCircle, Phone, Mail, Pencil, FileText, Check, AlertCircle, Plus, MapPin, Heart, AtSign } from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { statusLabels, approvalRights, employeeDocuments } from "@/lib/catalog";
import type { PartyStats } from "@/lib/directory";
import { api, displayDate, Loading, Empty } from "./shared";
import { EntityEditor, photoUrl } from "./records";
import { EntityFiles } from "./entity-files";
import { deptLabels } from "./home-dashboard";

const palette = ["#7952dd", "#0f9d74", "#d97706", "#2563eb", "#db2777", "#0891b2", "#65a30d", "#9333ea"];
const tint = (s: string) => palette[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % palette.length];
const initial = (s: unknown) => [...String(s || "?").replace(/^(บริษัท|ห้างหุ้นส่วน|หจก\.|คุณ|นาย|นาง|นางสาว)\s*/, "").replace(/^[เแโใไ]/, "")][0] || "?";

export function Avatar({ e, size = 38 }: { e: Entity; size?: number }) {
  const name = String(e.data.name || "");
  return e.data.photo ? (
    <img className="dir-avatar" src={photoUrl(e.data.photo)} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="dir-avatar" style={{ width: size, height: size, background: tint(name), fontSize: size * 0.42 }}>
      {initial(name)}
    </span>
  );
}

/** "4 ปี 4 เดือน" since the start date (empty when unknown). */
export function tenure(start: unknown, now = new Date()) {
  const s = new Date(String(start || "") + "T00:00:00Z");
  if (!start || Number.isNaN(s.getTime())) return "—";
  let months = (now.getUTCFullYear() - s.getUTCFullYear()) * 12 + now.getUTCMonth() - s.getUTCMonth();
  if (now.getUTCDate() < s.getUTCDate()) months--;
  if (months < 1) return "ไม่ถึงเดือน";
  const y = Math.floor(months / 12),
    m = months % 12;
  return [y && y + " ปี", m && m + " เดือน"].filter(Boolean).join(" ");
}
export type HistoryItem = { date: string; title: string; detail?: string };
/** Work history is kept as JSON text in the employee's `history` field, newest first. */
export function parseHistory(raw: unknown): HistoryItem[] {
  try {
    const list = JSON.parse(String(raw || "[]"));
    return (Array.isArray(list) ? list : [])
      .filter((h) => h && typeof h.title === "string" && typeof h.date === "string")
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}
const listOf = (raw: unknown) => String(raw || "").split(",").map((s) => s.trim()).filter(Boolean);

export function EmployeeProfile({
  id,
  ctx,
  notify,
  navigate,
  onBack,
}: {
  id: string;
  ctx: Context;
  notify: (s: string) => void;
  navigate: (v: string) => void;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<Entity[] | null>(null),
    [stats, setStats] = useState<Record<string, PartyStats>>({}),
    [files, setFiles] = useState<{ id: string; name: string; size: number; created_at: string }[]>([]),
    [tab, setTab] = useState("overview"),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [entry, setEntry] = useState<HistoryItem>({ date: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10), title: "", detail: "" }),
    [error, setError] = useState("");
  const writable = ctx.member.role !== "viewer" && (ctx.member.role === "owner" || ctx.member.departments.includes("HR"));
  const load = useCallback(async () => {
    try {
      const d: { rows: Entity[]; stats: Record<string, PartyStats> } = await api("/directory/employees");
      setRows(d.rows);
      setStats(d.stats);
      setFiles(await api("/files?entity=" + id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  const e = rows?.find((r) => r.id === id);
  async function patch(change: Record<string, unknown>, message: string) {
    if (!e) return;
    setBusy(true);
    setError("");
    try {
      await api("/entities/employees/" + e.id, { method: "PATCH", body: { data: { ...e.data, ...change }, version: e.version } });
      notify(message);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!rows) return error ? <p className="form-error">{error}</p> : <Loading />;
  if (!e)
    return (
      <>
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={14} /> พนักงานทั้งหมด
        </button>
        <Empty title="ไม่พบพนักงาน" description="อาจถูกเก็บเข้าคลังแล้ว" />
      </>
    );
  const d = e.data,
    s = stats[e.id] || { spend: 0, orders: 0 },
    approvals = listOf(d.approvals),
    done = listOf(d.checklist),
    history = parseHistory(d.history),
    quota = Number(d.leaveQuota) || 0,
    manager = rows.find((r) => r.id === d.managerId),
    team = rows.filter((r) => r.data.managerId === e.id);
  const missing = employeeDocuments.filter((doc) => !done.includes(doc));
  const tabs: [string, string, number?][] = [
    ["overview", "ภาพรวม"],
    ["files", "เอกสาร", files.length],
    ["history", "ประวัติการทำงาน"],
    ["rights", "สิทธิ์การอนุมัติ", approvals.length],
  ];
  return (
    <div className="prof">
      <button className="text-button prof-back" onClick={onBack}>
        <ArrowLeft size={14} /> พนักงานทั้งหมด
      </button>
      <section className="card prof-card">
        <div className="prof-cover" style={d.cover ? { backgroundImage: `url(${photoUrl(d.cover)})` } : undefined}>
          {writable && (
            <label className="prof-cover-btn">
              <Camera size={14} /> เปลี่ยนรูปปก
              <input
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={async (ev) => {
                  const f = ev.target.files?.[0];
                  ev.target.value = "";
                  if (!f) return;
                  const form = new FormData();
                  form.set("file", f);
                  form.set("department", "HR");
                  const r = await fetch("/api/files", { method: "POST", body: form });
                  const j = await r.json();
                  if (!r.ok) return setError(j.error);
                  patch({ cover: j.id }, "เปลี่ยนรูปปกแล้ว");
                }}
              />
            </label>
          )}
        </div>
        <div className="prof-head">
          <span className="prof-photo">
            <Avatar e={e} size={112} />
          </span>
          <div className="prof-name">
            <h1>
              {String(d.name)}
              <em className={"tag " + (d.status === "active" ? "ok" : "warn")}>{statusLabels[String(d.status)] || String(d.status)}</em>
            </h1>
            <p>{[d.position, deptLabels[String(d.department)] || d.department].filter(Boolean).join(" · ")}</p>
            <div className="dir-chips">
              {!!d.code && <em className="tag code">รหัส {String(d.code)}</em>}
              {!!d.employmentType && <em className="tag">พนักงาน{String(d.employmentType)}</em>}
              {!!d.branch && <em className="tag">สาขา{String(d.branch)}</em>}
              {!!approvals.length && <em className="tag vip">ผู้อนุมัติ {approvals.length} เรื่อง</em>}
            </div>
          </div>
          <div className="dir-buttons">
            <button className="primary" onClick={() => navigate("chat")}>
              <MessageCircle size={15} /> ส่งข้อความ
            </button>
            {!!d.phone && (
              <a className="icon-button" href={"tel:" + String(d.phone)} aria-label="โทร">
                <Phone size={16} />
              </a>
            )}
            {!!d.email && (
              <a className="icon-button" href={"mailto:" + String(d.email)} aria-label="อีเมล">
                <Mail size={16} />
              </a>
            )}
            {writable && (
              <button className="secondary" onClick={() => setEditing(true)}>
                <Pencil size={14} /> แก้ไขโปรไฟล์
              </button>
            )}
          </div>
        </div>
        <div className="dir-figures prof-figures">
          <div>
            <small>อายุงาน</small>
            <b>{tenure(d.startDate)}</b>
            <small>{d.startDate ? "เริ่มงาน " + displayDate(d.startDate) : "ยังไม่ระบุวันเริ่มงาน"}</small>
          </div>
          <div>
            <small>คะแนนประเมิน</small>
            <b className="accent">
              {d.score !== undefined && d.score !== "" ? Number(d.score) : "—"} <span>/ 100</span>
            </b>
          </div>
          <div>
            <small>งานที่รับผิดชอบ</small>
            <b>{s.openTasks || 0} งาน</b>
            {!!s.lateTasks && <small className="danger">เลยกำหนด {s.lateTasks} งาน</small>}
          </div>
          <div>
            <small>วันลาพักร้อนคงเหลือ</small>
            <b>
              {quota ? Math.max(0, quota - (s.leaveUsed || 0)) : "—"} <span>{quota ? "จาก " + quota + " วัน" : ""}</span>
            </b>
            <small>ใช้ไปแล้ว {s.leaveUsed || 0} วัน</small>
          </div>
        </div>
      </section>
      <div className="dir-tabs prof-tabs" role="tablist">
        {tabs.map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {label}
            {!!n && <i>{n}</i>}
          </button>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      {tab === "overview" && (
        <div className="prof-grid">
          <div className="prof-col">
            <section className="card prof-block">
              <h3>เกี่ยวกับ{String(d.nickname || d.name).split(" ")[0]}</h3>
              <p>{String(d.about || "ยังไม่มีคำแนะนำตัว")}</p>
              <div className="prof-skills">
                {listOf(d.skills).map((k) => (
                  <em key={k} className="tag">
                    {k}
                  </em>
                ))}
              </div>
            </section>
            <section className="card prof-block">
              <h3>ข้อมูลการทำงาน</h3>
              <dl className="dir-facts three">
                {(
                  [
                    ["ตำแหน่ง", d.position],
                    ["ระดับ", d.level],
                    ["แผนก", deptLabels[String(d.department)] || d.department],
                    ["หัวหน้างาน", manager?.data.name],
                    ["ลูกทีม", team.length ? team.length + " คน" : ""],
                    ["ประเภทการจ้าง", d.employmentType ? "พนักงาน" + d.employmentType : ""],
                    ["สาขา", d.branch],
                    ["เวลาทำงาน", d.workHours],
                  ] as [string, unknown][]
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{String(v || "—")}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="card prof-block">
              <h3>
                เอกสารล่าสุด
                {!!files.length && (
                  <button className="secondary" onClick={() => setTab("files")}>
                    ดูเอกสารทั้งหมด {files.length} ไฟล์
                  </button>
                )}
              </h3>
              {!files.length ? (
                <p className="muted">ยังไม่มีเอกสาร</p>
              ) : (
                <div className="dir-files">
                  {files.slice(0, 4).map((f) => (
                    <a key={f.id} href={"/api/files/" + f.id} target="_blank" rel="noreferrer">
                      <FileText size={16} />
                      <span>
                        <b>{f.name}</b>
                        <small>
                          {displayDate(f.created_at)} · {Math.max(1, Math.round(f.size / 1024))} KB
                        </small>
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </div>
          <div className="prof-col">
            <section className="card prof-block prof-contact">
              <h3>ข้อมูลติดต่อ</h3>
              {(
                [
                  [Phone, "เบอร์โทร", d.phone],
                  [Mail, "อีเมล", d.email],
                  [AtSign, "LINE ID", d.line],
                  [MapPin, "ที่อยู่", d.address],
                ] as const
              ).map(([Ico, label, v]) => (
                <div key={label}>
                  <span>
                    <Ico size={15} />
                  </span>
                  <p>
                    <small>{label}</small>
                    {String(v || "—")}
                  </p>
                </div>
              ))}
              {!!d.emergency && (
                <div className="prof-emergency">
                  <span>
                    <Heart size={15} />
                  </span>
                  <p>
                    <small>ผู้ติดต่อฉุกเฉิน</small>
                    {String(d.emergency)}
                  </p>
                </div>
              )}
            </section>
            <section className="card prof-block">
              <h3>
                เอกสารที่ต้องมี <em className="tag warn">{employeeDocuments.length - missing.length} จาก {employeeDocuments.length}</em>
              </h3>
              <i className="prof-progress">
                <span style={{ width: ((employeeDocuments.length - missing.length) / employeeDocuments.length) * 100 + "%" }} />
              </i>
              <ul className="prof-checklist">
                {employeeDocuments.map((doc) => {
                  const has = done.includes(doc);
                  return (
                    <li key={doc} className={has ? "" : "missing"}>
                      <button
                        disabled={!writable || busy}
                        onClick={() => patch({ checklist: (has ? done.filter((x) => x !== doc) : [...done, doc]).join(",") }, has ? "ทำเครื่องหมายว่ายังไม่มี" : "บันทึกว่าได้รับเอกสารแล้ว")}
                      >
                        {has ? <Check size={14} /> : <AlertCircle size={14} />}
                        <span>{doc}</span>
                        <em>{has ? "มีแล้ว" : "ยังไม่มี"}</em>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!!missing.length && !!d.email && (
                <a
                  className="secondary as-button full"
                  href={`mailto:${String(d.email)}?subject=${encodeURIComponent("ขอเอกสารพนักงาน")}&body=${encodeURIComponent("รบกวนส่งเอกสารต่อไปนี้ให้ฝ่ายบุคคล:\n- " + missing.join("\n- "))}`}
                >
                  ขอเอกสารที่ขาดจากพนักงาน
                </a>
              )}
            </section>
          </div>
        </div>
      )}
      {tab === "files" && (
        <section className="card prof-block">
          <EntityFiles entity={e.id} department="HR" writable={writable} />
        </section>
      )}
      {tab === "history" && (
        <section className="card prof-block">
          <h3>
            ประวัติการทำงาน <em className="tag ok">อายุงาน {tenure(d.startDate)}</em>
          </h3>
          {writable && (
            <form
              className="prof-entry"
              onSubmit={(ev) => {
                ev.preventDefault();
                patch(
                  { history: JSON.stringify([{ date: entry.date, title: entry.title.trim(), detail: entry.detail?.trim() || undefined }, ...history]) },
                  "เพิ่มประวัติแล้ว",
                ).then(() => setEntry((x) => ({ ...x, title: "", detail: "" })));
              }}
            >
              <input type="date" required value={entry.date} onChange={(ev) => setEntry({ ...entry, date: ev.target.value })} aria-label="วันที่" />
              <input required maxLength={100} placeholder="เช่น เลื่อนตำแหน่ง" value={entry.title} onChange={(ev) => setEntry({ ...entry, title: ev.target.value })} aria-label="เหตุการณ์" />
              <input maxLength={200} placeholder="รายละเอียด" value={entry.detail} onChange={(ev) => setEntry({ ...entry, detail: ev.target.value })} aria-label="รายละเอียด" />
              <button className="secondary" disabled={busy}>
                <Plus size={14} /> เพิ่ม
              </button>
            </form>
          )}
          {!history.length ? (
            <p className="muted">{d.startDate ? "เริ่มงาน " + displayDate(d.startDate) : "ยังไม่มีประวัติ"}</p>
          ) : (
            <ol className="dir-timeline">
              {history.map((h, i) => (
                <li key={i}>
                  <small>{displayDate(h.date)}</small>
                  <b>{h.title}</b>
                  {h.detail && <span>{h.detail}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      {tab === "rights" && (
        <section className="card prof-block">
          <h3>สิทธิ์การอนุมัติ</h3>
          <ul className="prof-checklist">
            {approvalRights.map(([key, label, hint]) => (
              <li key={key} className={approvals.includes(key) ? "" : "off"}>
                <span className="prof-right">
                  {approvals.includes(key) ? <Check size={14} /> : <span className="dot" />}
                  <span>
                    <b>{label}</b>
                    <small>{hint}</small>
                  </span>
                  <em>{approvals.includes(key) ? "เปิดอยู่" : "ปิด"}</em>
                </span>
              </li>
            ))}
          </ul>
          <small className="muted">แก้ไขสิทธิ์ได้ที่แผงด้านขวาของหน้ารายชื่อพนักงาน · สิทธิ์ใช้งานระบบจริงกำหนดที่หน้า “ทีม & สิทธิ์”</small>
        </section>
      )}
      {editing && (
        <EntityEditor
          kind="employees"
          row={e}
          options={rows.map((r) => ({ id: r.id, kind: "employees", name: String(r.data.name) }))}
          writable={writable}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            notify("บันทึกโปรไฟล์แล้ว");
            load();
          }}
        />
      )}
    </div>
  );
}

