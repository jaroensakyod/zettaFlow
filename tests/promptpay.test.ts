import { test } from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { crc16, promptPayPayload, qrMatrix } from "../src/lib/promptpay";

test("crc16 matches the CRC-16/CCITT-FALSE check value", () => {
  assert.equal(crc16("123456789"), "29B1");
});

// Known-good payloads from the reference implementation's test suite (dtinth/promptpay-qr index.test.js).
test("PromptPay payloads match the reference implementation", () => {
  const cases: [string, number | undefined, string][] = [
    ["0801234567", undefined, "00020101021129370016A000000677010111011300668012345675802TH530376463046197"],
    ["080-123-4567", undefined, "00020101021129370016A000000677010111011300668012345675802TH530376463046197"],
    ["+66-89-123-4567", undefined, "00020101021129370016A000000677010111011300668912345675802TH5303764630429C1"],
    ["1-1111-11111-11-1", undefined, "00020101021129370016A000000677010111021311111111111115802TH530376463047B5A"],
    ["0123456789012", undefined, "00020101021129370016A000000677010111021301234567890125802TH530376463040CBD"],
    ["012345678901234", undefined, "00020101021129390016A00000067701011103150123456789012345802TH530376463049781"],
    ["000-000-0000", 4.22, "00020101021229370016A000000677010111011300660000000005802TH530376454044.226304E469"],
  ];
  for (const [id, amount, expected] of cases) assert.equal(promptPayPayload(id, amount), expected, id);
});

test("PromptPay payload with amount, national ID and e-wallet", () => {
  const p = promptPayPayload("0812345678", 900);
  assert.match(p, /^000201010212/);
  assert.ok(p.includes("5406900.00"));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
  assert.ok(promptPayPayload("1234567890123").includes("29370016A0000006770101110213" + "1234567890123"));
  assert.ok(promptPayPayload("123456789012345").includes("29390016A0000006770101110315" + "123456789012345"));
  assert.throws(() => promptPayPayload("12345"));
});

function decode(text: string) {
  const m = qrMatrix(text);
  const scale = 4,
    quiet = 4,
    n = (m.length + quiet * 2) * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * n + (x + quiet) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
    }),
  );
  return jsQR(px, n, n)?.data;
}

test("QR encoder output decodes back (versions 1-10)", () => {
  for (const text of ["hi", promptPayPayload("0812345678", 900), promptPayPayload("123456789012345", 4000), "x".repeat(120), "ข".repeat(60)])
    assert.equal(decode(text), text);
});
