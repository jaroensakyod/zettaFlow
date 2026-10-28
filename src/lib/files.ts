import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { demoMutate, demoRead } from "./demo";
import { assert, canWrite, canRead } from "./domain";
import { supabaseServer } from "./supabase/server";
import { dbError } from "./data";
import type { Context, Attachment } from "./types";
/**
 * Files go straight from the browser to Supabase Storage (signed upload URL), so they are not bound by the
 * ~4.5 MB request limit of the hosting functions. The bucket limit matches (migration 0026).
 */
export const MAX_UPLOAD = 15_000_000;
const MAX_UPLOAD_LABEL = "15 MB";
export const UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
function checkFile(mime: string, size: number) {
  assert(size > 0 && size <= MAX_UPLOAD, "ไฟล์สูงสุด " + MAX_UPLOAD_LABEL);
  assert(UPLOAD_TYPES.includes(mime), "รองรับภาพ PDF CSV TXT และ XLSX");
}
/** The first bytes must match the declared type (a renamed file is refused). */
function checkSignature(mime: string, bytes: Buffer) {
  if (mime === "application/pdf") assert(bytes.subarray(0, 5).toString() === "%PDF-", "ไฟล์ PDF ไม่ถูกต้อง");
  if (mime === "image/png") assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "ไฟล์ PNG ไม่ถูกต้อง");
  if (mime === "image/jpeg") assert(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255, "ไฟล์ JPEG ไม่ถูกต้อง");
  if (mime === "image/webp") assert(bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP", "ไฟล์ WebP ไม่ถูกต้อง");
}
const directInput = z.object({
  name: z.string().trim().min(1).max(500),
  mime: z.string().max(200),
  size: z.number().int().positive(),
  department: z.string().min(1).max(100),
  entityId: z.uuid().nullish(),
});

/** Step 1 of a direct upload: a fresh id and a one-time URL the browser PUTs the file to. Demo mode stores files on the server instead. */
export async function prepareUpload(ctx: Context, input: unknown) {
  const v = directInput.parse(input);
  assert(canWrite(ctx, v.department), "ไม่มีสิทธิ์อัปโหลดแผนกนี้", 403);
  checkFile(v.mime, v.size);
  if (ctx.demo) return { direct: false as const };
  const id = randomUUID(),
    path = `${ctx.company.id}/${v.department}/${id}`;
  const sb = await supabaseServer();
  const { data, error } = await sb.storage.from("eliteflow-files").createSignedUploadUrl(path);
  dbError(error);
  return { direct: true as const, id, url: data!.signedUrl };
}

/** Step 2: check what landed in storage (size, real file type), then record the attachment. */
export async function finishUpload(ctx: Context, input: unknown) {
  const v = directInput.extend({ id: z.uuid() }).parse(input);
  assert(canWrite(ctx, v.department), "ไม่มีสิทธิ์อัปโหลดแผนกนี้", 403);
  checkFile(v.mime, v.size);
  assert(!ctx.demo, "โหมดตัวอย่างใช้การอัปโหลดผ่าน server", 400);
  const path = `${ctx.company.id}/${v.department}/${v.id}`;
  const sb = await supabaseServer();
  const { data: blob, error } = await sb.storage.from("eliteflow-files").download(path);
  assert(!error && blob, "ไม่พบไฟล์ที่อัปโหลด กรุณาลองใหม่", 400);
  const bytes = Buffer.from(await blob.arrayBuffer());
  try {
    assert(bytes.length === v.size, "ไฟล์อัปโหลดไม่ครบ กรุณาลองใหม่");
    checkSignature(v.mime, bytes);
    const { error: e } = await sb.rpc("add_attachment", {
      p_company: ctx.company.id,
      p_id: v.id,
      p_entity: v.entityId || null,
      p_department: v.department,
      p_name: v.name.slice(0, 200),
      p_mime: v.mime,
      p_size: v.size,
      p_path: path,
    });
    dbError(e);
  } catch (err) {
    await sb.storage.from("eliteflow-files").remove([path]);
    throw err;
  }
  const attachment: Attachment = {
    id: v.id,
    company_id: ctx.company.id,
    entity_id: v.entityId || null,
    department: v.department,
    name: v.name.slice(0, 200),
    mime: v.mime,
    size: v.size,
    path,
    created_at: new Date().toISOString(),
  };
  return attachment;
}

export async function upload(
  ctx: Context,
  file: File,
  department: string,
  entityId: string | null,
) {
  assert(canWrite(ctx, department), "ไม่มีสิทธิ์อัปโหลดแผนกนี้", 403);
  checkFile(file.type, file.size);
  const id = randomUUID(),
    bytes = Buffer.from(await file.arrayBuffer()),
    name = file.name.slice(0, 200);
  checkSignature(file.type, bytes);
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
