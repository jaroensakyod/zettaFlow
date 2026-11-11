"use client";
// หน้า LINE Integration (Canva page 15): hero + LINE package, page stats, tabs (groups table, approvals, data rules,
// connection history, advanced) and a right column with the packages and the latest activity.
// One read (/line-page → src/lib/line-page.ts) feeds the page; a row opens the existing group detail (line-hub.tsx).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock3,
  Crown,
  Eye,
  EyeOff,
  Gem,
  Gift,
  FileText,
  Filter,
  GitBranch,
  History,
  KeyRound,
  Laptop,
  Layers,
  Leaf,
  Link2,
  ListChecks,
  Megaphone,
  MessageCircle,
  Monitor,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  UserCheck,
  Users,
  Wallet,
  Warehouse,
  BarChart3,
} from "lucide-react";
import { api, Empty, Loading, Modal } from "./shared";
import { LineGroupDetail, type Form } from "./line-hub";
import { deptThai } from "@/lib/line-message";
import type { Context } from "@/lib/types";
import type { Activity, Approver, LinePageData, PageGroup } from "@/lib/line-page";
import { approverPortrait, lineSample } from "@/lib/mock/line";

type Tab = "groups" | "approvals" | "rules" | "history" | "advanced";
const tabs: [Tab, string, typeof Users][] = [
  ["groups", "จัดการกลุ่ม LINE", Users],
  ["approvals", "สิทธิ์และการอนุมัติ", UserCheck],
  ["rules", "กฎการดึงข้อมูล (Workflow)", GitBranch],
  ["history", "ประวัติการเชื่อมต่อ", History],
  ["advanced", "ตั้งค่าขั้นสูง", Settings],
];
const statusFilters = {
  all: "ทั้งหมด",
  connected: "เชื่อมต่อแล้ว",
  issue: "มีปัญหา",
  waiting: "มีรายการรออนุมัติ",
  test: "กลุ่มทดสอบ",
} as const;
type StatusFilter = keyof typeof statusFilters;

const deptIcons: Record<string, typeof Users> = {
  Finance: Wallet,
  Sales: ShoppingCart,
  Marketing: Megaphone,
  Purchasing: Package,
  Warehouse: Warehouse,
  Operations: Layers,
  Admin: Briefcase,
  HR: Users,
  IT: Monitor,
};
/** Name with role; a sample approver already carries its title in parentheses. */
const approverText = (a: Approver) => (/\)$/.test(a.name) ? a.name : `${a.name} (${a.role === "owner" ? "เจ้าของ" : "ผู้จัดการ"})`);
const tierIcons: Record<string, typeof Users> = { free: Gift, starter: Leaf, growth: Rocket, business: Building2, enterprise: Gem };
/** Same colours as the package cards on แพ็กเกจบริการ. */
const tierTone: Record<string, string> = { free: "green", starter: "blue", growth: "violet", business: "orange", enterprise: "pink" };
const roleLabel = (a: Approver) => (a.role === "owner" ? "เจ้าของ" : "ผู้จัดการ" + (a.departments.length ? " " + a.departments.map((d) => deptThai[d] || d).join(", ") : ""));

/** "วันนี้ 14:32" / "เมื่อวาน 17:20" / "3 พ.ย. 09:10" in Bangkok time. */
function when(iso: string) {
  const day = (t: number) => new Date(t + 7 * 3600000).toISOString().slice(0, 10);
  const d = day(Date.parse(iso)),
    today = day(Date.now()),
    yesterday = day(Date.now() - 86400000);
  const hm = new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
  if (d === today) return "วันนี้ " + hm;
  if (d === yesterday) return "เมื่อวาน " + hm;
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" }) + " " + hm;
}

