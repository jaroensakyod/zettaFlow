// The LINE functions on D1 (src/lib/d1/line.ts) must behave exactly like Postgres: pairing groups and people,
// deciding and approving items from the group (keywords, buttons, the approval chain, drafts, slips and evidence),
// the group's approvers, the read-outs (documents, expense summary, quick stats) and the owner's group settings. The
// webhook runs as the service role on both; every result or exact error must match, and so must the tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, both, fid, type Who } from "./d1-line-harness";
import {
  lineAddEvidence,
  lineApprovalAct,
  lineApprove,
  lineDecide,
  lineDocuments,
  lineDraftDecide,
  lineEvidenceCheck,
  lineExpensePaid,
  lineExpenseSummary,
  lineKeywordApprove,
  lineQuickStats,
  lineSetApprovers,
  lineSlipCheck,
  pairLineGroup,
  pairLineUser,
  removeLineApprover,
  setLineGroupListen,
  unlinkLineGroup,
  updateLineGroup,
} from "../src/lib/d1/line";
import { bangkokDay } from "../src/lib/d1/ingestion";

type Data = Record<string, unknown>;
const J = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const L = (c: string) => "U" + "0".repeat(31) + c;

test("LINE functions on D1 match Postgres step for step", async () => {
  const h = await setup();
  const c = h.company,
    now = Date.now();
  const at = (minutes: number) => new Date(now - minutes * 60000).toISOString();
  const LO = L("1"),
    LM = L("2"),
    LS = L("3"),
    LK = L("5"),
    LR = L("9"),
    LA = L("a"),
    LB = L("b");

  // ---------- fixtures ----------
  const other = fid(900);
  await h.seedPg("companies", { id: other, name: "บริษัทอื่น" });
  await h.seedPg("line_groups", { group_id: "Cother", company_id: other, name: "อื่น" }, "group_id");
  await h.seedPg("line_groups", { group_id: "Cfin", company_id: c, name: "บัญชี", department: "Finance", approve_keywords: ["อนุมัติ", "โอเค"] }, "group_id");
  await h.seedPg("line_groups", { group_id: "Cmk", company_id: c, name: "การตลาด", department: "Marketing" }, "group_id");
  await h.seedPg("line_groups", { group_id: "Cplain", company_id: c, name: "" }, "group_id");
  for (const [w, lu] of [["owner", LO], ["manager", LM], ["staff", LS], ["mk", LK]] as [Who, string][]) await h.seedPg("line_users", { company_id: c, line_user_id: lu, user_id: h.ids[w] }, "line_user_id");
  await h.seedPg("line_group_approvers", { group_id: "Cfin", line_user: LA, name: "คุณเอ", added_by: LO, created_at: at(500) }, "line_user");
  const future = at(-600),
    past = at(600);
  const pair = (token_hash: string, extra: Data) => h.seedPg("line_pairings", { token_hash, company_id: c, expires_at: future, ...extra }, "token_hash");
  await pair("h-group", { department: "Sales" });
  await pair("h-fin", {});
  await pair("h-old", { expires_at: past });
  await pair("h-other", {});
  await pair("h-free", {});
  await pair("h-user", { user_id: h.ids.staff });
  await pair("h-user2", { user_id: h.ids.manager });
  await pair("h-user3", { user_id: h.ids.staff });
  const tpl = fid(1);
  await h.seedPg("data_templates", { id: tpl, company_id: c, name: "เบิก", department: "Finance", fields: [], steps: [] });
  const expenseTpl = {
    name: "ค่าใช้จ่าย",
    target_kind: "expenses",
    fields: [
      { key: "name", label: "ชื่อรายการ", type: "text", required: true },
      { key: "amount", label: "ยอดเงิน", type: "number", required: true },
    ],
  };
  let n = 10;
  const E = async (kind: string, department: string, data: Data) => {
    const id = fid(++n);
    await h.seedPg("entities", { id, company_id: c, kind, department, data, created_by: h.ids.owner, created_at: at(3000 - n), updated_at: at(3000 - n) });
    return id;
  };
  await E("expenses", "Finance", { name: "ค่าเดินทาง", code: "EXP-69-0901", amount: 700, status: "approved", date: "2026-11-02", category: "ค่าเดินทาง", sourceSender: "ต้น" });
  await E("expenses", "Finance", { name: "ค่าน้ำ", code: "EXP-69-0902", amount: 450, status: "paid", date: "2026-11-03", category: "ค่าน้ำ", requestor: "เมย์" });
  await E("expenses", "Finance", { name: "ไม่อนุมัติ", code: "EXP-69-0903", amount: 999, status: "rejected", date: "2026-11-03" });
  await E("sales", "Sales", { name: "ขายวันนี้", amount: 1200, status: "confirmed", date: bangkokDay(new Date(now).toISOString()) });
  await E("sales", "Sales", { name: "ขายต้นเดือน", amount: 300, status: "confirmed", date: bangkokDay(new Date(now).toISOString()).slice(0, 8) + "01" });
  await E("deals", "Business Development", { name: "ดีล", location: "x", rent: 1, status: "pending" });
  await E("tasks", "Operations", { name: "งาน", department: "Operations", priority: "normal" });
  await E("projects", "Operations", { name: "โครงการ", priority: "normal", status: "planning" });
  for (const k of [200, 201, 202, 203, 204, 205, 206])
    await h.seedPg("attachments", { id: fid(k), company_id: c, department: "Finance", name: "f" + k, mime: "image/jpeg", size: 1, path: `${c}/Finance/${fid(k)}` });
  await h.seedPg("attachments", { id: fid(299), company_id: other, department: "Finance", name: "x", mime: "image/jpeg", size: 1, path: `${other}/Finance/x` });
  let age = 400;
  const I = async (k: number, extra: Data) =>
    h.seedPg("ingestions", { id: fid(k), company_id: c, template: expenseTpl, target_kind: "expenses", department: "Finance", raw: "", status: "review", group_id: "Cfin", source_user: LR, sender_name: "ต้น", values: { name: "ค่ารายการ " + k, amount: 100 + k }, created_at: at(age--), ...extra });
  const chain = (depts: string[]) => ({ steps: depts.map((dept) => ({ dept })), at: 0, round: 1, ref: "EF-TEST", history: [] });
  await I(101, { values: { name: "ค่าแท็กซี่", amount: 120 } });
  await I(102, { values: { amount: 5 }, missing: ["ชื่อรายการ"] });
  await I(103, { group_id: "Cmk" });
  await I(104, { group_id: "Cmk", department: "Marketing" });
  await I(105, { group_id: "Cmk", approval: chain(["Finance"]) });
  await I(106, { status: "queued" });
  await I(107, { values: { name: "ค่าที่จอดรถ", amount: 60 } });
  await I(111, { approval: chain(["Finance", "Marketing"]), values: { name: "งานเลี้ยง", amount: 8000 } });
  await I(112, { approval: chain(["Finance"]), attachment_id: fid(206), values: { name: "ค่าหมึก", amount: 300 } });
  await I(113, { approval: chain(["Finance"]) });
  await I(121, { status: "draft", missing: ["ยอดเงิน"], values: { name: "ร่าง" } });
  await I(122, { status: "draft", values: { name: "ร่างยกเลิก", amount: 1 } });
  await I(123, { status: "skipped" });
  await I(124, { status: "processing" });
  await I(131, { group_id: "Cplain", values: { name: "ค่าส่งของ", amount: 40 } });
  await h.seedPg("line_listen", { group_id: "Cfin", line_user: LR, company_id: c, mode: "edit", ingestion_id: fid(122), until: future }, "line_user");

  // ---------- steps ----------
  let steps = 0;
  const step = async (name: string, pg: () => Promise<unknown>, d1: () => Promise<unknown>) => {
    const r = await both(pg, d1);
    steps++;
    if (process.env.SHOW_PARITY) console.log(steps, name, JSON.stringify(r.pg).slice(0, 220));
    assert.deepEqual(r.d1, r.pg, `step ${steps}: ${name}`);
  };
  const row = async (w: Who | null, text: string, params: unknown[]) => (await h.pgCall(w, text, params))[0]?.r;
  const sql = h.sql;

  // pairing
  const pairG = (name: string, hash: string, g: string) => step(`pair_line_group ${name}`, () => row(null, "select pair_line_group($1,$2) r", [hash, g]), () => pairLineGroup(sql, hash, g));
  await pairG("new group", "h-group", "Cnew");
  await pairG("used code", "h-group", "Cnew2");
  await pairG("expired code", "h-old", "Cnew2");
  await pairG("a personal code", "h-user", "Cnew2");
  await pairG("group of another company", "h-other", "Cother");
  await pairG("again on a linked group", "h-fin", "Cfin");
  const pairU = (name: string, hash: string, g: string, lu: string) => step(`pair_line_user ${name}`, () => row(null, "select pair_line_user($1,$2,$3) r", [hash, g, lu]), () => pairLineUser(sql, hash, g, lu));
  await pairU("staff, a second LINE", "h-user", "Cfin", L("c"));
  await pairU("used code", "h-user", "Cfin", L("d"));
  await pairU("group of another company", "h-user3", "Cother", L("d"));
  await pairU("a group code", "h-other", "Cfin", L("d"));
  await pairU("LINE of someone else", "h-user2", "Cfin", LS);
  await pairU("same person again", "h-user3", "Cfin", LS);

  // line_decide / line_approve / line_keyword_approve
  const decide = (name: string, g: string, lu: string, k: number, status: string, reason = "") =>
    step(`line_decide ${name}`, () => row(null, "select line_decide($1,$2,$3,$4,$5) r", [g, lu, fid(k), status, reason]), () => lineDecide(sql, g, lu, fid(k), status, reason));
  await decide("unknown group", "Cnope", LM, 101, "approved");
  await decide("staff in LINE", "Cfin", LS, 101, "approved");
  await decide("unlinked", "Cfin", LR, 101, "approved");
  await decide("unknown item", "Cfin", LM, 999, "approved");
  await decide("item with a chain", "Cmk", LM, 105, "approved");
  await decide("other department, other group", "Cfin", LM, 104, "approved");
  await decide("not the manager's department", "Cmk", LM, 104, "approved");
  await decide("not read yet", "Cfin", LM, 106, "approved");
  await decide("missing a field", "Cfin", LM, 102, "approved");
  await decide("bad status", "Cfin", LM, 101, "maybe");
  await decide("approve", "Cfin", LM, 101, "approved");
  await decide("decided already", "Cfin", LM, 101, "rejected");
  await decide("reject from the department's group", "Cfin", LM, 103, "rejected", "   ");
  await step("line_approve when approved already", () => row(null, "select line_approve($1,$2,$3) r", ["Cfin", LS, fid(101)]), () => lineApprove(sql, "Cfin", LS, fid(101)));
  const kw = (name: string, g: string, lu: string, text: string) => step(`line_keyword_approve ${name}`, () => row(null, "select line_keyword_approve($1,$2,$3) r", [g, lu, text]), () => lineKeywordApprove(sql, g, lu, text));
  await kw("unknown group", "Cnope", LO, "อนุมัติ");
  await kw("not a keyword", "Cfin", LO, "สวัสดี");
  await kw("keyword by a staff", "Cfin", LS, "โอเค");
  await kw("keyword", "Cfin", LO, " อนุมัติ ");
  await kw("keyword, newest is on the chain", "Cmk", LO, "อนุมัติ");
  await kw("keyword in a plain group", "Cplain", LO, "อนุมัติปล่อยของ");
  await kw("keyword, nothing left", "Cplain", LO, "อนุมัติ");

  // line_approval_act: the approval chain from the card's buttons
  const act = (name: string, lu: string, k: number, action: string, note: string | null = null, s: number | null = null, g = "Cfin") =>
    step(
      `line_approval_act ${name}`,
      () => row(null, "select line_approval_act($1,$2,$3,$4,$5,$6) r", [g, lu, fid(k), action, note, s]),
      () => lineApprovalAct(sql, g, lu, fid(k), action, note, s),
    );
  await act("unknown group", LA, 111, "approve", null, null, "Cnope");
  await act("unknown item", LA, 999, "approve");
  await act("the requester", LR, 111, "approve");
  await act("not an approver", L("e"), 111, "approve");
  await act("approver, wrong step", LA, 111, "approve", null, 1);
  await act("approver, step 1", LA, 111, "approve", null, 0);
  await act("approver, step 2 is Marketing's", LA, 111, "approve", null, 1);
  await act("manager, stale step", LK, 111, "approve", null, 0);
  await act("manager of the wrong department", LM, 111, "approve", null, 1);
  await act("marketing manager, last step", LK, 111, "approve", "ok", 1);
  await act("decided already", LK, 111, "approve");
  await act("staff, not an approver", LS, 113, "approve");
  await act("reject without a reason", LM, 113, "reject", " ");
  await act("unknown action", LM, 113, "maybe");
  await act("send back to fix", LM, 112, "fix", "ใส่วันที่");
  await act("not in review", LM, 112, "approve");

  // drafts
  const draft = (name: string, g: string, lu: string, k: number, save: boolean) =>
    step(`line_draft_decide ${name}`, () => row(null, "select line_draft_decide($1,$2,$3,$4) r", [g, lu, fid(k), save]), () => lineDraftDecide(sql, g, lu, fid(k), save));
  await draft("wrong group", "Cmk", LR, 121, true);
  await draft("in review", "Cfin", LR, 113, true);
  await draft("being read", "Cfin", LR, 124, true);
  await draft("cancelled", "Cfin", LR, 123, true);
  await draft("someone else", "Cfin", LS, 121, true);
  await draft("still missing", "Cfin", LR, 121, true);
  await draft("cancel by a manager", "Cfin", LM, 122, false);
  await draft("fixed item sent again", "Cfin", LR, 112, true);
  await act("approve after the fix", LM, 112, "approve");

  // slips and evidence
  const slip = (name: string, lu: string, k: number) => step(`line_slip_check ${name}`, () => row(null, "select line_slip_check($1,$2,$3) r", ["Cfin", lu, fid(k)]), () => lineSlipCheck(sql, "Cfin", lu, fid(k)));
  await slip("approved already", LR, 101);
  await slip("not approved yet", LR, 113);
  await slip("someone else", LS, 111);
  await slip("requester", LR, 111);
  const summary = (name: string, g: string, lu: string, from = "2000-01-01", to = "2100-12-31") =>
    step(`line_expense_summary ${name}`, () => row(null, "select line_expense_summary($1,$2,$3,$4) r", [g, lu, from, to]), () => lineExpenseSummary(sql, g, lu, from, to));
  await summary("waiting for a slip", "Cfin", LO);
  const paid = (name: string, lu: string, k: number, a: string) => step(`line_expense_paid ${name}`, () => row(null, "select line_expense_paid($1,$2,$3,$4) r", ["Cfin", lu, fid(k), a]), () => lineExpensePaid(sql, "Cfin", lu, fid(k), a));
  await paid("file of another company", LR, 111, fid(299));
  await paid("slip", LR, 111, fid(200));
  await paid("again", LR, 111, fid(200));
  const check = (name: string, lu: string, k: number) => step(`line_evidence_check ${name}`, () => row(null, "select line_evidence_check($1,$2,$3) r", ["Cfin", lu, fid(k)]), () => lineEvidenceCheck(sql, "Cfin", lu, fid(k)));
  await check("rejected item", LR, 103);
  await check("someone else", LS, 101);
  await check("requester", LR, 111);
  const ev = (name: string, lu: string, k: number, a: string) => step(`line_add_evidence ${name}`, () => row(null, "select line_add_evidence($1,$2,$3,$4) r", ["Cfin", lu, fid(k), a]), () => lineAddEvidence(sql, "Cfin", lu, fid(k), a));
  await ev("unknown file", LR, 101, fid(298));
  for (const k of [201, 202, 203, 204, 205]) await ev("file " + k, LO, 101, fid(k));
  await ev("a sixth file", LO, 101, fid(206));

  // read-outs
  await summary("after the slip", "Cfin", LM);
  await summary("one week", "Cfin", LO, "2026-11-02", "2026-11-02");
  await summary("staff", "Cfin", LS);
  await summary("unknown group", "Cnope", LO);
  const docs = (name: string, lu: string, code: string | null, id: string | null) =>
    step(`line_documents ${name}`, () => row(null, "select line_documents($1,$2,$3,$4) r", ["Cfin", lu, code, id]), () => lineDocuments(sql, "Cfin", lu, code, id));
  await docs("requester, the group's latest", LR, null, null);
  await docs("linked member, the group's latest", LO, null, null);
  await docs("by code", LO, "exp-69-0901", null);
  await docs("by code, unlinked", L("e"), "EXP-69-0901", null);
  await docs("by id", LO, null, fid(11));
  await step("line_documents unknown group", () => row(null, "select line_documents($1,$2) r", ["Cnope", LO]), () => lineDocuments(sql, "Cnope", LO));
  await step("line_quick_stats", () => row(null, "select line_quick_stats($1) r", ["Cfin"]), () => lineQuickStats(sql, "Cfin"));
  await step("line_quick_stats unknown group", () => row(null, "select line_quick_stats($1) r", ["Cnope"]), () => lineQuickStats(sql, "Cnope"));

  // approvers in a group
  const setA = (name: string, g: string, lu: string, add: unknown, remove: string[] | null) =>
    step(`line_set_approvers ${name}`, () => row(null, "select line_set_approvers($1,$2,'h',$3,$4) r", [g, lu, J(add), remove]), () => lineSetApprovers(sql, g, lu, "h", add, remove));
  await setA("unknown group", "Cnope", LR, [], null);
  await setA("not an approver", "Cfin", LR, [{ id: LR, name: "ฉัน" }], null);
  await setA("approver adds", "Cfin", LA, [{ id: LB, name: "บี" }, { id: "bad", name: "x" }, { id: LA, name: "" }, { id: LB, name: "บีบี" }], null);
  await setA("manager renames and removes", "Cfin", LM, [{ id: LA, name: "เอใหม่" }], [LB]);
  await setA("too many at once", "Cfin", LA, Array.from({ length: 21 }, (_, i) => ({ id: "U" + String(i).padStart(32, "f"), name: "" })), null);
  await setA("too many in the group", "Cfin", LA, Array.from({ length: 20 }, (_, i) => ({ id: "U" + String(i).padStart(32, "e"), name: "n" + i })), null);
  await setA("anyone in a group without approvers", "Cmk", LR, [{ id: LK, name: "บอส" }], null);
  await setA("not an array", "Cmk", LK, { id: LR }, ["U000"]);

  // the owner's settings
  const T = (w: Who) => h.tenant(w);
  await step("unlink by a manager", () => row("manager", "select unlink_line_group($1,$2) r", [c, "Cplain"]), () => unlinkLineGroup(T("manager"), "Cplain"));
  const upd = (name: string, g: string, t: string | null, kws: string[], dept: string | null, w: Who = "owner") =>
    step(`update_line_group ${name}`, () => row(w, "select update_line_group($1,$2,$3,$4,$5,$6) r", [c, g, t, "  ชื่อกลุ่มใหม่ ", kws, dept]), () => updateLineGroup(T(w), g, t, "  ชื่อกลุ่มใหม่ ", kws, dept));
  await upd("by a manager", "Cfin", null, ["อนุมัติ"], null, "manager");
  await upd("unknown form", "Cfin", fid(997), ["อนุมัติ"], null);
  await upd("no keywords", "Cfin", null, [], null);
  await upd("short keyword", "Cfin", null, ["อนุมัติ", " a "], null);
  await upd("long department", "Cfin", null, ["อนุมัติ"], "x".repeat(61));
  await upd("unknown group", "Cnope", null, ["อนุมัติ"], null);
  await upd("group of another company", "Cother", null, ["อนุมัติ"], null);
  await upd("ok", "Cfin", tpl, ["อนุมัติ", "ผ่าน"], "");
  const listen = (name: string, g: string, mode: string, w: Who = "owner") =>
    step(`set_line_group_listen ${name}`, () => row(w, "select set_line_group_listen($1,$2,$3) r", [c, g, mode]), () => setLineGroupListen(T(w), g, mode));
  await listen("by staff", "Cfin", "all", "staff");
  await listen("bad mode", "Cfin", "loud");
  await listen("unknown group", "Cnope", "all");
  await listen("all", "Cfin", "all");
  const rm = (name: string, g: string, lu: string, w: Who = "owner") =>
    step(`remove_line_approver ${name}`, () => row(w, "select remove_line_approver($1,$2,$3) r", [c, g, lu]), () => removeLineApprover(T(w), g, lu));
  await rm("by a manager", "Cfin", LA, "manager");
  await rm("ok", "Cfin", LA);
  await rm("group of another company", "Cother", LA);
  await step("unlink", () => row("owner", "select unlink_line_group($1,$2) r", [c, "Cmk"]), () => unlinkLineGroup(T("owner"), "Cmk"));
  // Free plan: one LINE group only.
  await h.exec("update subscriptions set plan='free',status='active',current_period_end=null where company_id=$1", "update subscriptions set plan='free',status='active',current_period_end=null where company_id=?", [c]);
  await pairG("free plan, one group too many", "h-free", "Cfree");
  await pairG("free plan, a group already linked", "h-free", "Cfin");

  // ---------- what was left behind ----------
  for (const table of ["ingestions", "entities", "attachments", "notification_outbox", "audit_events", "line_groups", "line_group_approvers", "line_users", "line_pairings", "line_listen", "project_stages", "doc_counters"]) {
    const d = await h.dump(table);
    assert.deepEqual(d.d1, d.pg, `table ${table}`);
  }
  if (process.env.SHOW_PARITY) console.log("steps:", steps);
  await h.db.close();
});
