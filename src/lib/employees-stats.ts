// Figures for the พนักงาน page (Canva p.17): headcount tiles, today's attendance, this month's attendance per person,
// KPI-based performance and leave balance. Pure functions over records the page already loaded, plus a tiny
// QR encoder for the ID card (byte mode, ECC M) so no new dependency is needed.
import { computeAttendance } from "./catalog";
import type { Entity } from "./types";

type Data = Record<string, unknown>;
const num = (v: unknown) => (v === "" || v === null || v === undefined ? NaN : Number(v));
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Today in Bangkok, YYYY-MM-DD. */
export const bangkokToday = (now = Date.now()) => new Date(now + 7 * 3600000).toISOString().slice(0, 10);

/** Comma / newline separated text field → trimmed list (skills, strengths). */
export const listOf = (raw: unknown) =>
  String(raw || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** ไม่ปฏิบัติงาน = resigned or on leave; everyone else (active, probation, no status) is working. */
export const isInactive = (e: Entity) => e.data.status === "inactive" || e.data.status === "on_leave";

/** Records linked to this employee: by employeeId, or by the same name when the record was typed without a link. */
export function forEmployee(rows: Entity[], e: Entity) {
  const name = String(e.data.name || "").trim();
  return rows.filter((r) => (r.data.employeeId ? r.data.employeeId === e.id : !!name && String(r.data.name || "").trim() === name));
}

const PRESENT = ["ปกติ", "สาย", "ทำงานนอกสถานที่"];
const validTime = (s: unknown) => /^\d{1,2}:\d{2}$/.test(String(s || ""));
/** How one attendance record counts. */
export function attendanceKind(d: Data): "present" | "late" | "absent" | "leave" | "unknown" {
  const status = String(d.status || "");
  if (status === "ขาด") return "absent";
  if (status === "ลา") return "leave";
  const late = status === "สาย" || (status !== "ทำงานนอกสถานที่" && Math.max(Number(d.late) || 0, computeAttendance(d).late) > 0 && validTime(d.checkIn));
  if (late) return "late";
  if (PRESENT.includes(status) || validTime(d.checkIn)) return "present";
  return "unknown";
}

/** Inclusive days of [start, end] that fall inside [from, to] (all YYYY-MM-DD). */
export function overlapDays(start: unknown, end: unknown, from: string, to: string) {
  const s = String(start || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 0;
  const e = /^\d{4}-\d{2}-\d{2}/.test(String(end || "")) ? String(end).slice(0, 10) : s;
  const a = s > from ? s : from,
    b = e < to ? e : to;
  return b < a ? 0 : Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
}

const monthRange = (today: string) => {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: today.slice(0, 7) + "-01", to: today.slice(0, 7) + "-" + String(last).padStart(2, "0") };
};

export type MonthAttendance = { present: number; late: number; absent: number; leave: number; recorded: number; rate: number | null };
/**
 * This month for one person: days at work (late days included), late count, absences, approved leave days
 * (from leave requests, plus attendance rows marked ลา that no request covers) and the attendance rate
 * = days at work / days that have any record. `rate` is null when nothing was recorded.
 */
export function monthAttendance(attendance: Entity[], leaves: Entity[], today = bangkokToday()): MonthAttendance {
  const { from, to } = monthRange(today);
  const byDay = new Map<string, ReturnType<typeof attendanceKind>>();
  for (const r of attendance) {
    const day = String(r.data.date || "").slice(0, 10);
    if (day < from || day > to) continue;
    const k = attendanceKind(r.data);
    if (k !== "unknown" && byDay.get(day) !== "late") byDay.set(day, k);
  }
  const leaveDays = new Set<string>();
  for (const l of leaves) {
    if (l.data.status !== "approved") continue;
    const n = overlapDays(l.data.startDate, l.data.endDate, from, today < to ? today : to);
    const s = String(l.data.startDate).slice(0, 10) > from ? String(l.data.startDate).slice(0, 10) : from;
    for (let i = 0; i < n; i++) leaveDays.add(new Date(Date.parse(s) + i * 864e5).toISOString().slice(0, 10));
  }
  let present = 0,
    late = 0,
    absent = 0;
  for (const [day, k] of byDay) {
    if (k === "leave") leaveDays.add(day);
    else if (k === "absent") absent++;
    else if (!leaveDays.has(day)) {
      present++;
      if (k === "late") late++;
    }
  }
  const recorded = present + absent + leaveDays.size;
  return { present, late, absent, leave: leaveDays.size, recorded, rate: recorded ? Math.round((present / recorded) * 100) : null };
}

export type Today = { present: number; away: number; recorded: boolean };
/**
 * Today across the team: at work (on time, late or off-site) and away (late, absent or on approved leave).
 * `recorded` is false when nobody has an attendance row today — the page then shows "—" instead of zeros.
 */
export function todaySummary(employees: Entity[], attendance: Entity[], leaves: Entity[], today = bangkokToday()): Today {
  let present = 0,
    away = 0,
    recorded = false;
  for (const e of employees) {
    const rows = forEmployee(attendance, e).filter((r) => String(r.data.date || "").slice(0, 10) === today);
    const kinds = rows.map((r) => attendanceKind(r.data));
    if (rows.length) recorded = true;
    const onLeave = forEmployee(leaves, e).some((l) => l.data.status === "approved" && overlapDays(l.data.startDate, l.data.endDate, today, today) > 0);
    const at = kinds.some((k) => k === "present" || k === "late");
    if (at && !onLeave) present++;
    if (onLeave || kinds.some((k) => k === "late" || k === "absent" || k === "leave")) away++;
  }
  return { present, away, recorded };
}

export type KpiLine = { id: string; label: string; period: string; value: number; target: number | null; actual: number | null; progress: number | null; status: string };
/** One KPI record on a 0–5 scale: its own score (1–5) when given, else progress (actual / target) mapped 100% → 5. */
export function kpiLine(r: Entity): KpiLine | null {
  const d = r.data,
    target = num(d.target),
    actual = num(d.actual),
    progress = Number.isFinite(target) && target && Number.isFinite(actual) ? Math.round((actual / target) * 1000) / 10 : null,
    score = num(d.score);
  const value = Number.isFinite(score) && score > 0 ? Math.min(5, score) : progress !== null ? Math.min(5, Math.max(0, progress / 20)) : NaN;
  if (!Number.isFinite(value)) return null;
  return {
    id: r.id,
    label: String(d.objective || d.name || "KPI"),
    period: String(d.period || ""),
    value: r1(value),
    target: Number.isFinite(target) ? target : null,
    actual: Number.isFinite(actual) ? actual : null,
    progress,
    status: String(d.status || ""),
  };
}

export type Performance = { score: number | null; source: "kpi" | "score" | null; lines: KpiLine[] };
/** Overall rating out of 5: average of this person's KPI lines, else the profile's คะแนนประเมิน (0–100) ÷ 20. */
export function performance(e: Entity, kpis: Entity[]): Performance {
  const lines = forEmployee(kpis, e)
    .map(kpiLine)
    .filter((l): l is KpiLine => !!l);
  if (lines.length) return { score: r1(lines.reduce((s, l) => s + l.value, 0) / lines.length), source: "kpi", lines };
  const s = num(e.data.score);
  return Number.isFinite(s) ? { score: r1(Math.min(100, Math.max(0, s)) / 20), source: "score", lines } : { score: null, source: null, lines };
}

/** Team average of everyone who has a rating (null when nobody has). */
export function teamScore(employees: Entity[], kpis: Entity[]) {
  const scores = employees.map((e) => performance(e, kpis).score).filter((s): s is number => s !== null);
  return scores.length ? r1(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

export const ratingLabel = (s: number) => (s >= 4.5 ? "ยอดเยี่ยม" : s >= 4 ? "ดีมาก" : s >= 3 ? "ดี" : s >= 2 ? "พอใช้" : "ต้องพัฒนา");

/** Headcount tiles: total, working, not working (percent of the total, one decimal). */
export function headcount(employees: Entity[]) {
  const total = employees.length,
    inactive = employees.filter(isInactive).length,
    pct = (n: number) => (total ? r1((n / total) * 100) : 0);
  return { total, active: total - inactive, inactive, activePct: pct(total - inactive), inactivePct: pct(inactive) };
}
export const percentOf = (n: number, total: number) => (total ? r1((n / total) * 100) : 0);

/** Vacation days used this year (approved ลาพักร้อน) and what is left of the yearly quota. */
export function leaveBalance(e: Entity, leaves: Entity[], today = bangkokToday()) {
  const year = today.slice(0, 4),
    mine = forEmployee(leaves, e);
  const used = mine
    .filter((l) => l.data.status === "approved" && l.data.type === "ลาพักร้อน")
    .reduce((s, l) => s + overlapDays(l.data.startDate, l.data.endDate, year + "-01-01", year + "-12-31"), 0);
  const quota = num(e.data.leaveQuota);
  return {
    used,
    quota: Number.isFinite(quota) && quota > 0 ? quota : null,
    left: Number.isFinite(quota) && quota > 0 ? Math.max(0, quota - used) : null,
    pending: mine.filter((l) => l.data.status === "pending").length,
  };
}

/** Page numbers to show: all when few, else first, last and a window around the current one (0 = gap). */
export function pageList(current: number, pages: number): number[] {
  if (pages <= 5) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, current - 1, current, current + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...set].sort((a, b) => a - b),
    out: number[] = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push(0);
    out.push(p);
  });
  return out;
}

