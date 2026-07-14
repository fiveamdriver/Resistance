import type { ParseStatus } from "@/lib/fileTypes";

// Light mode needs dark, saturated text on a pale tint — the dark-mode
// combo (bright text on a near-black tint) reads as low-contrast on cream.
const STYLES: Record<ParseStatus, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-400/40 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-500/30",
  parsed:  "bg-green-100 text-green-800 border-green-400/40 dark:bg-green-950/20 dark:text-green-400 dark:border-green-500/30",
  failed:  "bg-red-100 text-red-800 border-red-400/40 dark:bg-red-950/20 dark:text-red-400 dark:border-red-500/30",
};

export function ParseStatusBadge({ status }: { status: ParseStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
