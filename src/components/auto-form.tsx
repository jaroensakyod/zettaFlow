"use client";
// The colourful add / edit form every module gets for free: a summary card in the department's colour (name, the
// main amount, status as buttons), then the fields sorted into coloured sections — main details, people and links,
// money and numbers, dates, item lines, and notes. Modules with their own form (sales, products, grouped editors)
// keep theirs.
import { CalendarDays, CheckCircle2, Circle, Coins, FileText, Link2, ListOrdered, NotebookPen, PencilLine, Sparkles } from "lucide-react";
import { catalog, statusLabels, type Field } from "@/lib/catalog";
import { departmentOf } from "@/lib/departments";
import { FieldControl, type Option } from "./records";

/** Department → colour of the form's header, summary card and save button. */
const deptTone: Record<string, string> = {
  Sales: "violet",
  "Business Development": "violet",
  Marketing: "pink",
  Warehouse: "blue",
  Purchasing: "teal",
  Finance: "green",
  HR: "amber",
  Event: "purple",
  IT: "orange",
  Legal: "indigo",
  "Customer Service": "teal",
  Admin: "slate",
  Operations: "slate",
};
/** The colour of the department menu the module sits in (assets → IT), else of the module's own department. */
export const formTone = (kind: string) => departmentOf(kind)?.tone || deptTone[catalog[kind]?.department || ""] || "violet";
/** The modal class for a module's auto form. */
export const autoFormClass = (kind: string) => "ge-modal af-modal af-" + formTone(kind);

type Group = { key: string; title: string; hint: string; tone: string; icon: React.ComponentType<{ size?: number }>; fields: Field[] };
const moneyKey = /amount|total|price|cost|budget|salary|fee|value|net|paid|spent|remaining|target|actual|deposit|revenue/i;
const statusKey = (f: Field) => f.type === "select" && (f.key === "status" || f.key === "payStatus") && (f.options?.length || 0) <= 6;
const fmt = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

function groupsOf(fields: Field[], status?: Field): Group[] {
  const g: Record<string, Group> = {
    main: { key: "main", title: "ข้อมูลหลัก", hint: "ชื่อ ประเภท และรายละเอียดสำคัญ", tone: "blue", icon: FileText, fields: [] },
    link: { key: "link", title: "ผู้เกี่ยวข้องและการเชื่อมโยง", hint: "ลูกค้า โครงการ ผู้รับผิดชอบ และข้อมูลที่ผูกกัน", tone: "teal", icon: Link2, fields: [] },
    money: { key: "money", title: "จำนวนเงินและตัวเลข", hint: "ระบบคำนวณยอดที่เกี่ยวข้องให้อัตโนมัติเมื่อบันทึก", tone: "green", icon: Coins, fields: [] },
    date: { key: "date", title: "วันที่และกำหนดเวลา", hint: "วันเริ่ม วันครบกำหนด และวันสำคัญ", tone: "orange", icon: CalendarDays, fields: [] },
    lines: { key: "lines", title: "รายการ", hint: "เพิ่มได้หลายรายการ พร้อมจำนวนและราคา", tone: "pink", icon: ListOrdered, fields: [] },
    notes: { key: "notes", title: "รายละเอียดและหมายเหตุ", hint: "ข้อความเพิ่มเติม ไม่บังคับ", tone: "slate", icon: NotebookPen, fields: [] },
  };
  for (const f of fields) {
    if (f.hidden || f === status) continue;
    const t = f.type || "text";
    if (t === "lines") g.lines.fields.push(f);
    else if (t === "textarea") g.notes.fields.push(f);
    else if (t === "number") g.money.fields.push(f);
    else if (t === "date") g.date.fields.push(f);
    else if (t === "relation" || t === "people") g.link.fields.push(f);
    else g.main.fields.push(f);
  }
  // A lone date or link reads better beside the main details than in a section of its own.
  for (const k of ["date", "link"]) if (g[k].fields.length === 1 && g.main.fields.length < 6) g.main.fields.push(...g[k].fields.splice(0));
  return Object.values(g).filter((x) => x.fields.length);
}

export function AutoFields({
  kind,
  values,
  set,
  options,
  isNew,
}: {
  kind: string;
  values: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  options: Option[];
  isNew: boolean;
}) {
  const module = catalog[kind];
  const fields = module.fields;
  const status = fields.find((f) => !f.hidden && statusKey(f));
  const groups = groupsOf(fields, status);
  const title = fields.find((f) => !f.hidden && (f.type || "text") === "text");
  const amount = fields.find((f) => !f.hidden && f.type === "number" && moneyKey.test(f.key) && Number(values[f.key]));
  const name = String((title && values[title.key]) || "");
  return (
    <>
      <section className="af-hero">
        <div className="af-hero-top">
          <span className="af-hero-icon">{isNew ? <Sparkles size={22} /> : <PencilLine size={22} />}</span>
          <div>
            <small>{isNew ? "เพิ่ม" + module.label + "ใหม่" : module.label}</small>
            <b>{name || (title ? title.label : module.label)}</b>
          </div>
          {amount && (
            <span className="af-hero-amount">
              <small>{amount.label}</small>
              <b>{amount.key === "percent" ? fmt(Number(values[amount.key])) + "%" : "฿" + fmt(Number(values[amount.key]))}</b>
            </span>
          )}
        </div>
        {status && (
          <div className="af-status" role="radiogroup" aria-label={status.label}>
            {status.options!.map((o) => {
              const on = values[status.key] === o;
              return (
                <button key={o} type="button" role="radio" aria-checked={on} className={on ? "on" : ""} onClick={() => set(status.key, o)}>
                  {on ? <CheckCircle2 size={15} /> : <Circle size={15} />} {statusLabels[o] || o}
                </button>
              );
            })}
          </div>
        )}
      </section>
      {groups.map((g) => (
        <section key={g.key} className={"ge-section tone-" + g.tone}>
          <header>
            <span className="ge-icon">
              <g.icon size={17} />
            </span>
            <div>
              <h3>{g.title}</h3>
              <small>{g.hint}</small>
            </div>
          </header>
          <div className="form-grid">
            {g.fields.map((f) => (
              <FieldControl key={f.key} field={f} value={values[f.key]} set={(v) => set(f.key, v)} options={options} department={module.department} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
