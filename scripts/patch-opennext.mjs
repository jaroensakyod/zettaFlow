// Run before every Cloudflare build (npm run cf:build). @opennextjs/aws 4.2 imports `cookie` as a default export, but
// cookie 1.x has none (CommonJS with __esModule and named exports only), so on Workers every request carrying a cookie
// failed in the middleware with "Cannot read properties of undefined (reading 'parse')" (error 1101 after login).
// This switches those imports to a namespace import. Safe to run repeatedly; drop it once OpenNext ships the fix.
import { readFileSync, writeFileSync } from "node:fs";

const files = ["node_modules/@opennextjs/aws/dist/overrides/converters/edge.js", "node_modules/@opennextjs/aws/dist/overrides/converters/node.js"];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  const fixed = s.replace(/import (\w+) from "cookie";/, 'import * as $1 from "cookie";');
  if (fixed !== s) {
    writeFileSync(f, fixed);
    console.log("patched", f);
  }
}
