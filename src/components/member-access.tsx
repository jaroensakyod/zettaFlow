"use client";
// สิทธิ์การใช้งาน: per-employee access per system (migration 0085). Three levels per department — ล็อก / ดู / ใช้งาน —
// set by the owner from the employee page; a locked system stays in the menus and opens LockedSystem instead of the page.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Eye, Check, ShieldCheck, Crown, UserPlus, Users, Save, Sparkles, Briefcase, MailCheck, type LucideIcon } from "lucide-react";
import type { Context, Member, Role } from "@/lib/types";
import { departmentNames } from "@/lib/catalog";
import { deptThai } from "@/lib/line-message";
import { departmentPlanLocked } from "@/lib/departments";
import { accessLevel, type AccessLevel } from "@/lib/domain";
import { subscriptionActive, type Subscription } from "@/lib/billing";
import { deptLook } from "./dept-picker";
import { api, displayDate, Loading } from "./shared";
import { InviteMessage, LoginHelp, type InviteResult } from "./invite-message";

/** Small lock after a menu label: the person may not open this system. */
export const LockMark = ({ size = 12 }: { size?: number }) => (
  <Lock size={size} className="lock-mark" aria-label="ล็อก" />
);

/** In place of a page the member may not use: a dimmed placeholder behind a centred card. */
export function LockedSystem({ name, department }: { name: string; department?: string | null }) {
  return (
    <div className="sys-lock" role="region" aria-label={"ระบบนี้ถูกล็อก: " + name}>
      {/* A neutral skeleton (not the real page: its data would be refused anyway). */}
      <div className="sys-lock-ghost" aria-hidden="true">
        <div className="sys-lock-row">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="sys-lock-tile" />
          ))}
        </div>
        <span className="sys-lock-bar w60" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={"sys-lock-bar" + (i % 2 ? " w80" : "")} />
        ))}
      </div>
      <div className="sys-lock-card">
        <span className="sys-lock-icon">
          <Lock size={28} />
        </span>
        <h2>ระบบนี้ถูกล็อก</h2>
        <p className="sys-lock-name">
          {name}
          {department && deptThai[department] && <small>{deptThai[department]}</small>}
        </p>
        <p>รหัสพนักงานของคุณยังไม่ได้รับสิทธิ์ให้ใช้งานระบบนี้ โปรดติดต่อเจ้าของบริษัทหรือหัวหน้างานเพื่อขอสิทธิ์</p>
      </div>
    </div>
  );
}

const levels: [AccessLevel, string, LucideIcon][] = [
  ["lock", "ล็อก", Lock],
  ["view", "ดู", Eye],
  ["use", "ใช้งาน", Check],
];
/** ล็อก / ดู / ใช้งาน as a 3-part switch (grey / blue / green when chosen). */
export function AccessLevelPicker({ value, onChange, label, disabled }: { value: AccessLevel; onChange: (v: AccessLevel) => void; label: string; disabled?: boolean }) {
  return (
    <div className="acl-seg" role="radiogroup" aria-label={"ระดับสิทธิ์ " + label}>
      {levels.map(([k, text, Icon]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          disabled={disabled}
          className={"acl-seg-" + k + (value === k ? " on" : "")}
          onClick={() => onChange(k)}
        >
          <Icon size={13} /> {text}
        </button>
      ))}
    </div>
  );
}

type Levels = Record<string, AccessLevel>;
export const levelsOf = (m: Pick<Member, "role" | "departments"> & { read_departments?: string[] }): Levels =>
  Object.fromEntries(departmentNames.map((d) => [d, m.role === "owner" ? "use" : accessLevel(m, d)]));
export const listsOf = (l: Levels) => ({
  departments: departmentNames.filter((d) => l[d] === "use"),
  read_departments: departmentNames.filter((d) => l[d] === "view"),
});
const all = (v: AccessLevel): Levels => Object.fromEntries(departmentNames.map((d) => [d, v]));
const only = (use: string[], view: string[]): Levels =>
  Object.fromEntries(departmentNames.map((d) => [d, use.includes(d) ? "use" : view.includes(d) ? "view" : "lock"]));
/** Quick presets: a role and a level for every department. */
const presets: { label: string; icon: LucideIcon; role: Exclude<Role, "owner">; levels: () => Levels }[] = [
  { label: "ผู้จัดการ", icon: ShieldCheck, role: "manager", levels: () => all("use") },
  { label: "ฝ่ายขาย", icon: Briefcase, role: "staff", levels: () => only(["Sales", "Customer Service"], ["Marketing", "Warehouse"]) },
  { label: "ฝ่ายบัญชี", icon: Sparkles, role: "staff", levels: () => only(["Finance"], ["Purchasing", "Sales"]) },
  { label: "ดูอย่างเดียว", icon: Eye, role: "viewer", levels: () => all("view") },
  { label: "ล็อกทั้งหมด", icon: Lock, role: "staff", levels: () => all("lock") },
];
const roleLabels: [Exclude<Role, "owner">, string][] = [
  ["manager", "ผู้จัดการ (อนุมัติได้)"],
  ["staff", "พนักงาน"],
  ["viewer", "ผู้ชม (ดูอย่างเดียว)"],
];

