"use client";
// หลังบ้าน phase 2: AI · ต้นทุน, LINE Bot and สุขภาพระบบ pages (see admin-monitor.ts). Same look as the rest of the
// console: coloured KPI cards, bar charts, and lists that open the company drawer.
import { useEffect, useState, type CSSProperties } from "react";
import { Activity, AlertTriangle, Bot, CheckCircle2, CircleAlert, Clock, Cpu, Database, KeyRound, MessagesSquare, RefreshCw, Send, ShieldCheck, Users, XCircle, type LucideIcon } from "lucide-react";
import { api, Loading } from "./shared";
import type { AiReport, HealthReport, LineReport } from "@/lib/admin-monitor";

const ago = (s?: string | null) => {
  if (!s) return "ไม่เคย";
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  if (m < 1) return "เมื่อสักครู่";
  if (m < 60) return m + " นาทีที่แล้ว";
  if (m < 1440) return Math.round(m / 60) + " ชม.ที่แล้ว";
  return Math.round(m / 1440) + " วันที่แล้ว";
};
const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("th-TH");
const short = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));
const planColor: Record<string, string> = { free: "#64748b", starter: "#2563eb", growth: "#7c3aed", business: "#ea580c", enterprise: "#db2777" };
const featureName: Record<string, string> = {
  extract: "อ่านเอกสาร / ใบเสร็จ",
  sort: "แยกประเภทข้อความ LINE",
  chat: "ถาม AI ในแชท",
  scan: "สแกนรูป / สลิป",
  transcribe: "ถอดเสียง",
  billing: "ตรวจสลิปค่าแพ็กเกจ",
  draft: "ร่างฟอร์ม",
  other: "อื่นๆ",
};

function useReport<T>(path: string, range: number | null, tick: number) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api(path + (range ? "?range=" + range : ""))
      .then((d) => live && (setData(d), setError("")))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [path, range, tick]);
  return { data, error };
}

