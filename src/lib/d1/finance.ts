// The finance functions for D1, step for step after the Postgres functions (schema.sql): finance_manager,
// finance_close_step, finance_save_budgets, finance_save_targets, goal_set, post_expense, issue_document,
// document_number, issued_documents_list, seed_accounts and the companies_seed_accounts trigger.
// Postgres casts and constraints that decide an outcome (numeric/uuid casts, NOT NULL and CHECK constraints) are
// checked here first with the exact Postgres error text, so a refusal reads the same on both databases. Amounts are
// summed as exact decimals (Postgres numeric), never as floats.
import { randomUUID } from "node:crypto";
import { AppError, formatCode, thaiYear } from "../domain";
import { canReadDept, canWriteDept } from "./access";
import { codePrefix } from "./entities";
import type { Stmt } from "./driver";
import type { Tenant } from "./tenant";
import type { Entity } from "../types";

type Data = Record<string, unknown>;
const fail = (message: string, status = 400): never => {
  throw new AppError(message, status);
};
const audit = (t: Tenant, action: string, target: string) => t.insertStmt("audit_events", { actor: t.viewer.userId, action, target });
/** member_role(c): a support viewer who is not a member counts as 'viewer'. */
const memberRole = (t: Tenant) => (t.viewer.support ? "viewer" : t.viewer.role);
/** The calendar date in Asia/Bangkok of an ISO timestamp (to_char(x at time zone 'Asia/Bangkok','YYYY-MM-DD')). */
const bangkokDate = (iso: string) => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);

// ---------- Postgres casts, as far as these functions use them ----------
/** jsonb ->> key: the value as text, or null (also when the container is not an object). */
function jtext(o: unknown, key: string): string | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const v = (o as Data)[key];
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return pgJson(v);
}
/** jsonb text output: ", " and ": " separators, object keys shortest first. */
function pgJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(pgJson).join(", ") + "]";
  const keys = Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return "{" + keys.map((k) => JSON.stringify(k) + ": " + pgJson((v as Data)[k])).join(", ") + "}";
}
/** An exact decimal: value = i / 10^s. */
type Dec = { i: bigint; s: number };
const ZERO: Dec = { i: BigInt(0), s: 0 };
/** text::numeric */
function numeric(text: string): Dec {
  const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?\s*$/i.exec(text);
  if (!m || (!m[2] && !m[3])) fail(`invalid input syntax for type numeric: "${text}"`);
  const [, sign, int, frac = "", exp = "0"] = m!;
  let s = frac.length - Number(exp),
    digits = (int || "0") + frac;
  if (s < 0) (digits += "0".repeat(-s)), (s = 0);
  const i = BigInt(digits);
  return { i: sign === "-" ? -i : i, s };
}
const align = (a: Dec, b: Dec): [bigint, bigint] => {
  const s = Math.max(a.s, b.s),
    ten = BigInt(10);
  return [a.i * ten ** BigInt(s - a.s), b.i * ten ** BigInt(s - b.s)];
};
const add = (a: Dec, b: Dec): Dec => {
  const [x, y] = align(a, b);
  return { i: x + y, s: Math.max(a.s, b.s) };
};
const cmp = (a: Dec, b: Dec) => {
  const [x, y] = align(a, b);
  return x === y ? 0 : x < y ? -1 : 1;
};
const decNumber = (d: Dec) => Number(d.i) / 10 ** d.s;
/** (text)::numeric of a nullable text. */
const numOrNull = (text: string | null) => (text === null ? null : decNumber(numeric(text)));
/** text::uuid */
function uuid(text: string): string {
  const hex = text.replace(/^\{(.*)\}$/, "$1");
  if (!/^[0-9a-f]{4}(-?[0-9a-f]{4}){7}$/i.test(hex) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hex)) fail(`invalid input syntax for type uuid: "${text}"`);
  const h = hex.replace(/-/g, "").toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** text::date (the ISO forms this app writes). */
function date(text: string): string {
  const m = /^\s*(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!m || Number.isNaN(Date.parse(m[1])) || new Date(m[1]).toISOString().slice(0, 10) !== m[1]) fail(`invalid input syntax for type date: "${text}"`);
  return m![1];
}
const notNull = (table: string, column: string, v: unknown) => {
  if (v === null || v === undefined) fail(`null value in column "${column}" of relation "${table}" violates not-null constraint`);
};
const check = (table: string, name: string, ok: boolean) => {
  if (!ok) fail(`new row for relation "${table}" violates check constraint "${name}"`);
};

