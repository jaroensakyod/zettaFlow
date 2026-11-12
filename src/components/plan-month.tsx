"use client";
// PlanYear month view: a big month where every item is a coloured bar with its name (multi-day items run across
// the days as one bar, like a wall planner); holidays are dots beside the date; "+N" when a day has more.
import type { Entity } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdays = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const LANES = 4;
/** Spans more than a week (projects): placed after the shorter items. */
const long = ([a, b]: [string, string]) => Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z") > 6 * 864e5;

/** Bar colour: an event's own type, otherwise the kind of item. */
const typeColors: Record<string, string> = { ประชุม: "#7c3aed", นัดลูกค้า: "#f97316", อีเวนต์: "#ec4899", งานนอกสถานที่: "#0d9488", อื่นๆ: "#6366f1" };
const kindColors: Record<string, string> = { events: "#8b5cf6", tasks: "#e11d48", deals: "#f59e0b", projects: "#0ea5e9" };
export const barColor = (e: Entity) => typeColors[String(e.data.category || "")] || kindColors[e.kind] || "#7c3aed";

export function PlanMonth({
  month,
  today,
  picked,
  setPicked,
  rows,
  holidays,
  spanOf,
}: {
  /** YYYY-MM */
  month: string;
  today: string;
  picked: string;
  setPicked: (d: string) => void;
  rows: Entity[];
  holidays: Map<string, string[]>;
  spanOf: (e: Entity) => [string, string];
}) {
  const [y, m] = month.split("-").map(Number),
    first = `${month}-01`,
    firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
    days = new Date(Date.UTC(y, m, 0)).getUTCDate(),
    weeks = Math.ceil((firstDow + days) / 7),
    gridStart = addDays(first, -firstDow);
  return (
    <div className="pm">
      <div className="pm-dows">
        {weekdays.map((w, i) => (
          <span key={w} className={i === 0 || i === 6 ? "we" : ""}>
            {w}
          </span>
        ))}
      </div>
      {Array.from({ length: weeks }, (_, wi) => {
        const ws = addDays(gridStart, wi * 7),
          we = addDays(ws, 6),
          col = (d: string) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(ws + "T00:00:00Z")) / 864e5);
        // Items in this week, laid out in lanes: earlier first, longer first.
        const items = rows
          .map((e) => ({ e, span: spanOf(e) }))
          .filter(({ span: [a, b] }) => a && a <= we && b >= ws)
          // Day-to-day items first so they stay visible; long ones (a project over weeks) fill the lanes left.
          .sort((p, q) => Number(long(p.span)) - Number(long(q.span)) || p.span[0].localeCompare(q.span[0]) || q.span[1].localeCompare(p.span[1]));
        const laneEnd: string[] = [],
          placed: { e: Entity; s: string; t: string; lane: number; cont: boolean; more: boolean }[] = [],
          hidden: Record<number, number> = {};
        for (const { e, span } of items) {
          const s = span[0] < ws ? ws : span[0],
            t = span[1] > we ? we : span[1];
          let lane = laneEnd.findIndex((end) => end < s);
          if (lane < 0) lane = laneEnd.push(t) - 1;
          else laneEnd[lane] = t;
          if (lane < LANES) placed.push({ e, s, t, lane, cont: span[0] < ws, more: span[1] > we });
          else for (let c = col(s); c <= col(t); c++) hidden[c] = (hidden[c] || 0) + 1;
        }
        return (
          <div className="pm-week" key={ws}>
            {Array.from({ length: 7 }, (_, c) => {
              const d = addDays(ws, c),
                h = holidays.get(d),
                out = !d.startsWith(month);
              return (
                <button
                  key={d}
                  className={"pm-day" + (out ? " out" : "") + (c === 0 || c === 6 ? " we" : "") + (d === today ? " today" : "") + (d === picked ? " picked" : "")}
                  style={{ gridColumn: c + 1 }}
                  onClick={() => setPicked(d)}
                  title={h ? h.join(" · ") : undefined}
                >
                  <span className="pm-num">
                    {Number(d.slice(8))}
                    {h && <i className="pm-hol" aria-label={h.join(" · ")} />}
                  </span>
                </button>
              );
            })}
            {placed.map(({ e, s, t, lane, cont, more }) => {
              const c = barColor(e),
                time = String(e.data.startTime || "").slice(0, 5);
              return (
                <button
                  key={e.id + ws}
                  className={"pm-bar" + (cont ? " cont" : "") + (more ? " more" : "")}
                  style={{ gridColumn: `${col(s) + 1} / ${col(t) + 2}`, gridRow: lane + 2, "--c": c } as React.CSSProperties}
                  onClick={() => setPicked(s)}
                  title={String(e.data.name) + (time ? " · " + time : "")}
                >
                  {time && !cont && <b>{time}</b>}
                  {String(e.data.name)}
                </button>
              );
            })}
            {Object.entries(hidden).map(([c, n]) => (
              <button key={"m" + c} className="pm-more" style={{ gridColumn: Number(c) + 1, gridRow: LANES + 2 }} onClick={() => setPicked(addDays(ws, Number(c)))}>
                +{n}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
export const monthKey = (y: number, m: number) => `${y}-${pad(m)}`;

/** Year planner: one row per month, days 1–31 across, every item a bar along its month (holidays shaded). */
const YLANES = 3;
export function PlanYearBars({
  year,
  today,
  picked,
  setPicked,
  rows,
  holidays,
  spanOf,
  seasonOf,
  openMonth,
}: {
  year: number;
  today: string;
  picked: string;
  setPicked: (d: string) => void;
  rows: Entity[];
  holidays: Map<string, string[]>;
  spanOf: (e: Entity) => [string, string];
  seasonOf: (m: number) => string;
  openMonth: (m: number) => void;
}) {
  const monthName = (m: number) => new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("th-TH", { month: "short", timeZone: "UTC" });
  return (
    <div className="pyb">
      <div className="pyb-row pyb-headrow">
        <span />
        {Array.from({ length: 31 }, (_, i) => (
          <span key={i} className="pyb-dnum">
            {i + 1}
          </span>
        ))}
      </div>
      {Array.from({ length: 12 }, (_, i) => {
        const m = i + 1,
          key = `${year}-${pad(m)}`,
          first = `${key}-01`,
          n = new Date(Date.UTC(year, m, 0)).getUTCDate(),
          last = `${key}-${pad(n)}`,
          firstDow = new Date(Date.UTC(year, i, 1)).getUTCDay();
        const items = rows
          .map((e) => ({ e, span: spanOf(e) }))
          .filter(({ span: [a, b] }) => a && a <= last && b >= first)
          .sort((p, q) => Number(long(p.span)) - Number(long(q.span)) || p.span[0].localeCompare(q.span[0]) || q.span[1].localeCompare(p.span[1]));
        const laneEnd: string[] = [],
          placed: { e: Entity; s: number; t: number; lane: number; cont: boolean; more: boolean }[] = [];
        let hidden = 0;
        for (const { e, span } of items) {
          const s = span[0] < first ? first : span[0],
            t = span[1] > last ? last : span[1];
          let lane = laneEnd.findIndex((end) => end < s);
          if (lane < 0) lane = laneEnd.push(t) - 1;
          else laneEnd[lane] = t;
          if (lane < YLANES) placed.push({ e, s: Number(s.slice(8)), t: Number(t.slice(8)), lane, cont: span[0] < first, more: span[1] > last });
          else hidden++;
        }
        return (
          <div key={m} className={"pyb-row " + seasonOf(m) + (today.startsWith(key) ? " now" : "")}>
            <button className="pyb-month" onClick={() => openMonth(m)} title="ดูเดือนนี้แบบรายเดือน">
              <b>{monthName(m)}</b>
              {hidden > 0 && <small>+{hidden}</small>}
            </button>
            {Array.from({ length: 31 }, (_, d) => {
              const day = `${key}-${pad(d + 1)}`,
                h = holidays.get(day),
                dow = (firstDow + d) % 7;
              return d < n ? (
                <button
                  key={d}
                  className={"pyb-cell" + (dow === 0 || dow === 6 ? " we" : "") + (h ? " hol" : "") + (day === today ? " today" : "") + (day === picked ? " picked" : "")}
                  style={{ gridColumn: d + 2 }}
                  onClick={() => setPicked(day)}
                  title={new Date(day + "T00:00:00Z").toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) + (h ? "\n" + h.join(" · ") : "")}
                >
                  {h && <i />}
                </button>
              ) : (
                <span key={d} className="pyb-none" style={{ gridColumn: d + 2 }} />
              );
            })}
            {placed.map(({ e, s, t, lane, cont, more }) => (
              <button
                key={e.id}
                className={"pyb-bar" + (cont ? " cont" : "") + (more ? " more" : "")}
                style={{ gridColumn: `${s + 1} / ${t + 2}`, gridRow: lane + 1, "--c": barColor(e) } as React.CSSProperties}
                onClick={() => setPicked(`${key}-${pad(s)}`)}
                title={String(e.data.name)}
              >
                {String(e.data.name)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
