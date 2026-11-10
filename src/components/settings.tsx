"use client";
import { useEffect, useState } from "react";
import { deptThai } from "@/lib/line-message";
import {
  Plus,
  Settings2,
  UserPlus,
  ShieldCheck,
  Check,
  Link,
  Palette,
  Building2,
  Camera,
} from "lucide-react";
import { api, Modal, Loading, Empty, displayDate } from "./shared";
import { UserOnline } from "./presence";
import { FieldControl } from "./records";
import { companyFields, departmentNames, businessTypes, businessTypeGroups } from "@/lib/catalog";
import type { Context, Member, Template } from "@/lib/types";
const imageLimits = {
  logo: { width: 320, height: 320, max: 60000 },
  cover: { width: 1200, height: 400, max: 150000 },
};
// Shrinks an uploaded image into a WebP data URL small enough to live in the company profile.
async function toDataUrl(file: File, kind: "logo" | "cover") {
  const { width, height, max } = imageLimits[kind],
    bitmap = await createImageBitmap(file),
    scale = Math.min(1, width / bitmap.width, height / bitmap.height),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/webp", quality);
    if (url.length <= max) return url;
  }
  throw Error("รูปใหญ่เกินไป ลองใช้รูปที่เล็กลง");
}
const completenessKeys = [
  "logo",
  "name",
  "nameEn",
  "taxId",
  "industry",
  "employees",
  "founded",
  "description",
];
const companyTabs = [
  ["main", "ข้อมูลหลัก"],
  ["address", "ที่อยู่"],
  ["social", "Social และช่องทางติดต่อ"],
  ["docs", "เอกสาร"],
] as const;
const tabFields: Record<string, string[]> = {
  address: ["address", "province", "zip", "shipAddress"],
  social: ["phone", "email", "website", "line", "facebook"],
  docs: [
    "registration", "legal", "branch", "bank", "bankAccount", "bankAccountName", "bankAccountType", "promptPay",
    "signerName", "signerPosition", "approverName", "approverPosition",
    "docConditions", "quotationNotes", "invoiceNotes", "receiptNotes",
  ],
};
const placeholders: Record<string, string> = {
  name: "เช่น บริษัท ตัวอย่าง จำกัด",
  nameEn: "เช่น Example Co., Ltd.",
  taxId: "13 หลัก",
  description: "เล่าสั้นๆ ว่าบริษัททำอะไร",
};
const profileOf = (ctx: Context) => {
  const p = { ...ctx.company.profile } as Record<string, unknown>;
  if (p.taxId) p.taxId = String(p.taxId).replace(/\D/g, "");
  return p;
};
/**
 * Saves a new logo or cover right away on top of the saved company profile (owner only; save_company replaces the
 * whole profile, so every other field is sent back unchanged). Used here and on the company profile page.
 */
