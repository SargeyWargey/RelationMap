import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "The Universe",
  description: "Notion-powered data visualization tools",
  icons: {
    icon: "/universe.png",
    apple: "/universe.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" style={{ height: "100%", overflow: "hidden" }}>
      <body style={{ height: "100%", overflow: "hidden" }}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
