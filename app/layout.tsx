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

// Runs synchronously before first paint so a dark-mode user never sees a
// light flash. Reads the same key/values as ThemeProvider ("theme" =
// "dark" | "light", falling back to the OS preference).
const themeInitScript = `try{var t=localStorage.getItem("theme");if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" style={{ height: "100%", overflow: "hidden" }} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body style={{ height: "100%", overflow: "hidden" }}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
