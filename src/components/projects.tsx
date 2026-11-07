"use client";
// โครงการ (Projects): the list (Canva page 13: cards / timeline / calendar / report) and one project's page
// (page 14), opened at /workspace/projects?id=<id>. Figures come from /api/projects (src/lib/projects.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowUpDown,
  CalendarDays,
  CalendarRange,
  Camera,
  ChartColumn,
  ChartGantt,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  ClipboardList,
  Clock3,
  Download,
  EllipsisVertical,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileImage,
  FolderKanban,
  Layers,
  LayoutGrid,
  List,
  ListFilter,
  ListTodo,
  MapPin,
  MessageCircle,
  Pause,
  Pencil,
  PencilRuler,
  Play,
  Plus,
  Receipt,
  Search,
  Star,
  Target,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  Eye,
  Sparkles,
} from "lucide-react";
import type { Context } from "@/lib/types";
import type {
  ActivityItem,
  CalendarItem,
  DocItem,
  LiteRow,
  Person,
  ProjectCard,
  ProjectDetailData,
  ProjectsOverview,
  SeriesPoint,
} from "@/lib/projects";
import { projectWorkflow } from "@/lib/zetta";
import { statusLabels } from "@/lib/catalog";
import { api, Empty, Loading, Modal, money } from "./shared";
import { photoUrl } from "./records";
import { uploadFile } from "./platform";
import { ProjectStages } from "./project-stages";
import { EntityFiles } from "./entity-files";
import { isSampleId, sampleDetail, sampleOverview, type SampleDetail, type SampleExtras } from "@/lib/mock/projects";

type PageProps = {
  ctx: Context;
  notify: (s: string) => void;
  changed: () => void;
  navigate: (view: string) => void;
};

// ---------------------------------------------------------------- shared bits

const STATUS: Record<string, { label: string; tone: string; icon: typeof Play }> = {
  planning: { label: "วางแผน", tone: "plan", icon: PencilRuler },
  active: { label: "กำลังดำเนินการ", tone: "active", icon: Play },
  review: { label: "รอตรวจทาน", tone: "review", icon: Eye },
  paused: { label: "พักชั่วคราว", tone: "paused", icon: Pause },
  completed: { label: "เสร็จสิ้น", tone: "done", icon: CircleCheck },
  cancelled: { label: "ยกเลิก", tone: "cancel", icon: CircleX },
};
const statusOrder = ["planning", "active", "review", "paused", "completed", "cancelled"];
const statusOf = (s: string) => STATUS[s] || { label: statusLabels[s] || s || "—", tone: "plan", icon: PencilRuler };

function StatusChip({ status, solid }: { status: string; solid?: boolean }) {
  const s = statusOf(status);
  return (
    <span className={"pj-chip pj-tone-" + s.tone + (solid ? " solid" : "")}>
      <s.icon size={12} />
      {s.label}
    </span>
  );
}

const thDate = (s: unknown) => {
  const v = String(s || "");
  if (!v) return "—";
  const d = new Date(v.length === 10 ? v + "T00:00:00+07:00" : v);
  return Number.isNaN(+d)
    ? "—"
    : d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
};
const thDateTime = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(+d)
    ? "—"
    : d.toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};
const range = (a: string, b: string) => (a || b ? `${thDate(a)} – ${thDate(b)}` : "ยังไม่กำหนดวัน");
const baht = (n: number) => money(n) + " บาท";
const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return Math.round((n / 1e6) * 100) / 100 + "M";
  if (a >= 1e3) return Math.round((n / 1e3) * 10) / 10 + "K";
  return String(Math.round(n));
};
const pct = (v: number, t: number) => (t > 0 ? Math.max(0, Math.min(100, Math.round((v / t) * 100))) : 0);
const thMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thMonthsLong = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
// FNV-1a over the id, spread across 8 well-separated hues so neighbouring ids (demo rows) do not share a colour.
const hue = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return [262, 210, 330, 160, 28, 190, 290, 120][(h >>> 0) % 8];
};

