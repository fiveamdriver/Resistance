import type { DashboardVM } from "./view-models";

export function ReportsTab({ vm }: { vm: DashboardVM }) {
  const stats = [
    { label: "Files", value: vm.files.length },
    { label: "Components", value: vm.components.length },
    { label: "Nets", value: vm.nets.length },
    { label: "BOM items", value: vm.bomItems.length },
    { label: "Doc chunks", value: vm.documentChunkCount },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 text-center"
          >
            <div className="text-2xl font-bold text-[#F5F0E8]">{s.value}</div>
            <div className="text-xs uppercase tracking-wide text-[#4a5568]">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-5 text-sm text-[#4a5568]">
        <p className="font-medium text-[#94a3b8]">Design Review Report</p>
        <p className="mt-1">
          Automatic risk analysis coming soon — this report will flag connectivity
          issues, BOM mismatches, unconnected pins, and design-rule violations
          based on your uploaded files.
        </p>
      </div>
    </div>
  );
}