// ---------- planning ----------
/** finance_manager(c): owners and managers who can see Finance. */
export function financeManager(t: Tenant): boolean {
  return ["owner", "manager"].includes(memberRole(t)) && canReadDept(t.viewer, "Finance");
}

/** finance_close_step(): tick (or reopen) one of the five year-end closing steps, strictly in order. */
export async function financeCloseStep(t: Tenant, year: number, step: number, done: boolean): Promise<void> {
  if (!financeManager(t)) fail("ไม่มีสิทธิ์ปิดงบประจำปี", 403);
  if (!(year >= 2000 && year <= 2200) || !(step >= 1 && step <= 5)) fail("ขั้นตอนไม่ถูกต้อง");
  const stmts: Stmt[] = [];
  if (done) {
    if (step > 1 && !(await t.selectInternal("finance_closing", { where: { fiscal_year: year, step: step - 1 }, limit: 1 })).length) fail("ต้องทำขั้นตอนก่อนหน้าให้เสร็จก่อน");
    if (step > 1) stmts.push(t.guardStmt("finance_closing", { fiscal_year: year, step: step - 1 }));
    stmts.push(t.upsertStmt("finance_closing", { fiscal_year: year, step, done_by: t.viewer.userId, done_at: new Date().toISOString() }, ["company_id", "fiscal_year", "step"], []));
  } else {
    if ((await t.selectInternal("finance_closing", { where: { fiscal_year: year, step: step + 1 }, limit: 1 })).length) fail("ต้องเปิดขั้นตอนถัดไปก่อน");
    stmts.push(t.deleteStmt("finance_closing", { fiscal_year: year, step }));
  }
  stmts.push(audit(t, done ? "finance_step_done" : "finance_step_reopened", `${year}/${step}`));
  await t.atomic(stmts);
}

/**
 * finance_save_budgets(): the whole budget plan of a year, { department: amount }. Departments left out are removed.
 * Like Postgres, a null plan passes the checks (every test on it is null) and changes nothing but the log.
 */
export async function financeSaveBudgets(t: Tenant, year: number, budgets: unknown): Promise<void> {
  if (!financeManager(t)) fail("ไม่มีสิทธิ์วางแผนงบประมาณ", 403);
  if (!(year >= 2000 && year <= 2200)) fail("ปีบัญชีไม่ถูกต้อง");
  const isNull = budgets === null || budgets === undefined;
  if (!isNull) {
    const ok =
      typeof budgets === "object" &&
      !Array.isArray(budgets) &&
      Object.keys(budgets as Data).length <= 40 &&
      Object.entries(budgets as Data).every(([k, v]) => {
        const len = Array.from(k).length;
        return len >= 1 && len <= 60 && typeof v === "number" && v >= 0 && v <= 1e12;
      });
    if (!ok) fail("งบประมาณไม่ถูกต้อง");
  }
  const plan = (isNull ? {} : budgets) as Record<string, number>;
  const stamp = new Date().toISOString();
  const stmts: Stmt[] = [];
  if (!isNull) {
    const existing = await t.selectInternal<{ department: string }>("finance_budgets", { where: { fiscal_year: year } });
    for (const r of existing) if (!Object.prototype.hasOwnProperty.call(plan, r.department)) stmts.push(t.deleteStmt("finance_budgets", { fiscal_year: year, department: r.department }));
  }
  for (const [department, amount] of Object.entries(plan))
    stmts.push(t.upsertStmt("finance_budgets", { fiscal_year: year, department, amount, updated_by: t.viewer.userId, updated_at: stamp }, ["company_id", "fiscal_year", "department"], ["amount", "updated_by", "updated_at"]));
  stmts.push(audit(t, "finance_budgets_saved", String(year)));
  await t.atomic(stmts);
}

