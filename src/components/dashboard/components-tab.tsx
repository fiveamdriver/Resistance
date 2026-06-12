import { EmptyState } from "@/components/ui/empty-state";

import type { ComponentVM } from "./view-models";

export function ComponentsTab({ components }: { components: ComponentVM[] }) {
  if (components.length === 0) {
    return (
      <EmptyState
        title="No components yet"
        hint="Components will appear here once a netlist is parsed (Phase 2)."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">RefDes</th>
            <th className="px-4 py-2.5 font-medium">Name</th>
            <th className="px-4 py-2.5 font-medium">Value</th>
            <th className="px-4 py-2.5 font-medium">Footprint</th>
            <th className="px-4 py-2.5 font-medium">Pins</th>
            <th className="px-4 py-2.5 font-medium">BOM</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {components.map((c) => (
            <tr key={c.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 font-mono font-medium text-slate-800">
                {c.refDes}
              </td>
              <td className="px-4 py-2.5 text-slate-600">{c.name ?? "—"}</td>
              <td className="px-4 py-2.5 text-slate-600">{c.value ?? "—"}</td>
              <td className="px-4 py-2.5 text-slate-600">
                {c.footprint ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-slate-600">{c.pinCount}</td>
              <td className="px-4 py-2.5 text-slate-600">{c.bomCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
