import type { Metadata } from "next";
import Link from "next/link";
import DitheringBackground from "@/components/home/dithering-background";

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
  return (
    <html lang="en" className="bg-[#050505]" style={{ backgroundColor: '#050505' }}>
      <head>
        <link href="https://api.fontshare.com/v2/css?f[]=satoshi@300,301,400,401,500,501,700,701,900,901&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-[#050505]">
        <header className="sticky top-0 z-50">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
            <Link href="/" className="text-[32px] font-bold tracking-tight text-[#F5F0E8]">
              Resistance
            </Link>
            <nav className="flex items-center gap-6 text-sm">
              <Link
                href="/projects"
                className="text-[#4a5568] transition-colors hover:text-[#94a3b8]"
              >
                Projects
              </Link>
              <Link
                href="/projects/new"
                className="rounded border border-[rgba(255,255,255,0.15)] px-4 py-1.5 bg-[#F5F0E8] text-black transition-colors hover:border-[rgba(255,255,255,0.3)] hover:text-black"
              >
                New Project
              </Link>
            </nav>
          </div>
        </header>
        <DitheringBackground />
        <main className="relative z-10">{children}</main>
      </body>
    </html>
  );
}