function LineMark({ size = 20 }: { size?: number }) {
  return (
    <i className="lp-line-mark" style={{ width: size + 12, height: size + 12 }} aria-hidden>
      <MessageCircle size={size} fill="currentColor" />
    </i>
  );
}
const letterTints = ["#ece5fd", "#fde8f3", "#e5f0fd", "#e3f6e8", "#fdf2dc", "#e3f4fb", "#fdebee"];
const letterTint = (name: string) => letterTints[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % letterTints.length];
function Face({ p, size = 26 }: { p: { name: string; picture: string | null }; size?: number }) {
  return p.picture ? (
    <img className="lp-face" src={p.picture} alt={p.name} title={p.name} width={size} height={size} />
  ) : (
    <i className="lp-face lp-face-letter" style={{ width: size, height: size, background: letterTint(p.name) }} title={p.name}>
      {p.name.trim().slice(0, 1) || "?"}
    </i>
  );
}
function DeptChip({ g }: { g: Pick<PageGroup, "department" | "departmentLabel" | "tone"> }) {
  if (!g.department) return <span className="lp-chip lp-tone-none">ยังไม่ระบุแผนก</span>;
  const Icon = deptIcons[g.department] || Building2;
  return (
    <span className={"lp-chip lp-tone-" + g.tone}>
      <Icon size={13} /> {g.departmentLabel}
    </span>
  );
}
function StatusChip({ g }: { g: PageGroup }) {
  if (g.status === "test") return <span className="lp-status lp-status-test">กลุ่มทดสอบ</span>;
  if (g.status === "problem")
    return (
      <span className="lp-status lp-status-problem" title="ดึงข้อมูลกลุ่มจาก LINE ไม่ได้ บอทอาจถูกนำออกจากกลุ่ม">
        <AlertTriangle size={13} /> บอทไม่อยู่ในกลุ่ม
      </span>
    );
  if (g.status === "warn")
    return (
      <span className="lp-status lp-status-warn" title="ข้อความที่อ่านไม่สำเร็จใน 7 วันที่ผ่านมา">
        <AlertTriangle size={13} /> อ่านไม่สำเร็จ {g.failedWeek}
      </span>
    );
  return (
    <span className="lp-status lp-status-ok">
      <CheckCircle2 size={13} /> เชื่อมต่อแล้ว
    </span>
  );
}
function GroupCell({ g }: { g: PageGroup }) {
  return (
    <span className="lp-group">
      {g.picture ? <img src={g.picture} alt="" width={34} height={34} /> : <i className="lp-group-pic">{g.test ? <Bot size={16} /> : <Users size={16} />}</i>}
      <span>
        <b>{g.title}</b>
        <small>{g.members != null ? `สมาชิก ${g.members} คน` : g.test ? "สร้างโดยสคริปต์ทดสอบ" : "ไม่ทราบจำนวนสมาชิก"}</small>
      </span>
    </span>
  );
}

