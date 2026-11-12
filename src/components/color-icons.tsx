"use client";
import { useId, type ReactNode } from "react";

/**
 * Full-colour illustrated icons for menus (network page left menus).
 * Drawn for EliteFlow: filled shapes with soft gradients, no tile behind them.
 */
type G = (n: string) => string;
const lin = (id: string, a: string, b: string, x2 = 0, y2 = 1) => (
  <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>
    <stop offset="0" stopColor={a} />
    <stop offset="1" stopColor={b} />
  </linearGradient>
);
const person = (cx: number, cy: number, r: number, body: string, fill: string) => (
  <>
    <path d={body} fill={fill} />
    <circle cx={cx} cy={cy} r={r} fill={fill} />
  </>
);
const people = (g: G, back: [string, string], front: [string, string]) => (
  <>
    <defs>
      {lin(g("b"), back[0], back[1])}
      {lin(g("f"), front[0], front[1])}
    </defs>
    {person(16.5, 7.6, 3, "M11.2 19.5a5.3 5.3 0 0 1 10.6 0v.3a1.2 1.2 0 0 1-1.2 1.2h-8.2a1.2 1.2 0 0 1-1.2-1.2z", `url(#${g("b")})`)}
    {person(8.8, 7.4, 3.6, "M2 19.6a6.8 6.8 0 0 1 13.6 0v.2a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 19.8z", `url(#${g("f")})`)}
  </>
);
const shine = <ellipse cx="8" cy="6.5" rx="3.2" ry="1.6" fill="#fff" opacity=".35" transform="rotate(-25 8 6.5)" />;

