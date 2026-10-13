import {
  PenTool,
  ShoppingCart,
  Warehouse,
  Megaphone,
  Users,
  MapPin,
  FileSignature,
  Wallet,
  PackageCheck,
  Flag,
  BarChart3,
} from "lucide-react";
import type { Entity } from "./types";
export const workflowDepartments = [
  {
    department: "Design",
    label: "Design Team",
    description: "เขียนแบบ / Perspective",
    color: "violet",
    icon: PenTool,
  },
  {
    department: "Purchasing",
    label: "Purchasing",
    description: "ขอใบเสนอราคา / Spec",
    color: "blue",
    icon: ShoppingCart,
  },
  {
    department: "Warehouse",
    label: "Warehouse",
    description: "เตรียมสินค้า / สต็อก",
    color: "green",
    icon: Warehouse,
  },
  {
    department: "Marketing",
    label: "Marketing",
    description: "เตรียมสื่อ / โปรโมชั่น",
    color: "amber",
    icon: Megaphone,
  },
  {
    department: "Sales",
    label: "PC Team",
    description: "วางแผนการขาย",
    color: "rose",
    icon: Users,
  },
];
export const projectWorkflow = [
  {
    key: "location",
    label: "หา Location",
    english: "Location",
    department: "Business Development",
    icon: MapPin,
  },
  {
    key: "contract",
    label: "ทำสัญญา",
    english: "Contract",
    department: "Legal",
    icon: FileSignature,
  },
  {
    key: "payment",
    label: "ชำระเงิน",
    english: "Payment",
    department: "Finance",
    icon: Wallet,
  },
  {
    key: "layout",
    label: "เขียนแบบ",
    english: "Layout",
    department: "Design",
    icon: PenTool,
  },
  {
    key: "procurement",
    label: "จัดซื้อ",
    english: "Procurement",
    department: "Purchasing",
    icon: ShoppingCart,
  },
  {
    key: "warehouse",
    label: "คลังสินค้า",
    english: "Warehouse",
    department: "Warehouse",
    icon: Warehouse,
  },
  {
    key: "setup",
    label: "เตรียมงาน",
    english: "Setup",
    department: "Operations",
    icon: PackageCheck,
  },
  {
    key: "selling",
    label: "PC ขายของ",
    english: "Selling",
    department: "Sales",
    icon: Users,
  },
  {
    key: "summary",
    label: "สรุปผล",
    english: "Summary",
    department: "Marketing",
    icon: BarChart3,
  },
  {
    key: "close",
    label: "ปิดงาน",
    english: "Close",
    department: "Operations",
    icon: Flag,
  },
];
export const referenceImages = (name: string) => {
  const lower = name.toLowerCase();
  const location = lower.includes("fashion island")
    ? "fashion-island"
    : lower.includes("promenade")
      ? "the-promenade"
      : lower.includes("central world")
        ? "central-world"
        : lower.includes("mega bangna")
          ? "mega-bangna"
          : lower.includes("rbs") || lower.includes("rangsit")
            ? "rbs-rangsit"
            : null;
  if (!location) return null;
  return {
    location: `/zetta/${location}.png`,
    site: lower.includes("fashion island")
      ? "/zetta/fashion-island-interior.png"
      : `/zetta/${location}.png`,
    layout: "/zetta/fashion-island-layout.png",
    perspective: "/zetta/perspective-plan.png",
  };
};
export function periodDays(start: unknown, end: unknown) {
  if (!start || !end) return "—";
  const days =
    (Number(new Date(String(end))) - Number(new Date(String(start)))) /
    86400000;
  return Number.isFinite(days) && days >= 0 ? Math.floor(days) + 1 : "—";
}
export function spaceStatistics(rows: Entity[]) {
  const count = (status: string) =>
    rows.filter((e) => e.data.status === status).length;
  return {
    total: rows.length,
    approved: count("approved"),
    pending: count("pending"),
    negotiating: count("negotiating"),
    cancelled: count("cancelled"),
  };
}
export function projectNumbers(project: Entity, entities: Entity[]) {
  const related = entities.filter((e) => e.data.projectId === project.id);
  const tasks = related.filter((e) => e.kind === "tasks"),
    done = tasks.filter((e) => e.data.status === "done").length;
  const sum = (kind: string, statuses: string[]) =>
    related
      .filter(
        (e) => e.kind === kind && statuses.includes(String(e.data.status)),
      )
      .reduce((total, e) => total + Number(e.data.amount || 0), 0);
  const deal = related.find((e) => e.kind === "deals");
  return {
    tasks,
    done,
    progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    sales: sum("sales", ["confirmed"]),
    expenses: sum("expenses", ["approved", "paid"]),
    target: Number(deal?.data.targetSales || 0),
  };
}
