import type { Metadata } from "next";
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
import "./styles/themes.css";
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