/** finance_save_targets(): the year's revenue, profit and expense-cap targets (each may be empty). */
export async function financeSaveTargets(t: Tenant, year: number, revenue: number | null, profit: number | null, expenseCap: number | null): Promise<void> {
  if (!financeManager(t)) fail("ไม่มีสิทธิ์วางแผนงบประมาณ", 403);
  if (!(year >= 2000 && year <= 2200)) fail("ปีบัญชีไม่ถูกต้อง");
  const has = (v: number | null): v is number => v !== null && v !== undefined;
  // The table's CHECK constraints, in Postgres's order (by name).
  check("finance_targets", "finance_targets_expense_cap_check", !has(expenseCap) || (expenseCap >= 0 && expenseCap <= 1e12));
  check("finance_targets", "finance_targets_profit_check", !has(profit) || Math.abs(profit) <= 1e12);
  check("finance_targets", "finance_targets_revenue_check", !has(revenue) || (revenue >= 0 && revenue <= 1e12));
  await t.atomic([
    t.upsertStmt(
      "finance_targets",
      { fiscal_year: year, revenue: revenue ?? null, profit: profit ?? null, expense_cap: expenseCap ?? null, updated_by: t.viewer.userId, updated_at: new Date().toISOString() },
      ["company_id", "fiscal_year"],
      ["revenue", "profit", "expense_cap", "updated_by", "updated_at"],
    ),
    audit(t, "finance_targets_saved", String(year)),
  ]);
}

/** goal_set(): the sales target of a month (0 removes it). `month` is any date in that month, YYYY-MM-DD. */
export async function goalSet(t: Tenant, month: string | null, target: number | null): Promise<void> {
  if (!["owner", "manager"].includes(memberRole(t))) fail("เฉพาะเจ้าของหรือผู้จัดการตั้งเป้าหมายได้", 403);
  const d = month === null || month === undefined ? null : date(month);
  if (d === null || target === null || target === undefined || target < 0 || target > 1e12) fail("เป้าหมายไม่ถูกต้อง");
  const first = d!.slice(0, 7) + "-01";
  const stmts: Stmt[] = [];
  if (target === 0) stmts.push(t.deleteStmt("monthly_goals", { month: first }));
  else stmts.push(t.upsertStmt("monthly_goals", { month: first, sales_target: target, updated_by: t.viewer.userId, updated_at: new Date().toISOString() }, ["company_id", "month"], ["sales_target", "updated_by", "updated_at"]));
  stmts.push(audit(t, "monthly_goal_set", d!.slice(0, 7)));
  await t.atomic(stmts);
}

// ---------- posting ----------
export type JournalEntry = { id: string; company_id: string; entity_id: string | null; date: string; memo: string; posted_by: string | null; created_at: string };
export type JournalLineInput = { account?: unknown; debit?: unknown; credit?: unknown; projectId?: unknown; costCenter?: unknown };
export type WhtInput = { form?: unknown; payee?: unknown; taxId?: unknown; base?: unknown; rate?: unknown; amount?: unknown };

/**
 * post_expense(): book an expense as a balanced journal entry (replacing an earlier posting of it), keep its
 * withholding-tax certificate in step (null removes it), and mark the expense บันทึกแล้ว.
 */
