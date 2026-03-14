import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Ground Control",
  description: "Notion graph for IT project management databases",
  icons: {
    icon: "/bean.png",
    apple: "/bean.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" style={{ height: "100%", overflow: "hidden" }}>
      <body style={{ height: "100%", overflow: "hidden" }}>{children}</body>
    </html>
  );
}
