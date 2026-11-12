"use client";
// เพิ่มกิจกรรม (calendar on ภาพรวม): type, date and time, the project it belongs to, and who takes part —
// employees, customers or suppliers, picked from the company's own lists.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Briefcase,
  Building2,
  CalendarDays,
  Check,
  Clock,
  Handshake,
  Layers,
  LoaderCircle,
  MapPin,
  PartyPopper,
  Search,
  Sparkles,
  Truck,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { api, Modal } from "./shared";

type PersonKind = "employees" | "customers" | "suppliers";
export type Participant = { kind: PersonKind; id: string; name: string };

const types: { key: string; icon: LucideIcon; color: string }[] = [
  { key: "ประชุม", icon: Users, color: "#7c3aed" },
  { key: "นัดลูกค้า", icon: Handshake, color: "#f97316" },
  { key: "อีเวนต์", icon: PartyPopper, color: "#ec4899" },
  { key: "งานนอกสถานที่", icon: MapPin, color: "#0d9488" },
  { key: "อื่นๆ", icon: Sparkles, color: "#6366f1" },
];
const people: Record<PersonKind, { label: string; icon: LucideIcon; color: string }> = {
  employees: { label: "พนักงาน", icon: UserRound, color: "#3b82f6" },
  customers: { label: "ลูกค้า", icon: Briefcase, color: "#16a34a" },
  suppliers: { label: "ซัพพลายเออร์", icon: Truck, color: "#f97316" },
};
const kinds = Object.keys(people) as PersonKind[];
const nameOf = (e: Entity) => String(e.data.name || e.data.nickname || "").trim();
/** Avatar letter: skips บริษัท / หจก. / ห้างหุ้นส่วน so companies do not all show "บ". */
const letterOf = (e: Entity) => nameOf(e).replace(/^(บริษัท|บจก\.?|หจก\.?|ห้างหุ้นส่วน(จำกัด)?)\s*/, "").trim().slice(0, 1) || "?";
const subOf = (e: Entity) => String(e.data.position || e.data.company || e.data.category || e.data.phone || "").trim();

/** Rows of one list whose name matches `q` (the newest 25 when q is empty); [] if the list is not readable. */
const search = (kind: string, q: string) =>
  api(`/entities/${kind}?q=${encodeURIComponent(q)}`)
    .then((r: { rows: Entity[] }) => r.rows.filter((e) => nameOf(e)))
    .catch(() => [] as Entity[]);

