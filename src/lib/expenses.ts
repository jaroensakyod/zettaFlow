// Accounting: AI reads a receipt / tax invoice into an expense draft the user reviews before saving.
import { z } from "zod";
import { extract } from "./ai";
import { assert, canRead, canWrite } from "./domain";
import { demoRead } from "./demo";
import { dbError } from "./data";
import { supabaseServer } from "./supabase/server";
import { download } from "./files";
import { entitled } from "./platform";
import { whtForm, expenseSummary } from "./tax";
import type { Context, Template } from "./types";

const receipt: Template = {
  id: "receipt",
  company_id: "",
  name: "ใบเสร็จ / ใบกำกับภาษี (ไทย)",
  department: "Finance",
  version: 1,
  steps: [],
  fields: [
    { key: "vendor", label: "ชื่อผู้ขาย/ร้านค้า", type: "text", required: true },
    { key: "taxId", label: "เลขประจำตัวผู้เสียภาษีของผู้ขาย 13 หลัก", type: "text", required: false },
    { key: "docType", label: "ประเภทเอกสาร", type: "choice", required: false, options: ["ใบกำกับภาษี", "บิลเงินสด", "ใบเสร็จ", "ใบแจ้งหนี้"] },
    { key: "docNo", label: "เลขที่เอกสาร", type: "text", required: false },
    { key: "date", label: "วันที่เอกสาร (แปลง พ.ศ. เป็น ค.ศ.)", type: "date", required: true },
    { key: "items", label: "สรุปรายการสินค้า/บริการ สั้นๆ", type: "text", required: false },
    { key: "amount", label: "ยอดรวมสุทธิที่พิมพ์บนเอกสาร (ก่อนหัก ณ ที่จ่าย)", type: "number", required: true },
    { key: "vatMode", label: "VAT: included = ยอดรวม VAT แล้ว, excluded = ยอดยังไม่รวม VAT, none = ไม่มี VAT", type: "choice", required: false, options: ["included", "excluded", "none"] },
    { key: "whtRate", label: "อัตราหัก ณ ที่จ่ายที่ระบุบนเอกสาร (%)", type: "choice", required: false, options: ["0", "1", "2", "3", "5"] },
    { key: "category", label: "หมวดหมู่ที่ใกล้ที่สุด", type: "choice", required: false, options: ["ค่ามัดจำ", "ค่าเช่า", "ค่าไฟฟ้า", "ค่าบริการ", "ค่าพรม", "บุคลากร", "จัดซื้อ", "ขนส่ง", "การตลาด", "อื่นๆ"] },
  ],
};

/** Returns an expense draft (catalog `expenses` keys) plus what the AI could not read. */
export async function readReceipt(ctx: Context, input: unknown) {
  const { attachmentId } = z.object({ attachmentId: z.uuid() }).parse(input);
  assert(canWrite(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  const { file, bytes } = await download(ctx, attachmentId);
  const r = await extract(receipt, "Read this Thai receipt / tax invoice.", { mime: file.mime, name: file.name, bytes }, { precise: await entitled(ctx, "ocr_plus") });
  const v = r.values as Record<string, string | number | null>;
  const taxId = v.taxId ? String(v.taxId).replace(/\D/g, "") : "";
  return {
    draft: {
      name: [v.vendor, v.items].filter(Boolean).join(" · ").slice(0, 200),
      payee: v.vendor || "",
      taxId,
      docType: v.docType || "",
      docNo: v.docNo || "",
      date: v.date || "",
      amount: v.amount ?? "",
      vatMode: v.vatMode || "none",
      whtRate: v.whtRate || "0",
      category: v.category || "อื่นๆ",
      status: "pending",
    },
    whtForm: whtForm(taxId, Number(v.whtRate) || 0),
    missing: r.missing,
    engine: r.engine,
  };
}

/** Summary cards for the expense page: this month's spend, claimable input VAT, WHT to remit, items waiting review. */
export async function expenseOverview(ctx: Context) {
  assert(canRead(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  const month = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
  let rows: { data: Record<string, unknown> }[];
  if (ctx.demo) rows = (await demoRead()).entities.filter((e) => e.kind === "expenses" && !e.archived_at);
  else {
    const sb = await supabaseServer();
    const { data, error } = await sb
      .from("entities")
      .select("data")
      .eq("company_id", ctx.company.id)
      .eq("kind", "expenses")
      .is("archived_at", null)
      .or(`data->>date.like.${month}%,data->>status.eq.pending`)
      .limit(5000);
    dbError(error);
    rows = data || [];
  }
  return { month, ...expenseSummary(rows, month) };
}
