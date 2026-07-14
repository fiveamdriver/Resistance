"use client";

export default function ScrollUpIndicator() {
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="absolute bottom-6 left-1/2 -translate-x-1/2 animate-bounce opacity-20 transition-opacity hover:opacity-50"
      aria-label="Scroll to top"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M15 12.5L10 7.5L5 12.5" stroke="var(--fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
