"use client";
// หน้า LINE: which groups are connected, what each group sent, and where every message went
// (which page, waiting for approval, missing data, or small talk that was not recorded).
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, MessagesSquare, Paperclip, RefreshCw, Users } from "lucide-react";
import { api, displayDate, Empty, Loading } from "./shared";
import type { Context } from "@/lib/types";
import type { LineMessage } from "@/lib/line-hub";

type Group = {
  group_id: string;
  name: string;
  picture: string | null;
  total: number;
  week: number;
  waiting: number;
  incomplete: number;
  lastAt: string | null;
};

const time = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

function state(m: LineMessage): { label: string; tone: string } {
  if (m.status === "approved") return { label: "บันทึกแล้ว", tone: "done" };
  if (m.status === "review") return m.missing.length ? { label: "ขาด: " + m.missing.join(", "), tone: "warn" } : { label: "รออนุมัติ", tone: "wait" };
  if (m.status === "skipped") return { label: "ข้อความทั่วไป · ไม่บันทึก", tone: "muted" };
  if (m.status === "rejected") return { label: "ไม่อนุมัติ", tone: "muted" };
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

export function LineHub({ ctx }: { ctx: Context }) {
  const [groups, setGroups] = useState<Group[] | null>(null),
    [selected, setSelected] = useState(""),
    [messages, setMessages] = useState<LineMessage[] | null>(null),
    [filter, setFilter] = useState<keyof typeof filters>("all"),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  const allowed = ["owner", "manager"].includes(ctx.member.role);

  useEffect(() => {
    if (!allowed) return;
    api("/line-groups")
      .then((g: Group[]) => {
        setGroups(g);
        setSelected((s) => s || g[0]?.group_id || "");
      })
      .catch((e) => setError((e as Error).message));
  }, [allowed, tick]);
  useEffect(() => {
    if (!selected) return;
    setMessages(null);
    api("/line-groups?group=" + encodeURIComponent(selected))
      .then(setMessages)
      .catch((e) => setError((e as Error).message));
  }, [selected, tick]);

  const shown = useMemo(
    () =>
      (messages || []).filter((m) =>
        filter === "recorded" ? m.status === "approved" : filter === "pending" ? ["review", "failed", "queued", "processing"].includes(m.status) : filter === "skipped" ? ["skipped", "rejected"].includes(m.status) : true,
      ),
    [messages, filter],
  );
  if (!allowed) return null;
  const group = groups?.find((g) => g.group_id === selected);

  return (
    <section className="card line-hub">
      <div className="card-heading">
        <h2>
          <MessagesSquare size={18} /> กลุ่ม LINE ที่เชื่อมต่อ {groups && <span className="line-hub-count">{groups.length} กลุ่ม</span>}
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
            {groups.map((g) => (
              <li key={g.group_id}>
                <button className={g.group_id === selected ? "active" : ""} onClick={() => setSelected(g.group_id)}>
                  {g.picture ? <img src={g.picture} alt="" width={36} height={36} /> : <span className="line-hub-avatar"><Users size={16} /></span>}
                  <span>
                    <b>{g.name || "กลุ่มไม่มีชื่อ"}</b>
                    <small>
                      7 วัน {g.week} ข้อความ{g.lastAt ? " · ล่าสุด " + displayDate(g.lastAt) : ""}
                    </small>
                  </span>
                  {g.waiting > 0 && <em className={g.incomplete ? "warn" : "wait"}>{g.waiting}</em>}
                </button>
              </li>
            ))}
          </ul>
          <div className="line-hub-messages">
            <div className="line-hub-toolbar">
              <b>{group?.name || "ข้อความ"}</b>
              <div className="line-hub-filters" role="tablist">
                {Object.entries(filters).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "active" : ""} onClick={() => setFilter(k as keyof typeof filters)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {!messages ? (
              <Loading />
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
                        {m.page && (
                          <span className="line-hub-page">
                            <ArrowRight size={13} /> {m.page}
                          </span>
                        )}
                        <em className={s.tone}>{s.label}</em>
                        {m.error && m.status !== "approved" && <small className="line-hub-err">{m.error}</small>}
                        {href && (
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
        </div>
      )}
    </section>
  );
}