const icons: Record<string, (g: G) => ReactNode> = {
  inbox: (g) => (
    <>
      <defs>{lin(g("a"), "#c084fc", "#7c3aed")}</defs>
      <rect x="2.5" y="3.5" width="19" height="17" rx="4.5" fill={`url(#${g("a")})`} />
      <path d="M2.5 13.5h5.2l1.6 2.6h5.4l1.6-2.6h5.2V16a4.5 4.5 0 0 1-4.5 4.5H7A4.5 4.5 0 0 1 2.5 16z" fill="#5b21b6" opacity=".85" />
      <rect x="7" y="7.5" width="10" height="1.8" rx=".9" fill="#fff" opacity=".9" />
      <rect x="7" y="10.4" width="6.5" height="1.8" rx=".9" fill="#fff" opacity=".6" />
    </>
  ),
  heart: (g) => (
    <>
      <defs>{lin(g("a"), "#fdba74", "#f43f5e", 1, 1)}</defs>
      <path d="M12 21s-9-5.6-9-11.6A5 5 0 0 1 12 6.3a5 5 0 0 1 9 3.1C21 15.4 12 21 12 21z" fill={`url(#${g("a")})`} />
      {shine}
    </>
  ),
  check: (g) => (
    <>
      <defs>{lin(g("a"), "#4ade80", "#059669", 1, 1)}</defs>
      <circle cx="12" cy="12" r="9.5" fill={`url(#${g("a")})`} />
      <path d="m7.6 12.3 3 3 5.9-6.2" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {shine}
    </>
  ),
  message: (g) => (
    <>
      <defs>{lin(g("a"), "#38bdf8", "#2563eb", 1, 1)}</defs>
      <path d="M12 2.8c5.2 0 9.4 3.7 9.4 8.3s-4.2 8.3-9.4 8.3c-1 0-2-.1-2.9-.4L4 21l1.3-4.2a7.9 7.9 0 0 1-2.7-5.7C2.6 6.5 6.8 2.8 12 2.8z" fill={`url(#${g("a")})`} />
      <circle cx="8" cy="11.2" r="1.3" fill="#fff" />
      <circle cx="12" cy="11.2" r="1.3" fill="#fff" />
      <circle cx="16" cy="11.2" r="1.3" fill="#fff" />
    </>
  ),
  chats: (g) => (
    <>
      <defs>
        {lin(g("a"), "#5eead4", "#0d9488", 1, 1)}
        {lin(g("b"), "#60a5fa", "#4f46e5", 1, 1)}
      </defs>
      <path d="M15 2.5c3.6 0 6.5 2.5 6.5 5.6 0 1.4-.6 2.7-1.6 3.7l.8 2.7-3.3-1.2A7.3 7.3 0 0 1 15 13.7c-3.6 0-6.5-2.5-6.5-5.6S11.4 2.5 15 2.5z" fill={`url(#${g("a")})`} />
      <path d="M9 8.5c3.9 0 7 2.7 7 6s-3.1 6-7 6c-.8 0-1.5-.1-2.2-.3L3 21.5l1-3.2A5.7 5.7 0 0 1 2 14.5c0-3.3 3.1-6 7-6z" fill={`url(#${g("b")})`} />
      <rect x="5.5" y="13.6" width="7" height="1.7" rx=".85" fill="#fff" opacity=".9" />
    </>
  ),
  friendAdd: (g) => (
    <>
      {people(g, ["#5eead4", "#14b8a6"], ["#60a5fa", "#2563eb"])}
      <defs>{lin(g("p"), "#f9a8d4", "#db2777")}</defs>
      <circle cx="18.5" cy="17.5" r="4.3" fill={`url(#${g("p")})`} stroke="#fff" strokeWidth="1.4" />
      <path d="M18.5 15.6v3.8M16.6 17.5h3.8" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  people: (g) => people(g, ["#f9a8d4", "#db2777"], ["#c084fc", "#7c3aed"]),
  info: (g) => (
    <>
      <defs>{lin(g("a"), "#818cf8", "#4338ca", 1, 1)}</defs>
      <circle cx="12" cy="12" r="9.5" fill={`url(#${g("a")})`} />
      <circle cx="12" cy="7.8" r="1.5" fill="#fff" />
      <rect x="10.7" y="10.4" width="2.6" height="7" rx="1.3" fill="#fff" />
    </>
  ),
  building: (g) => (
    <>
      <defs>
        {lin(g("a"), "#a78bfa", "#6d28d9")}
        {lin(g("b"), "#7dd3fc", "#0284c7")}
      </defs>
      <rect x="13" y="9" width="8.5" height="12.5" rx="2" fill={`url(#${g("b")})`} />
      <rect x="2.5" y="3" width="12" height="18.5" rx="2.5" fill={`url(#${g("a")})`} />
      {[6, 10, 14].map((y) => (
        <g key={y} fill="#fff" opacity=".85">
          <rect x="5" y={y} width="2.6" height="2.2" rx=".6" />
          <rect x="9.4" y={y} width="2.6" height="2.2" rx=".6" />
        </g>
      ))}
      <rect x="7" y="17.5" width="3" height="4" rx=".8" fill="#fde68a" />
      <rect x="15.5" y="12" width="3.5" height="1.8" rx=".6" fill="#fff" opacity=".8" />
      <rect x="15.5" y="15.4" width="3.5" height="1.8" rx=".6" fill="#fff" opacity=".8" />
    </>
  ),
  megaphone: (g) => (
    <>
      <defs>{lin(g("a"), "#fdba74", "#ea580c", 1, 1)}</defs>
      <path d="M8 15.5h2.6l1.2 4.6a1.4 1.4 0 0 1-1.4 1.8H9.3a1.4 1.4 0 0 1-1.3-1z" fill="#c2410c" />
      <path d="M17.5 3.5v16L10 15.5H5.5a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3H10z" fill={`url(#${g("a")})`} />
      <rect x="17" y="3" width="3" height="17" rx="1.5" fill="#fb923c" />
      <path d="M21.5 9.5a2.5 2.5 0 0 1 0 4" stroke="#fbbf24" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <ellipse cx="7" cy="9.6" rx="2.2" ry="1" fill="#fff" opacity=".4" />
    </>
  ),
  briefcase: (g) => (
    <>
      <defs>{lin(g("a"), "#fcd34d", "#f97316")}</defs>
      <path d="M8.5 7V5.5A2 2 0 0 1 10.5 3.5h3a2 2 0 0 1 2 2V7" fill="none" stroke="#9a3412" strokeWidth="1.8" />
      <rect x="2.5" y="7" width="19" height="13.5" rx="3.2" fill={`url(#${g("a")})`} />
      <path d="M2.5 11.5h19v1.5h-19z" fill="#c2410c" opacity=".55" />
      <rect x="10" y="10.5" width="4" height="3.5" rx="1" fill="#fff" />
    </>
  ),
  grid: () => (
    <>
      <rect x="2.5" y="2.5" width="8.5" height="8.5" rx="2.6" fill="#8b5cf6" />
      <rect x="13" y="2.5" width="8.5" height="8.5" rx="2.6" fill="#38bdf8" />
      <rect x="2.5" y="13" width="8.5" height="8.5" rx="2.6" fill="#f472b6" />
      <rect x="13" y="13" width="8.5" height="8.5" rx="2.6" fill="#fbbf24" />
    </>
  ),
  news: (g) => (
    <>
      <defs>{lin(g("a"), "#38bdf8", "#2563eb", 1, 1)}</defs>
      <rect x="2.5" y="3" width="19" height="18" rx="3.5" fill={`url(#${g("a")})`} />
      <rect x="5.5" y="6.5" width="6" height="5.5" rx="1.2" fill="#fde68a" />
      <rect x="13" y="6.8" width="5.5" height="1.6" rx=".8" fill="#fff" />
      <rect x="13" y="10" width="5.5" height="1.6" rx=".8" fill="#fff" opacity=".75" />
      <rect x="5.5" y="14.3" width="13" height="1.6" rx=".8" fill="#fff" opacity=".9" />
      <rect x="5.5" y="17.3" width="9" height="1.6" rx=".8" fill="#fff" opacity=".65" />
    </>
  ),
  partner: (g) => (
    <>
      <defs>
        {lin(g("a"), "#4ade80", "#16a34a", 1, 1)}
        {lin(g("b"), "#5eead4", "#0891b2", 1, 1)}
      </defs>
      <circle cx="8.6" cy="12" r="6.6" fill={`url(#${g("a")})`} />
      <circle cx="15.4" cy="12" r="6.6" fill={`url(#${g("b")})`} opacity=".9" />
      <path d="M12 6.3a6.6 6.6 0 0 1 0 11.4 6.6 6.6 0 0 1 0-11.4z" fill="#fff" opacity=".55" />
    </>
  ),
  bookmark: (g) => (
    <>
      <defs>{lin(g("a"), "#f472b6", "#7c3aed")}</defs>
      <path d="M6.5 2.5h11a1.5 1.5 0 0 1 1.5 1.5v17.2l-7-4.4-7 4.4V4a1.5 1.5 0 0 1 1.5-1.5z" fill={`url(#${g("a")})`} />
      <rect x="8" y="5.5" width="5" height="1.6" rx=".8" fill="#fff" opacity=".5" />
    </>
  ),
};
export type ColorIconName = keyof typeof icons;

export function ColorIcon({ name, size = 26 }: { name: ColorIconName; size?: number }) {
  const id = useId().replace(/:/g, "");
  const g: G = (n) => `ci${id}${n}`;
  return (
    <svg className="color-ic" width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      {icons[name](g)}
    </svg>
  );
}
