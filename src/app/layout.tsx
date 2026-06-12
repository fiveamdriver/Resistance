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
      <body className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg font-bold text-brand">
                ⚡ Resistance
              </span>
              <span className="hidden text-xs text-slate-400 sm:inline">
                EE Project Assistant
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/projects"
                className="text-slate-600 hover:text-brand"
              >
                Projects
              </Link>
              <Link
                href="/projects/new"
                className="rounded-md bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark"
              >
                New Project
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
