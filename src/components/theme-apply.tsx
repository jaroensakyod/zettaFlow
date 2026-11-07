"use client";
// App Shop themes and characters on the client: palettes (for the shop's mini mocks), the ThemeApplier that
// sets <html data-theme="…"> (the full token set lives in src/app/styles/themes.css), "try before you buy"
// previews kept in sessionStorage, and a hook for the company's active theme/character (refreshed by "ef:shop").
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Eye, ShoppingCart, X, Check } from "lucide-react";
import { api } from "./shared";

export type Palette = {
  name: string;
  accent: string;
  accentSoft: string;
  /** Side-bar colour of the mini mock. */
  /** Side-bar colour of the mini mock. */
  nav: string;
  bg: string;
  /** Card / surface colour in the mini mock. */
  surface: string;
  /** Faint lines / placeholder bars in the mini mock. */
  line: string;
  /** Three swatches shown on the theme card. */
  dots: [string, string, string];
  dark?: boolean;
};
export const themePalettes: Record<string, Palette> = {
  modern_purple: { name: "Modern Purple", accent: "#7952dd", accentSoft: "#f1ecfd", nav: "#19182b", bg: "#f6f7fb", surface: "#ffffff", line: "#ecebf3", dots: ["#6d3fe0", "#a07bf0", "#ffffff"] },
  luxury_black_gold: { name: "Luxury Black Gold", accent: "#c9a14a", accentSoft: "#2e2617", nav: "#0a0908", bg: "#0f0e0c", surface: "#1b1915", line: "#2e2a22", dots: ["#0f0e0c", "#3a3226", "#c9a14a"], dark: true },
  clean_minimal: { name: "Clean Minimal", accent: "#2f6fe0", accentSoft: "#e7f0fe", nav: "#1e2a3b", bg: "#f5f7fa", surface: "#ffffff", line: "#e6eaf0", dots: ["#2f6fe0", "#8db8f2", "#ffffff"] },
  soft_pink: { name: "Soft Pink", accent: "#e0587f", accentSoft: "#fde7ef", nav: "#3a1d2a", bg: "#fdf5f8", surface: "#ffffff", line: "#f3e1e8", dots: ["#e0587f", "#f4a3bb", "#ffffff"] },
  clinic_medical: { name: "Clinic Medical", accent: "#14968a", accentSoft: "#def4f0", nav: "#14302c", bg: "#f2f8f7", surface: "#ffffff", line: "#dcebe8", dots: ["#14968a", "#6fcdbf", "#0f5e57"] },
  real_estate_theme: { name: "Real Estate", accent: "#24569f", accentSoft: "#e4ecf9", nav: "#111d33", bg: "#eff3f9", surface: "#ffffff", line: "#dfe6f0", dots: ["#9fc0ea", "#24569f", "#0f2142"] },
};
export const isTheme = (id: string | null | undefined): id is string => !!id && id in themePalettes;

/** The company's active theme/character (defaults: Modern Purple / น้องโฟลว์). */
export function useShopActive() {
  const [active, setActive] = useState<{ theme: string; character: string; loaded?: boolean }>({ theme: "modern_purple", character: "nong_flow" });
  const load = useCallback(
    () =>
      api("/shop/active")
        .then((a) => setActive({ ...a, loaded: true }))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    load();
    window.addEventListener("ef:shop", load);
    return () => window.removeEventListener("ef:shop", load);
  }, [load]);
  return active;
}
/** The active AI character id, for the assistant/mascot. */
export const useActiveCharacter = () => useShopActive().character;

/* ------------------------------------------------------------------ applying */

const LAST_KEY = "ef:theme-last";
let switchTimer: ReturnType<typeof setTimeout> | undefined;
/** Sets <html data-theme>. Every theme (even the default) gets the attribute; themes.css holds the tokens. */
export function applyTheme(theme: string | null | undefined) {
  const root = document.documentElement;
  const next = isTheme(theme) ? theme : null;
  const prev = root.dataset.theme || null;
  if (prev === next) return;
  // Animate the switch only (not the first paint), so colours glide instead of snapping.
  if (prev && next) {
    root.classList.add("th-switching");
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => root.classList.remove("th-switching"), 650);
  }
  if (next) root.dataset.theme = next;
  else delete root.dataset.theme;
  root.style.colorScheme = next && themePalettes[next].dark ? "dark" : "";
}

