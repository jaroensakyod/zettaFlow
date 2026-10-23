// Bulk import for directory pages (ลูกค้า / Supplier / พนักงาน): a CSV or the first sheet of an .xlsx,
// header row matched to catalog field keys or Thai labels, each row saved through saveEntity (same checks as the form).
import { inflateRawSync } from "node:zlib";
import { assert } from "./domain";
import { catalog, statusLabels } from "./catalog";
import { saveEntity } from "./data";
import type { Context } from "./types";

const MAX_ROWS = 500;

/** RFC 4180 CSV (quoted fields, "" escapes, CRLF), BOM stripped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Reads the named entries of a zip (stored or deflated) via its central directory. */
function unzip(buf: Buffer, wanted: (name: string) => boolean) {
  const out: Record<string, string> = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert(eocd >= 0, "ไฟล์ Excel ไม่ถูกต้อง");
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    assert(buf.readUInt32LE(p) === 0x02014b50, "ไฟล์ Excel ไม่ถูกต้อง");
    const method = buf.readUInt16LE(p + 10),
      size = buf.readUInt32LE(p + 20),
      nameLen = buf.readUInt16LE(p + 28),
      extra = buf.readUInt16LE(p + 30),
      comment = buf.readUInt16LE(p + 32),
      local = buf.readUInt32LE(p + 42),
      name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    if (wanted(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28),
        data = buf.subarray(start, start + size);
      out[name] = (method === 8 ? inflateRawSync(data, { maxOutputLength: 50_000_000 }) : data).toString("utf8");
    }
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
const xmlText = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const columnIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** First worksheet of an .xlsx as rows of display strings (shared and inline strings, numbers as written). */
export function parseXlsx(buf: Buffer): string[][] {
  const files = unzip(buf, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const sheet = Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort()[0];
  assert(sheet, "ไม่พบชีตในไฟล์ Excel");
  const shared = [...(files["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const rows: string[][] = [];
  for (const r of files[sheet].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1],
        body = c[2] || "",
        ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1],
        type = /t="(\w+)"/.exec(attrs)?.[1],
        v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      const value = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? xmlText(body) : xmlText(v);
      row[ref ? columnIndex(ref) : row.length] = value;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const norm = (s: string) => s.replace(/\s|\*|\(.*?\)/g, "").toLowerCase();

/** Saves each data row; returns how many were created and the first errors (row numbers as in the file). */
export async function importRows(ctx: Context, kind: string, file: File) {
  const module = catalog[kind];
  assert(module && ["customers", "suppliers", "employees"].includes(kind), "นำเข้าได้เฉพาะลูกค้า Supplier และพนักงาน", 404);
  assert(file.size > 0 && file.size <= 4000000, "ไฟล์สูงสุด 4 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const rows = /\.xlsx$/i.test(file.name) ? parseXlsx(bytes) : parseCsv(bytes.toString("utf8"));
  assert(rows.length >= 2, "ไม่พบข้อมูล (แถวแรกต้องเป็นหัวคอลัมน์)");
  assert(rows.length - 1 <= MAX_ROWS, `นำเข้าได้ครั้งละไม่เกิน ${MAX_ROWS} แถว`);
  const fields = module.fields.filter((f) => !f.hidden && f.type !== "image" && f.type !== "lines" && f.type !== "relation");
  const columns = rows[0].map((h) => fields.find((f) => norm(f.key) === norm(h) || norm(f.label) === norm(h)));
  assert(columns.some((f) => f?.key === "name"), "ต้องมีคอลัมน์ชื่อ (name)");
  let created = 0;
  const errors: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const data: Record<string, unknown> = {};
    for (const f of fields) if (f.type === "select") data[f.key] = f.options?.[0];
    columns.forEach((f, c) => {
      const raw = (rows[i][c] ?? "").trim();
      if (!f || !raw) return;
      data[f.key] =
        f.type === "number"
          ? Number(raw.replace(/,/g, ""))
          : f.type === "select"
            ? f.options?.find((o) => o === raw || statusLabels[o] === raw) || raw
            : f.type === "date" && /^\d{5}$/.test(raw)
              ? new Date((Number(raw) - 25569) * 864e5).toISOString().slice(0, 10) // Excel serial date
              : raw;
    });
    try {
      await saveEntity(ctx, kind, data);
      created++;
    } catch (e) {
      if (errors.length < 20) errors.push(`แถว ${i + 1}: ${(e as Error).message}`);
    }
  }
  return { created, failed: rows.length - 1 - created, errors };
}
