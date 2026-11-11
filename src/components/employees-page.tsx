"use client";
// พนักงาน (Canva p.17): headcount / today / team-score tiles, a searchable paged list on the left and the selected
// person on the right — ID card with QR, basic facts, and tabs for overview, KPI, attendance, leave, skills,
// documents and history. Every figure comes from employees / attendance / leaves / kpi records; "—" when none.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Search, Plus, Download, Upload, Phone, Mail, Pencil, Star, CalendarDays, RefreshCw, SlidersHorizontal, Users, Check, Minus,
  CalendarCheck, AlarmClock, LayoutGrid, ChartNoAxesColumn, Clock, FileText, Sparkles, Files, History, Gem, UserRound,
  ChevronLeft, ChevronRight, X, BadgeCheck, ShieldCheck, Eye, EyeOff,
} from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { catalog, statusLabels } from "@/lib/catalog";
import type { PartyStats } from "@/lib/directory";
import {
  headcount, todaySummary, teamScore, performance, monthAttendance, leaveBalance, forEmployee, listOf, isInactive,
  percentOf, ratingLabel, pageList, qrMatrix, bangkokToday, attendanceKind, kpiLine,
} from "@/lib/employees-stats";
import { api, displayDate, Empty, Loading } from "./shared";
import { EntityEditor, photoUrl } from "./records";
import { EntityFiles } from "./entity-files";
import { deptLabels } from "./home-dashboard";
import { EmployeeProfile, Avatar, tenure, parseHistory, type HistoryItem } from "./employee-profile";
import { employeesSample, isSampleId, sampleCompany } from "@/lib/mock/employees";

type Option = { id: string; kind: string; name: string };
type Related = { attendance: Entity[]; leaves: Entity[]; kpi: Entity[] };
const PAGE = 5;
const hasStrengths = catalog.employees.fields.some((f) => f.key === "strengths");
const deptName = (d: unknown) => deptLabels[String(d)] || String(d || "—");
const noRel: Record<string, string> = {};

/** The record's photo / initial avatar, or the illustrated portrait of a sample (mockup) employee. */
function Face({ e, size, portraits }: { e: Entity; size: number; portraits: Record<string, string> }) {
  const pic = portraits[e.id];
  return pic ? <img className="dir-avatar" src={pic} alt="" style={{ width: size, height: size }} /> : <Avatar e={e} size={size} />;
}

/** Every page of one record kind (newest first), capped so a huge history never stalls the page. */
async function allOf(kind: string, maxPages = 40): Promise<Entity[]> {
  try {
    const first: { rows: Entity[]; count: number } = await api(`/entities/${kind}?page=0`);
    const pages = Math.min(maxPages, Math.ceil(first.count / 25));
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => api(`/entities/${kind}?page=${i + 1}`)));
    return [...first.rows, ...rest.flatMap((r: { rows: Entity[] }) => r.rows)];
  } catch {
    return [];
  }
}

