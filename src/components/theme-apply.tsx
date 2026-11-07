"use client";
// App Shop themes and characters on the client: palettes, the ThemeApplier that writes CSS variables on <html>,
// and a hook for the company's active theme/character (refreshed by the "ef:shop" event after a purchase/switch).
import { useCallback, useEffect, useState } from "react";
import { api } from "./shared";

export type Palette = {
  accent: string;
  accentSoft: string;
  nav: string;
  bg: string;
  /** Three swatches shown on the theme card. */
  dots: [string, string, string];
};
export const themePalettes: Record<string, Palette> = {
  modern_purple: { accent: "#7952dd", accentSoft: "#f1ecfd", nav: "#19182b", bg: "#f6f7fb", dots: ["#6d3fe0", "#a07bf0", "#ffffff"] },
  luxury_black_gold: { accent: "#b8892f", accentSoft: "#f8f0de", nav: "#141210", bg: "#f6f4ef", dots: ["#141210", "#3a3226", "#c9a14a"] },
  clean_minimal: { accent: "#3b7be0", accentSoft: "#eaf2fd", nav: "#1e2a3b", bg: "#f7f9fc", dots: ["#3b7be0", "#8db8f2", "#ffffff"] },
  soft_pink: { accent: "#e0587f", accentSoft: "#fdebf1", nav: "#3a1d2a", bg: "#fdf7f9", dots: ["#e0587f", "#f4a3bb", "#ffffff"] },
  clinic_medical: { accent: "#1c9c8c", accentSoft: "#e3f6f3", nav: "#14302c", bg: "#f5faf9", dots: ["#1c9c8c", "#6fcdbf", "#0f5e57"] },
  real_estate_theme: { accent: "#24539e", accentSoft: "#e8eef9", nav: "#111d33", bg: "#f5f7fb", dots: ["#9fc0ea", "#24539e", "#111d33"] },
};
const vars: [keyof Palette, string][] = [
  ["accent", "--accent"],
  ["accentSoft", "--accent-soft"],
  ["nav", "--nav"],
  ["bg", "--bg"],
];

/** The company's active theme/character (defaults: Modern Purple / น้องโฟลว์). */
export function useShopActive() {
  const [active, setActive] = useState<{ theme: string; character: string }>({ theme: "modern_purple", character: "nong_flow" });
  const load = useCallback(
    () =>
      api("/shop/active")
        .then(setActive)
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

/** Writes the theme palette onto <html>. The default theme removes the overrides so globals.css applies. */
export function applyTheme(theme: string | null | undefined) {
  const root = document.documentElement;
  const p = theme && theme !== "modern_purple" ? themePalettes[theme] : undefined;
  for (const [k, v] of vars) {
    if (p) root.style.setProperty(v, p[k] as string);
    else root.style.removeProperty(v);
  }
  if (p) root.dataset.efTheme = theme!;
  else delete root.dataset.efTheme;
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
  const { theme } = useShopActive();
  return <FixedTheme theme={theme} />;
}
