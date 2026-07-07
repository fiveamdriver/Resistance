export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[#050505] px-6 py-8 pt-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="h-6 w-32 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
        <div className="h-8 w-64 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
        <div className="h-10 w-full animate-pulse rounded bg-[rgba(255,255,255,0.04)]" />
        <div className="h-64 w-full animate-pulse rounded-lg bg-[rgba(255,255,255,0.04)]" />
      </div>
    </div>
  );
}
