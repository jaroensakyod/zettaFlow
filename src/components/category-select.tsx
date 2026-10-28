"use client";
// หมวดหมู่หลัก picker: grouped options with emoji. A record that still uses an older category shows it under "หมวดเดิม".
import type { SelectHTMLAttributes } from "react";
import { categoryLabel, expenseCategoryGroups, isLegacyCategory } from "@/lib/expense-categories";

export function CategorySelect({
  value,
  onChange,
  placeholder = "เลือกหมวดหมู่",
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <select {...rest} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {expenseCategoryGroups.map((g) => (
        <optgroup key={g.name} label={`${g.emoji} ${g.name}`}>
          {g.items.map((c) => (
            <option key={c.name} value={c.name}>
              {c.emoji} {c.name}
            </option>
          ))}
        </optgroup>
      ))}
      {value && isLegacyCategory(value) && (
        <optgroup label="หมวดเดิม">
          <option value={value}>{categoryLabel(value)}</option>
        </optgroup>
      )}
    </select>
  );
}
