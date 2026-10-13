"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Archive,
  RotateCcw,
  Download,
  MoreHorizontal,
  ArrowLeft,
  ArrowRight,
  Check,
  PackagePlus,
  Paperclip,
  Printer,
} from "lucide-react";
import { catalog, statusLabels, type Field } from "@/lib/catalog";
import type { Entity, Context } from "@/lib/types";
import { api, Modal, Empty, Loading, money, displayDate } from "./shared";
type Option = { id: string; kind: string; name: string };
export function FieldControl({
  field,
  value,
  set,
  options,
}: {
  field: Field;
  value: unknown;
  set: (value: unknown) => void;
  options: Option[];
}) {
  const props = {
    id: "field-" + field.key,
    name: field.key,
    required: field.required,
    value: String(value ?? ""),
    onChange: (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      set(
        field.type === "number" && e.target.value !== ""
          ? Number(e.target.value)
          : e.target.value,
      ),
  };
  return (
    <label
      className={field.type === "textarea" ? "wide" : ""}
      htmlFor={props.id}
    >
      {field.label}
      {field.required && <span className="required"> *</span>}
      {field.type === "textarea" ? (
        <textarea {...props} rows={3} />
      ) : field.type === "select" || field.type === "relation" ? (
        <select {...props}>
          <option value="">เลือก{field.label}</option>
          {field.type === "relation" &&
            !!value &&
            !options.some((o) => o.id === value) && (
              <option value={String(value)}>
                ข้อมูลที่ผูกไว้ (ไม่มีสิทธิ์ดูรายละเอียด)
              </option>
            )}
          {field.type === "relation"
            ? options
                .filter((o) => o.kind === field.resource)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))
            : field.options?.map((o) => (
                <option key={o} value={o}>
                  {statusLabels[o] || o}
                </option>
              ))}
        </select>
      ) : (
        <input
          {...props}
          type={
            field.type === "number"
              ? "number"
              : field.type === "date"
                ? "date"
                : field.type === "email"
                  ? "email"
                  : field.type === "tel"
                    ? "tel"
                    : field.type === "url"
                      ? "url"
                      : "text"
          }
          min={field.min}
          step={field.type === "number" ? "any" : undefined}
          maxLength={500}
        />
      )}
    </label>
  );
}
function initialValues(kind: string, row?: Entity) {
  if (row) return { ...row.data };
  return Object.fromEntries(
    catalog[kind].fields.map((f) => [
      f.key,
      f.type === "select"
        ? f.options?.[0]
        : f.type === "number" && f.required
          ? f.min || 0
          : f.type === "date" && f.required
            ? new Date().toISOString().slice(0, 10)
            : "",
    ]),
  );
}
export function Records({
  kind,
  ctx,
  notify,
  changed,
  refresh = 0,
}: {
  kind: string;
  ctx: Context;
  notify: (s: string) => void;
  changed: () => void;
  refresh?: number;
}) {
  const module = catalog[kind];
  const [rows, setRows] = useState<Entity[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [archived, setArchived] = useState(false),
    [board, setBoard] = useState(["projects", "tasks"].includes(kind)),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [modal, setModal] = useState<
      "edit" | "archive" | "stock" | "files" | "purchase" | "deal" | null
    >(null),
    [row, setRow] = useState<Entity | undefined>(),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [options, setOptions] = useState<Option[]>([]),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [attachments, setAttachments] = useState<
      { id: string; name: string; size: number }[]
    >([]);
  const writable = ctx.member.role !== "viewer",
    approver = ["owner", "manager"].includes(ctx.member.role);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(
        `/entities/${kind}?page=${page}&q=${encodeURIComponent(debounced)}&archived=${archived}`,
      );
      setRows(d.rows);
      setCount(d.count);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kind, page, debounced, archived]);
  useEffect(() => {
    load();
  }, [load, refresh]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    api("/options")
      .then(setOptions)
      .catch((e) => notify(e.message));
  }, [kind, notify]);
  async function open(type: typeof modal, item?: Entity) {
    setRow(item);
    setModal(type);
    setFormError("");
    setValues(
      type === "stock"
        ? {
            productId: item?.id,
            type: "in",
            quantity: 1,
            reference: crypto.randomUUID(),
            notes: "",
          }
        : initialValues(kind, item),
    );
    if (type === "files" && item) {
      try {
        setAttachments(await api("/files?entity=" + item.id));
      } catch (e) {
        setFormError((e as Error).message);
      }
    }
  }
  async function done(message: string) {
    setModal(null);
    notify(message);
    await load();
    api("/options").then(setOptions);
    changed();
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (modal === "stock") {
        await api("/stock", { method: "POST", body: values });
        await done("บันทึกสต็อกแล้ว");
      } else {
        let data = values;
        if (row?.kind === "deals" && row.data.status === "approved")
          data = { ...values, status: "approved" };
        await api("/entities/" + kind + (row ? "/" + row.id : ""), {
          method: row ? "PATCH" : "POST",
          body: { data, version: row?.version },
        });
        await done("บันทึก" + module.label + "แล้ว");
      }
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const format = (key: string, value: unknown) => {
    if (["startDate", "endDate", "dueDate", "date", "updated_at"].includes(key))
      return displayDate(value);
    if (key === "status")
      return (
        <span className={"badge " + String(value)}>
          {statusLabels[String(value)] || String(value || "—")}
        </span>
      );
    if (key.endsWith("Id"))
      return options.find((o) => o.id === value)?.name || "—";
    if (
      [
        "amount",
        "budget",
        "rent",
        "price",
        "wage",
        "total",
        "net",
        "salary",
        "stock",
        "quantity",
        "reorderLevel",
        "revenue",
      ].includes(key)
    )
      return money(value);
    return String(value ?? "—");
  };
  async function downloadCsv() {
    const r = await fetch("/api/export?kind=" + kind);
    if (!r.ok) {
      notify("ส่งออกไม่สำเร็จ");
      return;
    }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = kind + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <div className="section-actions">
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label="ค้นหา"
            placeholder={"ค้นหา" + module.label + "…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="action-group">
          {["projects", "tasks"].includes(kind) && (
            <button className="secondary" onClick={() => setBoard(!board)}>
              {board ? "ดูตาราง" : "ดูบอร์ด"}
            </button>
          )}
          {approver && (
            <button
              className={"secondary " + (archived ? "selected" : "")}
              onClick={() => {
                setArchived(!archived);
                setPage(0);
              }}
            >
              <Archive size={15} />
              {archived ? "กลับรายการปัจจุบัน" : "รายการในคลัง"}
            </button>
          )}
          <button className="secondary" onClick={downloadCsv}>
            <Download size={15} />
            CSV
          </button>
          {writable && !archived && (
            <button className="primary" onClick={() => open("edit")}>
              <Plus size={16} />
              เพิ่ม{module.label}
            </button>
          )}
        </div>
      </div>
      {kind === "products" && (
        <div className="info-strip">
          <PackagePlus size={16} />
          ยอดคงเหลือคำนวณจากรายการรับ–จ่าย คลิกสินค้าเพื่อจัดการสต็อก
        </div>
      )}
      {kind === "payments" && (
        <div className="info-strip">
          บันทึกการรับ–จ่ายที่เกิดขึ้นจริง
          ระบบนี้ไม่เรียกเก็บเงินหรือยืนยันการโอนแทนธนาคาร
        </div>
      )}
      <section className="card records-card">
        {loading ? (
          <Loading />
        ) : error ? (
          <Empty title={error} />
        ) : !rows.length ? (
          <Empty
            title={search ? "ไม่พบข้อมูลที่ค้นหา" : "ยังไม่มี" + module.label}
            description="เพิ่มข้อมูลเพื่อเริ่มต้นใช้งานใน workspace นี้"
            action={
              writable && !archived ? (
                <button className="primary" onClick={() => open("edit")}>
                  <Plus size={15} />
                  เพิ่มรายการแรก
                </button>
              ) : undefined
            }
          />
        ) : board && !archived ? (
          <div className="kanban-board">
            {(module.fields.find((f) => f.key === "status")?.options || []).map(
              (status) => (
                <section className="kanban-column" key={status}>
                  <h3>
                    {statusLabels[status] || status}
                    <span>
                      {rows.filter((r) => r.data.status === status).length}
                    </span>
                  </h3>
                  {rows
                    .filter((r) => r.data.status === status)
                    .map((r) => (
                      <article className="kanban-task" key={r.id}>
                        <span className="badge">{r.department}</span>
                        <button
                          className="row-link"
                          onClick={() => open("edit", r)}
                        >
                          {String(r.data.name)}
                        </button>
                        <p>
                          {String(
                            r.data.assignee ||
                              r.data.owner ||
                              "ยังไม่ระบุผู้รับผิดชอบ",
                          )}
                        </p>
                        {!!(r.data.dueDate || r.data.endDate) && (
                          <small>
                            กำหนด{" "}
                            {displayDate(r.data.dueDate || r.data.endDate)}
                          </small>
                        )}
                        {writable && (
                          <select
                            aria-label={"สถานะ " + r.data.name}
                            value={String(r.data.status)}
                            onChange={async (e) => {
                              try {
                                await api("/entities/" + kind + "/" + r.id, {
                                  method: "PATCH",
                                  body: {
                                    data: { ...r.data, status: e.target.value },
                                    version: r.version,
                                  },
                                });
                                await load();
                                changed();
                                notify("อัปเดตสถานะแล้ว");
                              } catch (err) {
                                notify((err as Error).message);
                                await load();
                              }
                            }}
                          >
                            {(
                              module.fields.find((f) => f.key === "status")
                                ?.options || []
                            ).map((s) => (
                              <option key={s} value={s}>
                                {statusLabels[s] || s}
                              </option>
                            ))}
                          </select>
                        )}
                      </article>
                    ))}
                </section>
              ),
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {module.columns.map((c) => (
                    <th key={c}>
                      {module.fields.find((f) => f.key === c)?.label ||
                        {
                          stock: "คงเหลือ",
                          total: "ยอดรวม",
                          net: "ค่าจ้างสุทธิ",
                          updated_at: "อัปเดต",
                          status: "สถานะ",
                        }[c] ||
                        c}
                    </th>
                  ))}
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    {module.columns.map((key, index) => (
                      <td
                        key={key}
                        className={index === 0 ? "primary-cell" : ""}
                      >
                        {index === 0 ? (
                          <button
                            className="row-link"
                            onClick={() => open("edit", item)}
                          >
                            {format(key, item.data[key])}
                          </button>
                        ) : (
                          format(
                            key,
                            item.data[key] ??
                              (item as unknown as Record<string, unknown>)[key],
                          )
                        )}
                      </td>
                    ))}
                    <td>
                      <div className="row-actions">
                        {kind === "products" && writable && !archived && (
                          <button
                            title="รับ–จ่ายสินค้า"
                            aria-label={"รับ–จ่าย " + item.data.name}
                            className="icon-button"
                            onClick={() => open("stock", item)}
                          >
                            <PackagePlus size={16} />
                          </button>
                        )}
                        {kind === "purchases" &&
                          !archived &&
                          item.data.status !== "received" &&
                          writable && (
                            <button
                              className="small-button"
                              onClick={() => open("purchase", item)}
                            >
                              {item.data.status === "draft"
                                ? "อนุมัติ"
                                : "รับสินค้า"}
                            </button>
                          )}
                        {kind === "deals" &&
                          !archived &&
                          item.data.status === "pending" &&
                          approver && (
                            <button
                              className="small-button"
                              onClick={() => open("deal", item)}
                            >
                              อนุมัติดีล
                            </button>
                          )}
                        <button
                          className="icon-button"
                          title="ไฟล์แนบ"
                          aria-label={"ไฟล์แนบ " + item.data.name}
                          onClick={() => open("files", item)}
                        >
                          <Paperclip size={15} />
                        </button>
                        {approver && (
                          <button
                            className="icon-button"
                            aria-label={
                              (archived ? "คืนรายการ " : "เก็บเข้าคลัง ") +
                              item.data.name
                            }
                            onClick={() => open("archive", item)}
                          >
                            {archived ? (
                              <RotateCcw size={15} />
                            ) : (
                              <Archive size={15} />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            {count} รายการ · หน้า {page + 1} /{" "}
            {Math.max(1, Math.ceil(count / 25))}
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="หน้าก่อน"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              <ArrowLeft size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="หน้าถัดไป"
              disabled={(page + 1) * 25 >= count}
              onClick={() => setPage(page + 1)}
            >
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>
      {modal === "edit" && (
        <Modal
          title={(row ? "รายละเอียด / แก้ไข" : "เพิ่ม") + module.label}
          onClose={() => setModal(null)}
        >
          <form onSubmit={save}>
            <fieldset
              disabled={
                !writable ||
                !!row?.archived_at ||
                busy ||
                (kind === "purchases" && row?.data.status === "received") ||
                (kind === "payments" && !!row)
              }
            >
              <div className="form-grid">
                {module.fields.map((f) => (
                  <FieldControl
                    key={f.key}
                    field={f}
                    value={values[f.key]}
                    set={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                    options={options}
                  />
                ))}
              </div>
            </fieldset>
            {kind === "invoices" && row && (
              <div className="note">
                ยอดรวม ฿{money(row.data.total)} · รับชำระ ฿
                {money(row.data.paid)} · คงค้าง ฿
                {money(Number(row.data.total) - Number(row.data.paid))}
              </div>
            )}
            {kind === "purchases" && (
              <div className="note">
                ยอดรวม ฿
                {money(
                  Number(values.quantity || 0) * Number(values.unitCost || 0),
                )}{" "}
                · {statusLabels[String(row?.data.status || "draft")]}
              </div>
            )}
            {kind === "invoices" && (
              <button
                type="button"
                className="secondary"
                onClick={() => window.print()}
              >
                <Printer size={15} />
                พิมพ์ข้อมูลใบแจ้งหนี้
              </button>
            )}
            <p role="alert" className="form-error">
              {formError}
            </p>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary"
                onClick={() => setModal(null)}
              >
                ปิด
              </button>
              {writable &&
                !row?.archived_at &&
                !(kind === "purchases" && row?.data.status === "received") &&
                !(kind === "payments" && row) && (
                  <button className="primary" disabled={busy}>
                    <Check size={15} />
                    {busy ? "กำลังบันทึก…" : "บันทึกข้อมูล"}
                  </button>
                )}
            </div>
          </form>
        </Modal>
      )}
      {modal === "stock" && (
        <Modal
          title={"รับ–จ่าย " + String(row?.data.name)}
          onClose={() => setModal(null)}
        >
          <form onSubmit={save}>
            <div className="note">
              ยอดคงเหลือ {money(row?.data.stock)}{" "}
              {String(row?.data.unit || "หน่วย")}
            </div>
            <div className="form-grid">
              {[
                {
                  key: "type",
                  label: "ประเภทรายการ",
                  type: "select",
                  required: true,
                  options: ["in", "out"],
                },
                {
                  key: "quantity",
                  label: "จำนวน",
                  type: "number",
                  required: true,
                  min: 1,
                },
                {
                  key: "reference",
                  label: "เลขอ้างอิง (ห้ามซ้ำ)",
                  required: true,
                },
                { key: "notes", label: "หมายเหตุ", type: "textarea" },
              ].map((f) => (
                <FieldControl
                  key={f.key}
                  field={f as Field}
                  value={values[f.key]}
                  set={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                  options={options}
                />
              ))}
            </div>
            <p className="form-error" role="alert">
              {formError}
            </p>
            <div className="modal-footer">
              <button className="primary" disabled={busy}>
                บันทึกรายการสต็อก
              </button>
            </div>
          </form>
        </Modal>
      )}
      {["archive", "purchase", "deal"].includes(modal || "") && (
        <Modal
          title={
            modal === "archive"
              ? archived
                ? "คืนรายการจากคลัง"
                : "เก็บรายการเข้าคลัง"
              : modal === "deal"
                ? "อนุมัติดีลและเริ่ม Workflow"
                : row?.data.status === "draft"
                  ? "อนุมัติใบสั่งซื้อ"
                  : "รับสินค้าเข้าคลัง"
          }
          onClose={() => setModal(null)}
        >
          <p className="confirm-message">{String(row?.data.name)}</p>
          <p className="muted">
            {modal === "archive"
              ? "รายการยังอยู่ในฐานข้อมูลและสามารถคืนจากคลังได้"
              : modal === "deal"
                ? "สร้างงาน Design, Purchasing, Warehouse, Marketing และ Sales"
                : row?.data.status === "draft"
                  ? "อนุมัติรายการก่อนรับสินค้า"
                  : "เพิ่มสต็อกตามจำนวนในใบสั่งซื้อ และป้องกันการรับซ้ำ"}
          </p>
          <p className="form-error" role="alert">
            {formError}
          </p>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setModal(null)}>
              ยกเลิก
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (modal === "archive")
                    await api("/entities/" + kind + "/" + row!.id, {
                      method: "DELETE",
                      body: { archived: !archived },
                    });
                  else if (modal === "deal")
                    await api("/deal/" + row!.id, { method: "POST", body: {} });
                  else
                    await api("/purchase/" + row!.id, {
                      method: "POST",
                      body: {
                        action:
                          row?.data.status === "draft" ? "approve" : "receive",
                      },
                    });
                  await done("ดำเนินการแล้ว");
                } catch (e) {
                  setFormError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              ยืนยันรายการ
            </button>
          </div>
        </Modal>
      )}
      {modal === "files" && (
        <Modal
          title={"ไฟล์แนบ · " + String(row?.data.name)}
          onClose={() => setModal(null)}
        >
          <div className="file-list">
            {attachments.map((f) => (
              <a className="file-item" key={f.id} href={"/api/files/" + f.id}>
                <Paperclip size={16} />
                <span>{f.name}</span>
                <small>{Math.round(f.size / 1000)} KB</small>
                <Download size={15} />
              </a>
            ))}
            {!attachments.length && <Empty title="ยังไม่มีไฟล์แนบ" />}
          </div>
          {writable && (
            <label className="upload-label">
              แนบไฟล์ (สูงสุด 4 MB)
              <input
                type="file"
                disabled={busy}
                accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,.xlsx"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  const form = new FormData();
                  form.set("file", file);
                  form.set("entity", row!.id);
                  form.set("department", row!.department);
                  try {
                    const r = await fetch("/api/files", {
                      method: "POST",
                      body: form,
                    });
                    const d = await r.json();
                    if (!r.ok) throw Error(d.error);
                    setAttachments((s) => [...s, d]);
                    notify("อัปโหลดแล้ว");
                  } catch (err) {
                    setFormError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          )}
          <p role="alert" className="form-error">
            {formError}
          </p>
        </Modal>
      )}
    </>
  );
}
