"use client";
// แพ็กเกจฟรี saves only บัญชีและการเงิน. When the server refuses a save for that reason (402 + upgrade), api() fires
// "ef-upgrade" and this dialog explains it, with a button to the package page.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Check, Crown, Lock } from "lucide-react";
import { Modal } from "./shared";

export function UpgradeDialog() {
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    const on = (e: Event) => setMessage(String((e as CustomEvent).detail || ""));
    window.addEventListener("ef-upgrade", on);
    return () => window.removeEventListener("ef-upgrade", on);
  }, []);
  if (message === null) return null;
  return (
    <Modal title="อัปเกรดแพ็กเกจเพื่อบันทึก" onClose={() => setMessage(null)} className="upg-modal">
      <div className="upg">
        <span className="upg-icon">
          <Lock size={28} />
        </span>
        <p className="upg-msg">{message || "ระบบนี้ต้องใช้แพ็กเกจแบบชำระเงิน"}</p>
        <ul>
          <li>
            <Calculator size={15} /> แพ็กเกจฟรี: ระบบบัญชีและการเงิน
          </li>
          <li>
            <Check size={15} /> แพ็กเกจแบบชำระเงิน: การตลาด · เซลล์ · คลังสินค้า · HR · งานทั่วไป และ AI ผ่าน LINE ทุกระบบ
          </li>
          <li>
            <Check size={15} /> ชำระแล้วปลดล็อกทันที ข้อมูลที่กรอกไว้ยังอยู่ กดบันทึกใหม่ได้เลย
          </li>
        </ul>
      </div>
      <div className="modal-footer">
        <button type="button" className="secondary" onClick={() => setMessage(null)}>
          ไว้ทีหลัง
        </button>
        <button
          type="button"
          className="primary upg-go"
          onClick={() => {
            setMessage(null);
            router.push("/workspace/pricing");
          }}
        >
          <Crown size={16} /> ดูแพ็กเกจและชำระเงิน
        </button>
      </div>
    </Modal>
  );
}
