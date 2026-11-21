// npm run d1:local — resets the local D1 database (.data/d1.sqlite, or D1_FILE): deletes it and creates it again with
// every migration in cloudflare/d1 (schema, users, seed rows). Starts nothing else. Files in .data/d1-blobs are kept.
import { rmSync } from "node:fs";
import { LOCAL_FILE, openLocalD1 } from "../src/lib/d1/local";

const file = LOCAL_FILE();
for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
const sql = openLocalD1(file);
const [n] = await sql.all<{ n: number }>("SELECT count(*) AS n FROM entity_schemas");
console.log(`${file} ready: ${n.n} entity schemas. Run the app with DATA_BACKEND=d1 D1_DEV_USER=<email> npm run dev`);