function Avatar({ person, size = 32 }: { person: Pick<Person, "name" | "photo">; size?: number }) {
  return person.photo ? (
    <img className="pj-avatar" src={photoUrl(person.photo)} alt={person.name} width={size} height={size} loading="lazy" />
  ) : (
    <span
      className="pj-avatar initials"
      title={person.name}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue(person.name)} 60% 92%)`, color: `hsl(${hue(person.name)} 45% 38%)` }}
    >
      {person.name.trim()[0] || "?"}
    </span>
  );
}

function AvatarStack({ people, max = 3, size = 26 }: { people: Person[]; max?: number; size?: number }) {
  if (!people.length) return <span className="pj-muted">—</span>;
  return (
    <span className="pj-stack" title={people.map((p) => p.name).join(", ")}>
      {people.slice(0, max).map((p) => (
        <Avatar key={p.id || p.name} person={p} size={size} />
      ))}
      {people.length > max && <span className="pj-avatar more" style={{ width: size, height: size }}>+{people.length - max}</span>}
    </span>
  );
}

function Cover({ project, className = "" }: { project: ProjectCard; className?: string }) {
  const src = project.cover ? photoUrl(project.cover) : project.sample;
  if (src) return <img className={"pj-cover " + className} src={src} alt={project.name} loading="lazy" />;
  const h = hue(project.id);
  return (
    <span
      className={"pj-cover pj-cover-empty " + className}
      style={{ background: `linear-gradient(135deg, hsl(${h} 70% 90%), hsl(${(h + 40) % 360} 75% 82%))` }}
      aria-hidden
    >
      <FolderKanban size={34} style={{ color: `hsl(${h} 45% 45%)` }} />
    </span>
  );
}

function Bar({ value, tone = "accent" }: { value: number; tone?: string }) {
  return (
    <span className={"pj-bar pj-bar-" + tone} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: Math.max(0, Math.min(100, value)) + "%" }} />
    </span>
  );
}

function Ring({ value, size = 92, stroke = 9, color = "var(--accent)", label }: { value: number; size?: number; stroke?: number; color?: string; label?: string }) {
  const r = (size - stroke) / 2,
    c = 2 * Math.PI * r;
  return (
    <span className="pj-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eeeaf8" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * Math.max(0, Math.min(100, value))) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <b>{label ?? value + "%"}</b>
    </span>
  );
}

// Per-user favourites (this browser only).
function useStars(userId: string) {
  const key = "eliteflow:project-stars:" + userId;
  const [stars, setStars] = useState<string[]>([]);
  useEffect(() => {
    try {
      setStars(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      setStars([]);
    }
  }, [key]);
  const toggle = useCallback(
    (id: string) =>
      setStars((s) => {
        const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {}
        return next;
      }),
    [key],
  );
  return { stars, toggle };
}

const canEdit = (ctx: Context) => ctx.member.role === "owner" || (ctx.member.role !== "viewer" && ctx.member.departments.includes("Operations"));
const canArchive = (ctx: Context) => ["owner", "manager"].includes(ctx.member.role);

// Mockup mode ("ดูตัวอย่าง"): the Canva design filled with fictional projects from src/lib/mock/projects.ts, shown
// automatically while the company has no projects and on demand from the toolbar. Sample and real projects never mix,
// and nothing can be written while it is on.
const SAMPLE_LOCKED = "โหมดตัวอย่าง — ปิดตัวอย่างก่อนจึงจะแก้ไขได้";
function SampleBadge() {
  return <span className="pj-sample-badge">ตัวอย่าง</span>;
}
function SampleBanner({ onClose, onAdd }: { onClose: () => void; onAdd?: () => void }) {
  return (
    <div className="pj-sample-banner" role="status">
      <Sparkles size={18} />
      <p>
        <b>กำลังดูตัวอย่าง — ข้อมูลสมมติ</b> โครงการ ตัวเลข และรายชื่อในหน้านี้แต่งขึ้นเพื่อให้เห็นหน้าตาเมื่อใช้งานจริง
        ไม่ได้บันทึกลงระบบและไม่ปนกับโครงการจริง ตัวอย่างจะไม่แสดงเองอีกเมื่อมีโครงการจริงแล้ว
      </p>
      <span className="pj-sample-actions">
        <button className="secondary" onClick={onClose}>
          ปิดตัวอย่าง
        </button>
        {onAdd && (
          <button className="pj-primary" onClick={onAdd}>
            <Plus size={15} />
            เพิ่มโครงการจริง
          </button>
        )}
      </span>
    </div>
  );
}

export function ProjectsPage(props: PageProps) {
  const id = useSearchParams().get("id");
  return id ? <ProjectDetail key={id} id={id} {...props} /> : <ProjectList {...props} />;
}

// ---------------------------------------------------------------- list (page 13)

type View = "overview" | "timeline" | "calendar" | "report";
type Group = "all" | "active" | "completed" | "paused" | "cancelled";
const groupOf: Record<Group, string[] | null> = {
  all: null,
  active: ["planning", "active", "review"],
  completed: ["completed"],
  paused: ["paused"],
  cancelled: ["cancelled"],
};
const sorts = {
  recent: "ล่าสุด",
  name: "ชื่อโครงการ",
  start: "วันเริ่ม",
  end: "วันสิ้นสุด",
  budget: "งบประมาณ",
  progress: "ความคืบหน้า",
} as const;

function ProjectList({ ctx, notify, changed }: PageProps) {
  const router = useRouter();
  const params = useSearchParams();
  // null = automatic (sample only while the company has no projects); ?sample=1 / ?sample=0 come back from a sample detail page.
  const [preview, setPreview] = useState<boolean | null>(() => (params.get("sample") === "1" ? true : params.get("sample") === "0" ? false : null));
  const [data, setData] = useState<ProjectsOverview | null>(null),
    [error, setError] = useState(""),
    [view, setView] = useState<View>("overview"),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState<Group>("all"),
    [status, setStatus] = useState(""),
    [onlyStarred, setOnlyStarred] = useState(false),
    [filterOpen, setFilterOpen] = useState(false),
    [sort, setSort] = useState<keyof typeof sorts>("recent"),
    [layout, setLayout] = useState<"grid" | "list">("grid"),
    [editing, setEditing] = useState<ProjectCard | "new" | null>(null),
    [archiving, setArchiving] = useState<ProjectCard | null>(null),
    [busy, setBusy] = useState(false);
  const { stars, toggle } = useStars(ctx.user.id);
  const load = useCallback(
    () =>
      api("/projects")
        .then((d: ProjectsOverview) => {
          setData(d);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  // Sample projects only in the public demo; a real company sees its own projects or the empty state.
  const showing = ctx.demo && !!data && (preview ?? !data.projects.length);
  const shown = showing ? sampleOverview : data;
  const open = (id: string) => router.push("/workspace/projects?id=" + id);
  const writable = canEdit(ctx);
  // "+ เพิ่มโครงการจริง" on a sample detail page lands here with ?add=1.
  const addAsked = useRef(params.get("add") === "1");
  useEffect(() => {
    if (data && addAsked.current) {
      addAsked.current = false;
      if (writable) setEditing("new");
    }
  }, [data, writable]);
  const rows = useMemo(() => {
    if (!shown) return [];
    const q = search.trim().toLowerCase();
    const only = groupOf[group];
    const list = shown.projects.filter(
      (p) =>
        (!only || only.includes(p.status)) &&
        (!status || p.status === status) &&
        (!onlyStarred || (!showing && stars.includes(p.id))) &&
        (!q || [p.name, p.code, p.subtitle, p.owner?.name, p.data.location, p.data.type].some((x) => String(x || "").toLowerCase().includes(q))),
    );
    const by: Record<keyof typeof sorts, (a: ProjectCard, b: ProjectCard) => number> = {
      recent: (a, b) => b.updated_at.localeCompare(a.updated_at),
      name: (a, b) => a.name.localeCompare(b.name, "th"),
      start: (a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999"),
      end: (a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999"),
      budget: (a, b) => b.budget - a.budget,
      progress: (a, b) => b.progress - a.progress,
    };
    return [...list].sort(by[sort]);
  }, [shown, showing, search, group, status, onlyStarred, stars, sort]);
  if (!data || !shown) return error ? <Empty title={error} /> : <Loading />;
  const c = shown.counts;
  const addReal = () => {
    setPreview(false);
    setEditing("new");
  };
  const tiles: [Group, string, number, typeof Play][] = [
    ["all", "ทั้งหมด", c.all, FolderKanban],
    ["active", "กำลังดำเนินการ", c.active, Play],
    ["completed", "เสร็จสิ้น", c.completed, Check],
    ["paused", "พักชั่วคราว", c.paused, Pause],
    ["cancelled", "ยกเลิก", c.cancelled, CircleX],
  ];
  const filters = (status ? 1 : 0) + (onlyStarred ? 1 : 0);
  return (
    <div className="pj-page">
      <header className="pj-head">
        <div className="pj-head-title">
          <span className="pj-illu" aria-hidden>
            <ClipboardList size={46} strokeWidth={1.6} />
            <Target size={30} className="pj-illu-target" />
          </span>
          <div>
            <h1>โครงการ (Projects)</h1>
            <p>จัดการทุกโครงการขององค์กร ติดตามความคืบหน้า งบประมาณ และเป้าหมายขายได้ในที่เดียว</p>
          </div>
        </div>
        <div className="pj-tiles">
          {tiles.map(([key, label, n, Icon]) => (
            <button key={key} className={"pj-tile pj-tile-" + key + (group === key ? " on" : "")} onClick={() => setGroup(group === key && key !== "all" ? "all" : key)} aria-pressed={group === key}>
              <span className="pj-tile-icon">
                <Icon size={17} />
              </span>
              <span>
                <small>{label}</small>
                <b>
                  {n} <em>โครงการ</em>
                </b>
              </span>
            </button>
          ))}
        </div>
      </header>

      <div className="pj-toolbar">
        <nav className="pj-views" aria-label="มุมมอง">
          {(
            [
              ["overview", "ภาพรวมโครงการ", LayoutGrid],
              ["timeline", "ไทม์ไลน์ (Timeline)", ChartGantt],
              ["calendar", "ปฏิทิน (Calendar)", CalendarDays],
              ["report", "รายงาน (Report)", ChartColumn],
            ] as [View, string, typeof Play][]
          ).map(([key, label, Icon]) => (
            <button key={key} className={view === key ? "on" : ""} onClick={() => setView(key)} aria-pressed={view === key}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
        <div className="pj-tools">
          <label className="pj-search">
            <Search size={15} />
            <input placeholder="ค้นหาโครงการ..." aria-label="ค้นหาโครงการ" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="pj-pop-wrap">
            <button className={"pj-tool" + (filters ? " on" : "")} onClick={() => setFilterOpen(!filterOpen)} aria-expanded={filterOpen}>
              <ListFilter size={15} />
              ตัวกรอง{filters ? ` (${filters})` : ""}
            </button>
            {filterOpen && (
              <>
                <button className="pj-pop-backdrop" aria-label="ปิดตัวกรอง" onClick={() => setFilterOpen(false)} />
                <div className="pj-pop">
                  <label>
                    สถานะ
                    <select value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="">ทุกสถานะ</option>
                      {statusOrder.map((s) => (
                        <option key={s} value={s}>
                          {statusOf(s).label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pj-check">
                    <input type="checkbox" checked={onlyStarred} onChange={(e) => setOnlyStarred(e.target.checked)} />
                    เฉพาะที่ติดดาว
                  </label>
                  <button
                    className="pj-link"
                    onClick={() => {
                      setStatus("");
                      setOnlyStarred(false);
                      setGroup("all");
                    }}
                  >
                    ล้างตัวกรอง
                  </button>
                </div>
              </>
            )}
          </div>
          <label className="pj-tool pj-sort">
            <ArrowUpDown size={15} />
            <span>จัดเรียง:</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as keyof typeof sorts)} aria-label="จัดเรียง">
              {Object.entries(sorts).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {view === "overview" && (
            <span className="pj-layout">
              <button className={layout === "grid" ? "on" : ""} aria-label="มุมมองการ์ด" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}>
                <LayoutGrid size={16} />
              </button>
              <button className={layout === "list" ? "on" : ""} aria-label="มุมมองรายการ" aria-pressed={layout === "list"} onClick={() => setLayout("list")}>
                <List size={16} />
              </button>
            </span>
          )}
          {ctx.demo && <button
            className={"pj-tool pj-sample-toggle" + (showing ? " on" : "")}
            aria-pressed={showing}
            onClick={() => setPreview(!showing)}
            title={showing ? "กลับไปดูโครงการจริง" : "ดูหน้าตาเมื่อมีโครงการครบ (ข้อมูลสมมติ)"}
          >
            <Sparkles size={15} />
            {showing ? "ปิดตัวอย่าง" : "ดูตัวอย่าง"}
          </button>}
          {writable && (
            <button className="pj-primary" onClick={() => setEditing("new")} disabled={showing} title={showing ? "ปิดตัวอย่างก่อน แล้วจึงเพิ่มโครงการจริง" : undefined}>
              <Plus size={16} />
              เพิ่มโครงการ
            </button>
          )}
        </div>
      </div>

      {showing && <SampleBanner onClose={() => setPreview(false)} onAdd={writable ? addReal : undefined} />}
      {error && <p className="form-error">{error}</p>}
      {!shown.projects.length ? (
        <section className="pj-card">
          <Empty
            title="ยังไม่มีโครงการ"
            description="เพิ่มโครงการแรกเพื่อเริ่มติดตามงบประมาณ ยอดขาย และความคืบหน้า"
            action={
              writable ? (
                <button className="primary" onClick={() => setEditing("new")}>
                  <Plus size={15} />
                  เพิ่มโครงการ
                </button>
              ) : undefined
            }
          />
        </section>
      ) : !rows.length ? (
        <section className="pj-card">
          <Empty title="ไม่พบโครงการที่ตรงกับเงื่อนไข" />
        </section>
      ) : view === "overview" ? (
        layout === "grid" ? (
          <div className="pj-grid">
            {rows.map((p) => (
              <ProjectTile
                key={p.id}
                p={p}
                sample={showing}
                starred={!showing && stars.includes(p.id)}
                star={() => toggle(p.id)}
                open={() => open(p.id)}
                edit={writable && !showing ? () => setEditing(p) : undefined}
                archive={canArchive(ctx) && !showing ? () => setArchiving(p) : undefined}
              />
            ))}
          </div>
        ) : (
          <ProjectRows rows={rows} stars={showing ? [] : stars} toggle={toggle} open={open} sample={showing} />
        )
      ) : view === "timeline" ? (
        <Timeline rows={rows} today={shown.today} open={open} />
      ) : view === "calendar" ? (
        <ProjectCalendar key={shown.today} rows={rows} items={shown.calendar} today={shown.today} open={open} />
      ) : (
        <Report rows={rows} open={open} />
      )}

      {editing && (
        <ProjectForm
          project={editing === "new" ? undefined : editing}
          people={data.people}
          nextCode={data.nextCode}
          onClose={() => setEditing(null)}
          onSaved={async (id, created) => {
            setEditing(null);
            notify(created ? "เพิ่มโครงการแล้ว" : "บันทึกโครงการแล้ว");
            changed();
            if (created) open(id);
            else await load();
          }}
        />
      )}
      {archiving && (
        <Modal title="เก็บโครงการเข้าคลัง" onClose={() => setArchiving(null)}>
          <p className="confirm-message">{archiving.name}</p>
          <p className="muted">โครงการยังอยู่ในฐานข้อมูลและสามารถคืนจากคลังได้</p>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setArchiving(null)}>
              ยกเลิก
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/entities/projects/" + archiving.id, { method: "DELETE", body: { archived: true } });
                  setArchiving(null);
                  notify("เก็บโครงการเข้าคลังแล้ว");
                  changed();
                  await load();
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Archive size={15} />
              เก็บเข้าคลัง
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CardMenu({ open, edit, archive, note }: { open: () => void; edit?: () => void; archive?: () => void; note?: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="pj-pop-wrap">
      <button className="pj-icon-btn" aria-label="เมนูโครงการ" aria-expanded={show} onClick={() => setShow(!show)}>
        <EllipsisVertical size={15} />
      </button>
      {show && (
        <>
          <button className="pj-pop-backdrop" aria-label="ปิดเมนู" onClick={() => setShow(false)} />
          <div className="pj-pop pj-menu" onClick={() => setShow(false)}>
            <button onClick={open}>
              <Eye size={14} />
              ดูรายละเอียด
            </button>
            {edit && (
              <button onClick={edit}>
                <Pencil size={14} />
                แก้ไขโครงการ
              </button>
            )}
            {archive && (
              <button onClick={archive} className="danger">
                <Archive size={14} />
                เก็บเข้าคลัง
              </button>
            )}
            {note && <small className="pj-menu-note">{note}</small>}
          </div>
        </>
      )}
    </span>
  );
}

function stageText(p: ProjectCard) {
  if (!p.stageLabel) return null;
  return ["completed", "cancelled", "paused"].includes(p.status) ? p.stageLabel : `${p.stageLabel} (${p.progress}%)`;
}

function ProjectTile({
  p,
  sample,
  starred,
  star,
  open,
  edit,
  archive,
}: {
  p: ProjectCard;
  sample?: boolean;
  starred: boolean;
  star: () => void;
  open: () => void;
  edit?: () => void;
  archive?: () => void;
}) {
  const tone = statusOf(p.status).tone;
  return (
    <article className="pj-tile-card">
      <div className="pj-tile-media">
        <button className="pj-media-link" onClick={open} aria-label={"เปิด " + p.name}>
          <Cover project={p} />
        </button>
        <StatusChip status={p.status} solid />
        {sample && <SampleBadge />}
        <span className="pj-media-actions">
          <button
            className={"pj-icon-btn" + (starred ? " starred" : "")}
            aria-label={starred ? "เลิกติดดาว" : "ติดดาว"}
            aria-pressed={starred}
            onClick={star}
            disabled={sample}
            title={sample ? SAMPLE_LOCKED : undefined}
          >
            <Star size={15} fill={starred ? "currentColor" : "none"} />
          </button>
          <CardMenu open={open} edit={edit} archive={archive} note={sample ? SAMPLE_LOCKED : undefined} />
        </span>
      </div>
      <div className="pj-tile-body">
        <div className="pj-title-row">
          <button className="pj-title" onClick={open}>
            <FolderKanban size={15} />
            <span>{p.name}</span>
          </button>
          {p.code && <span className="pj-code">รหัส: {p.code}</span>}
        </div>
        {p.subtitle && <p className="pj-sub">{p.subtitle}</p>}
        <p className="pj-meta">
          <CalendarDays size={14} />
          {range(p.startDate, p.endDate)}
        </p>
        <div className="pj-owner-row">
          {p.owner ? (
            <span className="pj-owner">
              <Avatar person={p.owner} size={26} />
              <span>
                ดูแลโดย {p.owner.name}
                {p.owner.position && <small> ({p.owner.position})</small>}
              </span>
            </span>
          ) : (
            <span className="pj-owner pj-muted">
              <UserRound size={16} /> ยังไม่ระบุผู้ดูแล
            </span>
          )}
          <AvatarStack people={p.team} />
        </div>
        {stageText(p) && (
          <span className={"pj-stage pj-tone-" + tone}>
            <Layers size={13} />
            ขั้นตอน: {stageText(p)}
          </span>
        )}
        <dl className="pj-money">
          <div>
            <dt>
              <Wallet size={13} />
              งบประมาณ
            </dt>
            <dd>{p.budget ? baht(p.budget) : "—"}</dd>
          </div>
          <div>
            <dt>
              <Target size={13} />
              เป้าการขาย
            </dt>
            <dd>{p.salesTarget ? baht(p.salesTarget) : "—"}</dd>
          </div>
          <div>
            <dt>
              <TrendingUp size={13} />
              ยอดขายปัจจุบัน
            </dt>
            <dd>{p.sales ? baht(p.sales) : "—"}</dd>
          </div>
        </dl>
        <div className="pj-progress-row" title={p.progressSource === "stages" ? "คิดจากขั้นตอนโครงการ" : "คิดจากสถานะและช่วงวันที่"}>
          <Bar value={p.progress} tone={tone === "done" ? "done" : tone === "cancel" ? "cancel" : tone === "paused" ? "paused" : "accent"} />
          <b>{p.progress}%</b>
        </div>
      </div>
    </article>
  );
}

function ProjectRows({
  rows,
  stars,
  toggle,
  open,
  sample,
}: {
  rows: ProjectCard[];
  stars: string[];
  toggle: (id: string) => void;
  open: (id: string) => void;
  sample?: boolean;
}) {
  return (
    <section className="pj-card pj-rows">
      {rows.map((p) => (
        <div key={p.id} className="pj-row">
          <button
            className={"pj-icon-btn" + (stars.includes(p.id) ? " starred" : "")}
            aria-label="ติดดาว"
            onClick={() => toggle(p.id)}
            disabled={sample}
            title={sample ? SAMPLE_LOCKED : undefined}
          >
            <Star size={15} fill={stars.includes(p.id) ? "currentColor" : "none"} />
          </button>
          <button className="pj-row-main" onClick={() => open(p.id)}>
            <Cover project={p} className="thumb" />
            <span>
              <b>
                {p.name} {sample && <SampleBadge />}
              </b>
              <small>
                {p.code || "—"} · {range(p.startDate, p.endDate)}
              </small>
            </span>
          </button>
          <StatusChip status={p.status} />
          <span className="pj-row-owner">{p.owner ? p.owner.name : "—"}</span>
          <span className="pj-row-num">{p.budget ? baht(p.budget) : "—"}</span>
          <span className="pj-row-prog">
            <Bar value={p.progress} />
            <b>{p.progress}%</b>
          </span>
        </div>
      ))}
    </section>
  );
}

// Gantt-like bars between each project's start and end dates.
function Timeline({ rows, today, open }: { rows: ProjectCard[]; today: string; open: (id: string) => void }) {
  const dated = rows.filter((p) => p.startDate || p.endDate);
  if (!dated.length) return <section className="pj-card"><Empty title="ยังไม่มีโครงการที่กำหนดวัน" description="ใส่วันเริ่มและวันสิ้นสุดเพื่อดูไทม์ไลน์" /></section>;
  const t = (s: string) => Date.parse(s + "T00:00:00Z");
  const starts = dated.map((p) => t(p.startDate || p.endDate)),
    ends = dated.map((p) => t(p.endDate || p.startDate));
  const first = new Date(Math.min(...starts, t(today))),
    last = new Date(Math.max(...ends, t(today)));
  const from = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1),
    to = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1);
  const span = to - from;
  const months: { key: string; left: number; width: number; label: string }[] = [];
  for (let d = new Date(from); +d < to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    months.push({
      key: d.toISOString().slice(0, 7),
      left: ((+d - from) / span) * 100,
      width: ((next - +d) / span) * 100,
      label: `${thMonths[d.getUTCMonth()]} ${String((d.getUTCFullYear() + 543) % 100).padStart(2, "0")}`,
    });
  }
  const pos = (s: string) => ((t(s) - from) / span) * 100;
  return (
    <section className="pj-card pj-timeline">
      <div className="pj-tl-head">
        <span>โครงการ</span>
        <div className="pj-tl-scale">
          {months.map((m) => (
            <span key={m.key} style={{ left: m.left + "%", width: m.width + "%" }}>
              {m.label}
            </span>
          ))}
        </div>
      </div>
      {dated.map((p) => {
        const a = pos(p.startDate || p.endDate),
          b = pos(p.endDate || p.startDate) + (86400000 / span) * 100;
        return (
          <div className="pj-tl-row" key={p.id}>
            <button className="pj-tl-name" onClick={() => open(p.id)}>
              <b>{p.name}</b>
              <small>{range(p.startDate, p.endDate)}</small>
            </button>
            <div className="pj-tl-track">
              {months.map((m) => (
                <i key={m.key} className="pj-tl-grid" style={{ left: m.left + "%" }} />
              ))}
              <i className="pj-tl-today" style={{ left: pos(today) + "%" }} title="วันนี้" />
              <button
                className={"pj-tl-bar pj-tone-" + statusOf(p.status).tone}
                style={{ left: a + "%", width: Math.max(1.2, b - a) + "%" }}
                onClick={() => open(p.id)}
                title={`${p.name} · ${statusOf(p.status).label} · ${p.progress}%`}
              >
                <i style={{ width: p.progress + "%" }} />
                <span>{p.progress}%</span>
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// Month grid: project start / end days, project events and task due dates.
function ProjectCalendar({ rows, items, today, open }: { rows: ProjectCard[]; items: CalendarItem[]; today: string; open: (id: string) => void }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const y = Number(month.slice(0, 4)),
    m = Number(month.slice(5, 7)) - 1;
  const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay(),
    days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const ids = new Set(rows.map((p) => p.id)),
    names = new Map(rows.map((p) => [p.id, p.name]));
  type Mark = { key: string; kind: "start" | "end" | "event" | "task"; text: string; projectId: string };
  const marks = new Map<string, Mark[]>();
  const put = (date: string, mark: Mark) => {
    if (!date.startsWith(month)) return;
    marks.set(date, [...(marks.get(date) || []), mark]);
  };
  for (const p of rows) {
    if (p.startDate) put(p.startDate, { key: "s" + p.id, kind: "start", text: "เริ่ม: " + p.name, projectId: p.id });
    if (p.endDate) put(p.endDate, { key: "e" + p.id, kind: "end", text: "สิ้นสุด: " + p.name, projectId: p.id });
  }
  for (const i of items)
    if (ids.has(i.projectId))
      put(i.date, { key: i.id, kind: i.kind, text: (i.kind === "task" ? "งาน: " : "") + i.name + " · " + (names.get(i.projectId) || ""), projectId: i.projectId });
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <section className="pj-card pj-cal">
      <div className="pj-cal-head">
        <button className="pj-icon-btn" aria-label="เดือนก่อน" onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </button>
        <h3>
          {thMonthsLong[m]} {y + 543}
        </h3>
        <button className="pj-icon-btn" aria-label="เดือนถัดไป" onClick={() => shift(1)}>
          <ChevronRight size={16} />
        </button>
        <button className="pj-link" onClick={() => setMonth(today.slice(0, 7))}>
          วันนี้
        </button>
        <span className="pj-cal-legend">
          <i className="start" />เริ่มโครงการ <i className="end" />สิ้นสุด <i className="event" />อีเวนต์ <i className="task" />งาน
        </span>
      </div>
      <div className="pj-cal-grid">
        {["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."].map((d) => (
          <b key={d} className="pj-cal-dow">
            {d}
          </b>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={"x" + i} className="pj-cal-cell empty" />;
          const date = `${month}-${String(d).padStart(2, "0")}`,
            list = marks.get(date) || [];
          return (
            <div key={date} className={"pj-cal-cell" + (date === today ? " today" : "")}>
              <span className="pj-cal-day">{d}</span>
              {list.slice(0, 3).map((mk) => (
                <button key={mk.key} className={"pj-cal-mark " + mk.kind} title={mk.text} onClick={() => open(mk.projectId)}>
                  {mk.text}
                </button>
              ))}
              {list.length > 3 && <small className="pj-muted">+{list.length - 3} รายการ</small>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Report({ rows, open }: { rows: ProjectCard[]; open: (id: string) => void }) {
  const sum = (f: (p: ProjectCard) => number) => rows.reduce((s, p) => s + f(p), 0);
  const total = { budget: sum((p) => p.budget), expenses: sum((p) => p.expenses), target: sum((p) => p.salesTarget), sales: sum((p) => p.sales) };
  return (
    <section className="pj-card pj-report">
      <div className="pj-report-sum">
        {(
          [
            ["งบประมาณรวม", total.budget, Wallet],
            ["ค่าใช้จ่ายจริง", total.expenses, Receipt],
            ["เป้าการขายรวม", total.target, Target],
            ["ยอดขายรวม", total.sales, TrendingUp],
          ] as [string, number, typeof Play][]
        ).map(([label, n, Icon]) => (
          <div key={label}>
            <Icon size={16} />
            <small>{label}</small>
            <b>{baht(n)}</b>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table className="pj-table">
          <thead>
            <tr>
              <th>โครงการ</th>
              <th>สถานะ</th>
              <th>ผู้ดูแล</th>
              <th>ช่วงเวลา</th>
              <th className="num">งบประมาณ</th>
              <th className="num">ค่าใช้จ่าย</th>
              <th className="num">เป้าการขาย</th>
              <th className="num">ยอดขาย</th>
              <th className="num">% เป้า</th>
              <th>ความคืบหน้า</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <button className="row-link" onClick={() => open(p.id)}>
                    {p.name}
                  </button>
                  <small className="pj-muted"> {p.code}</small>
                </td>
                <td>
                  <StatusChip status={p.status} />
                </td>
                <td>{p.owner?.name || "—"}</td>
                <td className="nowrap">{range(p.startDate, p.endDate)}</td>
                <td className="num">{money(p.budget)}</td>
                <td className={"num" + (p.budget && p.expenses > p.budget ? " over" : "")}>{money(p.expenses)}</td>
                <td className="num">{money(p.salesTarget)}</td>
                <td className="num">{money(p.sales)}</td>
                <td className="num">{p.salesTarget ? pct(p.sales, p.salesTarget) + "%" : "—"}</td>
                <td>
                  <span className="pj-row-prog">
                    <Bar value={p.progress} />
                    <b>{p.progress}%</b>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>รวม {rows.length} โครงการ</td>
              <td className="num">{money(total.budget)}</td>
              <td className="num">{money(total.expenses)}</td>
              <td className="num">{money(total.target)}</td>
              <td className="num">{money(total.sales)}</td>
              <td className="num">{total.target ? pct(total.sales, total.target) + "%" : "—"}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- add / edit form

/** Cover photo: a wide WebP (max 1600 px, about 200 KB) uploaded as an attachment; the record keeps its id. */
async function shrinkCover(file: File) {
  const bitmap = await createImageBitmap(file),
    scale = Math.min(1, 1600 / bitmap.width, 1000 / bitmap.height),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob: Blob | null = null;
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", q));
    if (blob && blob.size <= 220_000) break;
  }
  if (!blob) throw Error("แปลงรูปไม่ได้");
  return new File([blob], "project-cover.webp", { type: "image/webp" });
}

const numberKeys = ["budget", "salesTarget", "customerTarget"];
function ProjectForm({
  project,
  people,
  nextCode,
  onClose,
  onSaved,
}: {
  project?: ProjectCard;
  people: Person[];
  nextCode: string;
  onClose: () => void;
  onSaved: (id: string, created: boolean) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    project ? { ...project.data } : { status: "planning", priority: "normal", code: nextCode },
  );
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));
  const team = String(values.team || "").split(/[\s,]+/).filter(Boolean);
  const text = (k: string) => String(values[k] ?? "");
  const input = (k: string, label: string, type = "text", extra: Record<string, unknown> = {}) => (
    <label htmlFor={"pj-" + k} className={type === "textarea" ? "wide" : ""}>
      {label}
      {extra.required ? <span className="required"> *</span> : null}
      {type === "textarea" ? (
        <textarea id={"pj-" + k} rows={3} value={text(k)} maxLength={10000} onChange={(e) => set(k, e.target.value)} />
      ) : (
        <input
          id={"pj-" + k}
          type={type}
          value={text(k)}
          min={type === "number" ? 0 : undefined}
          step={type === "number" ? "any" : undefined}
          maxLength={type === "text" ? 500 : undefined}
          required={!!extra.required}
          list={extra.list as string | undefined}
          placeholder={extra.placeholder as string | undefined}
          onChange={(e) => set(k, type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
        />
      )}
    </label>
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data: Record<string, unknown> = { ...values };
      for (const k of numberKeys) if (data[k] === "" || data[k] === undefined) data[k] = "";
      const saved: { id: string } = await api("/entities/projects" + (project ? "/" + project.id : ""), {
        method: project ? "PATCH" : "POST",
        body: { data, version: project?.version },
      });
      onSaved(saved.id, !project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={project ? "แก้ไขโครงการ" : "เพิ่มโครงการ"} onClose={onClose}>
      <form onSubmit={save} className="pj-form">
        <fieldset disabled={busy}>
          <div className="pj-cover-pick">
            {values.cover ? <img src={photoUrl(values.cover)} alt="รูปปกโครงการ" /> : <span className="pj-cover-empty"><Camera size={26} /></span>}
            <div>
              <b>รูปปกโครงการ</b>
              <small>ภาพแนวนอน ระบบย่อเป็น WebP ให้อัตโนมัติ</small>
              <span className="pj-cover-actions">
                <label className="secondary as-button">
                  <Camera size={15} />
                  {uploading ? "กำลังอัปโหลด…" : values.cover ? "เปลี่ยนรูป" : "เพิ่มรูป"}
                  <input
                    type="file"
                    hidden
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploading}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      setUploading(true);
                      setError("");
                      try {
                        set("cover", await uploadFile(await shrinkCover(f), "Operations"));
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                </label>
                {!!values.cover && (
                  <button type="button" className="text-button" onClick={() => set("cover", "")}>
                    เอารูปออก
                  </button>
                )}
              </span>
            </div>
          </div>
          <div className="form-grid">
            {input("name", "ชื่อโครงการ", "text", { required: true })}
            {input("code", "รหัสโครงการ", "text", { placeholder: nextCode })}
            {input("subtitle", "คำอธิบายสั้น (แสดงใต้ชื่อ)")}
            {input("type", "ประเภทโครงการ", "text", { placeholder: "เช่น อสังหาริมทรัพย์ / อีเวนต์ / การตลาด" })}
            <label htmlFor="pj-status">
              สถานะ<span className="required"> *</span>
              <select id="pj-status" value={text("status") || "planning"} onChange={(e) => set("status", e.target.value)}>
                {statusOrder.map((s) => (
                  <option key={s} value={s}>
                    {statusOf(s).label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="pj-priority">
              ความสำคัญ<span className="required"> *</span>
              <select id="pj-priority" value={text("priority") || "normal"} onChange={(e) => set("priority", e.target.value)}>
                {["normal", "high", "urgent"].map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s] || s}
                  </option>
                ))}
              </select>
            </label>
            {input("owner", "ผู้รับผิดชอบ", "text", { list: "pj-people" })}
            {input("location", "สถานที่ / พื้นที่โครงการ")}
            {input("startDate", "วันเริ่ม", "date")}
            {input("endDate", "วันสิ้นสุด", "date")}
            {input("area", "ขนาดพื้นที่", "text", { placeholder: "เช่น 2 ไร่ / 500 ตร.ม." })}
            {input("budget", "งบประมาณ (บาท)", "number")}
            {input("salesTarget", "เป้าการขาย (บาท)", "number")}
            {input("customerTarget", "เป้าจำนวนลูกค้า", "number")}
            {input("description", "รายละเอียด", "textarea")}
          </div>
          <datalist id="pj-people">
            {people.map((p) => (
              <option key={p.id || p.name} value={p.name}>
                {p.position}
              </option>
            ))}
          </datalist>
          <div className="pj-team-pick">
            <b>
              ทีมงาน <small>({team.length} คน)</small>
            </b>
            {people.length ? (
              <div>
                {people
                  .filter((p) => p.id)
                  .map((p) => {
                    const on = team.includes(p.id!);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        className={on ? "on" : ""}
                        aria-pressed={on}
                        onClick={() => set("team", (on ? team.filter((x) => x !== p.id) : [...team, p.id!]).join(", "))}
                      >
                        <Avatar person={p} size={22} />
                        {p.nickname || p.name}
                        {on && <Check size={13} />}
                      </button>
                    );
                  })}
              </div>
            ) : (
              <small className="pj-muted">ไม่มีรายชื่อพนักงานที่บัญชีนี้ดูได้ — ทีมงานจะคิดจากผู้รับผิดชอบงานในโครงการ</small>
            )}
          </div>
        </fieldset>
        <p role="alert" className="form-error">
          {error}
        </p>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            ปิด
          </button>
          <button className="primary" disabled={busy || uploading}>
            <Check size={15} />
            {busy ? "กำลังบันทึก…" : "บันทึกโครงการ"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- detail (page 14)

type Tab = "overview" | "info" | "work" | "sales" | "finance" | "docs" | "team" | "log";
const tabs: [Tab, string, typeof Play][] = [
  ["overview", "ภาพรวม", LayoutGrid],
  ["info", "ข้อมูลโครงการ", ClipboardList],
  ["work", "งาน & กิจกรรม", ListTodo],
  ["sales", "การขาย", TrendingUp],
  ["finance", "การเงิน", Wallet],
  ["docs", "เอกสาร", FileText],
  ["team", "ทีมงาน", Users],
  ["log", "บันทึกการเปลี่ยนแปลง", Clock3],
];

export function ProjectDetail({ id, ctx, notify, changed, navigate }: PageProps & { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<ProjectDetailData | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<Tab>("overview"),
    [editing, setEditing] = useState(false),
    [people, setPeople] = useState<{ list: Person[]; next: string } | null>(null);
  const { stars, toggle } = useStars(ctx.user.id);
  const top = useRef<HTMLDivElement>(null);
  // Sample ids (mockup mode) are served from src/lib/mock/projects.ts — never from the API.
  const sample = isSampleId(id);
  const load = useCallback(async () => {
    if (isSampleId(id)) {
      const d = sampleDetail(id);
      if (d) setData(d);
      else setError("ไม่พบโครงการตัวอย่าง");
      return;
    }
    return api("/projects/" + id)
      .then((d: ProjectDetailData) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [id]);
  const backTo = sample ? "/workspace/projects?sample=1" : "/workspace/projects";
  useEffect(() => {
    load();
  }, [load]);
  const go = (t: Tab) => {
    setTab(t);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  if (!data)
    return error ? (
      <Empty
        title={error}
        action={
          <button className="secondary" onClick={() => router.push(backTo)}>
            <ArrowLeft size={15} />
            กลับไปหน้าโครงการ
          </button>
        }
      />
    ) : (
      <Loading />
    );
  const p = data.project;
  const writable = canEdit(ctx) && !sample;
  const sx: SampleExtras | undefined = sample ? (data as SampleDetail).extras : undefined;
  const starred = !sample && stars.includes(p.id);
  return (
    <div className="pj-page pj-detail">
      {sample && (
        <SampleBanner
          onClose={() => router.push("/workspace/projects?sample=0")}
          onAdd={canEdit(ctx) ? () => router.push("/workspace/projects?sample=0&add=1") : undefined}
        />
      )}
      <div className="pj-crumbs">
        <button className="pj-link" onClick={() => router.push(backTo)}>
          <ArrowLeft size={15} />
          โครงการทั้งหมด
        </button>
        <span className="pj-crumb-actions">
          <button
            className={"pj-icon-btn" + (starred ? " starred" : "")}
            aria-label={starred ? "เลิกติดดาว" : "ติดดาว"}
            aria-pressed={starred}
            onClick={() => toggle(p.id)}
            disabled={sample}
            title={sample ? SAMPLE_LOCKED : undefined}
          >
            <Star size={16} fill={starred ? "currentColor" : "none"} />
          </button>
          {sample && canEdit(ctx) && (
            <button className="secondary" disabled title={SAMPLE_LOCKED}>
              <Pencil size={14} />
              แก้ไขโครงการ
            </button>
          )}
          {writable && (
            <button
              className="secondary"
              onClick={async () => {
                setEditing(true);
                if (!people)
                  api("/projects")
                    .then((d: ProjectsOverview) => setPeople({ list: d.people, next: d.nextCode }))
                    .catch(() => setPeople({ list: data.people, next: "" }));
              }}
            >
              <Pencil size={14} />
              แก้ไขโครงการ
            </button>
          )}
        </span>
      </div>

      <section className="pj-hero">
        <div className="pj-hero-main">
          <div className="pj-hero-media">
            <Cover project={p} />
            {p.code && <span className="pj-hero-code"><FolderKanban size={13} />{p.code}</span>}
          </div>
          <div className="pj-hero-text">
            <span className="pj-hero-chips">
              <StatusChip status={p.status} />
              {sample && <SampleBadge />}
            </span>
            <h1>{p.name}</h1>
            {p.subtitle && <p className="pj-sub">{p.subtitle}</p>}
            <p className="pj-meta">
              <CalendarDays size={15} />
              {range(p.startDate, p.endDate)}
              {!!p.data.location && (
                <>
                  <MapPin size={15} />
                  {String(p.data.location)}
                </>
              )}
            </p>
            <div className="pj-hero-facts">
              <div>
                {p.owner ? <Avatar person={p.owner} size={34} /> : <span className="pj-fact-icon"><UserRound size={16} /></span>}
                <span>
                  <small>ผู้รับผิดชอบ</small>
                  <b>
                    {p.owner?.name || "—"}
                    {p.owner?.position && <em> ({p.owner.position})</em>}
                  </b>
                </span>
              </div>
              <div>
                <span className="pj-fact-icon">
                  <Users size={16} />
                </span>
                <span>
                  <small>ทีมงาน</small>
                  <b>{p.team.length + (p.owner ? 1 : 0)} คน</b>
                </span>
              </div>
              <div>
                <span className="pj-fact-icon">
                  <Layers size={16} />
                </span>
                <span>
                  <small>ขั้นตอนปัจจุบัน</small>
                  <b>{p.stageLabel || "—"}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="pj-hero-side">
          <div className="pj-card-head">
            <h3>
              <Activity size={16} />
              ภาพรวมโครงการ
            </h3>
            <button className="pj-link" onClick={() => go("info")}>
              ดูรายละเอียดเพิ่มเติม
            </button>
          </div>
          <div className="pj-progress-row big">
            <Bar value={p.progress} />
            <b>{p.progress}%</b>
          </div>
          <div className="pj-hero-metrics">
            <Metric icon={Wallet} label="งบประมาณทั้งหมด" value={p.budget} tone="violet" />
            <Metric icon={Target} label="ยอดขายเป้าหมาย" value={p.salesTarget} tone="blue" />
            <Metric icon={TrendingUp} label="ยอดขายปัจจุบัน" value={p.sales} tone="green" />
          </div>
        </div>
      </section>

      <div ref={top} className="pj-tabs-anchor" />
      <nav className="pj-tabs" aria-label="หัวข้อโครงการ">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)} aria-pressed={tab === key}>
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="pj-detail-body">
          <div className="pj-ov-grid">
            <InfoCard d={data} edit={writable ? () => setEditing(true) : undefined} more={() => go("info")} />
            <ProgressCard d={data} manage={() => go("info")} sx={sx} />
            <SalesCard d={data} />
            <GoalsCard d={data} third={sx?.thirdGoal} />
            <DocsCard docs={data.documents} all={() => go("docs")} sample={sample} />
            <UpcomingCard items={data.upcoming} all={() => go("work")} />
          </div>
          <aside className="pj-side">
            <PeopleCard d={data} chat={() => navigate("chat")} all={() => go("log")} />
            <div className="pj-promo">
              {(p.cover || p.sample) && <Cover project={p} className="pj-promo-img" />}
              <div>
                <em>{sx?.tagline || "Plan well, deliver better"}</em>
                <p>{sx?.quote || "“ทุกความสำเร็จของโครงการ เริ่มต้นจากการวางแผนที่ดี”"}</p>
                <span>
                  <img src="/brand/eliteflow-mark.png" alt="" width={18} height={18} />
                  EliteFlow
                </span>
              </div>
            </div>
          </aside>
        </div>
      ) : tab === "info" ? (
        <div className="pj-stack-col">
          <InfoCard d={data} edit={writable ? () => setEditing(true) : undefined} full />
          <section className="pj-card">
            <div className="pj-card-head">
              <h3>
                <Layers size={16} />
                ขั้นตอนโครงการ
              </h3>
              <small className="pj-muted">
                {sample ? "ตัวอย่าง — โครงการจริงคลิกขั้นตอนเพื่ออัปเดตสถานะได้" : "คลิกขั้นตอนเพื่ออัปเดตสถานะ · ความคืบหน้าจะคิดจากขั้นตอนเมื่อเริ่มใช้งาน"}
              </small>
            </div>
            {sample ? (
              <ProgressCard d={data} manage={() => go("overview")} sx={sx} />
            ) : (
              <ProjectStages projectId={p.id} ctx={ctx} changed={() => { load(); changed(); }} />
            )}
          </section>
        </div>
      ) : tab === "work" ? (
        <WorkTab d={data} navigate={navigate} />
      ) : tab === "sales" ? (
        <div className="pj-stack-col">
          <div className="pj-two">
            <SalesCard d={data} />
            <GoalsCard d={data} third={sx?.thirdGoal} />
          </div>
          <RowsCard
            title="รายการยอดขายล่าสุด"
            icon={TrendingUp}
            rows={data.sales}
            cols={["วันที่", "รายการ", "ช่องทาง", "ยอดขาย"]}
            empty="ยังไม่มียอดขายที่ผูกกับโครงการนี้"
            action={<button className="pj-link" onClick={() => navigate("sales")}>ไปหน้ายอดขาย</button>}
          />
        </div>
      ) : tab === "finance" ? (
        <FinanceTab d={data} navigate={navigate} />
      ) : tab === "docs" ? (
        <div className="pj-stack-col">
          <section className="pj-card">
            <div className="pj-card-head">
              <h3>
                <FileText size={16} />
                ไฟล์แนบของโครงการ
              </h3>
            </div>
            {sample ? (
              <p className="pj-muted pj-note">ตัวอย่าง — โครงการจริงอัปโหลดและดาวน์โหลดไฟล์แนบได้ที่นี่</p>
            ) : (
              <EntityFiles key={data.documents.length} entity={p.id} department={p.department} writable={ctx.member.role !== "viewer"} />
            )}
          </section>
          <DocsCard docs={data.documents} title="เอกสารทั้งหมด" limit={200} sample={sample} />
        </div>
      ) : tab === "team" ? (
        <TeamTab d={data} edit={writable ? () => setEditing(true) : undefined} />
      ) : (
        <section className="pj-card">
          <div className="pj-card-head">
            <h3>
              <Clock3 size={16} />
              บันทึกการเปลี่ยนแปลง
            </h3>
          </div>
          <ActivityList items={data.activity} />
        </section>
      )}

      {editing && (
        <ProjectForm
          project={p}
          people={people?.list || data.people}
          nextCode={people?.next || ""}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            notify("บันทึกโครงการแล้ว");
            changed();
            await load();
          }}
        />
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Play; label: string; value: number; tone: string }) {
  return (
    <div className={"pj-metric pj-metric-" + tone}>
      <span>
        <Icon size={16} />
      </span>
      <small>{label}</small>
      <b>
        {money(value)} <em>บาท</em>
      </b>
    </div>
  );
}

function InfoCard({ d, edit, more, full }: { d: ProjectDetailData; edit?: () => void; more?: () => void; full?: boolean }) {
  const p = d.project,
    x = p.data;
  const facts: [string, string][] = [
    ["ชื่อโครงการ", p.name],
    ["รหัสโครงการ", p.code || "—"],
    ["ประเภทโครงการ", String(x.type || "—")],
    ["พื้นที่โครงการ", String(x.location || "—")],
    ["ขนาดพื้นที่", String(x.area || "—")],
    ["วันเริ่มโครงการ", thDate(p.startDate)],
    ["วันสิ้นสุดโครงการ", thDate(p.endDate)],
    ["งบประมาณทั้งหมด", p.budget ? baht(p.budget) : "—"],
    ["เป้าหมายยอดขาย", p.salesTarget ? baht(p.salesTarget) : "—"],
  ];
  if (full)
    facts.push(
      ["สถานะ", statusOf(p.status).label],
      ["ความสำคัญ", statusLabels[String(x.priority)] || String(x.priority || "—")],
      ["ผู้รับผิดชอบ", p.owner?.name || "—"],
      ["เป้าจำนวนลูกค้า", x.customerTarget ? money(x.customerTarget) + " ราย" : "—"],
      ["รายละเอียด", String(x.description || "—")],
    );
  return (
    <section className={"pj-card pj-info" + (full ? " full" : "")}>
      <div className="pj-card-head">
        <h3>
          <ClipboardList size={16} />
          ข้อมูลโครงการ
        </h3>
        {edit && (
          <button className="pj-chip-btn" onClick={edit}>
            แก้ไข
          </button>
        )}
      </div>
      <div className="pj-info-body">
        <Cover project={p} className="pj-info-img" />
        <dl>
          {facts.map(([k, v]) => (
            <div key={k} className={k === "รายละเอียด" ? "wide" : ""}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {more && (
        <button className="pj-soft-btn" onClick={more}>
          ดูรายละเอียดเพิ่มเติม
        </button>
      )}
    </section>
  );
}

const stageWords = { done: "เสร็จแล้ว", review: "รออนุมัติ", progress: "กำลังดำเนินการ", pending: "รอดำเนินการ" } as const;
const stageColors = { done: "#7952dd", review: "#a78bfa", progress: "#c4b5fd", pending: "#ece8f7" } as const;

function ProgressCard({ d, manage, sx }: { d: ProjectDetailData; manage: () => void; sx?: SampleExtras }) {
  const p = d.project;
  // Mockup mode draws the design's own stepper and legend (sx); real projects use the 10-step workflow.
  const stages = sx
    ? sx.steps.map((s, i) => ({ ...s, ordinal: i, visible: true }))
    : projectWorkflow.map((w, i) => {
        const s = d.stages.find((x) => x.key === w.key);
        return { key: w.key, label: w.label, status: s?.status || ("pending" as const), ordinal: s?.ordinal ?? i, visible: !!s };
      });
  const started = !sx && stages.some((s) => s.status !== "pending");
  const total = stages.length || 1;
  const parts = (["done", "review", "progress", "pending"] as const).map((k) => ({
    key: k,
    count: stages.filter((s) => s.status === k).length,
  }));
  // Donut segments: share of stages in each status.
  const size = 116,
    stroke = 14,
    r = (size - stroke) / 2,
    c = 2 * Math.PI * r;
  let offset = 0;
  const current = stages.find((s) => s.status === "progress" || s.status === "review") || stages.find((s) => s.status === "pending");
  const ci = current ? stages.indexOf(current) : 0;
  const windowed = stages.slice(Math.max(0, Math.min(ci - 1, stages.length - 5)), Math.max(0, Math.min(ci - 1, stages.length - 5)) + 5);
  return (
    <section className="pj-card pj-progress">
      <div className="pj-card-head">
        <h3>
          <Activity size={16} />
          ความคืบหน้าโครงการ
        </h3>
      </div>
      <div className="pj-donut-row">
        <span className="pj-ring" style={{ width: size, height: size }}>
          <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1eefa" strokeWidth={stroke} />
            {started
              ? parts
                  .filter((x) => x.key !== "pending" && x.count)
                  .map((x) => {
                    const len = (c * x.count) / total,
                      el = (
                        <circle
                          key={x.key}
                          cx={size / 2}
                          cy={size / 2}
                          r={r}
                          fill="none"
                          stroke={stageColors[x.key]}
                          strokeWidth={stroke}
                          strokeDasharray={`${len} ${c}`}
                          strokeDashoffset={-offset}
                          transform={`rotate(-90 ${size / 2} ${size / 2})`}
                        />
                      );
                    offset += len;
                    return el;
                  })
              : (
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={stroke}
                  strokeDasharray={`${(c * p.progress) / 100} ${c}`}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              )}
          </svg>
          <b>{p.progress}%</b>
        </span>
        {sx ? (
          <ul className="pj-legend">
            {sx.breakdown.map((x) => (
              <li key={x.label}>
                <i style={{ background: x.color }} />
                {x.label}
                <b>{x.percent}%</b>
              </li>
            ))}
          </ul>
        ) : started ? (
          <ul className="pj-legend">
            {parts.map((x) => (
              <li key={x.key}>
                <i style={{ background: stageColors[x.key] }} />
                {stageWords[x.key]}
                <b>{Math.round((x.count / total) * 100)}%</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pj-muted pj-note">
            ยังไม่เริ่มใช้ขั้นตอนโครงการ ความคืบหน้าคิดจากสถานะ “{statusOf(p.status).label}” และช่วงวันที่
          </p>
        )}
      </div>
      <h4>ขั้นตอนปัจจุบัน</h4>
      <ol className="pj-stepper">
        {windowed.map((s) => (
          <li key={s.key} className={s.status + (s === current && (started || sx) ? " current" : "")}>
            <i>{s.status === "done" ? <Check size={11} /> : null}</i>
            <span>{s.label}</span>
            {s === current && (started || sx) && <em>{stageWords[s.status]}</em>}
          </li>
        ))}
      </ol>
      <button className="pj-link" onClick={manage}>
        จัดการขั้นตอน
      </button>
    </section>
  );
}

function SalesCard({ d }: { d: ProjectDetailData }) {
  const [mode, setMode] = useState<"month" | "quarter" | "year">("month");
  const points: SeriesPoint[] = d.series[mode];
  const max = Math.max(...points.map((x) => x.sales), 0);
  const top = max > 0 ? niceCeil(max) : 4;
  const ticks = [4, 3, 2, 1, 0].map((i) => (top * i) / 4);
  return (
    <section className="pj-card pj-sales">
      <div className="pj-card-head">
        <h3>
          <ChartColumn size={16} />
          ยอดขาย / รายได้
        </h3>
        <span className="pj-seg" role="group" aria-label="ช่วงเวลา">
          {(
            [
              ["month", "รายเดือน"],
              ["quarter", "รายไตรมาส"],
              ["year", "รายปี"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={mode === k ? "on" : ""} aria-pressed={mode === k} onClick={() => setMode(k)}>
              {label}
            </button>
          ))}
        </span>
      </div>
      <div className="pj-chart" role="img" aria-label={"ยอดขาย " + points.map((x) => `${x.label} ${money(x.sales)} บาท`).join(", ")}>
        <div className="pj-chart-y">
          {ticks.map((t) => (
            <span key={t}>{compact(t)}</span>
          ))}
        </div>
        <div className="pj-chart-plot">
          {ticks.map((t) => (
            <i key={t} className="pj-chart-line" style={{ bottom: (t / top) * 100 + "%" }} />
          ))}
          {points.map((x) => (
            <div key={x.key} className="pj-chart-col" title={`${x.label}: ${money(x.sales)} บาท`}>
              <span className="pj-chart-bar" style={{ height: (x.sales / top) * 100 + "%" }} />
              <small>{x.label}</small>
            </div>
          ))}
        </div>
      </div>
      {!max && <p className="pj-muted pj-note">ยังไม่มียอดขายในช่วงนี้</p>}
      <div className="pj-totals">
        <div className="violet">
          <small>
            <TrendingUp size={13} />
            ยอดขายรวม
          </small>
          <b>
            {money(d.totals.sales)} <em>บาท</em>
          </b>
        </div>
        <div className="red">
          <small>
            <Receipt size={13} />
            ค่าใช้จ่ายรวม
          </small>
          <b>
            {money(d.totals.expenses)} <em>บาท</em>
          </b>
        </div>
        <div className="green">
          <small>
            <Wallet size={13} />
            กำไร (ประมาณการ)
          </small>
          <b className={d.totals.profit < 0 ? "neg" : ""}>
            {money(d.totals.profit)} <em>บาท</em>
          </b>
        </div>
      </div>
    </section>
  );
}
function niceCeil(n: number) {
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 2.5, 4, 5, 8, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

function GoalsCard({ d, third }: { d: ProjectDetailData; third?: SampleExtras["thirdGoal"] }) {
  const g = d.goals;
  // The third ring is "งานที่เสร็จ" for real projects; the mockup can swap in the design's own goal (พื้นที่จอง).
  const t3 = third || { label: "งานที่เสร็จ", value: g.tasks.value, target: g.tasks.target };
  const goals: [string, number, number, string, string][] = [
    ["ยอดขาย", g.sales.value, g.sales.target, "#7952dd", `${compact(g.sales.value)} / ${g.sales.target ? compact(g.sales.target) : "—"}`],
    ["ลูกค้า", g.customers.value, g.customers.target, "#5b8def", `${g.customers.value} / ${g.customers.target || "—"}`],
    [t3.label, t3.value, t3.target, "#f472b6", `${t3.value} / ${t3.target}`],
  ];
  return (
    <section className="pj-card pj-goals">
      <div className="pj-card-head">
        <h3>
          <Target size={16} />
          เป้าหมายและผลลัพธ์
        </h3>
      </div>
      <div className="pj-goal-row">
        {goals.map(([label, v, t, color, caption]) => (
          <div key={label}>
            <Ring value={pct(v, t)} color={color} label={t ? pct(v, t) + "%" : "—"} />
            <b>{label}</b>
            <small>{t ? caption : label === "งานที่เสร็จ" ? "ยังไม่มีงาน" : "ยังไม่ตั้งเป้า"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function docIcon(d: DocItem) {
  const n = d.name.toLowerCase();
  if (d.mime === "application/pdf" || n.endsWith(".pdf")) return { Icon: FileText, tone: "pdf" };
  if (d.mime.includes("sheet") || /\.(xlsx?|csv)$/.test(n)) return { Icon: FileSpreadsheet, tone: "xls" };
  if (d.mime.startsWith("image/") || /\.(png|jpe?g|webp)$/.test(n)) return { Icon: FileImage, tone: "img" };
  return { Icon: FileText, tone: "doc" };
}
const size = (b: number) => (b >= 1e6 ? Math.round(b / 1e5) / 10 + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

function DocsCard({
  docs,
  all,
  title = "เอกสารสำคัญ",
  limit = 3,
  sample,
}: {
  docs: DocItem[];
  all?: () => void;
  title?: string;
  limit?: number;
  sample?: boolean;
}) {
  return (
    <section className="pj-card pj-docs">
      <div className="pj-card-head">
        <h3>
          <FileText size={16} />
          {title}
        </h3>
        {all && docs.length > 0 && (
          <button className="pj-link" onClick={all}>
            ดูทั้งหมด
          </button>
        )}
      </div>
      {!docs.length ? (
        <p className="pj-muted pj-note">ยังไม่มีเอกสาร — แนบไฟล์ได้ที่แท็บเอกสาร</p>
      ) : (
        <ul className="pj-doc-list">
          {docs.slice(0, limit).map((d) => {
            const { Icon, tone } = docIcon(d);
            return (
              <li key={d.id}>
                <span className={"pj-doc-icon " + tone}>
                  <Icon size={16} />
                </span>
                <span className="pj-doc-text">
                  <b>{d.name}</b>
                  <small>
                    {thDate(d.at)}
                    {d.size ? " · " + size(d.size) : d.category ? " · " + d.category : ""}
                  </small>
                </span>
                {sample ? (
                  <button className="pj-icon-btn" disabled title="ไฟล์ตัวอย่าง — ดาวน์โหลดไม่ได้" aria-label={"ดาวน์โหลด " + d.name}>
                    <Download size={15} />
                  </button>
                ) : d.href ? (
                  <>
                    <a className="pj-icon-btn" href={d.href + "?download=1"} aria-label={"ดาวน์โหลด " + d.name}>
                      <Download size={15} />
                    </a>
                    <a className="pj-icon-btn" href={d.href} target="_blank" rel="noreferrer" aria-label={"เปิด " + d.name}>
                      <ExternalLink size={14} />
                    </a>
                  </>
                ) : (
                  <small className="pj-muted">ทะเบียนเอกสาร</small>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DateTile({ date }: { date: string }) {
  const d = new Date(date + "T00:00:00+07:00");
  return (
    <span className="pj-date-tile">
      <b>{Number.isNaN(+d) ? "—" : date.slice(8, 10).replace(/^0/, "")}</b>
      <small>{Number.isNaN(+d) ? "" : thMonths[Number(date.slice(5, 7)) - 1]}</small>
    </span>
  );
}

function UpcomingCard({ items, all }: { items: CalendarItem[]; all?: () => void }) {
  return (
    <section className="pj-card pj-upcoming">
      <div className="pj-card-head">
        <h3>
          <CalendarRange size={16} />
          กิจกรรมที่กำลังจะมาถึง
        </h3>
        {all && items.length > 0 && (
          <button className="pj-link" onClick={all}>
            ดูทั้งหมด
          </button>
        )}
      </div>
      {!items.length ? (
        <p className="pj-muted pj-note">ยังไม่มีกิจกรรมหรืองานที่กำลังจะถึง</p>
      ) : (
        <ul className="pj-up-list">
          {items.slice(0, 3).map((i) => (
            <li key={i.id}>
              <DateTile date={i.date} />
              <span>
                <b>{i.name}</b>
                <small>
                  {/^\d{1,2}[:.]\d{2}/.test(i.place)
                    ? i.place
                    : (i.kind === "event" ? (i.endDate && i.endDate !== i.date ? `ถึง ${thDate(i.endDate)}` : "ทั้งวัน") : "กำหนดส่งงาน") +
                      (i.place ? " · " + i.place : "")}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const activityIcon: Record<ActivityItem["kind"], typeof Play> = {
  stage: Layers,
  file: FileText,
  document: FileText,
  sale: TrendingUp,
  task: CircleCheck,
  project: FolderKanban,
};
function ActivityList({ items, limit }: { items: ActivityItem[]; limit?: number }) {
  if (!items.length) return <p className="pj-muted pj-note">ยังไม่มีความเคลื่อนไหว</p>;
  return (
    <ul className="pj-activity">
      {items.slice(0, limit || items.length).map((a) => {
        const Icon = activityIcon[a.kind];
        return (
          <li key={a.id} className={"k-" + a.kind}>
            <span>
              <Icon size={15} />
            </span>
            <div>
              <b>{a.title}</b>
              <p>{a.detail}</p>
              <small>{thDateTime(a.at)}</small>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PeopleCard({ d, chat, all }: { d: ProjectDetailData; chat: () => void; all: () => void }) {
  const p = d.project;
  return (
    <section className="pj-card pj-people">
      <div className="pj-card-head">
        <h3>
          <UserRound size={16} />
          ผู้รับผิดชอบโครงการ
        </h3>
      </div>
      {p.owner ? (
        <div className="pj-owner-card">
          <Avatar person={p.owner} size={44} />
          <span>
            <b>{p.owner.name}</b>
            <small>{p.owner.position || p.owner.department || "ผู้ดูแลโครงการ"}</small>
          </span>
          <button className="pj-icon-btn soft" aria-label="แชทกับทีม" onClick={chat}>
            <MessageCircle size={16} />
          </button>
        </div>
      ) : (
        <p className="pj-muted pj-note">ยังไม่ระบุผู้รับผิดชอบ</p>
      )}
      <h4>
        <Users size={14} />
        ทีมงานหลัก
      </h4>
      <AvatarStack people={p.team} max={4} size={34} />
      <hr />
      <h4>
        <Clock3 size={14} />
        ล่าสุด
      </h4>
      <ActivityList items={d.activity} limit={3} />
      {d.activity.length > 3 && (
        <button className="pj-link" onClick={all}>
          ดูประวัติทั้งหมด
        </button>
      )}
    </section>
  );
}

function RowsCard({
  title,
  icon: Icon,
  rows,
  cols,
  empty,
  action,
  amount = true,
}: {
  title: string;
  icon: typeof Play;
  rows: LiteRow[];
  cols: [string, string, string, string];
  empty: string;
  action?: React.ReactNode;
  amount?: boolean;
}) {
  return (
    <section className="pj-card">
      <div className="pj-card-head">
        <h3>
          <Icon size={16} />
          {title}
        </h3>
        {action}
      </div>
      {!rows.length ? (
        <p className="pj-muted pj-note">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="pj-table">
            <thead>
              <tr>
                <th>{cols[0]}</th>
                <th>{cols[1]}</th>
                <th>{cols[2]}</th>
                <th className={amount ? "num" : ""}>{cols[3]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{thDate(r.date)}</td>
                  <td>{r.name}</td>
                  <td>{r.extra || "—"}</td>
                  <td className={amount ? "num" : ""}>{amount ? money(r.amount) : <span className={"badge " + r.status}>{statusLabels[r.status] || r.status || "—"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WorkTab({ d, navigate }: { d: ProjectDetailData; navigate: (v: string) => void }) {
  const open = d.tasks.filter((t) => t.status !== "done").length;
  return (
    <div className="pj-stack-col">
      <div className="pj-mini-stats">
        <div>
          <small>งานทั้งหมด</small>
          <b>{d.tasks.length}</b>
        </div>
        <div>
          <small>ยังไม่เสร็จ</small>
          <b>{open}</b>
        </div>
        <div>
          <small>เลยกำหนด</small>
          <b className={d.tasks.some((t) => t.status !== "done" && t.date && t.date < d.today) ? "neg" : ""}>
            {d.tasks.filter((t) => t.status !== "done" && t.date && t.date < d.today).length}
          </b>
        </div>
        <div>
          <small>อีเวนต์</small>
          <b>{d.events.length}</b>
        </div>
      </div>
      <div className="pj-two">
        <RowsCard
          title="งานในโครงการ"
          icon={ListTodo}
          rows={d.tasks}
          cols={["กำหนดส่ง", "งาน", "ผู้รับผิดชอบ", "สถานะ"]}
          empty="ยังไม่มีงานที่ผูกกับโครงการนี้"
          amount={false}
          action={<button className="pj-link" onClick={() => navigate("tasks")}>จัดการงาน</button>}
        />
        <UpcomingCard items={d.upcoming.slice(0, 50)} />
      </div>
      <RowsCard
        title="อีเวนต์ของโครงการ"
        icon={CalendarDays}
        rows={d.events}
        cols={["วันเริ่ม", "อีเวนต์", "สถานที่", "งบประมาณ"]}
        empty="ยังไม่มีอีเวนต์ที่ผูกกับโครงการนี้"
        action={<button className="pj-link" onClick={() => navigate("events")}>ไปหน้าอีเวนต์</button>}
      />
    </div>
  );
}

function FinanceTab({ d, navigate }: { d: ProjectDetailData; navigate: (v: string) => void }) {
  const p = d.project,
    used = pct(d.totals.expenses, p.budget);
  return (
    <div className="pj-stack-col">
      <div className="pj-mini-stats">
        <div>
          <small>งบประมาณ</small>
          <b>{money(p.budget)}</b>
        </div>
        <div>
          <small>ค่าใช้จ่ายจริง</small>
          <b className={p.budget && d.totals.expenses > p.budget ? "neg" : ""}>{money(d.totals.expenses)}</b>
        </div>
        <div>
          <small>งบคงเหลือ</small>
          <b className={p.budget - d.totals.expenses < 0 ? "neg" : ""}>{money(p.budget - d.totals.expenses)}</b>
        </div>
        <div>
          <small>ออกใบแจ้งหนี้</small>
          <b>{money(d.totals.invoiced)}</b>
        </div>
        <div>
          <small>รับชำระแล้ว</small>
          <b>{money(d.totals.received)}</b>
        </div>
        <div>
          <small>ค้างรับ</small>
          <b>{money(d.totals.outstanding)}</b>
        </div>
      </div>
      {p.budget > 0 && (
        <section className="pj-card">
          <div className="pj-card-head">
            <h3>
              <Wallet size={16} />
              การใช้งบประมาณ
            </h3>
            <b>{used}%</b>
          </div>
          <Bar value={used} tone={d.totals.expenses > p.budget ? "cancel" : "accent"} />
        </section>
      )}
      <div className="pj-two">
        <RowsCard
          title="ค่าใช้จ่ายของโครงการ"
          icon={Receipt}
          rows={d.expenses}
          cols={["วันที่", "รายการ", "หมวดหมู่", "จำนวนเงิน"]}
          empty="ยังไม่มีค่าใช้จ่ายที่ผูกกับโครงการนี้"
          action={<button className="pj-link" onClick={() => navigate("expenses")}>ไปหน้าค่าใช้จ่าย</button>}
        />
        <RowsCard
          title="ใบแจ้งหนี้ของโครงการ"
          icon={FileText}
          rows={d.invoices}
          cols={["วันที่", "เลขที่", "ครบกำหนด", "ยอดรวม"]}
          empty="ยังไม่มีใบแจ้งหนี้ที่ผูกกับโครงการนี้"
          action={<button className="pj-link" onClick={() => navigate("invoices")}>ไปหน้าใบแจ้งหนี้</button>}
        />
      </div>
    </div>
  );
}

function TeamTab({ d, edit }: { d: ProjectDetailData; edit?: () => void }) {
  const p = d.project;
  const members = [...(p.owner ? [{ ...p.owner, role: "ผู้รับผิดชอบโครงการ" }] : []), ...p.team.map((t) => ({ ...t, role: "ทีมงาน" }))];
  return (
    <section className="pj-card">
      <div className="pj-card-head">
        <h3>
          <Users size={16} />
          ทีมงาน ({members.length} คน)
        </h3>
        {edit && (
          <button className="pj-chip-btn" onClick={edit}>
            แก้ไขทีมงาน
          </button>
        )}
      </div>
      {!members.length ? (
        <p className="pj-muted pj-note">ยังไม่มีทีมงาน — เลือกทีมงานในฟอร์มแก้ไข หรือมอบหมายงานในโครงการ</p>
      ) : (
        <div className="pj-team-grid">
          {members.map((m) => (
            <div key={(m.id || m.name) + m.role}>
              <Avatar person={m} size={46} />
              <b>{m.name}</b>
              <small>{m.position || m.department || "—"}</small>
              <em>{m.role}</em>
            </div>
          ))}
        </div>
      )}
      {!p.data.team && p.team.length > 0 && <p className="pj-muted pj-note">แสดงจากผู้รับผิดชอบงานในโครงการ (ยังไม่ได้เลือกทีมงานในฟอร์ม)</p>}
    </section>
  );
}
