"use client";
// หน้า LINE: which groups are connected, what each group sent, and where every message went
// (which page, waiting for approval, missing data, or small talk that was not recorded).
// Each group's settings (name in the system, AI sorting or a fixed form, approve words) live on the group itself.
// LineGroupDetail is one group (header, owner settings, messages); the LINE Integration page opens it from its table.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FlaskConical, MessagesSquare, Paperclip, RefreshCw, Save, Settings2, Trash2, Users } from "lucide-react";
import { api, displayDate, Empty, Loading } from "./shared";
import type { Context } from "@/lib/types";
import type { LineMessage } from "@/lib/line-hub";
import { deptThai } from "@/lib/line-message";

type Group = {
  group_id: string;
  name: string;
  lineName: string;
  picture: string | null;
  template_id: string | null;
  templateName: string | null;
  approve_keywords: string[];
  /** Department this group belongs to; requests for that department's pages are announced here. */
  department: string | null;
  test: boolean;
  found: boolean;
  preview: string;
  total: number;
  week: number;
  waiting: number;
  incomplete: number;
  lastAt: string | null;
};
export type Form = { id: string; name: string; department: string };
/** The group fields the detail panel needs (the overview row and the LINE page row both have them). */
export type HubGroup = Pick<Group, "group_id" | "name" | "lineName" | "template_id" | "templateName" | "approve_keywords" | "department" | "test" | "found">;

const time = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

/** What a person recognises the group by: its name in the system, else its LINE name. */
const title = (g: Group, i: number) => g.name || g.lineName || (g.test ? `กลุ่มทดสอบ ${i + 1}` : `กลุ่ม ${i + 1} (ยังไม่ได้ตั้งชื่อ)`);

const deptName = (d: string | null | undefined) => (d ? deptThai[d] || d : "");
function state(m: LineMessage): { label: string; tone: string } {
  if (m.status === "approved") return { label: m.decided?.name ? "อนุมัติโดย " + m.decided.name : "บันทึกแล้ว", tone: "done" };
  if (m.status === "rejected") return { label: (m.decided?.name ? "ไม่อนุมัติโดย " + m.decided.name : "ไม่อนุมัติ") + (m.error ? " — " + m.error : ""), tone: "muted" };
  if (m.status === "review") return m.missing.length ? { label: "ขาด: " + m.missing.join(", "), tone: "warn" } : { label: "รออนุมัติ", tone: "wait" };
  if (m.status === "skipped") return m.merged ? { label: "อ่านรวมกับข้อความที่ส่งติดกัน", tone: "muted" } : { label: "ข้อความทั่วไป · ไม่บันทึก", tone: "muted" };
  if (m.status === "failed") return { label: "อ่านไม่สำเร็จ", tone: "warn" };
  return { label: "กำลังอ่าน…", tone: "wait" };
}
/** Where to look at it in the web: the record it became, else the page whose "รอตรวจจาก LINE" box holds it. */
function link(m: LineMessage) {
  if (m.record) return m.record.kind === "expenses" ? "/workspace/expense-new?id=" + m.record.id : "/workspace/" + m.record.kind;
  if (m.status === "review" || m.status === "failed") return "/workspace/" + (m.kind || "ai-inbox");
  return "";
}
const filters = { all: "ทั้งหมด", recorded: "บันทึกแล้ว", pending: "รอตรวจ", skipped: "ไม่บันทึก" } as const;

/**
 * One group: header, owner settings (name, department, AI sorting or a fixed form, approve words, unlink) and every
 * message the group sent with where it went. Used by the LINE page table (in a dialog) and by LineHub below.
 */
