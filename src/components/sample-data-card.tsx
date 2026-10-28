"use client";
// Owner-only card on the company page: fill this company with the demo company to try every department and
// น้องโฟลว์, or archive that sample data again.
import { useState } from "react";
import { Database, Trash2 } from "lucide-react";
import type { Context } from "@/lib/types";
import { api } from "./shared";

export function SampleDataCard({ ctx, notify, changed }: { ctx: Context; notify: (s: string) => void; changed: () => void }) {
  const loaded = Array.isArray(ctx.company.settings.sample_ids) && (ctx.company.settings.sample_ids as unknown[]).length > 0;
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  if (ctx.demo || ctx.member.role !== "owner") return null;
  const run = async (action: "load" | "clear") => {
    if (action === "load" && !confirm("ใส่ข้อมูลบริษัทตัวอย่าง (ลูกค้า พนักงาน ยอดขาย 4 เดือน ฯลฯ ประมาณ 600 รายการ) ลงในบริษัทนี้?")) return;
    if (action === "clear" && !confirm("เก็บข้อมูลตัวอย่างทั้งหมดเข้าคลัง (กู้คืนได้จากแต่ละหน้า)?")) return;
    setBusy(action);
    setError("");
    try {
      const r: { loaded?: number; archived?: number } = await api("/sample-data", { method: "POST", body: { action } });
      notify(action === "load" ? `ใส่ข้อมูลตัวอย่างแล้ว ${r.loaded} รายการ` : `เก็บข้อมูลตัวอย่างเข้าคลังแล้ว ${r.archived} รายการ`);
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="card sample-card">
      <span className="sample-card-icon">
        <Database size={22} />
      </span>
      <div>
        <h3>ข้อมูลตัวอย่างสำหรับทดลองระบบ</h3>
        <p>
          {loaded
            ? "บริษัทนี้มีข้อมูลตัวอย่างอยู่ ลบออกได้ทุกเมื่อ ข้อมูลจริงที่คุณเพิ่มเองจะไม่ถูกแตะ"
            : "ใส่บริษัทจำลองที่มีข้อมูลครบทุกแผนก (ลูกค้า พนักงาน ยอดขาย 4 เดือน บิล สต็อก HR อีเวนต์ ฯลฯ) เพื่อลองทุกหน้าและถามน้องโฟลว์"}
        </p>
        {error && <p className="form-error">{error}</p>}
      </div>
      {loaded ? (
        <button className="secondary" disabled={!!busy} onClick={() => run("clear")}>
          <Trash2 size={15} /> {busy ? "กำลังลบ…" : "ลบข้อมูลตัวอย่าง"}
        </button>
      ) : (
        <button className="primary" disabled={!!busy} onClick={() => run("load")}>
          <Database size={15} /> {busy ? "กำลังใส่ข้อมูล…" : "ใส่ข้อมูลตัวอย่าง"}
        </button>
      )}
    </section>
  );
}
