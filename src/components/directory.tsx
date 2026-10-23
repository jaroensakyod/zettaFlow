"use client";
// ลูกค้า / Supplier / พนักงาน: stat cards, searchable list on the left, details on the right.
// Codes CUS-67-0001 / SUP-67-0001 are issued by the database when the code field is left blank.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Download, Upload, Phone, Mail, Pencil, MessageCircle, Star, Archive, UserRound } from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { catalog, statusLabels, approvalRights } from "@/lib/catalog";
import type { PartyStats } from "@/lib/directory";
import { api, money, displayDate, Empty, Loading } from "./shared";
import { EntityEditor } from "./records";
import { deptLabels } from "./home-dashboard";
import { EmployeeProfile, Avatar, tenure, parseHistory } from "./employee-profile";
import { EntityFiles } from "./entity-files";

type Kind = "customers" | "suppliers" | "employees";
type Data = { rows: Entity[]; stats: Record<string, PartyStats>; nextCode: string };
type Option = { id: string; kind: string; name: string };
const isNew = (e: Entity) => Date.now() - Date.parse(e.created_at) < 30 * 864e5;
const thaiMonth = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { month: "short", year: "numeric" });
const soon = (d: unknown) => !!d && Date.parse(String(d)) - Date.now() < 30 * 864e5;
const approvalsOf = (e: Entity) => String(e.data.approvals || "").split(",").filter(Boolean);
const field = (kind: string, key: string) => catalog[kind].fields.find((f) => f.key === key)?.label || key;

const tabsFor: Record<Kind, [string, string][]> = {
  customers: [["all", "ทั้งหมด"], ["นิติบุคคล", "นิติบุคคล"], ["บุคคลธรรมดา", "บุคคลธรรมดา"]],
  suppliers: [["all", "ทั้งหมด"], ["สินค้า / วัตถุดิบ", "สินค้า / วัตถุดิบ"], ["บริการ", "บริการ"]],
  employees: [["all", "ทั้งหมด"], ["active", "ทำงานอยู่"], ["on_leave", "ลา"], ["probation", "ทดลองงาน"]],
};
const matchesTab = (kind: Kind, tab: string, e: Entity, s?: PartyStats) =>
  tab === "all" ||
  (kind === "customers" && e.data.type === tab) ||
  (kind === "suppliers" && e.data.category === tab) ||
  (kind === "employees" && (tab === "on_leave" ? e.data.status === "on_leave" || !!s?.onLeave : e.data.status === tab));

