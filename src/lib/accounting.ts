// ระบบบัญชี: reviewed expenses become balanced journal entries (Dr expense / input VAT, Cr bank / petty cash / payables / WHT),
// withholding gets a numbered 50 ทวิ, and the page summary feeds ภ.พ.30 and the project budget bars.
import { z } from "zod";
import { assert, canRead, canWrite } from "./domain";
import { demoMutate, demoRead, demoAudit, type DemoState } from "./demo";
import { allEntities, dbError, saveEntity } from "./data";
import { supabaseServer } from "./supabase/server";
import { expenseSummary } from "./tax";
import { buildJournal, defaultAccounts, type Account, type CostCenter, type JournalLine, type WhtCertificate } from "./ledger";
import { readReceipt } from "./expenses";
import type { Context, Entity } from "./types";

async function finance(ctx: Context, write = false) {
  assert((write ? canWrite : canRead)(ctx, "Finance"), "ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
}
const demoBooks = (s: DemoState) => (s.accounting ||= { journals: [], wht: [], counters: {} });

export async function chart(ctx: Context): Promise<{ accounts: Account[]; costCenters: CostCenter[] }> {
  await finance(ctx);
  if (ctx.demo) return { accounts: defaultAccounts, costCenters: [{ code: "HQ", name: "สำนักงานใหญ่", kind: "branch" }] };
  const sb = await supabaseServer();
  const [a, c] = await Promise.all([
    sb.from("accounts").select("code,name,type,category").eq("company_id", ctx.company.id).order("code"),
    sb.from("cost_centers").select("code,name,kind").eq("company_id", ctx.company.id).order("code"),
  ]);
  dbError(a.error);
  dbError(c.error);
  return { accounts: a.data?.length ? a.data : defaultAccounts, costCenters: c.data || [] };
}

/** Everything the accounting page needs in one call: cards, receipt list, project budgets, chart of accounts. */
export async function accountingOverview(ctx: Context) {
  await finance(ctx);
  const month = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
  const [expenses, projects, books] = await Promise.all([allEntities(ctx, "expenses", 5000), allEntities(ctx, "projects", 500), chart(ctx)]);
  const s = expenseSummary(expenses, month);
  return {
    month,
    total: s.total,
    vat: s.vat,
    wht: s.wht,
    pending: s.pending,
    expenses: expenses.slice(0, 300),
    projects: projects
      .filter((p) => s.byProject[p.id] || Number(p.data.budget) > 0)
      .map((p) => ({ id: p.id, name: String(p.data.name || ""), budget: Number(p.data.budget) || 0, spent: s.byProject[p.id] || 0 })),
    ...books,
  };
}

/** Posts a reviewed expense: journal + 50 ทวิ (when there is withholding), and marks it บันทึกแล้ว. */
export async function postExpense(ctx: Context, id: string) {
  await finance(ctx, true);
  const { accounts } = await chart(ctx);
  if (ctx.demo)
    return demoMutate((s) => {
      const e = s.entities.find((x) => x.id === id && x.kind === "expenses" && !x.archived_at);
      assert(e, "ไม่พบรายการค่าใช้จ่าย", 404);
      const j = buildJournal(e.data, accounts);
      assert(j.balanced, "เดบิตและเครดิตไม่เท่ากัน");
      const books = demoBooks(s);
      books.journals = books.journals.filter((x) => x.entity_id !== id);
      books.journals.push({ entity_id: id, date: String(e.data.date), lines: j.lines });
      const old = books.wht.find((w) => w.entity_id === id);
      books.wht = books.wht.filter((w) => w.entity_id !== id);
      if (j.wht) {
        const year = Number(String(e.data.date).slice(0, 4)) + 543,
          key = "WHT" + year;
        books.wht.push({
          entity_id: id,
          year,
          seq: old?.seq || (books.counters[key] = (books.counters[key] || 0) + 1),
          form: j.wht.form,
          payee: j.wht.payee || "-",
          tax_id: j.wht.taxId,
          base: j.wht.base,
          rate: j.wht.rate,
          amount: j.wht.amount,
          paid_on: String(e.data.date),
        });
      }
      e.data.reviewStatus = "บันทึกแล้ว";
      e.version++;
      e.updated_at = new Date().toISOString();
      demoAudit(s, "expense_posted", id);
      return { lines: j.lines };
    });
  const sb = await supabaseServer();
  const { data: e, error } = await sb.from("entities").select("*").eq("company_id", ctx.company.id).eq("id", id).single();
  dbError(error);
  const j = buildJournal((e as Entity).data, accounts);
  assert(j.balanced, "เดบิตและเครดิตไม่เท่ากัน");
  const r = await sb.rpc("post_expense", { p_company: ctx.company.id, p_entity: id, p_lines: j.lines, p_wht: j.wht });
  dbError(r.error);
  return { lines: j.lines };
}

/** The posted entry and 50 ทวิ of one expense (empty while it still waits for review). */
export async function expenseBooks(ctx: Context, id: string): Promise<{ lines: JournalLine[]; wht: WhtCertificate | null }> {
  await finance(ctx);
  if (ctx.demo) {
    const books = (await demoRead()).accounting;
    return {
      lines: books?.journals.find((j) => j.entity_id === id)?.lines || [],
      wht: books?.wht.find((w) => w.entity_id === id) || null,
    };
  }
  const sb = await supabaseServer();
  const { data: entry, error } = await sb
    .from("journal_entries")
    .select("id,journal_lines(account_code,debit,credit,project_id,cost_center)")
    .eq("company_id", ctx.company.id)
    .eq("entity_id", id)
    .maybeSingle();
  dbError(error);
  const { data: wht, error: e } = await sb.from("wht_certificates").select("*").eq("company_id", ctx.company.id).eq("entity_id", id).maybeSingle();
  dbError(e);
  type Row = { account_code: string; debit: number; credit: number; project_id: string | null; cost_center: string | null };
  return {
    lines: ((entry?.journal_lines || []) as Row[]).map((l) => ({
      account: l.account_code,
      debit: Number(l.debit),
      credit: Number(l.credit),
      projectId: l.project_id || undefined,
      costCenter: l.cost_center || undefined,
    })),
    wht: wht ? { ...wht, base: Number(wht.base), rate: Number(wht.rate), amount: Number(wht.amount) } : null,
  };
}

/**
 * Receipt in → AI reads it → a pending expense (รอตรวจ) that keeps the uploaded file. Used for drag-and-drop
 * batches and for receipts sent to น้องโฟลว์. If the AI cannot read the file the record still lands, marked for manual entry.
 */
export async function importReceipt(ctx: Context, input: unknown) {
  await finance(ctx, true);
  const { attachmentId } = z.object({ attachmentId: z.uuid() }).parse(input);
  let read: Awaited<ReturnType<typeof readReceipt>> | null = null,
    failure = "";
  try {
    read = await readReceipt(ctx, { attachmentId });
  } catch (e) {
    failure = (e as Error).message;
  }
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const draft: Record<string, unknown> = {
    name: "ใบเสร็จรอกรอกข้อมูล",
    category: "อื่นๆ",
    date: today,
    amount: 0,
    vatMode: "none",
    whtRate: "0",
    payStatus: "ยังไม่จ่าย",
    status: "pending",
    ...read?.draft,
    receiptId: attachmentId,
    reviewStatus: "รอตรวจ",
    aiNotes: read ? read.reason : "AI อ่านไม่สำเร็จ: " + failure + " — กรุณากรอกเอง",
    aiUncertain: read ? read.uncertain.join(",") : "",
  };
  for (const k of Object.keys(draft)) if (draft[k] === "" || draft[k] === null) delete draft[k];
  if (!draft.name) draft.name = "ใบเสร็จรอกรอกข้อมูล";
  if (!draft.date) draft.date = today;
  if (draft.amount === undefined) draft.amount = 0;
  const entity = await saveEntity(ctx, "expenses", draft);
  await linkAttachment(ctx, attachmentId, entity.id);
  return { entity, engine: read?.engine || "manual", error: failure };
}

export async function linkAttachment(ctx: Context, attachmentId: string, entityId: string) {
  if (ctx.demo)
    return demoMutate((s) => {
      const a = s.attachments.find((x) => x.id === attachmentId);
      if (a && !a.entity_id) a.entity_id = entityId;
    });
  const sb = await supabaseServer();
  const { error } = await sb.rpc("link_attachment", { p_company: ctx.company.id, p_attachment: attachmentId, p_entity: entityId });
  dbError(error);
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Printable หนังสือรับรองการหักภาษี ณ ที่จ่าย (มาตรา 50 ทวิ) — the browser prints or saves it as PDF. */
export async function whtCertificateHtml(ctx: Context, id: string) {
  const { wht } = await expenseBooks(ctx, id);
  assert(wht, "รายการนี้ไม่มีหัก ณ ที่จ่าย หรือยังไม่ได้บันทึก", 404);
  const p = ctx.company.profile as Record<string, string>;
  const no = `${wht.year}/${String(wht.seq).padStart(4, "0")}`;
  const date = new Date(wht.paid_on + "T00:00:00Z").toLocaleDateString("th-TH", { dateStyle: "long", timeZone: "UTC" });
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>50 ทวิ ${esc(no)}</title><style>
body{font-family:"Sarabun","Noto Sans Thai",sans-serif;color:#111;background:#fff;margin:0;padding:32px;max-width:820px;margin:auto}
h1{font-size:20px;text-align:center;margin:0 0 4px}p.sub{text-align:center;margin:0 0 24px;color:#444}
section{border:1px solid #333;padding:12px 16px;margin-bottom:12px}h2{font-size:15px;margin:0 0 8px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:6px 8px;text-align:left}td.n{text-align:right}
.meta{display:flex;justify-content:space-between;margin-bottom:12px}.sign{margin-top:40px;text-align:right}
@media print{button{display:none}body{padding:0}}</style></head><body>
<button onclick="print()">พิมพ์ / บันทึกเป็น PDF</button>
<h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1><p class="sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>
<div class="meta"><span>เล่มที่/เลขที่ ${esc(no)}</span><span>แบบ ${esc(wht.form)}</span></div>
<section><h2>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</h2>${esc(ctx.company.name)}<br>เลขประจำตัวผู้เสียภาษี ${esc(p.taxId || "-")}<br>${esc(p.address || "")}</section>
<section><h2>ผู้ถูกหักภาษี ณ ที่จ่าย</h2>${esc(wht.payee)}<br>เลขประจำตัวผู้เสียภาษี ${esc(wht.tax_id || "-")}</section>
<table><thead><tr><th>ประเภทเงินได้ที่จ่าย</th><th>วันที่จ่าย</th><th>จำนวนเงินที่จ่าย</th><th>ภาษีที่หักและนำส่ง</th></tr></thead>
<tbody><tr><td>ค่าบริการ / ค่าจ้าง (อัตรา ${esc(wht.rate)}%)</td><td>${esc(date)}</td><td class="n">${baht(wht.base)}</td><td class="n">${baht(wht.amount)}</td></tr></tbody></table>
<p>ผู้จ่ายเงิน: หัก ณ ที่จ่าย</p>
<p class="sign">ลงชื่อ ....................................... ผู้จ่ายเงิน<br>วันที่ ${esc(date)}</p>
</body></html>`;
}
