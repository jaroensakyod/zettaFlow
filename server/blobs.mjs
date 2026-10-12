import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function createBlobs(mode) {
  if (mode === "firebase") {
    const { getStorage } = await import("firebase-admin/storage");
    const bucket = getStorage().bucket(
      process.env.FIREBASE_STORAGE_BUCKET ||
        `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
    );
    return {
      put: async (key, bytes, type) =>
        bucket
          .file(`zettaflow/${key}`)
          .save(bytes, { resumable: false, metadata: { contentType: type } }),
      get: async (key) => (await bucket.file(`zettaflow/${key}`).download())[0],
    };
  }
  const root = resolve(process.env.BLOB_DIRECTORY || ".data/files");
  await mkdir(root, { recursive: true });
  return {
    put: async (key, bytes) => writeFile(resolve(root, key), bytes),
    get: (key) => readFile(resolve(root, key)),
  };
}
