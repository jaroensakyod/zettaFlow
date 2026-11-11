"use client";
import { useState } from "react";
import { Building2, Check, ChevronRight, IdCard, MapPin, Phone, Sparkles, X } from "lucide-react";
import { companyRequired } from "@/lib/company-required";
import type { Context } from "@/lib/types";

const icons = { name: Building2, taxId: IdCard, address: MapPin, phone: Phone } as const;
const HIDE = "ef_company_setup_later";

/**
 * After sign-in: asks the owner to finish the company details (name, ID card / tax ID or registration no., address,
 * phone). Hides once they are filled in; "ไว้ทีหลัง" hides it until the next sign-in (this browser session).
 */
export function CompanySetupCard({ ctx, navigate }: { ctx: Context; navigate: (v: string) => void }) {
  const [later, setLater] = useState(() => {
    try {
      return sessionStorage.getItem(HIDE) === ctx.company.id;
    } catch {
      return false;
    }
  });
  const profile = { name: ctx.company.name, ...ctx.company.profile };
  const items = companyRequired.map((r) => ({ ...r, ok: r.done(profile) }));
  const done = items.filter((i) => i.ok).length;
  if (ctx.demo || ctx.member.role !== "owner" || later || done === items.length) return null;
  const next = items.find((i) => !i.ok)!;
  return (
    <section className="csc" aria-label="ตั้งค่าข้อมูลบริษัท">
      <div className="csc-glow" aria-hidden />
      <button
        className="csc-close"
        aria-label="ไว้ทีหลัง"
        onClick={() => {
          try {
            sessionStorage.setItem(HIDE, ctx.company.id);
          } catch {}
          setLater(true);
        }}
      >
        <X size={16} />
      </button>
      <div className="csc-main">
        <span className="csc-badge">
          <Sparkles size={14} /> ขั้นตอนแรก
        </span>
        <h2>บันทึกข้อมูลบริษัทให้เรียบร้อย</h2>
        <p>
          ใช้ออกใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ และแสดงในหน้าบริษัทของคุณ ข้อมูลอื่นไม่ต้องกรอกครบก็ได้ กรอกเพิ่มทีหลังได้ตลอด
        </p>
        <div className="csc-progress" style={{ ["--p" as string]: (done / items.length) * 100 + "%" }}>
          <span />
        </div>
        <small className="csc-count">
          กรอกแล้ว {done} จาก {items.length} ข้อที่จำเป็น
        </small>
      </div>
      <ul className="csc-list">
        {items.map((i) => {
          const Icon = icons[i.key as keyof typeof icons];
          return (
            <li key={i.key} className={"csc-item k-" + i.key + (i.ok ? " ok" : "")}>
              <button onClick={() => navigate("company?tab=about&section=" + i.tab)}>
                <span className="csc-icon">{i.ok ? <Check size={16} /> : <Icon size={16} />}</span>
                <span className="csc-label">{i.label}</span>
                <span className="csc-state">{i.ok ? "เรียบร้อย" : "ยังไม่กรอก"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="csc-actions">
        <button className="csc-go" onClick={() => navigate("company?tab=about&section=" + next.tab)}>
          ไปกรอกข้อมูลบริษัท <ChevronRight size={17} />
        </button>
      </div>
    </section>
  );
}