export function EmployeesPage({
  ctx,
  notify,
  changed,
  navigate,
  pending,
}: {
  ctx: Context;
  notify: (s: string) => void;
  changed: () => void;
  navigate: (v: string) => void;
  /** Shown under the heading (LINE items waiting to become employees). */
  pending?: ReactNode;
}) {
  const [rows, setRows] = useState<Entity[] | null>(null),
    [stats, setStats] = useState<Record<string, PartyStats>>({}),
    [rel, setRel] = useState<Related>({ attendance: [], leaves: [], kpi: [] }),
    [options, setOptions] = useState<Option[]>([]),
    [search, setSearch] = useState(""),
    [dept, setDept] = useState(""),
    [type, setType] = useState(""),
    [level, setLevel] = useState(""),
    [filters, setFilters] = useState(false),
    [tab, setTab] = useState<"all" | "active" | "inactive">("all"),
    [page, setPage] = useState(1),
    [selectedId, setSelectedId] = useState(""),
    [editing, setEditing] = useState<Entity | "new" | null>(null),
    [profile, setProfile] = useState(""),
    [importing, setImporting] = useState(false),
    [error, setError] = useState(""),
    // Sample mode: "auto" shows the mockup while the company has no employees; the header button forces it on / off.
    [sampleMode, setSampleMode] = useState<"auto" | "on" | "off">("auto"),
    [sampleSel, setSampleSel] = useState(""),
    importRef = useRef<HTMLInputElement>(null),
    detailRef = useRef<HTMLDivElement>(null);
  const writable = ctx.member.role !== "viewer" && (ctx.member.role === "owner" || ctx.member.departments.includes("HR"));
  const today = bangkokToday();
  const mock = useMemo(() => employeesSample(today), [today]);
// Samples / mockups exist only in the public demo; a real company always sees its own data (or an empty state).
  const sample = ctx.demo && (sampleMode === "on" || (sampleMode === "auto" && !!rows && !rows.length && !error));
  const viewRel: Related = sample ? { attendance: mock.attendance, leaves: mock.leaves, kpi: mock.kpi } : rel;
  const portraits = sample ? mock.portraits : noRel;
  const selId = sample ? sampleSel || mock.rows[0].id : selectedId;

  const load = useCallback(async () => {
    try {
      const [d, attendance, leaves, kpi] = await Promise.all([
        api("/directory/employees") as Promise<{ rows: Entity[]; stats: Record<string, PartyStats> }>,
        allOf("attendance"),
        allOf("leaves"),
        allOf("kpi"),
      ]);
      setRows(d.rows);
      setStats(d.stats);
      setRel({ attendance, leaves, kpi });
      setError("");
      setSelectedId((id) => (d.rows.some((r) => r.id === id) ? id : d.rows[0]?.id || ""));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    api("/options").then(setOptions).catch(() => {});
    const p = new URLSearchParams(location.search).get("profile");
    if (p) setProfile(p);
  }, [load]);

  const all = useMemo(() => (sample ? mock.rows : rows || []), [sample, mock, rows]);
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (e) =>
        (!dept || e.data.department === dept) &&
        (!type || e.data.employmentType === type) &&
        (!level || e.data.level === level) &&
        (!q || [e.data.name, e.data.code, e.data.position, e.data.nickname, deptName(e.data.department)].some((v) => String(v || "").toLowerCase().includes(q))),
    );
  }, [all, search, dept, type, level]);
  const list = base.filter((e) => tab === "all" || (tab === "inactive") === isInactive(e));
  const pages = Math.max(1, Math.ceil(list.length / PAGE)),
    current = Math.min(page, pages),
    shown = list.slice((current - 1) * PAGE, current * PAGE);
  useEffect(() => setPage(1), [search, dept, type, level, tab]);

  const selected = all.find((r) => r.id === selId);
  const head = headcount(all),
    now = todaySummary(all, viewRel.attendance, viewRel.leaves, today),
    team = teamScore(all, viewRel.kpi);
  const loaded = !!rows || sample;

  async function importFile(file: File) {
    setImporting(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await fetch("/api/import/employees", { method: "POST", body: form });
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
    const r = await fetch("/api/export?kind=employees");
    if (!r.ok) return notify("ส่งออกไม่สำเร็จ");
    const url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = "employees.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  /** Saves part of an employee through the same entity API as the directory and profile. */
  async function patch(e: Entity, change: Record<string, unknown>, message = "บันทึกแล้ว") {
    if (isSampleId(e.id)) {
      notify("นี่คือข้อมูลตัวอย่าง — เพิ่มพนักงานจริงเพื่อแก้ไขข้อมูล");
      return false;
    }
    try {
      await api("/entities/employees/" + e.id, { method: "PATCH", body: { data: { ...e.data, ...change }, version: e.version } });
      notify(message);
      await load();
      changed();
      return true;
    } catch (err) {
      notify((err as Error).message);
      return false;
    }
  }
  const pick = (id: string) => {
    if (sample) setSampleSel(id);
    else setSelectedId(id);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1100px)").matches)
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  if (profile)
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

  const pct = (n: number) => (head.total ? percentOf(n, head.total) + "%" : "");
  const tiles: { label: string; value: ReactNode; sub?: string; tone: string; icon: ReactNode }[] = [
    { label: "พนักงานทั้งหมด", value: loaded ? head.total : "—", tone: "violet", icon: <Users size={22} /> },
    { label: "กำลังปฏิบัติงาน (Active)", value: loaded ? head.active : "—", sub: loaded ? pct(head.active) : "", tone: "green", icon: <Check size={22} /> },
    { label: "ไม่ปฏิบัติงาน (Inactive)", value: loaded ? head.inactive : "—", sub: loaded ? pct(head.inactive) : "", tone: "red", icon: <Minus size={22} /> },
    { label: "มาทำงานวันนี้", value: now.recorded ? now.present : "—", sub: now.recorded ? pct(now.present) : "ยังไม่มีบันทึกเวลาวันนี้", tone: "blue", icon: <CalendarCheck size={22} /> },
    { label: "ลา / ขาด / สาย (วันนี้)", value: now.recorded || now.away ? now.away : "—", sub: now.recorded || now.away ? pct(now.away) : "", tone: "orange", icon: <AlarmClock size={22} /> },
    { label: "คะแนนเฉลี่ยทีม", value: team !== null ? <>{team.toFixed(1)}<small> / 5.0</small></> : "—", tone: "gold", icon: <Star size={22} /> },
  ];

  return (
    <div className="ep">
      <div className="ep-head">
        <div className="ep-title">
          <span className="ep-title-icon">
            <Users size={22} />
          </span>
          <div>
            <h1>พนักงาน</h1>
            <p>จัดการข้อมูลพนักงาน ประเมินผลงาน และติดตามประสิทธิภาพทีม</p>
          </div>
        </div>
        <div className="ep-actions">
          <span className="date-chip">
            <CalendarDays size={15} />
            {new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" })}
          </span>
          {ctx.demo && (
            <button
              className={"secondary ep-sample-toggle" + (sample ? " on" : "")}
              aria-pressed={sample}
              onClick={() => setSampleMode(sample ? "off" : "on")}
            >
              {sample ? <EyeOff size={15} /> : <Eye size={15} />} {sample ? "ปิดตัวอย่าง" : "ดูตัวอย่าง"}
            </button>
          )}
          <button
            className="icon-button refresh-button"
            aria-label="รีเฟรช"
            onClick={async () => {
              await load();
              notify("อัปเดตข้อมูลพนักงานแล้ว");
            }}
          >
            <RefreshCw size={17} />
          </button>
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
              <Plus size={16} /> เพิ่มพนักงาน
            </button>
          )}
        </div>
      </div>
      {pending}
      {error && <p className="form-error">{error}</p>}
      {sample && (
        <div className="ep-sample-banner" role="status">
          <span className="sample-badge">ตัวอย่าง</span>
          <p>กำลังดูตัวอย่าง — ข้อมูลสมมติเพื่อให้เห็นหน้าตาเมื่อมีข้อมูลจริง</p>
          <div>
            <button className="secondary" onClick={() => setSampleMode("off")}>
              ปิดตัวอย่าง
            </button>
            {writable && (
              <button
                className="primary"
                onClick={() => {
                  setSampleMode("off");
                  setEditing("new");
                }}
              >
                <Plus size={15} /> เพิ่มพนักงาน
              </button>
            )}
          </div>
        </div>
      )}
      <div className="ep-tiles">
        {tiles.map((t) => (
          <div key={t.label} className={"ep-tile " + t.tone}>
            <span className="ep-tile-icon">{t.icon}</span>
            <div>
              <small>{t.label}</small>
              <b>
                {t.value}
                {typeof t.value === "number" && <em> คน</em>}
              </b>
              {t.sub && <i>{t.sub}</i>}
            </div>
          </div>
        ))}
      </div>
      {!loaded ? (
        <Loading />
      ) : (
        <div className={"ep-grid" + (sample ? " ep-is-sample" : "")}>
          <section className="ep-card ep-list">
            <div className="ep-tools">
              <label className="ep-search">
                <Search size={16} />
                <input aria-label="ค้นหาพนักงาน" placeholder="ค้นหาชื่อ ตำแหน่ง หรือรหัสพนักงาน" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <select aria-label="แผนก" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">ทุกแผนก</option>
                {[...new Set(all.map((r) => String(r.data.department || "")).filter(Boolean))].map((d) => (
                  <option key={d} value={d}>
                    {deptName(d)}
                  </option>
                ))}
              </select>
              <button className={"ep-icon-btn" + (filters || type || level ? " on" : "")} aria-label="ตัวกรองเพิ่มเติม" aria-expanded={filters} onClick={() => setFilters((f) => !f)}>
                <SlidersHorizontal size={16} />
              </button>
            </div>
            {filters && (
              <div className="ep-more">
                <select aria-label="ประเภทการจ้าง" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">ทุกประเภทการจ้าง</option>
                  {catalog.employees.fields.find((f) => f.key === "employmentType")?.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                <select aria-label="ระดับ" value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option value="">ทุกระดับ</option>
                  {catalog.employees.fields.find((f) => f.key === "level")?.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                {(type || level) && (
                  <button className="text-button" onClick={() => (setType(""), setLevel(""))}>
                    ล้างตัวกรอง
                  </button>
                )}
              </div>
            )}
            <div className="ep-seg" role="tablist">
              {(
                [
                  ["all", "ทั้งหมด", base.length],
                  ["active", "Active", base.filter((e) => !isInactive(e)).length],
                  ["inactive", "Inactive", base.filter(isInactive).length],
                ] as const
              ).map(([k, label, n]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                  {label} ({n})
                </button>
              ))}
            </div>
            {!shown.length ? (
              <Empty title={all.length ? "ไม่พบพนักงานที่ค้นหา" : "ยังไม่มีพนักงาน"} description={writable && !all.length ? "กดเพิ่มพนักงานหรือนำเข้าจาก Excel / CSV" : undefined} />
            ) : (
              <ul className="ep-rows">
                {shown.map((e) => {
                  const active = e.id === selId;
                  return (
                    <li key={e.id}>
                      <button className={active ? "active" : ""} aria-current={active || undefined} onClick={() => pick(e.id)}>
                        <span className="ep-ava">
                          <Face e={e} size={46} portraits={portraits} />
                          {active && <Star size={14} className="ep-star" aria-hidden />}
                        </span>
                        <span className="ep-who">
                          <b>{String(e.data.name)}</b>
                          <small>{String(e.data.position || deptName(e.data.department))}</small>
                          {(!!e.data.code || sample) && (
                            <span className="ep-code-line">
                              {!!e.data.code && <em className="ep-code">{String(e.data.code)}</em>}
                              {sample && <span className="sample-badge ep-row-badge">ตัวอย่าง</span>}
                            </span>
                          )}
                        </span>
                        <StatusBadge e={e} onLeave={sample ? undefined : stats[e.id]?.onLeave} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <footer className="ep-pager">
              <small>
                {list.length ? `แสดง ${(current - 1) * PAGE + 1}–${Math.min(current * PAGE, list.length)} จาก ${list.length} คน` : "0 คน"}
              </small>
              {pages > 1 && (
                <nav aria-label="หน้า">
                  <button aria-label="ก่อนหน้า" disabled={current === 1} onClick={() => setPage(current - 1)}>
                    <ChevronLeft size={14} />
                  </button>
                  {pageList(current, pages).map((p, i) =>
                    p ? (
                      <button key={p} className={p === current ? "active" : ""} aria-current={p === current ? "page" : undefined} onClick={() => setPage(p)}>
                        {p}
                      </button>
                    ) : (
                      <span key={"gap" + i}>…</span>
                    ),
                  )}
                  <button aria-label="ถัดไป" disabled={current === pages} onClick={() => setPage(current + 1)}>
                    <ChevronRight size={14} />
                  </button>
                </nav>
              )}
            </footer>
          </section>
          <div className="ep-detail" ref={detailRef}>
            {!selected ? (
              <section className="ep-card">
                <Empty title="เลือกพนักงาน" />
              </section>
            ) : (
              <Detail
                key={selected.id}
                e={selected}
                ctx={ctx}
                rel={viewRel}
                today={today}
                writable={writable && !sample}
                sample={sample}
                portraits={portraits}
                navigate={navigate}
                patch={patch}
                onEdit={() => setEditing(selected)}
                onOpen={() => {
                  if (sample) return notify("นี่คือข้อมูลตัวอย่าง — เพิ่มพนักงานจริงเพื่อดูโปรไฟล์เต็ม");
                  setProfile(selected.id);
                  history.replaceState(null, "", location.pathname + "?profile=" + selected.id);
                }}
              />
            )}
          </div>
        </div>
      )}
      {editing && (
        <EntityEditor
          kind="employees"
          row={editing === "new" ? undefined : editing}
          options={options}
          writable={writable}
          onClose={() => setEditing(null)}
          onSaved={async (r) => {
            const added = editing === "new";
            setEditing(null);
            setSampleMode("auto");
            notify(added ? "เพิ่มพนักงานแล้ว" + (r.data.code ? " · รหัส " + r.data.code : "") : "บันทึกแล้ว");
            await load();
            setSelectedId(r.id);
            changed();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ e, onLeave }: { e: Entity; onLeave?: boolean }) {
  const s = String(e.data.status || "active");
  if (onLeave && s !== "inactive") return <em className="ep-badge warn">ลาวันนี้</em>;
  if (s === "active") return <em className="ep-badge ok">Active</em>;
  if (s === "probation") return <em className="ep-badge info">ทดลองงาน</em>;
  return <em className={"ep-badge " + (s === "inactive" ? "off" : "warn")}>{statusLabels[s] || s}</em>;
}

const TABS = [
  ["overview", "ภาพรวม", LayoutGrid],
  ["kpi", "ผลงาน (KPI/OKR)", ChartNoAxesColumn],
  ["attendance", "การเข้า-ออกงาน", Clock],
  ["leave", "การลา", FileText],
  ["skills", "ทักษะ & ความสามารถ", Sparkles],
  ["files", "เอกสาร", Files],
  ["history", "ประวัติ", History],
] as const;
type Tab = (typeof TABS)[number][0];

function Detail({
  e,
  ctx,
  rel,
  today,
  writable,
  sample,
  portraits,
  navigate,
  patch,
  onEdit,
  onOpen,
}: {
  e: Entity;
  ctx: Context;
  rel: Related;
  today: string;
  writable: boolean;
  sample: boolean;
  portraits: Record<string, string>;
  navigate: (v: string) => void;
  patch: (e: Entity, change: Record<string, unknown>, message?: string) => Promise<boolean>;
  onEdit: () => void;
  onOpen: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const d = e.data;
  const mine = useMemo(
    () => ({ attendance: forEmployee(rel.attendance, e), leaves: forEmployee(rel.leaves, e), kpi: forEmployee(rel.kpi, e) }),
    [rel, e],
  );
  const perf = performance(e, rel.kpi),
    month = monthAttendance(mine.attendance, mine.leaves, today),
    balance = leaveBalance(e, rel.leaves, today),
    skills = listOf(d.skills),
    strengths = listOf(d.strengths);
  return (
    <>
      <div className="ep-top">
        <IdCard e={e} company={sample ? sampleCompany : ctx.company.name} portraits={portraits} sample={sample} />
        <section className="ep-card ep-basic">
          <header className="ep-card-head">
            <h3>
              <UserRound size={18} /> ข้อมูลพื้นฐาน
            </h3>
            <div className="ep-head-btns">
              {!sample && (
                <button className="ep-ghost" onClick={onOpen}>
                  โปรไฟล์เต็ม
                </button>
              )}
              {writable && (
                <button className="ep-ghost accent" onClick={onEdit}>
                  <Pencil size={14} /> แก้ไขข้อมูล
                </button>
              )}
            </div>
          </header>
          <dl className="ep-facts">
            <div>
              <dt>แผนก</dt>
              <dd>{deptName(d.department)}</dd>
            </div>
            <div>
              <dt>ระดับ</dt>
              <dd>{String(d.level || "—")}</dd>
            </div>
            <div>
              <dt>วันที่เริ่มงาน</dt>
              <dd>
                {d.startDate ? (
                  <>
                    {new Date(String(d.startDate)).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })} ({tenure(d.startDate)})
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>ประเภท</dt>
              <dd>{d.employmentType ? "พนักงาน" + String(d.employmentType) : "—"}</dd>
            </div>
          </dl>
          <div className="ep-contact">
            <a className={d.phone ? "" : "empty"} href={d.phone ? "tel:" + String(d.phone) : undefined}>
              <Phone size={15} /> {String(d.phone || "ยังไม่มีเบอร์โทร")}
            </a>
            <a className={d.email ? "" : "empty"} href={d.email ? "mailto:" + String(d.email) : undefined}>
              <Mail size={15} /> <span>{String(d.email || "ยังไม่มีอีเมล")}</span>
            </a>
          </div>
        </section>
      </div>
      <nav className="ep-tabs" role="tablist">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <div className="ep-overview">
          <section className="ep-card">
            <header className="ep-card-head">
              <h3>
                <BadgeCheck size={18} /> ประสิทธิภาพการทำงาน <span>(Performance)</span>
              </h3>
            </header>
            {perf.score === null ? (
              <p className="ep-none">ยังไม่มีผลประเมิน — เพิ่ม KPI ของพนักงานคนนี้ที่หน้าประเมินผลงาน</p>
            ) : (
              <div className="ep-perf">
                <div className="ep-gauge">
                  <Gauge value={perf.score / 5} />
                  <b>
                    {perf.score.toFixed(1)} <small>/ 5.0</small>
                  </b>
                  <em>
                    <ShieldCheck size={13} /> {ratingLabel(perf.score)}
                  </em>
                </div>
                {perf.lines.length ? (
                  <ul className="ep-bars">
                    {perf.lines.slice(0, 5).map((l) => (
                      <li key={l.id}>
                        <span title={l.label}>{l.label}</span>
                        <i>
                          <span style={{ width: (l.value / 5) * 100 + "%" }} />
                        </i>
                        <b>{l.value.toFixed(1)}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ep-none">จากคะแนนประเมินในโปรไฟล์ ({Number(d.score)} / 100) · ยังไม่มี KPI รายข้อ</p>
                )}
              </div>
            )}
          </section>
          <section className="ep-card">
            <header className="ep-card-head">
              <h3>
                <CalendarDays size={18} /> สรุปการเข้า-ออกงาน <span>(เดือนนี้)</span>
              </h3>
            </header>
            <MonthBlock month={month} />
          </section>
          <section className="ep-card">
            <header className="ep-card-head">
              <h3>
                <Gem size={18} /> ทักษะ & ความสามารถ <span>(Top Skills)</span>
              </h3>
              {writable && (
                <button className="ep-ghost accent" onClick={() => setTab("skills")}>
                  <Plus size={14} /> เพิ่มทักษะ
                </button>
              )}
            </header>
            {skills.length ? (
              <div className="ep-chips">
                {skills.slice(0, 8).map((s) => (
                  <em key={s}>{s}</em>
                ))}
              </div>
            ) : (
              <p className="ep-none">ยังไม่มีทักษะ</p>
            )}
          </section>
          <section className="ep-card ep-strengths">
            <header className="ep-card-head">
              <h3>
                <Sparkles size={18} /> บุคลิก & จุดแข็ง
              </h3>
              {writable && hasStrengths && (
                <button className="ep-ghost" onClick={() => setTab("skills")}>
                  <Pencil size={14} />
                </button>
              )}
            </header>
            <div className="ep-strength-body">
              {strengths.length ? (
                <ul className="ep-checks">
                  {strengths.slice(0, 4).map((s) => (
                    <li key={s}>
                      <Check size={12} /> {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ep-none">{String(d.about || "") || "ยังไม่ได้บันทึกจุดแข็ง"}</p>
              )}
              <Trophy />
            </div>
          </section>
        </div>
      )}
      {tab === "kpi" && (
        <section className="ep-card">
          <header className="ep-card-head">
            <h3>
              <ChartNoAxesColumn size={18} /> ผลงาน (KPI/OKR)
            </h3>
            <button className="ep-ghost accent" onClick={() => navigate("kpi")}>
              ไปหน้าประเมินผลงาน
            </button>
          </header>
          {!mine.kpi.length ? (
            <p className="ep-none">ยังไม่มี KPI ของพนักงานคนนี้</p>
          ) : (
            <div className="ep-table-wrap">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th>เป้าหมาย / KPI</th>
                    <th>รอบ</th>
                    <th className="num">เป้า</th>
                    <th className="num">ผลที่ได้</th>
                    <th>ความคืบหน้า</th>
                    <th className="num">คะแนน</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.kpi.map((r) => {
                    const l = kpiLine(r);
                    return (
                      <tr key={r.id}>
                        <td>{String(r.data.objective || r.data.name)}</td>
                        <td>{String(r.data.period || "—")}</td>
                        <td className="num">{l?.target ?? "—"}</td>
                        <td className="num">{l?.actual ?? "—"}</td>
                        <td>
                          {l?.progress !== null && l?.progress !== undefined ? (
                            <span className="ep-progress">
                              <i>
                                <span style={{ width: Math.min(100, l.progress) + "%" }} />
                              </i>
                              {l.progress}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="num">{l ? l.value.toFixed(1) : "—"}</td>
                        <td>{String(r.data.status || "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === "attendance" && (
        <section className="ep-card">
          <header className="ep-card-head">
            <h3>
              <Clock size={18} /> การเข้า-ออกงาน <span>(เดือนนี้)</span>
            </h3>
            <button className="ep-ghost accent" onClick={() => navigate("attendance")}>
              ไปหน้าเวลาเข้า-ออกงาน
            </button>
          </header>
          <MonthBlock month={month} />
          {(() => {
            const rowsThisMonth = mine.attendance
              .filter((r) => String(r.data.date || "").startsWith(today.slice(0, 7)))
              .sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
            return !rowsThisMonth.length ? (
              <p className="ep-none">ยังไม่มีบันทึกเวลาเดือนนี้</p>
            ) : (
              <div className="ep-table-wrap">
                <table className="ep-table">
                  <thead>
                    <tr>
                      <th>วันที่</th>
                      <th>เข้า</th>
                      <th>ออก</th>
                      <th className="num">ชั่วโมง</th>
                      <th className="num">สาย (นาที)</th>
                      <th>สถานะ</th>
                      <th>สถานที่</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsThisMonth.map((r) => {
                      const k = attendanceKind(r.data);
                      return (
                        <tr key={r.id}>
                          <td>{displayDate(r.data.date)}</td>
                          <td>{String(r.data.checkIn || "—")}</td>
                          <td>{String(r.data.checkOut || "—")}</td>
                          <td className="num">{Number(r.data.hours) || "—"}</td>
                          <td className="num">{Number(r.data.late) || "—"}</td>
                          <td>
                            <em className={"ep-badge " + (k === "present" ? "ok" : k === "late" ? "warn" : k === "absent" ? "off" : "info")}>
                              {String(r.data.status || (k === "present" ? "ปกติ" : "—"))}
                            </em>
                          </td>
                          <td>{String(r.data.location || "—")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </section>
      )}
      {tab === "leave" && (
        <section className="ep-card">
          <header className="ep-card-head">
            <h3>
              <FileText size={18} /> การลา
            </h3>
            <button className="ep-ghost accent" onClick={() => navigate("leaves")}>
              ไปหน้าการลา & อนุมัติ
            </button>
          </header>
          <div className="ep-mini four">
            <div>
              <small>สิทธิ์ลาพักร้อน / ปี</small>
              <b>{balance.quota ?? "—"}</b>
            </div>
            <div className="orange">
              <small>ใช้ไปแล้ว (ปีนี้)</small>
              <b>{balance.used}</b>
            </div>
            <div className="green">
              <small>คงเหลือ</small>
              <b>{balance.left ?? "—"}</b>
            </div>
            <div className="violet">
              <small>รออนุมัติ</small>
              <b>{balance.pending}</b>
            </div>
          </div>
          {!mine.leaves.length ? (
            <p className="ep-none">ยังไม่มีคำขอลา</p>
          ) : (
            <div className="ep-table-wrap">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th>ประเภท</th>
                    <th>ตั้งแต่</th>
                    <th>ถึง</th>
                    <th>เหตุผล</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...mine.leaves]
                    .sort((a, b) => String(b.data.startDate).localeCompare(String(a.data.startDate)))
                    .map((r) => (
                      <tr key={r.id}>
                        <td>{String(r.data.type || r.data.name)}</td>
                        <td>{displayDate(r.data.startDate)}</td>
                        <td>{displayDate(r.data.endDate || r.data.startDate)}</td>
                        <td>{String(r.data.notes || "—")}</td>
                        <td>
                          <em className={"ep-badge " + (r.data.status === "approved" ? "ok" : r.data.status === "rejected" ? "off" : "warn")}>
                            {statusLabels[String(r.data.status)] || String(r.data.status || "—")}
                          </em>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === "skills" && <SkillsTab e={e} writable={writable} patch={patch} />}
      {tab === "files" && (
        <section className="ep-card">
          {sample ? (
            <p className="ep-none">ตัวอย่าง: เอกสารของพนักงาน (สัญญาจ้าง สำเนาบัตร ใบรับรอง) จะแสดงที่นี่เมื่อมีข้อมูลจริง</p>
          ) : (
            <EntityFiles entity={e.id} department="HR" writable={writable} />
          )}
        </section>
      )}
      {tab === "history" && <HistoryTab e={e} writable={writable} patch={patch} />}
    </>
  );
}

function IdCard({ e, company, portraits, sample }: { e: Entity; company: string; portraits: Record<string, string>; sample: boolean }) {
  const d = e.data;
  const qr = useMemo(() => qrMatrix([d.code, d.name, company].filter(Boolean).map(String).join(" · ")), [d.code, d.name, company]);
  return (
    <section className="ep-idcard" aria-label="บัตรพนักงาน">
      {sample && <span className="sample-badge ep-id-badge">ตัวอย่าง</span>}
      <div className="ep-id-brand">
        <img src="/brand/eliteflow-mark.png" alt="" width={22} height={22} />
        EliteFlow
      </div>
      <div className="ep-id-body">
        <span className="ep-id-photo">
          {d.photo ? <img src={photoUrl(d.photo)} alt="" /> : <Face e={e} size={112} portraits={portraits} />}
        </span>
        <div className="ep-id-text">
          {!!d.code && <em className="ep-id-code">{String(d.code)}</em>}
          <h2>{String(d.name)}</h2>
          <p>{String(d.position || "—")}</p>
          {!!d.nickname && <small>ชื่อเล่น {String(d.nickname)}</small>}
        </div>
      </div>
      <div className="ep-id-foot">
        {qr && <QrSvg m={qr} />}
        <span>
          <b>{company}</b>
          <small>{deptName(d.department)}</small>
        </span>
      </div>
    </section>
  );
}

function QrSvg({ m }: { m: boolean[][] }) {
  const n = m.length,
    path = m.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + 2} ${y + 2}h1v1h-1z` : ""))).join("");
  return (
    <svg className="ep-qr" viewBox={`0 0 ${n + 4} ${n + 4}`} role="img" aria-label="QR รหัสพนักงาน" shapeRendering="crispEdges">
      <rect width={n + 4} height={n + 4} fill="#fff" />
      <path d={path} fill="#1d1b2f" />
    </svg>
  );
}

function Gauge({ value }: { value: number }) {
  return (
    <svg viewBox="0 0 120 68" className="ep-gauge-svg" aria-hidden="true">
      <defs>
        <linearGradient id="ep-gauge" x1="0" x2="1">
          <stop offset="0" stopColor="#f0a6e0" />
          <stop offset="1" stopColor="#7952dd" />
        </linearGradient>
      </defs>
      <path d="M10 60a50 50 0 0 1 100 0" fill="none" stroke="#efeaf9" strokeWidth="11" strokeLinecap="round" />
      <path d="M10 60a50 50 0 0 1 100 0" fill="none" stroke="url(#ep-gauge)" strokeWidth="11" strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.max(0, Math.min(1, value)) * 100} 100`} />
    </svg>
  );
}

function MonthBlock({ month }: { month: ReturnType<typeof monthAttendance> }) {
  const has = month.recorded > 0;
  return (
    <div className="ep-month">
      <div className="ep-mini">
        <div className="green">
          <small>
            <Check size={12} /> มาทำงาน
          </small>
          <b>
            {has ? month.present : "—"} <span>วัน</span>
          </b>
        </div>
        <div className="orange">
          <small>ลา</small>
          <b>
            {has ? month.leave : "—"} <span>วัน</span>
          </b>
        </div>
        <div className="red">
          <small>สาย</small>
          <b>
            {has ? month.late : "—"} <span>ครั้ง</span>
          </b>
        </div>
        <div>
          <small>ขาด</small>
          <b>
            {has ? month.absent : "—"} <span>วัน</span>
          </b>
        </div>
      </div>
      <div className="ep-ring">
        <small>อัตราการมาทำงาน</small>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#e9f6ee" strokeWidth="11" />
          {month.rate !== null && (
            <circle cx="50" cy="50" r="40" fill="none" stroke="#22b45f" strokeWidth="11" strokeLinecap="round" pathLength={100} strokeDasharray={`${month.rate} 100`} transform="rotate(-90 50 50)" />
          )}
        </svg>
        <b>{month.rate !== null ? month.rate + "%" : "—"}</b>
        <span>{has ? `(${month.present}/${month.recorded} วัน)` : "ยังไม่มีบันทึก"}</span>
      </div>
    </div>
  );
}

function SkillsTab({ e, writable, patch }: { e: Entity; writable: boolean; patch: (e: Entity, c: Record<string, unknown>, m?: string) => Promise<boolean> }) {
  const skills = listOf(e.data.skills),
    strengths = listOf(e.data.strengths);
  const [skill, setSkill] = useState(""),
    [strength, setStrength] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (change: Record<string, unknown>, message: string) => {
    setBusy(true);
    const ok = await patch(e, change, message);
    setBusy(false);
    return ok;
  };
  return (
    <div className="ep-overview">
      <section className="ep-card">
        <header className="ep-card-head">
          <h3>
            <Gem size={18} /> ทักษะ & ความสามารถ
          </h3>
        </header>
        {skills.length ? (
          <div className="ep-chips">
            {skills.map((s) => (
              <em key={s}>
                {s}
                {writable && (
                  <button aria-label={"ลบ " + s} disabled={busy} onClick={() => run({ skills: skills.filter((x) => x !== s).join(", ") }, "ลบทักษะแล้ว")}>
                    <X size={12} />
                  </button>
                )}
              </em>
            ))}
          </div>
        ) : (
          <p className="ep-none">ยังไม่มีทักษะ</p>
        )}
        {writable && (
          <form
            className="ep-add"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const v = skill.replace(/,/g, " ").trim();
              if (!v || skills.includes(v)) return setSkill("");
              if (await run({ skills: [...skills, v].join(", ") }, "เพิ่มทักษะแล้ว")) setSkill("");
            }}
          >
            <input maxLength={40} placeholder="เช่น การวางแผน" value={skill} onChange={(ev) => setSkill(ev.target.value)} aria-label="ทักษะใหม่" />
            <button className="secondary" disabled={busy || !skill.trim()}>
              <Plus size={14} /> เพิ่มทักษะ
            </button>
          </form>
        )}
      </section>
      <section className="ep-card">
        <header className="ep-card-head">
          <h3>
            <Sparkles size={18} /> บุคลิก & จุดแข็ง
          </h3>
        </header>
        {strengths.length ? (
          <ul className="ep-checks">
            {strengths.map((s) => (
              <li key={s}>
                <Check size={12} /> {s}
                {writable && hasStrengths && (
                  <button aria-label={"ลบ " + s} disabled={busy} onClick={() => run({ strengths: strengths.filter((x) => x !== s).join("\n") }, "ลบแล้ว")}>
                    <X size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-none">ยังไม่ได้บันทึกจุดแข็ง</p>
        )}
        {writable && hasStrengths ? (
          <form
            className="ep-add"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const v = strength.replace(/[,\n]/g, " ").trim();
              if (!v) return;
              if (await run({ strengths: [...strengths, v].join("\n") }, "เพิ่มจุดแข็งแล้ว")) setStrength("");
            }}
          >
            <input maxLength={80} placeholder="เช่น สื่อสารชัดเจน" value={strength} onChange={(ev) => setStrength(ev.target.value)} aria-label="จุดแข็งใหม่" />
            <button className="secondary" disabled={busy || !strength.trim()}>
              <Plus size={14} /> เพิ่ม
            </button>
          </form>
        ) : (
          !hasStrengths && <small className="muted">ยังไม่มีช่องบันทึกจุดแข็งในทะเบียนพนักงาน</small>
        )}
      </section>
    </div>
  );
}

function HistoryTab({ e, writable, patch }: { e: Entity; writable: boolean; patch: (e: Entity, c: Record<string, unknown>, m?: string) => Promise<boolean> }) {
  const list = parseHistory(e.data.history);
  const [entry, setEntry] = useState<HistoryItem>({ date: bangkokToday(), title: "", detail: "" }),
    [busy, setBusy] = useState(false);
  return (
    <section className="ep-card">
      <header className="ep-card-head">
        <h3>
          <History size={18} /> ประวัติการทำงาน <span>อายุงาน {tenure(e.data.startDate)}</span>
        </h3>
      </header>
      {writable && (
        <form
          className="ep-add three"
          onSubmit={async (ev) => {
            ev.preventDefault();
            setBusy(true);
            const ok = await patch(e, { history: JSON.stringify([{ date: entry.date, title: entry.title.trim(), detail: entry.detail?.trim() || undefined }, ...list]) }, "เพิ่มประวัติแล้ว");
            setBusy(false);
            if (ok) setEntry((x) => ({ ...x, title: "", detail: "" }));
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
      {!list.length ? (
        <p className="ep-none">{e.data.startDate ? "เริ่มงาน " + displayDate(e.data.startDate) : "ยังไม่มีประวัติ"}</p>
      ) : (
        <ol className="dir-timeline">
          {list.map((h, i) => (
            <li key={i}>
              <small>{displayDate(h.date)}</small>
              <b>{h.title}</b>
              {h.detail && <span>{h.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Trophy() {
  return (
    <svg className="ep-trophy" viewBox="0 0 90 90" aria-hidden="true">
      <defs>
        <linearGradient id="ep-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd86b" />
          <stop offset="1" stopColor="#f0a52a" />
        </linearGradient>
        <linearGradient id="ep-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a58bf0" />
          <stop offset="1" stopColor="#6a48d6" />
        </linearGradient>
      </defs>
      <path d="M28 14h34v16a17 17 0 0 1-34 0z" fill="url(#ep-gold)" />
      <path d="M28 18H18a10 10 0 0 0 12 14M62 18h10a10 10 0 0 1-12 14" fill="none" stroke="#f0a52a" strokeWidth="4" strokeLinecap="round" />
      <path d="m45 19 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#fff" opacity=".9" />
      <rect x="41" y="46" width="8" height="10" fill="#f0a52a" />
      <rect x="31" y="56" width="28" height="7" rx="2" fill="url(#ep-gold)" />
      <rect x="22" y="63" width="46" height="14" rx="4" fill="url(#ep-base)" />
      <circle cx="14" cy="22" r="2" fill="#c9b8f6" />
      <circle cx="78" cy="12" r="2.5" fill="#ffd86b" />
      <path d="M76 40l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z" fill="#c9b8f6" />
    </svg>
  );
}