// ---------- QR code (ISO 18004, byte mode, error correction M, versions 1–20) ----------
// Tables from the standard: EC codewords per block and number of blocks for level M.
const ECC_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const rawModules = (v: number) => {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (v >= 7) n -= 36;
  }
  return n;
};
const dataCodewords = (v: number) => Math.floor(rawModules(v) / 8) - ECC_M[v] * BLOCKS_M[v];
const gfMul = (x: number, y: number) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
};
function rsDivisor(degree: number) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 2);
  }
  return r;
}
function rsRemainder(data: number[], div: number[]) {
  const r = new Array(div.length).fill(0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => (r[i] ^= gfMul(c, f)));
  }
  return r;
}
const alignment = (v: number, size: number) => {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2,
    step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2,
    out = [6];
  for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
};

/** QR matrix (true = dark) for UTF-8 text, or null when it is too long for version 20. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1;
  for (; v <= 20; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break;
  if (v > 20) return null;
  // Data bits: mode, length, bytes, terminator, padding.
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  const cap = dataCodewords(v) * 8;
  put(4, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  // Split into blocks, add error correction, interleave.
  const blocks = BLOCKS_M[v],
    eccLen = ECC_M[v],
    raw = Math.floor(rawModules(v) / 8),
    short = blocks - (raw % blocks),
    shortLen = Math.floor(raw / blocks),
    div = rsDivisor(eccLen),
    parts: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < short) dat.push(0);
    parts.push(dat.concat(ecc));
  }
  const words: number[] = [];
  for (let i = 0; i < parts[0].length; i++)
    for (let j = 0; j < parts.length; j++) if (i !== shortLen - eccLen || j >= short) words.push(parts[j][i]);
  // Function patterns.
  const size = v * 4 + 17,
    m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    m[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)),
          x = cx + dx,
          y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  const al = alignment(v, size);
  al.forEach((ax, i) =>
    al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const format = (mask: number) => {
    const d = (0 << 3) | mask; // level M = 0b00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412,
      bit = (i: number) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (v >= 7) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (v << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) === 1,
        a = size - 11 + (i % 3),
        c = Math.floor(i / 3);
      set(a, c, dark);
      set(c, a, dark);
    }
  }
  // Codewords in the zig-zag order.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j,
          y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && i < words.length * 8) {
          m[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
  // Pick the mask with the lowest penalty (runs, 2×2 blocks, dark balance).
  const masks: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const apply = (k: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[k](x, y)) m[y][x] = !m[y][x];
  };
  const penalty = () => {
    let p = 0,
      dark = 0;
    for (let a = 0; a < size; a++) {
      let rx = 1,
        ry = 1;
      for (let b = 0; b < size; b++) {
        if (m[a][b]) dark++;
        if (b) {
          rx = m[a][b] === m[a][b - 1] ? rx + 1 : 1;
          ry = m[b][a] === m[b - 1][a] ? ry + 1 : 1;
          if (rx === 5) p += 3;
          else if (rx > 5) p++;
          if (ry === 5) p += 3;
          else if (ry > 5) p++;
        }
        if (a && b && m[a][b] === m[a - 1][b] && m[a][b] === m[a][b - 1] && m[a][b] === m[a - 1][b - 1]) p += 3;
      }
    }
    return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0,
    low = Infinity;
  for (let k = 0; k < 8; k++) {
    apply(k);
    format(k);
    const p = penalty();
    if (p < low) [best, low] = [k, p];
    apply(k);
  }
  apply(best);
  format(best);
  return m;
}
