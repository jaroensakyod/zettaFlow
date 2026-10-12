import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
export const metadata = {
  title: "Zetta Flow AI — AI That Moves Your Business Forward",
};
const views = [
  "dashboard",
  "spaces",
  "calendar",
  "projects",
  "design",
  "purchasing",
  "warehouse",
  "sales",
  "finance",
  "documents",
  "reports",
  "team",
  "settings",
  "inbox",
  "templates",
  "assistant",
  "integrations",
  "pricing",
];
export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (!views.includes(view)) notFound();
  return <Workspace initialView={view} product="zetta" />;
}
