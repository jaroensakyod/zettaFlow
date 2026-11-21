// Files of the D1 build (DATA_BACKEND=d1): the signed links made by storage.createSignedUrl (GET) and
// createSignedUploadUrl (PUT), and public files (getPublicUrl) of public buckets. The link's HMAC (BLOB_SECRET) is the
// permission: the storage rules were checked when it was signed.
import { NextResponse, type NextRequest } from "next/server";
import { buckets, blobSecret, safePath, verifyBlobUrl } from "@/lib/d1/blobs";
import { d1Blobs, d1Enabled } from "@/lib/d1/runtime";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ bucket: string; path: string[] }> };

const fail = (message: string, status: number) => NextResponse.json({ statusCode: String(status), error: message, message }, { status });
/** Bucket and path from the raw URL (each segment decoded once, the way signBlobUrl encoded it). */
function target(req: NextRequest) {
  try {
    const [b, ...rest] = req.nextUrl.pathname.replace(/^\/api\/blob\//, "").split("/").map(decodeURIComponent);
    const p = rest.join("/");
    return { bucket: b, path: p, ok: d1Enabled() && !!buckets[b] && safePath(p) };
  } catch {
    return { bucket: "", path: "", ok: false };
  }
}

export async function GET(req: NextRequest, _ctx: Ctx) {
  const { bucket, path, ok } = target(req);
  if (!ok) return fail("Object not found", 404);
  let download = "";
  if (!buckets[bucket].public) {
    const v = await verifyBlobUrl(blobSecret(), "get", bucket, path, req.nextUrl.searchParams);
    if (!v) return fail("Invalid signature", 400);
    download = v.extra;
  }
  const hit = await (await d1Blobs()).get(`${bucket}/${path}`);
  if (!hit) return fail("Object not found", 404);
  const headers = new Headers({
    "Content-Type": hit.info.contentType,
    "Content-Length": String(hit.bytes.byteLength),
    "Cache-Control": buckets[bucket].public ? "public, max-age=3600" : "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  if (download) headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(download)}`);
  return new Response(hit.bytes as unknown as BodyInit, { headers });
}

export async function PUT(req: NextRequest, _ctx: Ctx) {
  const { bucket, path, ok } = target(req);
  if (!ok) return fail("Bucket not found", 404);
  const v = await verifyBlobUrl(blobSecret(), "put", bucket, path, req.nextUrl.searchParams);
  if (!v) return fail("Invalid signature", 400);
  const rules = buckets[bucket],
    type = req.headers.get("content-type") || "application/octet-stream";
  if (rules.mimes && !rules.mimes.includes(type.split(";")[0].trim().toLowerCase())) return fail(`mime type ${type} is not supported`, 415);
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > rules.limit) return fail("The object exceeded the maximum allowed size", 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > rules.limit) return fail("The object exceeded the maximum allowed size", 413);
  const store = await d1Blobs(),
    key = `${bucket}/${path}`;
  if (v.extra !== "true" && (await store.head(key))) return fail("The resource already exists", 409);
  await store.put(key, bytes, type);
  return NextResponse.json({ Key: key });
}
