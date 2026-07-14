import { EmptyState } from "@/components/ui/empty-state";

import type { ComponentVM } from "./view-models";

export function ComponentsTab({ components }: { components: ComponentVM[] }) {
  if (components.length === 0) {
    return (
      <EmptyState
        title="No components yet"
        hint="Upload a netlist file to populate the components table."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[rgba(var(--overlay-rgb),0.08)] bg-[rgba(var(--overlay-rgb),0.03)] text-xs uppercase tracking-wide text-[var(--fg-subtle)]">
          <tr>
            <th className="px-4 py-2.5 font-medium">RefDes</th>
            <th className="px-4 py-2.5 font-medium">Name</th>
            <th className="px-4 py-2.5 font-medium">Value</th>
            <th className="px-4 py-2.5 font-medium">Footprint</th>
            <th className="px-4 py-2.5 font-medium">Pins</th>
            <th className="px-4 py-2.5 font-medium">BOM</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(var(--overlay-rgb),0.06)]">
          {components.map((c) => (
            <tr key={c.id} className="transition hover:bg-[rgba(var(--overlay-rgb),0.03)]">
              <td className="px-4 py-2.5 font-mono font-medium text-[var(--fg)]">
                {c.refDes}
              </td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">{c.name ?? "—"}</td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">{c.value ?? "—"}</td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">{c.footprint ?? "—"}</td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">{c.pinCount}</td>
              <td className="px-4 py-2.5 text-[var(--fg-muted)]">{c.bomCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
