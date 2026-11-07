import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { classifyLineFile, docxText, documentText, xlsxText, MIME } from "../src/lib/line-files";

/** Minimal zip writer (deflate) so the tests build real .xlsx / .docx bytes. */
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8"),
      data = deflateRawSync(raw),
      n = Buffer.from(name),
      crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xlsx = zip({
  "xl/workbook.xml": '<workbook><sheets><sheet name="ค่าใช้จ่าย" sheetId="1"/><sheet name="สรุป" sheetId="2"/></sheets></workbook>',
  "xl/sharedStrings.xml": "<sst><si><t>รายการ</t></si><si><t>ยอด</t></si><si><t>ค่าน้ำมัน</t></si></sst>",
  "xl/worksheets/sheet1.xml":
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250</v></c></row></sheetData></worksheet>',
  "xl/worksheets/sheet2.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>รวม</t></is></c><c r="B1"><v>1250</v></c></row></sheetData></worksheet>',
});
const docx = zip({
  "word/document.xml":
    "<w:document><w:body><w:p><w:r><w:t>ขอเบิกค่าเดินทาง</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>ค่ารถ</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>500 บาท</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p></w:body></w:document>",
});

test("LINE files: what kind each file is (LINE often sends octet-stream)", () => {
  const k = (bytes: Buffer, mime: string, name: string, messageType = "file") => classifyLineFile({ bytes, mime, name, messageType });
  assert.deepEqual(k(xlsx, "application/octet-stream", "งบ.xlsx"), { kind: "sheet", mime: MIME.xlsx, name: "งบ.xlsx" });
  assert.deepEqual(k(docx, "application/octet-stream", "ใบขอเบิก.docx"), { kind: "doc", mime: MIME.docx, name: "ใบขอเบิก.docx" });
  // No extension: decided from what is inside the zip.
  assert.equal((k(xlsx, "", "file") as { kind: string }).kind, "sheet");
  assert.equal((k(docx, "", "file") as { kind: string }).kind, "doc");
  assert.equal((k(Buffer.from("%PDF-1.7"), "application/octet-stream", "a.pdf") as { kind: string }).kind, "pdf");
  assert.equal((k(Buffer.from("a,b\n1,2"), "text/csv", "a.csv") as { kind: string }).kind, "text");
  assert.equal((k(Buffer.from("x"), "audio/x-m4a", "", "audio") as { kind: string }).kind, "audio");
  assert.equal((k(Buffer.from("x"), "image/jpeg", "a.jpg", "image") as { kind: string }).kind, "image");
  // Old binary Office files and unknown types get a Thai explanation, not a crash.
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);
  assert.match((k(ole, "application/vnd.ms-excel", "เก่า.xls") as { error: string }).error, /\.xlsx/);
  assert.match((k(Buffer.from("MZ"), "application/x-msdownload", "a.exe") as { error: string }).error, /ยังไม่รองรับ/);
});

test("LINE files: Excel and Word become text the AI can read", () => {
  const x = xlsxText(xlsx);
  assert.match(x, /\[ชีต: ค่าใช้จ่าย\]\nรายการ\tยอด\nค่าน้ำมัน\t1250/);
  assert.match(x, /\[ชีต: สรุป\]\nรวม\t1250/);
  assert.equal(docxText(docx), "ขอเบิกค่าเดินทาง\nค่ารถ | 500 บาท\nA & B");
  assert.equal(documentText({ mime: MIME.csv, name: "a.csv", bytes: Buffer.from('รายการ,ยอด\n"ค่ารถ, ทางด่วน",80') }), "รายการ\tยอด\nค่ารถ, ทางด่วน\t80");
  assert.equal(documentText({ mime: "image/png", name: "a.png", bytes: Buffer.from("x") }), null);
  // Very long documents are cut before they reach the AI.
  const long = documentText({ mime: MIME.txt, name: "a.txt", bytes: Buffer.from("ก".repeat(30_000)) })!;
  assert.ok(long.length < 20_100 && long.endsWith("(ตัดส่วนที่เหลือ)"));
});
