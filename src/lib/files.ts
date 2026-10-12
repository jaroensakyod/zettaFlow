import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { demoMutate, demoRead } from "./demo";
import { assert, canWrite, canRead } from "./domain";
import { supabaseServer } from "./supabase/server";
import { dbError } from "./data";
import type { Context, Attachment } from "./types";
export async function upload(
  ctx: Context,
  file: File,
  department: string,
  entityId: string | null,
) {
  assert(canWrite(ctx, department), "ไม่มีสิทธิ์อัปโหลดแผนกนี้", 403);
  assert(file.size > 0 && file.size <= 4000000, "ไฟล์สูงสุด 4 MB");
  assert(
    [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(file.type),
    "รองรับภาพ PDF CSV TXT และ XLSX",
  );
  const id = randomUUID(),
    bytes = Buffer.from(await file.arrayBuffer()),
    name = file.name.slice(0, 200);
  if (file.type === "application/pdf")
    assert(bytes.subarray(0, 5).toString() === "%PDF-", "ไฟล์ PDF ไม่ถูกต้อง");
  if (file.type === "image/png")
    assert(
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "ไฟล์ PNG ไม่ถูกต้อง",
    );
  if (file.type === "image/jpeg")
    assert(
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      "ไฟล์ JPEG ไม่ถูกต้อง",
    );
  if (file.type === "image/webp")
    assert(
      bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP",
      "ไฟล์ WebP ไม่ถูกต้อง",
    );
  const path = `${ctx.company.id}/${department}/${id}`;
  const attachment: Attachment = {
    id,
    company_id: ctx.company.id,
    entity_id: entityId,
    department,
    name,
    mime: file.type,
    size: file.size,
    path,
    created_at: new Date().toISOString(),
  };
  if (ctx.demo) {
    const root = resolve(".data/demo-files");
    await mkdir(root, { recursive: true });
    attachment.path = resolve(root, id);
    if (entityId)
      assert(
        (await demoRead()).entities.some(
          (e) =>
            e.id === entityId &&
            e.company_id === ctx.company.id &&
            !e.archived_at &&
            (e.department === department ||
              (e.kind === "projects" &&
                department === "Design" &&
                canRead(ctx, e.department))),
        ),
        "ไม่พบรายการอ้างอิง",
      );
    await writeFile(attachment.path, bytes);
    await demoMutate((s) => s.attachments.push(attachment));
    return attachment;
  }
  const sb = await supabaseServer();
  const { error } = await sb.storage
    .from("eliteflow-files")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  dbError(error);
  const { error: e } = await sb.rpc("add_attachment", {
    p_company: ctx.company.id,
    p_id: id,
    p_entity: entityId,
    p_department: department,
    p_name: name,
    p_mime: file.type,
    p_size: file.size,
    p_path: path,
  });
  if (e) {
    await sb.storage.from("eliteflow-files").remove([path]);
    dbError(e);
  }
  return attachment;
}
export async function files(ctx: Context, entityId?: string) {
  if (ctx.demo)
    return (await demoRead()).attachments.filter(
      (a) =>
        canRead(ctx, a.department) && (!entityId || a.entity_id === entityId),
    );
  const sb = await supabaseServer();
  let q = sb
    .from("attachments")
    .select("*")
    .eq("company_id", ctx.company.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (entityId) q = q.eq("entity_id", entityId);
  const { data, error } = await q;
  dbError(error);
  return (data || []) as Attachment[];
}
export async function download(ctx: Context, id: string) {
  let attachment: Attachment | undefined;
  if (ctx.demo)
    attachment = (await demoRead()).attachments.find(
      (a) => a.id === id && canRead(ctx, a.department),
    );
  else {
    const sb = await supabaseServer();
    const { data, error } = await sb
      .from("attachments")
      .select("*")
      .eq("company_id", ctx.company.id)
      .eq("id", id)
      .single();
    dbError(error);
    attachment = data || undefined;
  }
  assert(attachment, "ไม่พบเอกสาร", 404);
  if (ctx.demo)
    return {
      file: attachment,
      bytes: await (await import("node:fs/promises")).readFile(attachment.path),
    };
  const sb = await supabaseServer();
  const { data, error } = await sb.storage
    .from("eliteflow-files")
    .download(attachment.path);
  dbError(error);
  assert(data, "อ่านไฟล์ไม่ได้");
  return { file: attachment, bytes: Buffer.from(await data.arrayBuffer()) };
}
