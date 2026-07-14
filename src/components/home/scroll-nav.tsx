"use client";

import { useEffect, useState } from "react";

export default function ScrollNav() {
  const [onFirst, setOnFirst] = useState(true);

  useEffect(() => {
    const check = () => setOnFirst(window.scrollY < window.innerHeight * 0.5);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);

  const handleClick = () =>
    window.scrollTo({
      top: onFirst ? window.innerHeight : 0,
      behavior: "smooth",
    });

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-bounce opacity-20 transition-opacity hover:opacity-50"
      aria-label={onFirst ? "Scroll down" : "Scroll to top"}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        {onFirst ? (
          <path d="M5 7.5L10 12.5L15 7.5" stroke="var(--fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M15 12.5L10 7.5L5 12.5" stroke="var(--fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