/* ------------------------------------------------------------------ try before you buy */

const PREVIEW_KEY = "ef:theme-preview";
export type ThemePreview = { id: string; owned: boolean };
function readPreview(): ThemePreview | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PREVIEW_KEY) || "null");
    return v && isTheme(v.id) ? { id: v.id, owned: !!v.owned } : null;
  } catch {
    return null;
  }
}
/** Starts (or, with null, ends) a local, session-only theme preview. No API write, so it works in demo/read-only mode. */
export function setThemePreview(p: ThemePreview | null) {
  try {
    if (p) sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PREVIEW_KEY);
  } catch {}
  window.dispatchEvent(new Event("ef:theme-preview"));
}
export function useThemePreview() {
  // Lazy read avoids a flash back to the company theme on mount (the bar itself renders after mount, so no hydration diff).
  const [p, setP] = useState<ThemePreview | null>(() => (typeof window === "undefined" ? null : readPreview()));
  useEffect(() => {
    const sync = () => setP(readPreview());
    sync();
    window.addEventListener("ef:theme-preview", sync);
    return () => window.removeEventListener("ef:theme-preview", sync);
  }, []);
  return p;
}

/** Mount once in the workspace. Pass `theme` to force one (e.g. a preview); omit it to follow the company setting. */
export function ThemeApplier({ theme }: { theme?: string | null }) {
  if (theme === undefined) return <FollowCompanyTheme />;
  return <FixedTheme theme={theme} />;
}
function FixedTheme({ theme }: { theme: string | null }) {
  useEffect(() => {
    applyTheme(theme);
    return () => applyTheme(null);
  }, [theme]);
  return null;
}
function FollowCompanyTheme() {
  const active = useShopActive();
  const [known, setKnown] = useState<string | null>(null);
  const preview = useThemePreview();
  const cached = useRef("modern_purple");
  // First paint: reuse the last theme this browser saw (and any running preview) to avoid a purple flash.
  useLayoutEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_KEY);
    } catch {}
    if (isTheme(last)) cached.current = last;
    applyTheme(readPreview()?.id || cached.current);
    return () => applyTheme(null);
  }, []);
  // The company setting arrived (or changed).
  useEffect(() => {
    if (!active.loaded) return;
    setKnown(active.theme);
    try {
      localStorage.setItem(LAST_KEY, active.theme);
    } catch {}
  }, [active.theme, active.loaded]);
  // Once the previewed theme is the company theme (bought + activated), the preview is over.
  useEffect(() => {
    if (preview && known && preview.id === known) setThemePreview(null);
  }, [preview, known]);
  useEffect(() => {
    applyTheme(preview?.id || known || cached.current);
  }, [preview, known]);
  return preview && preview.id !== known ? <PreviewBar preview={preview} /> : null;
}

function PreviewBar({ preview }: { preview: ThemePreview }) {
  const router = useRouter();
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  if (!host) return null;
  const p = themePalettes[preview.id];
  return createPortal(
    <div className="th-preview-bar" role="status">
      <span className="th-preview-dots" aria-hidden>
        {p.dots.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
      </span>
      <span className="th-preview-text">
        <Eye size={15} /> กำลังลองธีม <b>{p.name}</b>
        <small>แสดงเฉพาะในเบราว์เซอร์นี้ ยังไม่เปลี่ยนให้ทั้งบริษัท</small>
      </span>
      <button className="th-preview-buy" onClick={() => router.push("/workspace/store?tab=themes&buy=" + preview.id)}>
        {preview.owned ? <Check size={15} /> : <ShoppingCart size={15} />}
        {preview.owned ? "ใช้ธีมนี้" : "ซื้อธีมนี้"}
      </button>
      <button className="th-preview-cancel" onClick={() => setThemePreview(null)} aria-label="ยกเลิกการลองธีม">
        <X size={15} /> ยกเลิก
      </button>
    </div>,
    host,
  );
}
