"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Settings2,
  UserPlus,
  ShieldCheck,
  Check,
  Link,
  Palette,
} from "lucide-react";
import { api, Modal, Loading, Empty, displayDate } from "./shared";
import { FieldControl } from "./records";
import { companyFields, departmentNames } from "@/lib/catalog";
import type { Context, Member, Template } from "@/lib/types";
export function CompanySettings({
  ctx,
  notify,
  changed,
}: {
  ctx: Context;
  notify: (s: string) => void;
  changed: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(
      ctx.company.profile,
    ),
    [theme, setTheme] = useState(
      String(ctx.company.settings.theme || "violet"),
    ),
    [brand, setBrand] = useState(
      String(ctx.company.settings.brand || "EliteFlow"),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="card company-card">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/company", {
              method: "PATCH",
              body: { profile: values, settings: { theme, brand } },
            });
            notify("บันทึกบริษัทแล้ว");
            changed();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={ctx.member.role !== "owner" || busy}>
          <div className="card-heading">
            <h2>ข้อมูลบริษัท</h2>
            <span className="badge">
              {ctx.member.role === "owner"
                ? "จัดการโดย Owner"
                : "อ่านอย่างเดียว"}
            </span>
          </div>
          <div className="form-grid">
            {companyFields.map((f) => (
              <FieldControl
                key={f.key}
                field={f}
                value={values[f.key]}
                set={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                options={[]}
              />
            ))}
          </div>
          <h3 className="form-section-title">ปรับแต่ง workspace</h3>
          <div className="form-grid">
            <label>
              ธีม
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="violet">Violet</option>
                <option value="ocean">Ocean</option>
                <option value="forest">Forest</option>
              </select>
            </label>
            <label>
              ชื่อแพลตฟอร์ม
              <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option>EliteFlow</option>
                <option>ZettaFlow</option>
              </select>
            </label>
          </div>
        </fieldset>
        <p className="form-error" role="alert">
          {error}
        </p>
        {ctx.member.role === "owner" && (
          <div className="modal-footer">
            <button className="primary" disabled={busy}>
              <Check size={15} />
              บันทึกข้อมูลบริษัท
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
export function Team({
  ctx,
  notify,
}: {
  ctx: Context;
  notify: (s: string) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [invites, setInvites] = useState<
      {
        id: string;
        email: string;
        role: string;
        accepted_at?: string;
        expires_at: string;
      }[]
    >([]),
    [loading, setLoading] = useState(true),
    [modal, setModal] = useState(false),
    [member, setMember] = useState<Member | null>(null),
    [role, setRole] = useState("staff"),
    [departments, setDepartments] = useState<string[]>([]),
    [disabled, setDisabled] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const d = await api("/team");
      setMembers(d.members);
      setInvites(d.invites);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  function open(m?: Member) {
    setMember(m || null);
    setRole(m?.role || "staff");
    setDepartments(m?.departments || ["Operations"]);
    setDisabled(m?.disabled || false);
    setError("");
    setModal(true);
  }
  return (
    <>
      {loading ? (
        <Loading />
      ) : (
        <section className="card">
          <div className="card-heading">
            <h2>สมาชิกและสิทธิ์</h2>
            <button className="primary" onClick={() => open()}>
              <UserPlus size={15} />
              เพิ่มคำเชิญ
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>สมาชิก</th>
                  <th>บทบาท</th>
                  <th>แผนก</th>
                  <th>สถานะ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small>{m.email}</small>
                    </td>
                    <td>
                      <span className="badge">{m.role}</span>
                    </td>
                    <td>
                      {m.role === "owner"
                        ? "ทุกแผนก"
                        : m.departments.join(", ")}
                    </td>
                    <td>{m.disabled ? "ระงับ" : "ใช้งาน"}</td>
                    <td>
                      {m.role !== "owner" && (
                        <button className="secondary" onClick={() => open(m)}>
                          แก้ไขสิทธิ์
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="form-section-title">คำเชิญ</h3>
          {invites.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>อีเมล</th>
                    <th>บทบาท</th>
                    <th>หมดอายุ</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{i.role}</td>
                      <td>{displayDate(i.expires_at)}</td>
                      <td>
                        {i.accepted_at
                          ? "เข้าร่วมแล้ว"
                          : new Date(i.expires_at) < new Date()
                            ? "หมดอายุ"
                            : "รอเข้าร่วม"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">ยังไม่มีคำเชิญ</p>
          )}
          <div className="note">
            คำเชิญมีอายุ 7 วัน ให้สมาชิกสมัครหรือเข้าสู่ระบบด้วยอีเมลที่ระบุ
            ระบบจะเชื่อมบริษัทให้อัตโนมัติ ยังไม่ส่งอีเมลคำเชิญ
          </div>
        </section>
      )}
      {!modal && error && <p className="form-error">{error}</p>}
      {modal && (
        <Modal
          title={member ? "แก้ไขสิทธิ์สมาชิก" : "เพิ่มคำเชิญสมาชิก"}
          onClose={() => setModal(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/team" + (member ? "/" + member.id : ""), {
                  method: member ? "PATCH" : "POST",
                  body: {
                    email: member
                      ? undefined
                      : new FormData(e.currentTarget).get("email"),
                    role,
                    departments,
                    disabled,
                  },
                });
                setModal(false);
                await load();
                notify("บันทึกสิทธิ์แล้ว");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {member ? (
              <p className="muted">{member.email}</p>
            ) : (
              <label>
                อีเมลสมาชิก
                <input type="email" name="email" required />
              </label>
            )}
            <label>
              บทบาท
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="manager">Manager · ตรวจทาน/อนุมัติ</option>
                <option value="staff">Staff · เพิ่มข้อมูล/อัปเดตงาน</option>
                <option value="viewer">Viewer · ดูข้อมูล/ส่งออก</option>
              </select>
            </label>
            <h3 className="form-section-title">แผนกที่เข้าถึงได้</h3>
            <div className="department-checks">
              {departmentNames.map((d) => (
                <label key={d}>
                  <input
                    type="checkbox"
                    checked={departments.includes(d)}
                    onChange={(e) =>
                      setDepartments((s) =>
                        e.target.checked ? [...s, d] : s.filter((v) => v !== d),
                      )
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
            {member && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={disabled}
                  onChange={(e) => setDisabled(e.target.checked)}
                />
                ระงับสิทธิ์เข้า workspace นี้
              </label>
            )}
            <p className="form-error" role="alert">
              {error}
            </p>
            <div className="modal-footer">
              <button
                className="primary"
                disabled={busy || !departments.length}
              >
                บันทึกสิทธิ์
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Integrations({
  ctx,
  notify,
}: {
  ctx: Context;
  notify: (s: string) => void;
}) {
  const [config, setConfig] = useState<{
      ai: boolean;
      line: boolean;
      worker: boolean;
    } | null>(null),
    [templates, setTemplates] = useState<Template[]>([]),
    [groups, setGroups] = useState<{ group_id: string; template_id: string }[]>(
      [],
    ),
    [notifications, setNotifications] = useState<
      { id: string; status: string; attempts: number }[]
    >([]),
    [selected, setSelected] = useState(""),
    [command, setCommand] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      api("/config"),
      api("/templates"),
      ctx.member.role === "owner"
        ? api("/integrations")
        : Promise.resolve({ groups: [], notifications: [] }),
    ])
      .then(([c, t, i]) => {
        setConfig(c);
        setTemplates(t);
        setSelected(t[0]?.id || "");
        setGroups(i.groups);
        setNotifications(i.notifications);
      })
      .catch((e) => setError(e.message));
  }, [ctx.member.role]);
  async function pair(action: string) {
    setBusy(true);
    try {
      const d = await api("/integrations", {
        method: "POST",
        body: { action, templateId: selected },
      });
      setCommand(d.command);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="two-column">
      <section className="card">
        <div className="card-heading">
          <h2>LINE Messaging API</h2>
          <span className={"badge " + (config?.line ? "approved" : "pending")}>
            {config?.line ? "ตั้งค่าแล้ว" : "รอการตั้งค่า"}
          </span>
        </div>
        <p className="body-copy">
          เพิ่มบอทในกลุ่ม LINE แล้วสร้างรหัสเชื่อมต่อ
          กลุ่มจะถูกจับคู่กับบริษัทและ Data Template ของคุณ
        </p>
        {ctx.member.role === "owner" && (
          <>
            <label>
              Template ของกลุ่ม
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {templates.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary full"
              disabled={busy || !selected}
              onClick={() => pair("group")}
            >
              <Link size={15} />
              สร้างรหัสเชื่อมกลุ่ม
            </button>
          </>
        )}
        {ctx.member.role !== "viewer" && (
          <button
            className="secondary full"
            disabled={busy}
            onClick={() => pair("user")}
          >
            เชื่อมบัญชี LINE ของฉัน
          </button>
        )}
        {command && (
          <>
            <div className="note">
              พิมพ์คำสั่งนี้ในกลุ่มที่มีบอทภายใน 10 นาที คำสั่ง #user ต้องส่งจาก
              LINE ของคุณเอง
            </div>
            <pre className="code-block">{command}</pre>
          </>
        )}
        <p className="form-error" role="alert">
          {error}
        </p>
        <h3 className="form-section-title">กลุ่มที่เชื่อมแล้ว</h3>
        {groups.map((g) => (
          <div className="integration-group" key={g.group_id}>
            {g.group_id}
            <small>{templates.find((t) => t.id === g.template_id)?.name}</small>
          </div>
        ))}
        {!groups.length && <p className="muted">ยังไม่มีกลุ่มที่เชื่อมต่อ</p>}
      </section>
      <section className="card">
        <div className="card-heading">
          <h2>บริการฝั่ง Server</h2>
          <ShieldCheck size={20} />
        </div>
        {[
          ["Supabase Auth / Database", !ctx.demo],
          ["AI Extraction / OCR", config?.ai],
          ["Queue Worker", config?.worker],
        ].map(([name, ready]) => (
          <div className="status-row" key={String(name)}>
            <span>{String(name)}</span>
            <span className={"badge " + (ready ? "approved" : "pending")}>
              {ready ? "พร้อม" : "รอการตั้งค่า"}
            </span>
          </div>
        ))}
        <div className="note">
          Secret เก็บใน Vercel Environment Variables เท่านั้น ดู DEPLOYMENT.md
          สำหรับค่า Supabase, AI, LINE และ Cron
        </div>
        <p className="body-copy">
          Webhook:{" "}
          <code>
            {typeof window !== "undefined" ? window.location.origin : ""}
            /api/line/webhook
          </code>
        </p>
        <h3 className="form-section-title">แจ้งเตือนล่าสุด</h3>
        {notifications.map((n) => (
          <div key={n.id} className="status-row">
            <span>
              {n.id.slice(0, 8)} · {n.attempts} ครั้ง
            </span>
            <span className="badge">{n.status}</span>
          </div>
        ))}
        {!notifications.length && (
          <p className="muted">ยังไม่มีรายการแจ้งเตือน</p>
        )}
      </section>
    </div>
  );
}