export async function postExpense(t: Tenant, entityId: string, lines: unknown, wht: unknown = null): Promise<JournalEntry> {
  const v = t.viewer;
  if (!canWriteDept(v, "Finance")) fail("ไม่มีสิทธิ์ฝ่ายการเงิน", 403);
  const id = uuid(entityId);
  const [e] = await t.selectInternal<Entity>("entities", { where: { id, kind: "expenses", archived_at: null } });
  if (!e) fail("ไม่พบรายการค่าใช้จ่าย", 404);
  // A null list passes the shape check (as in Postgres) and then fails as unbalanced.
  if (lines !== null && lines !== undefined && (!Array.isArray(lines) || lines.length < 2 || lines.length > 200)) fail("รายการบัญชีไม่ถูกต้อง");
  const list = (Array.isArray(lines) ? lines : []) as unknown[];
  const accounts = new Set((await t.selectInternal<{ code: string }>("accounts")).map((a) => a.code));
  for (const l of list) {
    const account = jtext(l, "account"),
      project = jtext(l, "projectId") ?? "";
    let bad = account === null || !accounts.has(account);
    if (!bad && project !== "") bad = !(await t.selectInternal("entities", { where: { id: uuid(project), kind: "projects" }, limit: 1 })).length;
    if (bad) fail("รหัสบัญชีหรือโปรเจกต์ไม่ถูกต้อง");
  }
  const parsed = list.map((l) => {
    const debit = jtext(l, "debit"),
      credit = jtext(l, "credit");
    return { l, debit: debit === null ? null : numeric(debit), credit: credit === null ? null : numeric(credit) };
  });
  const dr = parsed.reduce((s, p) => add(s, p.debit ?? ZERO), ZERO),
    cr = parsed.reduce((s, p) => add(s, p.credit ?? ZERO), ZERO);
  if (cmp(dr, cr) !== 0 || cmp(dr, ZERO) <= 0) fail("เดบิตและเครดิตไม่เท่ากัน");

  const stamp = new Date().toISOString();
  const day = typeof e!.data.date === "string" ? date(e!.data.date) : null;
  const stmts: Stmt[] = [t.guardStmt("entities", { id: e!.id, version: e!.version })];
  const [old] = await t.selectInternal<{ id: string }>("journal_entries", { where: { entity_id: e!.id } });
  if (old) stmts.push(t.deleteGlobalStmt("journal_lines", { entry_id: old.id }), t.deleteStmt("journal_entries", { id: old.id }));
  notNull("journal_entries", "date", day);
  const entryId = randomUUID();
  stmts.push(t.insertStmt("journal_entries", { id: entryId, entity_id: e!.id, date: day, memo: typeof e!.data.name === "string" ? e!.data.name : jtext(e!.data, "name") ?? "", posted_by: v.userId, created_at: stamp }));
  for (const p of parsed) {
    const debit = p.debit ?? ZERO,
      credit = p.credit ?? ZERO;
    const project = jtext(p.l, "projectId"),
      costCenter = jtext(p.l, "costCenter");
    check("journal_lines", "journal_lines_check", (cmp(debit, ZERO) === 0) !== (cmp(credit, ZERO) === 0));
    check("journal_lines", "journal_lines_credit_check", cmp(credit, ZERO) >= 0);
    check("journal_lines", "journal_lines_debit_check", cmp(debit, ZERO) >= 0);
    stmts.push(
      t.insertGlobalStmt("journal_lines", {
        entry_id: entryId,
        account_code: jtext(p.l, "account"),
        debit: decNumber(debit),
        credit: decNumber(credit),
        project_id: project === null || project === "" ? null : uuid(project),
        cost_center: costCenter === "" ? null : costCenter,
      }),
    );
  }

  if (wht === null || wht === undefined) stmts.push(t.deleteStmt("wht_certificates", { entity_id: e!.id }));
  else {
    const [cert] = await t.selectInternal<{ id: string }>("wht_certificates", { where: { entity_id: e!.id } });
    const form = jtext(wht, "form"),
      payee = jtext(wht, "payee") || "-",
      taxId = jtext(wht, "taxId");
    if (cert) {
      const base = numOrNull(jtext(wht, "base")),
        rate = numOrNull(jtext(wht, "rate")),
        amount = numOrNull(jtext(wht, "amount"));
      const row = { form, payee, tax_id: taxId, base, rate, amount, paid_on: day };
      whtConstraints(row);
      stmts.push(t.updateStmt("wht_certificates", { entity_id: e!.id }, row));
    } else {
      notNull("wht_certificates", "year", day);
      const year = Number(day!.slice(0, 4)) + 543;
      const base = numOrNull(jtext(wht, "base")),
        rate = numOrNull(jtext(wht, "rate")),
        amount = numOrNull(jtext(wht, "amount"));
      const row = { form, payee, tax_id: taxId, base, rate, amount, paid_on: day };
      whtConstraints(row);
      const seq = await t.nextNumber("WHT", year);
      stmts.push(t.insertStmt("wht_certificates", { entity_id: e!.id, year, seq, ...row, created_at: stamp }));
    }
  }

  // The entities update and its BEFORE triggers: entities_code fills a missing code; the others change nothing for an
  // expense whose status stays the same (no approval check, no derived fields, source keys kept by the merge).
  let data: Data = { ...e!.data, reviewStatus: "บันทึกแล้ว" };
  const prefix = codePrefix[e!.kind];
  if (prefix && !jtext(data, "code")) data = { ...data, code: formatCode(prefix, thaiYear(), await t.nextNumber(prefix, 0)) };
  stmts.push(t.updateStmt("entities", { id: e!.id }, { data, version: e!.version + 1, updated_at: stamp }), audit(t, "expense_posted", e!.id));
  await t.atomic(stmts);
  const [saved] = await t.selectInternal<JournalEntry>("journal_entries", { where: { id: entryId } });
  return saved;
}
function whtConstraints(r: { form: string | null; base: number | null; rate: number | null; amount: number | null; paid_on: string | null }) {
  for (const c of ["form", "base", "rate", "amount", "paid_on"] as const) notNull("wht_certificates", c, r[c]);
  check("wht_certificates", "wht_certificates_form_check", ["ภ.ง.ด.3", "ภ.ง.ด.53"].includes(r.form!));
}

