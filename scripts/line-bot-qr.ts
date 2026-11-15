// Writes public/line-bot-qr.svg: the QR code of the EliteFlow LINE bot's add-friend link (shown in the
// "เชื่อมต่อกลุ่ม LINE" window). Run again if the bot's LINE ID changes:  npx tsx scripts/line-bot-qr.ts @532csucn
import { writeFileSync } from "node:fs";
import { qrSvg } from "../src/lib/documents";
const id = process.argv[2] || "@532csucn";
writeFileSync("public/line-bot-qr.svg", qrSvg("https://line.me/R/ti/p/" + id, 40));
console.log("public/line-bot-qr.svg for " + id);
