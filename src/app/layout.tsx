import type { Metadata } from "next";
import Link from "next/link";

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
    <html lang="en">
      <body className="min-h-screen bg-[#050505]">
        <header className="sticky top-0 z-50 border-b border-[#0f1f0f] bg-[#050505]/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">
                ⚡ Resistance
              </span>
              <span className="hidden text-xs text-[#4a5568] sm:inline">
                EE Project Assistant
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/projects"
                className="text-[#94a3b8] transition-colors hover:text-white"
              >
                Projects
              </Link>
              <Link
                href="/projects/new"
                className="rounded-md bg-white px-3 py-1.5 font-semibold text-black transition-colors hover:bg-white/90"
              >
                New Project
              </Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