export function LineIntegrationPage({ ctx, notify }: { ctx: Context; notify: (s: string) => void }) {
  const allowed = ["owner", "manager"].includes(ctx.member.role),
    owner = ctx.member.role === "owner";
  const [data, setData] = useState<LinePageData | null>(null),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0),
    [tab, setTab] = useState<Tab>("groups"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState<StatusFilter>("all"),
    [picked, setPicked] = useState<string[]>([]),
    [detail, setDetail] = useState<{ id: string; editing: boolean } | null>(null),
    [pairing, setPairing] = useState(false),
    [forms, setForms] = useState<Form[]>([]),
    // Sample mode: "auto" shows the mockup while the company has no groups; the header button forces it on / off.
    [sampleMode, setSampleMode] = useState<"auto" | "on" | "off">("auto");
  const sampleData = useMemo(() => lineSample(), []);
// Samples / mockups exist only in the public demo; a real company always sees its own data (or an empty state).
  const sample = ctx.demo && (sampleMode === "on" || (sampleMode === "auto" && !!data && !data.groups.length));
  const view = sample ? sampleData : data;
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    api("/line-page")
      .then((d: LinePageData) => {
        if (!live) return;
        setData(d);
        setError("");
        setPicked((p) => p.filter((id) => d.groups.some((g) => g.group_id === id)));
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [allowed, tick]);
  useEffect(() => {
    if (owner) api("/templates").then(setForms).catch(() => {});
  }, [owner]);

  const groups = useMemo(() => view?.groups || [], [view]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter(
      (g) =>
        (!q || g.search.includes(q)) &&
        (status === "all" ||
          (status === "connected" && g.status === "connected") ||
          (status === "issue" && (g.status === "problem" || g.status === "warn")) ||
          (status === "waiting" && g.waiting > 0) ||
          (status === "test" && g.test)),
    );
  }, [groups, query, status]);

  if (!allowed)
    return (
      <div className="lp-page">
        <Hero />
        <LinePairing ctx={ctx} forms={[]} />
      </div>
    );

  const open = detail && !sample ? groups.find((g) => g.group_id === detail.id) : undefined;
  const pkg = view?.package,
    current = pkg?.tiers.find((t) => t.current);
  const limitText = pkg ? (pkg.limit == null ? "ไม่จำกัด" : String(pkg.limit)) : "—";
  const pct = pkg && pkg.limit ? Math.min(100, Math.round((pkg.used / pkg.limit) * 100)) : pkg ? 100 : 0;
  const allPicked = shown.length > 0 && shown.every((g) => picked.includes(g.group_id));

  async function unlinkPicked() {
    const list = groups.filter((g) => picked.includes(g.group_id));
    if (!list.length || !confirm(`ยกเลิกการเชื่อม ${list.length} กลุ่ม (${list.map((g) => g.title).join(", ")})? ข้อความใหม่จากกลุ่มเหล่านี้จะไม่ถูกบันทึกอีก`)) return;
    try {
      for (const g of list) await api("/integrations/" + encodeURIComponent(g.group_id), { method: "DELETE" });
      notify(`ยกเลิกการเชื่อม ${list.length} กลุ่มแล้ว`);
      setPicked([]);
      reload();
    } catch (e) {
      setError((e as Error).message);
      reload();
    }
  }
  async function unlinkOne(g: PageGroup) {
    if (!confirm(`ยกเลิกการเชื่อม "${g.title}"? ข้อความใหม่จากกลุ่มนี้จะไม่ถูกบันทึกอีก`)) return;
    try {
      await api("/integrations/" + encodeURIComponent(g.group_id), { method: "DELETE" });
      notify("ยกเลิกการเชื่อมกลุ่มแล้ว");
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const closeMenu = (e: React.MouseEvent) => e.currentTarget.closest("details")?.removeAttribute("open");

  const stats = view?.stats;
  /** Sample rows never reach the API: say so instead of opening / editing / unlinking. */
  const sampleOnly = () => notify("นี่คือข้อมูลตัวอย่าง — เชื่อมต่อกลุ่ม LINE จริงเพื่อจัดการกลุ่ม");
  const openRow = (id: string, editing: boolean) => (sample ? sampleOnly() : setDetail({ id, editing }));
  const sampleToggle = ctx.demo && (
    <button
      className={"lp-sample-toggle" + (sample ? " on" : "")}
      aria-pressed={sample}
      onClick={() => {
        setPicked([]);
        setSampleMode(sample ? "off" : "on");
      }}
    >
      {sample ? <EyeOff size={15} /> : <Eye size={15} />} {sample ? "ปิดตัวอย่าง" : "ดูตัวอย่าง"}
    </button>
  );
  const tiles: [string, number | undefined, string, typeof Users, string][] = [
    ["กลุ่มที่เชื่อมต่อ", stats?.groups, "กลุ่ม", Users, "violet"],
    ["เชื่อมต่อสำเร็จ", stats?.connected, "กลุ่ม", Link2, "green"],
    ["รอเชื่อมต่อ", stats?.pending, "กลุ่ม", Clock3, "amber"],
    ["มีปัญหา", stats?.problems, "กลุ่ม", AlertTriangle, "red"],
    ["รายการรออนุมัติ", stats?.waiting, "รายการ", ListChecks, "indigo"],
  ];

  return (
    <div className="lp-page">
      <div className="lp-top">
        <Hero action={sampleToggle} />
        <section className={"lp-pkg-card tone-" + (tierTone[pkg?.planId || ""] || "violet")}>
          <h3>แพ็กเกจเชื่อมต่อ LINE</h3>
          {!pkg ? (
            <p className="lp-muted">กำลังโหลด…</p>
          ) : (
            <>
              <div className="lp-pkg-row">
                <b>
                  <Crown size={16} /> {pkg.planName || "ยังไม่มีแพ็กเกจ"}
                  {current ? ` (${current.range})` : ""}
                </b>
                <a className="lp-pill-button" href="/workspace/pricing">
                  จัดการแพ็กเกจ
                </a>
              </div>
              <p className="lp-pkg-used">
                ใช้งานอยู่ <b>{pkg.used}</b> / {limitText} กลุ่ม{pkg.trial ? " · ช่วงทดลองใช้" : ""}
              </p>
              <div className="lp-progress" role="progressbar" aria-valuenow={pkg.used} aria-valuemin={0} aria-valuemax={pkg.limit ?? undefined}>
                <span style={{ width: pct + "%" }} />
              </div>
            </>
          )}
        </section>
      </div>

      {sample && (
        <div className="lp-sample-banner" role="status">
          <span className="sample-badge">ตัวอย่าง</span>
          <p>กำลังดูตัวอย่าง — ข้อมูลสมมติเพื่อให้เห็นหน้าตาเมื่อมีข้อมูลจริง</p>
          <div>
            <button className="secondary" onClick={() => setSampleMode("off")}>
              ปิดตัวอย่าง
            </button>
            {owner && (
              <button
                className="primary"
                onClick={() => {
                  setSampleMode("off");
                  setPairing(true);
                }}
              >
                <Plus size={15} /> เชื่อมต่อกลุ่ม LINE
              </button>
            )}
          </div>
        </div>
      )}

      <div className={"lp-stats" + (sample ? " lp-is-sample" : "")}>
        {tiles.map(([label, n, unit, Icon, tone]) => (
          <div key={label} className={"lp-stat lp-stat-" + tone}>
            <i>
              <Icon size={20} />
            </i>
            <span>
              <small>{label}</small>
              <b>
                {n ?? "—"} <em>{unit}</em>
              </b>
            </span>
          </div>
        ))}
      </div>

      <div className="lp-layout">
        <div className="lp-main">
          <nav className="lp-tabs" role="tablist">
            {tabs.map(([k, label, Icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </nav>
          {error && <p className="form-error">{error}</p>}
          {!view ? (
            !error && <Loading />
          ) : tab === "groups" ? (
            <section className={"lp-card" + (sample ? " lp-is-sample" : "")}>
              <div className="lp-card-head">
                <h2>
                  กลุ่ม LINE ที่เชื่อมต่อ{" "}
                  <span className="lp-accent">
                    ({view.package.used} / {limitText})
                  </span>
                  {sample && <span className="sample-badge lp-head-badge">ตัวอย่าง</span>}
                </h2>
                <div className="lp-tools">
                  <label className="lp-search">
                    <Search size={15} />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาชื่อกลุ่มหรือแผนก..." aria-label="ค้นหาชื่อกลุ่มหรือแผนก" />
                  </label>
                  <label className="lp-filter">
                    <Filter size={15} />
                    <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="กรองสถานะ">
                      {Object.entries(statusFilters).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="icon-button" aria-label="โหลดใหม่" onClick={reload}>
                    <RefreshCw size={15} />
                  </button>
                  {owner && (
                    <button className="primary lp-add" onClick={() => setPairing(true)}>
                      <Plus size={15} /> เชื่อมต่อกลุ่ม LINE
                    </button>
                  )}
                </div>
              </div>
              {owner && !sample && picked.length > 0 && (
                <div className="lp-bulk">
                  เลือก {picked.length} กลุ่ม
                  <button className="secondary danger" onClick={unlinkPicked}>
                    <Trash2 size={14} /> ยกเลิกการเชื่อม
                  </button>
                  <button className="text-button" onClick={() => setPicked([])}>
                    ล้างการเลือก
                  </button>
                </div>
              )}
              {!groups.length ? (
                <Empty
                  title="ยังไม่ได้เชื่อมกลุ่ม LINE"
                  description="เพิ่มบอท EliteFlow เข้ากลุ่ม แล้วกด “เชื่อมต่อกลุ่ม LINE” เพื่อสร้างรหัสไปพิมพ์ในกลุ่ม"
                  action={
                    owner ? (
                      <button className="primary" onClick={() => setPairing(true)}>
                        <Plus size={15} /> เชื่อมต่อกลุ่ม LINE
                      </button>
                    ) : undefined
                  }
                />
              ) : !shown.length ? (
                <Empty title="ไม่พบกลุ่มที่ตรงกับการค้นหา" />
              ) : (
                <div className="lp-table-wrap">
                  <table className="lp-table">
                    <thead>
                      <tr>
                        <th className="lp-check">
                          <input
                            type="checkbox"
                            aria-label="เลือกทุกกลุ่ม"
                            checked={allPicked}
                            disabled={sample}
                            onChange={() => setPicked(allPicked ? [] : shown.map((g) => g.group_id))}
                          />
                        </th>
                        <th>กลุ่ม LINE</th>
                        <th>แผนกที่เชื่อมต่อ</th>
                        <th>ประเภทข้อมูลที่ดึง</th>
                        <th>ผู้ส่งงาน (พนักงาน)</th>
                        <th>ผู้อนุมัติ</th>
                        <th>สถานะ</th>
                        <th>จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((g) => (
                        <tr key={g.group_id} className={g.test ? "lp-row-test" : ""} onClick={() => openRow(g.group_id, false)}>
                          <td className="lp-check" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={"เลือก " + g.title}
                              checked={picked.includes(g.group_id)}
                              disabled={sample}
                              onChange={() => setPicked((p) => (p.includes(g.group_id) ? p.filter((x) => x !== g.group_id) : [...p, g.group_id]))}
                            />
                          </td>
                          <td>
                            <GroupCell g={g} />
                          </td>
                          <td>
                            <DeptChip g={g} />
                          </td>
                          <td className="lp-kinds">
                            {g.kinds.length ? g.kinds.join(", ") : <span className="lp-muted">{g.templateName || "AI แยกอัตโนมัติ · ยังไม่มีข้อมูล"}</span>}
                          </td>
                          <td>
                            {g.senderCount ? (
                              <span className="lp-faces">
                                {g.senders.map((p, i) => (
                                  <Face key={i} p={p} />
                                ))}
                                {g.senderCount > g.senders.length && <em>+{g.senderCount - g.senders.length}</em>}
                              </span>
                            ) : (
                              <span className="lp-muted">ยังไม่มีผู้ส่ง</span>
                            )}
                          </td>
                          <td>
                            {g.approvers.length ? (
                              <span className="lp-approver" title={g.approvers.map((a) => `${a.name} (${roleLabel(a)})`).join("\n")}>
                                <Face p={{ name: g.approvers[0].name, picture: sample ? approverPortrait(g.approvers[0].name) : null }} />
                                <span>{approverText(g.approvers[0])}</span>
                                {g.approvers.length > 1 && <em>+{g.approvers.length - 1}</em>}
                              </span>
                            ) : (
                              <span className="lp-muted">{view.adminReady ? "ยังไม่มีผู้อนุมัติที่เชื่อม LINE" : "—"}</span>
                            )}
                          </td>
                          <td>
                            <StatusChip g={g} />
                            {g.waiting > 0 && <small className="lp-waiting">รออนุมัติ {g.waiting}</small>}
                          </td>
                          <td className="lp-actions" onClick={(e) => e.stopPropagation()}>
                            {owner && (
                              <button className="icon-button" aria-label={"ตั้งค่า " + g.title} disabled={sample} title={sample ? "ข้อมูลตัวอย่าง" : undefined} onClick={() => openRow(g.group_id, true)}>
                                <Pencil size={15} />
                              </button>
                            )}
                            <details className="lp-menu">
                              <summary aria-label={"เมนู " + g.title}>
                                <MoreHorizontal size={16} />
                              </summary>
                              <div>
                                <button
                                  onClick={(e) => {
                                    closeMenu(e);
                                    openRow(g.group_id, false);
                                  }}
                                >
                                  <MessageCircle size={14} /> ดูข้อความในกลุ่ม
                                </button>
                                {g.waiting > 0 && !sample && (
                                  <a href="/workspace/ai-inbox">
                                    <ListChecks size={14} /> ไปหน้ารออนุมัติ
                                  </a>
                                )}
                                {owner && !sample && (
                                  <button
                                    className="danger-text"
                                    onClick={(e) => {
                                      closeMenu(e);
                                      unlinkOne(g);
                                    }}
                                  >
                                    <Trash2 size={14} /> ยกเลิกการเชื่อม
                                  </button>
                                )}
                              </div>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : tab === "approvals" ? (
            <Approvals data={view} owner={owner && !sample} sample={sample} ctx={ctx} edit={(id) => openRow(id, true)} />
          ) : tab === "rules" ? (
            <Rules groups={groups} owner={owner && !sample} sample={sample} edit={(id) => openRow(id, true)} />
          ) : tab === "history" ? (
            <section className="lp-card">
              <div className="lp-card-head">
                <h2>ประวัติการเชื่อมต่อ</h2>
                {sample && <span className="sample-badge">ตัวอย่าง</span>}
              </div>
              <Timeline items={view.activity} />
            </section>
          ) : (
            <Advanced owner={owner} demo={ctx.demo} configured={data?.configured ?? false} adminReady={data?.adminReady ?? false} />
          )}
        </div>

        <aside className="lp-aside">
          <section className="lp-card">
            <h3 className="lp-aside-title">แพ็กเกจเชื่อมต่อ LINE {sample && <span className="sample-badge">ตัวอย่าง</span>}</h3>
            {!pkg ? (
              <Loading />
            ) : (
              <ul className="lp-tiers">
                {pkg.tiers.map((t, i) => {
                  const Icon = tierIcons[t.id] || [Leaf, Rocket, Gem, Building2][i] || Building2;
                  return (
                    <li key={t.id} className={"tone-" + (tierTone[t.id] || "violet") + (t.current ? " current" : "")}>
                      <i>
                        <Icon size={17} />
                      </i>
                      <span>
                        <b>
                          {t.name} ({t.range})
                        </b>
                        <small>{t.note}</small>
                      </span>
                      {t.current && (
                        <em>
                          <Crown size={12} /> ใช้งานอยู่
                        </em>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {pkg?.trial && pkg.limit != null && <p className="lp-note">ช่วงทดลองใช้เชื่อมได้สูงสุด {pkg.limit} กลุ่ม เลือกแพ็กเกจเพื่อเพิ่ม</p>}
          </section>
          <section className="lp-card">
            <div className="lp-aside-head">
              <h3 className="lp-aside-title">กิจกรรมล่าสุด {sample && <span className="sample-badge">ตัวอย่าง</span>}</h3>
              {view && view.activity.length > 4 && (
                <button className="text-button" onClick={() => setTab("history")}>
                  ดูทั้งหมด
                </button>
              )}
            </div>
            {!view ? <Loading /> : <Timeline items={view.activity.slice(0, 4)} compact />}
          </section>
        </aside>
      </div>

      {open && detail && (
        <Modal title={open.title} onClose={() => setDetail(null)}>
          <div className="lp-detail">
            <LineGroupDetail
              key={open.group_id + String(detail.editing)}
              ctx={ctx}
              notify={notify}
              group={open}
              label={open.title}
              forms={forms}
              startEditing={detail.editing}
              onChanged={reload}
              onUnlinked={() => {
                setDetail(null);
                reload();
              }}
            />
          </div>
        </Modal>
      )}
      {pairing && (
        <Modal title="เชื่อมต่อกลุ่ม LINE" onClose={() => setPairing(false)}>
          <div className="lp-pair-modal">
            <LinePairing ctx={ctx} forms={forms} full={data?.package.limit != null && data.package.used >= data.package.limit} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Hero({ action }: { action?: React.ReactNode }) {
  return (
    <section className="lp-hero">
      <div className="lp-hero-text">
        <i className="lp-hero-logo" aria-hidden>
          <MessageCircle size={34} fill="currentColor" />
          <b>LINE</b>
        </i>
        <div>
          <h1>LINE Integration</h1>
          <p>
            เชื่อมต่อกลุ่ม LINE กับ EliteFlow
            <br />
            เพื่อดึงข้อมูล แปลงเป็นงาน รายงาน และอนุมัติได้ในระบบ
          </p>
          {action && <div className="lp-hero-action">{action}</div>}
        </div>
      </div>
      <div className="lp-hero-art" aria-hidden>
        <span className="lp-art-laptop">
          <Laptop size={64} strokeWidth={1.3} />
          <LineMark size={14} />
        </span>
        <ArrowRight className="lp-art-arrow" size={30} />
        <span className="lp-art-brand">
          <img src="/brand/eliteflow-mark.png" alt="" width={44} height={44} />
        </span>
        <span className="lp-art-docs">
          <i>
            <FileText size={18} />
          </i>
          <i>
            <ShieldCheck size={18} />
          </i>
          <i>
            <BarChart3 size={18} />
          </i>
        </span>
      </div>
    </section>
  );
}

function Timeline({ items, compact = false }: { items: Activity[]; compact?: boolean }) {
  if (!items.length) return <Empty title="ยังไม่มีกิจกรรม" description="เมื่อเชื่อมกลุ่มหรือมีข้อความเข้ามา กิจกรรมจะแสดงที่นี่" />;
  return (
    <ol className={"lp-timeline" + (compact ? " compact" : "")}>
      {items.map((a, i) => (
        <li key={a.kind + a.at + i} className={"lp-act-" + a.kind}>
          <LineMark size={14} />
          <span>
            <b>{a.text}</b>
            <small>{when(a.at)}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Approvals({ data, owner, sample, ctx, edit }: { data: LinePageData; owner: boolean; sample: boolean; ctx: Context; edit: (id: string) => void }) {
  return (
    <>
      <section className="lp-card">
        <div className="lp-card-head">
          <h2>สิทธิ์และการอนุมัติต่อกลุ่ม</h2>
          {sample && <span className="sample-badge">ตัวอย่าง</span>}
        </div>
        <p className="lp-note">
          ในกลุ่ม ผู้อนุมัติพิมพ์คำอนุมัติ (หรือกด Reply) เพื่ออนุมัติรายการ เจ้าของอนุมัติได้ทุกกลุ่ม ผู้จัดการอนุมัติได้เฉพาะรายการของแผนกตน และต้องเชื่อมบัญชี LINE ของตัวเองก่อน
        </p>
        {!data.groups.length ? (
          <Empty title="ยังไม่ได้เชื่อมกลุ่ม LINE" />
        ) : (
          <div className="lp-table-wrap">
            <table className="lp-table lp-table-plain">
              <thead>
                <tr>
                  <th>กลุ่ม LINE</th>
                  <th>คำที่ใช้อนุมัติ</th>
                  <th>ผู้อนุมัติได้</th>
                  <th>อนุมัติล่าสุดโดย</th>
                  <th>รออนุมัติ</th>
                  {owner && <th />}
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={g.group_id}>
                    <td>
                      <GroupCell g={g} />
                    </td>
                    <td>
                      <span className="lp-keywords">
                        {g.approve_keywords.map((k) => (
                          <code key={k}>{k}</code>
                        ))}
                      </span>
                    </td>
                    <td>
                      {g.approvers.length ? (
                        <ul className="lp-people">
                          {g.approvers.map((a) => (
                            <li key={a.name + a.role}>
                              {/\)$/.test(a.name) ? a.name : <>{a.name} <small>({roleLabel(a)})</small></>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="lp-muted">{data.adminReady ? "ยังไม่มีผู้อนุมัติที่เชื่อม LINE" : "อ่านรายชื่อไม่ได้ (ยังไม่ได้ตั้ง Service role)"}</span>
                      )}
                    </td>
                    <td>{g.deciders.length ? g.deciders.join(", ") : <span className="lp-muted">—</span>}</td>
                    <td>{g.waiting ? <b className="lp-accent">{g.waiting} รายการ</b> : <span className="lp-muted">0</span>}</td>
                    {owner && (
                      <td>
                        <button className="icon-button" aria-label={"แก้คำอนุมัติของ " + g.title} onClick={() => edit(g.group_id)}>
                          <Pencil size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="lp-card">
        <div className="lp-card-head">
          <h2>บัญชี LINE ที่เชื่อมกับผู้อนุมัติ</h2>
        </div>
        {data.linked.length ? (
          <ul className="lp-linked">
            {data.linked.map((a) => (
              <li key={a.name + a.role}>
                <Face p={{ name: a.name, picture: sample ? approverPortrait(a.name) : null }} size={30} />
                <span>
                  <b>{a.name}</b>
                  <small>{roleLabel(a)}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lp-muted">{data.adminReady ? "ยังไม่มีเจ้าของหรือผู้จัดการที่เชื่อมบัญชี LINE" : "อ่านรายชื่อไม่ได้ (ยังไม่ได้ตั้ง Service role)"}</p>
        )}
        {!sample && <LinePairing ctx={ctx} forms={[]} userOnly />}
      </section>
    </>
  );
}

function Rules({ groups, owner, sample, edit }: { groups: PageGroup[]; owner: boolean; sample: boolean; edit: (id: string) => void }) {
  return (
    <section className="lp-card">
      <div className="lp-card-head">
        <h2>กฎการดึงข้อมูล (Workflow)</h2>
        {sample && <span className="sample-badge">ตัวอย่าง</span>}
      </div>
      <ol className="lp-flow">
        <li>
          <MessageCircle size={16} /> ข้อความ / รูป / ไฟล์ ในกลุ่ม
        </li>
        <li>
          <Bot size={16} /> AI แยกเข้าหน้าที่ถูก หรือใช้ฟอร์มของกลุ่ม
        </li>
        <li>
          <GitBranch size={16} /> คำขอที่ต้องให้แผนกอื่นอนุมัติ ส่งไปกลุ่มของแผนกนั้น
        </li>
        <li>
          <CheckCircle2 size={16} /> อนุมัติแล้วบันทึกเป็นรายการในระบบ
        </li>
      </ol>
      {!groups.length ? (
        <Empty title="ยังไม่ได้เชื่อมกลุ่ม LINE" />
      ) : (
        <div className="lp-table-wrap">
          <table className="lp-table lp-table-plain">
            <thead>
              <tr>
                <th>กลุ่ม LINE</th>
                <th>วิธีบันทึกข้อความ</th>
                <th>รับคำขอของแผนก</th>
                <th>ข้อมูลที่ดึงได้จริง</th>
                <th>7 วันล่าสุด</th>
                {owner && <th />}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.group_id}>
                  <td>
                    <GroupCell g={g} />
                  </td>
                  <td>
                    {g.templateName ? (
                      <span className="lp-rule">
                        <FileText size={14} /> ใช้ฟอร์ม “{g.templateName}” ทุกข้อความ
                      </span>
                    ) : (
                      <span className="lp-rule">
                        <Bot size={14} /> AI แยกอัตโนมัติ
                      </span>
                    )}
                  </td>
                  <td>
                    <DeptChip g={g} />
                  </td>
                  <td className="lp-kinds">{g.kinds.length ? g.kinds.join(", ") : <span className="lp-muted">ยังไม่มีข้อมูล</span>}</td>
                  <td>{g.week} รายการ</td>
                  {owner && (
                    <td>
                      <button className="icon-button" aria-label={"แก้กฎของ " + g.title} onClick={() => edit(g.group_id)}>
                        <Pencil size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Advanced({ owner, demo, configured, adminReady }: { owner: boolean; demo: boolean; configured: boolean; adminReady: boolean }) {
  const [config, setConfig] = useState<{ ai: boolean; line: boolean; worker: boolean } | null>(null),
    [notifications, setNotifications] = useState<{ id: string; status: string; attempts: number; created_at?: string }[]>([]),
    [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    api("/config").then(setConfig).catch(() => {});
    if (owner)
      api("/integrations")
        .then((d) => setNotifications(d.notifications || []))
        .catch(() => {});
  }, [owner]);
  const services: [string, boolean | undefined][] = [
    ["Supabase Auth / Database", !demo],
    ["LINE Messaging API (Channel secret)", config?.line],
    ["LINE Access token (ชื่อกลุ่ม / สมาชิก)", configured],
    ["AI Extraction / OCR", config?.ai],
    ["Queue Worker / Service role", config ? config.worker && adminReady : undefined],
  ];
  return (
    <div className="lp-advanced">
      <section className="lp-card">
        <div className="lp-card-head">
          <h2>บริการฝั่ง Server</h2>
          <ShieldCheck size={20} />
        </div>
        {services.map(([name, ready]) => (
          <div className="status-row" key={name}>
            <span>{name}</span>
            <span className={"badge " + (ready ? "approved" : "pending")}>{ready ? "พร้อม" : "รอการตั้งค่า"}</span>
          </div>
        ))}
        <p className="lp-note">Secret เก็บใน Vercel Environment Variables เท่านั้น ดู DEPLOYMENT.md สำหรับค่า Supabase, AI, LINE และ Cron</p>
        <p className="body-copy">
          Webhook: <code>{origin}/api/line/webhook</code>
        </p>
      </section>
      <section className="lp-card">
        <div className="lp-card-head">
          <h2>แจ้งเตือนล่าสุด</h2>
          <KeyRound size={18} />
        </div>
        {!owner ? (
          <p className="lp-muted">เฉพาะเจ้าของดูคิวแจ้งเตือนได้</p>
        ) : notifications.length ? (
          notifications.map((n) => (
            <div key={n.id} className="status-row">
              <span>
                {n.created_at ? when(n.created_at) + " · " : n.id.slice(0, 8) + " · "}
                {n.attempts} ครั้ง
              </span>
              <span className="badge">{n.status}</span>
            </div>
          ))
        ) : (
          <p className="lp-muted">ยังไม่มีรายการแจ้งเตือน</p>
        )}
      </section>
    </div>
  );
}

/**
 * Pairing: an owner creates a one-time "#connect" code (group department + AI sorting or one form) to type in the
 * group; anyone but a viewer creates a "#user" code to link their own LINE (needed to approve from LINE).
 * Same API as the pairing card in settings.tsx (POST /integrations).
 */
function LinePairing({ ctx, forms, userOnly = false, full = false }: { ctx: Context; forms: Form[]; userOnly?: boolean; full?: boolean }) {
  const [department, setDepartment] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [command, setCommand] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const owner = ctx.member.role === "owner";
  async function pair(action: "group" | "user") {
    setBusy(true);
    setError("");
    try {
      const d = await api("/integrations", {
        method: "POST",
        body: { action, templateId: action === "group" ? templateId || null : null, department: action === "group" ? department || null : null },
      });
      setCommand(d.command);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lp-pair">
      {!userOnly && (
        <>
          <ol className="lp-steps">
            <li>เพิ่มบอท EliteFlow เข้ากลุ่ม LINE</li>
            <li>เลือกแผนกของกลุ่ม แล้วกด “สร้างรหัสเชื่อมกลุ่ม” คัดลอกคำสั่งไปพิมพ์ในกลุ่มนั้นภายใน 10 นาที</li>
            <li>กลุ่มจะขึ้นในตาราง แก้ชื่อ แผนก และวิธีบันทึกได้ที่ปุ่มแก้ไข</li>
          </ol>
          {full && <p className="form-error">เชื่อมกลุ่มครบตามแพ็กเกจแล้ว อัปเกรดแพ็กเกจที่หน้า “จัดการแพ็กเกจ” เพื่อเพิ่มกลุ่ม</p>}
          {owner && (
            <>
              <label>
                กลุ่มนี้เป็นของแผนก
                <select value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">— ไม่ระบุ (เลือกทีหลังได้) —</option>
                  {Object.entries(deptThai).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                วิธีบันทึกข้อความในกลุ่ม
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">🤖 AI แยกอัตโนมัติ: ส่งแต่ละข้อความเข้าหน้าที่ถูก (แนะนำ)</option>
                  {forms.map((t) => (
                    <option value={t.id} key={t.id}>
                      📋 {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary full" disabled={busy}onClick={() => pair("group")}>
                <Link2 size={15} /> สร้างรหัสเชื่อมกลุ่ม
              </button>
            </>
          )}
        </>
      )}
      {ctx.member.role !== "viewer" && (
        <button className="secondary full" disabled={busy} onClick={() => pair("user")}>
          <UserCheck size={15} /> เชื่อมบัญชี LINE ของฉัน
        </button>
      )}
      {command && (
        <>
          <p className="lp-note">พิมพ์คำสั่งนี้ในกลุ่มที่มีบอทภายใน 10 นาที คำสั่ง #user ต้องส่งจาก LINE ของคุณเอง</p>
          <pre className="code-block">{command}</pre>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
