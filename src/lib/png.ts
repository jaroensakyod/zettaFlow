// A minimal PNG encoder for black-and-white QR codes (no native image library: runs on Node, Vercel and Cloudflare
// Workers alike). 8-bit greyscale, each QR module drawn as `scale` × `scale` pixels, with a white quiet zone.
import { deflateSync } from "node:zlib";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length),
    view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * PNG of a QR matrix (true = dark module). `dark` is the module colour as a grey level (0 = black); light is white.
 */
export function qrPng(matrix: boolean[][], { scale = 16, quiet = 4, dark = 0x19 }: { scale?: number; quiet?: number; dark?: number } = {}) {
  const modules = matrix.length + quiet * 2,
    size = modules * scale;
  // Each row: filter byte 0, then one grey byte per pixel.
  const raw = new Uint8Array((size + 1) * size);
  for (let y = 0; y < size; y++) {
    const my = Math.floor(y / scale) - quiet,
      row = y * (size + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - quiet;
      raw[row + 1 + x] = matrix[my]?.[mx] ? dark : 0xff;
    }
  }
  const ihdr = new Uint8Array(13),
    v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
}
