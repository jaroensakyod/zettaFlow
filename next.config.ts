import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    const map: Record<string, string> = {
      "index.html": "/",
      "app.html": "/",
      "profilecompany.html": "/workspace/company",
      "employees.html": "/workspace/employees",
      "stock.html": "/workspace/products",
      "supplier.html": "/workspace/suppliers",
      "task.html": "/workspace/tasks",
      "project.html": "/workspace/projects",
      "dealer-record.html": "/workspace/dealers",
      "dealer-view.html": "/workspace/dealers",
      "record-deal-area.html": "/workspace/deals",
      "assets.html": "/workspace/assets",
      "event.html": "/workspace/events",
      "freelance.html": "/workspace/freelancers",
      "chat.html": "/workspace/chat",
      "backoffice.html": "/workspace/team",
      "dept-accounting.html": "/workspace/expenses",
      "dept-marketing.html": "/workspace/campaigns",
      "dept-it.html": "/workspace/tickets",
      "dept-cs.html": "/workspace/tickets",
      "dept-data.html": "/workspace/reports",
      "dept-legal.html": "/workspace/contracts",
      "store.html": "/workspace/store",
      "theme-store.html": "/workspace/company",
      "pricing.html": "/workspace/pricing",
      "payment.html": "/workspace/payments",
      "ai-assistant.html": "/workspace/assistant",
      "reset-password.html": "/reset-password",
    };
    return [
      ...Object.entries(map).map(([source, destination]) => ({
        source: "/" + source,
        destination,
        permanent: false,
      })),
      ...[1, 2, 3, 4].map((n) => ({
        source: `/freelance\\(${n}\\).html`,
        destination: "/workspace/freelancers",
        permanent: false,
      })),
      {
        source: "/event\\(17\\).html",
        destination: "/workspace/events",
        permanent: false,
      },
    ];
  },
  outputFileTracingExcludes: {
    "*": [
      "./.data/**/*",
      "./archive/**/*",
      "./artifacts/**/*",
      "./tests/**/*",
      "./scripts/**/*",
      "./*.html",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
