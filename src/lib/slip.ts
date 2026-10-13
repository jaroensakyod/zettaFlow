// Thai bank transfer slip verification (mini-QR printed on every slip).
// Payload is EMVCo-style TLV: tag 00 holds sub-tags 01 (API id), 02 (sending bank), 03 (transaction ref);
// tag 51 = country "TH"; tag 91 = CRC16-CCITT of everything before its value.
// The QR proves a real transfer reference exists and lets us block re-used slips;
// the amount itself is read by AI/OCR from the slip image and compared with the expected amount.
import jsQR from "jsqr";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export function parseTlv(s: string) {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2),
      len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > s.length)
      return null;
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return i === s.length ? out : null;
}
export function crc16(s: string) {
  let crc = 0xffff;
  for (const byte of Buffer.from(s, "utf8")) {
    crc ^= byte << 8;
    for (let b = 0; b < 8; b++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
export const bankCodes: Record<string, string> = {
  "002": "ธนาคารกรุงเทพ",
  "004": "ธนาคารกสิกรไทย",
  "006": "ธนาคารกรุงไทย",
  "011": "ธนาคารทหารไทยธนชาต",
  "014": "ธนาคารไทยพาณิชย์",
  "025": "ธนาคารกรุงศรีอยุธยา",
  "030": "ธนาคารออมสิน",
  "034": "ธ.ก.ส.",
  "069": "ธนาคารเกียรตินาคินภัทร",
  "022": "ธนาคารซีไอเอ็มบี",
  "024": "ธนาคารยูโอบี",
  "067": "ธนาคารทิสโก้",
  "073": "ธนาคารแลนด์ แอนด์ เฮ้าส์",
};
export type SlipQr = { transRef: string; sendingBank: string; bankName: string; raw: string };
/** Parse and checksum-verify a slip mini-QR payload. Returns null if it is not a valid slip QR. */
export function parseSlipQr(raw: string): SlipQr | null {
  const text = raw.trim();
  const top = parseTlv(text);
  if (!top || !top["00"] || !top["91"]) return null;
  const crcIndex = text.lastIndexOf("91" + "04" + top["91"]);
  if (crcIndex < 0 || crc16(text.slice(0, crcIndex + 4)) !== top["91"].toUpperCase())
    return null;
  if (top["51"] && top["51"] !== "TH") return null;
  const inner = parseTlv(top["00"]);
  if (!inner || !inner["02"] || !inner["03"]) return null;
  if (!/^\d{3}$/.test(inner["02"]) || !/^[A-Za-z0-9]{6,40}$/.test(inner["03"])) return null;
  return {
    transRef: inner["03"],
    sendingBank: inner["02"],
    bankName: bankCodes[inner["02"]] || "ธนาคาร " + inner["02"],
    raw: text,
  };
}
/** Decode the first QR code found in a PNG/JPEG image. */
export function decodeQr(bytes: Buffer, mime: string): string | null {
  let width: number, height: number, data: Uint8ClampedArray;
  if (mime === "image/png") {
    const png = PNG.sync.read(bytes);
    ({ width, height } = png);
    data = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length);
  } else if (mime === "image/jpeg") {
    const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 256 });
    ({ width, height } = img);
    data = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length);
  } else return null;
  return jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}
export type SlipCheck = {
  status: "verified" | "mismatch" | "duplicate" | "unreadable";
  transRef?: string;
  bankName?: string;
  sendingBank?: string;
  amount?: number | null;
  expected?: number | null;
  message: string;
};
/** Combine QR evidence, the AI-read amount and the ledger of used refs into a verdict. */
export function judgeSlip(
  qr: SlipQr | null,
  amount: number | null | undefined,
  expected: number | null | undefined,
  alreadyUsed: boolean,
): SlipCheck {
  if (!qr) return { status: "unreadable", message: "อ่าน QR บนสลิปไม่ได้ กรุณาส่งรูปสลิปที่ชัดและไม่ถูกครอป" };
  const base = { transRef: qr.transRef, bankName: qr.bankName, sendingBank: qr.sendingBank, amount: amount ?? null, expected: expected ?? null };
  if (alreadyUsed) return { ...base, status: "duplicate", message: `สลิปนี้ถูกใช้แล้ว (Ref ${qr.transRef})` };
  if (expected != null && (amount == null || Math.abs(amount - expected) > 0.009))
    return { ...base, status: "mismatch", message: `ยอดในสลิป ${amount ?? "อ่านไม่ได้"} ไม่ตรงกับยอดที่ต้องชำระ ${expected}` };
  return { ...base, status: "verified", message: `สลิปถูกต้อง · ${qr.bankName} · Ref ${qr.transRef}` };
}
