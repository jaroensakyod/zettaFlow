"use client";
import { useState, type FormEvent } from "react";
import { Building2, Check, IdCard, LoaderCircle, LogOut, MapPin, Phone, Sparkles } from "lucide-react";
import { companyMissing, companyRequired } from "@/lib/company-required";
import { companyFields } from "@/lib/catalog";
import type { Context } from "@/lib/types";
import { api, setTabCompany } from "./shared";

const icons = { name: Building2, taxId: IdCard, address: MapPin, phone: Phone } as const;

/** The saved profile with the company name filled in, as the company form keeps it. */
const savedProfile = (ctx: Context) => {
  const p = { ...ctx.company.profile } as Record<string, unknown>;
  if (!String(p.name ?? "").trim()) p.name = ctx.company.name;
  return p;
};
export const companyNeedsSetup = (ctx: Context) =>
  !ctx.demo && ctx.member.role === "owner" && companyMissing(savedProfile(ctx)).length > 0;

/**
 * Pop-up in the middle of the screen after sign-in: the owner fills in the four required company details
 * (name, ID card / tax ID or registration no., address, phone) before using the workspace. It cannot be closed;
 * saving reloads the workspace and it goes away. Everything else on the company page stays optional.
 */
export function CompanySetupGate({ ctx, changed }: { ctx: Context; changed: () => void }) {
  const saved = savedProfile(ctx);
  const [v, setV] = useState({
    name: String(saved.name ?? ""),
    taxId: String(saved.taxId ?? "").replace(/\D/g, ""),
    registration: String(saved.registration ?? ""),
    address: String(saved.address ?? ""),
    phone: String(saved.phone ?? ""),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (k: keyof typeof v, value: string) => setV((s) => ({ ...s, [k]: value }));
  const items = companyRequired.map((r) => ({ ...r, ok: r.done(v) }));
  const done = items.filter((i) => i.ok).length;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = companyMissing(v);
    if (missing.length) return setError("กรุณากรอก: " + missing.map((m) => m.label).join(" · "));
    if (v.taxId && !/^\d{13}$/.test(v.taxId)) return setError("เลขบัตรประชาชน / เลขผู้เสียภาษี ต้องเป็นตัวเลข 13 หลัก");
    setBusy(true);
    try {
      // save_company replaces the whole profile, so every other saved field goes back unchanged.
      const profile = Object.fromEntries(
        Object.entries({ ...saved, ...v })
          .filter(([k]) => companyFields.some((f) => f.key === k))
          .map(([k, val]) => [k, String(val ?? "").trim()]),
      );
      await api("/company", { method: "PATCH", body: { profile } });
      setError("");
      changed();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="csg-backdrop" role="dialog" aria-modal="true" aria-labelledby="csg-title">
      <form className="csg" onSubmit={submit}>
        <header className="csg-head">
          <div className="csg-glow" aria-hidden />
          <span className="csg-badge">
            <Sparkles size={14} /> ก่อนเริ่มใช้งาน
          </span>
          <h2 id="csg-title">บันทึกข้อมูลบริษัทให้เรียบร้อย</h2>
          <p>กรอก 4 ข้อนี้เพื่อเริ่มใช้งาน ใช้ออกใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ และแสดงในหน้าบริษัท ข้อมูลอื่นกรอกเพิ่มทีหลังได้ที่หน้าบริษัท</p>
          <div className="csg-steps">
            {items.map((i) => {
              const Icon = icons[i.key as keyof typeof icons];
              return (
                <span key={i.key} className={"csg-step k-" + i.key + (i.ok ? " ok" : "")} title={i.label}>
                  {i.ok ? <Check size={15} /> : <Icon size={15} />}
                </span>
              );
            })}
            <small>
              กรอกแล้ว {done}/{items.length} ข้อ
            </small>
          </div>
        </header>
        <div className="csg-body">
          <label className={"csg-field k-name" + (items[0].ok ? " ok" : "")}>
            <span className="csg-ic"><Building2 size={16} /></span>
            <span className="csg-lbl">ชื่อบริษัท / ชื่อกิจการ *</span>
            <input maxLength={200} placeholder="เช่น บริษัท ตัวอย่าง จำกัด" value={v.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <div className={"csg-field k-taxId" + (items[1].ok ? " ok" : "")}>
            <span className="csg-ic"><IdCard size={16} /></span>
            <span className="csg-lbl">เลขบัตรประชาชน / เลขผู้เสียภาษี หรือ เลขทะเบียนบริษัท *</span>
            <div className="csg-pair">
              <input
                inputMode="numeric"
                maxLength={13}
                aria-label="เลขบัตรประชาชน / เลขผู้เสียภาษี"
                placeholder="เลขบัตรประชาชน / ผู้เสียภาษี 13 หลัก"
                value={v.taxId}
                onChange={(e) => set("taxId", e.target.value.replace(/\D/g, ""))}
              />
              <span className="csg-or">หรือ</span>
              <input aria-label="เลขทะเบียนบริษัท" placeholder="เลขทะเบียนบริษัท" value={v.registration} onChange={(e) => set("registration", e.target.value)} />
            </div>
          </div>
          <label className={"csg-field k-address" + (items[2].ok ? " ok" : "")}>
            <span className="csg-ic"><MapPin size={16} /></span>
            <span className="csg-lbl">ที่อยู่ *</span>
            <textarea rows={2} maxLength={3000} placeholder="เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์" value={v.address} onChange={(e) => set("address", e.target.value)} />
          </label>
          <label className={"csg-field k-phone" + (items[3].ok ? " ok" : "")}>
            <span className="csg-ic"><Phone size={16} /></span>
            <span className="csg-lbl">เบอร์ติดต่อ *</span>
            <input type="tel" maxLength={40} placeholder="เช่น 02-123-4567 หรือ 081-234-5678" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="csg-foot">
          <button
            type="button"
            className="csg-out"
            onClick={async () => {
              await api("/auth/logout", { method: "POST" }).catch(() => {});
              setTabCompany(null);
              window.location.href = "/";
            }}
          >
            <LogOut size={15} /> ออกจากระบบ
          </button>
          <button className="csg-save" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} บันทึกและเริ่มใช้งาน
          </button>
        </footer>
      </form>
    </div>
  );
}
