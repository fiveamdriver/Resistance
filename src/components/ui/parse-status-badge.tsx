import type { ParseStatus } from "@/lib/fileTypes";

const STYLES: Record<ParseStatus, string> = {
  pending: "bg-amber-950/20 text-amber-400 border-amber-500/30",
  parsed:  "bg-green-950/20 text-green-400 border-green-500/30",
  failed:  "bg-red-950/20 text-red-400 border-red-500/30",
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
