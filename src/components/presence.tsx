"use client";
// Online dots. Every company logo on screen registers its id here; one shared loop pings /api/presence every 30 s
// (only while the tab is visible) and tells the logos, and the colleague lists, who is online right now.
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { api } from "./shared";

const watched = new Map<string, number>();
let online = { companies: new Set<string>(), users: new Set<string>() };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined,
  started = false,
  inFlight = false;

async function ping() {
  if (inFlight || document.hidden) return;
  inFlight = true;
  try {
    const r: { companies: string[]; users: string[] } = await api("/presence", { method: "POST", body: { companies: [...watched.keys()].slice(0, 300) } });
    online = { companies: new Set(r.companies), users: new Set(r.users) };
    listeners.forEach((f) => f());
  } catch {
    // Signed out or offline: dots simply stay as they were.
  } finally {
    inFlight = false;
  }
}
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const loop = () => {
    ping();
    timer = setTimeout(loop, 30000);
  };
  timer = setTimeout(loop, 400);
  document.addEventListener("visibilitychange", () => !document.hidden && ping());
}
/** A newly shown company is asked about soon, not after the next 30 s tick. */
let soon: ReturnType<typeof setTimeout> | undefined;
function askSoon() {
  clearTimeout(soon);
  soon = setTimeout(ping, 600);
}
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export function useCompanyOnline(id: string) {
  useEffect(() => {
    if (!id) return;
    start();
    const known = watched.has(id);
    watched.set(id, (watched.get(id) || 0) + 1);
    if (!known && started && timer) askSoon();
    return () => {
      const n = (watched.get(id) || 1) - 1;
      if (n <= 0) watched.delete(id);
      else watched.set(id, n);
    };
  }, [id]);
  return useSyncExternalStore(subscribe, () => online.companies.has(id), () => false);
}
export function useUserOnline(id: string) {
  useEffect(() => start(), []);
  return useSyncExternalStore(subscribe, () => online.users.has(id), () => false);
}

/** Wraps a picture and puts the green "online" dot on its corner. */
export function OnlineDot({ on, size, round, children }: { on: boolean; size?: number; round?: boolean; children: ReactNode }) {
  return (
    <span className={"pres" + (round ? " round" : "") + (size && size < 36 ? " small" : "")} style={size ? { width: size, height: size } : undefined}>
      {children}
      {on && <i className="pres-dot" title="ออนไลน์อยู่" aria-label="ออนไลน์อยู่" />}
    </span>
  );
}

/** Keeps the signed-in user marked online on every page, even one without company logos. */
export function usePresencePing(enabled: boolean) {
  useEffect(() => {
    if (enabled) start();
  }, [enabled]);
}

/** Small green/grey status pill for colleague lists. */
export function UserOnline({ id }: { id: string }) {
  const on = useUserOnline(id);
  return on ? <span className="pres-pill">ออนไลน์</span> : null;
}
