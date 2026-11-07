// Mockup data for โครงการ (Projects): reproduces the Canva design (pages 13–14) so the list and the detail page can
// be shown complete before a company has real projects ("ดูตัวอย่าง"). Every project, person and figure here is
// fictional and always labelled ตัวอย่าง in the UI; ids start with "sample-" so the page never calls the API for them.
// Covers are inline SVG illustrations (data: URIs) — no external images.
import type { ActivityItem, CalendarItem, DocItem, LiteRow, Person, ProjectCard, ProjectDetailData, ProjectsOverview, SeriesPoint } from "@/lib/projects";

export const SAMPLE_PREFIX = "sample-";
export const isSampleId = (id: string | null | undefined) => !!id && id.startsWith(SAMPLE_PREFIX);
/** The "today" the mockup is drawn for (the design's dates: upcoming events on 15 / 20 / 28 ต.ค. 2569). */
export const SAMPLE_TODAY = "2026-10-12";

// ---------------------------------------------------------------- cover illustrations (flat SVG scenes)

const svg = (defs: string, body: string) =>
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300" width="640" height="300" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`,
  );
const lg = (id: string, a: string, b: string, dir: "v" | "h" | "d" = "v") =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${dir === "v" ? 0 : 1}" y2="${dir === "h" ? 0 : 1}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const r = (x: number, y: number, w: number, h: number, fill: string, rx = 0, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
const c = (x: number, y: number, rad: number, fill: string, extra = "") => `<circle cx="${x}" cy="${y}" r="${rad}" fill="${fill}" ${extra}/>`;
const t = (x: number, y: number, size: number, fill: string, text: string, extra = "") =>
  `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="700" fill="${fill}" text-anchor="middle" ${extra}>${text}</text>`;
/** A grid of windows. */
const grid = (x: number, y: number, cols: number, rows: number, w: number, h: number, gx: number, gy: number, fill: string, lit = "") => {
  let s = "";
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) s += r(x + j * (w + gx), y + i * (h + gy), w, h, lit && (i * 7 + j * 3) % 5 === 0 ? lit : fill, 1.5);
  return s;
};
const cloud = (x: number, y: number, s = 1) =>
  `<g fill="#fff" opacity=".9" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="34" ry="13"/><circle cx="-12" cy="-8" r="14"/><circle cx="10" cy="-12" r="17"/></g>`;
const tree = (x: number, y: number, rad: number, fill = "#5bb978") => r(x - 2.5, y, 5, rad * 0.9, "#8a6a4a", 2) + c(x, y - rad * 0.2, rad, fill) + c(x - rad * 0.5, y + rad * 0.1, rad * 0.7, fill);
const palm = (x: number, y: number, s = 1, flip = 1) => {
  const leaf = (a: number, col: string) =>
    `<path d="M0 0 C 18 -14 44 -12 62 6 C 40 -2 20 0 0 0Z" fill="${col}" transform="rotate(${a})"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s * flip} ${s})"><path d="M0 0 C 6 40 2 80 -8 120" stroke="#9b6b3e" stroke-width="8" fill="none" stroke-linecap="round"/><g>${leaf(-160, "#2f9e5e")}${leaf(-110, "#3cb371")}${leaf(-60, "#2f9e5e")}${leaf(-10, "#46c27e")}${leaf(30, "#3cb371")}${leaf(160, "#46c27e")}</g></g>`;
};

const coverCondo = svg(
  lg("s", "#8ecdfc", "#e6f4ff") + lg("tw", "#ffffff", "#dfe8f6") + lg("p", "#4cc3f0", "#2b8fd6"),
  r(0, 0, 640, 300, "url(#s)") +
    c(555, 62, 30, "#fff3c4") +
    cloud(110, 56) +
    cloud(470, 40, 0.8) +
    r(60, 120, 92, 140, "#c9d8ef") + grid(70, 132, 4, 9, 14, 8, 6, 6, "#a9bfe0") +
    r(500, 110, 96, 150, "#cbd9ef") + grid(510, 122, 4, 10, 14, 8, 7, 5, "#a7bde0") +
    r(170, 70, 120, 190, "url(#tw)") + r(170, 62, 120, 10, "#b9c9e3") + grid(182, 84, 5, 13, 14, 8, 8, 5.5, "#79a6d9", "#ffe7a3") +
    r(305, 36, 150, 224, "url(#tw)") + r(305, 28, 150, 10, "#a9bce0") + r(372, 14, 16, 16, "#a9bce0") + grid(318, 52, 6, 15, 14, 8, 9, 5.6, "#6b9ad6", "#ffe7a3") +
    r(305, 36, 6, 224, "#cfdbee") +
    r(0, 248, 640, 52, "#bfe3c0") +
    r(150, 262, 340, 30, "url(#p)", 6) + r(170, 270, 120, 3, "#bdeeff", 2) + r(330, 280, 130, 3, "#bdeeff", 2) +
    tree(40, 250, 18) + tree(132, 252, 14, "#4aa86a") + tree(512, 252, 15) + tree(600, 250, 19, "#4aa86a") + tree(160, 250, 10),
);

