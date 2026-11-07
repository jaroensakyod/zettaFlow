import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import jsQR from "jsqr";
import { bahtText, thaiDate, promptPayPayload, qrMatrix, renderDocument, docLines, lineTotals, crc16, sampleModel, docKinds, profileGaps, type DocModel } from "../src/lib/documents";
import { docTotal } from "../src/lib/catalog";

test("bahtText reads amounts the Thai way", () => {
  const cases: [number, string][] = [
    [0, "ศูนย์บาทถ้วน"],
    [1, "หนึ่งบาทถ้วน"],
    [11, "สิบเอ็ดบาทถ้วน"],
    [21, "ยี่สิบเอ็ดบาทถ้วน"],
    [101, "หนึ่งร้อยเอ็ดบาทถ้วน"],
    [120, "หนึ่งร้อยยี่สิบบาทถ้วน"],
    [1000000, "หนึ่งล้านบาทถ้วน"],
    [1000001, "หนึ่งล้านเอ็ดบาทถ้วน"],
    [21000000, "ยี่สิบเอ็ดล้านบาทถ้วน"],
    [256800, "สองแสนห้าหมื่นหกพันแปดร้อยบาทถ้วน"],
    [16800.5, "หนึ่งหมื่นหกพันแปดร้อยบาทห้าสิบสตางค์"],
    [0.25, "ยี่สิบห้าสตางค์"],
    [1.01, "หนึ่งบาทหนึ่งสตางค์"],
    [1234567.89, "หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทแปดสิบเก้าสตางค์"],
    [-5, "ลบห้าบาทถ้วน"],
  ];
  for (const [n, words] of cases) assert.equal(bahtText(n), words, String(n));
});

test("thaiDate uses the Buddhist year and short month", () => {
  assert.equal(thaiDate("2026-11-06"), "6 พ.ย. 2569");
  assert.equal(thaiDate("2027-01-31"), "31 ม.ค. 2570");
  assert.equal(thaiDate(""), "");
  assert.equal(thaiDate(undefined), "");
});

test("PromptPay payload: EMVCo tags and CRC", () => {
  assert.equal(crc16("123456789"), "29B1"); // CRC-16/CCITT-FALSE check value
  const p = promptPayPayload("081-234-5678", 256800)!;
  assert.match(p, /^000201010212/);
  assert.ok(p.includes("29370016A00000067701011101130066812345678"));
  assert.ok(p.includes("5409256800.00"));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
  assert.match(promptPayPayload("0105567890123")!, /^000201010211.*0213010556789012353037645802TH6304[0-9A-F]{4}$/);
  assert.equal(promptPayPayload("12345"), null);
});

test("QR codes decode back to the payload", () => {
  for (const text of ["hi", promptPayPayload("0812345678", 1234.5)!, "https://eliteflow-ai.com/print/receipt/" + "x".repeat(120)]) {
    const m = qrMatrix(text),
      scale = 4,
      size = (m.length + 8) * scale,
      px = new Uint8ClampedArray(size * size * 4).fill(255);
    m.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (!dark) return;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + 4) * scale + dy) * size + (x + 4) * scale + dx) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
      }),
    );
    assert.equal(jsQR(px, size, size)?.data, text);
  }
});

test("document totals match the catalog's docTotal", () => {
  const data = {
    lines: [
      { name: "ระบบ EliteFlow\nแพ็กเกจ Pro 12 เดือน", qty: 1, price: 200000, discount: 10000, unit: "ชุด" },
      { name: "ค่าติดตั้ง", qty: 1, price: 30000 },
      { name: "อบรม", qty: 2, price: 10000, discount: 10, discountType: "percent" as const },
    ],
    discount: 500,
  };
  const lines = docLines(data.lines);
  assert.equal(lines[0].detail, "แพ็กเกจ Pro 12 เดือน");
  assert.equal(lines[2].discount, 2000);
  for (const vatMode of ["excluded", "included", "none"]) {
    const t = lineTotals(lines, data.discount, vatMode);
    assert.equal(t.total, docTotal({ ...data, vatMode }), vatMode);
    assert.equal(t.gross, 250000);
    assert.equal(t.discount, 12500);
  }
  assert.equal(lineTotals(lines, 500, "excluded").vat, 16625);
});