type Billing = {
  subscription?: Subscription;
  plan?: { name: string };
  usage?: { users?: number };
  limits?: { users?: number | null };
};
type Invite = { id: string; email: string; role: string; accepted_at?: string | null; expires_at: string };

/** The employee page's สิทธิ์การใช้งาน tab (owner only): finds the login by the employee's email. */
export function MemberAccessTab({
  ctx,
  email,
  name,
  department,
  notify,
  navigate,
}: {
  ctx: Context;
  email: string;
  /** The employee's name (for the invite email). */
  name?: string;
  /** The employee's own department (for an invite). */
  department?: string;
  notify: (s: string) => void;
  navigate: (v: string) => void;
}) {
  const [team, setTeam] = useState<{ members: Member[]; invites: Invite[] } | null>(null),
    [bill, setBill] = useState<Billing | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [role, setRole] = useState<Exclude<Role, "owner">>("staff"),
    [levels, setLevels] = useState<Levels>(all("lock")),
    [dirty, setDirty] = useState(false),
    [sent, setSent] = useState<InviteResult | null>(null);
  const key = email.trim().toLowerCase();
  const load = useCallback(async () => {
    try {
      const [t, b] = await Promise.all([api("/team"), api("/billing").catch(() => null)]);
      setTeam(t);
      setBill(b);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const member = useMemo(() => (key ? team?.members.find((m) => m.email.trim().toLowerCase() === key) : undefined), [team, key]);
  useEffect(() => {
    if (!member || member.role === "owner") return;
    setRole(member.role);
    setLevels(levelsOf(member));
    setDirty(false);
  }, [member]);
  const sub = bill?.subscription;
  const paid = !!sub && sub.status === "active" && sub.plan !== "free" && subscriptionActive(sub);
  // Without billing details every department stays settable.
  const planLocked = (d: string) => !!bill && departmentPlanLocked(d, paid);
  const seats = bill?.usage?.users !== undefined ? (
    <div className="acl-seats">
      <Users size={16} />
      <span>
        แพ็กเกจ <b>{bill.plan?.name || sub?.plan || "—"}</b> · ใช้ไป <b>{bill.usage.users}</b>
        {bill.limits?.users != null ? <> / {bill.limits.users}</> : " / ไม่จำกัด"} ที่นั่ง
      </span>
      {bill.limits?.users != null && (
        <i className="acl-seats-bar">
          <span style={{ width: Math.min(100, (bill.usage.users / Math.max(1, bill.limits.users)) * 100) + "%" }} />
        </i>
      )}
    </div>
  ) : null;

  if (error && !team) return <section className="ep-card"><p className="form-error">{error}</p></section>;
  if (!team) return <section className="ep-card"><Loading /></section>;

  if (!member) {
    const invite = team.invites.find((i) => i.email.trim().toLowerCase() === key && !i.accepted_at);
    const pending = invite && Date.parse(invite.expires_at) > Date.now();
    const full = bill?.limits?.users != null && (bill.usage?.users || 0) >= bill.limits.users;
    return (
      <section className="ep-card acl">
        {seats}
        <div className="acl-empty">
          <span className="acl-empty-icon">
            <UserPlus size={26} />
          </span>
          <h3>ยังไม่มีบัญชีเข้าระบบ</h3>
          {!key ? (
            <p>เพิ่มอีเมลในข้อมูลพนักงานก่อน แล้วเชิญเข้าระบบด้วยอีเมลนั้น</p>
          ) : pending ? (
            <p>
              <MailCheck size={14} /> ส่งคำเชิญไปที่ <b>{email}</b> แล้ว · รอเข้าร่วม (หมดอายุ {displayDate(invite.expires_at)})
              <br />
              เมื่อพนักงานเข้าสู่ระบบด้วยอีเมลนี้ จะตั้งสิทธิ์รายระบบได้ที่หน้านี้
            </p>
          ) : (
            <p>
              เชิญ <b>{email}</b> เข้าใช้งาน แล้วตั้งสิทธิ์รายระบบได้ที่หน้านี้
            </p>
          )}
          {key && !pending && (
            <button
              className="primary"
              disabled={busy || full}
              onClick={async () => {
                setBusy(true);
                try {
                  const dept = department && departmentNames.includes(department) ? department : "Finance";
                  const r: InviteResult = await api("/team", { method: "POST", body: { email: key, role: "staff", departments: [dept], name: name || undefined } });
                  setSent(r);
                  notify(r.emailed ? "ส่งอีเมลคำเชิญแล้ว · ใช้งานได้ 7 วัน" : "บันทึกคำเชิญแล้ว · ส่งข้อความให้พนักงานได้เลย");
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <UserPlus size={15} /> เชิญเข้าระบบ
            </button>
          )}
          {key && invite && !invite.accepted_at && (
            <InviteMessage
              company={ctx.company.name}
              email={email}
              result={sent}
              canResend
              onResent={(r) => {
                notify(r.emailed ? "ส่งอีเมลเชิญอีกครั้งแล้ว · ต่ออายุคำเชิญ 7 วัน" : "ต่ออายุคำเชิญ 7 วันแล้ว · ส่งข้อความให้พนักงานได้เลย");
                load();
              }}
            />
          )}
          {full && (
            <p className="acl-note">
              ที่นั่งเต็มแล้ว ·{" "}
              <button className="text-button" onClick={() => navigate("pricing")}>
                ดูแพ็กเกจเพื่อเพิ่มที่นั่ง
              </button>
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
      </section>
    );
  }

  if (member.role === "owner")
    return (
      <section className="ep-card acl">
        {seats}
        <div className="acl-empty owner">
          <span className="acl-empty-icon">
            <Crown size={26} />
          </span>
          <h3>เจ้าของบริษัทใช้ได้ทุกระบบ</h3>
          <p>สิทธิ์ของเจ้าของบริษัทแก้ไขไม่ได้ — ดู ใช้งาน และอนุมัติได้ทุกแผนก</p>
        </div>
      </section>
    );

  const open = departmentNames.filter((d) => !planLocked(d) && levels[d] !== "lock").length;
  const usable = departmentNames.filter((d) => !planLocked(d) && levels[d] === "use").length;
  const lists = listsOf(levels);
  const none = !lists.departments.length && !lists.read_departments.length;
  const set = (next: Levels, r = role) => {
    setLevels(next);
    setRole(r);
    setDirty(true);
  };
  return (
    <section className="ep-card acl">
      {seats}
      <header className="acl-head">
        <div className="acl-who">
          <b>{member.name || member.email}</b>
          <small>
            {member.email}
            {member.disabled && <em className="acl-off">ระงับการเข้าใช้งาน</em>}
          </small>
        </div>
        <label className="acl-role">
          <span>บทบาท</span>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Exclude<Role, "owner">);
              setDirty(true);
            }}
          >
            {roleLabels.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="acl-presets" role="group" aria-label="ตั้งค่าด่วน">
        {presets.map((p) => (
          <button key={p.label} type="button" className="acl-chip" onClick={() => set(p.levels(), p.role)}>
            <p.icon size={14} /> {p.label}
          </button>
        ))}
      </div>
      {role === "viewer" && <p className="acl-note">ผู้ชมดูได้อย่างเดียวทุกระบบที่เปิดไว้ — ระบบที่ตั้งเป็น “ใช้งาน” จะดูได้แต่แก้ไขไม่ได้</p>}
      <ul className="acl-list">
        {departmentNames.map((d) => {
          const [Icon, color] = deptLook[d] || [Briefcase, "#7c3aed"];
          const lockedByPlan = planLocked(d);
          return (
            <li key={d} className={"acl-row lv-" + (lockedByPlan ? "plan" : levels[d])}>
              <span className="acl-dept">
                <span className="acl-dept-icon" style={{ color, background: color + "1a" }}>
                  <Icon size={17} />
                </span>
                <span>
                  {deptThai[d] || d}
                  <small>{d}</small>
                </span>
              </span>
              {lockedByPlan ? (
                <button type="button" className="acl-plan" onClick={() => navigate("pricing")} title="ดูแพ็กเกจ">
                  <Lock size={12} /> แพ็กเกจนี้ไม่มี
                </button>
              ) : (
                <AccessLevelPicker label={deptThai[d] || d} value={levels[d]} onChange={(v) => set({ ...levels, [d]: v })} />
              )}
            </li>
          );
        })}
      </ul>
      <footer className="acl-foot">
        <span className="acl-sum">
          <span>
            เข้าได้ <b>{open}</b> ระบบ · ใช้งานได้ <b>{role === "viewer" ? 0 : usable}</b> ระบบ
          </span>
          {none && <em>เปิดอย่างน้อย 1 ระบบ (ถ้าต้องการปิดบัญชี ใช้ “ระงับสิทธิ์” ในหน้าทีม)</em>}
        </span>
        <button
          className="primary"
          disabled={busy || none || !dirty}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("/team/" + member.id + "/access", { method: "POST", body: { role, ...lists } });
              notify("บันทึกสิทธิ์การใช้งานแล้ว");
              await load();
            } catch (e) {
              const msg = (e as Error).message;
              setError(ctx.demo ? "โหมดตัวอย่างบันทึกไม่ได้: " + msg : msg);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Save size={15} /> {busy ? "กำลังบันทึก…" : "บันทึกสิทธิ์"}
        </button>
      </footer>
      {ctx.demo && <p className="acl-note">โหมดตัวอย่าง: สิทธิ์ที่บันทึกจะเก็บไว้ในข้อมูลตัวอย่างบนเครื่องนี้เท่านั้น</p>}
      {error && <p className="form-error">{error}</p>}
      <LoginHelp
        company={ctx.company.name}
        email={member.email}
        memberId={member.id}
        onSent={(r) => notify(r.emailed ? "ส่งลิงก์เข้าสู่ระบบทางอีเมลแล้ว" : "ส่งข้อความให้พนักงานทาง LINE แทนได้เลย")}
      />
    </section>
  );
}
