import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
export async function createStore(mode, path) {
  if (mode === "firebase") {
    const { initializeApp, applicationDefault } = await import(
      "firebase-admin/app"
    );
    const { getFirestore } = await import("firebase-admin/firestore");
    const { getAuth } = await import("firebase-admin/auth");
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    const db = getFirestore();
    const ref = (type, key) => db.collection(`zf_${type}`).doc(key);
    return {
      auth: getAuth(),
      get: async (type, key) => (await ref(type, key).get()).data() || null,
      list: async (type) =>
        (await db.collection(`zf_${type}`).get()).docs.map((d) => d.data()),
      put: async (type, key, value) => ref(type, key).set(value),
      mutate: async (type, key, fn) =>
        db.runTransaction(async (tx) => {
          const target = ref(type, key),
            current = (await tx.get(target)).data() || null;
          const next = fn(current);
          if (Buffer.byteLength(JSON.stringify(next)) > 700000)
            throw Object.assign(
              new Error("พื้นที่ MVP เต็ม กรุณาแยก collection ก่อนเพิ่มข้อมูล"),
              { status: 409 },
            );
          tx.set(target, next);
          return next;
        }),
      close: () => {},
    };
  }
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS entities (type TEXT, id TEXT, value TEXT, PRIMARY KEY(type,id));",
  );
  const get = (type, key) => {
    const row = db
      .prepare("SELECT value FROM entities WHERE type=? AND id=?")
      .get(type, key);
    return row ? JSON.parse(row.value) : null;
  };
  const put = (type, key, value) =>
    db
      .prepare(
        "INSERT INTO entities VALUES(?,?,?) ON CONFLICT(type,id) DO UPDATE SET value=excluded.value",
      )
      .run(type, key, JSON.stringify(value));
  return {
    get,
    put,
    list: (type) =>
      db
        .prepare("SELECT value FROM entities WHERE type=?")
        .all(type)
        .map((r) => JSON.parse(r.value)),
    mutate: (type, key, fn) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const value = fn(get(type, key));
        put(type, key, value);
        db.exec("COMMIT");
        return value;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => db.close(),
  };
}