test("renderDocument escapes every value and prints the amount in words", () => {
  const evil = `<script>alert(1)</script>"'`;
  const model: DocModel = {
    kind: "receipt",
    number: "RC-2026-0001",
    info: [{ icon: "file", label: "เลขที่", value: evil, strong: true }],
    company: { name: evil, nameEn: evil, address: evil, logo: `javascript:alert(1)`, website: evil },
    customer: { name: evil, address: evil, taxId: evil, branch: evil, contact: evil, phone: evil, email: evil },
    lines: [{ name: evil, detail: evil, qty: 1, unit: evil, price: 100, discount: 0, amount: 100 }],
    totals: { gross: 100, discount: 0, after: 100, base: 100, vatRate: 7, vat: 7, total: 107, vatIncluded: false },
    amount: 107,
    notesTitle: evil,
    notes: [evil],
    payment: null,
    conditions: [{ label: evil, text: evil }],
    contact: { name: evil, position: evil, phone: evil, email: evil, line: evil, website: evil },
    signatures: [{ role: evil, name: evil, position: evil }],
    footerNotes: [evil],
  };
  const html = renderDocument(model);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes("หนึ่งร้อยเจ็ดบาทถ้วน"));
  assert.ok(html.includes("ใบเสร็จรับเงิน"));
  // A preview (no number yet) offers the issue form.
  const draft = renderDocument({ ...model, kind: "tax_invoice", number: null, issueAction: "/print/tax_invoice/x" });
  assert.match(draft, /<form method="post" action="\/print\/tax_invoice\/x">/);
});

test("sample documents: design content, watermark, never issued", () => {
  for (const kind of docKinds) {
    const m = sampleModel(kind);
    assert.equal(m.sample, true);
    assert.deepEqual([m.totals.gross, m.totals.discount, m.totals.after, m.totals.vat, m.amount], [250000, 10000, 240000, 16800, 256800], kind);
    const html = renderDocument(m);
    assert.match(html, /class="page k-\w+ sample"/, kind);
    for (const x of [
      "256,800.00 บาท",
      "สองแสนห้าหมื่นหกพันแปดร้อยบาทถ้วน",
      "บริษัท อีลีทโฟลว์ จำกัด (EliteFlow Co., Ltd.)",
      "บริษัท ไบรท์โซลูชั่น จำกัด",
      "ระบบ EliteFlow (แพ็กเกจ Pro)",
      "ค่าติดตั้งและตั้งค่าระบบ",
      "อบรมการใช้งาน",
    ])
      assert.ok(html.includes(x), `${kind}: ${x}`);
    assert.ok(!html.includes("<form"), "a sample never offers issuing");
  }
  const r = renderDocument(sampleModel("receipt"));
  for (const x of ["RC-2026-0028", "จำนวนเงินที่ได้รับ", "ช่องทางการติดต่อ", "ฝ่ายขาย", "TRX2026112000198", "ผู้รับเงิน", "ผู้อนุมัติ"]) assert.ok(r.includes(x), x);
});

test("company header shows every profile field; empty boxes are left out", () => {
  const empty = { name: "", position: "", phone: "", email: "", line: "", website: "" };
  const base = sampleModel("receipt");
  const full = renderDocument(base);
  for (const x of ["123/45 ถ.รัชดาภิเษก", "เลขประจำตัวผู้เสียภาษี 0105567890123", "สำนักงานใหญ่", "02-345-6789", "sales@eliteflow.co.th", "www.eliteflow.co.th"])
    assert.ok(full.includes(x), x);
  assert.ok(!/\.signs\{[^}]*margin-top:auto/.test(full), "signatures follow the content instead of being pushed to the page bottom");
  // A sparse profile: the header has only the name, the contact box disappears and หมายเหตุ takes the whole row.
  const bare = renderDocument({ ...base, sample: false, company: { name: "บริษัท ทดสอบ จำกัด" }, contact: empty });
  assert.ok(!bare.includes("ช่องทางการติดต่อ"));
  assert.ok(!bare.includes("เลขประจำตัวผู้เสียภาษี 0105567890123"));
  assert.ok(bare.includes("<h2>บริษัท ทดสอบ จำกัด</h2>"));
  assert.match(bare, /<div class="avoid"><section class="box notes">.*?หมายเหตุ/);
  // No bank account / PromptPay, no conditions, no contact: none of those boxes is drawn.
  const q = renderDocument({ ...sampleModel("quotation"), payment: null, conditions: [], contact: empty });
  for (const x of ["ช่องทางการชำระเงิน", "เงื่อนไขเพิ่มเติม", "ติดต่อฝ่ายขาย"]) assert.ok(!q.includes(x), x);
  // Screen-only hints for missing company profile fields.
  assert.deepEqual(profileGaps({ name: "x", promptPay: "0812345678" }, "invoice"), ["ที่อยู่", "เลขประจำตัวผู้เสียภาษี", "โทรศัพท์", "อีเมล"]);
  assert.ok(profileGaps({ name: "x" }, "quotation").includes("บัญชีรับเงิน"));
  assert.ok(renderDocument({ ...base, sample: false, warnings: ["ข้อมูลบริษัทยังไม่ครบ"] }).includes('<p class="warn">ข้อมูลบริษัทยังไม่ครบ</p>'));
});

// ---------- Database: issue_document / document_number (migration 0043) ----------
const owner = "10000000-0000-4000-8000-000000000001",
  sales = "10000000-0000-4000-8000-000000000002",
  other = "10000000-0000-4000-8000-000000000003";
