"use client";
// Department pages without their own record type: tax summary, expiry tracker and stock transfers.
import { useEffect, useState } from "react";
import { Landmark, CalendarClock } from "lucide-react";
import type { Context, Entity } from "@/lib/types";
import { api, money, displayDate, Empty, Loading } from "./shared";
import { StockTransfers } from "./stock-transfers";

type TaxMonth = { month: string; spend: number; vat: number; pnd3: number; pnd53: number; docs: number; pending: number };
const monthName = (m: string) => new Date(m + "-01").toLocaleDateString("th-TH", { month: "long", year: "numeric" });

export function TaxReport({ navigate }: { navigate: (v: string) => void }) {
  const [rows, setRows] = useState<TaxMonth[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/tax-report").then(setRows).catch((e) => setError(e.message));
  }, []);
  if (error) return <p className="form-error">{error}</p>;
  if (!rows) return <Loading />;
  const now = rows[0];
  return (
    <>
      <div className="expense-cards">
        {(
          [
            ["ภาษีซื้อขอคืนได้ (ภ.พ.30)", now?.vat],
            ["หัก ณ ที่จ่าย ภ.ง.ด.53 (นิติบุคคล)", now?.pnd53],
            ["หัก ณ ที่จ่าย ภ.ง.ด.3 (บุคคลธรรมดา)", now?.pnd3],
            ["เอกสารรอตรวจ", now?.pending],
          ] as const
        ).map(([label, v], i) => (
          <div className="card expense-card" key={label}>
            <small>
              <Landmark size={15} /> {label}
            </small>
            <b>{i === 3 ? (v ?? 0) + " รายการ" : "฿" + money(v ?? 0)}</b>
          </div>
        ))}
      </div>
      <p className="note">
        {now ? "ยอดเดือน " + monthName(now.month) + " · " : ""}นับเฉพาะเอกสารที่ตรวจแล้ว ภาษีซื้อขอคืนได้เฉพาะใบกำกับภาษีเต็มรูป · ยื่นภายในวันที่ 7 (กระดาษ) หรือ 15 (ออนไลน์) ของเดือนถัดไป
      </p>
      {!rows.length ? (
        <Empty title="ยังไม่มีค่าใช้จ่าย" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>เดือน</th>
                <th>ค่าใช้จ่าย</th>
                <th>ภาษีซื้อ (ภ.พ.30)</th>
                <th>ภ.ง.ด.53</th>
                <th>ภ.ง.ด.3</th>
                <th>เอกสาร</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.month}>
                  <td className="primary-cell">{monthName(m.month)}</td>
                  <td>฿{money(m.spend)}</td>
                  <td>฿{money(m.vat)}</td>
                  <td>฿{money(m.pnd53)}</td>
                  <td>฿{money(m.pnd3)}</td>
                  <td>
                    {m.docs}
                    {m.pending > 0 && <span className="badge pending"> รอตรวจ {m.pending}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button className="secondary" onClick={() => navigate("expenses")}>
        ไปหน้าค่าใช้จ่าย
      </button>
    </>
  );
}

type Expiry = { id: string; kind: string; page: string; name: string; what: string; date: string; days: number };
export function Expiries({ navigate }: { navigate: (v: string) => void }) {
  const [rows, setRows] = useState<Expiry[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/expiries").then(setRows).catch((e) => setError(e.message));
  }, []);
  if (error) return <p className="form-error">{error}</p>;
  if (!rows) return <Loading />;
  const soon = rows.filter((r) => r.days >= 0 && r.days <= 30).length,
    late = rows.filter((r) => r.days < 0).length;
  return (
    <>
      <div className="expense-cards">
        {(
          [
            ["หมดอายุแล้ว", late],
            ["ภายใน 30 วัน", soon],
            ["ทั้งหมดที่ติดตาม", rows.length],
          ] as const
        ).map(([label, v]) => (
          <div className="card expense-card" key={label}>
            <small>
              <CalendarClock size={15} /> {label}
            </small>
            <b>{v} รายการ</b>
          </div>
        ))}
      </div>
      <p className="note">รวมวันหมดอายุจากสัญญา ทรัพย์สินทางปัญญา นโยบาย ไลเซนส์ซอฟต์แวร์ ภาษี/ประกันรถ และนัดคดี</p>
      {!rows.length ? (
        <Empty title="ยังไม่มีรายการที่มีวันหมดอายุ" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>รายการ</th>
                <th>เรื่อง</th>
                <th>วันที่</th>
                <th>เหลือ</th>
                <th>หน้า</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id + r.what}>
                  <td className="primary-cell">{r.name}</td>
                  <td>{r.what}</td>
                  <td>{displayDate(r.date)}</td>
                  <td>
                    <span className={"badge " + (r.days < 0 ? "rejected" : r.days <= 30 ? "pending" : "active")}>
                      {r.days < 0 ? "เลยมา " + -r.days + " วัน" : r.days === 0 ? "วันนี้" : r.days + " วัน"}
                    </span>
                  </td>
                  <td>
                    <button className="row-link" onClick={() => navigate(r.kind)}>
                      {r.page}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function TransfersPage({ ctx, notify, changed }: { ctx: Context; notify: (s: string) => void; changed: () => void }) {
  const [entities, setEntities] = useState<Entity[] | null>(null);
  useEffect(() => {
    // Pages of 25 until everything is loaded (stock levels are needed for the transfer form).
    const all = async (kind: string) => {
      const rows: Entity[] = [];
      for (let page = 0; page < 40; page++) {
        const d = await api(`/entities/${kind}?page=${page}`).catch(() => ({ rows: [], count: 0 }));
        rows.push(...d.rows);
        if (rows.length >= d.count || !d.rows.length) break;
      }
      return rows;
    };
    Promise.all([all("products"), all("projects")]).then((r) => setEntities(r.flat()));
  }, []);
  if (!entities) return <Loading />;
  return <StockTransfers ctx={ctx} entities={entities} changed={changed} notify={notify} />;
}

/** Bell panel: anything expiring within 30 days (or already expired). */
export function ExpiryAlerts({ navigate }: { navigate: (v: string) => void }) {
  const [rows, setRows] = useState<Expiry[]>([]);
  useEffect(() => {
    api("/expiries").then((r: Expiry[]) => setRows(r.filter((x) => x.days <= 30))).catch(() => {});
  }, []);
  if (!rows.length) return null;
  return (
    <button className="alert-item" onClick={() => navigate("expiries")}>
      <CalendarClock size={18} />
      <span>
        {rows.length} รายการใกล้หมดอายุ / ครบกำหนด
        <small>
          {rows.slice(0, 3).map((r) => r.name + " (" + (r.days < 0 ? "เลยมา " + -r.days : r.days) + " วัน)").join(" · ")}
        </small>
      </span>
    </button>
  );
}
