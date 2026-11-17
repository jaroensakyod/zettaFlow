// The package badge on EliteFlow's own customer list: which package each signed-up company is on right now.
import { planById } from "./billing";

export type CustomerPlan = {
  plan: string;
  status: string;
  end: string | null;
  trialEnd: string | null;
  /** The signed-up company, and whether it has a logo (shown as the customer's picture). */
  company?: string;
  logo?: boolean;
};
/** Where a customer company's logo is served (EliteFlow's own workspace only). */
export const customerLogoUrl = (company: string) => "/api/customer-plans/logo/" + company;
export type PlanBadge = { label: string; tone: string; hint: string };

const short = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });

export function planBadge(p: CustomerPlan | null | undefined, now = Date.now()): PlanBadge | null {
  if (!p) return null;
  const name = planById(p.plan).name;
  if (p.status === "trial")
    return p.trialEnd && Date.parse(p.trialEnd) > now
      ? { label: "ทดลอง " + name, tone: "trial", hint: "ทดลองใช้ถึง " + short(p.trialEnd) }
      : { label: "หมดช่วงทดลอง", tone: "expired", hint: "ยังไม่ได้ซื้อแพ็กเกจ" };
  if (p.plan === "free") return { label: "ฟรี", tone: "free", hint: "แพ็กเกจฟรี · บัญชีและการเงิน" };
  const live = p.status === "active" && (!p.end || Date.parse(p.end) > now);
  if (!live) return { label: name + " · หมดอายุ", tone: "expired", hint: p.end ? "หมดอายุ " + short(p.end) : "หมดอายุ" };
  return { label: name, tone: p.plan, hint: p.end && Date.parse(p.end) < now + 50 * 365 * 86400000 ? "ใช้ได้ถึง " + short(p.end) : "ใช้งานอยู่" };
}
