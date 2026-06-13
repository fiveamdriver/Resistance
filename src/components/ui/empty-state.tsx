interface EmptyStateProps {
  title: string;
  hint?: string;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-10 text-center">
      <p className="text-sm font-medium text-[#94a3b8]">{title}</p>
      {hint && <p className="mt-1 text-xs text-[#4a5568]">{hint}</p>}
    </div>
  );
}
