// Accounting: AI reads a receipt / tax invoice into an expense draft the user reviews before saving.
import { z } from "zod";
import { extract } from "./ai";
import { assert, canWrite } from "./domain";
import { allEntities } from "./data";
import { download } from "./files";
import { entitled } from "./platform";
import { whtForm } from "./tax";
import { expenseCategories, docTypes, type Line } from "./catalog";
import type { Context, Entity, Template } from "./types";

/** Draft keys the AI may flag as unsure (shown with an orange frame on the review form). */
const flaggable = ["payee", "taxId", "docType", "docNo", "date", "amount", "vatMode", "whtRate", "category", "projectId", "lines"] as const;

function receiptTemplate(projects: string[]): Template {
  return {
    id: "receipt",
    company_id: "",
    name: "ใบเสร็จ / ใบกำกับภาษี (ไทย)",
    department: "Finance",
    version: 2,
    steps: [],
    fields: [
      { key: "vendor", label: "ชื่อผู้ขาย/ร้านค้า", type: "text", required: true },
      { key: "taxId", label: "เลขประจำตัวผู้เสียภาษีของผู้ขาย 13 หลัก", type: "text", required: false },
      { key: "docType", label: "ประเภทเอกสาร (ใบกำกับภาษีเต็มรูปมีชื่อ-ที่อยู่-เลขผู้เสียภาษีของผู้ซื้อ)", type: "choice", required: false, options: [...docTypes] },
      { key: "docNo", label: "เลขที่เอกสาร", type: "text", required: false },
      { key: "date", label: "วันที่เอกสาร (แปลง พ.ศ. เป็น ค.ศ.)", type: "date", required: true },
      { key: "items", label: "สรุปรายการสินค้า/บริการ สั้นๆ", type: "text", required: false },
      { key: "lines", label: 'รายการสินค้าเป็น JSON array เช่น [{"name":"กระดาษ A4","qty":2,"price":120}] ราคาต่อหน่วยตามที่พิมพ์', type: "text", required: false },
      { key: "amount", label: "ยอดรวมสุทธิที่พิมพ์บนเอกสาร (ก่อนหัก ณ ที่จ่าย)", type: "number", required: true },
      { key: "vatMode", label: "VAT: included = ยอดรวม VAT แล้ว, excluded = ยอดยังไม่รวม VAT, none = ไม่มี VAT", type: "choice", required: false, options: ["included", "excluded", "none"] },
      { key: "whtRate", label: "อัตราหัก ณ ที่จ่ายที่ระบุบนเอกสาร (%)", type: "choice", required: false, options: ["0", "1", "2", "3", "5"] },
      { key: "category", label: "หมวดค่าใช้จ่ายที่ใกล้ที่สุด", type: "choice", required: false, options: [...expenseCategories] },
      ...(projects.length
        ? [{ key: "project", label: "โปรเจกต์ที่เอกสารนี้น่าจะเป็นของ (เลือกเมื่อมีหลักฐานบนเอกสารเท่านั้น)", type: "choice" as const, required: false, options: projects }]
        : []),
      { key: "reason", label: "เหตุผลสั้นๆ ภาษาไทยว่าทำไมเลือกหมวด (และโปรเจกต์) นี้", type: "text", required: false },
      { key: "uncertain", label: `คีย์ของช่องที่อ่านไม่ชัดหรือไม่แน่ใจ คั่นด้วย , จาก: ${flaggable.join(",")}`, type: "text", required: false },
    ],
  };
}

const lineSchema = z.array(z.object({ name: z.string().trim().min(1).max(500), qty: z.number().finite().min(0).max(1e9), price: z.number().finite().min(-1e12).max(1e12) })).max(100);
function parseLines(raw: unknown): Line[] {
  try {
    return lineSchema.parse(JSON.parse(String(raw || "[]")));
  } catch {
    return [];
  }
}
const digits = (s: unknown) => String(s || "").replace(/\D/g, "");
/** Same supplier: identical 13-digit tax id, else one name contains the other (first 12 characters). */
export function matchSupplier(suppliers: Entity[], vendor: string, taxId: string) {
  const name = vendor.trim().toLowerCase().slice(0, 12);
  return (
    (taxId.length === 13 && suppliers.find((s) => digits(s.data.taxId) === taxId)) ||
    (name && suppliers.find((s) => String(s.data.name || "").toLowerCase().includes(name))) ||
    undefined
  );
}

/** Returns an expense draft (catalog `expenses` keys), why the AI chose its category, and which fields it is unsure of. */
export async function readReceipt(ctx: Context, input: unknown) {
  const { attachmentId } = z.object({ attachmentId: z.uuid() }).parse(input);
  assert(canWrite(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  const [{ file, bytes }, projects, suppliers] = await Promise.all([
    download(ctx, attachmentId),
    allEntities(ctx, "projects", 500).then((rows) => rows.filter((p) => !["completed", "cancelled"].includes(String(p.data.status)))),
    allEntities(ctx, "suppliers", 2000),
  ]);
  const projectNames = [...new Set(projects.map((p) => String(p.data.name || "")).filter(Boolean))].slice(0, 50);
  const r = await extract(receiptTemplate(projectNames), "Read this Thai receipt / tax invoice.", { mime: file.mime, name: file.name, bytes }, { precise: await entitled(ctx, "ocr_plus") });
  const v = r.values as Record<string, string | number | null>;
  const taxId = digits(v.taxId);
  const supplier = matchSupplier(suppliers, String(v.vendor || ""), taxId);
  const project = projects.find((p) => p.data.name === v.project);
  const uncertain = String(v.uncertain || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is (typeof flaggable)[number] => (flaggable as readonly string[]).includes(s));
  return {
    draft: {
      name: [v.vendor, v.items].filter(Boolean).join(" · ").slice(0, 200),
      payee: v.vendor || "",
      supplierId: supplier?.id || "",
      taxId: taxId || digits(supplier?.data.taxId),
      docType: v.docType || "",
      docNo: v.docNo || "",
      date: v.date || "",
      lines: parseLines(v.lines),
      amount: v.amount ?? "",
      vatMode: v.vatMode || "none",
      whtRate: v.whtRate || "0",
      category: v.category || "อื่นๆ",
      projectId: project?.id || "",
      status: "pending",
    },
    supplierCode: String(supplier?.data.code || ""),
    reason: String(v.reason || ""),
    uncertain: [...new Set([...uncertain, ...(r.missing.length ? (["amount", "date"] as const).filter((k) => !v[k]) : [])])],
    whtForm: whtForm(taxId, Number(v.whtRate) || 0),
    missing: r.missing,
    engine: r.engine,
  };
}
