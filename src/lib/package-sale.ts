// A paid package is booked on both sides once it is verified (automatically from the slip, or by the platform team):
//  • the platform company (EliteFlow's own workspace) gets the customer, an invoice and the payment received, with the
//    package, the dates paid / started / ending in the details;
//  • the buying company gets the expense (ค่าแพ็กเกจ EliteFlow, paid, with the slip as its receipt);
//  • the buyer gets the invoice and receipt as links (sent in LINE when the payment came from LINE).
// Each record is saved as that company's owner (save_entity_as), so every normal rule applies. Never blocks activation.
import { supabaseAdmin } from "./supabase/server";
import { planById } from "./billing";
import { shareUrl } from "./share-link";
import { validateEntity } from "./domain";

/** EliteFlow's own company (eliteflowofficials@gmail.com), where sales are booked. */
export const platformCompanyId = () => process.env.PLATFORM_COMPANY_ID || "c6990704-26d6-4b1e-8c1c-6a5c5dff083d";

export type SaleRecords = {
  invoiceNo: string;
  receiptNo: string;
  paidAt: string;
  start: string;
  end: string;
  customerId?: string;
  invoiceId?: string;
  paymentId?: string;
  expenseId?: string;
  errors?: string[];
};
type Payment = { id: string; company_id: string; plan: string; cycle: "monthly" | "yearly"; amount: number; slip_ref: string | null; attachment_id: string | null; decided_at: string | null; created_at: string; records?: SaleRecords | null };