export function Directory({
  kind,
  ctx,
  notify,
  changed,
  navigate,
}: {
  kind: Kind;
  ctx: Context;
  notify: (s: string) => void;
  changed: () => void;
  navigate: (v: string) => void;
}) {
  const module = catalog[kind];
  const [data, setData] = useState<Data | null>(null),
    [options, setOptions] = useState<Option[]>([]),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState("all"),
    [dept, setDept] = useState(""),
    [selectedId, setSelectedId] = useState(""),
    [editing, setEditing] = useState<Entity | "new" | null>(null),
    [profile, setProfile] = useState(""),
    [error, setError] = useState(""),
    [importing, setImporting] = useState(false),
    importRef = useRef<HTMLInputElement>(null);
  const writable = ctx.member.role !== "viewer" && (ctx.member.role === "owner" || ctx.member.departments.includes(module.department)),
    approver = ["owner", "manager"].includes(ctx.member.role);
  const load = useCallback(async () => {
    try {
      const d: Data = await api("/directory/" + kind);
      setData(d);
      setError("");
      setSelectedId((id) => (d.rows.some((r) => r.id === id) ? id : d.rows[0]?.id || ""));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [kind]);
  useEffect(() => {
    load();
    api("/options").then(setOptions).catch(() => {});
    const p = new URLSearchParams(location.search).get("profile");
    if (kind === "employees" && p) setProfile(p);
  }, [load, kind]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows || []).filter(
      (e) =>
        matchesTab(kind, tab, e, data?.stats[e.id]) &&
        (!dept || e.data.department === dept) &&
        (!q || [e.data.name, e.data.code, e.data.contact, e.data.position, e.data.department, e.data.nickname].some((v) => String(v || "").toLowerCase().includes(q))),
    );
  }, [data, search, tab, dept, kind]);
  const selected = data?.rows.find((r) => r.id === selectedId);
  const nameOf = (id: unknown) => options.find((o) => o.id === id)?.name || data?.rows.find((r) => r.id === id)?.data.name;

  const cards: [string, string | number, string?][] = !data
    ? []
    : kind === "customers"
      ? [
          ["ลูกค้าทั้งหมด", data.rows.length + " ราย"],
          ["นิติบุคคล / บุคคลธรรมดา", `${data.rows.filter((r) => r.data.type === "นิติบุคคล").length} / ${data.rows.filter((r) => r.data.type === "บุคคลธรรมดา").length}`],
          ["ลูกค้าใหม่ปีนี้", data.rows.filter((r) => r.created_at.slice(0, 4) === new Date().toISOString().slice(0, 4)).length + " ราย"],
          ["รหัสถัดไป", data.nextCode, "code"],
        ]
      : kind === "suppliers"
        ? [
            ["Supplier ทั้งหมด", data.rows.length + " ราย"],
            ["Supplier หลัก", data.rows.filter((r) => r.data.tier === "หลัก").length + " ราย"],
            ["เอกสารใกล้หมดอายุ", data.rows.filter((r) => soon(r.data.docExpiry)).length + " ไฟล์", "warn"],
            ["รหัสถัดไป", data.nextCode, "code"],
          ]
        : [
            ["พนักงานทั้งหมด", data.rows.length + " คน"],
            ["ทำงานอยู่วันนี้", data.rows.filter((r) => r.data.status === "active" && !data.stats[r.id]?.onLeave).length + " คน", "ok"],
            ["ลา / ทดลองงาน", data.rows.filter((r) => r.data.status === "on_leave" || r.data.status === "probation" || data.stats[r.id]?.onLeave).length + " คน", "warn"],
            ["มีสิทธิ์อนุมัติ", data.rows.filter((r) => approvalsOf(r).length).length + " คน"],
          ];

  async function importFile(file: File) {
    setImporting(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await fetch("/api/import/" + kind, { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      notify(`นำเข้า ${d.created} รายการ` + (d.failed ? ` · ไม่สำเร็จ ${d.failed}: ${d.errors[0] || ""}` : ""));
      await load();
      changed();
    } catch (e) {
      notify("นำเข้าไม่สำเร็จ: " + (e as Error).message);
    } finally {
      setImporting(false);
    }
  }
  async function exportCsv() {
    const r = await fetch("/api/export?kind=" + kind);
    if (!r.ok) return notify("ส่งออกไม่สำเร็จ");
    const url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = kind + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const saved = async (row: Entity, message = "บันทึกแล้ว") => {
    setEditing(null);
    notify(message);
    await load();
    setSelectedId(row.id);
    changed();
  };

  if (profile && kind === "employees")
    return (
      <EmployeeProfile
        id={profile}
        ctx={ctx}
        notify={notify}
        navigate={navigate}
        onBack={() => {
          setProfile("");
          history.replaceState(null, "", location.pathname);
          load();
        }}
      />
    );
  if (!data) return error ? <p className="form-error">{error}</p> : <Loading />;
  return (
    <div className="dir">
      <div className="section-actions">
        <div className="dir-actions">
          {writable && (
            <button className="secondary" disabled={importing} onClick={() => importRef.current?.click()}>
              <Upload size={15} /> {importing ? "กำลังนำเข้า…" : "นำเข้าจาก Excel"}
            </button>
          )}
          <input
            ref={importRef}
            type="file"
            hidden
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) importFile(f);
            }}
          />
          <button className="secondary" onClick={exportCsv}>
            <Download size={15} /> CSV
          </button>
          {writable && (
            <button className="primary" onClick={() => setEditing("new")}>
              <Plus size={16} /> เพิ่ม{module.label}
            </button>
          )}
        </div>
      </div>
      <div className="expense-cards">
        {cards.map(([label, value, tone]) => (
          <div className={"card expense-card dir-stat " + (tone || "")} key={label}>
            <small>{label}</small>
            <b>{value || "—"}</b>
          </div>
        ))}
      </div>
      <div className="dir-grid">
        <section className="card dir-list">
          <div className="dir-tools">
            <div className="search-box">
              <Search size={16} />
              <input aria-label="ค้นหา" placeholder={kind === "employees" ? "ค้นหาชื่อ ตำแหน่ง หรือแผนก" : "ค้นหาชื่อ รหัส หรือผู้ติดต่อ"} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {kind === "employees" && (
              <select aria-label="แผนก" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">ทุกแผนก</option>
                {[...new Set(data.rows.map((r) => String(r.data.department || "")).filter(Boolean))].map((d) => (
                  <option key={d} value={d}>
                    {deptLabels[d] || d}
                  </option>
                ))}
              </select>
            )}
            <div className="acc-filters">
              {tabsFor[kind].map(([k, label]) => (
                <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {!rows.length ? (
            <Empty title={data.rows.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มี" + module.label} description={writable ? "กดเพิ่มหรือนำเข้าจาก Excel / CSV" : undefined} />
          ) : (
            <ul>
              {rows.map((e) => {
                const s = data.stats[e.id];
                return (
                  <li key={e.id}>
                    <button className={selectedId === e.id ? "active" : ""} onClick={() => setSelectedId(e.id)}>
                      <Avatar e={e} />
                      <span className="dir-main">
                        <b>
                          {String(e.data.name)}
                          {e.data.segment === "vip" && <em className="tag vip">VIP</em>}
                          {e.data.segment === "regular" && <em className="tag ok">ลูกค้าประจำ</em>}
                          {e.data.tier === "หลัก" && <em className="tag ok">หลัก</em>}
                          {kind === "suppliers" && soon(e.data.docExpiry) && <em className="tag warn">เอกสารใกล้หมดอายุ</em>}
                          {kind !== "employees" && isNew(e) && <em className="tag new">ใหม่</em>}
                        </b>
                        <small>
                          {kind === "employees"
                            ? String(e.data.position || "—")
                            : [e.data.contact, String(e.data.address || "").split(/\s+/).slice(-1)[0]].filter(Boolean).join(" · ") || "—"}
                        </small>
                      </span>
                      {kind === "employees" ? (
                        <span className="dir-emp">
                          <em className="tag dept">{deptLabels[String(e.data.department)] || String(e.data.department || "")}</em>
                          <small>{tenure(e.data.startDate)}</small>
                          <small className={approvalsOf(e).length ? "accent" : ""}>{approvalsOf(e).length ? `อนุมัติได้ ${approvalsOf(e).length} เรื่อง` : "ไม่มีสิทธิ์อนุมัติ"}</small>
                          {s?.onLeave && <em className="tag warn">ลาวันนี้</em>}
                        </span>
                      ) : (
                        !!e.data.code && <span className="dir-code">{String(e.data.code)}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <small className="dir-count">
            {rows.length} รายการ · คลิกที่รายชื่อเพื่อดูและแก้ไขข้อมูล
          </small>
        </section>
        {!selected ? (
          <section className="card dir-detail">
            <Empty title={"เลือก" + module.label} />
          </section>
        ) : kind === "employees" ? (
          <EmployeePanel
            key={selected.id + selected.version}
            e={selected}
            stats={data.stats[selected.id]}
            all={data.rows}
            writable={writable}
            nameOf={nameOf}
            navigate={navigate}
            onEdit={() => setEditing(selected)}
            onOpen={() => {
              setProfile(selected.id);
              history.replaceState(null, "", location.pathname + "?profile=" + selected.id);
            }}
            onSaved={(r) => saved(r)}
          />
        ) : (
          <PartyPanel
            key={selected.id}
            kind={kind}
            e={selected}
            stats={data.stats[selected.id]}
            nameOf={nameOf}
            writable={writable}
            approver={approver}
            onEdit={() => setEditing(selected)}
            onArchived={async () => {
              notify("เก็บเข้าคลังแล้ว");
              await load();
              changed();
            }}
          />
        )}
      </div>
      {editing && (
        <EntityEditor
          kind={kind}
          row={editing === "new" ? undefined : editing}
          initial={editing === "new" && kind !== "employees" ? { code: "" } : undefined}
          options={options}
          writable={writable}
          onClose={() => setEditing(null)}
          onSaved={(r) => saved(r, editing === "new" ? `เพิ่ม${module.label}แล้ว` + (r.data.code ? " · รหัส " + r.data.code : "") : "บันทึกแล้ว")}
        />
      )}
    </div>
  );
}

function Facts({ kind, e, keys }: { kind: string; e: Entity; keys: string[] }) {
  const shown = keys.filter((k) => e.data[k] !== undefined && e.data[k] !== "");
  if (!shown.length) return <p className="muted">ยังไม่มีข้อมูล กด “แก้ไข” เพื่อเพิ่ม</p>;
  return (
    <dl className="dir-facts">
      {shown.map((k) => (
        <div key={k} className={["address", "shippingAddress", "notes", "products", "about"].includes(k) ? "wide" : ""}>
          <dt>{field(kind, k)}</dt>
          <dd>{["creditLimit"].includes(k) ? "฿" + money(e.data[k]) : k === "docExpiry" ? displayDate(e.data[k]) : statusLabels[String(e.data[k])] || String(e.data[k])}</dd>
        </div>
      ))}
    </dl>
  );
}

function PartyPanel({
  kind,
  e,
  stats,
  nameOf,
  writable,
  approver,
  onEdit,
  onArchived,
}: {
  kind: "customers" | "suppliers";
  e: Entity;
  stats?: PartyStats;
  nameOf: (id: unknown) => unknown;
  writable: boolean;
  approver: boolean;
  onEdit: () => void;
  onArchived: () => void;
}) {
  const [tab, setTab] = useState("general");
  const d = e.data,
    count = (keys: string[]) => keys.filter((k) => d[k]).length;
  const tabs: [string, string, number?][] = [
    ["general", "ข้อมูลทั่วไป"],
    ...(kind === "suppliers" ? ([["products", "สินค้า / บริการ"], ["bank", "บัญชีธนาคาร"]] as [string, string][]) : []),
    ["address", "ที่อยู่", count(["address", "shippingAddress"])],
    ["contacts", "ผู้ติดต่อ", count(["contact", "contact2"])],
    ["files", "เอกสาร"],
  ];
  return (
    <section className="card dir-detail">
      <header className="dir-head">
        <Avatar e={e} size={64} />
        <div>
          <div className="dir-chips">
            {!!d.code && <em className="tag code">{String(d.code)}</em>}
            {!!d.type && <em className="tag">{String(d.type)}</em>}
            {d.segment === "vip" && <em className="tag vip">VIP</em>}
            {d.tier === "หลัก" && <em className="tag ok">Supplier หลัก</em>}
            {d.status === "inactive" && <em className="tag">หยุดใช้งาน</em>}
          </div>
          <h2>{String(d.name)}</h2>
          <small>
            {[d.businessType, (kind === "customers" ? "ลูกค้าตั้งแต่ " : "คู่ค้าตั้งแต่ ") + thaiMonth(e.created_at)].filter(Boolean).join(" · ")}
          </small>
        </div>
        <div className="dir-buttons">
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
            <button className="secondary" onClick={onEdit}>
              <Pencil size={14} /> แก้ไข
            </button>
          )}
        </div>
      </header>
      <div className="dir-figures">
        <div>
          <small>ยอดซื้อสะสม</small>
          <b>฿{money(stats?.spend || 0)}</b>
          <small>{stats?.orders || 0} เอกสาร</small>
        </div>
        <div>
          <small>เครดิตเทอม</small>
          <b>{d.creditDays !== undefined && d.creditDays !== "" ? d.creditDays + " วัน" : "—"}</b>
        </div>
        {kind === "customers" ? (
          <div>
            <small>ผู้ดูแลลูกค้า</small>
            <b>{String(nameOf(d.ownerId) || "—")}</b>
          </div>
        ) : (
          <>
            <div>
              <small>ส่งของภายใน</small>
              <b>{String(d.leadTime || "—")}</b>
            </div>
            <div>
              <small>คะแนนเฉลี่ย</small>
              <b>
                {d.rating !== undefined && d.rating !== "" ? (
                  <>
                    <Star size={15} className="star" /> {Number(d.rating).toFixed(1)} <span>/ 5</span>
                  </>
                ) : (
                  "—"
                )}
              </b>
            </div>
          </>
        )}
      </div>
      <div className="dir-tabs" role="tablist">
        {tabs.map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {label}
            {!!n && <i>{n}</i>}
          </button>
        ))}
      </div>
      <div className="dir-tab-body">
        {tab === "general" && (
          <>
            <Facts kind={kind} e={e} keys={["taxId", "branch", "businessType", "phone", "email", "line", kind === "customers" ? "creditLimit" : "paymentTerms", "company", "category", "docExpiry"]} />
            {!!d.notes && <p className="dir-note">{String(d.notes)}</p>}
          </>
        )}
        {tab === "products" && <Facts kind={kind} e={e} keys={["products", "category"]} />}
        {tab === "bank" && <Facts kind={kind} e={e} keys={["bankName", "bankAccount", "bankAccountName", "paymentTerms"]} />}
        {tab === "address" && <Facts kind={kind} e={e} keys={["address", "shippingAddress"]} />}
        {tab === "contacts" && <Facts kind={kind} e={e} keys={["contact", "phone", "email", "line", "contact2", "contact2Phone"]} />}
        {tab === "files" && <EntityFiles entity={e.id} department={catalog[kind].department} writable={writable} />}
      </div>
      {approver && (
        <button
          className="text-button dir-archive"
          onClick={async () => {
            if (!confirm("เก็บ " + String(d.name) + " เข้าคลัง?")) return;
            await api("/entities/" + kind + "/" + e.id, { method: "DELETE", body: { archived: true } });
            onArchived();
          }}
        >
          <Archive size={14} /> เก็บเข้าคลัง
        </button>
      )}
    </section>
  );
}

function EmployeePanel({
  e,
  stats,
  all,
  writable,
  nameOf,
  navigate,
  onEdit,
  onOpen,
  onSaved,
}: {
  e: Entity;
  stats?: PartyStats;
  all: Entity[];
  writable: boolean;
  nameOf: (id: unknown) => unknown;
  navigate: (v: string) => void;
  onEdit: () => void;
  onOpen: () => void;
  onSaved: (r: Entity) => void;
}) {
  const d = e.data;
  const [values, setValues] = useState({ position: String(d.position || ""), level: String(d.level || ""), managerId: String(d.managerId || ""), approvals: approvalsOf(e) }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty =
    values.position !== String(d.position || "") ||
    values.level !== String(d.level || "") ||
    values.managerId !== String(d.managerId || "") ||
    values.approvals.join(",") !== approvalsOf(e).join(",");
  const history = parseHistory(d.history);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r: Entity = await api("/entities/employees/" + e.id, {
        method: "PATCH",
        body: { data: { ...d, position: values.position, level: values.level, managerId: values.managerId, approvals: values.approvals.join(",") }, version: e.version },
      });
      onSaved(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card dir-detail dir-emp-panel">
      <header className="dir-head">
        <Avatar e={e} size={64} />
        <div>
          <h2>{String(d.name)}</h2>
          <small>{[d.position, deptLabels[String(d.department)] || d.department].filter(Boolean).join(" · ")}</small>
          <div className="dir-chips">
            <em className={"tag " + (d.status === "active" ? "ok" : "warn")}>{statusLabels[String(d.status)] || String(d.status)}</em>
            {!!d.code && <em className="tag code">รหัส {String(d.code)}</em>}
          </div>
        </div>
      </header>
      <div className="dir-quick">
        <a className={"secondary as-button" + (d.phone ? "" : " disabled")} href={d.phone ? "tel:" + String(d.phone) : undefined}>
          <Phone size={15} /> โทร
        </a>
        <a className={"secondary as-button" + (d.email ? "" : " disabled")} href={d.email ? "mailto:" + String(d.email) : undefined}>
          <Mail size={15} /> อีเมล
        </a>
        <button className="secondary" onClick={() => navigate("chat")}>
          <MessageCircle size={15} /> แชท
        </button>
      </div>
      <fieldset className="dir-block" disabled={!writable || busy}>
        <h3>ตำแหน่งและแผนก</h3>
        <div className="dir-two">
          <label>
            ตำแหน่ง
            <input value={values.position} maxLength={200} onChange={(ev) => setValues((v) => ({ ...v, position: ev.target.value }))} />
          </label>
          <label>
            ระดับ
            <select value={values.level} onChange={(ev) => setValues((v) => ({ ...v, level: ev.target.value }))}>
              <option value="">—</option>
              {catalog.employees.fields.find((f) => f.key === "level")!.options!.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          หัวหน้างาน
          <select value={values.managerId} onChange={(ev) => setValues((v) => ({ ...v, managerId: ev.target.value }))}>
            <option value="">— ไม่ระบุ —</option>
            {all
              .filter((x) => x.id !== e.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {String(x.data.name)}
                </option>
              ))}
          </select>
        </label>
      </fieldset>
      <fieldset className="dir-block" disabled={!writable || busy}>
        <h3>
          สิทธิ์การอนุมัติ <em className="tag">เปิดอยู่ {values.approvals.length} จาก {approvalRights.length}</em>
        </h3>
        {approvalRights.map(([key, label, hint]) => (
          <label key={key} className="dir-switch">
            <span>
              <b>{label}</b>
              <small>{hint}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={label}
              checked={values.approvals.includes(key)}
              onChange={(ev) =>
                setValues((v) => ({ ...v, approvals: ev.target.checked ? [...v.approvals, key] : v.approvals.filter((a) => a !== key) }))
              }
            />
          </label>
        ))}
        <small className="muted">บันทึกสิทธิ์ไว้ในประวัติพนักงาน สิทธิ์ใช้งานระบบจริงกำหนดที่หน้า “ทีม & สิทธิ์”</small>
      </fieldset>
      <div className="dir-block">
        <h3>
          ประวัติการทำงาน <em className="tag ok">อายุงาน {tenure(d.startDate)}</em>
        </h3>
        {!history.length ? (
          <p className="muted">{d.startDate ? "เริ่มงาน " + displayDate(d.startDate) : "ยังไม่มีประวัติ"}</p>
        ) : (
          <ol className="dir-timeline">
            {history.slice(0, 3).map((h, i) => (
              <li key={i}>
                <small>{displayDate(h.date)}</small>
                <b>{h.title}</b>
                {h.detail && <span>{h.detail}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="dir-block">
        <h3>ข้อมูลติดต่อ</h3>
        <Facts kind="employees" e={e} keys={["phone", "email", "line", "emergency"]} />
        {!!stats?.openTasks && (
          <small className="muted">
            งานที่รับผิดชอบ {stats.openTasks} งาน{stats.lateTasks ? ` · เลยกำหนด ${stats.lateTasks}` : ""} · หัวหน้า {String(nameOf(d.managerId) || "—")}
          </small>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="dir-foot">
        <button className="secondary" onClick={onOpen}>
          <UserRound size={15} /> ดูโปรไฟล์เต็ม
        </button>
        {writable && (
          <>
            <button className="secondary" onClick={onEdit}>
              <Pencil size={14} /> แก้ไขทั้งหมด
            </button>
            <button className="primary" disabled={!dirty || busy} onClick={save}>
              {busy ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