const coverClinic = svg(
  lg("w", "#fde9e6", "#f7cfd3") + lg("m", "#fffaf6", "#f6e3dc") + lg("f", "#f4e3da", "#ead2c6"),
  r(0, 0, 640, 300, "url(#w)") +
    r(0, 228, 640, 72, "url(#f)") +
    `<path d="M230 228 V110 A90 90 0 0 1 410 110 V228Z" fill="url(#m)" stroke="#e7c3b5" stroke-width="4"/>` +
    `<text x="320" y="150" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="34" fill="#c58f80" text-anchor="middle">Elite Clinic</text>` +
    r(282, 162, 76, 2, "#e2b8a8") +
    `<g stroke="#d9a99a" stroke-width="2">` +
    [110, 530].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="64"/>`).join("") +
    `</g>` +
    c(110, 76, 15, "#fff4d6", 'stroke="#f0d9a8" stroke-width="2"') + c(530, 76, 15, "#fff4d6", 'stroke="#f0d9a8" stroke-width="2"') +
    c(110, 82, 40, "#fff7df", 'opacity=".35"') + c(530, 82, 40, "#fff7df", 'opacity=".35"') +
    r(200, 206, 240, 58, "#ffffff", 14) + r(200, 224, 240, 6, "#e2c29b") + r(214, 238, 212, 3, "#f1e2d6", 2) +
    `<ellipse cx="88" cy="252" rx="40" ry="16" fill="#f3b5c0"/>` + r(56, 214, 64, 36, "#f6c2cb", 16) +
    `<ellipse cx="552" cy="252" rx="40" ry="16" fill="#f3b5c0"/>` + r(520, 214, 64, 36, "#f6c2cb", 16) +
    r(600, 200, 24, 46, "#e9d7c7", 6) + `<path d="M612 200 C600 170 590 160 584 150 M612 200 C614 168 620 156 628 146 M612 200 C626 178 636 172 640 170" stroke="#7fb069" stroke-width="5" fill="none" stroke-linecap="round"/>`,
);

const coverExpo = svg(
  lg("b", "#1a0d3d", "#40177a") + lg("beam1", "#ff5fd2", "#ff5fd200") + lg("beam2", "#6ad4ff", "#6ad4ff00") + lg("run", "#5b2aa8", "#2a1458"),
  r(0, 0, 640, 300, "url(#b)") +
    r(0, 0, 640, 16, "#2b1460") + Array.from({ length: 16 }, (_, i) => c(20 + i * 40, 12, 3.5, i % 2 ? "#ffe27a" : "#ff8de6")).join("") +
    `<polygon points="60,10 90,10 210,260 0,260" fill="url(#beam1)" opacity=".45"/>` +
    `<polygon points="550,10 580,10 640,260 430,260" fill="url(#beam2)" opacity=".45"/>` +
    `<polygon points="300,10 340,10 420,250 220,250" fill="url(#beam1)" opacity=".18"/>` +
    r(190, 36, 260, 138, "#12062e", 10, 'stroke="#ff4fd8" stroke-width="4"') +
    r(198, 44, 244, 122, "none", 6, 'stroke="#7fe3ff" stroke-width="1.5" opacity=".7"') +
    t(320, 88, 32, "#ffffff", "BANGKOK", 'letter-spacing="3"') +
    t(320, 122, 25, "#ff8de6", "FASHION EXPO", 'letter-spacing="2"') +
    t(320, 156, 26, "#7fe3ff", "2026", 'letter-spacing="6"') +
    `<polygon points="290,182 350,182 430,300 210,300" fill="url(#run)"/>` +
    `<line x1="320" y1="186" x2="320" y2="300" stroke="#ff8de6" stroke-width="2" stroke-dasharray="8 8" opacity=".7"/>` +
    r(0, 250, 640, 50, "#0f0628", 0, 'opacity=".55"') +
    Array.from({ length: 14 }, (_, i) => {
      const x = 16 + i * 46 + (i > 6 ? 40 : 0);
      return x > 200 && x < 440 ? "" : c(x, 262, 13, "#0b0420") + r(x - 17, 270, 34, 40, "#0b0420", 14);
    }).join(""),
);

const coverResort = svg(
  lg("s", "#86d6ff", "#eafcff") + lg("sea", "#39c3dc", "#1f99c2") + lg("pool", "#7fe0f5", "#36b8de"),
  r(0, 0, 640, 300, "url(#s)") +
    c(90, 60, 26, "#fff2b8") + cloud(250, 50, 0.9) + cloud(520, 70, 0.7) +
    r(0, 168, 640, 50, "url(#sea)") + r(40, 182, 80, 3, "#bff3ff", 2) + r(500, 196, 90, 3, "#bff3ff", 2) +
    r(0, 214, 640, 86, "#f6e2b3") +
    `<polygon points="220,120 320,70 420,120" fill="#b47a48"/>` + `<polygon points="238,120 320,80 402,120" fill="#c98d57"/>` +
    r(236, 120, 168, 82, "#fffaf0") + grid(250, 132, 5, 2, 22, 18, 8, 10, "#7ccbe6") + r(305, 168, 30, 34, "#b47a48", 3) +
    `<polygon points="150,150 205,124 260,150" fill="#c98d57"/>` + r(160, 150, 90, 52, "#fff6e6") + grid(172, 160, 3, 1, 20, 16, 8, 0, "#7ccbe6") +
    `<polygon points="380,150 435,124 490,150" fill="#c98d57"/>` + r(390, 150, 90, 52, "#fff6e6") + grid(402, 160, 3, 1, 20, 16, 8, 0, "#7ccbe6") +
    `<ellipse cx="320" cy="250" rx="150" ry="24" fill="url(#pool)"/>` + `<ellipse cx="320" cy="248" rx="120" ry="10" fill="#bff3ff" opacity=".45"/>` +
    r(120, 238, 46, 8, "#ffffff", 4) + r(474, 238, 46, 8, "#ffffff", 4) +
    `<path d="M116 236 l-6 -18 M520 236 l6 -18" stroke="#ff8a5c" stroke-width="4"/>` +
    palm(70, 120, 1, 1) + palm(570, 112, 1.05, -1) + palm(130, 150, 0.7, -1),
);

const coverSkin = svg(
  lg("bg", "#fcf3ea", "#f1dfcf") + lg("am", "#f2c49b", "#d98f5f") + lg("gl", "#fff", "#f2ece6"),
  r(0, 0, 640, 300, "url(#bg)") +
    c(520, 70, 90, "#fbe6d6", 'opacity=".8"') + c(130, 230, 120, "#f6e4d5", 'opacity=".6"') +
    r(60, 236, 520, 14, "#e6cdb6", 7) + r(60, 248, 520, 52, "#efdccb") +
    // vase + leaves
    r(80, 170, 46, 66, "#ffffff", 18) + `<path d="M103 172 C90 120 70 100 58 92 M103 172 C104 118 112 96 124 80 M103 172 C120 130 140 118 150 112" stroke="#7fb069" stroke-width="6" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="62" cy="96" rx="16" ry="8" fill="#8cc275" transform="rotate(-40 62 96)"/><ellipse cx="124" cy="84" rx="16" ry="8" fill="#7fb069" transform="rotate(-70 124 84)"/><ellipse cx="148" cy="114" rx="16" ry="8" fill="#8cc275" transform="rotate(-20 148 114)"/>` +
    // pump bottle
    r(176, 120, 58, 116, "url(#gl)", 14, 'stroke="#e9dccf" stroke-width="2"') + r(196, 98, 18, 24, "#d6b28f", 3) + r(190, 90, 40, 9, "#d6b28f", 4) + r(186, 160, 38, 40, "#f6efe8", 4) + t(205, 186, 11, "#b98a6a", "SERUM") +
    // amber tall bottle
    r(256, 96, 50, 140, "url(#am)", 12) + r(268, 74, 26, 24, "#7a4b2e", 4) + r(264, 150, 34, 46, "#fff7ee", 4) + t(281, 178, 10, "#b9774a", "NEW") +
    // jar
    r(330, 182, 92, 54, "#ffffff", 14, 'stroke="#eadccd" stroke-width="2"') + r(326, 166, 100, 20, "#d9b38c", 8) + t(376, 216, 12, "#c79a74", "CREAM") +
    // dropper
    r(444, 140, 42, 96, "#c98a6e", 10) + r(456, 112, 18, 30, "#3f2a22", 6) + c(465, 106, 10, "#3f2a22") + r(452, 176, 26, 30, "#fff3ea", 3) +
    // tube
    `<path d="M512 236 L520 120 L560 120 L568 236Z" fill="#fde3ea"/>` + r(526, 106, 28, 16, "#f3a6bd", 3) + t(540, 190, 10, "#d9748f", "SPF"),
);

const coverCampaign = svg(
  lg("bg", "#f7c6ff", "#b9a8ff", "d") + lg("scr", "#ffffff", "#f3eeff"),
  r(0, 0, 640, 300, "url(#bg)") +
    c(110, 70, 60, "#ffffff", 'opacity=".25"') + c(560, 240, 80, "#ffffff", 'opacity=".2"') +
    // laptop
    r(150, 70, 250, 160, "#2c2452", 12) + r(162, 82, 226, 136, "url(#scr)", 6) +
    `<polyline points="178,190 214,170 246,178 282,140 316,150 360,104" fill="none" stroke="#7c4dff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    c(360, 104, 6, "#ff5fa2") + r(180, 200, 14, 12, "#c9b8ff", 2) + r(204, 194, 14, 18, "#c9b8ff", 2) + r(228, 188, 14, 24, "#b39cff", 2) +
    r(176, 94, 70, 8, "#e3dbff", 4) + r(176, 108, 44, 6, "#efeaff", 3) +
    `<path d="M120 230 H430 L410 250 H140Z" fill="#d9d1ff"/>` +
    // megaphone
    `<g transform="translate(470 120) rotate(-18)"><polygon points="0,20 90,-30 90,90 0,40" fill="#ff6fae"/><rect x="-26" y="14" width="30" height="32" rx="6" fill="#ffd0e4"/><rect x="86" y="-34" width="14" height="128" rx="7" fill="#ff4f97"/><rect x="10" y="40" width="16" height="44" rx="5" fill="#7c4dff"/><path d="M112 0 q18 30 0 60 M126 -14 q30 44 0 88" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9"/></g>` +
    // SALE tag
    `<g transform="translate(46 160) rotate(-14)"><rect width="96" height="50" rx="10" fill="#ffd84d"/><text x="48" y="33" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800" fill="#7a2fd0" text-anchor="middle">SALE</text></g>` +
    [
      [60, 40, "#ffd84d"], [250, 34, "#ff6fae"], [430, 52, "#ffffff"], [600, 60, "#ffd84d"], [450, 260, "#7c4dff"], [96, 262, "#ff6fae"], [600, 150, "#ffffff"],
    ].map(([x, y, f]) => r(x as number, y as number, 10, 6, f as string, 2, `transform="rotate(30 ${x} ${y})"`)).join(""),
);

