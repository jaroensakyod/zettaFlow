import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { catalog } from "@/lib/catalog";
export const metadata = {
  title: "EliteFlow — Business Workspace",
  icons: { icon: "/brand/eliteflow-icon.png", apple: "/brand/eliteflow-mark.png" },
};
const extra = [
  "feed",
  "dashboard",
  "calendar",
  "chat",
  "reports",
  "ai-inbox",
  "templates",
  "integrations",
  "company",
  "team",
  "store",
  "pricing",
  "assistant",
];
export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (!catalog[view] && !extra.includes(view)) notFound();
  return <Workspace initialView={view} />;
}
