import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "EliteFlow — Business Workspace",
  description: "ระบบจัดการธุรกิจ ลูกค้า บุคลากร โครงการ สต็อก และ ZettaFlow AI",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