const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const rejects = (p: Promise<unknown>, msg: RegExp) => assert.rejects(p, (e: Error) => msg.test(e.message));

test("tax invoice and receipt numbers: per year, once per record, Finance only", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text)returns text[]language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
    insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@test.local',now()),('${sales}','sales@test.local',now()),('${other}','other@test.local',now());`);
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec((await readFile("supabase/migrations/" + file, "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const login = async (id: string) => {
      await db.exec("reset role;");
      await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`, [id, id.slice(-1) + "@test.local"]);
      await db.exec("set role authenticated;");
    };
    const save = (c: string, kind: string, data: object) =>
      one<{ id: string; data: Record<string, unknown> }>(db, "select * from save_entity($1,$2,$3,null,null)", [c, kind, JSON.stringify(data)]);
    const issue = (c: string, kind: string, id: string) => one<{ n: string }>(db, "select issue_document($1,$2,$3)as n", [c, kind, id]).then((r) => r.n);

    await login(owner);
    const c = (await one<{ id: string }>(db, "select create_company('A')as id")).id;
    const cus = await save(c, "customers", { name: "ไบรท์โซลูชั่น", status: "active" });
    const inv = await save(c, "invoices", { name: "INV-2026-0014", customerId: cus.id, date: "2026-11-06", dueDate: "2026-11-20", subtotal: 240000, vat: 7 });
    const inv2 = await save(c, "invoices", { name: "INV-2026-0015", customerId: cus.id, date: "2026-11-06", dueDate: "2026-11-20", subtotal: 1000, vat: 7 });
    const year = new Date(Date.now() + 7 * 3600000).getUTCFullYear();

    assert.equal((await one<{ n: unknown }>(db, "select document_number($1,'tax_invoice',$2)as n", [c, inv.id])).n, null);
    assert.equal(await issue(c, "tax_invoice", inv.id), `TAX-${year}-0001`);
    assert.equal(await issue(c, "tax_invoice", inv.id), `TAX-${year}-0001`, "re-issuing keeps the number");
    assert.equal(await issue(c, "tax_invoice", inv2.id), `TAX-${year}-0002`);
    const got = (await one<{ n: { number: string; date: string } }>(db, "select document_number($1,'tax_invoice',$2)as n", [c, inv.id])).n;
    assert.equal(got.number, `TAX-${year}-0001`);
    assert.match(got.date, /^\d{4}-\d{2}-\d{2}$/);

    // Receipts: only from an income payment or a fully paid invoice.
    await rejects(issue(c, "receipt", inv.id), /ใบเสร็จ/);
    await rejects(issue(c, "tax_invoice", cus.id), /ใบแจ้งหนี้/);
    const pay = await save(c, "payments", { name: "รับโอน", invoiceId: inv.id, direction: "income", date: "2026-11-20", amount: 256800, method: "โอนธนาคาร" });
    assert.equal(await issue(c, "receipt", pay.id), `RC-${year}-0001`);
    assert.equal(await issue(c, "receipt", inv.id), `RC-${year}-0002`, "the invoice is paid in full now");
    const spend = await save(c, "payments", { name: "จ่ายค่าเช่า", direction: "expense", date: "2026-11-20", amount: 100, method: "เงินสด" });
    await rejects(issue(c, "receipt", spend.id), /ใบเสร็จ/);

    // One call lists every issued number (migration 0047).
    const list = (await db.query<{ kind: string; entity_id: string; number: string; date: string }>("select * from issued_documents_list($1)", [c])).rows;
    assert.deepEqual(new Set(list.map((r) => r.number)), new Set([`TAX-${year}-0001`, `TAX-${year}-0002`, `RC-${year}-0001`, `RC-${year}-0002`]));
    assert.ok(list.some((r) => r.kind === "receipt" && r.entity_id === pay.id && /^\d{4}-\d{2}-\d{2}$/.test(r.date)));

    // A Sales-only member cannot issue or read; another company cannot either.
    await db.exec("reset role;");
    await db.query("insert into memberships(company_id,user_id,email,role,departments)values($1,$2,'sales@test.local','staff','{Sales}')", [c, sales]);
    await login(sales);
    await rejects(issue(c, "tax_invoice", inv2.id), /ไม่มีสิทธิ์/);
    assert.equal((await one<{ n: unknown }>(db, "select document_number($1,'tax_invoice',$2)as n", [c, inv.id])).n, null);
    assert.equal((await db.query("select * from issued_documents_list($1)", [c])).rows.length, 0, "Sales cannot list Finance documents");
    await login(other);
    const d = (await one<{ id: string }>(db, "select create_company('B')as id")).id;
    await rejects(issue(d, "tax_invoice", inv.id), /ไม่พบเอกสาร/);
    await rejects(issue(c, "tax_invoice", inv.id), /ไม่มีสิทธิ์/);
    await rejects(db.query("select * from issued_documents"), /permission/);
  } finally {
    await db.close();
  }
});
