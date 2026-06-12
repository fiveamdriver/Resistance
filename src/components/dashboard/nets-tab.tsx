import { EmptyState } from "@/components/ui/empty-state";

import type { NetVM } from "./view-models";

export function NetsTab({ nets }: { nets: NetVM[] }) {
  if (nets.length === 0) {
    return (
      <EmptyState
        title="No nets yet"
        hint="Nets will appear here once a netlist is parsed (Phase 2)."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Net</th>
            <th className="px-4 py-2.5 font-medium">Connections</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {nets.map((net) => (
            <tr key={net.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 font-mono font-medium text-slate-800">
                {net.name}
              </td>
              <td className="px-4 py-2.5 text-slate-600">
                {net.connectionCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
