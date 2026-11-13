// ห้องดีล types and the quotation totals (no server code: the chat page imports this).
export type DealItem = { name: string; qty: number; unit?: string; price?: number; amount?: number };
export type DealParty = { id: string; name: string; taxId: string; address: string; phone: string };
export type DealCard = {
  id: string;
  deal_id: string;
  kind: "request" | "quote";
  rev: number;
  status: "open" | "accepted" | "change" | "rejected" | "superseded" | "withdrawn";
  reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  author_name: string;
  created_at: string;
  mine: boolean;
  data: {
    title: string;
    items: DealItem[];
    notes?: string;
    // request
    needBy?: string | null;
    budget?: number | null;
    // quotation
    docNo?: string;
    subtotal?: number;
    discount?: number;
    vatMode?: "excluded" | "included" | "none";
    vat?: number;
    total?: number;
    validUntil?: string;
    deliverBy?: string | null;
    payTerms?: string;
    buyer?: DealParty;
    seller?: DealParty;
  };
};
export type Deal = {
  id: string;
  title: string;
  stage: "request" | "quote" | "accepted" | "rejected" | "cancelled";
  role: "buyer" | "seller";
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
  updated_at: string;
  /** Seller only: the project and quotation made on acceptance. */
  project_id: string | null;
  quote_id: string | null;
  /** Buyer only: the follow-up task made on acceptance. */
  task_id: string | null;
  cards: DealCard[];
};

/** Totals as the database works them out (for the live preview in the quotation form). */
export function quoteTotals(items: { qty?: number | string; price?: number | string }[], discount: number, vatMode: "excluded" | "included" | "none") {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = r2(items.reduce((s, i) => s + r2((Number(i.qty) || 0) * (Number(i.price) || 0)), 0)),
    net = subtotal - (Number(discount) || 0),
    vat = vatMode === "excluded" ? r2(net * 0.07) : vatMode === "included" ? r2((net * 7) / 107) : 0;
  return { subtotal, net, vat, total: vatMode === "excluded" ? net + vat : net };
}
