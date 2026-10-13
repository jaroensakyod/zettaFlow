"use client";
import { useState } from "react";
import type { Context, Entity } from "@/lib/types";
import { api, money, Modal } from "./shared";
const stageLabels: Record<string, string> = {
  draft: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  pending_vendor: "รอผู้ขายยืนยัน",
  in_progress: "กำลังจัดซื้อ",
  pending_delivery: "รอส่งของ",
  delivered: "ส่งของแล้ว",
  received: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
};
const transitions: Record<string, [string, string]> = {
  draft: ["approve", "อนุมัติ"],
  approved: ["request_vendor", "บันทึกว่าส่ง PO ให้ผู้ขายแล้ว"],
  pending_vendor: ["vendor_confirm", "บันทึกว่าผู้ขายยืนยันแล้ว"],
  in_progress: ["dispatch", "บันทึกว่าพร้อมจัดส่ง"],
  pending_delivery: ["deliver", "บันทึกว่าส่งของแล้ว"],
  delivered: ["receive", "รับสินค้าเข้าคลัง / เสร็จสิ้น"],
};
export function PurchaseLifecycle({
  rows,
  ctx,
  changed,
  notify,
}: {
  rows: Entity[];
  ctx: Context;
  changed: () => void;
  notify: (s: string) => void;
}) {
  const [current, setCurrent] = useState<{
      row: Entity;
      action: string;
      label: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const writable =
      ctx.member.role !== "viewer" &&
      (ctx.member.role === "owner" ||
        ctx.member.departments.includes("Purchasing")),
    approver = ["owner", "manager"].includes(ctx.member.role);
  return (
    <section className="z-card">
      <div className="z-card-heading">
        <h2>สถานะคำขอซื้อ / ใบสั่งซื้อ (Procurement Workflow)</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PR No.</th>
              <th>PO No.</th>
              <th>โปรเจกต์ / งาน / โปรโมชั่น</th>
              <th>กำหนดใช้งาน</th>
              <th>สถานที่จัดส่ง</th>
              <th>มูลค่า (บาท)</th>
              <th>สถานะ</th>
              <th>ขั้นตอนถัดไป</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = String(row.data.status),
                next = transitions[status];
              return (
                <tr key={row.id}>
                  <td>{String(row.data.name)}</td>
                  <td>{String(row.data.poNumber || "—")}</td>
                  <td>{String(row.data.usagePurpose || "—")}</td>
                  <td>
                    {String(row.data.startDate || "—")} –{" "}
                    {String(row.data.endDate || "—")}
                  </td>
                  <td>{String(row.data.deliveryLocation || "—")}</td>
                  <td>{money(row.data.total)}</td>
                  <td>
                    <span
                      className={
                        "z-badge " +
                        (status === "received"
                          ? "z-approved"
                          : status === "draft"
                            ? "z-pending"
                            : "z-progress")
                      }
                    >
                      {stageLabels[status] || status}
                    </span>
                  </td>
                  <td>
                    {writable &&
                      next &&
                      (status !== "draft" || approver) &&
                      (next[0] !== "receive" ||
                        ctx.member.role === "owner" ||
                        ctx.member.departments.includes("Warehouse")) && (
                        <button
                          className="z-small-button"
                          onClick={() => {
                            setError("");
                            setCurrent({
                              row,
                              action: next[0],
                              label: next[1],
                            });
                          }}
                        >
                          {next[1]}
                        </button>
                      )}
                    {writable &&
                      !["received", "cancelled"].includes(status) &&
                      (status === "draft" || approver) && (
                        <button
                          className="z-small-button"
                          onClick={() => {
                            setError("");
                            setCurrent({
                              row,
                              action: "cancel",
                              label: "ยกเลิกใบขอซื้อ",
                            });
                          }}
                        >
                          ยกเลิก
                        </button>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        ปุ่มบันทึกการติดต่อผู้ขายเปลี่ยนสถานะในระบบ
        ผู้ใช้งานต้องติดต่อผู้ขายผ่านช่องทางของบริษัท
      </p>
      {current && (
        <Modal title={current.label} onClose={() => setCurrent(null)}>
          <p>
            {String(current.row.data.name)} · {money(current.row.data.total)}{" "}
            บาท
          </p>
          {current.action === "receive" && (
            <p>รับสินค้าตามจำนวนใน PO และป้องกันการรับซ้ำ</p>
          )}
          <p className="form-error" role="alert">
            {error}
          </p>
          <div className="modal-footer">
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/purchase/" + current.row.id, {
                    method: "POST",
                    body: { action: current.action },
                  });
                  setCurrent(null);
                  changed();
                  notify("บันทึกขั้นตอนจัดซื้อแล้ว");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              ยืนยัน
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
