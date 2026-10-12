import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { catalog } from "@/lib/catalog";
const extra = [
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
