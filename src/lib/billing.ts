// ZettaFlow AI subscription catalogue (deck slide 29). Prices exclude VAT 7%.
export type PlanId = "starter" | "growth" | "enterprise";
export type Plan = {
  id: PlanId;
  name: string;
  monthly: number;
  yearly: number;
  workflows: number | null;
  documents: number | null;
  line_groups: number | null;
  users: number | null;
  support: string;
  api: string;
};
export const plans: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthly: 1190,
    yearly: 11900,
    workflows: 5,
    documents: 1000,
    line_groups: 2,
    users: 2,
    support: "Email",
    api: "—",
  },
  {
    id: "growth",
    name: "Growth",
    monthly: 3490,
    yearly: 34900,
    workflows: 20,
    documents: 4000,
    line_groups: 10,
    users: 10,
    support: "Priority",
    api: "Optional",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthly: 8900,
    yearly: 89000,
    workflows: null,
    documents: null,
    line_groups: null,
    users: null,
    support: "Dedicated",
    api: "Yes",
  },
];
export const addons = [
  { id: "ocr_plus", name: "AI OCR Plus", price: 599, unit: "เดือน" },
  { id: "exec_dashboard", name: "Executive Dashboard + AI Insight", price: 990, unit: "เดือน" },
  { id: "extra_user", name: "Additional Dashboard User", price: 150, unit: "ผู้ใช้/เดือน" },
  { id: "erp", name: "ERP / Accounting Integration", price: 1000, unit: "เดือน" },
  { id: "custom_workflow", name: "AI Custom Workflow", price: 3000, unit: "เดือน" },
  { id: "custom_form", name: "AI Custom Form Designer", price: 2500, unit: "เดือน" },
];
export const overageRates = { documents: 1, ocr: 1.5, ai_runs: 2 };
export const VAT = 0.07;
export type Usage = {
  workflows: number;
  documents: number;
  ocr: number;
  ai_runs: number;
  line_groups: number;
  users: number;
};
export type Subscription = {
  plan: PlanId;
  cycle: "monthly" | "yearly";
  status: "trial" | "active" | "past_due" | "cancelled";
  trial_ends_at: string;
  current_period_end: string | null;
  addons: string[];
  extra_users: number;
};
export function planById(id: string) {
  return plans.find((p) => p.id === id) || plans[1];
}
/** Price of a plan for a billing cycle, including VAT, rounded to satang. */
export function planPrice(id: string, cycle: "monthly" | "yearly") {
  const p = planById(id);
  const base = cycle === "yearly" ? p.yearly : p.monthly;
  return { base, vat: round(base * VAT), total: round(base * (1 + VAT)) };
}
const round = (n: number) => Math.round(n * 100) / 100;
/**
 * Overage for the current month. Documents above the plan quota are billed
 * per document; image OCR and AI analysis runs are billed only beyond the
 * document quota as well (the system never blocks, it bills next cycle).
 */
export function overage(planId: string, usage: Usage) {
  const p = planById(planId);
  if (p.documents === null) return { documents: 0, ocr: 0, ai_runs: 0, total: 0 };
  const over = Math.max(0, usage.documents - p.documents);
  const share = usage.documents ? over / usage.documents : 0;
  const ocr = Math.round(usage.ocr * share),
    ai = Math.round(usage.ai_runs * share);
  const lines = {
    documents: round(over * overageRates.documents),
    ocr: round(ocr * overageRates.ocr),
    ai_runs: round(ai * overageRates.ai_runs),
  };
  return { ...lines, total: round(lines.documents + lines.ocr + lines.ai_runs) };
}
export function subscriptionActive(s: Subscription, now = Date.now()) {
  if (s.status === "trial") return Date.parse(s.trial_ends_at) > now;
  if (s.status !== "active") return false;
  return (
    !s.current_period_end ||
    Date.parse(s.current_period_end) > now - 3 * 86400000
  );
}
export function trialDaysLeft(s: Subscription, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(s.trial_ends_at) - now) / 86400000));
}
