"use client";

import { useEffect, useState } from "react";

export default function ScrollIndicator() {
  const [isWindowed, setIsWindowed] = useState(false);

  useEffect(() => {
    const check = () =>
      setIsWindowed(window.innerHeight < screen.height * 0.9);

    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div
      className={`animate-bounce opacity-20 ${
        isWindowed
          ? "fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
          : "absolute bottom-6 left-1/2 -translate-x-1/2"
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5 7.5L10 12.5L15 7.5" stroke="var(--fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
