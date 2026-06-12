import type { ParseStatus } from "@/lib/fileTypes";

const STYLES: Record<ParseStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  parsed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
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
