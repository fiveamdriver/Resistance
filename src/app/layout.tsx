import type { Metadata } from "next";
import DitheringBackground from "@/components/home/dithering-background";
import SiteHeader from "@/components/site-header";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Resistance — EE Project Assistant",
  description:
    "AI-powered assistant for electrical engineering projects: netlists, BOMs, datasheets, and connectivity.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // In the desktop shell "/" redirects to /projects (see middleware), so the
  // logo points straight there; on the web it stays the marketing hero.
  const homeHref = process.env.RESISTANCE_LOCAL_TOKEN ? "/projects" : "/";
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link href="https://api.fontshare.com/v2/css?f[]=satoshi@300,301,400,401,500,501,700,701,900,901&display=swap" rel="stylesheet" />
        {/* eslint-disable-next-line react/no-danger -- anti-flash theme init, must run before paint */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <SiteHeader homeHref={homeHref} />
          <DitheringBackground />
          <main className="relative z-10">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
