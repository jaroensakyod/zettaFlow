import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import jsQR from "jsqr";
import { qrPng } from "../src/lib/png";
import { promptPayPayload, qrMatrix } from "../src/lib/promptpay";

test("qrPng draws a PromptPay QR that a QR reader decodes back to the same payload", async () => {
  const payload = promptPayPayload("004666018608434", 3841.3);
  const png = qrPng(qrMatrix(payload));
  const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, (qrMatrix(payload).length + 8) * 16);
  assert.equal(jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height)?.data, payload);
});
