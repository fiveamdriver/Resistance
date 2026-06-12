interface EmptyStateProps {
  title: string;
  hint?: string;
}

/** Consistent empty-state block used across dashboard tabs. */
export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
