"use client";
// ดูในมุมมองลูกค้า (support-view.ts): the button action in หลังบ้าน that opens a customer company read-only, and the
// banner the admin sees while looking. The customer is not shown the view; it is kept in the admin log.
import { useEffect, useState } from "react";
import { Eye, LogOut } from "lucide-react";
import { api } from "./shared";
import type { SupportView } from "@/lib/support-view";

const time = (s: string) => new Date(s).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
function useMinutesLeft(at?: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  return at ? Math.max(0, Math.ceil((Date.parse(at) - Date.now()) / 60000)) : 0;
}

/** หลังบ้าน: go straight into a customer company, read-only. */
export async function openCustomerView(companyId: string) {
  await api("/admin/view", { method: "POST", body: { company_id: companyId } });
  window.location.href = "/workspace/dashboard";
}

/** Admin side: you are in a customer's company, read-only. */
export function SupportViewBanner({ support, company }: { support: SupportView; company: string }) {
  const left = useMinutesLeft(support.expires_at),
    [busy, setBusy] = useState(false);
  const leave = async () => {
    setBusy(true);
    await api("/admin/view", { method: "DELETE" }).catch(() => null);
    window.location.href = "/workspace/admin";
  };
  useEffect(() => {
    if (left <= 0) window.location.href = "/workspace/admin";
  }, [left]);
  return (
    <div className="sv-banner admin" role="status">
      <i>
        <Eye size={16} />
      </i>
      <span>
        <b>กำลังดู {company} ในมุมมองลูกค้า · อ่านอย่างเดียว</b>
        <small>
          เหลือ {left} นาที (ถึง {time(support.expires_at)})
        </small>
      </span>
      <button onClick={leave} disabled={busy}>
        <LogOut size={14} /> ออกจากมุมมองลูกค้า
      </button>
    </div>
  );
}
