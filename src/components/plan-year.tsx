"use client";
// PlanYear: the whole year on one full-screen page — 12 small months coloured by Thai season (cool, hot, rainy),
// public holidays and the company's own events, tasks, deals and projects on every day.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CloudRain, Flag, Handshake, Layers, ListTodo, Plus, Snowflake, Sparkles, Sun, X, CalendarDays, type LucideIcon } from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { api } from "./shared";
import { ColorPicker, EventModal } from "./event-modal";
import { PlanMonth, PlanYearBars, barColor } from "./plan-month";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const thai = (s: string, o: Intl.DateTimeFormatOptions) => new Date(s + "T00:00:00Z").toLocaleDateString("th-TH", { ...o, timeZone: "UTC" });
const weekdays = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/** Thai seasons: cool Nov–Feb, hot Mar–May, rainy Jun–Oct. */
type Season = "cool" | "hot" | "rainy";
const seasonOf = (m: number): Season => (m >= 3 && m <= 5 ? "hot" : m >= 6 && m <= 10 ? "rainy" : "cool");
const seasons: Record<Season, { label: string; icon: LucideIcon }> = {
  cool: { label: "ฤดูหนาว", icon: Snowflake },
  hot: { label: "ฤดูร้อน", icon: Sun },
  rainy: { label: "ฤดูฝน", icon: CloudRain },
};

/** Public holidays on a fixed date every year. */
const fixedHolidays: [string, string][] = [
  ["01-01", "วันขึ้นปีใหม่"],
  ["04-06", "วันจักรี"],
  ["04-13", "วันสงกรานต์"],
  ["04-14", "วันสงกรานต์"],
  ["04-15", "วันสงกรานต์"],
  ["05-01", "วันแรงงานแห่งชาติ"],
  ["05-04", "วันฉัตรมงคล"],
  ["06-03", "วันเฉลิมพระชนมพรรษา สมเด็จพระราชินี"],
  ["07-28", "วันเฉลิมพระชนมพรรษา ร.10"],
  ["08-12", "วันแม่แห่งชาติ"],
  ["10-13", "วันนวมินทรมหาราช"],
  ["10-23", "วันปิยมหาราช"],
  ["12-05", "วันพ่อแห่งชาติ"],
  ["12-10", "วันรัฐธรรมนูญ"],
  ["12-31", "วันสิ้นปี"],
];
/** Buddhist holidays follow the lunar calendar, so they are listed per year (add the next year's dates here). */
const lunarHolidays: Record<number, [string, string][]> = {
  2026: [
    ["03-03", "วันมาฆบูชา"],
    ["05-31", "วันวิสาขบูชา"],
    ["07-29", "วันอาสาฬหบูชา"],
    ["07-30", "วันเข้าพรรษา"],
  ],
};
function holidaysOf(year: number) {
  const map = new Map<string, string[]>();
  for (const [md, name] of [...fixedHolidays, ...(lunarHolidays[year] || [])]) {
    const day = `${year}-${md}`;
    map.set(day, [...(map.get(day) || []), name]);
  }
  return map;
}

const kindInfo: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  events: { label: "กิจกรรม", icon: CalendarDays, color: "#7c3aed" },
  tasks: { label: "งาน", icon: ListTodo, color: "#e11d48" },
  deals: { label: "ดีล", icon: Handshake, color: "#f97316" },
  projects: { label: "โครงการ", icon: Layers, color: "#0ea5e9" },
};
const spanOf = (e: Entity): [string, string] => {
  const d = e.data,
    start = String(d.startDate || d.dueDate || d.date || ""),
    end = String(d.endDate || start);
  return [start, end < start ? start : end];
};
const timeOf = (e: Entity) => String(e.data.startTime || e.data.time || "").slice(0, 5);

