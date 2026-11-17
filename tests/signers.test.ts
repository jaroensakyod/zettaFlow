// ตราประทับและผู้ลงนาม (src/lib/signers.ts): what is accepted, and which signature goes on a document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSigners, signersProblem, signatureFor, stampFor } from "../src/lib/signers";
import { withSignatures } from "../src/lib/documents";

const SIGN = "data:image/png;base64,iVBORw0KGgo=";
const signers = JSON.stringify([
  { id: "a", name: "สมชาย ใจดี", position: "กรรมการผู้จัดการ", sign: SIGN },
  { id: "b", name: "สุดา", position: "ผู้จัดการฝ่ายบัญชี", sign: "" },
]);

test("signers: parsed safely, bad input rejected", () => {
  assert.equal(parseSigners(signers).length, 2);
  assert.deepEqual(parseSigners("not json"), []);
  assert.deepEqual(parseSigners(JSON.stringify([{ id: "x", name: "", sign: SIGN }])), []);
  assert.equal(parseSigners(JSON.stringify([{ id: "x", name: "ก", sign: "javascript:alert(1)" }]))[0].sign, "");
  assert.equal(signersProblem(signers), null);
  assert.match(signersProblem("{")!, /ไม่ถูกต้อง/);
  assert.match(signersProblem(JSON.stringify([{ id: "x", name: " " }]))!, /ชื่อ/);
  assert.match(signersProblem(JSON.stringify([{ id: "x", name: "ก", sign: "data:text/html;base64,AA==" }]))!, /ลายเซ็น/);
  assert.equal(parseSigners(JSON.stringify([{ id: "x", name: "ก", photo: SIGN }]))[0].photo, SIGN);
  assert.equal(parseSigners(JSON.stringify([{ id: "x", name: "ก", photo: "https://evil.example/p.png" }]))[0].photo, "");
  assert.match(signersProblem(JSON.stringify([{ id: "x", name: "ก", photo: "data:text/html;base64,AA==" }]))!, /รูปผู้ลงนาม/);
  assert.match(signersProblem(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: "x" + i, name: "ก" + i }))))!, /ไม่เกิน/);
});

test("signatures go on the document by name; the stamp on the approver; off when auto-sign is off", () => {
  const p = { signers, stamp: SIGN, autoSign: "1" };
  assert.equal(signatureFor(p, "สมชาย  ใจดี"), SIGN);
  assert.equal(signatureFor(p, "สุดา"), "");
  assert.equal(stampFor(p), SIGN);
  const m = withSignatures({ signatures: [{ role: "ผู้ออก", name: "สมชาย ใจดี", position: "" }, { role: "ผู้อนุมัติ", name: "สุดา", position: "" }] } as never, p);
  assert.equal(m.signatures[0].sign, SIGN);
  assert.equal(m.signatures[0].stamp, "");
  assert.equal(m.signatures[1].stamp, SIGN);
  const off = { ...p, autoSign: "0" };
  assert.equal(signatureFor(off, "สมชาย ใจดี"), "");
  assert.equal(stampFor(off), "");
});