// ---------- tax invoices and receipts ----------
/**
 * issue_document(): the running number of a tax invoice (from an invoice) or a receipt (from an income payment or a
 * paid invoice). Issuing again returns the number already given.
 */
export async function issueDocument(t: Tenant, kind: string, entityId: string): Promise<string> {
  if (!canWriteDept(t.viewer, "Finance")) fail("ไม่มีสิทธิ์", 403);
  const [e] = await t.selectInternal<Entity>("entities", { where: { id: uuid(entityId), archived_at: null } });
  if (!e) fail("ไม่พบเอกสาร", 404);
  let prefix: string;
  if (kind === "tax_invoice") {
    if (e!.kind !== "invoices") fail("ออกใบกำกับภาษีได้จากใบแจ้งหนี้เท่านั้น");
    prefix = "TAX";
  } else if (kind === "receipt") {
    if (!((e!.kind === "payments" && jtext(e!.data, "direction") === "income") || (e!.kind === "invoices" && jtext(e!.data, "status") === "paid"))) fail("ออกใบเสร็จได้จากการรับชำระ หรือใบแจ้งหนี้ที่ชำระครบแล้ว");
    prefix = "RC";
  } else return fail("ไม่รู้จักเอกสาร");
  const issued = async () => (await t.selectInternal<{ number: string }>("issued_documents", { where: { kind, entity_id: e!.id } }))[0]?.number ?? null;
  const had = await issued();
  if (had !== null) return had;
  const stamp = new Date().toISOString(),
    year = Number(bangkokDate(stamp).slice(0, 4));
  const n = `${prefix}-${year}-${String(await t.nextNumber(prefix, year)).padStart(4, "0")}`;
  try {
    await t.atomic([t.insertStmt("issued_documents", { kind, entity_id: e!.id, number: n, issued_by: t.viewer.userId, issued_at: stamp })]);
  } catch (err) {
    // Issued by someone else meanwhile (Postgres waited on the row lock and returned theirs).
    const theirs = await issued();
    if (theirs !== null) return theirs;
    throw err;
  }
  return n;
}

/** document_number(): the number and Bangkok date of an issued document, or null (also without Finance access). */
export async function documentNumber(t: Tenant, kind: string, entityId: string): Promise<{ number: string; date: string } | null> {
  if (!canReadDept(t.viewer, "Finance")) return null;
  const [d] = await t.selectInternal<{ number: string; issued_at: string }>("issued_documents", { where: { kind, entity_id: uuid(entityId) } });
  return d ? { number: d.number, date: bangkokDate(d.issued_at) } : null;
}

/** issued_documents_list(): every issued document of the company, newest first (empty without Finance access). */
export async function issuedDocumentsList(t: Tenant): Promise<{ kind: string; entity_id: string; number: string; date: string }[]> {
  if (!canReadDept(t.viewer, "Finance")) return [];
  const rows = await t.selectInternal<{ kind: string; entity_id: string; number: string; issued_at: string }>("issued_documents", { order: [["issued_at", "desc"]] });
  return rows.map((d) => ({ kind: d.kind, entity_id: d.entity_id, number: d.number, date: bangkokDate(d.issued_at) }));
}