export async function saveCompanyImage(ctx: Context, kind: "logo" | "cover", file: File) {
  const url = await toDataUrl(file, kind),
    saved = Object.fromEntries(
      Object.entries(profileOf(ctx))
        .filter(([k]) => companyFields.some((f) => f.key === k))
        .map(([k, v]) => [k, String(v ?? "")]),
    );
  await api("/company", { method: "PATCH", body: { profile: { ...saved, [kind]: url } } });
  return url;
}
export function CompanySettings({
  ctx,
  notify,
  changed,
  embedded = false,
}: {
  ctx: Context;
  notify: (s: string) => void;
  changed: () => void;
  /** Inside the company page's เกี่ยวกับ tab: no cover/logo header (the page has one), plus who-sees-what switches. */
  embedded?: boolean;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
      profileOf(ctx),
    ),
    [theme, setTheme] = useState(
      String(ctx.company.settings.theme || "violet"),
    ),
    [brand, setBrand] = useState(
      String(ctx.company.settings.brand || "EliteFlow"),
    ),
    [tab, setTab] = useState<(typeof companyTabs)[number][0]>("main"),
    [uploading, setUploading] = useState<"" | "logo" | "cover">(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const owner = ctx.member.role === "owner",
    text = (k: string) => String(values[k] ?? ""),
    set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v })),
    field = (k: string) => companyFields.find((f) => f.key === k)!,
    filled = completenessKeys.filter((k) => text(k).trim()).length,
    // Like Facebook: a picked cover or logo is saved right away, on top of the saved profile
    // (not the unsaved form edits).
    pick = async (kind: "logo" | "cover", file?: File) => {
      if (!file) return;
      setUploading(kind);
      try {
        const url = await saveCompanyImage(ctx, kind, file);
        set(kind, url);
        setError("");
        notify(kind === "logo" ? "เปลี่ยนโลโก้แล้ว" : "เปลี่ยนรูปปกแล้ว");
        changed();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading("");
      }
    },
    filePicker = (kind: "logo" | "cover") => (
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={!!uploading}
        onChange={(e) => {
          pick(kind, e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    ),
    input = (k: string) => (
      <FieldControl
        key={k}
        field={field(k)}
        value={values[k]}
        set={(v) => set(k, v)}
        options={[]}
      />
    );
  return (
    <form
      className="company-profile"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const profile = Object.fromEntries(
            Object.entries(values)
              .filter(([k]) => companyFields.some((f) => f.key === k))
              .map(([k, v]) => [k, String(v ?? "")]),
          );
          await api("/company", {
            method: "PATCH",
            body: { profile, settings: { theme, brand } },
          });
          setError("");
          notify("บันทึกข้อมูลบริษัทแล้ว");
          changed();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {embedded && (
        <VisibilityCard
          value={String(values.visibility || "main,social")}
          disabled={!owner || busy}
          onChange={(v) => set("visibility", v)}
        />
      )}
      {!embedded && (
      <section className="card company-hero">
        <div
          className="company-cover"
          style={
            text("cover")
              ? { backgroundImage: `url("${text("cover")}")` }
              : undefined
          }
        >
          {owner && (
            <label className="secondary cover-button">
              <Camera size={15} />
              {uploading === "cover" ? "กำลังอัปโหลด…" : text("cover") ? "เปลี่ยนรูปปก" : "เพิ่มรูปปก"}
              {filePicker("cover")}
            </label>
          )}
        </div>
        <div className="company-hero-body">
          <div className="company-logo-wrap">
            <div className={"company-logo" + (uploading === "logo" ? " busy" : "")}>
              {text("logo") ? (
                <img src={text("logo")} alt="โลโก้บริษัท" />
              ) : (
                <Building2 size={34} />
              )}
            </div>
            {owner && (
              <label className="logo-camera" title="เปลี่ยนโลโก้" aria-label="เปลี่ยนโลโก้บริษัท">
                <Camera size={16} />
                {filePicker("logo")}
              </label>
            )}
          </div>
          <div className="company-hero-title">
            <h2>{text("name").trim() || "ยังไม่ได้ตั้งชื่อบริษัท"}</h2>
            <p>กรอกข้อมูลด้านล่าง ข้อมูลนี้ใช้ในเอกสารและทุกระบบ</p>
          </div>
          <div className="company-progress">
            <div>
              <strong>ความครบถ้วน</strong>
              <span>
                {filled} จาก {completenessKeys.length} ช่อง
              </span>
            </div>
            <i>
              <b style={{ width: (filled / completenessKeys.length) * 100 + "%" }} />
            </i>
          </div>
        </div>
      </section>
      )}
      <div className="company-tabs" role="tablist">
        {companyTabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        <span className="badge">
          {owner ? "จัดการโดย Owner" : "อ่านอย่างเดียว"}
        </span>
      </div>
      <fieldset disabled={!owner || busy}>
        {tab === "main" ? (
          <>
            <section className="card company-section">
              <h2>ข้อมูลบริษัท</h2>
              <div className="form-grid company-grid">
                <label>
                  {field("name").label}
                  <input
                    required
                    maxLength={200}
                    placeholder={placeholders.name}
                    value={text("name")}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </label>
                <label>
                  {field("nameEn").label}
                  <input
                    placeholder={placeholders.nameEn}
                    value={text("nameEn")}
                    onChange={(e) => set("nameEn", e.target.value)}
                  />
                </label>
                <label className="wide">
                  {field("bio").label}
                  <input
                    maxLength={160}
                    placeholder="เช่น รับออกแบบและติดตั้งบูธงานแฟร์ ครบจบในที่เดียว"
                    value={text("bio")}
                    onChange={(e) => set("bio", e.target.value)}
                  />
                  <small className="field-hint">แสดงใต้ชื่อบริษัทในหน้าโปรไฟล์ · {text("bio").length}/160</small>
                </label>
                <label>
                  {field("taxId").label}
                  <input
                    inputMode="numeric"
                    pattern="\d{13}"
                    maxLength={13}
                    title="ตัวเลข 13 หลัก"
                    placeholder={placeholders.taxId}
                    value={text("taxId")}
                    onChange={(e) => set("taxId", e.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <label>
                  {field("industry").label}
                  <select value={text("industry")} onChange={(e) => set("industry", e.target.value)}>
                    <option value="">เลือกประเภทธุรกิจ</option>
                    {text("industry") && !businessTypes.includes(text("industry")) && (
                      <option>{text("industry")}</option>
                    )}
                    {businessTypeGroups.map(([group, items]) => (
                      <optgroup key={group} label={group}>
                        {items.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label>
                  {field("employees").label}
                  <select value={text("employees")} onChange={(e) => set("employees", e.target.value)}>
                    <option value="">เลือกช่วงจำนวน</option>
                    {(field("employees").options || []).map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {field("founded").label}
                  <input
                    type="date"
                    value={text("founded")}
                    onChange={(e) => set("founded", e.target.value)}
                  />
                </label>
                <label className="wide">
                  {field("description").label}
                  <textarea
                    maxLength={3000}
                    placeholder={placeholders.description}
                    value={text("description")}
                    onChange={(e) => set("description", e.target.value)}
                  />
                  <small className="field-hint">
                    แสดงในหน้าโปรไฟล์และเอกสารที่ส่งให้ลูกค้า
                  </small>
                </label>
              </div>
            </section>
          </>
        ) : (
          <section className="card company-section">
            <h2>{companyTabs.find(([k]) => k === tab)![1]}</h2>
            <div className="form-grid company-grid">
              {tabFields[tab].map(input)}
            </div>
            {tab === "docs" && (
              <>
                <h3 className="form-section-title">ปรับแต่ง workspace</h3>
                <div className="form-grid company-grid">
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
              </>
            )}
          </section>
        )}
      </fieldset>
      <p className="form-error" role="alert">
        {error}
      </p>
      {owner && (
        <div className="company-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setValues(profileOf(ctx));
              setTheme(String(ctx.company.settings.theme || "violet"));
              setBrand(String(ctx.company.settings.brand || "EliteFlow"));
              setError("");
            }}
          >
            ยกเลิก
          </button>
          <button className="primary" disabled={busy}>
            <Check size={15} />
            บันทึกข้อมูล
          </button>
        </div>
      )}
    </form>
  );
}
/** Who sees each part of the company page: public (any company in the network) or private (our team only). */
export const visibilitySections = [
  ["main", "ข้อมูลหลัก", "เกี่ยวกับบริษัท ประเภทธุรกิจ จำนวนพนักงาน วันที่ก่อตั้ง เลขผู้เสียภาษี"],
  ["address", "ที่อยู่", "ที่อยู่บริษัทและรหัสไปรษณีย์ (จังหวัดแสดงเสมอ)"],
  ["social", "ช่องทางติดต่อ", "โทรศัพท์ อีเมล เว็บไซต์ LINE Facebook"],
  ["products", "สินค้าและบริการ", "สินค้า & แพ็กเกจที่เปิดขายอยู่ พร้อมราคา"],
] as const;
function VisibilityCard({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  const on = new Set(value === "none" ? [] : value.split(","));
  const toggle = (k: string) => {
    const next = new Set(on);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange(next.size ? visibilitySections.map(([key]) => key).filter((key) => next.has(key)).join(",") : "none");
  };
  return (
    <section className="card vis-card">
      <div className="vis-head">
        <h2>ใครเห็นข้อมูลบริษัท</h2>
        <small>เลือกว่าส่วนไหนให้บริษัทอื่นในเครือข่ายเห็น · ข้อมูลธนาคารและเอกสารเป็นส่วนตัวเสมอ · กดบันทึกข้อมูลด้านล่างเพื่อใช้</small>
      </div>
      <div className="vis-grid">
        {visibilitySections.map(([key, label, hint]) => {
          const pub = on.has(key);
          return (
            <button type="button" key={key} className={"vis-item" + (pub ? " pub" : "")} disabled={disabled} aria-pressed={pub} onClick={() => toggle(key)}>
              <span className="vis-switch" aria-hidden><i /></span>
              <span>
                <b>{label}</b>
                <small>{hint}</small>
              </span>
              <em>{pub ? "สาธารณะ" : "ส่วนตัว"}</em>
            </button>
          );
        })}
      </div>
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
                      <strong>{m.name}</strong> <UserOnline id={m.user_id} />
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
    [notifications, setNotifications] = useState<
      { id: string; status: string; attempts: number }[]
    >([]),
    [selected, setSelected] = useState(""),
    [department, setDepartment] = useState(""),
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
        // ?template=<id> comes from a page's "รับข้อมูลจากกลุ่ม LINE" button.
        const wanted = new URLSearchParams(window.location.search).get("template");
        // No template = AI sorts every message onto its page; a page's button may ask for its own form.
        setSelected(t.find((x: Template) => x.id === wanted)?.id || "");

        setNotifications(i.notifications);
      })
      .catch((e) => setError(e.message));
  }, [ctx.member.role]);
  async function pair(action: string) {
    setBusy(true);
    try {
      const d = await api("/integrations", {
        method: "POST",
        body: { action, templateId: selected || null, department: action === "group" ? department || null : null },
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
          <h2>เชื่อมกลุ่ม LINE ใหม่</h2>
          <span className={"badge " + (config?.line ? "approved" : "pending")}>
            {config?.line ? "ตั้งค่าแล้ว" : "รอการตั้งค่า"}
          </span>
        </div>
        <ol className="body-copy line-steps">
          <li>เพิ่มบอท EliteFlow เข้ากลุ่ม LINE</li>
          <li>เลือกฝ่ายของกลุ่ม แล้วกด “สร้างรหัสเชื่อมกลุ่ม” คัดลอกคำสั่งไปพิมพ์ในกลุ่มนั้น</li>
          <li>กลุ่มจะขึ้นในรายการด้านบน แก้ชื่อ ฝ่าย และวิธีบันทึกได้ที่ “ตั้งค่ากลุ่มนี้”</li>
        </ol>
        {ctx.member.role === "owner" && (
          <>
            <label>
              กลุ่มนี้เป็นของฝ่าย
              <select value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">— ไม่ระบุ (เลือกทีหลังได้) —</option>
                {Object.entries(deptThai).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <small className="line-hub-help">คำขอจากกลุ่มอื่นที่ต้องให้ฝ่ายนี้อนุมัติ จะถูกส่งมาที่กลุ่มนี้</small>
            </label>
            <label>
              วิธีบันทึกข้อความในกลุ่ม
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">🤖 AI แยกอัตโนมัติ: ส่งแต่ละข้อความเข้าหน้าที่ถูก (แนะนำ)</option>
                {templates.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary full"
              disabled={busy}
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
        <p className="note">
          ในกลุ่ม ผู้จัดการพิมพ์คำอนุมัติ (เช่น “อนุมัติ”) เพื่ออนุมัติรายการล่าสุด และถามบอทได้ เช่น “มีงานรออนุมัติกี่งาน?”
        </p>
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
