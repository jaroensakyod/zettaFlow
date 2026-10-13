"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Plus, Package } from "lucide-react";
import type {
  Context,
  Entity,
  StockTransfer,
  ProjectInventory,
} from "@/lib/types";
import { api, Modal, Empty, money, displayDate } from "./shared";
export function StockTransfers({
  ctx,
  entities,
  changed,
  notify,
}: {
  ctx: Context;
  entities: Entity[];
  changed: () => void;
  notify: (s: string) => void;
}) {
  const [transfers, setTransfers] = useState<StockTransfer[]>([]),
    [inventory, setInventory] = useState<ProjectInventory[]>([]),
    [modal, setModal] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const data = await api("/transfers");
      setTransfers(data.transfers);
      setInventory(data.inventory);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const products = entities.filter((e) => e.kind === "products"),
    projects = entities.filter((e) => e.kind === "projects"),
    name = (id: string | null) =>
      id
        ? String(
            projects.find((p) => p.id === id)?.data.name ||
              "ไม่มีสิทธิ์ดูรายละเอียด",
          )
        : "คลังกลาง (Central Warehouse)";
  return (
    <section className="z-card">
      <div className="z-card-heading">
        <h2>
          <ArrowRightLeft size={17} />
          การโอนย้ายสินค้า (Transfer)
        </h2>
        {ctx.member.role !== "viewer" && (
          <button
            className="primary"
            onClick={() => {
              setError("");
              setModal(true);
            }}
          >
            <Plus size={14} />
            โอนย้ายสินค้า
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">
        โอนจากคลังกลางไปงาน โอนกลับคลัง หรือโอนไปโครงการอื่น ·
        ยอดรวมสินค้าของบริษัทไม่เปลี่ยนจากการโอน
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>สินค้า</th>
              <th>จำนวนที่โอน</th>
              <th>จากโปรเจกต์</th>
              <th>ไปยัง</th>
              <th>เหตุผล</th>
              <th>ผู้ดำเนินการ</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{displayDate(t.created_at)}</td>
                <td>
                  {String(
                    products.find((p) => p.id === t.product_id)?.data.name ||
                      "—",
                  )}
                </td>
                <td>{money(t.quantity)}</td>
                <td>{name(t.from_project)}</td>
                <td>{name(t.to_project)}</td>
                <td>{t.reason}</td>
                <td>{t.created_name}</td>
                <td>
                  <span className="z-badge z-approved">สำเร็จ</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!transfers.length && <Empty title="ยังไม่มีการโอนสินค้า" />}
      <h3>สต็อกคงเหลือในโครงการ</h3>
      <div className="zd-allocation">
        {inventory
          .filter((i) => i.quantity > 0)
          .map((i) => (
            <div key={i.product_id + i.project_id}>
              <Package size={17} />
              <span>
                <strong>{name(i.project_id)}</strong>
                <small>
                  {String(
                    products.find((p) => p.id === i.product_id)?.data.name ||
                      "—",
                  )}
                </small>
              </span>
              <strong>{money(i.quantity)}</strong>
            </div>
          ))}
      </div>
      {!inventory.some((i) => i.quantity > 0) && (
        <p className="muted">ยังไม่ได้จัดสินค้าไปยังโครงการ</p>
      )}
      {modal && (
        <Modal title="โอนย้ายสินค้า" onClose={() => setModal(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const data = new FormData(e.currentTarget);
              try {
                await api("/transfers", {
                  method: "POST",
                  body: {
                    productId: data.get("productId"),
                    fromProject: data.get("fromProject") || null,
                    toProject: data.get("toProject") || null,
                    quantity: Number(data.get("quantity")),
                    reference: data.get("reference"),
                    reason: data.get("reason"),
                  },
                });
                setModal(false);
                await load();
                changed();
                notify("โอนสินค้าและอัปเดตยอดคงเหลือแล้ว");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                สินค้า
                <select name="productId" required>
                  <option value="">เลือกสินค้า</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.data.name)} · คลังกลาง {money(p.data.stock)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                จำนวน
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  step="1"
                  required
                />
              </label>
              <label>
                จากโปรเจกต์ / คลัง
                <select name="fromProject">
                  <option value="">คลังกลาง</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.data.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                ไปยัง
                <select name="toProject">
                  <option value="">คลังกลาง</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.data.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                เลขอ้างอิง (ห้ามซ้ำ)
                <input
                  name="reference"
                  defaultValue={"TRANSFER-" + crypto.randomUUID()}
                  required
                  maxLength={200}
                />
              </label>
              <label className="wide">
                เหตุผล / ประเภทการโอนย้าย
                <textarea
                  name="reason"
                  required
                  maxLength={4000}
                  placeholder="ขายไม่หมด / โอนกลับคลัง / โอนใช้ในโปรโมชั่นอื่น"
                />
              </label>
            </div>
            <p className="form-error" role="alert">
              {error}
            </p>
            <div className="modal-footer">
              <button className="primary" disabled={busy}>
                ยืนยันการโอนย้าย
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function ProjectStock({
  projectId,
  entities,
}: {
  projectId: string;
  entities: Entity[];
}) {
  const [inventory, setInventory] = useState<ProjectInventory[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setInventory(null);
    setError("");
    api("/transfers")
      .then((d) => {
        if (active)
          setInventory(
            d.inventory.filter(
              (i: ProjectInventory) => i.project_id === projectId,
            ),
          );
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  return (
    <div className="z-project-stock">
      <h3>สต็อกคงเหลือในโครงการ</h3>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : inventory === null ? (
        <p className="muted">กำลังโหลดสต็อก…</p>
      ) : inventory.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>สินค้า</th>
                <th>จำนวนคงเหลือ</th>
                <th>อัปเดตล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((i) => (
                <tr key={i.product_id}>
                  <td>
                    {String(
                      entities.find((e) => e.id === i.product_id)?.data.name ||
                        i.product_id,
                    )}
                  </td>
                  <td>{money(i.quantity)}</td>
                  <td>{displayDate(i.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="ยังไม่มีการจัดสินค้าให้โครงการนี้" />
      )}
    </div>
  );
}
