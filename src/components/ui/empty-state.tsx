interface EmptyStateProps {
  title: string;
  hint?: string;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-[rgba(var(--overlay-rgb),0.1)] bg-[rgba(var(--overlay-rgb),0.02)] p-10 text-center">
      <p className="text-sm font-medium text-[var(--fg-muted)]">{title}</p>
      {hint && <p className="mt-1 text-xs text-[var(--fg-subtle)]">{hint}</p>}
    </div>
  );
}
