"use client";
// A company's current EliteFlow package as a small coloured pill (customer list, account chip).
import { Crown } from "lucide-react";
import type { PlanBadge } from "@/lib/plan-badge";

export function PlanTag({ badge, className = "" }: { badge: PlanBadge | null | undefined; className?: string }) {
  if (!badge) return null;
  return (
    <em className={"plan-tag pt-" + badge.tone + (className ? " " + className : "")} title={badge.hint}>
      <Crown size={12} /> {badge.label}
    </em>
  );
}
