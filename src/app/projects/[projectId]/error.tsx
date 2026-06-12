"use client";

import Link from "next/link";

/** Route-level error boundary for the project dashboard. */
export default function DashboardError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center">
      <h1 className="text-lg font-semibold text-red-800">
        Couldn&apos;t load this project
      </h1>
      <p className="mt-1 text-sm text-red-700">
        An unexpected error occurred. Please try again.
      </p>
      <div className="mt-4 flex justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Retry
        </button>
        <Link
          href="/projects"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to projects
        </Link>
      </div>
    </div>
  );
}
