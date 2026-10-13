import type { Metadata } from "next";
import { SharedDashboard } from "@/components/shared-dashboard";
export const metadata: Metadata = {
  title: "Shared Dashboard · ZettaFlow AI",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedDashboard token={token} />;
}
