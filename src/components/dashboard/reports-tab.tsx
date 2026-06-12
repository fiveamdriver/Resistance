import type { DashboardVM } from "./view-models";

/**
 * Reports tab — Phase 1 shows a project summary and previews the design-review
 * report generator planned for a later phase.
 */
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
            className="rounded-lg border border-slate-200 bg-white p-4 text-center"
          >
            <div className="text-2xl font-bold text-slate-900">{s.value}</div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
        <p className="font-medium text-slate-700">
          Design-review report generator (planned)
        </p>
        <p className="mt-1">
          A future phase will analyze connectivity and BOM data to flag risks a
          human engineer should check — unconnected pins, missing decoupling,
          power-net fan-out, and BOM/schematic mismatches.
        </p>
      </div>
    </div>
  );
}