function Kpi({ c, icon: Icon, label, value, sub, chg }: { c: string; icon: LucideIcon; label: string; value: string; sub?: string; chg?: { now: number; prev: number; invert?: boolean } }) {
  const pct = chg && chg.prev ? Math.round(((chg.now - chg.prev) / chg.prev) * 100) : null,
    good = pct === null ? true : chg!.invert ? pct <= 0 : pct >= 0;
  return (
    <div className="ad-kpi static" style={{ "--c": c } as CSSProperties}>
      <span className="ad-kpi-h">
        <i>
          <Icon size={16} />
        </i>
        {label}
        {pct !== null && (
          <em className={"ad-chg " + (good ? "up" : "dn")}>
            {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%
          </em>
        )}
      </span>
      <span className="ad-kpi-v">
        <b>{value}</b>
      </span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function Bars({ values, labels, color, alt, title }: { values: number[]; labels: string[]; color: [string, string]; alt?: number[]; title: (i: number) => string }) {
  const max = Math.max(0.0001, ...values),
    every = Math.ceil(values.length / 10);
  return (
    <div className="ad-bars" role="img" aria-label="กราฟรายวัน">
      {values.map((v, i) => (
        <div key={i} className="ad-bcol" title={title(i)}>
          <div className="ad-bpair">
            <i style={{ height: (v / max) * 100 + "%", background: `linear-gradient(180deg, ${color[0]}, ${color[1]})`, width: "min(16px, 70%)" }} />
            {alt && <i style={{ height: (alt[i] / max) * 100 + "%", background: "linear-gradient(180deg, #fb7185, #e11d48)", width: "min(8px, 35%)" }} />}
          </div>
          <small>{i % every === 0 || i === values.length - 1 ? labels[i] : ""}</small>
        </div>
      ))}
    </div>
  );
}

function Meter({ items }: { items: { label: string; value: number; color: string; sub?: string }[] }) {
  const max = Math.max(0.0001, ...items.map((x) => x.value));
  return (
    <div className="ad-meter">
      {items.map((x) => (
        <div key={x.label}>
          <span>
            <b>{x.label}</b>
            <em>{x.sub}</em>
          </span>
          <span className="ad-meter-track">
            <i style={{ width: Math.max(2, (x.value / max) * 100) + "%", background: x.color }} />
          </span>
        </div>
      ))}
    </div>
  );
}

const dayLabel = (d: string) => String(Number(d.slice(8)));
const dayTitle = (d: string) => new Date(d + "T12:00:00+07:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });

// ---------- AI · ต้นทุน ----------
export function AiPage({ range, tick, open }: { range: number; tick: number; open: (id: string) => void }) {
  const { data: r, error } = useReport<AiReport>("/admin/ai", range, tick);
  if (error) return <p className="form-error">{error}</p>;
  if (!r) return <Loading />;
  const featColors = ["#7c3aed", "#2563eb", "#0d9488", "#ea580c", "#db2777", "#16a34a", "#d97706"];
  const losing = r.byCompany.filter((c) => c.cost * 36 > c.revenue).length; // ~36 THB per USD
  return (
    <div className="ad-stack">
      <section className="ad-kpis">
        <Kpi c="#e11d48" icon={Bot} label="ค่า AI ช่วงนี้" value={usd(r.total.cost)} sub={`ช่วงก่อน ${usd(r.total.prevCost)}`} chg={{ now: r.total.cost, prev: r.total.prevCost, invert: true }} />
        <Kpi c="#7c3aed" icon={Activity} label="จำนวนครั้งที่เรียก AI" value={num(r.total.calls)} sub={r.total.calls ? `เฉลี่ย ${usd(r.total.cost / r.total.calls)} / ครั้ง` : "—"} />
        <Kpi c="#2563eb" icon={Cpu} label="Token ที่ใช้" value={short(r.total.input + r.total.output)} sub={`เข้า ${short(r.total.input)} · ออก ${short(r.total.output)}`} />
        <Kpi c="#d97706" icon={AlertTriangle} label="บริษัทที่ต้นทุนเกินรายได้" value={String(losing)} sub="จาก 15 บริษัทที่ใช้ AI มากสุด" />
      </section>
      <section className="card ad-card">
        <h3 className="ad-h">
          <Bot size={17} /> ค่า AI รายวัน (USD)
        </h3>
        <Bars values={r.daily.map((d) => d.cost)} labels={r.daily.map((d) => dayLabel(d.day))} color={["#fb7185", "#e11d48"]} title={(i) => `${dayTitle(r.daily[i].day)}: ${usd(r.daily[i].cost)}`} />
      </section>
      <div className="ad-row even">
        <section className="card ad-card">
          <h3 className="ad-h">
            <Activity size={17} /> แยกตามฟีเจอร์
          </h3>
          <Meter items={r.byFeature.map((f, i) => ({ label: featureName[f.key] || f.key, value: f.cost, color: featColors[i % featColors.length], sub: `${usd(f.cost)} · ${num(f.calls)} ครั้ง` }))} />
        </section>
        <section className="card ad-card">
          <h3 className="ad-h">
            <Cpu size={17} /> แยกตามโมเดล
          </h3>
          <Meter items={r.byModel.map((f, i) => ({ label: f.key, value: f.cost, color: featColors[(i + 3) % featColors.length], sub: `${usd(f.cost)} · ${num(f.calls)} ครั้ง` }))} />
        </section>
      </div>
      <section className="card ad-card">
        <h3 className="ad-h">
          <Users size={17} /> บริษัทที่ใช้ AI มากที่สุด
          <span className="ad-legend">เทียบค่าแพ็กเกจในช่วงเดียวกัน (≈ 36 บาท / USD)</span>
        </h3>
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>บริษัท</th>
                <th>ค่า AI</th>
                <th>ครั้ง</th>
                <th>รายได้แพ็กเกจ</th>
                <th>ผล</th>
              </tr>
            </thead>
            <tbody>
              {r.byCompany.map((c) => {
                const thb = c.cost * 36,
                  ok = c.revenue > thb;
                return (
                  <tr key={c.id} onClick={() => open(c.id)}>
                    <td>
                      <span className="ad-co">
                        <span className="ad-av" style={{ width: 32, height: 32, background: planColor[c.plan] }}>
                          {c.name.trim()[0]}
                        </span>
                        <span>
                          <b>{c.name}</b>
                          <small>{c.plan}</small>
                        </span>
                      </span>
                    </td>
                    <td data-label="ค่า AI">
                      {usd(c.cost)} <small className="ad-muted">≈ ฿{Math.round(thb).toLocaleString("th-TH")}</small>
                    </td>
                    <td data-label="ครั้ง">{num(c.calls)}</td>
                    <td data-label="รายได้แพ็กเกจ">{c.revenue ? "฿" + Math.round(c.revenue).toLocaleString("th-TH") : "ฟรี / ทดลอง"}</td>
                    <td data-label="ผล">
                      <span className={"ad-role " + (ok ? "r-manager" : "r-off")}>{ok ? "กำไร" : "ขาดทุน"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!r.byCompany.length && <p className="ad-empty">ยังไม่มีการใช้ AI ในช่วงนี้</p>}
      </section>
    </div>
  );
}

// ---------- LINE Bot ----------
export function LinePage({ range, tick, open }: { range: number; tick: number; open: (id: string) => void }) {
  const { data: r, error } = useReport<LineReport>("/admin/line", range, tick);
  if (error) return <p className="form-error">{error}</p>;
  if (!r) return <Loading />;
  const m = r.messages,
    done = m.approved + m.failed + m.skipped,
    rate = done ? Math.round((m.approved / done) * 100) : 0;
  return (
    <div className="ad-stack">
      <section className="ad-kpis">
        <Kpi c="#06c755" icon={MessagesSquare} label="กลุ่ม LINE ที่เชื่อม" value={num(r.groups.total)} sub={`ใหม่ ${r.groups.newInRange} · ฟังทุกข้อความ ${r.groups.listenAll}`} />
        <Kpi c="#2563eb" icon={Send} label="ข้อความที่สั่งงาน" value={num(m.total)} sub={`ช่วงก่อน ${num(m.prev)}`} chg={{ now: m.total, prev: m.prev }} />
        <Kpi c="#16a34a" icon={CheckCircle2} label="บันทึกสำเร็จ" value={rate + "%"} sub={`สำเร็จ ${num(m.approved)} · ล้มเหลว ${num(m.failed)}`} />
        <Kpi c="#d97706" icon={Clock} label="กลุ่มที่เงียบ 14 วัน" value={num(r.groups.quiet)} sub="ควรติดตามลูกค้า" />
      </section>
      <section className="card ad-card">
        <h3 className="ad-h">
          <MessagesSquare size={17} /> ข้อความต่อวัน
          <span className="ad-legend">
            <i style={{ background: "#06c755" }} /> ทั้งหมด <i style={{ background: "#e11d48" }} /> ล้มเหลว
          </span>
        </h3>
        <Bars
          values={r.daily.map((d) => d.total)}
          alt={r.daily.map((d) => d.failed)}
          labels={r.daily.map((d) => dayLabel(d.day))}
          color={["#4ade80", "#06c755"]}
          title={(i) => `${dayTitle(r.daily[i].day)}: ${r.daily[i].total} ข้อความ · ล้มเหลว ${r.daily[i].failed}`}
        />
        <div className="ad-mini">
          <div style={{ "--b": "#dcfce7", "--t": "#15803d" } as CSSProperties}>
            <small>บันทึกแล้ว</small>
            <b>{num(m.approved)}</b>
          </div>
          <div style={{ "--b": "#fef3c7", "--t": "#b45309" } as CSSProperties}>
            <small>รออนุมัติ</small>
            <b>{num(m.review)}</b>
          </div>
          <div style={{ "--b": "#e0f2fe", "--t": "#0369a1" } as CSSProperties}>
            <small>รอยืนยัน / กำลังทำ</small>
            <b>{num(m.waiting)}</b>
          </div>
          <div style={{ "--b": "#f1f5f9", "--t": "#475569" } as CSSProperties}>
            <small>ข้าม / ปฏิเสธ</small>
            <b>{num(m.skipped)}</b>
          </div>
          <div style={{ "--b": "#fee2e2", "--t": "#b91c1c" } as CSSProperties}>
            <small>ล้มเหลว</small>
            <b>{num(m.failed)}</b>
          </div>
        </div>
      </section>
      <div className="ad-row even">
        <section className="card ad-card">
          <h3 className="ad-h">
            <Send size={17} /> กลุ่มที่ใช้งานมากที่สุด
          </h3>
          <GroupList rows={r.topGroups.map((g) => ({ ...g, right: num(g.count) + " ข้อความ" }))} open={open} empty="ยังไม่มีข้อความในช่วงนี้" />
        </section>
        <section className="card ad-card">
          <h3 className="ad-h">
            <Clock size={17} /> กลุ่มที่เงียบเกิน 14 วัน
          </h3>
          <GroupList rows={r.quietGroups.map((g) => ({ ...g, right: ago(g.last) }))} open={open} empty="ทุกกลุ่มยังใช้งานอยู่" warn />
        </section>
      </div>
      <section className="card ad-card">
        <h3 className="ad-h">
          <CircleAlert size={17} /> ข้อความที่บันทึกไม่สำเร็จล่าสุด
        </h3>
        <ErrorList rows={r.recentFailed.map((f) => ({ ...f, where: f.group }))} open={open} empty="ไม่มีข้อความที่ล้มเหลวในช่วงนี้" />
      </section>
    </div>
  );
}
function GroupList({ rows, open, empty, warn }: { rows: { group_id: string; name: string; company: string; company_id: string; right: string }[]; open: (id: string) => void; empty: string; warn?: boolean }) {
  if (!rows.length) return <p className="ad-empty">{empty}</p>;
  return (
    <div className="ad-list">
      {rows.map((g) => (
        <button key={g.group_id} onClick={() => open(g.company_id)}>
          <i className="ad-gicon" style={{ background: warn ? "linear-gradient(135deg, #fbbf24, #d97706)" : "linear-gradient(135deg, #4ade80, #06c755)" }}>
            <MessagesSquare size={14} />
          </i>
          <span>
            <b>{g.name}</b>
            <small>{g.company}</small>
          </span>
          <em className={warn ? "ad-due" : "ad-strong"}>{g.right}</em>
        </button>
      ))}
    </div>
  );
}
function ErrorList({ rows, open, empty }: { rows: { id: string; company: string; company_id: string; where: string; error: string; at: string }[]; open: (id: string) => void; empty: string }) {
  if (!rows.length)
    return (
      <p className="ad-empty ad-good">
        <CheckCircle2 size={16} /> {empty}
      </p>
    );
  return (
    <div className="ad-errs">
      {rows.map((f) => (
        <button key={f.id} onClick={() => open(f.company_id)}>
          <i>
            <XCircle size={15} />
          </i>
          <span>
            <b>{f.company}</b>
            <small>
              {f.where} · {ago(f.at)}
            </small>
            <code>{f.error}</code>
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- สุขภาพระบบ ----------
export function HealthPage({ tick, open }: { tick: number; open: (id: string) => void }) {
  const { data: r, error } = useReport<HealthReport>("/admin/health", null, tick);
  if (error) return <p className="form-error">{error}</p>;
  if (!r) return <Loading />;
  const allOk = r.services.every((s) => s.ok) && !r.queue.stuck && !r.queue.failed24 && !r.outbox.failed,
    icons: Record<string, LucideIcon> = { db: Database, service: KeyRound, line: MessagesSquare, ai: Bot, admins: ShieldCheck };
  return (
    <div className="ad-stack">
      <section className={"ad-status " + (allOk ? "ok" : "warn")}>
        <i>{allOk ? <CheckCircle2 size={26} /> : <AlertTriangle size={26} />}</i>
        <div>
          <h2>{allOk ? "ระบบทำงานปกติทั้งหมด" : "มีบางส่วนที่ควรตรวจสอบ"}</h2>
          <p>
            <RefreshCw size={12} /> ตรวจล่าสุด {new Date(r.checkedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok" })}
          </p>
        </div>
      </section>
      <section className="ad-services">
        {r.services.map((s) => {
          const Icon = icons[s.key] || Activity;
          return (
            <div key={s.key} className={s.ok ? "ok" : "bad"}>
              <i>
                <Icon size={17} />
              </i>
              <span>
                <b>{s.label}</b>
                <small>{s.detail}</small>
              </span>
              <em>{s.ok ? "ปกติ" : "ต้องแก้"}</em>
            </div>
          );
        })}
      </section>
      <section className="ad-kpis">
        <Kpi c="#2563eb" icon={Clock} label="คิวรอประมวลผล" value={num(r.queue.queued)} sub={`กำลังทำ ${r.queue.processing}`} />
        <Kpi c={r.queue.stuck ? "#e11d48" : "#16a34a"} icon={AlertTriangle} label="งานค้าง (เกินเวลา)" value={num(r.queue.stuck)} sub={r.queue.stuck ? "ระบบจะลองใหม่อัตโนมัติ" : "ไม่มีงานค้าง"} />
        <Kpi c={r.queue.failed24 ? "#e11d48" : "#16a34a"} icon={XCircle} label="ล้มเหลว 24 ชม." value={num(r.queue.failed24)} sub={`7 วัน ${num(r.queue.failed7)}`} />
        <Kpi c={r.outbox.failed ? "#d97706" : "#7c3aed"} icon={Send} label="แจ้งเตือน LINE ค้างส่ง" value={num(r.outbox.pending)} sub={r.outbox.failed ? `ส่งไม่ออก ${r.outbox.failed} (ลองครบ 5 ครั้ง)` : r.outbox.oldest ? "เก่าสุด " + ago(r.outbox.oldest) : "ไม่มีค้าง"} />
      </section>
      <div className="ad-row even">
        <section className="card ad-card">
          <h3 className="ad-h">
            <CircleAlert size={17} /> ข้อผิดพลาดที่เจอบ่อย (7 วัน)
          </h3>
          {r.errors.length ? (
            <div className="ad-kinds">
              {r.errors.map((e) => (
                <div key={e.message}>
                  <b>{e.count}×</b>
                  <span>
                    <code>{e.message}</code>
                    <small>
                      {e.companies} บริษัท · ล่าสุด {ago(e.last)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="ad-empty ad-good">
              <CheckCircle2 size={16} /> ไม่มีข้อผิดพลาดใน 7 วัน
            </p>
          )}
        </section>
        <section className="card ad-card">
          <h3 className="ad-h">
            <XCircle size={17} /> งานที่ล้มเหลวล่าสุด
          </h3>
          <ErrorList rows={r.recent.map((x) => ({ ...x, where: x.source === "LINE" ? "จาก LINE" : "จากเว็บ" }))} open={open} empty="ไม่มีงานที่ล้มเหลว" />
        </section>
      </div>
    </div>
  );
}
