"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/** Past this scroll offset the transparent header becomes a solid bar. */
const SCROLL_THRESHOLD = 24;

export default function SiteHeader({ homeHref }: { homeHref: string }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const check = () => setScrolled(window.scrollY > SCROLL_THRESHOLD);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-300 ${
        scrolled
          ? "border-[rgba(var(--overlay-rgb),0.03)] bg-[rgba(var(--bg-rgb),0.85)] backdrop-blur-md"
          : "border-transparent bg-transparent"
      }`}
    >
      {/* While transparent, only the logo/links themselves should catch
       * clicks — the empty space between them must let clicks fall through
       * to whatever's visually underneath. pointer-events-none here, -auto
       * on each interactive child, makes that true at every scroll position
       * (including solid), so there's no invisible click-eating band. */}
      <div className="flex w-full items-center justify-between px-8 py-3 xl:px-16 pointer-events-none">
        <Link
          href={homeHref}
          className="pointer-events-auto text-2xl font-bold tracking-tight text-[var(--fg)]"
        >
          Resistance
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/projects"
            className="pointer-events-auto text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg-muted)]"
          >
            Projects
          </Link>
          <Link
            href="/settings"
            className="pointer-events-auto text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg-muted)]"
          >
            Settings
          </Link>
          <Link
            href="/projects/new"
            className="pointer-events-auto rounded border border-[rgba(var(--overlay-rgb),0.15)] px-4 py-1.5 bg-[var(--accent-bg)] text-[var(--accent-fg)] transition-colors hover:border-[rgba(var(--overlay-rgb),0.3)] hover:text-[var(--accent-fg)]"
          >
            New Project
          </Link>
        </nav>
      </div>
    </header>
  );
}
