// Files that arrive from a LINE group: what we accept, how big, and how each kind reaches the AI.
// Images and PDFs go to the AI as files. Excel / Word / CSV / text are turned into plain text first (no AI file cost,
// works with every provider). Voice messages are transcribed, and the transcript is read like a typed message.
import { parseCsv, parseXlsxSheets, unzip, xmlText } from "./importer";

export type LineFileKind = "image" | "pdf" | "sheet" | "doc" | "text" | "audio";
export type LineFile = { kind: LineFileKind; mime: string; name: string };

export const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  txt: "text/plain",
  m4a: "audio/mp4",
} as const;

/** Largest file taken from LINE (the attachments table allows 15 MB). */
export const LINE_MAX_BYTES = 10_000_000;
/** Longest voice message that is transcribed (LINE reports the length in ms). */
export const VOICE_MAX_MS = 5 * 60_000;
/** Most characters of a spreadsheet / document passed on to the AI. */
export const TEXT_MAX_CHARS = 20_000;

const ext = (name: string) => /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() || "";
const isZip = (b: Buffer) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;
const isOle = (b: Buffer) => b.length > 8 && b.readUInt32BE(0) === 0xd0cf11e0; // old .xls / .doc

/**
 * Decides what a LINE file is from its bytes, the content type LINE sent and the file name (LINE often sends
 * application/octet-stream for documents). Returns a Thai message for files we do not take.
 */
export function classifyLineFile(input: { bytes: Buffer; mime: string; name: string; messageType: string }): LineFile | { error: string } {
  const { bytes, name, messageType } = input,
    mime = (input.mime || "").toLowerCase(),
    e = ext(name);
  if (messageType === "audio") return { kind: "audio", mime: MIME.m4a, name: name || "voice.m4a" };
  if (["image/png", "image/jpeg", "image/webp"].includes(mime)) return { kind: "image", mime, name };
  if (mime === "application/pdf" || (e === "pdf" && bytes.subarray(0, 4).toString() === "%PDF"))
    return { kind: "pdf", mime: "application/pdf", name };
  if (isOle(bytes) || ["xls", "doc"].includes(e))
    return { error: `ไฟล์ ${name} เป็น Excel/Word แบบเก่า (.xls/.doc) — กรุณาบันทึกเป็น .xlsx / .docx หรือ PDF แล้วส่งใหม่` };
  if (isZip(bytes)) {
    if (e === "xlsx" || mime === MIME.xlsx) return { kind: "sheet", mime: MIME.xlsx, name };
    if (e === "docx" || mime === MIME.docx) return { kind: "doc", mime: MIME.docx, name };
    const inner = unzip(bytes, (n) => n === "xl/workbook.xml" || n === "word/document.xml");
    if (inner["xl/workbook.xml"]) return { kind: "sheet", mime: MIME.xlsx, name };
    if (inner["word/document.xml"]) return { kind: "doc", mime: MIME.docx, name };
  }
  if (e === "csv" || mime === "text/csv") return { kind: "text", mime: MIME.csv, name };
  if (e === "txt" || mime === "text/plain") return { kind: "text", mime: MIME.txt, name };
  if (["audio/x-m4a", "audio/m4a", "audio/mp4", "audio/aac", "audio/mpeg"].includes(mime) || ["m4a", "mp3", "aac"].includes(e))
    return { kind: "audio", mime: mime === "audio/mpeg" || e === "mp3" ? "audio/mp3" : MIME.m4a, name };
  return { error: `ยังไม่รองรับไฟล์ ${name || "นี้"} — ส่งได้: รูป, PDF, Excel (.xlsx), Word (.docx), CSV และข้อความเสียง` };
}

const cut = (s: string) => (s.length > TEXT_MAX_CHARS ? s.slice(0, TEXT_MAX_CHARS) + "\n…(ตัดส่วนที่เหลือ)" : s);

/** Word: paragraphs on their own lines, table cells separated by " | ". */
export function docxText(bytes: Buffer): string {
  const xml = unzip(bytes, (n) => n === "word/document.xml")["word/document.xml"] || "";
  return xmlText(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      // A table row is one line: paragraphs inside a cell join with a space, cells with " | ".
      .replace(/<w:tc[ >][\s\S]*?<\/w:tc>/g, (cell) => cell.replace(/<\/w:p>/g, " ").trim() + " | ")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:p>/g, "\n"),
  )
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, " ").replace(/\s*\|\s*$/, "").trim())
    .filter(Boolean)
    .join("\n");
}

/** Excel: each sheet as tab-separated rows under its name. */
export function xlsxText(bytes: Buffer): string {
  return parseXlsxSheets(bytes, 5)
    .map((s) => `[ชีต: ${s.name}]\n` + s.rows.slice(0, 400).map((r) => r.join("\t")).join("\n"))
    .join("\n\n");
}

/** Plain text a document carries, for the AI to read alongside the message (empty for images, PDFs and audio). */
export function documentText(file: { mime: string; name: string; bytes: Buffer }): string | null {
  const c = classifyLineFile({ bytes: file.bytes, mime: file.mime, name: file.name, messageType: "file" });
  if ("error" in c) return null;
  if (c.kind === "sheet") return cut(xlsxText(file.bytes));
  if (c.kind === "doc") return cut(docxText(file.bytes));
  if (c.kind === "text")
    return cut(
      c.mime === MIME.csv
        ? parseCsv(file.bytes.toString("utf8")).map((r) => r.join("\t")).join("\n")
        : file.bytes.toString("utf8").replace(/^﻿/, ""),
    );
  return null;
}
export const isAudio = (mime: string) => mime.startsWith("audio/");

/** Images up to this size are kept as sent (small screenshots, slips). */
export const SHRINK_FROM_BYTES = 500_000;
/** Longest side after shrinking: receipts and small print stay readable for people and the AI. */
export const SHRINK_MAX_SIDE = 2000;

/**
 * Phone photos from LINE are stored as JPEG (quality 82, at most 2000 px) instead of the original, usually 60–75%
 * smaller. JPEG rather than WebP because the slip QR reader (slip.ts decodeQr) reads only JPEG/PNG. A picture whose QR
 * code reads before but not after is kept as sent, and so is anything sharp cannot process.
 */
export async function shrinkImage(bytes: Buffer, mime: string): Promise<{ bytes: Buffer; mime: string; shrunk: boolean }> {
  const keep = { bytes, mime, shrunk: false };
  // PNG = screenshots (bank slips, app screens): kept as sent so a QR code is never at risk. Camera photos are JPEG.
  if (!["image/jpeg", "image/webp"].includes(mime) || bytes.length <= SHRINK_FROM_BYTES) return keep;
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes, { failOn: "none" })
      .rotate() // honour the phone's EXIF orientation before it is dropped
      .resize({ width: SHRINK_MAX_SIDE, height: SHRINK_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (out.length >= bytes.length) return keep;
    const before = await quickQr(sharp, bytes);
    if (before && (await quickQr(sharp, out)) !== before) return keep;
    return { bytes: out, mime: "image/jpeg", shrunk: true };
  } catch {
    return keep;
  }
}

/** QR text read at the size the stored copy will have (≤2000 px), so a code readable there survives the shrink. */
async function quickQr(sharp: typeof import("sharp").default, bytes: Buffer): Promise<string | null> {
  try {
    const jsQR = (await import("jsqr")).default;
    const { data, info } = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize({ width: SHRINK_MAX_SIDE, height: SHRINK_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height)?.data ?? null;
  } catch {
    return null;
  }
}
