import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./zetta/zetta.css";
import "./zetta/departments.css";
import "./zetta/executive.css";
import "./styles/finance.css";
import "./styles/documents.css";
import "./styles/appshop.css";
import "./styles/topup.css";
import "./styles/projects.css";
import "./styles/line.css";
import "./styles/home.css";
import "./styles/employees.css";
import "./styles/chat.css";
import "./styles/profile.css";
import "./styles/auth-future.css";
import "./styles/themes.css";
import "./styles/admin.css";
export const metadata: Metadata = {
  title: "EliteFlow — Business Workspace",
  description: "ระบบจัดการธุรกิจ ลูกค้า บุคลากร โครงการ สต็อก และ ZettaFlow AI",
};
// Phones: no zooming in when a field is tapped (iOS zooms into inputs); the page always fits the screen.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
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
