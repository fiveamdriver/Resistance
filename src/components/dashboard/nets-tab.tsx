import { EmptyState } from "@/components/ui/empty-state";

import type { NetVM } from "./view-models";

export function NetsTab({ nets }: { nets: NetVM[] }) {
  if (nets.length === 0) {
    return (
      <EmptyState
        title="No nets yet"
        hint="Upload a netlist file to populate the nets table."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-xs uppercase tracking-wide text-[#4a5568]">
          <tr>
            <th className="px-4 py-2.5 font-medium">Net</th>
            <th className="px-4 py-2.5 font-medium">Connections</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
          {nets.map((net) => (
            <tr key={net.id} className="transition hover:bg-[rgba(255,255,255,0.03)]">
              <td className="px-4 py-2.5 font-mono font-medium text-white">
                {net.name}
              </td>
              <td className="px-4 py-2.5 text-[#94a3b8]">
                {net.connectionCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