const bkk = (d: Date) => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const thaiDate = (iso: string) => new Date(iso + "T00:00:00+07:00").toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
/** INV-EF-6911-3f2a9c / RC-EF-6911-3f2a9c: year+month (พ.ศ.) and the payment's id, so each number is unique. */
export function saleNumbers(paymentId: string, paidAt: string) {
  const d = new Date(paidAt + "T00:00:00+07:00");
  const ym = String((d.getFullYear() + 543) % 100).padStart(2, "0") + String(d.getMonth() + 1).padStart(2, "0");
  const tail = paymentId.replace(/-/g, "").slice(0, 6).toUpperCase();
  return { invoiceNo: `INV-EF-${ym}-${tail}`, receiptNo: `RC-EF-${ym}-${tail}` };
}
/** The period the payment pays for: it ends at the subscription's new end; starts one month / year before. */
export function salePeriod(cycle: "monthly" | "yearly", end: string | null, paidAt: string) {
  const e = end ? new Date(end) : null;
  if (!e || Number.isNaN(e.getTime())) return { start: paidAt, end: paidAt };
  const s = new Date(e);
  if (cycle === "yearly") s.setFullYear(s.getFullYear() - 1);
  else s.setMonth(s.getMonth() - 1);
  return { start: bkk(s), end: bkk(e) };
}
export function saleDetails(p: { plan: string; cycle: "monthly" | "yearly" }, buyer: string, r: Pick<SaleRecords, "paidAt" | "start" | "end">, ref?: string | null) {
  const plan = planById(p.plan);
  return [
    `แพ็กเกจ EliteFlow ${plan.name} (${p.cycle === "yearly" ? "รายปี" : "รายเดือน"})`,
    `ลูกค้า: ${buyer}`,
    `ชำระเมื่อ: ${thaiDate(r.paidAt)}`,
    `เริ่มใช้: ${thaiDate(r.start)}`,
    `สิ้นสุด: ${thaiDate(r.end)}`,
    ref ? `เลขอ้างอิงสลิป: ${ref}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
/** What was paid (VAT included, add-ons too) split into the amount before VAT and the VAT, as an invoice holds it. */
export function saleAmounts(paid: number) {
  const base = Math.round((paid / 1.07) * 100) / 100,
    total = Math.round(base * 107) / 100;
  return { base, vat: Math.round((total - base) * 100) / 100, total };
}
/** Signed links to the buyer's invoice and receipt for this payment. */
export function saleDocLinks(paymentId: string) {
  return { invoice: shareUrl({ k: "pay", id: paymentId, d: "inv" }, 365), receipt: shareUrl({ k: "pay", id: paymentId, d: "rc" }, 365) };
}

async function ownerOf(sb: ReturnType<typeof supabaseAdmin>, companyId: string) {
  const { data } = await sb.from("memberships").select("user_id").eq("company_id", companyId).eq("role", "owner").eq("disabled", false).limit(1).maybeSingle();
  return (data?.user_id as string | undefined) || null;
}
async function saveAs(sb: ReturnType<typeof supabaseAdmin>, user: string, company: string, kind: string, data: Record<string, unknown>) {
  const { data: row, error } = await sb.rpc("save_entity_as", { p_user: user, p_company: company, p_kind: kind, p_data: validateEntity(kind, data) });
  if (error) throw new Error(kind + ": " + error.message);
  return row as { id: string };
}

/** Book a verified package payment (once). Returns what was recorded; problems are kept in `errors`, never thrown. */
export async function recordPackageSale(paymentId: string): Promise<SaleRecords | null> {
  const sb = supabaseAdmin();
  const { data: pay } = await sb.from("billing_payments").select("*").eq("id", paymentId).maybeSingle();
  const p = pay as Payment | null;
  if (!p) return null;
  if (p.records?.invoiceNo) return p.records;
  const [{ data: buyer }, { data: sub }] = await Promise.all([
    sb.from("companies").select("id, name, profile").eq("id", p.company_id).maybeSingle(),
    sb.from("subscriptions").select("current_period_end").eq("company_id", p.company_id).maybeSingle(),
  ]);
  const paidAt = bkk(new Date(p.decided_at || p.created_at));
  const period = salePeriod(p.cycle, (sub?.current_period_end as string | null) || null, paidAt);
  const rec: SaleRecords = { ...saleNumbers(p.id, paidAt), paidAt, ...period, errors: [] };
  const buyerName = String(buyer?.name || "ลูกค้า");
  const profile = (buyer?.profile || {}) as Record<string, unknown>;
  const details = saleDetails(p, buyerName, rec, p.slip_ref);
  const price = saleAmounts(Number(p.amount));
  const planName = planById(p.plan).name + (p.cycle === "yearly" ? " รายปี" : " รายเดือน");
  const platform = platformCompanyId();

  // 1) The platform's books: customer, invoice, payment received.
  if (p.company_id !== platform) {
    try {
      const owner = await ownerOf(sb, platform);
      if (!owner) throw new Error("ไม่พบเจ้าของบริษัท EliteFlow");
      // The customer EliteFlow added when this company signed up (0078); made now if it is missing.
      const { data: linked } = await sb.rpc("add_platform_customer", { p_company: p.company_id });
      rec.customerId =
        (linked as string | null) ||
        (
          await saveAs(sb, owner, platform, "customers", {
            name: buyerName,
            type: "นิติบุคคล",
            ...(profile.taxId ? { taxId: String(profile.taxId).slice(0, 20) } : {}),
            status: "active",
            notes: "ลูกค้าแพ็กเกจ EliteFlow",
          })
        ).id;
      rec.invoiceId = (
        await saveAs(sb, owner, platform, "invoices", {
          name: rec.invoiceNo,
          customerId: rec.customerId,
          date: paidAt,
          dueDate: paidAt,
          subtotal: price.base,
          vat: 7,
          description: details,
        })
      ).id;
      rec.paymentId = (
        await saveAs(sb, owner, platform, "payments", {
          name: `รับชำระแพ็กเกจ ${planName} · ${buyerName}`,
          invoiceId: rec.invoiceId,
          customerId: rec.customerId,
          direction: "income",
          date: paidAt,
          amount: price.total,
          method: "โอนธนาคาร",
          ...(p.slip_ref ? { reference: p.slip_ref } : {}),
          notes: details,
        })
      ).id;
    } catch (e) {
      rec.errors!.push("EliteFlow: " + (e as Error).message);
    }
  }
  // 2) The buyer's expense, paid, with the slip as its receipt.
  try {
    const owner = await ownerOf(sb, p.company_id);
    if (!owner) throw new Error("ไม่พบเจ้าของบริษัทลูกค้า");
    rec.expenseId = (
      await saveAs(sb, owner, p.company_id, "expenses", {
        name: `ค่าแพ็กเกจ EliteFlow ${planName}`,
        category: "โปรแกรม/ซอฟท์แวร์/แอพลิเคชั่น",
        payee: "EliteFlow",
        docType: "ใบเสร็จ",
        docNo: rec.receiptNo,
        date: paidAt,
        amount: price.total,
        vatMode: "included",
        payStatus: "โอนแล้ว",
        status: "paid",
        ...(p.attachment_id ? { receiptId: p.attachment_id } : {}),
        notes: details,
      })
    ).id;
  } catch (e) {
    rec.errors!.push("ลูกค้า: " + (e as Error).message);
  }
  if (!rec.errors!.length) delete rec.errors;
  await sb.from("billing_payments").update({ records: rec }).eq("id", p.id);
  return rec;
}