export function EventModal({ ctx, day, onClose, onSaved }: { ctx: Context; day: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(""),
    [type, setType] = useState(types[0].key),
    [start, setStart] = useState(day),
    [end, setEnd] = useState(day),
    [allDay, setAllDay] = useState(true),
    [t1, setT1] = useState("09:00"),
    [t2, setT2] = useState("10:00"),
    [location, setLocation] = useState(""),
    [notes, setNotes] = useState(""),
    [project, setProject] = useState<{ id: string; name: string } | null>(null),
    [who, setWho] = useState<Participant[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  // project picker
  const [pq, setPq] = useState(""),
    [pOpen, setPOpen] = useState(false),
    [projects, setProjects] = useState<Entity[] | null>(null);
  useEffect(() => {
    if (!pOpen) return;
    let live = true;
    const t = setTimeout(() => search("projects", pq.trim()).then((r) => live && setProjects(r)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pq, pOpen]);

  // participant picker
  const [filter, setFilter] = useState<"all" | PersonKind>("all"),
    [q, setQ] = useState(""),
    [found, setFound] = useState<{ kind: PersonKind; e: Entity }[] | null>(null);
  useEffect(() => {
    let live = true;
    setFound(null);
    const t = setTimeout(() => {
      const ks = filter === "all" ? kinds : [filter];
      Promise.all(ks.map((k) => search(k, q.trim()).then((rows) => rows.slice(0, filter === "all" ? 6 : 15).map((e) => ({ kind: k, e }))))).then(
        (lists) => live && setFound(lists.flat()),
      );
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, filter]);
  const picked = useMemo(() => new Set(who.map((p) => p.id)), [who]);
  const toggle = (kind: PersonKind, e: Entity) =>
    setWho((list) => (picked.has(e.id) ? list.filter((p) => p.id !== e.id) : [...list, { kind, id: e.id, name: nameOf(e) }]));

  const color = types.find((t) => t.key === type)?.color || "#7c3aed";
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("ใส่ชื่อกิจกรรม");
    if (!allDay && start === end && t2 && t1 && t2 < t1) return setError("เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม");
    setBusy(true);
    setError("");
    try {
      await api("/entities/events", {
        method: "POST",
        body: {
          data: {
            name: name.trim(),
            category: type,
            startDate: start,
            endDate: end && end >= start ? end : start,
            startTime: allDay ? undefined : t1 || undefined,
            endTime: allDay ? undefined : t2 || undefined,
            projectId: project?.id,
            participants: who.length ? who : undefined,
            location: location.trim() || undefined,
            notes: notes.trim() || undefined,
            owner: ctx.user.name,
            status: "planning",
          },
        },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="เพิ่มกิจกรรม" onClose={onClose} className="ev-modal">
      <form onSubmit={save} style={{ "--ev": color } as React.CSSProperties}>
        <fieldset disabled={busy} className="ev-fs">
        <div className="ev-body">
          <input className="ev-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus placeholder="ชื่อกิจกรรม เช่น ประชุมทีมการตลาด" aria-label="ชื่อกิจกรรม" />

          <div className="ev-types" role="radiogroup" aria-label="ประเภทกิจกรรม">
            {types.map((t) => (
              <button
                type="button"
                key={t.key}
                role="radio"
                aria-checked={type === t.key}
                className={"ev-type" + (type === t.key ? " on" : "")}
                style={{ "--c": t.color } as React.CSSProperties}
                onClick={() => setType(t.key)}
              >
                <t.icon size={15} /> {t.key}
              </button>
            ))}
          </div>

          <section className="ev-sec">
            <h3>
              <CalendarDays size={15} /> วันและเวลา
              <label className="ev-switch">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                <span /> ทั้งวัน
              </label>
            </h3>
            <div className="ev-when">
              <label>
                <small>วันเริ่ม</small>
                <input type="date" required value={start} onChange={(e) => (setStart(e.target.value), end < e.target.value && setEnd(e.target.value))} />
              </label>
              {!allDay && (
                <label>
                  <small>เวลาเริ่ม</small>
                  <input type="time" value={t1} onChange={(e) => setT1(e.target.value)} />
                </label>
              )}
              <label>
                <small>วันสิ้นสุด</small>
                <input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
              {!allDay && (
                <label>
                  <small>เวลาสิ้นสุด</small>
                  <input type="time" value={t2} onChange={(e) => setT2(e.target.value)} />
                </label>
              )}
            </div>
          </section>

          <section className="ev-sec">
            <h3>
              <Layers size={15} /> โปรเจกต์ <small>ไม่บังคับ</small>
            </h3>
            {project ? (
              <span className="ev-project">
                <Layers size={15} /> {project.name}
                <button type="button" aria-label="เอาโปรเจกต์ออก" onClick={() => setProject(null)}>
                  <X size={14} />
                </button>
              </span>
            ) : (
              <div className="ev-combo">
                <label className="ev-search">
                  <Search size={15} />
                  <input
                    value={pq}
                    onChange={(e) => setPq(e.target.value)}
                    onFocus={() => setPOpen(true)}
                    onBlur={() => setTimeout(() => setPOpen(false), 150)}
                    placeholder="ค้นหาโปรเจกต์"
                    aria-label="ค้นหาโปรเจกต์"
                  />
                </label>
                {pOpen && (
                  <div className="ev-drop" role="listbox">
                    {projects === null ? (
                      <p className="ev-hint">
                        <LoaderCircle className="spin" size={14} /> กำลังโหลด…
                      </p>
                    ) : projects.length ? (
                      projects.map((p) => (
                        <button type="button" role="option" aria-selected={false} key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => (setProject({ id: p.id, name: nameOf(p) }), setPOpen(false), setPq(""))}>
                          <Layers size={14} /> {nameOf(p)}
                        </button>
                      ))
                    ) : (
                      <p className="ev-hint">ไม่พบโปรเจกต์</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="ev-sec">
            <h3>
              <Users size={15} /> ผู้เข้าร่วม {who.length > 0 && <b className="ev-count">{who.length}</b>}
            </h3>
            {who.length > 0 && (
              <div className="ev-chips">
                {who.map((p) => {
                  const k = people[p.kind];
                  return (
                    <span key={p.id} className="ev-chip" style={{ "--c": k.color } as React.CSSProperties} title={k.label}>
                      <k.icon size={13} /> {p.name}
                      <button type="button" aria-label={"เอา " + p.name + " ออก"} onClick={() => setWho((l) => l.filter((x) => x.id !== p.id))}>
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="ev-people">
              <div className="ev-tabs" role="tablist" aria-label="กลุ่มผู้เข้าร่วม">
                {(["all", ...kinds] as const).map((k) => (
                  <button
                    type="button"
                    key={k}
                    role="tab"
                    aria-selected={filter === k}
                    className={filter === k ? "on" : ""}
                    style={{ "--c": k === "all" ? "#7c3aed" : people[k].color } as React.CSSProperties}
                    onClick={() => setFilter(k)}
                  >
                    {k === "all" ? "ทั้งหมด" : people[k].label}
                  </button>
                ))}
              </div>
              <label className="ev-search">
                <Search size={15} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อพนักงาน ลูกค้า หรือซัพพลายเออร์" aria-label="ค้นหาผู้เข้าร่วม" />
              </label>
              <div className="ev-list">
                {found === null ? (
                  <p className="ev-hint">
                    <LoaderCircle className="spin" size={14} /> กำลังค้นหา…
                  </p>
                ) : found.length ? (
                  found.map(({ kind, e }) => {
                    const k = people[kind],
                      on = picked.has(e.id);
                    return (
                      <button type="button" key={e.id} className={"ev-person" + (on ? " on" : "")} style={{ "--c": k.color } as React.CSSProperties} onClick={() => toggle(kind, e)} aria-pressed={on}>
                        <i>{on ? <Check size={14} /> : letterOf(e)}</i>
                        <span>
                          <b>{nameOf(e)}</b>
                          {subOf(e) && <small>{subOf(e)}</small>}
                        </span>
                        <em>
                          <k.icon size={12} /> {k.label}
                        </em>
                      </button>
                    );
                  })
                ) : (
                  <p className="ev-hint">{q ? "ไม่พบชื่อนี้" : "ยังไม่มีรายชื่อในกลุ่มนี้"}</p>
                )}
              </div>
            </div>
          </section>

          <section className="ev-sec ev-two">
            <label className="ev-field">
              <span>
                <MapPin size={14} /> สถานที่
              </span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="เช่น ห้องประชุม 2 หรือ ออนไลน์ (Zoom)" />
            </label>
            <label className="ev-field">
              <span>
                <Building2 size={14} /> รายละเอียด
              </span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="วาระ สิ่งที่ต้องเตรียม" />
            </label>
          </section>
        </div>
        </fieldset>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-footer ev-foot">
          {!allDay && (
            <span className="ev-summary">
              <Clock size={14} /> {t1}–{t2}
            </span>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="primary ev-save" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            {busy ? "กำลังบันทึก…" : "บันทึกกิจกรรม"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
