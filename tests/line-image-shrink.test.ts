import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import jsQR from "jsqr";
import { shrinkImage, SHRINK_MAX_SIDE } from "../src/lib/line-files";
import { qrMatrix, qrSvgPath } from "../src/lib/promptpay";

/** Paper under room light: a soft gradient with sensor-like grain (big as a JPEG, like a phone photo). */
async function paper(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 3;
  for (let y = 0, i = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++, i++) raw[i] = 200 + ((x + y) * 40) / (width + height) - (((seed = (seed * 1103515245 + 12345) >>> 0) >>> 24) % 14);
  return sharp(raw, { raw: { width, height, channels: 3 } });
}
/** A phone-photo-like picture: noisy and large, so it does not compress away. */
async function photo(width: number, height: number, format: "jpeg" | "png", amp = 256) {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let i = 0; i < raw.length; i++) raw[i] = amp === 256 ? ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 24) & 0xff : 230 - (((seed = (seed * 1103515245 + 12345) >>> 0) >>> 24) % amp);
  const img = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === "jpeg" ? img.jpeg({ quality: 95 }).toBuffer() : img.png().toBuffer();
}
async function readQr(bytes: Buffer) {
  const { data, info } = await sharp(bytes).resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height)?.data ?? null;
}

test("LINE photos are stored as smaller JPEGs, at most 2000 px", async () => {
  const big = await photo(2400, 3200, "jpeg");
  const r = await shrinkImage(big, "image/jpeg");
  assert.equal(r.shrunk, true);
  assert.equal(r.mime, "image/jpeg");
  assert.ok(r.bytes.length < big.length * 0.75, `${r.bytes.length} vs ${big.length}`);
  const meta = await sharp(r.bytes).metadata();
  assert.ok(Math.max(meta.width!, meta.height!) <= SHRINK_MAX_SIDE);
});

test("small images, PDFs and unreadable bytes are kept as sent", async () => {
  const small = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#fff" } }).png().toBuffer();
  assert.equal((await shrinkImage(small, "image/png")).shrunk, false);
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(900_000)]);
  assert.equal((await shrinkImage(pdf, "application/pdf")).shrunk, false);
  const junk = Buffer.alloc(900_000, 7);
  const kept = await shrinkImage(junk, "image/jpeg");
  assert.equal(kept.shrunk, false);
  assert.equal(kept.bytes, junk);
});

test("a photo of a receipt with a QR code: shrunk, and the QR still reads", async () => {
  const text = "0041000600000101030060217SLIPTEST1234567895102TH9104ABCD";
  const m = qrMatrix(text);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.length + 8} ${m.length + 8}" width="700" height="700" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${qrSvgPath(m)}" fill="#000"/></svg>`,
  );
  const qr = await sharp(svg).png().toBuffer();
  const bg = await (await paper(3000, 4000)).png().toBuffer();
  const shot = await sharp(bg).composite([{ input: qr, left: 900, top: 1500 }]).jpeg({ quality: 95 }).toBuffer();
  assert.ok(shot.length > 500_000, String(shot.length));
  assert.equal(await readQr(shot), text);
  const r = await shrinkImage(shot, "image/jpeg");
  assert.equal(r.shrunk, true);
  assert.ok(r.bytes.length < shot.length, `${r.bytes.length} vs ${shot.length}`);
  assert.equal(await readQr(r.bytes), text);
});

test("screenshots (PNG, e.g. bank slips) are always kept as sent", async () => {
  const big = await sharp(randomBytes(1200 * 1600 * 3), { raw: { width: 1200, height: 1600, channels: 3 } }).png().toBuffer();
  assert.ok(big.length > 500_000);
  const r = await shrinkImage(big, "image/png");
  assert.equal(r.shrunk, false);
  assert.equal(r.bytes, big);
});
