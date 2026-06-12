export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
      <div className="h-10 w-full animate-pulse rounded bg-slate-100" />
      <div className="h-64 w-full animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}
