"use client";
// สาขา on the company page: one colourful card per branch (photo as cover), add / edit in a modal, archive.
// Records can then be tagged with a branch (catalog: the optional "สาขา" field, 0061_branches.sql).
import { useCallback, useEffect, useState } from "react";
import { Archive, Building2, Crown, MapPin, Pencil, Phone, Plus, Save, Search, UserRound } from "lucide-react";
import { api, Empty, Loading, Modal } from "./shared";
import { FieldControl, photoUrl } from "./records";
import { catalog } from "@/lib/catalog";
import type { Context, Entity } from "@/lib/types";

const tones = ["violet", "blue", "pink", "teal", "orange", "indigo"];
const statusTone: Record<string, string> = { เปิดทำการ: "open", ปิดชั่วคราว: "paused", ปิดแล้ว: "closed" };

export function BranchCards({ ctx, notify, changed }: { ctx: Context; notify: (s: string) => void; changed: () => void }) {
  const [rows, setRows] = useState<Entity[] | null>(null),
    [q, setQ] = useState(""),
    [archived, setArchived] = useState(false),
    [edit, setEdit] = useState<{ row?: Entity; values: Record<string, unknown> } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const writable = ctx.member.role !== "viewer";
  const manage = ctx.member.role === "owner" || ctx.member.role === "manager";
  const fields = catalog.branches.fields;
  const load = useCallback(async () => {
    try {
      const d = await api(`/entities/branches?page=0&q=${encodeURIComponent(q)}&archived=${archived}`);
      setRows(d.rows);
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, [q, archived]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await api("/entities/branches" + (edit.row ? "/" + edit.row.id : ""), {
        method: edit.row ? "PATCH" : "POST",
        body: { data: edit.values, version: edit.row?.version },
      });
      notify(edit.row ? "บันทึกสาขาแล้ว" : "เพิ่มสาขาแล้ว");
      setEdit(null);
      await load();
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const archive = async (r: Entity) => {
    if (!confirm((archived ? "คืนสาขา " : "เก็บสาขา ") + String(r.data.name) + (archived ? "?" : " เข้าคลัง?"))) return;
    try {
      await api("/entities/branches/" + r.id, { method: "DELETE", body: { archived: !archived } });
      notify(archived ? "คืนสาขาแล้ว" : "เก็บสาขาเข้าคลังแล้ว");
      await load();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <div className="br">
      <div className="br-bar">
        <label className="br-search">
          <Search size={15} />
          <input placeholder="ค้นหาสาขา…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className={"secondary" + (archived ? " selected" : "")} onClick={() => setArchived(!archived)}>
          <Archive size={15} /> {archived ? "กลับสาขาปัจจุบัน" : "สาขาในคลัง"}
        </button>
        {writable && !archived && (
          <button type="button" className="primary" onClick={() => setEdit({ values: { status: "เปิดทำการ" } })}>
            <Plus size={15} /> เพิ่มสาขา
          </button>
        )}
      </div>
      {error && !edit && <p className="form-error">{error}</p>}
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title={archived ? "ไม่มีสาขาในคลัง" : "ยังไม่มีสาขา"} description={archived ? "" : "เริ่มจากเพิ่มสำนักงานใหญ่ (รหัส 00000) แล้วเพิ่มสาขาอื่นต่อได้เลย"} />
      ) : (
        <div className="br-grid">
          {rows.map((r, i) => {
            const d = r.data,
              head = String(d.code || "") === "00000",
              tone = tones[i % tones.length],
              st = statusTone[String(d.status)] || "open";
            return (
              <article key={r.id} className={"br-card tone-" + tone}>
                <div className="br-cover">
                  {d.photo ? <img src={photoUrl(d.photo)} alt={String(d.name)} loading="lazy" /> : <Building2 size={44} />}
                  <span className={"br-status " + st}>
                    <i /> {String(d.status || "เปิดทำการ")}
                  </span>
                  {head && (
                    <span className="br-head">
                      <Crown size={12} /> สำนักงานใหญ่
                    </span>
                  )}
                </div>
                <div className="br-body">
                  <div className="br-title">
                    <h3>{String(d.name)}</h3>
                    {!!d.code && <span className="br-code">#{String(d.code)}</span>}
                  </div>
                  <ul>
                    {!!d.manager && (
                      <li>
                        <UserRound size={14} /> {String(d.manager)}
                      </li>
                    )}
                    {!!d.phone && (
                      <li>
                        <Phone size={14} /> <a href={"tel:" + String(d.phone)}>{String(d.phone)}</a>
                      </li>
                    )}
                    {!!d.address && (
                      <li>
                        <MapPin size={14} /> {String(d.address)}
                      </li>
                    )}
                  </ul>
                  {(writable || manage) && (
                    <div className="br-actions">
                      {writable && !archived && (
                        <button type="button" className="secondary" onClick={() => setEdit({ row: r, values: { ...r.data } })}>
                          <Pencil size={14} /> แก้ไข
                        </button>
                      )}
                      {manage && (
                        <button type="button" className="icon-button" aria-label={(archived ? "คืน " : "เก็บ ") + String(d.name)} onClick={() => archive(r)}>
                          <Archive size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {edit && (
        <Modal title={edit.row ? "แก้ไขสาขา" : "เพิ่มสาขา"} onClose={() => setEdit(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="form-grid br-form">
              {fields.map((f) => (
                <FieldControl
                  key={f.key}
                  field={f}
                  value={edit.values[f.key]}
                  department="Admin"
                  options={[]}
                  set={(v) => setEdit((x) => (x ? { ...x, values: { ...x.values, [f.key]: v } } : x))}
                />
              ))}
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-footer">
              <button className="primary" disabled={busy}>
                <Save size={14} /> {busy ? "กำลังบันทึก…" : "บันทึกสาขา"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