export function LineGroupDetail({
  ctx,
  notify,
  group,
  label,
  forms,
  startEditing = false,
  onChanged,
  onUnlinked,
}: {
  ctx: Context;
  notify: (s: string) => void;
  group: HubGroup;
  label: string;
  forms: Form[];
  startEditing?: boolean;
  onChanged: () => void;
  onUnlinked: () => void;
}) {
  const [messages, setMessages] = useState<LineMessage[] | null>(null),
    [filter, setFilter] = useState<keyof typeof filters>("all"),
    [editing, setEditing] = useState(startEditing),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  const owner = ctx.member.role === "owner";
  useEffect(() => {
    let live = true;
    api("/line-groups?group=" + encodeURIComponent(group.group_id))
      .then((m: LineMessage[]) => live && setMessages(m))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [group.group_id, tick]);
  const shown = useMemo(
    () =>
      (messages || []).filter((m) =>
        filter === "recorded" ? m.status === "approved" : filter === "pending" ? ["review", "failed", "queued", "processing"].includes(m.status) : filter === "skipped" ? ["skipped", "rejected"].includes(m.status) : true,
      ),
    [messages, filter],
  );

  async function saveGroup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("/integrations/" + encodeURIComponent(group.group_id), {
        method: "PATCH",
        body: {
          name: String(f.get("name") || "").trim(),
          templateId: f.get("templateId"),
          keywords: String(f.get("keywords")).split(",").map((s) => s.trim()).filter(Boolean),
          department: String(f.get("department") || "") || null,
        },
      });
      notify("บันทึกการตั้งค่ากลุ่มแล้ว");
      setEditing(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function unlink() {
    if (!confirm(`ยกเลิกการเชื่อม "${label}"? ข้อความใหม่จากกลุ่มนี้จะไม่ถูกบันทึกอีก`)) return;
    try {
      await api("/integrations/" + encodeURIComponent(group.group_id), { method: "DELETE" });
      notify("ยกเลิกการเชื่อมกลุ่มแล้ว");
      onUnlinked();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="line-hub-messages">
      <header className="line-hub-head">
        <div>
          <b>{label}</b>
          <small>
            {group.department ? "กลุ่มของ" + deptName(group.department) + " · " : "ยังไม่ได้ระบุแผนก · "}
            {group.lineName && group.name && group.lineName !== group.name ? "ชื่อใน LINE: " + group.lineName + " · " : ""}
            {group.templateName ? "ใช้ฟอร์ม " + group.templateName : "AI แยกแต่ละข้อความเข้าหน้าที่ถูก"} · อนุมัติด้วยคำว่า “{group.approve_keywords[0] || "อนุมัติ"}”
          </small>
        </div>
        <span className="row-actions">
          <button className="icon-button" aria-label="โหลดข้อความใหม่" onClick={() => setTick((n) => n + 1)}>
            <RefreshCw size={15} />
          </button>
          {owner && (
            <button className="secondary" onClick={() => setEditing((v) => !v)}>
              <Settings2 size={15} /> {editing ? "ปิดการตั้งค่า" : "ตั้งค่ากลุ่มนี้"}
            </button>
          )}
        </span>
      </header>
      {error && <p className="form-error">{error}</p>}
      {group.test && (
        <p className="line-hub-note">
          กลุ่มนี้สร้างโดยสคริปต์ทดสอบระบบ (scripts/line-e2e.ts) ไม่ใช่กลุ่ม LINE จริง ถ้าไม่ใช้แล้วกด “ตั้งค่ากลุ่มนี้” → “ยกเลิกการเชื่อม” ได้เลย
        </p>
      )}
      {!group.test && !group.found && <p className="line-hub-note">ดึงชื่อกลุ่มจาก LINE ไม่ได้ บอทอาจถูกนำออกจากกลุ่มแล้ว ตั้งชื่อเองได้ที่ “ตั้งค่ากลุ่มนี้”</p>}
      {owner && editing && (
        <form className="line-hub-settings" onSubmit={saveGroup} key={group.group_id}>
          <label>
            ชื่อกลุ่มในระบบ
            <input name="name" defaultValue={group.name} placeholder={group.lineName || "เช่น ฝ่ายบัญชี / หน้าร้านสาขา 1"} maxLength={100} />
          </label>
          <label>
            กลุ่มนี้เป็นของแผนก
            <select name="department" defaultValue={group.department ?? ""}>
              <option value="">— ไม่ระบุ —</option>
              {Object.entries(deptThai).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <small className="line-hub-help">คำขอจากกลุ่มอื่นที่ต้องให้แผนกนี้อนุมัติ (เช่น เบิกงบ → ฝ่ายบัญชี) จะถูกส่งมาที่กลุ่มนี้ ผู้จัดการกด Reply เพื่ออนุมัติ ไม่อนุมัติ หรือแก้ แล้วระบบแจ้งผลกลับกลุ่มที่ขอ</small>
          </label>
          <label>
            ข้อความในกลุ่มนี้ให้บันทึกแบบไหน
            <select name="templateId" defaultValue={group.template_id ?? ""}>
              <option value="">🤖 AI แยกอัตโนมัติ: ส่งแต่ละข้อความเข้าหน้าที่ถูก (แนะนำ)</option>
              {forms.map((t) => (
                <option key={t.id} value={t.id}>
                  📋 ใช้ฟอร์มเดียวทุกข้อความ: {t.department} · {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            คำที่ผู้จัดการพิมพ์เพื่ออนุมัติ (คั่นด้วย ,)
            <input name="keywords" defaultValue={group.approve_keywords.join(", ")} required />
          </label>
          <div className="row-actions">
            <button className="primary">
              <Save size={14} /> บันทึก
            </button>
            <button type="button" className="secondary danger" onClick={unlink}>
              <Trash2 size={14} /> ยกเลิกการเชื่อมกลุ่มนี้
            </button>
          </div>
          <small className="line-hub-id">รหัสกลุ่ม LINE: {group.group_id}</small>
        </form>
      )}
      <div className="line-hub-toolbar">
        <b>ข้อความ</b>
        <div className="line-hub-filters" role="tablist">
          {Object.entries(filters).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "active" : ""} onClick={() => setFilter(k as keyof typeof filters)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {!messages ? (
        !error && <Loading />
      ) : !shown.length ? (
        <Empty title="ไม่มีข้อความ" description="ข้อความที่ส่งเข้ากลุ่มจะแสดงที่นี่ พร้อมบอกว่าถูกบันทึกไปที่หน้าไหน" />
      ) : (
        <ol>
          {shown.map((m) => {
            const s = state(m),
              href = link(m);
            return (
              <li key={m.id}>
                <div className="line-hub-meta">
                  <span>{m.sender || "สมาชิกในกลุ่ม"}</span>
                  <time>{time(m.created_at)}</time>
                </div>
                <p>
                  {m.attachment_id && (
                    <a href={"/api/files/" + m.attachment_id} target="_blank" rel="noreferrer" className="line-hub-file">
                      <Paperclip size={13} /> ไฟล์แนบ
                    </a>
                  )}
                  {m.raw ? m.raw : m.attachment_id ? "" : "(ไม่มีข้อความ)"}
                </p>
                <div className="line-hub-dest">
                  {/* The page name itself opens it: the record it became, or the page where it waits for review. */}
                  {m.page &&
                    (href ? (
                      <a className="line-hub-page" href={href} title={m.record ? "เปิดรายการนี้" : "ไปตรวจในหน้า " + m.page}>
                        <ArrowRight size={13} /> {m.page}
                      </a>
                    ) : (
                      <span className="line-hub-page">
                        <ArrowRight size={13} /> {m.page}
                      </span>
                    ))}
                  {m.department && group.department && m.department !== group.department && (
                    <span className="line-hub-route" title="ส่งต่อให้แผนกนี้อนุมัติ">
                      ส่งต่อ {deptName(m.department)}
                    </span>
                  )}
                  <em className={s.tone}>{s.label}</em>
                  {m.error && !["approved", "rejected"].includes(m.status) && <small className="line-hub-err">{m.error}</small>}
                  {href && !m.page && (
                    <a className="text-button" href={href}>
                      {m.record ? "เปิดรายการ" : "ไปตรวจ"} →
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** The earlier LINE page body: group list on the left, the selected group's detail on the right. */
export function LineHub({ ctx, notify }: { ctx: Context; notify: (s: string) => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null),
    [forms, setForms] = useState<Form[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  const allowed = ["owner", "manager"].includes(ctx.member.role),
    owner = ctx.member.role === "owner";

  useEffect(() => {
    if (!allowed) return;
    api("/line-groups")
      .then((g: Group[]) => {
        setGroups(g);
        setSelected((s) => (g.some((x) => x.group_id === s) ? s : g[0]?.group_id || ""));
      })
      .catch((e) => setError((e as Error).message));
    if (owner) api("/templates").then(setForms).catch(() => {});
  }, [allowed, owner, tick]);
  if (!allowed) return null;
  const index = groups?.findIndex((g) => g.group_id === selected) ?? -1,
    group = index >= 0 ? groups![index] : undefined;

  return (
    <section className="card line-hub">
      <div className="card-heading">
        <h2>
          <MessagesSquare size={18} /> กลุ่ม LINE ที่เชื่อมต่อ {groups && <span className="line-hub-count">{groups.filter((g) => !g.test).length} กลุ่ม</span>}
        </h2>
        <button className="icon-button" aria-label="โหลดใหม่" onClick={() => setTick((n) => n + 1)}>
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!groups ? (
        !error && <Loading />
      ) : !groups.length ? (
        <Empty title="ยังไม่ได้เชื่อมกลุ่ม LINE" description="สร้างรหัสเชื่อมกลุ่มด้านล่าง แล้วพิมพ์คำสั่งในกลุ่มที่มีบอท" />
      ) : (
        <div className="line-hub-body">
          <ul className="line-hub-groups">
            {groups.map((g, i) => (
              <li key={g.group_id}>
                <button className={(g.group_id === selected ? "active " : "") + (g.test ? "test" : "")} onClick={() => setSelected(g.group_id)}>
                  {g.picture ? (
                    <img src={g.picture} alt="" width={36} height={36} />
                  ) : (
                    <i className={"line-hub-avatar" + (g.test ? " test" : "")}>{g.test ? <FlaskConical size={16} /> : <Users size={16} />}</i>
                  )}
                  <span className="line-hub-gtext">
                    <b>{title(g, i)}</b>
                    <small>{g.test ? "กลุ่มทดสอบจากสคริปต์ · ไม่มีอยู่จริงใน LINE" : g.preview ? "“" + g.preview + "”" : "ยังไม่มีข้อความ"}</small>
                    <small>
                      {g.department ? "🏢 " + deptName(g.department) + " · " : ""}
                      {g.templateName ? "📋 " + g.templateName : "🤖 AI แยกอัตโนมัติ"} · {g.lastAt ? "ล่าสุด " + displayDate(g.lastAt) : "—"}
                    </small>
                  </span>
                  {g.waiting > 0 && (
                    <em className={g.incomplete ? "warn" : "wait"} title="รายการรอตรวจ">
                      {g.waiting}
                    </em>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {group && (
            <LineGroupDetail
              key={group.group_id}
              ctx={ctx}
              notify={notify}
              group={group}
              label={title(group, index)}
              forms={forms}
              onChanged={() => setTick((n) => n + 1)}
              onUnlinked={() => {
                setSelected("");
                setTick((n) => n + 1);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