const phone = (x: number, y: number, rot: number, accent: string) =>
  `<g transform="translate(${x} ${y}) rotate(${rot})">` +
  r(0, 0, 130, 240, "#2d2552", 22) + r(8, 10, 114, 220, "#ffffff", 16) + r(50, 14, 30, 6, "#2d2552", 3) +
  r(8, 10, 114, 52, accent, 16) + r(8, 46, 114, 16, accent) + c(30, 36, 10, "#ffffff", 'opacity=".9"') + r(46, 28, 52, 6, "#ffffff", 3, 'opacity=".9"') + r(46, 40, 34, 5, "#ffffff", 3, 'opacity=".6"') +
  r(18, 72, 94, 38, "#f3efff", 8) + r(26, 80, 40, 6, "#c4b5fd", 3) + t(92, 102, 13, accent, "VIP") + r(26, 92, 26, 10, "#7c4dff", 3) +
  r(18, 118, 94, 54, "#f8f6ff", 8) + r(28, 150, 10, 14, "#c4b5fd", 2) + r(44, 140, 10, 24, "#a78bfa", 2) + r(60, 132, 10, 32, "#7c4dff", 2) + r(76, 144, 10, 20, "#c4b5fd", 2) + r(92, 128, 10, 36, "#a78bfa", 2) +
  r(18, 180, 44, 36, "#ffe8f3", 8) + r(68, 180, 44, 36, "#e6f6ff", 8) + c(40, 198, 8, "#ff6fae") + c(90, 198, 8, "#38bdf8") +
  `</g>`;
const coverApp = svg(
  lg("bg", "#ece4ff", "#c9b9ff", "d"),
  r(0, 0, 640, 300, "url(#bg)") +
    c(320, 160, 130, "#ffffff", 'opacity=".35"') + c(90, 60, 40, "#ffffff", 'opacity=".3"') +
    phone(165, 40, -8, "#7c4dff") + phone(345, 30, 7, "#5b8def") +
    `<g transform="translate(110 150)">${c(0, 0, 26, "#ff6fae")}<path d="M-10 -2 a6 6 0 0 1 10 -4 a6 6 0 0 1 10 4 q0 8 -10 14 q-10 -6 -10 -14z" fill="#fff"/></g>` +
    `<g transform="translate(540 110)">${c(0, 0, 26, "#ffd84d")}<polygon points="0,-13 4,-4 13,-4 6,2 9,12 0,6 -9,12 -6,2 -13,-4 -4,-4" fill="#fff"/></g>` +
    `<g transform="translate(530 220)">${c(0, 0, 22, "#34d399")}<rect x="-10" y="-6" width="20" height="14" rx="2" fill="#fff"/><rect x="-12" y="-10" width="24" height="5" rx="2" fill="#fff"/></g>`,
);

