"use client";
import { Empty, money } from "./shared";
import type { Entity } from "@/lib/types";
export const chartColors = [
  "#8054ee",
  "#3687ed",
  "#31b77b",
  "#ffbc41",
  "#f07598",
  "#8390aa",
];
export function NumberCard({
  label,
  value,
  note,
  tone = "violet",
  icon: Icon,
}: {
  label: string;
  value: number | string;
  note?: string;
  tone?: string;
  icon?: React.ComponentType<{ size?: number }>;
}) {
  return (
    <article className={"zd-number " + tone}>
      {Icon && (
        <span className="zd-number-icon">
          <Icon size={23} />
        </span>
      )}
      <div>
        <span>{label}</span>
        <strong>{typeof value === "number" ? money(value) : value}</strong>
        {note && <small>{note}</small>}
      </div>
    </article>
  );
}
export function LineChart({
  points,
  unit = "บาท",
  color = "#7547e4",
}: {
  points: { label: string; value: number }[];
  unit?: string;
  color?: string;
}) {
  if (!points.length) return <Empty title="ยังไม่มีข้อมูลสำหรับกราฟ" />;
  const max = Math.max(1, ...points.map((p) => p.value)),
    min = Math.min(0, ...points.map((p) => p.value));
  const y = (v: number) => 155 - ((v - min) / (max - min)) * 125,
    x = (i: number) => 35 + (i * 410) / Math.max(1, points.length - 1),
    coords = points.map((p, i) => `${x(i)},${y(p.value)}`);
  return (
    <div className="zd-line">
      <small>({unit})</small>
      <svg viewBox="0 0 480 195" role="img" aria-label="กราฟแนวโน้มข้อมูล">
        <defs>
          <linearGradient
            id={"chart-area-" + color.replace("#", "")}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop stopColor={color} stopOpacity=".2" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[30, 61, 92, 123, 155].map((line, i) => (
          <g key={line}>
            <line x1="35" x2="455" y1={line} y2={line} stroke="#efedf5" />
            <text x="0" y={line + 3} fontSize="8" fill="#9891ac">
              {money(max - ((max - min) * i) / 4)}
            </text>
          </g>
        ))}
        <path
          d={`M35,155 L${coords.join(" L")} L${x(points.length - 1)},155 Z`}
          fill={`url(#chart-area-${color.replace("#", "")})`}
        />
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
        />
        {points.map((p, i) => (
          <g key={p.label}>
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r="3"
              fill="#fff"
              stroke={color}
              strokeWidth="2"
            />
            <text
              x={x(i)}
              y="176"
              fontSize="8"
              textAnchor="middle"
              fill="#827493"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
export function Donut({
  items,
  title = "รวม",
  unit = "",
}: {
  items: { label: string; value: number }[];
  title?: string;
  unit?: string;
}) {
  const positive = items.filter((i) => i.value > 0),
    total = positive.reduce((s, i) => s + i.value, 0);
  if (!positive.length) return <Empty title="ยังไม่มีข้อมูลสัดส่วน" />;
  let cursor = 0;
  const stops = positive.map((p, i) => {
    const start = cursor;
    cursor += (p.value / total) * 100;
    return `${chartColors[i % chartColors.length]} ${start}% ${cursor}%`;
  });
  return (
    <div className="zd-donut-box">
      <div
        className="zd-donut"
        style={{ background: `conic-gradient(${stops.join(",")})` }}
      >
        <div>
          <small>{title}</small>
          <strong>{money(total)}</strong>
          <small>{unit}</small>
        </div>
      </div>
      <div className="zd-legend">
        {positive.map((p, i) => (
          <div key={p.label}>
            <span>
              <i style={{ background: chartColors[i % chartColors.length] }} />
              {p.label}
            </span>
            <strong>{Math.round((p.value / total) * 100)}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
export function StatusBars({
  items,
}: {
  items: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...items.map((p) => p.value));
  return (
    <div className="zd-status-bars">
      {items.map((p, i) => (
        <div key={p.label}>
          <span>{p.label}</span>
          <div>
            <i
              style={{
                width: (p.value / max) * 100 + "%",
                background: chartColors[i % chartColors.length],
              }}
            />
          </div>
          <strong>{money(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}
export function amountSeries(
  rows: Entity[],
  field = "amount",
  dateField = "date",
  bucket: "day" | "month" = "day",
) {
  const grouped = new Map<string, number>();
  rows.forEach((r) => {
    const date = String(r.data[dateField] || r.created_at).slice(
      0,
      bucket === "month" ? 7 : 10,
    );
    grouped.set(date, (grouped.get(date) || 0) + Number(r.data[field] || 0));
  });
  return [...grouped]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([label, value]) => ({
      label: bucket === "month" ? label : label.slice(5),
      value,
    }));
}
export function groupedValues(rows: Entity[], field: string, amount?: string) {
  const grouped = new Map<string, number>();
  rows.forEach((r) => {
    const label = String(r.data[field] || "ยังไม่ระบุ");
    grouped.set(
      label,
      (grouped.get(label) || 0) + (amount ? Number(r.data[amount] || 0) : 1),
    );
  });
  return [...grouped]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}
