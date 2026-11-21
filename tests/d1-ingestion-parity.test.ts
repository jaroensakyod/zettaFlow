// Document ingestion, attachments and design revisions on D1 (src/lib/d1/ingestion.ts) must behave exactly like the
// Postgres functions: the same steps run on both (people on the web, the worker as the service role) and every
// outcome — rows returned, codes, approval plans, records made from approved items, the LINE outbox, or the exact
// error — has to match, and so must the tables they leave behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, both, fid, type Who } from "./d1-line-harness";
import {
  addAttachment,
  claimIngestion,
  commentDesignRevision,
  completeIngestion,
  completeSortedIngestion,
  createDesignRevision,
  decideIngestion,
  itemFileCount,
  linkAttachment,
  peekCode,
  purgeVoiceFiles,
  retryIngestion,
  reviewDesignRevision,
  submitIngestion,
  systemTenant,
  takeCode,
} from "../src/lib/d1/ingestion";

type Data = Record<string, unknown>;
const J = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

test("ingestion, attachments and design revisions on D1 match Postgres step for step", async () => {
  const h = await setup();
  const c = h.company,
    owner = h.ids.owner;
  const now = Date.now();
  const at = (minutes: number) => new Date(now - minutes * 60000).toISOString();

  // ---------- fixtures, identical on both ----------
  const tF = fid(1),
    tW = fid(2);
  const fFields = [
    { key: "name", label: "ชื่อรายการ", type: "text", required: true },
    { key: "amount", label: "ยอดเงิน", type: "number", required: true },
    { key: "date", label: "วันที่", type: "date" },
    { key: "category", label: "หมวด", type: "text" },
  ];
  await h.seedPg("data_templates", { id: tF, company_id: c, name: "เบิกค่าใช้จ่าย", department: "Finance", fields: fFields, steps: [{ name: "ตรวจใบเสร็จ", department: "Finance" }], target_kind: "expenses" });
  const wFields = [
    { key: "project", label: "โครงการ", type: "text" },
    { key: "project_id", label: "รหัสโครงการ", type: "text" },
    { key: "rent", label: "ค่าเช่า", type: "number" },
    { key: "location", label: "ที่ตั้ง", type: "text" },
    { key: "start", label: "เริ่ม", type: "date" },
    { key: "end", label: "สิ้นสุด", type: "date" },
  ];
  const wSteps = [
    { name: "หาที่", department: "Business Development" },
    { name: "ทำสัญญา", department: "Legal" },
  ];
  await h.seedPg("data_templates", { id: tW, company_id: c, name: "เปิดสาขา", department: "Business Development", fields: wFields, steps: wSteps });
  const tWrow = { id: tW, name: "เปิดสาขา", department: "Business Development", fields: wFields, steps: wSteps };
  await h.seedPg("line_groups", { group_id: "Cbuy", company_id: c, name: "จัดซื้อ", department: "Purchasing" }, "group_id");
  let n = 10;
  const E = async (kind: string, department: string, data: Data) => {
    const id = fid(++n);
    await h.seedPg("entities", { id, company_id: c, kind, department, data, created_by: owner, created_at: at(2000 - n), updated_at: at(2000 - n) });
    return id;
  };
  const booth1 = await E("projects", "Operations", { name: "บูธ", status: "active", priority: "normal" });
  await E("projects", "Operations", { name: "บูธ", status: "active", priority: "normal" });
  const proj = await E("projects", "Design", { name: "ร้านเซ็นทรัล", status: "active", priority: "normal" });
  const exp = await E("expenses", "Finance", { name: "ค่าไฟ", code: "EXP-69-0900", amount: 10, status: "approved", date: "2026-11-01", category: "ค่าไฟ" });
  const att = async (k: number, department: string, mime: string, extra: Data = {}) =>
    h.seedPg("attachments", { id: fid(k), company_id: c, department, name: "f" + k, mime, size: 100, path: `${c}/${department}/${fid(k)}`, ...extra });
  await att(200, "Finance", "image/jpeg");
  await att(201, "Design", "image/png");
  await att(210, "Design", "image/png", { entity_id: proj });
  await att(211, "Design", "application/pdf", { entity_id: proj });
  await att(212, "Design", "text/plain", { entity_id: proj });
  await att(220, "Finance", "audio/m4a", { created_at: at(100 * 1440) });
  await att(221, "Finance", "audio/m4a", { created_at: at(10) });
  await att(222, "Purchasing", "image/png");
  const purchaseTpl = {
    name: "ใบขอซื้อ",
    target_kind: "purchases",
    fields: [
      { key: "name", label: "ชื่อ", type: "text", required: true },
      { key: "supplierId", label: "ผู้ขาย", type: "relation" },
      { key: "orderDate", label: "วันที่สั่งซื้อ", type: "date", required: true },
    ],
  };
  const expenseTpl = { name: "ค่าใช้จ่าย", target_kind: "expenses", fields: fFields };
  const G = async (k: number, extra: Data) =>
    h.seedPg("ingestions", { id: fid(k), company_id: c, template: {}, department: "Finance", raw: "", status: "processing", lease_id: fid(k + 50), lease_until: at(-60), attempts: 1, created_at: at(500 - k), ...extra });
  await G(101, { template: purchaseTpl, target_kind: "purchases", department: "Purchasing", group_id: "Cbuy", source_user: "U" + "a".repeat(32), sender_name: "ต้น", attachment_id: fid(222) });
  await G(102, { template: expenseTpl, target_kind: "expenses", group_id: "Cbuy", source_user: "U" + "b".repeat(32) });
  await G(103, { template: expenseTpl, target_kind: "expenses", group_id: "Cbuy", confirm: true });
  await G(104, {});
  await G(105, {});
  await G(106, {});
  await G(107, { status: "processing", lease_until: at(30), attempts: 5 });
  await G(108, { status: "processing", lease_until: at(30), attempts: 2 });
  await G(109, { status: "approved", attachment_id: fid(220), lease_id: null });
  await h.seedPg("attachments", { id: fid(223), company_id: c, department: "Purchasing", name: "ev", mime: "image/png", size: 1, path: `${c}/Purchasing/${fid(223)}`, ingestion_id: fid(101) });
  const W = async (k: number, values: Data) => h.seedPg("ingestions", { id: fid(k), company_id: c, template: tWrow, department: "Business Development", raw: "", status: "review", values, created_at: at(400 - k) });
  await W(121, { project: "ร้านสยาม", rent: 20000, location: "สยาม", start: "2026-12-01", end: "2026-12-31" });
  await W(122, { project: "ร้านใหม่", start: "2026-12-31", end: "2026-12-01" });
  await W(123, { project: "บูธ" });
  await W(124, { project_id: fid(999) });
  await W(125, { project: "ร้านลาดพร้าว", rent: -5, location: "ลาดพร้าว" });
  await W(126, { project_id: booth1, rent: 1500, location: "บางนา" });

  // ---------- steps ----------
  const per = { pg: {} as Record<string, string>, d1: {} as Record<string, string> };
  let steps = 0;
  const step = async (name: string, pg: () => Promise<unknown>, d1: () => Promise<unknown>) => {
    const r = await both(pg, d1);
    steps++;
    if (process.env.SHOW_PARITY) console.log(steps, name, JSON.stringify(r.pg).slice(0, 220));
    assert.deepEqual(r.d1, r.pg, `step ${steps}: ${name}`);
  };
  const row = async (w: Who | null, text: string, params: unknown[]) => (await h.pgCall(w, text, params))[0]?.r;
  const rows = async (w: Who | null, text: string, params: unknown[]) => (await h.pgCall(w, text, params)).map((x) => x.r);
  const T = (w: Who) => h.tenant(w);
  const keep = (side: "pg" | "d1", label: string) => (r: unknown) => {
    per[side][label] = (r as Data).id as string;
    return r;
  };

  // submit_ingestion
  const submit = (w: Who, label: string | null, tpl: string, raw: string, a: string | null = null) =>
    step(
      `${w} submit ${label ?? "(refused)"}`,
      async () => {
        const r = await row(w, "select to_jsonb(i) r from submit_ingestion($1,$2,$3,$4) i", [c, tpl, raw, a]);
        return label ? keep("pg", label)(r) : r;
      },
      async () => {
        const r = await submitIngestion(T(w), tpl, raw, a);
        return label ? keep("d1", label)(r) : r;
      },
    );
  await submit("staff", "I1", tF, "ค่าน้ำมัน 500 บาท");
  await submit("viewer", null, tF, "ไม่มีสิทธิ์");
  await submit("staff", null, tF, "   ");
  await submit("staff", null, tF, "", fid(201));
  await submit("staff", "I2", tF, "", fid(200));
  await submit("staff", null, tF, "x".repeat(15001));
  await submit("staff", null, fid(998), "ไม่มีฟอร์ม");
  await submit("mk", null, tF, "ไม่ใช่แผนก");

  // claim_ingestion: fails the item that timed out five times, leases the stale one and the two new ones.
  const leases = { pg: {} as Record<string, string>, d1: {} as Record<string, string> };
  const claimed = (side: "pg" | "d1") => (rs: unknown) => {
    for (const r of rs as Data[]) leases[side][r.id as string] = r.lease_id as string;
    return rs;
  };
  await step("claim (worker)", async () => claimed("pg")(await rows(null, "select to_jsonb(i) r from claim_ingestion(null) i", [])), async () => claimed("d1")(await claimIngestion(h.sql)));
  await step("claim again: nothing left", () => rows(null, "select to_jsonb(i) r from claim_ingestion(null) i", []), () => claimIngestion(h.sql));
  await step("claim one by id", () => rows(null, "select to_jsonb(i) r from claim_ingestion($1) i", [fid(104)]), () => claimIngestion(h.sql, fid(104)));

  // complete_ingestion / complete_sorted_ingestion
  const complete = (name: string, id: (s: "pg" | "d1") => string, lease: (s: "pg" | "d1") => string, values: Data, missing: unknown[]) =>
    step(
      name,
      () => row(null, "select complete_ingestion($1,$2,$3,$4,'test') r", [id("pg"), lease("pg"), J(values), J(missing)]),
      () => completeIngestion(h.sql, id("d1"), lease("d1"), values, missing, "test"),
    );
  const label = (l: string) => (s: "pg" | "d1") => per[s][l];
  const leaseOf = (l: string) => (s: "pg" | "d1") => leases[s][per[s][l]];
  const fixed = (k: number) => () => fid(k);
  await complete("complete with a wrong lease: nothing", label("I1"), () => fid(997), { name: "x" }, []);
  await complete("complete I1", label("I1"), leaseOf("I1"), { name: "ค่าน้ำมัน", amount: 500, date: "2026-11-20" }, []);
  await complete("complete I2", label("I2"), leaseOf("I2"), {}, ["ชื่อรายการ"]);
  await complete("complete a LINE purchase", fixed(101), fixed(151), { name: "ไม้อัด 10 แผ่น", notes: "ด่วน", lines: [{ name: "ไม้อัด", qty: 10, price: 250 }] }, ["วันที่สั่งซื้อ", "เลขที่ใบสั่งซื้อ", "สินค้า", "ผู้ขาย"]);
  await complete("complete a LINE expense priced per item", fixed(102), fixed(152), { name: "กาแฟ", lines: [{ name: "กาแฟ", qty: 2, price: 50 }, { name: "ฟรี", qty: 1, price: "x" }] }, ["ยอดเงิน", "วันที่"]);
  await complete("complete a LINE draft to confirm", fixed(103), fixed(153), { name: "ค่ารถ", lines: [{ name: "ไม่มีราคา", qty: 1, price: 0 }] }, ["ยอดเงิน"]);
  const sorted = (name: string, k: number, kind: string | null, tpl: Data | null, values: Data | null) =>
    step(
      name,
      () => row(null, "select complete_sorted_ingestion($1,$2,$3,$4,$5,'[]','sort') r", [fid(k), fid(k + 50), kind, J(tpl), J(values)]),
      () => completeSortedIngestion(h.sql, fid(k), fid(k + 50), kind, tpl, values, [], "sort"),
    );
  await sorted("sorted: not a document", 105, null, null, { note: "สวัสดี" });
  await sorted("sorted: unknown page", 106, "nope", expenseTpl, {});
  await sorted("sorted: broken form", 106, "expenses", { fields: "x" }, {});
  await sorted("sorted: an expense", 106, "expenses", expenseTpl, { name: "ค่ารถ", amount: 300 });
  await sorted("sorted: an item without a group", 104, "expenses", expenseTpl, {});

  // decide_ingestion
  const decide = (w: Who, name: string, id: (s: "pg" | "d1") => string, status: string, values: Data | null, reason = "") =>
    step(
      `${w} decide ${name}`,
      () => row(w, "select decide_ingestion($1,$2,$3,$4,$5) r", [c, id("pg"), status, J(values), reason]),
      () => decideIngestion(T(w), id("d1"), status, values, reason),
    );
  await decide("staff", "I2 (no right)", label("I2"), "approved", {});
  await decide("mk", "I2 (other department)", label("I2"), "approved", {});
  await decide("manager", "I2 bad status", label("I2"), "maybe", {});
  await decide("manager", "I2 missing name", label("I2"), "approved", { amount: 1 });
  await decide("manager", "I2 amount not a number", label("I2"), "approved", { name: "x", amount: "abc" });
  await decide("manager", "I2 name not text", label("I2"), "approved", { name: 5, amount: 1 });
  await decide("manager", "I2 bad date", label("I2"), "approved", { name: "x", amount: 1, date: "2026/11/01" });
  await decide("manager", "I2 reject without reason", label("I2"), "rejected", null, "  ");
  await decide("manager", "I2 reject", label("I2"), "rejected", null, "ใบเสร็จไม่ชัด");
  await decide("manager", "I2 again", label("I2"), "approved", { name: "x", amount: 1 });
  await decide("manager", "I1 approve (record + task)", label("I1"), "approved", { name: "ค่าน้ำมัน", amount: 500, date: "2026-11-20", extra: "ไม่อยู่ในฟอร์ม" });
  await decide("owner", "LINE purchase has a chain", fixed(101), "approved", {});
  await decide("manager", "sorted expense", fixed(106), "approved", { name: "ค่ารถ", amount: 300 });
  await decide("owner", "workflow: new project, deal, tasks", fixed(121), "approved", { project: "ร้านสยาม", rent: 20000, location: "สยาม", start: "2026-12-01", end: "2026-12-31" });
  await decide("owner", "workflow: dates reversed", fixed(122), "approved", { project: "ร้านใหม่", start: "2026-12-31", end: "2026-12-01" });
  await decide("owner", "workflow: two projects of that name", fixed(123), "approved", { project: "บูธ" });
  await decide("owner", "workflow: unknown project id", fixed(124), "approved", { project_id: fid(999) });
  await decide("owner", "workflow: negative rent", fixed(125), "approved", { project: "ร้านลาดพร้าว", rent: -5, location: "ลาดพร้าว" });
  await decide("owner", "workflow: existing project by id", fixed(126), "approved", { project_id: booth1, rent: 1500, location: "บางนา" });

  // retry_ingestion
  const retry = (w: Who, name: string, id: (s: "pg" | "d1") => string) =>
    step(`${w} retry ${name}`, () => row(w, "select retry_ingestion($1,$2) r", [c, id("pg")]), () => retryIngestion(T(w), id("d1")));
  await retry("viewer", "(read only)", fixed(107));
  await retry("staff", "an approved item", label("I1"));
  await retry("staff", "the timed-out item", fixed(107));
  await retry("staff", "unknown", fixed(996));

  // take_code / peek_code
  await step("peek expenses", () => row("owner", "select peek_code($1,'expenses') r", [c]), () => peekCode(T("owner"), "expenses"));
  await step("take expenses", () => row(null, "select take_code($1,'expenses') r", [c]), () => takeCode(systemTenant(h.sql, c), "expenses"));
  await step("peek expenses again", () => row("staff", "select peek_code($1,'expenses') r", [c]), () => peekCode(T("staff"), "expenses"));
  await step("peek leaves (none yet)", () => row("staff", "select peek_code($1,'leaves') r", [c]), () => peekCode(T("staff"), "leaves"));
  await step("peek tasks (no codes)", () => row("staff", "select peek_code($1,'tasks') r", [c]), () => peekCode(T("staff"), "tasks"));

  // purge_voice_files
  await step("purge: too soon", () => rows(null, "select purge_voice_files(5) r", []), () => purgeVoiceFiles(h.sql, 5));
  await step("purge: 90 days", () => rows(null, "select purge_voice_files(90) r", []), () => purgeVoiceFiles(h.sql, 90));
  await step("purge: nothing left", () => rows(null, "select purge_voice_files() r", []), () => purgeVoiceFiles(h.sql));

  // add_attachment / link_attachment / item_file_count
  const add = (w: Who, name: string, k: number, entity: string | null, dept: string, path?: string) =>
    step(
      `${w} add_attachment ${name}`,
      () => row(w, "select add_attachment($1,$2,$3,$4,'file','image/png',10,$5) r", [c, fid(k), entity, dept, path ?? `${c}/${dept}/${fid(k)}`]),
      () => addAttachment(T(w), fid(k), entity, dept, "file", "image/png", 10, path ?? `${c}/${dept}/${fid(k)}`),
    );
  await add("staff", "loose file", 500, null, "Finance");
  await add("staff", "wrong path", 501, null, "Finance", `${c}/Finance/other`);
  await add("viewer", "read only", 502, null, "Finance");
  await add("staff", "drawing on a project", 503, proj, "Design");
  await add("staff", "on a record of another department", 504, exp, "Design");
  await add("staff", "on its record", 505, exp, "Finance");
  const link = (w: Who, name: string, a: string, e: string) => step(`${w} link_attachment ${name}`, () => row(w, "select link_attachment($1,$2,$3) r", [c, a, e]), () => linkAttachment(T(w), a, e));
  await link("staff", "to a record", fid(500), exp);
  await link("staff", "same record again", fid(500), exp);
  await link("staff", "to another record", fid(500), proj);
  await link("staff", "unknown file", fid(995), exp);
  await link("mk", "not their department", fid(500), exp);
  for (const [name, id] of [["LINE purchase", fid(101)], ["sorted expense", fid(106)], ["unknown", fid(994)]])
    await step(`item_file_count ${name}`, () => row(null, "select item_file_count($1) r", [id]), () => itemFileCount(systemTenant(h.sql), id));

  // design revisions
  const create = (w: Who, name: string, project: string, a: string, category: string, notes = "", lbl?: string) =>
    step(
      `${w} create_design_revision ${name}`,
      async () => {
        const r = await row(w, "select to_jsonb(r) r from create_design_revision($1,$2,$3,$4,$5) r", [c, project, a, category, notes]);
        return lbl ? keep("pg", lbl)(r) : r;
      },
      async () => {
        const r = await createDesignRevision(T(w), project, a, category, notes);
        return lbl ? keep("d1", lbl)(r) : r;
      },
    );
  await create("mk", "(not Design)", proj, fid(210), "layout");
  await create("staff", "text file", proj, fid(212), "layout");
  await create("staff", "bad category", proj, fid(210), "floor");
  await create("staff", "unknown project", fid(993), fid(210), "layout");
  await create("staff", "layout v1", proj, fid(210), "layout", "แบบแรก", "R1");
  await create("staff", "same file again", proj, fid(210), "layout");
  await create("staff", "layout v2", proj, fid(211), "layout", "", "R2");
  await create("staff", "perspective v1", proj, fid(210), "perspective", "", "R3");
  const review = (w: Who, name: string, id: (s: "pg" | "d1") => string, status: string, note = "") =>
    step(
      `${w} review_design_revision ${name}`,
      () => row(w, "select to_jsonb(r) r from review_design_revision($1,$2,$3,$4) r", [c, id("pg"), status, note]),
      () => reviewDesignRevision(T(w), id("d1"), status, note),
    );
  await review("staff", "(not a manager)", label("R2"), "approved");
  await review("manager", "an older version", label("R1"), "approved");
  await review("manager", "send back without a reason", label("R2"), "revision", "  ");
  await review("manager", "unknown status", label("R2"), "ok");
  await review("manager", "approve v2", label("R2"), "approved", "ผ่าน");
  await review("manager", "v2 again", label("R2"), "revision", "แก้");
  await review("owner", "send perspective back", label("R3"), "revision", "ขยายทางเดิน");
  await review("manager", "unknown", () => fid(992), "approved");
  const comment = (w: Who, name: string, id: (s: "pg" | "d1") => string, body: string) =>
    step(
      `${w} comment_design_revision ${name}`,
      () => row(w, "select to_jsonb(x) r from comment_design_revision($1,$2,$3) x", [c, id("pg"), body]),
      () => commentDesignRevision(T(w), id("d1"), body),
    );
  await comment("staff", "a comment", label("R1"), "  สีโทนอุ่นดีครับ ");
  await comment("staff", "empty", label("R1"), "   ");
  await comment("mk", "(not Design)", label("R1"), "ดี");
  await comment("manager", "unknown version", () => fid(991), "ดี");

  // ---------- what was left behind ----------
  for (const table of ["ingestions", "entities", "attachments", "notification_outbox", "audit_events", "design_revisions", "design_comments", "doc_counters", "project_stages"]) {
    const d = await h.dump(table);
    assert.deepEqual(d.d1, d.pg, `table ${table}`);
  }
  if (process.env.SHOW_PARITY) console.log("steps:", steps);
  await h.db.close();
});