const coverOffice = svg(
  lg("s", "#9fcfff", "#edf6ff") + lg("g1", "#3d6fb8", "#8fc0ef", "d") + lg("g2", "#2f5ea3", "#6fa3dc", "d"),
  r(0, 0, 640, 300, "url(#s)") +
    cloud(100, 60) + cloud(560, 44, 0.8) +
    `<polygon points="200,40 400,20 400,262 200,262" fill="url(#g1)"/>` +
    `<polygon points="400,20 500,48 500,262 400,262" fill="url(#g2)"/>` +
    Array.from({ length: 11 }, (_, i) => `<line x1="200" y1="${40 + i * 21}" x2="400" y2="${20 + i * 22}" stroke="#ffffff" stroke-opacity=".45" stroke-width="1.5"/>`).join("") +
    Array.from({ length: 9 }, (_, i) => `<line x1="${222 + i * 22}" y1="${38 - i * 2.2}" x2="${222 + i * 22}" y2="262" stroke="#ffffff" stroke-opacity=".35" stroke-width="1.5"/>`).join("") +
    Array.from({ length: 4 }, (_, i) => `<line x1="${420 + i * 20}" y1="${26 + i * 5.6}" x2="${420 + i * 20}" y2="262" stroke="#ffffff" stroke-opacity=".3" stroke-width="1.5"/>`).join("") +
    `<polygon points="240,262 330,30 370,26 280,262" fill="#ffffff" opacity=".18"/>` +
    `<polygon points="430,262 470,40 485,44 445,262" fill="#ffffff" opacity=".15"/>` +
    r(100, 150, 90, 112, "#dfe7f2") + grid(112, 162, 3, 5, 18, 12, 9, 8, "#9db8dc") +
    r(512, 130, 80, 132, "#d7e1ef") + grid(522, 142, 3, 6, 16, 11, 8, 8, "#9db8dc") +
    r(270, 226, 60, 36, "#1f3f73") + r(276, 232, 22, 30, "#9fc6ee") + r(302, 232, 22, 30, "#9fc6ee") +
    r(0, 260, 640, 40, "#c6d3e3") + r(0, 258, 640, 4, "#aebdd1") +
    tree(60, 252, 20) + tree(160, 254, 14, "#4aa86a") + tree(470, 254, 14) + tree(610, 250, 20, "#4aa86a"),
);

const coverWarehouse = svg(
  lg("bg", "#eaf3ff", "#d6e3f5"),
  r(0, 0, 640, 300, "url(#bg)") +
    r(0, 240, 640, 60, "#c3cfe0") + r(0, 238, 640, 4, "#a9b8ce") +
    [70, 250, 430].map((x) =>
      [0, 1, 2].map((lv) =>
        r(x, 70 + lv * 60, 150, 6, "#f59e0b") +
        [0, 1, 2].map((b) => (lv * 3 + b + x) % 4 === 0 ? "" : r(x + 8 + b * 48, 70 + lv * 60 - 38, 42, 38, ["#d9a066", "#e6b47c", "#c98e55"][b], 3) + r(x + 8 + b * 48 + 17, 70 + lv * 60 - 38, 8, 38, "#f3d7ad")).join(""),
      ).join("") + r(x, 30, 6, 210, "#3b5ba9") + r(x + 144, 30, 6, 210, "#3b5ba9") + r(x, 236, 150, 6, "#f59e0b"),
    ).join("") +
    `<g transform="translate(260 196)">${r(0, 0, 70, 36, "#f5b70b", 8)}${r(10, -30, 34, 32, "#ffffff", 4, 'stroke="#2d3a55" stroke-width="4"')}${r(70, -46, 8, 82, "#2d3a55")}${r(78, 20, 40, 6, "#2d3a55")}${c(16, 40, 10, "#2d3a55")}${c(56, 40, 10, "#2d3a55")}</g>`,
);

const coverSeminar = svg(
  lg("bg", "#221a4e", "#4c2d8c") + lg("sc", "#7c4dff", "#4f8cff", "h"),
  r(0, 0, 640, 300, "url(#bg)") +
    c(320, 90, 170, "#8b5cf6", 'opacity=".18"') +
    r(170, 18, 300, 110, "url(#sc)", 10) + t(320, 64, 26, "#ffffff", "ELITE PARTNER DAY", 'letter-spacing="1"') + t(320, 98, 15, "#e6ddff", "Customer Seminar 2026") +
    r(120, 176, 400, 18, "#3a2a75", 4) +
    r(296, 138, 48, 40, "#ffffff", 4) + r(312, 124, 4, 16, "#cbd5e1") + c(314, 122, 5, "#475569") +
    Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 9 }, (_, i) => r(70 + i * 58 + (row % 2) * 12, 200 + row * 32, 40, 22, ["#6d5bd0", "#7c6be0", "#5b4bc0"][row], 7)).join(""),
    ).join(""),
);

