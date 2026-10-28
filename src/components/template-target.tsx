"use client";
// Data Template → workspace page: pick where approved items (from LINE groups or the web) are copied, and match fields.
import { useState } from "react";
import { Send } from "lucide-react";
import type { Template } from "@/lib/types";
import { catalog, modules } from "@/lib/catalog";
import { departmentMenu, baseView } from "@/lib/departments";
import { api, Modal } from "./shared";
import { templateForPage } from "@/lib/line-target";

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-()]/g, "");
/** Best guess: same key, same label, or one label containing the other. */
export function guessMap(t: Pick<Template, "fields">, kind: string) {
  const page = catalog[kind];
  const map: Record<string, string> = {};
  if (!page) return map;
  for (const f of t.fields) {
    const hit =
      page.fields.find((p) => p.key === f.key) ||
      page.fields.find((p) => norm(p.label) === norm(f.label)) ||
      page.fields.find((p) => norm(p.label).includes(norm(f.label)) || norm(f.label).includes(norm(p.label)));
    if (hit) map[f.key] = hit.key;
  }
  return map;
}
// Pages offered, grouped like the แผนก menu (plus anything else in the catalog).
const groups = [
  ...departmentMenu.map((d) => ({ label: d.title, kinds: [...new Set(d.items.map((i) => baseView(i.view)).filter((k) => catalog[k]))] })),
  { label: "อื่นๆ", kinds: modules.map((m) => m.key).filter((k) => !departmentMenu.some((d) => d.items.some((i) => baseView(i.view) === k))) },
];

export function TemplateTarget({ t, editable, onSaved }: { t: Template; editable: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState(t.target_kind || ""),
    [map, setMap] = useState<Record<string, string>>(t.field_map || {}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const page = kind ? catalog[kind] : undefined;
  const missing = page?.fields.filter((f) => f.required && f.type !== "select" && f.key !== "name" && f.key !== "date" && !Object.values(map).includes(f.key)) || [];
  return (
    <>
      <button className="template-target" disabled={!editable} onClick={() => setOpen(true)} title="ข้อมูลที่อนุมัติแล้วจะถูกบันทึกลงหน้านี้อัตโนมัติ">
        <Send size={13} />
        {t.target_kind && catalog[t.target_kind] ? "ส่งเข้า: " + catalog[t.target_kind].label : "ยังไม่ได้เลือกหน้าปลายทาง"}
      </button>
      {open && (
        <Modal title={"ส่งข้อมูลจาก “" + t.name + "” ไปที่หน้า"} onClose={() => setOpen(false)}>
          <p className="muted">
            เมื่อรายการถูกอนุมัติ (ในเว็บ, พิมพ์ #approve หรือคีย์เวิร์ดอนุมัติในกลุ่ม LINE) ระบบจะบันทึกลงหน้าที่เลือกให้อัตโนมัติ
          </p>
          <label>
            หน้าปลายทาง
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setMap(e.target.value ? guessMap(t, e.target.value) : {});
              }}
            >
              <option value="">— ไม่ส่งต่อ (เก็บใน Data Inbox อย่างเดียว) —</option>
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.kinds.map((k) => (
                    <option key={k} value={k}>
                      {catalog[k].label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {page && (
            <div className="target-map">
              <b>จับคู่ฟิลด์</b>
              {t.fields.map((f) => (
                <label key={f.key}>
                  <span>{f.label}</span>
                  <select value={map[f.key] || ""} onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}>
                    <option value="">— ไม่ใช้ —</option>
                    {page.fields
                      .filter((p) => p.type !== "lines" && p.type !== "image")
                      .map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
              {!!missing.length && (
                <p className="note">
                  หน้านี้ต้องมี {missing.map((m) => m.label).join(", ")} ถ้าไม่ได้จับคู่ รายการจะไม่ถูกบันทึกและขึ้นหมายเหตุใน Data Inbox
                </p>
              )}
              <p className="muted">ชื่อรายการ วันที่ และสถานะ ระบบเติมให้ถ้าไม่ได้ส่งมา</p>
            </div>
          )}
          <p role="alert" className="form-error">{error}</p>
          <button
            className="primary full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/templates/" + t.id + "/target", {
                  method: "POST",
                  body: { kind: kind || null, map: Object.fromEntries(Object.entries(map).filter(([, v]) => v)) },
                });
                setOpen(false);
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            บันทึก
          </button>
        </Modal>
      )}
    </>
  );
}

/** One click: create a template for this page, point it here, then go link a LINE group. */
export function LineFeedButton({ kind, notify }: { kind: string; notify: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="secondary"
      disabled={busy}
      title="สร้าง Template ที่ฟิลด์ตรงกับหน้านี้ แล้วเชื่อมกลุ่ม LINE ให้ข้อมูลไหลเข้าหน้านี้"
      onClick={async () => {
        setBusy(true);
        try {
          const { template, map } = templateForPage(kind);
          const t = await api("/templates", { method: "POST", body: template });
          await api("/templates/" + t.id + "/target", { method: "POST", body: { kind, map } });
          notify("สร้าง Template แล้ว ต่อไปสร้างรหัสเชื่อมกลุ่ม LINE");
          window.location.assign("/workspace/integrations?template=" + t.id);
        } catch (e) {
          notify((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Send size={15} /> รับข้อมูลจากกลุ่ม LINE
    </button>
  );
}