// ---------- chart of accounts ----------
const ACCOUNTS: [string, string, string, string | null][] = [
  ["1111", "เงินสด", "asset", null],
  ["1112", "เงินฝากธนาคาร", "asset", null],
  ["1113", "เงินสดย่อย", "asset", null],
  ["1154", "ภาษีซื้อ", "asset", null],
  ["1160", "เงินมัดจำจ่าย", "asset", "ค่ามัดจำ"],
  ["1240", "อุปกรณ์สำนักงานและคอมพิวเตอร์", "asset", null],
  ["1250", "เฟอร์นิเจอร์และเครื่องตกแต่ง", "asset", null],
  ["1260", "ยานพาหนะ", "asset", null],
  ["1270", "โปรแกรมคอมพิวเตอร์", "asset", null],
  ["2111", "เจ้าหนี้การค้า", "liability", null],
  ["2132", "ภาษีหัก ณ ที่จ่ายค้างจ่าย", "liability", null],
  ["3120", "เงินถอนส่วนตัว", "equity", null],
  ["5010", "ซื้อสินค้าและวัตถุดิบ", "expense", "จัดซื้อ"],
  ["5020", "สินค้าตัวอย่างและของแจก", "expense", null],
  ["5110", "ค่าแรงและค่าจ้าง", "expense", "บุคลากร"],
  ["5120", "เบี้ยเลี้ยงและสวัสดิการพนักงาน", "expense", null],
  ["5130", "เงินสมทบประกันสังคม", "expense", null],
  ["5140", "ค่านายหน้าและค่าคอมมิชชั่น", "expense", null],
  ["5210", "ค่าเช่า", "expense", "ค่าเช่า"],
  ["5220", "ค่าไฟฟ้าและสาธารณูปโภค", "expense", "ค่าไฟฟ้า"],
  ["5221", "ค่าโทรศัพท์และอินเทอร์เน็ต", "expense", null],
  ["5230", "ค่าบริการ", "expense", "ค่าบริการ"],
  ["5240", "ค่าพรมและวัสดุตกแต่ง", "expense", "ค่าพรม"],
  ["5250", "ค่าขนส่ง", "expense", "ขนส่ง"],
  ["5270", "ค่าเดินทางและที่พัก", "expense", null],
  ["5271", "ค่าน้ำมันและค่าใช้จ่ายยานพาหนะ", "expense", null],
  ["5280", "ค่าซอฟต์แวร์และโปรแกรม", "expense", null],
  ["5290", "วัสดุสำนักงานและเครื่องเขียน", "expense", null],
  ["5310", "ค่าโฆษณาและการตลาด", "expense", "การตลาด"],
  ["5320", "ค่ารับรอง", "expense", null],
  ["5410", "เบี้ยประกันภัย", "expense", null],
  ["5420", "ค่าธรรมเนียมธนาคาร", "expense", null],
  ["5430", "ภาษีและค่าธรรมเนียมราชการ", "expense", null],
  ["5440", "ค่าซ่อมแซมและบำรุงรักษา", "expense", null],
  ["5450", "ดอกเบี้ยจ่าย", "expense", null],
  ["5900", "ค่าใช้จ่ายอื่น", "expense", "อื่นๆ"],
];
/**
 * seed_accounts(c): the starting chart of accounts and the HQ cost centre of company `companyId`, skipping what is
 * already there. Not callable by members in Postgres (revoked); the caller decides the company. Returns the batch
 * steps so they can join the batch that creates the company.
 */
export function seedAccountsStmts(t: Tenant, companyId: string): Stmt[] {
  return [
    ...ACCOUNTS.map(([code, name, type, category]) => t.upsertGlobalStmt("accounts", { company_id: companyId, code, name, type, category }, ["company_id", "code"], [])),
    t.upsertGlobalStmt("cost_centers", { company_id: companyId, code: "HQ", name: "สำนักงานใหญ่", kind: "branch" }, ["company_id", "code"], []),
  ];
}
export async function seedAccounts(t: Tenant, companyId: string): Promise<void> {
  await t.atomic(seedAccountsStmts(t, companyId));
}
/** The companies_seed_accounts trigger (AFTER INSERT ON companies): add these steps to the batch that inserts the company. */
export const companiesSeedAccounts = (t: Tenant, companyId: string): Stmt[] => seedAccountsStmts(t, companyId);