const coverCoffee = svg(
  lg("bg", "#ffeedd", "#ffd0ae"),
  r(0, 0, 640, 300, "url(#bg)") +
    c(110, 80, 60, "#fff6ec", 'opacity=".7"') +
    r(170, 70, 300, 28, "#5a3a2a", 6) + t(320, 90, 16, "#ffe9c9", "POP-UP COFFEE", 'letter-spacing="2"') +
    Array.from({ length: 10 }, (_, i) => r(170 + i * 30, 98, 30, 34, i % 2 ? "#ffffff" : "#e86f51") + c(185 + i * 30, 132, 15, i % 2 ? "#ffffff" : "#e86f51")).join("") +
    r(182, 132, 8, 80, "#8a5a3b") + r(450, 132, 8, 80, "#8a5a3b") +
    r(214, 160, 70, 52, "#3f3f46", 6) + r(226, 172, 46, 14, "#a1a1aa", 3) + r(244, 186, 10, 16, "#18181b") +
    r(160, 212, 320, 70, "#8a5a3b", 8) + r(160, 212, 320, 10, "#a06c48", 4) + r(190, 236, 260, 34, "#a06c48", 6) +
    [330, 370, 410].map((x, i) => r(x, 180, 26, 32, "#ffffff", 4) + r(x - 2, 176, 30, 6, ["#e86f51", "#5a3a2a", "#7c4dff"][i], 3)).join("") +
    `<path d="M343 170 q-6 -10 0 -18 M383 168 q-6 -10 0 -18" stroke="#c4a484" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    tree(90, 262, 18) + tree(560, 262, 20, "#4aa86a"),
);

const coverWeb = svg(
  lg("bg", "#e0f7ef", "#bfeadd", "d") + lg("hero", "#7c4dff", "#38bdf8", "h"),
  r(0, 0, 640, 300, "url(#bg)") +
    c(560, 60, 70, "#ffffff", 'opacity=".35"') +
    r(120, 30, 400, 250, "#ffffff", 14, 'stroke="#d6e7e0" stroke-width="2"') +
    r(120, 30, 400, 30, "#f1f5f9", 14) + r(120, 46, 400, 14, "#f1f5f9") + c(140, 45, 5, "#f87171") + c(156, 45, 5, "#fbbf24") + c(172, 45, 5, "#34d399") + r(200, 39, 200, 12, "#ffffff", 6) +
    r(140, 74, 360, 86, "url(#hero)", 10) + r(160, 96, 150, 12, "#ffffff", 6, 'opacity=".95"') + r(160, 116, 110, 8, "#ffffff", 4, 'opacity=".75"') + r(160, 134, 64, 16, "#ffd84d", 8) +
    c(440, 117, 28, "#ffffff", 'opacity=".3"') +
    [0, 1, 2].map((i) => r(140 + i * 124, 174, 112, 86, "#f8fafc", 8, 'stroke="#e2e8f0"') + r(152 + i * 124, 186, 36, 28, ["#c4b5fd", "#a5f3fc", "#fde68a"][i], 6) + r(152 + i * 124, 222, 84, 7, "#cbd5e1", 3) + r(152 + i * 124, 236, 60, 6, "#e2e8f0", 3)).join("") +
    `<path d="M470 210 l0 38 l10 -10 l8 18 l8 -4 l-8 -17 l14 0z" fill="#1f2937" stroke="#fff" stroke-width="2"/>`,
);

export const sampleCovers = {
  condo: coverCondo,
  clinic: coverClinic,
  expo: coverExpo,
  resort: coverResort,
  skincare: coverSkin,
  campaign: coverCampaign,
  app: coverApp,
  office: coverOffice,
  warehouse: coverWarehouse,
  seminar: coverSeminar,
  coffee: coverCoffee,
  website: coverWeb,
} as const;

// ---------------------------------------------------------------- people

let personSeq = 0;
const person = (name: string, position = "", department = ""): Person => ({ id: "sample-person-" + ++personSeq, name, position, department, photo: null });
const pool = ["กานต์", "ปิยะ", "มนัส", "ศิริพร", "วรวุฒิ", "ชลธิชา", "อนันต์", "สุดารัตน์", "ภาคิน", "เพ็ญศรี", "ธีระ", "นภัสสร", "จิราพร", "ปวีณา", "สมชาย", "รัชนี"];
const poolPeople = pool.map((n, i) => person(n, ["วิศวกร", "ฝ่ายขาย", "การตลาด", "บัญชี", "จัดซื้อ", "ออกแบบ", "ประสานงาน", "ไอที"][i % 8]));
/** n team members starting at a rotating offset, so stacks differ between cards. */
const team = (n: number, offset: number) => Array.from({ length: n }, (_, i) => poolPeople[(offset + i) % poolPeople.length]);

// ---------------------------------------------------------------- the 12 project cards (page 13)

type CardSeed = {
  name: string;
  subtitle: string;
  code: string;
  status: string;
  start: string;
  end: string;
  owner: Person;
  team: number;
  stage: string;
  progress: number;
  budget: number;
  salesTarget: number;
  sales: number;
  expenses: number;
  cover: keyof typeof sampleCovers;
  type: string;
  location: string;
};

const seeds: CardSeed[] = [
  { name: "โครงการคอนโด Blue Sky Residence", subtitle: "พัฒนาและบริหารโครงการคอนโดให้เช่า", code: "PRJ-001", status: "active", start: "2026-01-01", end: "2026-12-31", owner: person("ณัฐชา", "ผู้จัดการโครงการ"), team: 6, stage: "การตลาด & ขาย", progress: 45, budget: 25_000_000, salesTarget: 18_500_000, sales: 8_250_000, expenses: 4_200_000, cover: "condo", type: "อสังหาริมทรัพย์ / คอนโดให้เช่า", location: "กรุงเทพฯ" },
  { name: "เปิดสาขาคลินิกความงาม สาขา 2", subtitle: "ขยายสาขาคลินิก พร้อมระบบบริหารครบวงจร", code: "PRJ-002", status: "active", start: "2026-01-15", end: "2026-06-30", owner: person("พิมพ์นารา", "ผู้จัดการสาขา"), team: 8, stage: "ตกแต่งและติดตั้งระบบ", progress: 70, budget: 3_500_000, salesTarget: 6_000_000, sales: 4_200_000, expenses: 2_450_000, cover: "clinic", type: "คลินิก / ความงาม", location: "นนทบุรี" },
  { name: "งาน Bangkok Fashion Expo 2026", subtitle: "งานแสดงแฟชั่นและธุรกิจไลฟ์สไตล์", code: "PRJ-003", status: "planning", start: "2026-02-01", end: "2026-05-19", owner: person("ธนากร", "Event Manager"), team: 5, stage: "วางแผนงาน", progress: 20, budget: 2_000_000, salesTarget: 3_500_000, sales: 700_000, expenses: 380_000, cover: "expo", type: "อีเวนต์ / นิทรรศการ", location: "ไบเทค บางนา" },
  { name: "รีโนเวทรีสอร์ท The Promenade", subtitle: "ปรับปรุงและยกระดับรีสอร์ท", code: "PRJ-004", status: "completed", start: "2025-08-01", end: "2026-01-31", owner: person("กิตติพงษ์", "Project Lead"), team: 7, stage: "เสร็จสิ้น", progress: 100, budget: 5_000_000, salesTarget: 7_500_000, sales: 7_800_000, expenses: 4_850_000, cover: "resort", type: "โรงแรม / รีสอร์ท", location: "หัวหิน" },
  { name: "พัฒนาสินค้า New Skin Care Series", subtitle: "พัฒนาผลิตภัณฑ์บำรุงผิวสูตรใหม่", code: "PRJ-005", status: "active", start: "2026-03-15", end: "2026-09-30", owner: person("อริษา", "Product Manager"), team: 6, stage: "พัฒนาสูตรและทดสอบ", progress: 60, budget: 1_800_000, salesTarget: 5_000_000, sales: 3_000_000, expenses: 1_150_000, cover: "skincare", type: "พัฒนาผลิตภัณฑ์", location: "สมุทรปราการ" },
  { name: "แคมเปญการตลาด Summer Sale", subtitle: "แคมเปญส่งเสริมการขายประจำฤดูร้อน", code: "PRJ-006", status: "paused", start: "2026-04-01", end: "2026-07-31", owner: person("อรพรรณ", "Marketing Lead"), team: 5, stage: "พักโครงการ (รออนุมัติ)", progress: 0, budget: 500_000, salesTarget: 2_000_000, sales: 0, expenses: 45_000, cover: "campaign", type: "การตลาด / แคมเปญ", location: "ออนไลน์" },
  { name: "พัฒนาแอปพลิเคชันสมาชิก (Member App)", subtitle: "ระบบสมาชิกและสิทธิพิเศษสำหรับลูกค้า", code: "PRJ-007", status: "active", start: "2026-02-01", end: "2026-08-31", owner: person("ศุภกร", "IT Lead"), team: 9, stage: "พัฒนา", progress: 55, budget: 4_200_000, salesTarget: 8_000_000, sales: 4_400_000, expenses: 2_300_000, cover: "app", type: "ไอที / แอปพลิเคชัน", location: "สำนักงานใหญ่" },
  { name: "โครงการขยายสำนักงานใหม่", subtitle: "สร้างสำนักงานสาขาใหม่ (ยกเลิกตามแผนปรับโครงสร้าง)", code: "PRJ-008", status: "cancelled", start: "2026-01-01", end: "2026-12-31", owner: person("ธีรภัทร", "Operations"), team: 4, stage: "ยกเลิกโครงการ", progress: 0, budget: 8_000_000, salesTarget: 0, sales: 0, expenses: 120_000, cover: "office", type: "สำนักงาน / ก่อสร้าง", location: "เชียงใหม่" },
  { name: "ระบบบริหารคลังสินค้า (WMS)", subtitle: "วางระบบคลังสินค้าและสต็อกแบบเรียลไทม์", code: "PRJ-009", status: "review", start: "2026-03-01", end: "2026-10-31", owner: person("วีรยุทธ", "Supply Chain Lead"), team: 4, stage: "ตรวจสอบ / สรุปผล", progress: 90, budget: 1_500_000, salesTarget: 0, sales: 0, expenses: 1_320_000, cover: "warehouse", type: "ระบบงานภายใน", location: "คลังสินค้าบางพลี" },
  { name: "งานสัมมนาลูกค้า Elite Partner Day", subtitle: "สัมมนาและเปิดตัวบริการใหม่ให้ลูกค้าองค์กร", code: "PRJ-010", status: "planning", start: "2026-11-01", end: "2026-12-15", owner: person("กมลชนก", "Event Coordinator"), team: 3, stage: "วางแผนงาน", progress: 10, budget: 800_000, salesTarget: 1_500_000, sales: 0, expenses: 60_000, cover: "seminar", type: "อีเวนต์ / สัมมนา", location: "ศูนย์ประชุมแห่งชาติสิริกิติ์" },
  { name: "ร้านกาแฟ Pop-up สยาม", subtitle: "บูธกาแฟชั่วคราว ทดลองตลาดย่านสยาม", code: "PRJ-011", status: "completed", start: "2025-11-01", end: "2026-02-28", owner: person("ปณิดา", "Retail Manager"), team: 3, stage: "เสร็จสิ้น", progress: 100, budget: 450_000, salesTarget: 900_000, sales: 1_050_000, expenses: 410_000, cover: "coffee", type: "ค้าปลีก / ร้านค้า", location: "สยามสแควร์" },
  { name: "ปรับปรุงเว็บไซต์องค์กร", subtitle: "ออกแบบเว็บไซต์ใหม่และระบบจองออนไลน์", code: "PRJ-012", status: "completed", start: "2025-09-01", end: "2026-03-31", owner: person("ชยพล", "Digital Lead"), team: 2, stage: "เสร็จสิ้น", progress: 100, budget: 650_000, salesTarget: 0, sales: 0, expenses: 620_000, cover: "website", type: "ไอที / เว็บไซต์", location: "ออนไลน์" },
];

function makeCard(s: CardSeed, i: number): ProjectCard {
  const stamp = `2026-10-${String(20 - i).padStart(2, "0")}T09:00:00+07:00`;
  return {
    id: SAMPLE_PREFIX + (i + 1),
    version: 1,
    department: "Operations",
    created_at: `${s.start}T09:00:00+07:00`,
    updated_at: stamp,
    data: {
      name: s.name,
      subtitle: s.subtitle,
      code: s.code,
      status: s.status,
      startDate: s.start,
      endDate: s.end,
      type: s.type,
      location: s.location,
      priority: i < 2 ? "high" : "normal",
      budget: s.budget,
      salesTarget: s.salesTarget,
      owner: s.owner.name,
      team: "sample",
      description: s.subtitle + " (ข้อมูลตัวอย่าง)",
    },
    name: s.name,
    subtitle: s.subtitle,
    code: s.code,
    status: s.status,
    startDate: s.start,
    endDate: s.end,
    cover: null,
    sample: sampleCovers[s.cover],
    owner: s.owner,
    team: team(s.team, i * 3),
    stageLabel: s.stage,
    progress: s.progress,
    progressSource: "stages",
    budget: s.budget,
    salesTarget: s.salesTarget,
    sales: s.sales,
    expenses: s.expenses,
  };
}

export const sampleProjects: ProjectCard[] = seeds.map(makeCard);

const ev = (id: string, projectId: string, name: string, date: string, place: string, kind: CalendarItem["kind"] = "event"): CalendarItem => ({
  id,
  projectId,
  kind,
  name,
  date,
  endDate: date,
  place,
  status: "planned",
});
const blueSkyUpcoming: CalendarItem[] = [
  ev("sample-ev-1", "sample-1", "ประชุมทีมการตลาด", "2026-10-15", "10:00 – 12:00 น. · ห้องประชุม 1"),
  ev("sample-ev-2", "sample-1", "งานเปิดตัวโครงการ", "2026-10-20", "13:00 – 17:00 น. · Central Embassy"),
  ev("sample-ev-3", "sample-1", "สรุปยอดขายประจำเดือน", "2026-10-28", "09:00 – 11:00 น. · ออนไลน์"),
];

export const sampleOverview: ProjectsOverview = {
  today: SAMPLE_TODAY,
  projects: sampleProjects,
  // Same rule as statusCounts() in src/lib/projects.ts (checked by tests/mockups-projects.test.ts).
  counts: { all: 12, active: 7, completed: 3, paused: 1, cancelled: 1 },
  people: [...seeds.map((s) => s.owner), ...poolPeople],
  calendar: [
    ...blueSkyUpcoming,
    ev("sample-ev-4", "sample-2", "ตรวจรับงานตกแต่ง", "2026-10-09", "พิมพ์นารา", "task"),
    ev("sample-ev-5", "sample-7", "ทดสอบแอปรอบเบต้า", "2026-10-22", "ศุภกร", "task"),
    ev("sample-ev-6", "sample-9", "อบรมพนักงานคลัง", "2026-10-26", "คลังสินค้าบางพลี"),
    ev("sample-ev-7", "sample-10", "ประชุมเตรียมงานสัมมนา", "2026-10-30", "ห้องประชุม 2"),
  ],
  nextCode: "PRJ-013",
};

// ---------------------------------------------------------------- detail pages (page 14)

export type SampleStep = { key: string; label: string; status: "pending" | "progress" | "review" | "done" };
/** Mockup-only figures the real detail page has no field for (design's stage legend, stepper, third goal, promo text). */
export type SampleExtras = {
  breakdown: { label: string; percent: number; color: string }[];
  steps: SampleStep[];
  thirdGoal: { label: string; value: number; target: number };
  tagline: string;
  quote: string;
};
export type SampleDetail = ProjectDetailData & { extras: SampleExtras };

const months6 = ["ม.ค. 69", "ก.พ. 69", "มี.ค. 69", "เม.ย. 69", "พ.ค. 69", "มิ.ย. 69"];
function series(salesByMonth: number[], costByMonth: number[]): SampleDetail["series"] {
  const month: SeriesPoint[] = months6.map((label, i) => ({ key: `2026-${String(i + 1).padStart(2, "0")}`, label, sales: salesByMonth[i], expenses: costByMonth[i] }));
  const q = (a: number, b: number, arr: number[]) => arr.slice(a, b).reduce((s, x) => s + x, 0);
  const sum = (arr: number[]) => arr.reduce((s, x) => s + x, 0);
  return {
    month,
    quarter: [
      { key: "2025-Q3", label: "Q3/68", sales: 0, expenses: 0 },
      { key: "2025-Q4", label: "Q4/68", sales: 0, expenses: 0 },
      { key: "2026-Q1", label: "Q1/69", sales: q(0, 3, salesByMonth), expenses: q(0, 3, costByMonth) },
      { key: "2026-Q2", label: "Q2/69", sales: q(3, 6, salesByMonth), expenses: q(3, 6, costByMonth) },
    ],
    year: [
      { key: "2024", label: "2567", sales: 0, expenses: 0 },
      { key: "2025", label: "2568", sales: 0, expenses: 0 },
      { key: "2026", label: "2569", sales: sum(salesByMonth), expenses: sum(costByMonth) },
    ],
  };
}
/** Spread a total over 6 rising months (the last month takes the rounding remainder). */
function spread(total: number) {
  const w = [0.08, 0.12, 0.14, 0.18, 0.22, 0.26];
  const parts = w.map((x) => Math.round((total * x) / 1000) * 1000);
  parts[5] = total - parts.slice(0, 5).reduce((s, x) => s + x, 0);
  return parts;
}
const lite = (id: string, name: string, date: string, amount: number, status: string, extra: string): LiteRow => ({ id, name, date, amount, status, extra });
const doc = (id: string, name: string, date: string, mb: number, category: string): DocItem => ({
  id,
  name,
  mime: "",
  size: Math.round(mb * 1e6),
  at: date + "T10:00:00+07:00",
  href: null,
  category,
});
const act = (id: string, kind: ActivityItem["kind"], title: string, detail: string, at: string): ActivityItem => ({ id, kind, title, detail, at });

function blueSky(): SampleDetail {
  const base = sampleProjects[0];
  // Same owner and figures as the list card, so the mockup reads as one project (the Canva pages differ here).
  const admin = base.owner!;
  const project: ProjectCard = {
    ...base,
    data: { ...base.data, salesTarget: 18_500_000, customerTarget: 100, area: "12 ไร่", owner: admin.name, priority: "high", tagline: "Dream Home Better Future" },
    owner: admin,
    team: team(12, 2),
    stageLabel: "การตลาด & ขาย",
    salesTarget: 18_500_000,
    sales: 8_250_000,
    expenses: 4_200_000,
  };
  const salesM = [600_000, 950_000, 1_100_000, 1_500_000, 1_800_000, 2_300_000];
  const costM = [400_000, 550_000, 650_000, 700_000, 850_000, 1_050_000];
  return {
    today: SAMPLE_TODAY,
    project,
    stages: [],
    history: [],
    series: series(salesM, costM),
    totals: { sales: 8_250_000, expenses: 4_200_000, profit: 4_050_000, invoiced: 9_600_000, received: 8_250_000, outstanding: 1_350_000 },
    goals: {
      sales: { value: 8_250_000, target: 18_500_000 },
      customers: { value: 60, target: 100 },
      tasks: { value: 9, target: 20 },
    },
    tasks: [
      lite("sample-t1", "ถ่ายภาพห้องตัวอย่าง", "2026-10-14", 0, "progress", "ศิริพร"),
      lite("sample-t2", "เตรียมบูธงานเปิดตัว", "2026-10-18", 0, "todo", "มนัส"),
      lite("sample-t3", "ส่งรายงานยอดจองประจำสัปดาห์", "2026-10-10", 0, "done", "ปิยะ"),
      lite("sample-t4", "ตรวจงานระบบสระว่ายน้ำ", "2026-10-05", 0, "done", "วรวุฒิ"),
    ],
    events: blueSkyUpcoming.map((e) => lite(e.id, e.name, e.date, e.id === "sample-ev-2" ? 350_000 : 0, "planned", e.place.split(" · ")[1] || e.place)),
    sales: [
      lite("sample-s1", "จองห้อง A-1203 (2 ห้องนอน)", "2026-06-24", 2_300_000, "paid", "Showroom"),
      lite("sample-s2", "จองห้อง B-0807", "2026-05-18", 1_800_000, "paid", "ออนไลน์"),
      lite("sample-s3", "สัญญาเช่ารายปี 6 ห้อง", "2026-04-09", 1_500_000, "paid", "ตัวแทนขาย"),
      lite("sample-s4", "จองห้อง A-0512", "2026-03-21", 1_100_000, "paid", "Showroom"),
    ],
    expenses: [
      lite("sample-x1", "ค่าก่อสร้างงวดที่ 4", "2026-06-15", 1_050_000, "approved", "ก่อสร้าง"),
      lite("sample-x2", "ค่าโฆษณาออนไลน์", "2026-05-20", 850_000, "approved", "การตลาด"),
      lite("sample-x3", "ค่าตกแต่งห้องตัวอย่าง", "2026-04-11", 700_000, "approved", "ตกแต่ง"),
    ],
    invoices: [
      lite("sample-i1", "INV-2026-0142", "2026-06-25", 3_600_000, "partial", "2026-07-25"),
      lite("sample-i2", "INV-2026-0098", "2026-04-30", 6_000_000, "paid", "2026-05-30"),
    ],
    upcoming: blueSkyUpcoming,
    activity: [
      act("sample-a1", "stage", "อัปเดตสถานะโครงการ", 'เปลี่ยนเป็น "การตลาด & ขาย"', "2026-10-10T14:32:00+07:00"),
      act("sample-a2", "file", "เพิ่มเอกสาร", "สัญญาโครงการ.docx", "2026-10-09T11:20:00+07:00"),
      act("sample-a3", "sale", "ยอดขายเพิ่มขึ้น", "+ 2,500,000 บาท", "2026-10-08T16:45:00+07:00"),
      act("sample-a4", "task", "งานเสร็จแล้ว", "ส่งรายงานยอดจองประจำสัปดาห์", "2026-10-07T09:10:00+07:00"),
      act("sample-a5", "project", "แก้ไขข้อมูลโครงการ", "ปรับเป้ายอดขายเป็น 18,500,000 บาท", "2026-09-30T15:00:00+07:00"),
      act("sample-a6", "project", "สร้างโครงการ", project.name, "2026-01-01T09:00:00+07:00"),
    ],
    documents: [
      doc("sample-d1", "แผนการตลาด.pdf", "2026-10-09", 2.5, "การตลาด"),
      doc("sample-d2", "สัญญาโครงการ.docx", "2026-10-08", 1.8, "สัญญา"),
      doc("sample-d3", "รายงานยอดขาย.xlsx", "2026-10-07", 1.2, "รายงาน"),
    ],
    people: sampleOverview.people,
    extras: {
      breakdown: [
        { label: "เริ่มต้น", percent: 10, color: "#ddd3fb" },
        { label: "วางแผน", percent: 15, color: "#c4b5fd" },
        { label: "ดำเนินการ", percent: 45, color: "#7952dd" },
        { label: "ตรวจสอบ", percent: 20, color: "#f9a8d4" },
        { label: "เสร็จสิ้น", percent: 10, color: "#a78bfa" },
      ],
      steps: [
        { key: "design", label: "ออกแบบ & ขออนุญาต", status: "done" },
        { key: "build", label: "พัฒนาโครงการ", status: "done" },
        { key: "sell", label: "การตลาด & ขาย", status: "progress" },
        { key: "summary", label: "สรุปยอดขาย", status: "pending" },
        { key: "handover", label: "ส่งมอบโครงการ", status: "pending" },
      ],
      thirdGoal: { label: "พื้นที่จอง", value: 30, target: 100 },
      tagline: "Dream Home Better Future",
      quote: "“ทุกความสำเร็จของโครงการ เริ่มต้นจากการวางแผนที่ดี”",
    },
  };
}

const genericSteps = ["วางแผนงาน", "เตรียมงาน", "ดำเนินการ", "ตรวจสอบ", "ปิดโครงการ"];
function generic(card: ProjectCard, i: number): SampleDetail {
  const salesM = spread(card.sales),
    costM = spread(card.expenses);
  const done = card.status === "completed" ? 5 : Math.min(4, Math.floor(card.progress / 20));
  const steps: SampleStep[] = genericSteps.map((label, k) => ({
    key: "s" + k,
    label,
    status: k < done ? "done" : k === done && ["active", "planning", "review"].includes(card.status) ? (card.status === "review" ? "review" : "progress") : "pending",
  }));
  const pid = card.id;
  const upcoming: CalendarItem[] = sampleOverview.calendar.filter((x) => x.projectId === pid && x.date >= SAMPLE_TODAY);
  return {
    today: SAMPLE_TODAY,
    project: { ...card, data: { ...card.data, customerTarget: 50 } },
    stages: [],
    history: [],
    series: series(salesM, costM),
    totals: { sales: card.sales, expenses: card.expenses, profit: card.sales - card.expenses, invoiced: card.sales, received: Math.round(card.sales * 0.8), outstanding: card.sales - Math.round(card.sales * 0.8) },
    goals: {
      sales: { value: card.sales, target: card.salesTarget },
      customers: { value: Math.round(card.progress / 2), target: 50 },
      tasks: { value: Math.round(card.progress / 10), target: 10 },
    },
    tasks: [lite(pid + "-t1", "ประชุมติดตามงานประจำสัปดาห์", "2026-10-16", 0, card.status === "completed" ? "done" : "todo", card.owner?.name || "")],
    events: upcoming.map((e) => lite(e.id, e.name, e.date, 0, "planned", e.place)),
    sales: card.sales ? [lite(pid + "-s1", "ยอดขายรวมจากโครงการ", "2026-06-30", card.sales, "paid", "หลายช่องทาง")] : [],
    expenses: card.expenses ? [lite(pid + "-x1", "ค่าใช้จ่ายโครงการ", "2026-06-30", card.expenses, "approved", "รวม")] : [],
    invoices: [],
    upcoming,
    activity: [
      act(pid + "-a1", "stage", "อัปเดตสถานะโครงการ", `ขั้นตอน "${card.stageLabel}"`, `2026-10-${String(11 - (i % 5)).padStart(2, "0")}T10:15:00+07:00`),
      act(pid + "-a2", "document", "เพิ่มเอกสาร", "แผนงานโครงการ.pdf", "2026-09-20T14:00:00+07:00"),
      act(pid + "-a3", "project", "สร้างโครงการ", card.name, card.created_at),
    ],
    documents: [doc(pid + "-d1", "แผนงานโครงการ.pdf", "2026-09-20", 1.4, "แผนงาน"), doc(pid + "-d2", "งบประมาณโครงการ.xlsx", "2026-09-12", 0.6, "การเงิน")],
    people: sampleOverview.people,
    extras: {
      breakdown: [
        { label: "เสร็จแล้ว", percent: card.progress, color: "#7952dd" },
        { label: "คงเหลือ", percent: 100 - card.progress, color: "#ece8f7" },
      ],
      steps,
      thirdGoal: { label: "งานที่เสร็จ", value: Math.round(card.progress / 10), target: 10 },
      tagline: "Plan well, deliver better",
      quote: "“ทุกความสำเร็จของโครงการ เริ่มต้นจากการวางแผนที่ดี”",
    },
  };
}

/** The mockup detail for a sample id (sample-1 is the full Canva page 14), or null for anything else. */
export function sampleDetail(id: string): SampleDetail | null {
  const i = sampleProjects.findIndex((p) => p.id === id);
  if (i < 0) return null;
  return i === 0 ? blueSky() : generic(sampleProjects[i], i);
}