export function PlanYear({
  ctx,
  today,
  onClose,
  onAdded,
  sampleEntries,
}: {
  ctx: Context;
  today: string;
  onClose: () => void;
  onAdded: () => void;
  /** Sample mode: these entries instead of GET /calendar. */
  sampleEntries?: Entity[];
}) {
  const [year, setYear] = useState(Number(today.slice(0, 4))),
    [picked, setPicked] = useState(today),
    [rows, setRows] = useState<Entity[] | null>(null),
    [adding, setAdding] = useState(false),
    [reload, setReload] = useState(0),
    // The item whose colour is being changed in the side panel.
    [recolor, setRecolor] = useState(""),
    // ทั้งปี (12 small months) or รายเดือน (one big month with task bars)
    // รายปี (task bars along every month), 12 เดือน (small calendars) or รายเดือน (one big month)
    [view, setView] = useState<"bars" | "year" | "month">("month"),
    [vm, setVm] = useState(Number(today.slice(5, 7)));
  const openMonth = (m: number) => {
    setVm(m);
    setView("month");
  };
  const goMonth = (n: number) => {
    let m = vm + n,
      yy = year;
    if (m < 1) (m = 12), (yy -= 1);
    if (m > 12) (m = 1), (yy += 1);
    setVm(m);
    if (yy !== year) setYear(yy);
  };
  // How much of the shown year has passed.
  const ty = Number(today.slice(0, 4)),
    yearDays = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 864e5,
    passed = year < ty ? yearDays : year > ty ? 0 : Math.round((Date.parse(today + "T00:00:00Z") - Date.UTC(year, 0, 1)) / 864e5) + 1,
    pct = Math.round((passed / yearDays) * 100);
  // Recolour an item from the side panel (saved on the record; the sample data is read-only).
  const canColor = !sampleEntries && ctx.member.role !== "viewer",
    autoColor = (e: Entity) => barColor({ ...e, data: { ...e.data, color: "" } }),
    [colorError, setColorError] = useState("");
  async function saveColor(e: Entity, color: string) {
    setColorError("");
    const before = rows;
    setRows((rs) => (rs || []).map((x) => (x.id === e.id ? { ...x, data: { ...x.data, color } } : x)));
    try {
      const saved: Entity = await api(`/entities/${e.kind}/${e.id}`, { method: "PATCH", body: { data: { ...e.data, color: color || "" }, version: e.version } });
      setRows((rs) => (rs || []).map((x) => (x.id === e.id ? saved : x)));
    } catch (err) {
      setRows(before);
      setColorError((err as Error).message);
    }
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !adding && onClose();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [onClose, adding]);
  useEffect(() => {
    let live = true;
    setRows(null);
    if (sampleEntries) {
      setRows(sampleEntries);
      return;
    }
    Promise.all(Array.from({ length: 12 }, (_, i) => api(`/calendar?month=${year}-${pad(i + 1)}`).catch(() => [] as Entity[]))).then((lists: Entity[][]) => {
      if (!live) return;
      const seen = new Map<string, Entity>();
      for (const e of lists.flat()) seen.set(e.id, e);
      setRows([...seen.values()]);
    });
    return () => {
      live = false;
    };
  }, [year, sampleEntries, reload]);
  const holidays = useMemo(() => holidaysOf(year), [year]);
  // Entries of each day of the year.
  const byDay = useMemo(() => {
    const map = new Map<string, Entity[]>();
    for (const e of rows || []) {
      const [a, b] = spanOf(e);
      if (!a) continue;
      // Long spans (projects) are marked on their first and last day only, so a year of dots stays readable.
      const days = a === b ? [a] : [a, b];
      for (const d of days) if (d.startsWith(String(year))) map.set(d, [...(map.get(d) || []), e]);
    }
    return map;
  }, [rows, year]);
  const dayItems = (byDay.get(picked) || []).sort((x, y) => (timeOf(x) || "99").localeCompare(timeOf(y) || "99")),
    dayHolidays = holidays.get(picked) || [],
    // Important days of the picked month: holidays and company items.
    pm = picked.slice(0, 7),
    monthList = [
      ...[...holidays].filter(([d]) => d.startsWith(pm)).map(([d, names]) => ({ day: d, holiday: true, text: names.join(" · "), kind: "" })),
      ...[...byDay].filter(([d]) => d.startsWith(pm)).flatMap(([d, list]) => list.map((e) => ({ day: d, holiday: false, text: String(e.data.name), kind: e.kind }))),
    ].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <div className="py" role="dialog" aria-modal="true" aria-label={"PlanYear " + (year + 543)}>
      <header className="py-head">
        <div className="py-title">
          <span className="py-logo">
            <Sparkles size={18} />
          </span>
          <div>
            <h2>
              PlanYear <b>{year + 543}</b>
            </h2>
            <small>วางแผนทั้งปี · วันหยุด กิจกรรม งาน และโครงการของบริษัท</small>
          </div>
        </div>
        <div className="py-views" role="tablist" aria-label="มุมมอง">
          <button role="tab" aria-selected={view === "bars"} className={view === "bars" ? "on" : ""} onClick={() => setView("bars")}>
            รายปี
          </button>
          <button role="tab" aria-selected={view === "year"} className={view === "year" ? "on" : ""} onClick={() => setView("year")}>
            12 เดือน
          </button>
          <button role="tab" aria-selected={view === "month"} className={view === "month" ? "on" : ""} onClick={() => setView("month")}>
            รายเดือน
          </button>
        </div>
        <div className="py-year">
          <button aria-label={view === "month" ? "เดือนก่อน" : "ปีก่อน"} onClick={() => (view === "month" ? goMonth(-1) : setYear(year - 1))}>
            <ChevronLeft size={18} />
          </button>
          <span>{view === "month" ? thai(`${year}-${pad(vm)}-01`, { month: "short", year: "numeric" }) : year + 543}</span>
          <button aria-label={view === "month" ? "เดือนถัดไป" : "ปีถัดไป"} onClick={() => (view === "month" ? goMonth(1) : setYear(year + 1))}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="py-progress" title={`ผ่านไปแล้ว ${passed} วัน จาก ${yearDays} วัน`}>
          <span>
            ปี {year + 543} ผ่านไป <b>{pct}%</b>
            <small>{year === ty ? `เหลืออีก ${yearDays - passed} วัน` : year < ty ? "จบปีแล้ว" : "ยังไม่ถึง"}</small>
          </span>
          <i>
            <em style={{ width: pct + "%" }} />
          </i>
        </div>
        <div className="py-legend">
          {(Object.keys(seasons) as Season[]).map((s) => {
            const S = seasons[s];
            return (
              <span key={s} className={"py-leg season " + s}>
                <S.icon size={13} /> {S.label}
              </span>
            );
          })}
          <span className="py-leg">
            <i className="holiday" /> วันหยุด
          </span>
          {Object.entries(kindInfo).map(([k, v]) => (
            <span key={k} className="py-leg">
              <i style={{ background: v.color }} /> {v.label}
            </span>
          ))}
        </div>
        <button className="py-close" onClick={onClose} aria-label="ปิด PlanYear">
          <X size={20} />
        </button>
      </header>

      <div className="py-main">
        {view === "bars" ? (
          <section aria-busy={rows === null}>
            <PlanYearBars year={year} today={today} picked={picked} setPicked={setPicked} rows={rows || []} holidays={holidays} spanOf={spanOf} seasonOf={seasonOf} openMonth={openMonth} />
          </section>
        ) : view === "month" ? (
          <section className={"py-big " + seasonOf(vm)} aria-busy={rows === null}>
            <header>
              <strong>{thai(`${year}-${pad(vm)}-01`, { month: "long", year: "numeric" })}</strong>
              {(() => {
                const S = seasons[seasonOf(vm)];
                return (
                  <span className="py-season-pill">
                    <S.icon size={14} /> {S.label}
                  </span>
                );
              })()}
            </header>
            <PlanMonth month={`${year}-${pad(vm)}`} today={today} picked={picked} setPicked={setPicked} rows={rows || []} holidays={holidays} spanOf={spanOf} />
          </section>
        ) : (
        <div className="py-grid" aria-busy={rows === null}>
          {Array.from({ length: 12 }, (_, i) => {
            const m = i + 1,
              s = seasonOf(m),
              S = seasons[s],
              first = new Date(Date.UTC(year, i, 1)).getUTCDay(),
              n = daysIn(year, m),
              prefix = `${year}-${pad(m)}`,
              count = [...byDay].filter(([d]) => d.startsWith(prefix)).reduce((t, [, l]) => t + l.length, 0),
              hol = [...holidays.keys()].filter((d) => d.startsWith(prefix)).length;
            return (
              <section key={m} className={"py-month " + s + (today.startsWith(prefix) ? " now" : "")}>
                <header>
                  <button className="py-mname" onClick={() => openMonth(m)} title="ดูแบบรายเดือน">
                    {thai(prefix + "-01", { month: "long" })}
                  </button>
                  <span className="py-season" title={S.label}>
                    <S.icon size={14} />
                  </span>
                </header>
                <div className="py-stats">
                  {hol > 0 && <span className="h">{hol} วันหยุด</span>}
                  {count > 0 && <span>{count} รายการ</span>}
                </div>
                <div className="py-days">
                  {weekdays.map((w, k) => (
                    <span key={w} className={"py-dow" + (k === 0 || k === 6 ? " we" : "")}>
                      {w}
                    </span>
                  ))}
                  {Array.from({ length: first }, (_, k) => (
                    <span key={"b" + k} />
                  ))}
                  {Array.from({ length: n }, (_, k) => {
                    const day = iso(year, m, k + 1),
                      items = byDay.get(day) || [],
                      h = holidays.get(day),
                      dow = (first + k) % 7,
                      kinds = [...new Set(items.map((e) => barColor(e)))].slice(0, 3),
                      tip = [...(h || []), ...items.map((e) => (kindInfo[e.kind]?.label || "") + ": " + String(e.data.name))].join("\n");
                    return (
                      <button
                        key={day}
                        className={
                          "py-day" +
                          (h ? " holiday" : "") +
                          (dow === 0 || dow === 6 ? " we" : "") +
                          (day === today ? " today" : "") +
                          (day === picked ? " picked" : "") +
                          (items.length ? " busy" : "")
                        }
                        title={tip ? thai(day, { day: "numeric", month: "short" }) + "\n" + tip : undefined}
                        onClick={() => setPicked(day)}
                      >
                        {k + 1}
                        {kinds.length > 0 && (
                          <span className="py-dots">
                            {kinds.map((kk) => (
                              <i key={kk} style={{ background: kk }} />
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        )}

        <aside className="py-side">
          <section className={"py-dayc " + seasonOf(Number(picked.slice(5, 7)))}>
            <small>{thai(picked, { weekday: "long" })}</small>
            <strong>{thai(picked, { day: "numeric", month: "long", year: "numeric" })}</strong>
            {dayHolidays.map((h) => (
              <span key={h} className="py-hol">
                <Flag size={13} /> {h}
              </span>
            ))}
            <ul>
              {dayItems.map((e) => {
                const k = kindInfo[e.kind] || kindInfo.events;
                return (
                  <li key={e.id} style={{ "--c": barColor(e) } as React.CSSProperties}>
                    <div className="py-item">
                      <k.icon size={15} />
                      <span>
                        <b>{String(e.data.name)}</b>
                        <small>
                          {k.label}
                          {timeOf(e) && " · " + timeOf(e) + (e.data.endTime ? "–" + String(e.data.endTime).slice(0, 5) : "")}
                          {e.data.location ? " · " + String(e.data.location) : ""}
                        </small>
                      </span>
                      {canColor && (
                        <button className="py-recolor" onClick={() => setRecolor(recolor === e.id ? "" : e.id)} aria-label="เปลี่ยนสี" title="เปลี่ยนสี" aria-expanded={recolor === e.id} />
                      )}
                    </div>
                    {recolor === e.id && <ColorPicker compact value={String(e.data.color || "")} auto={autoColor(e)} onChange={(c) => saveColor(e, c)} />}
                  </li>
                );
              })}
            </ul>
            {colorError && <p className="py-err">{colorError}</p>}
            {!dayItems.length && !dayHolidays.length && <p className="py-empty">ยังไม่มีแผนในวันนี้</p>}
            <button className="py-add" onClick={() => setAdding(true)} disabled={ctx.member.role === "viewer" || !!sampleEntries}>
              <Plus size={16} /> เพิ่มกิจกรรมวันนี้
            </button>
          </section>
          <section className="py-month-list">
            <h3>วันสำคัญเดือน{thai(picked, { month: "long" })}</h3>
            {monthList.length ? (
              <ul>
                {monthList.map((x, i) => (
                  <li key={i} className={x.holiday ? "holiday" : ""}>
                    <button onClick={() => setPicked(x.day)}>
                      <em>{Number(x.day.slice(8))}</em>
                      <i style={{ background: x.holiday ? "#e11d48" : kindInfo[x.kind]?.color || "#7c3aed" }} />
                      <span>{x.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-empty">ไม่มีวันสำคัญ</p>
            )}
          </section>
        </aside>
      </div>
      {adding && (
        <EventModal
          ctx={ctx}
          day={picked}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setReload((r) => r + 1);
            onAdded();
          }}
        />
      )}
    </div>
  );
}
